/**
 * 删除用户的完整链路 —— 这是第 2 批 #9 的守卫。
 *
 * 【重要修正】#9 原本的前提「FK 未开启，需要补 PRAGMA foreign_keys = ON」是错的。
 * better-sqlite3 与 sqlite3 CLI 不同，开连接时默认就是 foreign_keys = 1
 * （已实测：new Database(':memory:').pragma('foreign_keys') === 1）。
 * 也就是说外键一直在生效，删用户的洞不是「潜在的」，而是【当前线上就坏的】：
 * DELETE /api/auth/users/:id 删一个建过群/加过文献/建过任务或日程的用户，
 * db.deleteUser 会抛 SQLITE_CONSTRAINT_FOREIGNKEY。
 *
 * 已实测 users 上共 10 个外键引用，其中 7 个是 ON DELETE NO ACTION（会阻塞删除）。
 * cleanupUserData 覆盖了 im_messages.sender_id / task_comments.user_id /
 * paper_notes.user_id，还漏着 4 个「归属」列：
 *   conversations.created_by / tasks.created_by / events.created_by / papers.added_by
 * 这 4 列正是要按「保留内容、改判给占位用户」处理的对象（第 2 批 #9）。
 *
 * 下面两个用例用 it.fails 标记：它们【现在必须抛错】。等 #9 落地、删除不再抛错时，
 * it.fails 会自己变红，强制把它们改回普通 it —— 不会出现修好了却没人发现的情况。
 *
 * 注意：db.ts 在模块加载时就把路径固定为 data/chat.db，没有注入点，
 * 所以本测试直接跑在开发库上，靠 finally 自行清理。要彻底隔离需要让 db.ts
 * 支持 DB_PATH 环境变量 —— 那是独立一项。
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

/** 复现 DELETE /api/auth/users/:id 的调用顺序 */
function deleteUserLikeRoute(userId: string) {
  db.cleanupUserData(userId);
  db.blacklistUserTokens(userId);
  return db.deleteUser(userId);
}

describe('删除用户', () => {
  it('删除一个干净的用户应成功', () => {
    const userId = makeUser();
    try {
      expect(deleteUserLikeRoute(userId)).toBe(true);
      expect(db.getUser(userId)).toBeFalsy();
    } finally {
      db.deleteUser(userId);
    }
  });

  // 当前必然抛 FOREIGN KEY constraint failed（papers.added_by 没被 cleanup 覆盖）
  it.fails('删除一个添加过文献的用户应成功（#9 未修，当前抛错）', () => {
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

      expect(deleteUserLikeRoute(userId)).toBe(true);
      expect(db.getUser(userId)).toBeFalsy();
    } finally {
      db.deletePaper(paperId);
      db.deleteUser(userId);
    }
  });

  // 当前必然抛 FOREIGN KEY constraint failed（conversations.created_by 没被 cleanup 覆盖）
  it.fails('删除一个建过群聊的用户应成功（#9 未修，当前抛错）', () => {
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

      expect(deleteUserLikeRoute(userId)).toBe(true);
      expect(db.getUser(userId)).toBeFalsy();
    } finally {
      db.deleteConversation(convId);
      db.deleteUser(userId);
    }
  });
});
