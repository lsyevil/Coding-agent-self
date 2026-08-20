import { skillRegistry } from './registry.js';
import { loadConfig } from './config.js';
import { codingSkill } from './coding/index.js';
import { todoSkill } from './todo/index.js';
import { calendarSkill } from './calendar/index.js';

/**
 * 注册所有内置 Skill，并按配置设置启用状态。
 * 在 server 启动时调用一次。
 */
export function registerBuiltinSkills(): void {
  // 注册内置 Skill（各 Phase 实现的 Skill 在此登记）
  skillRegistry.register(codingSkill);
  skillRegistry.register(todoSkill);
  skillRegistry.register(calendarSkill);

  // 应用配置中的启用/禁用状态（仅对已注册的 Skill 生效）
  const config = loadConfig();
  for (const [name, setting] of Object.entries(config.skills)) {
    if (skillRegistry.isEnabled(name) || skillRegistry.listSkills().some((s) => s.name === name)) {
      try {
        skillRegistry.setEnabled(name, setting.enabled);
      } catch {
        // Skill 尚未实现/注册，跳过
      }
    }
  }

  console.log(
    '[SkillRegistry] 已加载 Skill:',
    skillRegistry.listSkills().map((s) => `${s.name}${s.enabled ? '' : '(off)'}`).join(', ')
  );
}

export { skillRegistry } from './registry.js';
export * from './base.js';
