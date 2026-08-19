/**
 * OpenAI 兼容的 Coding Agent 引擎
 *
 * 替代原 @tencent-ai/agent-sdk：用任意 OpenAI 兼容端点（baseURL 可配）
 * 驱动一个会读写文件、搜索代码、执行命令的专业级编程 Agent。
 *
 * 工具定义与执行改由 Skill 注册表（server/skills）动态提供，
 * 本模块只负责「一次用户请求」内的 Agent 循环，并通过 emit / requestPermission
 * 回调把事件与权限流对接到现有 Express + SSE 前端协议，不改变前端。
 */
import OpenAI from 'openai';
import { skillRegistry } from './skills/index.js';

// ---- 类型 ----
export interface ToolCallRec {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  result?: string;
  isError?: boolean;
}

export type EmitFn = (obj: Record<string, unknown>) => void;

export interface PermissionResult {
  behavior: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  message?: string;
}

export type RequestPermissionFn = (
  toolName: string,
  input: Record<string, unknown>,
  toolUseId: string
) => Promise<PermissionResult>;

export interface RunAgentParams {
  apiKey: string;
  baseURL?: string;
  model: string;
  // OpenAI 消息数组（system + 历史 + 当前 user 消息），循环中会原地追加
  messages: any[];
  workingDir: string;
  permissionMode: string;
  emit: EmitFn;
  requestPermission: RequestPermissionFn;
  /** 当前用户 ID（供 Skill 使用） */
  userId?: string;
}

const MAX_TURNS = 25; // 单次请求最大工具轮数

// 需要权限确认的工具（写/改/删文件 + 执行命令）
const MUTATING_TOOLS = new Set(['write_file', 'edit_file', 'delete_file']);
const COMMAND_TOOLS = new Set(['run_command']);

// ---- 主循环 ----
export async function runCodingAgent(params: RunAgentParams): Promise<{
  content: string;
  toolCalls: ToolCallRec[];
}> {
  const { apiKey, baseURL, model, messages, workingDir, permissionMode, emit, requestPermission, userId } =
    params;
  const client = new OpenAI({ apiKey, baseURL: baseURL || undefined });

  // 工具定义与执行均来自 Skill 注册表（动态加载）
  const toolDefs = skillRegistry.getAllTools();

  const toolCallsAcc: ToolCallRec[] = [];
  let fullResponse = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = await client.chat.completions.create({
      model,
      messages,
      tools: toolDefs,
      tool_choice: 'auto',
      stream: true,
      temperature: 0.2,
    });

    let content = '';
    const toolAccum: any[] = [];

    for await (const chunk of stream) {
      const delta = (chunk as any).choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        emit({ type: 'text', content: delta.content });
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolAccum[idx]) toolAccum[idx] = { id: '', name: '', arguments: '' };
          if (tc.id) toolAccum[idx].id = tc.id;
          if (tc.function?.name) toolAccum[idx].name = tc.function.name;
          if (tc.function?.arguments) toolAccum[idx].arguments += tc.function.arguments;
        }
      }
    }

    fullResponse += content;

    const finalTools = toolAccum
      .filter(Boolean)
      .map((t) => ({ id: t.id || `call_${Math.random().toString(36).slice(2)}`, name: t.name, arguments: t.arguments || '{}' }));

    // 无工具调用 -> 本轮结束
    if (finalTools.length === 0) {
      if (content) messages.push({ role: 'assistant', content });
      break;
    }

    // 把 assistant（含 tool_calls）写入对话历史
    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: finalTools.map((t) => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: t.arguments },
      })),
    });

    // 逐个执行工具
    for (const t of finalTools) {
      const toolId = t.id;
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(t.arguments || '{}');
      } catch {
        parsedInput = {};
      }

      const rec: ToolCallRec = { id: toolId, name: t.name, input: parsedInput, status: 'running' };
      toolCallsAcc.push(rec);
      emit({ type: 'tool', id: toolId, name: t.name, input: parsedInput, status: 'running' });

      const mutating = MUTATING_TOOLS.has(t.name);
      const isCommand = COMMAND_TOOLS.has(t.name);

      let allowed = true;
      let denyMsg = '';

      if (permissionMode === 'plan' && (mutating || isCommand)) {
        allowed = false;
        denyMsg = '⚠️ plan 模式：只读，已拒绝该操作';
      } else if (permissionMode === 'bypassPermissions') {
        allowed = true;
      } else if (mutating) {
        if (permissionMode !== 'acceptEdits') {
          const r = await requestPermission(t.name, parsedInput, toolId);
          if (r.behavior !== 'allow') {
            allowed = false;
            denyMsg = r.message || '用户拒绝了此操作';
          }
        }
      } else if (isCommand) {
        if (permissionMode !== 'bypassPermissions') {
          const r = await requestPermission(t.name, parsedInput, toolId);
          if (r.behavior !== 'allow') {
            allowed = false;
            denyMsg = r.message || '用户拒绝了此操作';
          }
        }
      }

      let result = '';
      let isError = false;
      if (!allowed) {
        result = denyMsg;
      } else {
        try {
          result = await skillRegistry.executeTool(t.name, parsedInput, { workingDir, userId: userId || '' });
        } catch (e: any) {
          result = `工具执行错误: ${e?.message || String(e)}`;
          isError = true;
        }
      }

      rec.status = isError ? 'error' : 'completed';
      rec.isError = isError;
      rec.result = result;

      emit({ type: 'tool_result', toolId, content: result, isError });
      messages.push({ role: 'tool', tool_call_id: toolId, content: result });
    }
  }

  return { content: fullResponse, toolCalls: toolCallsAcc };
}
