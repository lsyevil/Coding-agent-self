import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径
const dbPath = path.join(__dirname, '..', 'data', 'chat.db');

/**
 * 已注销用户的占位账号 ID。
 *
 * 删除用户时不销毁其创建的共享内容（群聊/任务/日程/文献），而是把归属改判到这里。
 * 直接 DELETE 会连带毁掉其他人的上下文 —— 删掉一个建群的人会让整个群和全部消息消失。
 *
 * 必须声明在本文件顶部：ensureAdminUser() 在模块加载期（见下方初始化段）就会用到它，
 * 而 const 不像函数声明那样提升，放在后面会因 TDZ 抛
 * ReferenceError: Cannot access 'DELETED_USER_ID' before initialization，
 * 导致 db.ts 加载失败、整个服务起不来。
 */
export const DELETED_USER_ID = '__deleted_user__';

// 确保 data 目录存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库连接
// 显式标注类型：本文件末尾 `export default db`，composite 项目要发 .d.ts，
// 不标注时 tsc 无法为 better-sqlite3 的内部类型取名（TS4023）。
const db: Database.Database = new Database(dbPath);

// 启用 WAL 模式以提高性能
db.pragma('journal_mode = WAL');

// 初始化数据库表
db.exec(`
  -- 会话表（AI 对话）
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    owner_id TEXT NOT NULL DEFAULT 'system',
    sdk_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 消息表
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    model TEXT,
    created_at TEXT NOT NULL,
    tool_calls TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

  -- ============ 用户 ============
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    avatar TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    -- 注销时间。NULL = 在职。
    -- 用软删除而非 DELETE：users 上有 10 个外键引用，其中 7 个是 ON DELETE NO ACTION，
    -- 真删就必须先改判或清理所有引用行 —— 那会不可逆地销毁群聊历史的发言归属。
    -- 保留行则整类外键问题根本不出现，且「张三(已注销)」的个体身份还在。
    deleted_at TEXT
  );

  -- ============ IM 会话 ============
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    type TEXT NOT NULL CHECK (type IN ('private', 'group')),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    last_read_at TEXT,
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);

  CREATE TABLE IF NOT EXISTS im_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_im_messages_conv ON im_messages(conversation_id, created_at);

  -- ============ 待办 ============
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'blocked')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    due_date TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    conversation_id TEXT REFERENCES conversations(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

  CREATE TABLE IF NOT EXISTS task_assignees (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'collaborator')),
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (task_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- ============ 日程 ============
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    is_all_day INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL REFERENCES users(id),
    reminder_minutes INTEGER DEFAULT 15,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS event_participants (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    PRIMARY KEY (event_id, user_id)
  );


  -- ============ 系统配置 ============
  CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- ============ Token 黑名单（JWT 吊销） ============
  CREATE TABLE IF NOT EXISTS token_blacklist (
    jti TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_token_blacklist_user ON token_blacklist(user_id);
  CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at);

  -- ============ 文献 ============
  CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    authors TEXT,
    year INTEGER,
    venue TEXT,
    abstract TEXT,
    doi TEXT,
    url TEXT,
    source TEXT,
    tags TEXT,
    status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'reading', 'finished')),
    notes TEXT,
    added_by TEXT NOT NULL REFERENCES users(id),
    added_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status);

  CREATE TABLE IF NOT EXISTS paper_notes (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// 数据库迁移：为旧库补充 owner_id 列
try {
  const tableInfo = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
  if (!tableInfo.some((col) => col.name === 'owner_id')) {
    db.exec("ALTER TABLE sessions ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'system'");
    console.log('[DB] Added owner_id column to sessions table');
  }
} catch (e) {
  // 忽略错误（列可能已存在）
}

// 数据库迁移：为旧库补充 users.deleted_at 列（软删除）
try {
  const userCols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!userCols.some((col) => col.name === 'deleted_at')) {
    // 可空、无默认值：现存用户全部视为在职（NULL）
    db.exec('ALTER TABLE users ADD COLUMN deleted_at TEXT');
    console.log('[DB] 已为 users 表添加 deleted_at 列（软删除）');
  }
} catch (e) {
  // 忽略错误（列可能已存在）
}

/**
 * 检查有多少内容的归属已被旧版删除逻辑改判到占位账号上。
 *
 * 早先的 deleteUserAndReassignContent() 用 UPDATE 把 created_by/added_by 改成了
 * 占位账号 ID —— 原始 user id 被覆盖，**没有任何地方留有副本**。
 * 所以这些行的真实归属已经永久丢失，软删除也救不回来，这里只能如实报告。
 */
function warnIfContentOrphanedByLegacyDelete(): void {
  try {
    const pairs: Array<[string, string]> = [
      ['conversations', 'created_by'],
      ['tasks', 'created_by'],
      ['events', 'created_by'],
      ['papers', 'added_by'],
    ];
    let total = 0;
    const detail: string[] = [];
    for (const [table, col] of pairs) {
      const { n } = db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`)
        .get(DELETED_USER_ID) as { n: number };
      if (n > 0) detail.push(`${table}.${col}=${n}`);
      total += n;
    }
    if (total > 0) {
      console.warn(
        `[DB] 警告：有 ${total} 行内容的归属曾被旧版删除逻辑改判到占位账号（${detail.join(', ')}）。\n` +
          '      这些行的原始归属已被 UPDATE 永久覆盖，无法恢复。新的软删除不会再产生此类丢失。'
      );
    }
  } catch (e) {
    // 表可能还不存在（全新库），不影响启动
  }
}

// 确保默认管理员存在
ensureAdminUser();
// 顺序重要：必须在 ensureAdminUser 之后，占位账号才不会干扰「用户表是否为空」的判断
ensureDeletedPlaceholderUser();
warnIfContentOrphanedByLegacyDelete();

// 类型定义
export interface DbSession {
  id: string;
  title: string;
  model: string;
  owner_id: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
  tool_calls: string | null;
}

export interface DbUser {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: 'admin' | 'member';
  avatar: string | null;
  created_at: string;
  updated_at: string;
  /** 注销时间；null = 在职 */
  deleted_at: string | null;
}

// ============= 用户操作 =============

/** 创建默认管理员（仅当用户表为空时） */
export function ensureAdminUser(): void {
  // 计数必须排除占位账号：否则占位账号一存在，全新库就永远不会创建管理员，
  // 结果是没有任何人能登录。
  //
  // 但**刻意不排除已注销用户**：若排除，一个「所有用户都已注销」的库会被判定为空库，
  // 于是自动创建一个默认口令的管理员 —— 那等于给攻击者留了一条提权路径
  // （把所有人注销掉即可获得已知口令的 admin）。宁可让库锁死、必须有 DB 权限才能救。
  const row = db
    .prepare('SELECT COUNT(*) as count FROM users WHERE id != ?')
    .get(DELETED_USER_ID) as { count: number };
  if (row.count === 0) {
    const now = new Date().toISOString();
    const adminUser = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    const passwordHash = bcrypt.hashSync(adminPass, 10);
    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role, avatar, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), adminUser, passwordHash, '管理员', 'admin', null, now, now);
    console.log(`[DB] 已创建默认管理员: ${adminUser} / ${adminPass}（首次登录请修改密码）`);
  }
}

/**
 * 确保「已注销用户」占位账号存在。
 *
 * password_hash 存 '!' —— 不是合法的 bcrypt hash，bcryptjs.compare 对它恒返回 false
 * （已实测不抛错），因此这个账号永远无法登录。
 */
export function ensureDeletedPlaceholderUser(): void {
  const existing = db.prepare('SELECT 1 FROM users WHERE id = ?').get(DELETED_USER_ID);
  if (existing) return;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, role, avatar, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(DELETED_USER_ID, DELETED_USER_ID, '!', '已注销用户', 'member', null, now, now);
  console.log('[DB] 已创建「已注销用户」占位账号');
}

/**
 * 按 id 取用户。
 *
 * **刻意不过滤已注销用户**：群聊历史、任务评论等处要靠它渲染发言人，
 * 过滤掉会让历史里的发言人显示不出来。调用方需要区分时看 deleted_at。
 */
export function getUser(id: string): DbUser | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | undefined;
}

/**
 * 按 username 取用户。
 *
 * ⚠️ **刻意不过滤已注销用户**，因为本函数同时服务两条路径：
 *   1. 登录 —— 需要拒绝已注销用户
 *   2. 注册查重 —— 需要看见已注销用户
 *
 * 若在此处过滤，注册查重就看不到已注销用户占用的 username，
 * 于是绕过 409 直接撞上 UNIQUE 约束，抛 SQLITE_CONSTRAINT_UNIQUE（500 而非 409）。
 * 所以登录的拒绝必须放在路由层显式做，不能下沉到这里。
 */
export function getUserByUsername(username: string): DbUser | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as DbUser | undefined;
}

/**
 * 列出用户。
 *
 * 默认排除两类：
 *   - 「已注销用户」占位账号 —— 它不该出现在成员列表、负责人选择器或 Agent 的 list_users 里
 *   - 已注销用户 —— 不该再被选进新的会话/任务/日程
 *
 * includeDeleted 仅供管理界面使用（要展示并支持恢复）。
 */
export function getAllUsers(options?: { includeDeleted?: boolean }): DbUser[] {
  if (options?.includeDeleted) {
    return db
      .prepare('SELECT * FROM users WHERE id != ? ORDER BY created_at ASC')
      .all(DELETED_USER_ID) as DbUser[];
  }
  return db
    .prepare('SELECT * FROM users WHERE id != ? AND deleted_at IS NULL ORDER BY created_at ASC')
    .all(DELETED_USER_ID) as DbUser[];
}

export function createUser(user: {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role?: 'admin' | 'member';
  avatar?: string | null;
  created_at: string;
  updated_at: string;
}): DbUser {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, role, avatar, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    user.username,
    user.password_hash,
    user.display_name,
    user.role || 'member',
    user.avatar ?? null,
    user.created_at,
    user.updated_at
  );
  return getUser(user.id)!;
}

// ============= 会话操作 =============

export function getAllSessions(ownerId?: string): DbSession[] {
  if (ownerId) {
    const stmt = db.prepare('SELECT * FROM sessions WHERE owner_id = ? ORDER BY updated_at DESC');
    return stmt.all(ownerId) as DbSession[];
  }
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
  return stmt.all() as DbSession[];
}

export function getSession(id: string): DbSession | undefined {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  return stmt.get(id) as DbSession | undefined;
}

export function createSession(session: DbSession): DbSession {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, title, model, owner_id, sdk_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    session.id,
    session.title,
    session.model,
    session.owner_id,
    session.sdk_session_id,
    session.created_at,
    session.updated_at
  );
  return session;
}

export function updateSession(
  id: string,
  updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id' | 'owner_id'>>
): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.sdk_session_id !== undefined) {
    fields.push('sdk_session_id = ?');
    values.push(updates.sdk_session_id);
  }
  if (updates.owner_id !== undefined) {
    fields.push('owner_id = ?');
    values.push(updates.owner_id);
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const stmt = db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteSession(id: string): boolean {
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============= 消息操作 =============

export function getMessagesBySession(sessionId: string): DbMessage[] {
  const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
  return stmt.all(sessionId) as DbMessage[];
}

export function createMessage(message: DbMessage): DbMessage {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    message.id,
    message.session_id,
    message.role,
    message.content,
    message.model,
    message.created_at,
    message.tool_calls
  );

  const updateStmt = db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
  updateStmt.run(new Date().toISOString(), message.session_id);

  return message;
}

export function updateMessage(
  id: string,
  updates: Partial<Pick<DbMessage, 'content' | 'tool_calls'>>
): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.tool_calls !== undefined) {
    fields.push('tool_calls = ?');
    values.push(updates.tool_calls);
  }

  if (fields.length === 0) return false;

  values.push(id);

  const stmt = db.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteMessage(id: string): boolean {
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function createMessages(messages: DbMessage[]): void {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((msgs: DbMessage[]) => {
    for (const msg of msgs) {
      stmt.run(msg.id, msg.session_id, msg.role, msg.content, msg.model, msg.created_at, msg.tool_calls);
    }
  });

  insertMany(messages);
}

export function clearAllData(): void {
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM sessions');
}

// ============= IM 会话操作 =============

export interface DbConversation {
  id: string;
  title: string | null;
  type: 'private' | 'group';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DbConversationMember {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string | null;
}

export interface DbImMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

/** 获取用户所在的所有会话 */
export function getConversationsByUserId(userId: string): DbConversation[] {
  return db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ?
    ORDER BY c.updated_at DESC
  `).all(userId) as DbConversation[];
}

/** 获取会话详情 */
export function getConversation(id: string): DbConversation | undefined {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as DbConversation | undefined;
}

/** 检查用户是否是会话成员 */
export function isConversationMember(conversationId: string, userId: string): boolean {
  const row = db.prepare(
    'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
  ).get(conversationId, userId);
  return !!row;
}

/** 创建会话 + 添加成员（事务） */
export function createConversation(params: {
  id: string;
  title: string | null;
  type: 'private' | 'group';
  created_by: string;
  member_ids: string[];
  created_at: string;
}): DbConversation {
  const insert = db.transaction(() => {
    db.prepare(`
      INSERT INTO conversations (id, title, type, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(params.id, params.title, params.type, params.created_by, params.created_at, params.created_at);

    for (const uid of params.member_ids) {
      db.prepare(`
        INSERT INTO conversation_members (conversation_id, user_id, joined_at)
        VALUES (?, ?, ?)
      `).run(params.id, uid, params.created_at);
    }
  });
  insert();
  return getConversation(params.id)!;
}

/**
 * 获取会话成员列表。
 * 刻意包含已注销用户：这是既有关联关系，隐藏会让成员数与聊天历史里的发言人对不上。
 * 前端按 deleted_at 渲染成「张三(已注销)」。
 */
export function getConversationMembers(conversationId: string): DbUser[] {
  return db.prepare(`
    SELECT u.* FROM users u
    JOIN conversation_members cm ON cm.user_id = u.id
    WHERE cm.conversation_id = ?
  `).all(conversationId) as DbUser[];
}

/** 添加成员到会话 */
export function addConversationMember(conversationId: string, userId: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at)
    VALUES (?, ?, ?)
  `).run(conversationId, userId, new Date().toISOString());
}

/** 移除成员 */
export function removeConversationMember(conversationId: string, userId: string): void {
  db.prepare(
    'DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
  ).run(conversationId, userId);
}

/**
 * 删除会话。conversation_members / im_messages 对 conversations(id) 都是
 * ON DELETE CASCADE，成员与消息会随之清理（需 PRAGMA foreign_keys = ON，见 #9）。
 */
export function deleteConversation(id: string): boolean {
  return db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
}

/** 查找两人私聊会话（不存在返回 undefined） */
export function findPrivateConversation(userA: string, userB: string): DbConversation | undefined {
  return db.prepare(`
    SELECT c.* FROM conversations c
    WHERE c.type = 'private'
      AND c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)
      AND c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)
  `).get(userA, userB) as DbConversation | undefined;
}

// ============= IM 消息操作 =============

/** 获取会话消息（分页，按时间升序返回） */
export function getImMessages(conversationId: string, limit: number = 50, before?: string): DbImMessage[] {
  if (before) {
    return db.prepare(`
      SELECT * FROM im_messages
      WHERE conversation_id = ? AND created_at < ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(conversationId, before, limit).reverse() as DbImMessage[];
  }
  return db.prepare(`
    SELECT * FROM im_messages
    WHERE conversation_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(conversationId, limit).reverse() as DbImMessage[];
}

/** 创建 IM 消息 */
export function createImMessage(msg: {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}): DbImMessage {
  db.prepare(`
    INSERT INTO im_messages (id, conversation_id, sender_id, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(msg.id, msg.conversation_id, msg.sender_id, msg.content, msg.created_at);

  // 更新会话的 updated_at
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
    .run(msg.created_at, msg.conversation_id);

  return msg as DbImMessage;
}

/** 更新已读时间 */
export function updateLastReadAt(conversationId: string, userId: string): void {
  db.prepare(`
    UPDATE conversation_members SET last_read_at = ?
    WHERE conversation_id = ? AND user_id = ?
  `).run(new Date().toISOString(), conversationId, userId);
}

/** 获取会话未读消息数 */
export function getUnreadCount(conversationId: string, userId: string): number {
  const member = db.prepare(
    'SELECT last_read_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
  ).get(conversationId, userId) as { last_read_at: string | null } | undefined;

  if (!member || !member.last_read_at) {
    const row = db.prepare(
      'SELECT COUNT(*) as count FROM im_messages WHERE conversation_id = ?'
    ).get(conversationId) as { count: number };
    return row.count;
  }

  const row = db.prepare(
    'SELECT COUNT(*) as count FROM im_messages WHERE conversation_id = ? AND created_at > ?'
  ).get(conversationId, member.last_read_at) as { count: number };
  return row.count;
}

// ============= 待办操作 =============

export interface DbTask {
  id: string;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date: string | null;
  created_by: string;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbTaskAssignee {
  task_id: string;
  user_id: string;
  role: 'owner' | 'collaborator';
  assigned_at: string;
}

export interface DbTaskComment {
  id: string;
  task_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

/** 获取任务列表（支持状态筛选） */
export function getTasks(filter?: { status?: string; assigneeId?: string }): DbTask[] {
  let sql = `
    SELECT DISTINCT t.* FROM tasks t
    LEFT JOIN task_assignees ta ON ta.task_id = t.id
  `;
  const conditions: string[] = [];
  const params: any[] = [];

  if (filter?.status) {
    conditions.push('t.status = ?');
    params.push(filter.status);
  }
  if (filter?.assigneeId) {
    conditions.push('ta.user_id = ?');
    params.push(filter.assigneeId);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY t.created_at DESC';

  return db.prepare(sql).all(...params) as DbTask[];
}

/** 获取任务详情 */
export function getTask(id: string): DbTask | undefined {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as DbTask | undefined;
}

/** 创建任务 */
export function createTask(task: DbTask): DbTask {
  db.prepare(`
    INSERT INTO tasks (id, title, description, status, priority, due_date, created_by, conversation_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id, task.title, task.description, task.status, task.priority,
    task.due_date, task.created_by, task.conversation_id, task.created_at, task.updated_at
  );
  return task;
}

/** 更新任务 */
export function updateTask(id: string, updates: Partial<Pick<DbTask, 'title' | 'description' | 'status' | 'priority' | 'due_date'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const stmt = db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`);
  return stmt.run(...values).changes > 0;
}

/** 删除任务 */
export function deleteTask(id: string): boolean {
  return db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
}

/**
 * 获取任务的负责人列表。
 * 同 getConversationMembers：刻意包含已注销用户，保持历史一致。
 */
export function getTaskAssignees(taskId: string): DbUser[] {
  return db.prepare(`
    SELECT u.* FROM users u
    JOIN task_assignees ta ON ta.user_id = u.id
    WHERE ta.task_id = ?
  `).all(taskId) as DbUser[];
}

/** 添加任务负责人 */
export function addTaskAssignee(taskId: string, userId: string, role: 'owner' | 'collaborator'): void {
  db.prepare(`
    INSERT OR IGNORE INTO task_assignees (task_id, user_id, role, assigned_at)
    VALUES (?, ?, ?, ?)
  `).run(taskId, userId, role, new Date().toISOString());
}

/** 移除任务负责人 */
export function removeTaskAssignee(taskId: string, userId: string): void {
  db.prepare('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?').run(taskId, userId);
}

/** 获取任务评论 */
export function getTaskComments(taskId: string): DbTaskComment[] {
  return db.prepare(`
    SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC
  `).all(taskId) as DbTaskComment[];
}

/** 添加评论 */
export function addTaskComment(comment: DbTaskComment): DbTaskComment {
  db.prepare(`
    INSERT INTO task_comments (id, task_id, user_id, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(comment.id, comment.task_id, comment.user_id, comment.content, comment.created_at);
  return comment;
}

/** 删除评论（只能删除自己的） */
export function deleteTaskComment(id: string, userId: string): boolean {
  return db.prepare('DELETE FROM task_comments WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

// ============= 日程操作 =============

export interface DbEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  is_all_day: number;  // 0 or 1
  created_by: string;
  reminder_minutes: number | null;
  created_at: string;
  updated_at: string;
}

/** 获取日程列表（支持时间范围筛选） */
export function getEvents(filter?: { 
  startTime?: string;
  endTime?: string;
  userId?: string;
}): DbEvent[] {
  let sql = `
    SELECT DISTINCT e.* FROM events e
    LEFT JOIN event_participants ep ON ep.event_id = e.id
  `;
  const conditions: string[] = [];
  const params: any[] = [];

  if (filter?.startTime) {
    conditions.push('e.end_time >= ?');
    params.push(filter.startTime);
  }
  if (filter?.endTime) {
    conditions.push('e.start_time <= ?');
    params.push(filter.endTime);
  }
  if (filter?.userId) {
    conditions.push('ep.user_id = ?');
    params.push(filter.userId);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY e.start_time ASC';

  return db.prepare(sql).all(...params) as DbEvent[];
}

/** 获取日程详情 */
export function getEvent(id: string): DbEvent | undefined {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) as DbEvent | undefined;
}

/** 创建日程 */
export function createEvent(event: DbEvent): DbEvent {
  db.prepare(`
    INSERT INTO events (id, title, description, location, start_time, end_time, is_all_day, created_by, reminder_minutes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id, event.title, event.description, event.location,
    event.start_time, event.end_time, event.is_all_day,
    event.created_by, event.reminder_minutes, event.created_at, event.updated_at
  );
  return event;
}

/** 更新日程 */
export function updateEvent(id: string, updates: Partial<Pick<DbEvent, 'title' | 'description' | 'location' | 'start_time' | 'end_time' | 'is_all_day' | 'reminder_minutes'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const stmt = db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`);
  return stmt.run(...values).changes > 0;
}

/** 删除日程 */
export function deleteEvent(id: string): boolean {
  return db.prepare('DELETE FROM events WHERE id = ?').run(id).changes > 0;
}

/**
 * 获取日程参与人列表。
 * 同 getConversationMembers：刻意包含已注销用户，保持历史一致。
 */
export function getEventParticipants(eventId: string): Array<DbUser & { status: string }> {
  return db.prepare(`
    SELECT u.*, ep.status FROM users u
    JOIN event_participants ep ON ep.user_id = u.id
    WHERE ep.event_id = ?
  `).all(eventId) as Array<DbUser & { status: string }>;
}

/** 添加日程参与人 */
export function addEventParticipant(eventId: string, userId: string, status: 'pending' | 'accepted' | 'declined' = 'pending'): void {
  db.prepare(`
    INSERT OR IGNORE INTO event_participants (event_id, user_id, status)
    VALUES (?, ?, ?)
  `).run(eventId, userId, status);
}

/** 移除日程参与人 */
export function removeEventParticipant(eventId: string, userId: string): void {
  db.prepare('DELETE FROM event_participants WHERE event_id = ? AND user_id = ?').run(eventId, userId);
}

/** 更新参与人 RSVP 状态 */
export function updateParticipantStatus(eventId: string, userId: string, status: 'pending' | 'accepted' | 'declined'): boolean {
  const result = db.prepare(`
    UPDATE event_participants SET status = ? WHERE event_id = ? AND user_id = ?
  `).run(status, eventId, userId);
  return result.changes > 0;
}

/** 检测时间冲突：返回指定时间段内有冲突的日程 */
export function findConflictingEvents(startTime: string, endTime: string, excludeEventId?: string): DbEvent[] {
  let sql = `
    SELECT * FROM events
    WHERE start_time < ? AND end_time > ?
  `;
  const params: any[] = [endTime, startTime];

  if (excludeEventId) {
    sql += ' AND id != ?';
    params.push(excludeEventId);
  }

  return db.prepare(sql).all(...params) as DbEvent[];
}

/** 获取用户在指定时间段的空闲状态 */
export function getUserAvailability(userId: string, startTime: string, endTime: string): { busy: boolean; events: DbEvent[] } {
  const events = db.prepare(`
    SELECT e.* FROM events e
    JOIN event_participants ep ON ep.event_id = e.id
    WHERE ep.user_id = ?
      AND e.start_time < ?
      AND e.end_time > ?
    ORDER BY e.start_time ASC
  `).all(userId, endTime, startTime) as DbEvent[];

  return {
    busy: events.length > 0,
    events,
  };
}

// ============= 文献操作 =============

export interface DbPaper {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  venue: string | null;
  abstract: string | null;
  doi: string | null;
  url: string | null;
  source: string | null;
  tags: string | null;
  status: 'unread' | 'reading' | 'finished';
  notes: string | null;
  added_by: string;
  added_at: string;
  updated_at: string;
}

export interface DbPaperNote {
  id: string;
  paper_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function getPapers(filter?: { status?: string; tag?: string; search?: string }): DbPaper[] {
  let sql = 'SELECT * FROM papers';
  const conditions: string[] = [];
  const params: any[] = [];
  if (filter?.status) { conditions.push('status = ?'); params.push(filter.status); }
  if (filter?.tag) { conditions.push('tags LIKE ?'); params.push('%' + filter.tag + '%'); }
  if (filter?.search) { conditions.push('(title LIKE ? OR authors LIKE ? OR abstract LIKE ?)'); const s = '%' + filter.search + '%'; params.push(s, s, s); }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY added_at DESC';
  return db.prepare(sql).all(...params) as DbPaper[];
}

export function getPaper(id: string): DbPaper | undefined {
  return db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as DbPaper | undefined;
}

export function createPaper(paper: DbPaper): DbPaper {
  db.prepare('INSERT INTO papers (id, title, authors, year, venue, abstract, doi, url, source, tags, status, notes, added_by, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    paper.id, paper.title, paper.authors, paper.year, paper.venue, paper.abstract, paper.doi, paper.url, paper.source, paper.tags, paper.status, paper.notes, paper.added_by, paper.added_at, paper.updated_at
  );
  return paper;
}

export function updatePaper(id: string, updates: Partial<Pick<DbPaper, 'title' | 'authors' | 'year' | 'venue' | 'abstract' | 'doi' | 'url' | 'tags' | 'status' | 'notes'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, val] of Object.entries(updates)) { if (val !== undefined) { fields.push(key + ' = ?'); values.push(val); } }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  return db.prepare('UPDATE papers SET ' + fields.join(', ') + ' WHERE id = ?').run(...values).changes > 0;
}

export function deletePaper(id: string): boolean {
  return db.prepare('DELETE FROM papers WHERE id = ?').run(id).changes > 0;
}

export function getPaperNotes(paperId: string): DbPaperNote[] {
  return db.prepare('SELECT * FROM paper_notes WHERE paper_id = ? ORDER BY created_at ASC').all(paperId) as DbPaperNote[];
}

export function createPaperNote(note: DbPaperNote): DbPaperNote {
  db.prepare('INSERT INTO paper_notes (id, paper_id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(note.id, note.paper_id, note.user_id, note.content, note.created_at, note.updated_at);
  return note;
}

export function updatePaperNote(id: string, content: string, userId: string): boolean {
  return db.prepare('UPDATE paper_notes SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(content, new Date().toISOString(), id, userId).changes > 0;
}

export function deletePaperNote(id: string, userId: string): boolean {
  return db.prepare('DELETE FROM paper_notes WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

// ============= 系统配置 =============

export function getSystemConfig(key: string): string | null {
  const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || null;
}

export function setSystemConfig(key: string, value: string): void {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, value, now);
}

// ============= 用户管理扩展 =============

export function updateUser(id: string, updates: Partial<Pick<DbUser, 'display_name' | 'role' | 'avatar'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) { fields.push(key + ' = ?'); values.push(val); }
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  return db.prepare('UPDATE users SET ' + fields.join(', ') + ' WHERE id = ?').run(...values).changes > 0;
}

export function updateUserPassword(id: string, passwordHash: string): boolean {
  return db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, new Date().toISOString(), id).changes > 0;
}

// ============= 用户注销（软删除）与硬删 =============

/**
 * 用户操作被业务规则拒绝（而非程序出错）。
 *
 * 存在的理由：这些拒绝的文案是**写给使用者看的**（「不能注销最后一个在职管理员」），
 * 路由层要能把它们回成 400 而不是 500 —— 否则一条正常的规则拒绝会以
 * 「删除用户失败：…」的 500 形式出现，读起来像程序 bug，还会污染错误监控。
 * 用类型判断而不是匹配错误文案：文案会改，`instanceof` 不会跟着坏掉。
 */
export class UserOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserOperationError';
  }
}

/**
 * 语义上「引用了某个用户」、但**没有外键约束保护**的列。
 *
 * sessions.owner_id 存的就是 user id，然而实测 `PRAGMA foreign_key_list(sessions)`
 * 返回空 —— SQLite 不会替我们拦住硬删，删完只会留下一个指向不存在用户的 owner_id。
 * 所以这类「裸 user id 列」必须手工登记在此；今后新增同类列也要一并加进来。
 *
 * token_blacklist.user_id 同样没有外键，但**刻意不登记**：黑名单是短生命周期的
 * 鉴权副产物（到期即清），不是用户产出的内容。若把它算作引用，一个「注册后登录、
 * 登出、就没再用过」的误建账号会因为几条自己会过期的记录而永远无法硬删。
 * 它在 hardDeleteUser() 里被直接清掉，见那里的注释。
 */
const EXTRA_USER_REF_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'sessions', column: 'owner_id' },
];

/**
 * 运行时枚举所有指向 users 的引用列（外键 + 上面登记的裸列）。
 *
 * 用 PRAGMA 动态枚举而非硬编码表名：将来新增一张引用 users 的表时，硬删的安全检查
 * 会自动覆盖到它。硬编码则会漏 —— 而漏掉的代价不是少报个数字，是
 * 「误判 0 引用 → 放行硬删 → 数据被 CASCADE 静默清掉，或外键报错把 500 甩给用户」。
 */
function listUserRefColumns(): Array<{ table: string; column: string }> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;

  const refs: Array<{ table: string; column: string }> = [];
  for (const { name } of tables) {
    const fks = db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{
      table: string;
      from: string;
    }>;
    for (const fk of fks) {
      if (fk.table === 'users') refs.push({ table: name, column: fk.from });
    }
  }
  for (const extra of EXTRA_USER_REF_COLUMNS) {
    if (tables.some((t) => t.name === extra.table)) refs.push(extra);
  }
  return refs;
}

/**
 * 统计某用户名下还有多少条关联数据。仅用于判断「能否硬删」。
 *
 * **ON DELETE CASCADE 的引用也计入**（conversation_members / task_assignees /
 * event_participants）。它们不会阻止 DELETE，但硬删的适用场景只有「误建、从没用过的
 * 账号」—— 一旦这个账号已经被拉进会话、被指派任务，它就已经"用过"了，把这些成员关系
 * 悄悄 CASCADE 掉会让别人的会话成员列表凭空少一个人。宁可判定为不可硬删、退回注销。
 */
export function countUserReferences(userId: string): {
  total: number;
  detail: Record<string, number>;
} {
  const detail: Record<string, number> = {};
  let total = 0;
  for (const { table, column } of listUserRefColumns()) {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" = ?`)
      .get(userId) as { n: number };
    if (row.n > 0) {
      detail[`${table}.${column}`] = row.n;
      total += row.n;
    }
  }
  return { total, detail };
}

/**
 * 注销用户（软删除）：只写 deleted_at，不动任何一行内容。
 *
 * 为什么不改判归属：users 上有 10 个外键引用，7 个是 ON DELETE NO ACTION，真删就必须
 * 先把所有引用行改判或清理掉 —— 那会不可逆地摧毁群聊历史的发言归属。保留用户行则整类
 * 外键问题根本不出现，且「张三（已注销）」这个个体身份还在，历史消息仍能对上人。
 *
 * 返回 false 表示「用户不存在」或「已经是注销状态」（幂等，重复调用不报错）。
 */
export function softDeleteUser(userId: string): boolean {
  if (userId === DELETED_USER_ID) {
    throw new UserOperationError('不能注销「已注销用户」占位账号');
  }
  const user = getUser(userId);
  if (!user || user.deleted_at) return false;

  // 不允许注销最后一个在职管理员：注销后就再没有人能进管理页把他恢复回来，
  // 而 ensureAdminUser() 刻意不排除已注销用户（见其注释），也不会自动补一个新 admin
  // —— 系统会彻底锁死，只能靠直接改数据库救。这里挡住是唯一的低成本防线。
  if (user.role === 'admin') {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND deleted_at IS NULL AND id != ?"
      )
      .get(userId) as { n: number };
    if (row.n === 0) throw new UserOperationError('不能注销最后一个在职管理员');
  }

  const now = new Date().toISOString();
  return (
    db
      .prepare('UPDATE users SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(now, now, userId).changes > 0
  );
}

/**
 * 恢复已注销用户。返回 false 表示「用户不存在」或「本来就在职」。
 *
 * 注意：username 上的 UNIQUE 约束在注销期间依然占位，所以恢复不会撞名 ——
 * 注销期间根本没人能注册走这个 username（注册查重刻意能看见已注销用户，
 * 见 getUserByUsername 的注释）。
 */
export function restoreUser(userId: string): boolean {
  if (userId === DELETED_USER_ID) {
    throw new UserOperationError('「已注销用户」占位账号不是真实用户，无法恢复');
  }
  const user = getUser(userId);
  if (!user || !user.deleted_at) return false;

  const run = db.transaction(() => {
    const ok =
      db
        .prepare(
          'UPDATE users SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL'
        )
        .run(new Date().toISOString(), userId).changes > 0;

    // **必须同时清掉注销时打的吊销哨兵**，否则恢复出来的是个永久登不进来的账号。
    // blacklistUserTokens() 写入的是一行 jti = `user_deleted_<id>`、expires_at = 2099-12-31
    // 的记录，而 authMiddleware 按 **userId** 而不是按 token 检查它 —— 也就是说
    // 连重新登录拿到的全新 token 也会被判为「用户已被删除」，且 cleanupExpiredBlacklist()
    // 因为 2099 的过期时间永远清不掉它。
    // 这一步放在 restoreUser() 内部而非路由层：漏掉它的后果（账号看起来恢复了却永远
    // 登不进）很难从现象反推原因，不能指望每个调用点都记得配对。
    db.prepare('DELETE FROM token_blacklist WHERE jti = ?').run(`user_deleted_${userId}`);
    return ok;
  });

  return run();
}

/**
 * 硬删用户。**仅当该用户名下 0 条关联数据时才允许**，用于清理误建的账号。
 *
 * 检查与删除放在同一事务里：否则「查到 0 条」和「执行 DELETE」之间若有写入插进来，
 * 就会带着已过时的判断去删。7 个 NO ACTION 外键是最后一道兜底（真有引用会抛
 * SQLITE_CONSTRAINT_FOREIGNKEY），countUserReferences() 的作用是把那句晦涩的
 * 约束错误换成一条能直接给用户看、并指明该改用注销的消息。
 */
export function hardDeleteUser(userId: string): boolean {
  if (userId === DELETED_USER_ID) {
    throw new UserOperationError('不能删除「已注销用户」占位账号');
  }

  const run = db.transaction(() => {
    const { total, detail } = countUserReferences(userId);
    if (total > 0) {
      const parts = Object.entries(detail)
        .map(([k, v]) => `${k}=${v}`)
        .join('、');
      throw new UserOperationError(`该用户名下已有 ${total} 条关联数据（${parts}），不能删除，请改用注销`);
    }
    // 黑名单不算引用（见 EXTRA_USER_REF_COLUMNS 注释），但用户行都不存在了，
    // 这些 jti 记录留着只是垃圾 —— 它们本来也会到期被清，这里顺手清掉。
    db.prepare('DELETE FROM token_blacklist WHERE user_id = ?').run(userId);
    return db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes > 0;
  });

  return run();
}


// ============= Token 黑名单 =============

export function addToBlacklist(jti: string, userId: string, expiresAt: string): void {
  db.prepare('INSERT OR IGNORE INTO token_blacklist (jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(jti, userId, expiresAt, new Date().toISOString());
}

export function isBlacklisted(jti: string): boolean {
  const row = db.prepare('SELECT 1 FROM token_blacklist WHERE jti = ?').get(jti);
  return !!row;
}

export function blacklistUserTokens(userId: string): void {
  // 标记该用户的所有 token 为已吊销（用 user_deleted_ 前缀标记）
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO token_blacklist (jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(`user_deleted_${userId}`, userId, '2099-12-31', now);
}

export function cleanupExpiredBlacklist(): void {
  db.prepare('DELETE FROM token_blacklist WHERE expires_at < ?').run(new Date().toISOString());
}



export default db;
