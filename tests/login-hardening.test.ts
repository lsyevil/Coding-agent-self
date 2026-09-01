/**
 * 登录端点的入参类型守卫。
 *
 * 背景（2026-08-31 实测复现的 P0）：`POST /api/auth/login` 是公开端点，不需要任何凭证。
 * 原实现只判 `!password`，于是 `{"password": 12345}` 这种请求体过得了校验，
 * 进到 bcrypt 里抛 `Illegal arguments: number, string`；Express 4 不接管 async handler
 * 的 reject，而 Node ≥15 默认 `--unhandled-rejections=throw` —— **整个服务进程退出**。
 * 一条 curl 就能让全公司登不进来，且需要人工重启。
 *
 * 【这个文件能证明什么、不能证明什么】
 *
 * 能证明：类型不对时答 400，正常路径不回归。
 *
 * **不能证明**「服务不会被打死」。原因是这里跑的是 in-process 的 express 实例，只挂了
 * authRouter，没有 index.ts 里的错误中间件和进程级兜底；而且 vitest 自己注册了
 * unhandledRejection 处理器，会把**进程崩溃**吞成「请求挂起」。
 *
 * 这不是假设 —— PR C 就是在这里翻的车：当时用 vitest 观察到「请求永久挂起」，据此把
 * 缺陷记录成体验问题，而真实进程是直接崩。**in-process 测试对这个失效模式天生盲。**
 *
 * 所以三层防护（typeof 守卫 / asyncHandler / 进程兜底）各自是否真的承重，只由
 * `tests/crash-check.mjs` 验证 —— 它 spawn 真实进程，逐层摘掉再看服务死不死。
 * 跑 `npm run test:crash`。只跑 `npm test` **不足以**守住这个 P0。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import type { Server } from 'node:http';
import * as db from '../server/db.js';
import rawDb from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import authRouter from '../server/routes/auth.js';

const PREFIX = 'test-login-';

function makeUser() {
  const now = new Date().toISOString();
  const id = `${PREFIX}${uuidv4()}`;
  db.createUser({
    id,
    username: id,
    // 非法 bcrypt hash：compare 恒返回 false 且不抛错，所以这个账号登不进来，
    // 正好用来测「口令错」这条正常路径。
    password_hash: '!not-a-valid-hash',
    display_name: '登录测试用户',
    role: 'member',
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

// 兜底清扫：用例超时或在 try 之前抛错时 finally 不会执行，而这套测试跑在**真实开发库**上
// （db.ts 把路径硬编码为 data/chat.db，没有注入点），漏下的账号会出现在开发环境的用户列表里。
afterAll(() => {
  const rows = rawDb
    .prepare(`SELECT id FROM users WHERE username LIKE '${PREFIX}%'`)
    .all() as Array<{ id: string }>;
  for (const r of rows) purge(r.id);
  if (rows.length > 0) console.log(`[test] 兜底清掉了 ${rows.length} 个残留的测试账号`);
});

describe('POST /api/auth/login 入参类型守卫', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  let server: Server;
  let base = '';

  async function ready() {
    if (!base) {
      server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    }
    return base;
  }

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  async function login(body: unknown) {
    const b = await ready();
    const res = await fetch(`${b}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res;
  }

  // 这几个用例都带显式超时：守卫被摘掉时的表现之一就是响应永不返回，
  // 没有超时的话用例会一直吊着而不是变红。
  it(
    'password 传数字时答 400，不进 bcrypt',
    async () => {
      const res = await login({ username: 'admin', password: 12345 });
      expect(res.status).toBe(400);
    },
    5000
  );

  it(
    'username 传布尔值时答 400，不进 SQL 绑定',
    async () => {
      // better-sqlite3 绑定 true / 对象 / 数组会抛 `Invalid value`，
      // 而 `!true` 为 false，光判真假值挡不住。
      const res = await login({ username: true, password: 'whatever' });
      expect(res.status).toBe(400);
    },
    5000
  );

  it(
    'username 传对象时答 400',
    async () => {
      const res = await login({ username: { $ne: null }, password: 'whatever' });
      expect(res.status).toBe(400);
    },
    5000
  );

  it('空请求体答 400', async () => {
    expect((await login({})).status).toBe(400);
  });

  it('username 全空格视为没填，答 400', async () => {
    expect((await login({ username: '   ', password: 'x' })).status).toBe(400);
  });

  it('username 首尾空格被 trim 掉，仍能登录成功', async () => {
    // /register 用 trimmedField 存 username，库里绝不会有带空格的用户名。
    // 登录这边若不 trim，手机输入法/自动填充带出来的一个尾随空格就让人永远登不进去，
    // 而提示是「用户名或密码错误」，没有任何线索指向空格。
    //
    // 注意「用户不存在」和「口令错」在设计上返回完全一样的 401（防用户名枚举），
    // 所以要证明 trim 生效，只能造一个口令哈希真实可比对的账号，断言能拿到 200。
    const now = new Date().toISOString();
    const id = `${PREFIX}${uuidv4()}`;
    db.createUser({
      id,
      username: id,
      password_hash: await hashPassword('correct-horse'),
      display_name: '空格测试用户',
      role: 'member',
      created_at: now,
      updated_at: now,
    });
    try {
      const res = await login({ username: `  ${id}  `, password: 'correct-horse' });
      expect(res.status).toBe(200);
    } finally {
      purge(id);
    }
  });

  it('口令不被 trim：全空格是合法口令，应走到校验而非 400', async () => {
    // 首尾空格是合法口令内容，trim 掉等于偷偷改了用户设的口令。
    // 全空格的口令要一路走到 bcrypt 比对，结果是 401（口令错），不是 400（没填）。
    const userId = makeUser();
    try {
      const res = await login({ username: userId, password: '   ' });
      expect(res.status).toBe(401);
    } finally {
      purge(userId);
    }
  });

  it('用户不存在答 401', async () => {
    expect((await login({ username: `${PREFIX}nope`, password: 'x' })).status).toBe(401);
  });

  it('口令错答 401（正常路径不回归）', async () => {
    const userId = makeUser();
    try {
      const res = await login({ username: userId, password: 'wrong-password' });
      expect(res.status).toBe(401);
    } finally {
      purge(userId);
    }
  });
});
