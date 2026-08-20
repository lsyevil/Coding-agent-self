import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db.js';
import {
  generateToken,
  verifyPassword,
  hashPassword,
  authMiddleware,
  AuthPayload,
} from '../auth.js';

const router = Router();

function toSafeUser(u: db.DbUser) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    avatar: u.avatar,
  };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }

  const user = db.getUserByUsername(username);
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = generateToken(user);
  res.json({ token, user: toSafeUser(user) });
});

// POST /api/auth/register — 仅管理员可注册新用户（小团队场景）
router.post('/register', authMiddleware, async (req, res) => {
  const currentUser = (req as any).user as AuthPayload;
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可创建用户' });
  }

  const { username, password, displayName, role } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: '请填写完整信息' });
  }

  const existing = db.getUserByUsername(username);
  if (existing) {
    return res.status(409).json({ error: '用户名已存在' });
  }

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const user = db.createUser({
    id: uuidv4(),
    username,
    password_hash: passwordHash,
    display_name: displayName,
    role: role === 'admin' ? 'admin' : 'member',
    avatar: null,
    created_at: now,
    updated_at: now,
  });

  res.json({ user: toSafeUser(user) });
});

// GET /api/auth/me — 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  const payload = (req as any).user as AuthPayload;
  const user = db.getUser(payload.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(toSafeUser(user));
});

// POST /api/auth/refresh — 刷新 token
router.post('/refresh', authMiddleware, (req, res) => {
  const payload = (req as any).user as AuthPayload;
  const token = generateToken({
    id: payload.userId,
    username: payload.username,
    role: payload.role,
  });
  res.json({ token });
});

// GET /api/auth/users — 获取所有用户列表（用于 IM 选人等）
router.get('/users', authMiddleware, (req, res) => {
  const users = db.getAllUsers();
  res.json({ users: users.map(toSafeUser) });
});

// PATCH /api/auth/users/:id — 更新用户（仅 admin）
router.patch('/users/:id', authMiddleware, async (req, res) => {
  const currentUser = (req as any).user as AuthPayload;
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可操作' });
  }

  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const { displayName, role, password } = req.body;
  const updates: any = {};
  if (displayName !== undefined) updates.display_name = displayName;
  if (role !== undefined) updates.role = role === 'admin' ? 'admin' : 'member';

  if (Object.keys(updates).length > 0) {
    db.updateUser(user.id, updates);
  }

  if (password) {
    const passwordHash = await hashPassword(password);
    db.updateUserPassword(user.id, passwordHash);
  }

  const updated = db.getUser(user.id);
  res.json({ user: toSafeUser(updated!) });
});

// DELETE /api/auth/users/:id — 删除用户（仅 admin，不能删自己）
router.delete('/users/:id', authMiddleware, async (req, res) => {
  const currentUser = (req as any).user as AuthPayload;
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可操作' });
  }

  if (currentUser.userId === req.params.id) {
    return res.status(400).json({ error: '不能删除自己' });
  }

  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  db.deleteUser(user.id);
  res.json({ success: true });
});

export default router;
