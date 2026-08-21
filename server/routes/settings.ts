import { Router } from 'express';
import { authMiddleware, AuthPayload } from '../auth.js';
import { skillRegistry } from '../skills/index.js';
import * as db from '../db.js';

const router = Router();

// GET /api/settings/skills
router.get('/skills', authMiddleware, (req, res) => {
  const skills = skillRegistry.listSkills();
  res.json({ skills });
});

// PATCH /api/settings/skills/:name
router.patch('/skills/:name', authMiddleware, (req, res) => {
  const user = (req as any).user as AuthPayload;
  if (user.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可修改 Skill 配置' });
  }
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled 必须是布尔值' });
  }
  try {
    skillRegistry.setEnabled(req.params.name, enabled);
    res.json({ success: true });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

// GET /api/settings/available-models
router.get('/available-models', authMiddleware, (req, res) => {
  const user = (req as any).user as AuthPayload;
  const model = process.env.OPENAI_MODEL || '';
  const extra = (process.env.OPENAI_MODELS || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  const allModels = model ? [model, ...extra.filter((m: string) => m !== model)] : extra;

  if (user.role === 'admin') {
    return res.json({ models: allModels.map((m: string) => ({ modelId: m, name: m })) });
  }

  const config = db.getSystemConfig('member_models');
  if (config) {
    try {
      const allowed = JSON.parse(config);
      return res.json({ models: allModels.filter((m: string) => allowed.includes(m)).map((m: string) => ({ modelId: m, name: m })) });
    } catch { /* corrupted data, fall through to all models */ }
  }

  res.json({ models: allModels.map((m: string) => ({ modelId: m, name: m })) });
});

// GET /api/settings/available-agents
router.get('/available-agents', authMiddleware, (req, res) => {
  const user = (req as any).user as AuthPayload;
  const allAgents = [
    { id: 'default', name: '办公助手', icon: '🤖' },
    { id: 'research', name: '科研助手', icon: '📚' },
    { id: 'writing', name: '写作助手', icon: '✍️' },
  ];

  if (user.role === 'admin') {
    return res.json({ agents: allAgents });
  }

  const config = db.getSystemConfig('member_agents');
  if (config) {
    try {
      const allowed = JSON.parse(config);
      return res.json({ agents: allAgents.filter(a => allowed.includes(a.id)) });
    } catch { /* corrupted data, fall through to all agents */ }
  }

  res.json({ agents: allAgents });
});

// PATCH /api/settings/member-models
router.patch('/member-models', authMiddleware, (req, res) => {
  const user = (req as any).user as AuthPayload;
  if (user.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });
  const { models } = req.body;
  if (!Array.isArray(models)) return res.status(400).json({ error: 'models 必须是数组' });
  db.setSystemConfig('member_models', JSON.stringify(models));
  res.json({ success: true });
});

// PATCH /api/settings/member-agents
router.patch('/member-agents', authMiddleware, (req, res) => {
  const user = (req as any).user as AuthPayload;
  if (user.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });
  const { agents } = req.body;
  if (!Array.isArray(agents)) return res.status(400).json({ error: 'agents 必须是数组' });
  db.setSystemConfig('member_agents', JSON.stringify(agents));
  res.json({ success: true });
});

// GET /api/settings/member-models
router.get('/member-models', authMiddleware, (req, res) => {
  const user = (req as any).user as AuthPayload;
  if (user.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });
  const config = db.getSystemConfig('member_models');
  try {
    res.json({ models: config ? JSON.parse(config) : null });
  } catch {
    res.json({ models: null });
  }
});

// GET /api/settings/member-agents
router.get('/member-agents', authMiddleware, (req, res) => {
  const user = (req as any).user as AuthPayload;
  if (user.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });
  const config = db.getSystemConfig('member_agents');
  try {
    res.json({ agents: config ? JSON.parse(config) : null });
  } catch {
    res.json({ agents: null });
  }
});

export default router;
