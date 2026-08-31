/**
 * 删除用户的完整链路 —— #9 的守卫。
 *
 * 【前提修正】#9 原本写着「FK 未开启，需要补 PRAGMA foreign_keys = ON」，这是错的。
 * better-sqlite3 与 sqlite3 CLI 相反，开连接时默认就是 foreign_keys = 1
 * （已实测：new Database(':memory:').pragma('foreign_keys', {simple:true}) === 1）。
 * 外键一直在生效，所以这不是隐患而是当前线上故障：
 * DELETE /api/auth/users/:id 删一个建过群/加过文献的用户会抛
 * SQLITE_CONSTRAINT_FOREIGNKEY，且 Express 4 不接 async handler 的 rejection，
 * 请求会挂死不返回。
 *
 * 实测 users 上共 10 个外键引用，其中 7 个是 ON DELETE NO ACTION（阻塞删除）。
 * 修复方式（Owner 裁决「保留」）：4 个归属列改判给占位账号 __deleted_user__，
 * 内容保留；成员关系列照旧删除。
 *
 * 注意：db.ts 在模块加载时把路径硬编码为 data/chat.db，没有注入点，
 * 所以本测试直接跑在开发库上，靠 finally 自行清理。要彻底隔离需要让 db.ts
 * 支持 DB_PATH 环境变量 —— 列为独立一项。
 */
import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../server/db.js';

function makeUser() {
  const now = new Date().toISOString();
  const id = `test-user-${uuidv4()}`;
  db.createUser({
    id,
    username: id,
    password_hash: '!not-a-valid-hash',
    display_name: '测试用户',
    role: 'member',
    created_at: now,
    updated_at: now,
  });
  return id;
}

describe('删除用户', () => {
  it('删除一个干净的用户应成功', () => {
    const userId = makeUser();
    try {
      expect(db.deleteUserAndReassignContent(userId)).toBe(true);
      expect(db.getUser(userId)).toBeFalsy();
    } finally {
      db.getUser(userId) && db.deleteUser(userId);
    }
  });

  it('删除添加过文献的用户应成功，且文献保留并改判给占位账号', () => {
    const userId = makeUser();
    const paperId = `test-paper-${uuidv4()}`;
    const now = new Date().toISOString();
    try {
      db.createPaper({
        id: paperId,
        title: '测试文献',
        authors: null,
        year: null,
        venue: null,
        abstract: null,
        doi: null,
        url: null,
        source: null,
        tags: null,
        status: 'unread',
        notes: null,
        added_by: userId,
        added_at: now,
        updated_at: now,
      });

      expect(db.deleteUserAndReassignContent(userId)).toBe(true);
      expect(db.getUser(userId)).toBeFalsy();

      // 关键：文献没被删掉，归属改判给了占位账号
      const paper = db.getPaper(paperId);
      expect(paper).toBeTruthy();
      expect(paper!.added_by).toBe(db.DELETED_USER_ID);
    } finally {
      db.deletePaper(paperId);
      db.getUser(userId) && db.deleteUser(userId);
    }
  });

  it('删除建过群聊的用户应成功，且群聊保留并改判给占位账号', () => {
    const userId = makeUser();
    const convId = `test-conv-${uuidv4()}`;
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

      expect(db.deleteUserAndReassignContent(userId)).toBe(true);
      expect(db.getUser(userId)).toBeFalsy();

      // 关键：群没被删掉 —— 直接 DELETE 会让整个群和全部消息对其他成员消失
      const conv = db.getConversation(convId);
      expect(conv).toBeTruthy();
      expect(conv!.created_by).toBe(db.DELETED_USER_ID);
    } finally {
      db.deleteConversation(convId);
      db.getUser(userId) && db.deleteUser(userId);
    }
  });

  it('占位账号本身不可被删除', () => {
    expect(() => db.deleteUserAndReassignContent(db.DELETED_USER_ID)).toThrow();
    expect(() => db.deleteUser(db.DELETED_USER_ID)).toThrow();
  });

  it('占位账号不出现在用户列表里', () => {
    // 否则它会出现在成员选择器和 Agent 的 list_users 结果中
    expect(db.getAllUsers().some((u) => u.id === db.DELETED_USER_ID)).toBe(false);
  });

  it('占位账号无法登录', () => {
    // password_hash 存的 '!' 不是合法 bcrypt hash，compare 恒为 false
    const placeholder = db.getUser(db.DELETED_USER_ID);
    expect(placeholder).toBeTruthy();
    expect(placeholder!.password_hash).toBe('!');
  });
});
