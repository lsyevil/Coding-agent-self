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

import { toAccountUser } from '../presenters.js';
import { asyncHandler } from '../async-handler.js';

const router = Router();

/**
 * 取请求体里的字符串字段，trim 后返回；非字符串一律当作「没填」返回空串。
 *
 * 必须先判 typeof 再 trim，不能直接 `req.body.x.trim()`：`{ displayName: 123 }`
 * 这样的请求体会让 .trim() 抛 TypeError。asyncHandler 现在会把它兜成 500，
 * 但仍然要在这里判 —— 「传错类型」的正确答复是 400（请求本身有问题），
 * 不是 500（服务端有问题）。
 */
function trimmedField(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    // 必须判 typeof 而不是只判真假值。两个字段各有一条崩溃路径，且都过得了 `!x`：
    //  - password 传数字 → bcrypt 抛 `Illegal arguments: number, string`
    //  - username 传 true / 对象 / 数组 → better-sqlite3 绑定参数时抛 `Invalid value`
    // 这个端点在 PUBLIC_API_PATHS 里，**不需要凭证就能打**，所以这两条是
    // 任何人一条 curl 就能触发的。asyncHandler 兜底之后不再打死进程，
    // 但这里判掉才能给出正确的 400 而不是 500。
    // username 必须 trim，且必须与 /register 的处理**保持一致** —— 注册时用的是
    // trimmedField()，库里的 username 绝不会带首尾空格。登录这边不 trim 的话，
    // 手机输入法或浏览器自动填充带出来的一个尾随空格就让人永远登不进去，
    // 而看到的提示是「用户名或密码错误」—— 没有任何线索指向空格。
    const username = trimmedField(req.body?.username);
    // 口令不 trim：首尾空格是合法口令内容。
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
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

    // 已注销用户不允许登录。
    //
    // 这个检查刻意放在**密码校验之后**，且错误文案与密码错误**完全一致**：
    //  - 文案一致 → 攻击者无法通过报错内容判断某个用户名是否存在/已注销；
    //  - 放在之后 → 也不能通过响应耗时判断（跳过 bcrypt 会快一个数量级，
    //    那本身就是个可用的用户名枚举信道）。
    // 代价是被注销的本人也只看到「用户名或密码错误」，需要问管理员 —— 小团队场景可接受。
    //
    // 另外，这个拒绝**必须写在路由层**：不能下沉到 db.getUserByUsername() 里过滤，
    // 因为注册查重复用同一个函数、且必须能看见已注销用户占用的 username。详见该函数注释。
    if (user.deleted_at) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = generateToken(user);
    res.json({ token, user: toAccountUser(user) });
  })
);

// POST /api/auth/register — 仅管理员可注册新用户（小团队场景）
router.post('/register', authMiddleware, asyncHandler(async (req, res) => {
  const currentUser = (req as any).user as AuthPayload;
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可创建用户' });
  }

  // 用 trim 后的值：displayName 全是空格时必须当成没填。
  // 否则库里躺着一个显示名为空的用户，而前端两处渲染是 `displayName || username`
  // （ConversationList、AppLayout），于是登录用的用户名会被顶到界面上。
  const username = trimmedField(req.body?.username);
  const displayName = trimmedField(req.body?.displayName);
  const department = trimmedField(req.body?.department);
  // 口令**不 trim**：首尾空格是合法口令内容，trim 掉等于偷偷改了用户设的口令。
  // 但仍要判 typeof —— 非字符串传进 bcrypt 会抛，然后请求永久挂起。
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: '请填写完整信息' });
  }

  // 查重必须能看见已注销用户：username 上的 UNIQUE 约束在注销期间依然占位，
  // 若这里看不见就会绕过 409 直接撞约束，抛出 SQLITE_CONSTRAINT_UNIQUE（500 而非 409）。
  const existing = db.getUserByUsername(username);
  if (existing) {
    // 区分两种冲突：撞到已注销账号时，正确操作通常是「恢复」而不是换个用户名重建。
    // 本接口仅管理员可用，所以这里透露注销状态不构成用户名枚举风险。
    if (existing.deleted_at) {
      return res
        .status(409)
        .json({ error: `用户名已被一个已注销的账号占用（${existing.display_name}），可在用户管理中恢复该账号` });
    }
    return res.status(409).json({ error: '用户名已存在' });
  }

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const user = db.createUser({
    id: uuidv4(),
    username,
    password_hash: passwordHash,
    display_name: displayName,
    role: req.body?.role === 'admin' ? 'admin' : 'member',
    avatar: null,
    department: department || null,
    created_at: now,
    updated_at: now,
  });

  res.json({ user: toAccountUser(user) });
}));

// GET /api/auth/me — 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  const payload = (req as any).user as AuthPayload;
  const user = db.getUser(payload.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(toAccountUser(user));
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
// ?includeDeleted=1 额外包含已注销用户，仅管理员可用（用户管理页的「显示已注销」开关）。
router.get('/users', authMiddleware, (req, res) => {
  const currentUser = (req as any).user as AuthPayload;
  // 默认过滤掉已注销用户：选人器、@ 提示等场景绝不该再选中一个已注销的人。
  // 这也是为什么本接口用 toAccountUser（不加「（已注销）」后缀）不会造成误导 ——
  // 除了管理页显式要求，列表里根本不会出现已注销用户。
  const includeDeleted = req.query.includeDeleted === '1' && currentUser.role === 'admin';
  const users = db.getAllUsers(includeDeleted ? { includeDeleted: true } : undefined);
  res.json({ users: users.map(toAccountUser) });
});

// PATCH /api/auth/users/:id — 更新用户（仅 admin）
router.patch('/users/:id', authMiddleware, asyncHandler(async (req, res) => {
  const currentUser = (req as any).user as AuthPayload;
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可操作' });
  }

  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const { displayName, role, password } = req.body ?? {};
  const updates: any = {};
  if (displayName !== undefined) {
    const trimmedName = trimmedField(displayName);
    if (!trimmedName) return res.status(400).json({ error: '显示名不能为空' });
    updates.display_name = trimmedName;
  }
  if (req.body?.department !== undefined) {
    // 空串是合法输入，意思是「清空部门」；统一存成 null，前端只需判一种未填。
    updates.department = trimmedField(req.body.department) || null;
  }
  if (role !== undefined) {
    if (role !== 'admin' && role !== 'member') {
      return res.status(400).json({ error: 'role 必须是 admin 或 member' });
    }
    updates.role = role;
  }

  // 口令/显示名/部门的校验都要在 DB 写之前完成，否则部分更新已经提交，
  // 口令却因校验失败返回了 400，数据库处于半更新状态。
  if (password !== undefined && (typeof password !== 'string' || password === '')) {
    return res.status(400).json({ error: '密码必须是非空字符串' });
  }

  if (Object.keys(updates).length > 0) {
    db.updateUser(user.id, updates);
  }

  if (password) {
    const passwordHash = await hashPassword(password);
    db.updateUserPassword(user.id, passwordHash);
  }

  const updated = db.getUser(user.id);
  res.json({ user: toAccountUser(updated!) });
}));

// DELETE /api/auth/users/:id — 注销用户（仅 admin，不能删自己）
//
// 两种结果，由「名下有没有关联数据」自动决定，不需要调用方选：
//  - 0 条关联数据（误建、从没用过的账号）→ 真删除，库里不留痕迹；
//  - 有关联数据 → 注销（软删除），内容和发言归属全部保留，可在用户管理页恢复。
// 响应里的 mode 字段告诉前端实际发生了哪一种，以便提示文案对得上。
router.delete('/users/:id', authMiddleware, asyncHandler(async (req, res) => {
  const currentUser = (req as any).user as AuthPayload;
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可操作' });
  }

  if (currentUser.userId === req.params.id) {
    return res.status(400).json({ error: '不能注销自己' });
  }

  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  // 注意：Express 4 不捕获 async handler 的 rejection —— 抛错会让请求挂死不返回，
  // 而不是回 500。所以这里必须自己兜住。
  try {
    const refs = db.countUserReferences(user.id);

    if (refs.total === 0) {
      const ok = db.hardDeleteUser(user.id);
      if (!ok) return res.status(404).json({ error: '用户不存在' });
      // 用户行已经不存在了，仍要吊销 token：JWT 是自包含的，不吊销的话已签发的 token
      // 在过期前依然能通过 authMiddleware（它只验签名和黑名单，不查用户是否还在）。
      db.blacklistUserTokens(user.id);
      db.cleanupExpiredBlacklist();
      return res.json({ success: true, mode: 'hard' });
    }

    const ok = db.softDeleteUser(user.id);
    // false = 该用户本来就已注销。视为成功（幂等），否则管理页重复点一下就报错。
    if (ok) {
      // 软删除同样要吊销 token：只写 deleted_at 不会让已经登录的会话失效，
      // 被注销的人能继续用手上的 token 发消息，直到它自然过期。
      db.blacklistUserTokens(user.id);
      db.cleanupExpiredBlacklist();
    }
    res.json({ success: true, mode: 'soft', references: refs.detail });
  } catch (e: any) {
    if (e instanceof db.UserOperationError) {
      // 业务规则拒绝（例如最后一个在职管理员），照原文回给使用者。
      return res.status(400).json({ error: e.message });
    }
    console.error('[Auth] 注销用户失败:', e?.message || e);
    res.status(500).json({ error: '注销用户失败：' + (e?.message || '未知错误') });
  }
}));

// POST /api/auth/users/:id/restore — 恢复已注销用户（仅 admin）
router.post('/users/:id/restore', authMiddleware, (req, res) => {
  const currentUser = (req as any).user as AuthPayload;
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可操作' });
  }

  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  try {
    const ok = db.restoreUser(user.id);
    if (!ok) return res.status(400).json({ error: '该用户未处于注销状态' });
    // restoreUser() 内部已顺带清掉 user_deleted_ 吊销哨兵，
    // 否则恢复出来的账号连重新登录都会被 401。详见该函数注释。
    res.json({ success: true, user: toAccountUser(db.getUser(user.id)!) });
  } catch (e: any) {
    if (e instanceof db.UserOperationError) {
      return res.status(400).json({ error: e.message });
    }
    console.error('[Auth] 恢复用户失败:', e?.message || e);
    res.status(500).json({ error: '恢复用户失败：' + (e?.message || '未知错误') });
  }
});

export default router;
