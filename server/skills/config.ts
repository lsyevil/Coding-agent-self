/**
 * Skill 配置 — 控制各 Skill 的启用状态与专属配置
 *
 * 注意：仅当对应 Skill 已注册（registerBuiltinSkills）时，enabled 才会生效。
 * 各 Phase 实现对应 Skill 后，此处即为开关。
 */
export interface AppConfig {
  skills: {
    [skillName: string]: {
      enabled: boolean;
      config?: Record<string, unknown>;
    };
  };
}

export const defaultConfig: AppConfig = {
  skills: {
    coding: { enabled: false },
    todo: { enabled: true },
    calendar: { enabled: true },
    literature: {
      enabled: true,
      config: {
        sources: {
          'google-scholar': { enabled: true },
          arxiv: { enabled: true },
          pubmed: { enabled: false },
          cnki: { enabled: false },
        },
      },
    },
    'web-search': { enabled: true },
  },
};

/** 从环境变量覆盖（可选） */
export function loadConfig(): AppConfig {
  return defaultConfig;
}
