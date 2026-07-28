import { useState, useEffect, useCallback } from 'react';
import { CustomAgent } from '../types';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'customAgents';

// 预设 Agent（不可删除，始终置顶）
const PRESET_AGENTS: CustomAgent[] = [
  {
    id: 'default',
    name: '专业编码助手',
    description: '全栈工程师，自动读写文件、运行测试与构建，交付可验证的代码',
    systemPrompt: [
      '你是一名资深全栈软件工程师（Senior Software Engineer），正在帮助用户于服务器环境中完成专业级编程任务。',
      '',
      '核心准则：',
      '1. 动手前先阅读代码库：理解目录结构、构建方式、测试命令与既有约定（参考 README、CLAUDE.md、eslint/prettier 配置与现有代码风格）。',
      '2. 改动最小化且可维护：优先复用现有抽象，遵循项目语言/框架最佳实践。',
      '3. 主动使用工具而非只给建议：读写文件、搜索、运行测试与构建来验证你的改动。',
      '4. 验证优先：每次改动后运行相关测试 / 构建 / lint，确保不破坏现有功能；无法运行时明确说明原因。',
      '5. 简洁务实：解释关键决策，避免客套与冗余说明。',
      '6. 不确定就查证：遇到过时或陌生的 API，先查文档或代码核实，不要臆测。',
      '',
      '目标：交付可运行、可维护、经过验证的代码。',
    ].join('\n'),
    icon: 'Code',
    color: '#0052d9',
    permissionMode: 'acceptEdits',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'reviewer',
    name: '代码审查员',
    description: '对代码变更做专业评审：正确性、安全性、可维护性与性能',
    systemPrompt: [
      '你是一名严格的代码审查专家（Code Reviewer）。请对给定的代码变更进行专业评审。',
      '',
      '评审维度：',
      '1. 正确性：逻辑错误、边界情况、并发或空值问题。',
      '2. 安全性：注入、越权、敏感信息泄露、不安全依赖等风险。',
      '3. 可维护性：命名、结构、重复代码、复杂度、测试覆盖。',
      '4. 性能：不必要的开销、N+1、内存与资源泄漏。',
      '5. 约定：是否符合项目既有风格与最佳实践。',
      '',
      '请按「严重 / 建议 / 可选」三级给出结论，并附上具体文件与行号、原因与修改示例。结论前先给出总体评价（可合并 / 需修改 / 阻塞）。',
    ].join('\n'),
    icon: 'SearchCode',
    color: '#0594fa',
    permissionMode: 'default',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'architect',
    name: '系统架构师',
    description: '只读模式下的技术方案设计与架构决策，提供多方案权衡',
    systemPrompt: [
      '你是一名系统架构师（Solutions Architect），负责在只读模式下帮助用户做技术方案设计与架构决策。',
      '',
      '工作方式：',
      '1. 先理解业务目标、约束（性能、成本、团队、合规）与现有系统。',
      '2. 调研代码库与相关文档，给出基于事实的分析，不要臆测。',
      '3. 提供多种可选方案，对比权衡（复杂度、扩展性、可维护性、落地成本）。',
      '4. 给出推荐的架构图、模块边界、关键接口与里程碑计划。',
      '5. 你处于 plan 模式，只做分析与建议，不修改任何文件。',
    ].join('\n'),
    icon: 'Network',
    color: '#7c3aed',
    permissionMode: 'plan',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const PRESET_IDS = new Set(PRESET_AGENTS.map(a => a.id));

export function useAgents() {
  const [agents, setAgents] = useState<CustomAgent[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const userAgents = parsed.map((a: any) => ({
          ...a,
          createdAt: new Date(a.createdAt),
          updatedAt: new Date(a.updatedAt),
        }));
        return [...PRESET_AGENTS, ...userAgents];
      }
    } catch (e) {
      console.error('Failed to load agents:', e);
    }
    return [...PRESET_AGENTS];
  });

  // 保存到 localStorage（排除预设 agent）
  const saveAgents = useCallback((newAgents: CustomAgent[]) => {
    const toSave = newAgents.filter(a => !PRESET_IDS.has(a.id));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }, []);

  const addAgent = useCallback((agent: Omit<CustomAgent, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newAgent: CustomAgent = {
      ...agent,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setAgents(prev => {
      const updated = [...prev, newAgent];
      saveAgents(updated);
      return updated;
    });
    return newAgent;
  }, [saveAgents]);

  const updateAgent = useCallback((id: string, updates: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>) => {
    setAgents(prev => {
      const updated = prev.map(a =>
        a.id === id ? { ...a, ...updates, updatedAt: new Date() } : a
      );
      saveAgents(updated);
      return updated;
    });
  }, [saveAgents]);

  const deleteAgent = useCallback((id: string) => {
    if (PRESET_IDS.has(id)) return; // 预设 agent 不可删除
    setAgents(prev => {
      const updated = prev.filter(a => a.id !== id);
      saveAgents(updated);
      return updated;
    });
  }, [saveAgents]);

  const getAgent = useCallback((id: string) => {
    return agents.find(a => a.id === id);
  }, [agents]);

  return {
    agents,
    addAgent,
    updateAgent,
    deleteAgent,
    getAgent,
    defaultAgent: PRESET_AGENTS[0],
  };
}
