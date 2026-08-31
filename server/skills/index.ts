import { skillRegistry } from './registry.js';
import { loadConfig } from './config.js';
import * as db from '../db.js';
import { codingSkill } from './coding/index.js';
import { todoSkill } from './todo/index.js';
import { calendarSkill } from './calendar/index.js';
import { literatureSkill } from './literature/index.js';

/**
 * 注册所有内置 Skill，并按配置设置启用状态。
 * 在 server 启动时调用一次。
 */
export function registerBuiltinSkills(): void {
  // 注册内置 Skill（各 Phase 实现的 Skill 在此登记）
  skillRegistry.register(codingSkill);
  skillRegistry.register(todoSkill);
  skillRegistry.register(calendarSkill);
  skillRegistry.register(literatureSkill);

  // 先把库里持久化的状态读出来，再做任何写入 ——
  // 否则下面应用静态配置时会先把它覆盖掉。
  let persisted: Record<string, { enabled?: boolean }> = {};
  try {
    const saved = db.getSystemConfig('skill_registry');
    if (saved) persisted = JSON.parse(saved);
  } catch (e: any) {
    console.warn('[SkillRegistry] 读取持久化启用状态失败，回退到静态配置:', e?.message || e);
  }

  // 静态配置为底（仅对已注册的 Skill 生效）
  const config = loadConfig();
  for (const [name, setting] of Object.entries(config.skills)) {
    if (skillRegistry.has(name)) {
      skillRegistry.applyEnabled(name, setting.enabled);
    }
  }

  // 管理员在 UI 上改过的以库为准，覆盖静态默认
  for (const [name, setting] of Object.entries(persisted)) {
    if (skillRegistry.has(name) && typeof setting?.enabled === 'boolean') {
      skillRegistry.applyEnabled(name, setting.enabled);
    }
  }

  console.log(
    '[SkillRegistry] 已加载 Skill:',
    skillRegistry.listSkills().map((s) => `${s.name}${s.enabled ? '' : '(off)'}`).join(', ')
  );
}

export { skillRegistry } from './registry.js';
export * from './base.js';
