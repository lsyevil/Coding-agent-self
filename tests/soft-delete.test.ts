/**
 * 用户注销（软删除）的完整链路守卫。
 *
 * 替换了原先的 delete-user.test.ts —— 那份测试断言的是「删除用户 + 把内容归属改判给
 * 占位账号」，而这套行为已经被移除：改判会用 UPDATE 覆盖掉原始 created_by / added_by，
 * 原始归属**没有任何地方留有副本**，等于不可逆地销毁了「这条消息是谁发的」。
 * 现在的做法是保留用户行、只写 deleted_at，整类外键问题随之消失。
 *
 * 【已知前提】better-sqlite3 与 sqlite3 CLI 相反，开连接时默认 foreign_keys = 1，
 * 所以外键一直在生效 —— 这正是硬删必须先确认 0 引用的原因。
 *
 * 【隔离】db.ts 在模块加载时把路径硬编码为 data/chat.db，没有注入点，所以本测试直接
 * 跑在开发库上，靠 finally 自行清理。彻底隔离需要 db.ts 支持 DB_PATH 环境变量，
 * 那是独立一项、尚未做 —— 因此每个用例都必须保证 finally 能把自己造的数据删干净。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import type { Server } from 'node:http';
import * as db from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { toPublicUser, toAccountUser, displayNameOf, DELETED_SUFFIX } from '../server/presenters.js';
import authRouter from '../server/routes/auth.js';

function makeUser(opts?: { role?: 'admin' | 'member'; displayName?: string; passwordHash?: string }) {
  const now = new Date().toISOString();
  const id = `test-user-${uuidv4()}`;
  db.createUser({
    id,
    username: id,
    // 默认给一个**非法** bcrypt hash，保证这类测试用户绝对登不进来。
    // 需要测真实登录的用例必须显式传入 passwordHash —— 见登录那组的注释。
    password_hash: opts?.passwordHash ?? '!not-a-valid-hash',
    display_name: opts?.displayName ?? '测试用户',
    role: opts?.role ?? 'member',
    created_at: now,
    updated_at: now,
  });
  return id;
}

/** 无论用户当前是注销还是在职，都彻底清掉，供 finally 使用。 */
function purge(userId: string) {
  db.restoreUser(userId); // 清掉 deleted_at 和吊销哨兵，否则残留污染后续用例
  try {
    db.hardDeleteUser(userId);
  } catch {
    /* 还有引用就交给各用例自己的清理步骤 */
  }
}

function hasRevokeSentinel(userId: string): boolean {
  return db.isBlacklisted(`user_deleted_${userId}`);
}

describe('注销用户（软删除）', () => {
  it('有内容的用户注销后，内容与原始归属都原封不动保留', () => {
    const userId = makeUser();
    const convId = `test-conv-${uuidv4()}`;
    const paperId = `test-paper-${uuidv4()}`;
    const now = new Date().toISOString();
    try {
      db.createConversation({
        id: convId,
        title: '测试群',
        type: 'group',
        created_by: userId,
        member_ids: [userId],
        created_at: now,
      });
      db.createPaper({
        id: paperId,
        title: '测试文献',
        authors: null, year: null, venue: null, abstract: null, doi: null,
        url: null, source: null, tags: null, status: 'unread', notes: null,
        added_by: userId,
        added_at: now,
        updated_at: now,
      });

      expect(db.softDeleteUser(userId)).toBe(true);

      // 用户行还在，只是被标记了注销时间
      const user = db.getUser(userId);
      expect(user).toBeTruthy();
      expect(user!.deleted_at).toBeTruthy();

      // 关键：归属**没有被改判**。旧实现会把这两个字段覆盖成占位账号 ID，
      // 那才是真正的数据损失 —— 覆盖之后再也无法知道原来是谁建的。
      expect(db.getConversation(convId)!.created_by).toBe(userId);
      expect(db.getPaper(paperId)!.added_by).toBe(userId);

      // 成员关系也保留：把已注销的人从历史会话成员里抹掉，
      // 会让「这条消息是谁发的」失去上下文。
      expect(db.getConversationMembers(convId).some((m) => m.id === userId)).toBe(true);
    } finally {
      db.deleteConversation(convId);
      db.deletePaper(paperId);
      purge(userId);
    }
  });

  it('注销是幂等的：重复注销返回 false 而不抛错', () => {
    const userId = makeUser();
    try {
      expect(db.softDeleteUser(userId)).toBe(true);
      // 管理页重复点一下不该报错
      expect(db.softDeleteUser(userId)).toBe(false);
    } finally {
      purge(userId);
    }
  });

  it('已注销用户默认不在用户列表里，只有 includeDeleted 才可见', () => {
    const userId = makeUser();
    try {
      db.softDeleteUser(userId);
      // 默认过滤：选人器、@ 提示绝不该再选中一个已注销的人
      expect(db.getAllUsers().some((u) => u.id === userId)).toBe(false);
      // 管理页要能看见才能恢复
      expect(db.getAllUsers({ includeDeleted: true }).some((u) => u.id === userId)).toBe(true);
    } finally {
      purge(userId);
    }
  });

  it('注册查重仍能看见已注销用户占用的用户名', () => {
    // 若 getUserByUsername 过滤掉已注销用户，注册就会绕过 409 直接撞 UNIQUE 约束，
    // 抛 SQLITE_CONSTRAINT_UNIQUE —— 用户看到的是 500 而不是「用户名已存在」。
    const userId = makeUser();
    try {
      db.softDeleteUser(userId);
      const found = db.getUserByUsername(userId); // username 与 id 同值
      expect(found).toBeTruthy();
      expect(found!.deleted_at).toBeTruthy();
    } finally {
      purge(userId);
    }
  });

  it('在还有其他在职管理员时，管理员可以正常注销', () => {
    // 反向守卫：确认「最后一个管理员」的检查不会过度触发。若它写成
    // 「admin 一概不许注销」，这条会红 —— 那种实现会让管理员永远清不掉。
    const userId = makeUser({ role: 'admin' });
    try {
      expect(db.softDeleteUser(userId)).toBe(true);
      expect(db.getUser(userId)!.deleted_at).toBeTruthy();
    } finally {
      purge(userId);
    }
  });

  it('不能注销最后一个在职管理员', () => {
    // 注销后再没有人能进管理页把他恢复回来，而 ensureAdminUser() 刻意不排除已注销用户，
    // 不会自动补一个新 admin —— 系统会彻底锁死。
    const admins = db.getAllUsers().filter((u) => u.role === 'admin' && u.deleted_at === null);
    if (admins.length !== 1) {
      // 库里有多个在职管理员时构造不出「只剩一个」的场景（不能真去注销别的管理员），
      // 只能跳过而不是给出假的通过。
      console.warn(`[test] 跳过：库里有 ${admins.length} 个在职管理员，无法构造「最后一个」场景`);
      return;
    }
    const lastAdmin = admins[0].id;
    try {
      expect(() => db.softDeleteUser(lastAdmin)).toThrow(db.UserOperationError);
      // 抛错之后必须仍是在职状态，不能留下半截修改
      expect(db.getUser(lastAdmin)!.deleted_at).toBeNull();
    } finally {
      // **必须无条件恢复**：本用例操作的是库里真实存在的管理员。守卫一旦失效，
      // 上面那次 softDeleteUser 会成功，把真管理员注销掉；而下一次运行时
      // 「在职管理员数 = 0」会让本用例走进 skip 分支静默变绿 —— 守卫坏了却测不出来。
      // 变异验证时已经真实踩过一次（把开发库的 admin 注销了）。
      db.restoreUser(lastAdmin);
    }
  });

  it('占位账号不可注销、不可硬删、不可恢复', () => {
    expect(() => db.softDeleteUser(db.DELETED_USER_ID)).toThrow(db.UserOperationError);
    expect(() => db.hardDeleteUser(db.DELETED_USER_ID)).toThrow(db.UserOperationError);
    expect(() => db.restoreUser(db.DELETED_USER_ID)).toThrow(db.UserOperationError);
  });
});

describe('恢复用户', () => {
  it('恢复会清空 deleted_at', () => {
    const userId = makeUser();
    try {
      db.softDeleteUser(userId);
      expect(db.restoreUser(userId)).toBe(true);
      expect(db.getUser(userId)!.deleted_at).toBeNull();
      // 已经在职的用户再恢复一次返回 false
      expect(db.restoreUser(userId)).toBe(false);
    } finally {
      purge(userId);
    }
  });

  it('恢复必须同时清掉吊销哨兵，否则恢复出来的账号永远登不进来', () => {
    // 这是本次改动最容易漏、且最难从现象反推的坑：
    // blacklistUserTokens() 写入 jti = `user_deleted_<id>`、expires_at = 2099-12-31，
    // 而 authMiddleware 按 **userId** 而非按 token 检查它 —— 也就是说连重新登录拿到的
    // 全新 token 都会被判为「用户已被删除」，且 cleanupExpiredBlacklist() 因为 2099 的
    // 过期时间永远清不掉它。所以这条断言是「恢复功能真的可用」的唯一保证。
    const userId = makeUser();
    try {
      db.softDeleteUser(userId);
      db.blacklistUserTokens(userId); // 模拟路由在注销时吊销 token
      expect(hasRevokeSentinel(userId)).toBe(true); // 前提成立才有意义

      db.restoreUser(userId);
      expect(hasRevokeSentinel(userId)).toBe(false);
    } finally {
      purge(userId);
    }
  });
});

describe('硬删（清理误建账号）', () => {
  it('0 引用的用户可以真删除，库里不留行', () => {
    const userId = makeUser();
    expect(db.countUserReferences(userId).total).toBe(0);
    expect(db.hardDeleteUser(userId)).toBe(true);
    expect(db.getUser(userId)).toBeFalsy();
  });

  it('有引用的用户硬删被拒绝，且用户行仍然完好', () => {
    const userId = makeUser();
    const paperId = `test-paper-${uuidv4()}`;
    const now = new Date().toISOString();
    try {
      db.createPaper({
        id: paperId,
        title: '测试文献',
        authors: null, year: null, venue: null, abstract: null, doi: null,
        url: null, source: null, tags: null, status: 'unread', notes: null,
        added_by: userId, added_at: now, updated_at: now,
      });

      expect(db.countUserReferences(userId).detail['papers.added_by']).toBe(1);
      expect(() => db.hardDeleteUser(userId)).toThrow(db.UserOperationError);
      // 事务必须整体回滚：不能删了黑名单记录却没删用户，也不能反过来
      expect(db.getUser(userId)).toBeTruthy();
    } finally {
      db.deletePaper(paperId);
      purge(userId);
    }
  });

  it('引用统计覆盖 sessions.owner_id —— 它没有外键保护', () => {
    // 这是最容易漏的一条：PRAGMA foreign_key_list(sessions) 是空的，SQLite 不会
    // 替我们拦住硬删，漏掉它就会留下一个指向不存在用户的 owner_id。
    // 所以 EXTRA_USER_REF_COLUMNS 必须手工登记它，本用例就是那份登记的守卫。
    const userId = makeUser();
    const sessionId = `test-session-${uuidv4()}`;
    const now = new Date().toISOString();
    try {
      db.createSession({
        id: sessionId,
        title: '测试会话',
        model: 'test-model',
        owner_id: userId,
        sdk_session_id: null,
        created_at: now,
        updated_at: now,
      });

      const refs = db.countUserReferences(userId);
      expect(refs.detail['sessions.owner_id']).toBe(1);
      expect(() => db.hardDeleteUser(userId)).toThrow(db.UserOperationError);
    } finally {
      db.deleteSession(sessionId);
      purge(userId);
    }
  });

  it('CASCADE 引用也算引用', () => {
    // conversation_members 是 ON DELETE CASCADE，不会阻止 DELETE。但硬删只适用于
    // 「误建、从没用过」的账号 —— 已经被拉进会话就说明用过了，悄悄 CASCADE 掉会让
    // 别人的会话成员列表凭空少一个人。
    const ownerId = makeUser();
    const memberId = makeUser();
    const convId = `test-conv-${uuidv4()}`;
    const now = new Date().toISOString();
    try {
      db.createConversation({
        id: convId,
        title: '测试群',
        type: 'group',
        created_by: ownerId,
        member_ids: [ownerId, memberId],
        created_at: now,
      });

      // memberId 只是成员，没有任何 NO ACTION 外键指向他
      const refs = db.countUserReferences(memberId);
      expect(refs.detail['conversation_members.user_id']).toBe(1);
      expect(() => db.hardDeleteUser(memberId)).toThrow(db.UserOperationError);
    } finally {
      db.deleteConversation(convId);
      purge(memberId);
      purge(ownerId);
    }
  });
});

describe('用户表示层', () => {
  it('内容面加「（已注销）」后缀，账号面不加', () => {
    const userId = makeUser({ displayName: '张三' });
    try {
      db.softDeleteUser(userId);
      const user = db.getUser(userId)!;

      expect(toPublicUser(user).displayName).toBe('张三' + DELETED_SUFFIX);
      expect(toPublicUser(user).deleted).toBe(true);
      expect(displayNameOf(user)).toBe('张三' + DELETED_SUFFIX);

      // 账号面必须是**原始**姓名：管理页的编辑弹窗会把它回填进输入框，
      // 拿到带后缀的名字的话，管理员一保存就把「张三（已注销）」写成了真实姓名。
      expect(toAccountUser(user).displayName).toBe('张三');
      expect(toAccountUser(user).deletedAt).toBeTruthy();
    } finally {
      purge(userId);
    }
  });

  it('在职用户两种表示都不带后缀', () => {
    const userId = makeUser({ displayName: '李四' });
    try {
      const user = db.getUser(userId)!;
      expect(toPublicUser(user).displayName).toBe('李四');
      expect(toPublicUser(user).deleted).toBe(false);
      expect(toAccountUser(user).displayName).toBe('李四');
      expect(toAccountUser(user).deletedAt).toBeNull();
    } finally {
      purge(userId);
    }
  });

  it('用户不存在时 displayNameOf 兜底为「未知」而不是抛错', () => {
    expect(displayNameOf(undefined)).toBe('未知');
  });
});

describe('登录接口拒绝已注销用户', () => {
  // 没有 supertest，直接把 auth 路由挂到一个临时 app 上、listen(0) 取随机端口，
  // 用内置 fetch 打真实 HTTP —— 零新增依赖，且测的是真实的中间件链和状态码。
  let server: Server;
  let base = '';

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  async function login(username: string, password: string) {
    if (!base) {
      server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    }
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return { status: res.status, body: (await res.json()) as { error?: string } };
  }

  it('已注销用户即使密码正确也登录失败，且文案与密码错误完全一致', async () => {
    // 密码必须是**真实可用**的 bcrypt hash。
    // 第一版这个用例用的是 makeUser() 的默认非法 hash，结果登录在密码校验那一步就
    // 失败了，注销检查根本执行不到 —— 摘掉注销守卫测试照样全绿。反向变异验证抓到了
    // 这一点。所以下面先断言「注销前登得进去」，让这个用例自己证明它测到了正确的分支。
    const password = 'correct-horse-battery-staple';
    const userId = makeUser({ passwordHash: await hashPassword(password) });
    try {
      const before = await login(userId, password);
      expect(before.status).toBe(200); // 前提：这个账号本来是能登录的

      db.softDeleteUser(userId);

      const after = await login(userId, password);
      // 不存在的用户名，作为文案基准
      const unknown = await login(`no-such-user-${uuidv4()}`, password);

      expect(after.status).toBe(401);
      // 文案一致是刻意的：否则攻击者能凭报错内容判断某个用户名是否存在/已注销。
      // 这条断言就是防止将来有人「为了体验更好」把它改成「该账号已注销」。
      expect(after.body.error).toBe(unknown.body.error);
      expect(after.body.error).toBe('用户名或密码错误');
    } finally {
      purge(userId);
    }
  });
});
