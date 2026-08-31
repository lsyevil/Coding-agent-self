import { Skill, ToolDefinition, SkillContext } from './base.js';
import * as db from '../db.js';

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

  /** 某个 Skill 是否已注册（skills 是私有的，外部用这个判断） */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * 仅修改内存中的启用状态，不落库。
   * 供启动时应用「静态默认配置 + 库中持久化状态」使用 —— 启动阶段若走 setEnabled，
   * 会在读取持久化状态之前先把它覆盖掉。
   */
  applyEnabled(name: string, enabled: boolean): void {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill "${name}" 不存在`);
    skill.enabled = enabled;
  }

  /** 动态启用/禁用 Skill，并落库（重启后保持）。供管理端 API 使用。 */
  setEnabled(name: string, enabled: boolean): void {
    this.applyEnabled(name, enabled);
    try {
      db.setSystemConfig('skill_registry', JSON.stringify(this.dumpConfig()));
    } catch (e: any) {
      console.warn('[SkillRegistry] 启用状态落库失败:', e?.message || e);
    }
  }

  /** 导出当前各 Skill 的启用状态（用于落库） */
  dumpConfig(): Record<string, { enabled: boolean }> {
    const config: Record<string, { enabled: boolean }> = {};
    for (const [name, skill] of this.skills) {
      config[name] = { enabled: skill.enabled };
    }
    return config;
  }

  /** 读取某个 Skill 的运行时启用状态 */
  isEnabled(name: string): boolean {
    return this.skills.get(name)?.enabled ?? false;
  }
}

// 单例
export const skillRegistry = new SkillRegistry();
