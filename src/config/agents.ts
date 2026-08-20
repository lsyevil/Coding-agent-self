export interface Agent {
  id: string;
  name: string;
  icon: string;
  /** 空字符串表示使用全局默认 system prompt */
  systemPrompt: string;
}

export const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'default',
    name: '办公助手',
    icon: '🤖',
    systemPrompt: '',
  },
  {
    id: 'research',
    name: '科研助手',
    icon: '📚',
    systemPrompt:
      '你是一名科研助手，专注于文献检索、综述生成、研究方法建议。回答时注意引用来源，区分已发表成果和预印本。',
  },
  {
    id: 'writing',
    name: '写作助手',
    icon: '✍️',
    systemPrompt:
      '你是一名专业写作助手，帮助用户撰写报告、邮件、文档等。注意语言规范、逻辑清晰、格式专业。',
  },
];

export function getAgentById(id: string): Agent | undefined {
  return DEFAULT_AGENTS.find((a) => a.id === id);
}
