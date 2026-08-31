/**
 * agent 循环的中断与退出原因。
 *
 * 这两条正是 v4 第 0 批订正的核心（D1 / D2）：
 *  - 残留的 cancel 标记必须在【进入循环前】清一次；放进循环里会在每轮 has() 检查前
 *    把标记删掉，导致取消永远不命中。
 *  - 只有真的把轮数跑完才提示「已达最大轮数」；超时/中断另有各自的提示，
 *    否则用户点一次停止会收到两条消息。
 *
 * OpenAI 客户端整体 mock 掉，不发真实请求。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** 每次 create() 返回的假流。默认不带工具调用，即「一轮就结束」。 */
let streamChunks: any[] = [];
let createCallCount = 0;

vi.mock('openai', () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: async () => {
          createCallCount++;
          return {
            async *[Symbol.asyncIterator]() {
              for (const c of streamChunks) yield c;
            },
          };
        },
      },
    };
  }
  return { default: FakeOpenAI };
});

// Skill 注册表也 mock 掉：本测试只关心循环控制流，不关心工具
vi.mock('../server/skills/index.js', () => ({
  skillRegistry: {
    getAllTools: () => [],
    executeTool: async () => 'ok',
  },
}));

const { runCodingAgent, cancelAgent } = await import('../server/agent.js');

function textChunk(content: string) {
  return { choices: [{ delta: { content } }] };
}

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: 'test-key',
    model: 'test-model',
    messages: [{ role: 'user', content: 'hi' }],
    workingDir: process.cwd(),
    permissionMode: 'default',
    emit: vi.fn(),
    requestPermission: vi.fn(),
    ...overrides,
  } as any;
}

describe('runCodingAgent 中断与退出原因', () => {
  beforeEach(() => {
    streamChunks = [textChunk('hello')];
    createCallCount = 0;
  });

  it('正常完成时不应额外报「已达最大轮数」', async () => {
    const emit = vi.fn();
    const { content } = await runCodingAgent(baseParams({ emit, sessionId: 's-normal' }));

    expect(content).toBe('hello');
    const messages = emit.mock.calls.map((c) => c[0]);
    expect(messages.some((m) => String(m.message || '').includes('最大轮数'))).toBe(false);
  });

  it('上一次请求残留的 cancel 标记不应打断下一次请求', async () => {
    // 模拟 A2 修好之前的遗留状态：标记还留在 Set 里
    cancelAgent('s-stale');

    const emit = vi.fn();
    const { content } = await runCodingAgent(baseParams({ emit, sessionId: 's-stale' }));

    // 若清理动作被放进循环内部，这里会拿到空内容 + 「用户已中断」
    expect(createCallCount).toBe(1);
    expect(content).toBe('hello');
    const messages = emit.mock.calls.map((c) => c[0]);
    expect(messages.some((m) => String(m.message || '').includes('用户已中断'))).toBe(false);
  });

  it('运行期间收到取消时应中断，且只报中断、不报最大轮数', async () => {
    // 模型流开始吐字后触发取消：下一轮循环开头应命中标记
    streamChunks = [
      textChunk('partial'),
      // 借流的第二个 chunk 作为「取消发生」的时机
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'noop', arguments: '{}' } }] } }] },
    ];

    const emit = vi.fn((obj: any) => {
      if (obj.type === 'tool_result') cancelAgent('s-cancel');
    });

    await runCodingAgent(baseParams({ emit, sessionId: 's-cancel', permissionMode: 'bypassPermissions' }));

    const messages = emit.mock.calls.map((c) => c[0]);
    expect(messages.some((m) => String(m.message || '').includes('用户已中断'))).toBe(true);
    expect(messages.some((m) => String(m.message || '').includes('最大轮数'))).toBe(false);
  });
});
