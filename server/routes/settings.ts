import { Router } from 'express';
import { authMiddleware, AuthPayload } from '../auth.js';
import { skillRegistry } from '../skills/index.js';

const router = Router();

// GET /api/settings/skills — 获取 Skill 列表
router.get('/skills', authMiddleware, (req, res) => {
  const skills = skillRegistry.listSkills();
  res.json({ skills });
});

// PATCH /api/settings/skills/:name — 启用/禁用 Skill（仅 admin）
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

export default router;
