/**
 * Skill 插件架构 — 核心接口定义
 *
 * 每个功能模块（代码操作、待办、日程、文献、搜索…）实现 Skill 接口，
 * 向 Agent 提供一组 OpenAI function calling 格式的工具，并负责执行。
 */

/** Skill 执行时可访问的公共能力 */
export interface SkillContext {
  /** 工作目录 */
  workingDir: string;
  /** 当前用户 ID */
  userId: string;
  /** SSE 事件推送（可选，供需要流式输出的 Skill 使用） */
  emit?: (obj: Record<string, unknown>) => void;
}

/** 工具定义 — OpenAI function calling 格式 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/** Skill 接口 */
export interface Skill {
  /** Skill 唯一标识 */
  name: string;
  /** 显示名称 */
  displayName: string;
  /** 描述 */
  description: string;
  /** 是否启用（从配置读取） */
  enabled: boolean;
  /** 返回该 Skill 提供的所有工具定义 */
  getTools(): ToolDefinition[];
  /** 执行工具，返回结果文本 */
  execute(
    toolName: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<string>;
}
