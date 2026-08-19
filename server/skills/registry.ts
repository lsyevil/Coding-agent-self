import { Skill, ToolDefinition, SkillContext } from './base.js';

class SkillRegistry {
  private skills = new Map<string, Skill>();

  /** 注册一个 Skill */
  register(skill: Skill): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill "${skill.name}" 已注册`);
    }
    this.skills.set(skill.name, skill);
    console.log(`[SkillRegistry] 已注册: ${skill.name} (${skill.displayName})`);
  }

  /** 获取所有已启用 Skill 的工具定义（供 Agent 使用） */
  getAllTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const skill of this.skills.values()) {
      if (!skill.enabled) continue;
      tools.push(...skill.getTools());
    }
    return tools;
  }

  /** 根据工具名找到对应 Skill 并执行 */
  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<string> {
    for (const skill of this.skills.values()) {
      if (!skill.enabled) continue;
      const tools = skill.getTools();
      if (tools.some((t) => t.function.name === toolName)) {
        return skill.execute(toolName, input, context);
      }
    }
    throw new Error(`未知工具: ${toolName}，请检查 Skill 是否已启用`);
  }

  /** 获取所有已注册 Skill 信息（供前端展示） */
  listSkills(): Array<{ name: string; displayName: string; description: string; enabled: boolean }> {
    return Array.from(this.skills.values()).map((s) => ({
      name: s.name,
      displayName: s.displayName,
      description: s.description,
      enabled: s.enabled,
    }));
  }

  /** 动态启用/禁用 Skill */
  setEnabled(name: string, enabled: boolean): void {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill "${name}" 不存在`);
    skill.enabled = enabled;
  }

  /** 读取某个 Skill 的运行时启用状态 */
  isEnabled(name: string): boolean {
    return this.skills.get(name)?.enabled ?? false;
  }
}

// 单例
export const skillRegistry = new SkillRegistry();
