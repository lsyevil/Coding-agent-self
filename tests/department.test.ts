/**
 * 用户部门字段（同名消歧）的守卫。
 *
 * 部门本身很简单（一个可空 TEXT 列），真正需要测的是它顺带引入的三类风险：
 *
 *  1. **空白值归一**：部门有「未填」这个合法状态，若空串和 NULL 两种表示同时存在，
 *     去重出来的候选列表里就会冒出一个空选项，前端判空也要写两遍。
 *  2. **显示名不能为空**（本 PR 一并堵上）：显示名允许全空格的话，库里会躺着一个
 *     显示名为空的用户，而前端有两处是 `displayName || username`
 *     （ConversationList、AppLayout），于是登录用的用户名被顶到界面上。
 *  3. **请求永久挂起**：为了 trim 而新增的 .trim() 调用遇到非字符串会抛 TypeError，
 *     而 Express 4 **不接管 async handler 的 reject** —— 结果不是 500，是这个请求
 *     再也不返回。下面有两个用例专门带超时地打非字符串请求体。
 *
 * 【隔离】同 soft-delete.test.ts：db.ts 把库路径硬编码为 data/chat.db，没有注入点，
 * 所以直接跑在开发库上，每个用例必须靠 finally 把自己造的数据清干净。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import type { Server } from 'node:http';
import * as db from '../server/db.js';
import rawDb from '../server/db.js';
import { generateToken } from '../server/auth.js';
import { toPublicUser, toAccountUser } from '../server/presenters.js';
import authRouter from '../server/routes/auth.js';

/** 本文件造出来的账号一律用这个 username 前缀，兜底清扫靠它识别。 */
const PREFIX = 'test-dept-';

function makeUser(opts?: { role?: 'admin' | 'member'; department?: string | null }) {
  const now = new Date().toISOString();
  const id = `${PREFIX}${uuidv4()}`;
  db.createUser({
    id,
    username: id,
    // 非法 bcrypt hash：这些账号绝对登不进来
    password_hash: '!not-a-valid-hash',
    display_name: '测试用户',
    role: opts?.role ?? 'member',
    department: opts?.department,
    created_at: now,
    updated_at: now,
  });
  return id;
}

function purge(userId: string) {
  db.restoreUser(userId);
  try {
    db.hardDeleteUser(userId);
  } catch {
    /* 有引用就由用例自己清 */
  }
}

/**
 * 兜底清扫：按 username 前缀扫掉本文件造出来的所有账号。
 *
 * 每个用例自己的 finally 不够用，这是踩过的坑：
 *  - 走 HTTP 注册出来的用户 **id 是服务端生成的 uuid**，只有 username 带前缀，
 *    按 id 前缀清扫扫不到；
 *  - 用例超时（那两个「不能永久挂起」的用例在守卫被摘掉时正是这个表现）或者在进
 *    try 之前就抛，finally 根本不执行。
 * 而这套测试跑在**真实开发库**上（db.ts 硬编码 data/chat.db），漏下来的账号会直接
 * 出现在开发环境的用户列表和选人器里 —— 曾经一轮变异验证就漏了 10 个显示名为空的账号。
 */
function sweepTestUsers(): number {
  const rows = rawDb
    .prepare(`SELECT id FROM users WHERE username LIKE '${PREFIX}%'`)
    .all() as Array<{ id: string }>;
  for (const r of rows) purge(r.id);
  return rows.length;
}

// 模块级兜底：无论上面哪个用例是怎么挂的，这里都要把开发库擦干净。
afterAll(() => {
  const n = sweepTestUsers();
  if (n > 0) console.log(`[test] 兜底清掉了 ${n} 个残留的测试账号`);
});

describe('department 列与写入归一', () => {
  it('迁移后 users 表确实有 department 列', () => {
    const cols = rawDb.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('department');
  });

  it('createUser 把空串和纯空格的部门都归一成 null', () => {
    const blank = makeUser({ department: '' });
    const spaces = makeUser({ department: '   ' });
    const omitted = makeUser();
    try {
      // 三种「没填」必须落到同一个值，否则去重出来的候选列表会多出空选项
      expect(db.getUser(blank)!.department).toBeNull();
      expect(db.getUser(spaces)!.department).toBeNull();
      expect(db.getUser(omitted)!.department).toBeNull();
    } finally {
      [blank, spaces, omitted].forEach(purge);
    }
  });

  it('createUser 保留部门原值并 trim 掉首尾空格', () => {
    const userId = makeUser({ department: '  技术部  ' });
    try {
      expect(db.getUser(userId)!.department).toBe('技术部');
    } finally {
      purge(userId);
    }
  });
});

describe('表示层的部门字段', () => {
  it('账号面带 department，内容面刻意不带', () => {
    const userId = makeUser({ department: '技术部' });
    try {
      const user = db.getUser(userId)!;
      expect(toAccountUser(user).department).toBe('技术部');
      // 内容面（会话成员、任务指派人等）目前没有渲染点用得上部门，
      // 这条断言防止有人「顺手加上」给 8 个接口各塞一个没人读的字段。
      expect('department' in toPublicUser(user)).toBe(false);
    } finally {
      purge(userId);
    }
  });

  it('账号面把空串部门也报成 null', () => {
    const userId = makeUser();
    try {
      // 刻意绕过 createUser 直接写空串：正常写入路径（createUser、PATCH 路由）都会
      // 把空串归一成 NULL，所以这个空串只可能来自加这一列之前的历史数据或直连写库。
      // toAccountUser 里的 `|| null` 就是为这种行准备的兜底，这里显式把它测到。
      rawDb.prepare("UPDATE users SET department = '' WHERE id = ?").run(userId);
      expect(db.getUser(userId)!.department).toBe('');
      expect(toAccountUser(db.getUser(userId)!).department).toBeNull();
    } finally {
      purge(userId);
    }
  });
});

describe('注册与修改接口的部门与显示名校验', () => {
  let server: Server;
  let base = '';
  let adminId = '';
  let token = '';

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  async function ready() {
    if (!base) {
      server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    }
    if (!adminId) {
      // 自建一个临时管理员发 token：这些接口都要求 admin，而借用开发库里的真实
      // 管理员会让用例依赖那一行的状态（比如它正好被别的用例注销了）。
      adminId = makeUser({ role: 'admin' });
      token = generateToken({ id: adminId, username: adminId, role: 'admin' });
    }
    return base;
  }

  afterAll(async () => {
    if (adminId) purge(adminId);
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  async function req(method: string, path: string, body?: unknown) {
    const b = await ready();
    const res = await fetch(`${b}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: (text ? JSON.parse(text) : {}) as { error?: string; user?: any },
    };
  }

  function newAccount(extra: Record<string, unknown> = {}) {
    const username = `${PREFIX}http-${uuidv4()}`;
    return {
      username,
      password: 'irrelevant-but-non-empty',
      displayName: '张三',
      ...extra,
    };
  }

  it('注册时部门被 trim，未填则存 null', async () => {
    const a = newAccount({ department: '  技术部  ' });
    const b = newAccount(); // 完全不带 department 字段
    // 注册调用本身也要在 try 里：它自己就可能抛（守卫被摘掉时请求会挂到超时），
    // 而那时账号可能已经建出来了，写在 try 外面的话 finally 清不到。
    let ids: string[] = [];
    try {
      const ra = await req('POST', '/api/auth/register', a);
      const rb = await req('POST', '/api/auth/register', b);
      ids = [ra.body.user?.id, rb.body.user?.id].filter(Boolean);
      expect(ra.status).toBe(200);
      expect(ra.body.user.department).toBe('技术部');
      expect(rb.status).toBe(200);
      expect(rb.body.user.department).toBeNull();
    } finally {
      ids.forEach(purge);
    }
  });

  it('注册时全是空格的显示名被拒绝（否则界面会回落到显示用户名）', async () => {
    const payload = newAccount({ displayName: '   ' });
    const res = await req('POST', '/api/auth/register', payload);
    expect(res.status).toBe(400);
    // 拿 username 反查，确认这个账号真的没被建出来
    expect(db.getUserByUsername(payload.username)).toBeUndefined();
  });

  it(
    '注册时非字符串的显示名返回 400，而不是让请求永久挂起',
    async () => {
      // 这是 Express 4 那个坑的回归测试：`(123).trim()` 抛 TypeError，
      // 而 async handler 的 reject 没人接管 —— 那样这个 fetch 会一直等到超时。
      const res = await req('POST', '/api/auth/register', newAccount({ displayName: 123 }));
      expect(res.status).toBe(400);
    },
    5000
  );

  it(
    '注册时非字符串的密码返回 400，而不是让请求永久挂起',
    async () => {
      // 非字符串进 bcrypt 同样会抛，同样会挂起
      const res = await req('POST', '/api/auth/register', newAccount({ password: { a: 1 } }));
      expect(res.status).toBe(400);
    },
    5000
  );

  it('PATCH 传空串部门表示清空', async () => {
    const userId = makeUser({ department: '技术部' });
    try {
      const res = await req('PATCH', `/api/auth/users/${userId}`, { department: '' });
      expect(res.status).toBe(200);
      expect(res.body.user.department).toBeNull();
      expect(db.getUser(userId)!.department).toBeNull();
    } finally {
      purge(userId);
    }
  });

  it('PATCH 不传 department 时不动原值', async () => {
    const userId = makeUser({ department: '技术部' });
    try {
      const res = await req('PATCH', `/api/auth/users/${userId}`, { displayName: '李四' });
      expect(res.status).toBe(200);
      expect(res.body.user.department).toBe('技术部');
      expect(db.getUser(userId)!.display_name).toBe('李四');
    } finally {
      purge(userId);
    }
  });

  it('PATCH 的显示名全是空格被拒绝，且原值不变', async () => {
    const userId = makeUser();
    try {
      const res = await req('PATCH', `/api/auth/users/${userId}`, { displayName: '  ' });
      expect(res.status).toBe(400);
      expect(db.getUser(userId)!.display_name).toBe('测试用户');
    } finally {
      purge(userId);
    }
  });

  it(
    'PATCH 的非法密码被拒绝时，同一请求里的其他字段也不能已经写进去',
    async () => {
      // 校验必须全部跑在 DB 写之前。否则 displayName 已经改了、密码校验才失败返回 400，
      // 调用方看到的是「失败」，库里却是半更新的状态。
      const userId = makeUser({ department: '技术部' });
      try {
        const res = await req('PATCH', `/api/auth/users/${userId}`, {
          displayName: '王五',
          department: '市场部',
          password: 12345,
        });
        expect(res.status).toBe(400);
        const after = db.getUser(userId)!;
        expect(after.display_name).toBe('测试用户');
        expect(after.department).toBe('技术部');
      } finally {
        purge(userId);
      }
    },
    5000
  );
});
