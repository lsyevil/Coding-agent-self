import type { DbUser } from './db.js';

/**
 * 用户对外表示层。所有把 DbUser 转成 JSON 的地方都必须走这里。
 *
 * 分成两种表示，是因为两类接口对「已注销」的需求是相反的：
 *
 *  - **内容面**（会话成员、任务指派人、日程参与人、评论作者）：已注销用户会继续出现在
 *    历史内容里，必须让人看出来他已经不在职 → toPublicUser()，名字带「（已注销）」后缀。
 *    后缀加在服务端而非前端：前端有 12 处渲染 displayName 的地方，逐个改必然漏一处，
 *    而漏掉的那处会把已注销用户显示成正常在职同事。服务端只有这一个出口。
 *
 *  - **账号面**（/me、注册结果、用户列表、改用户结果）：需要的是**原始**姓名和 role。
 *    管理页的编辑弹窗会把 displayName 回填进输入框，若拿到带后缀的名字，管理员一保存
 *    就把「张三（已注销）」写成了真实姓名 → toAccountUser()，不加后缀，另给 deletedAt
 *    让前端自行决定怎么呈现（置灰、标签等）。
 *    这里的默认列表本就不含已注销用户（getAllUsers 默认过滤），所以选人器不会看到他们。
 */

/** 已注销用户的显示后缀。全角括号，与代码库其余中文标点一致。 */
export const DELETED_SUFFIX = '（已注销）';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  /** true 表示该用户已注销。前端可据此置灰；不置灰也不会显示错 —— 名字里已带后缀。 */
  deleted: boolean;
}

export interface AccountUser {
  id: string;
  username: string;
  /** **原始** display_name，不带后缀。编辑弹窗要回填它。 */
  displayName: string;
  role: string;
  avatar: string | null;
  /** ISO 时间串；null = 在职。 */
  deletedAt: string | null;
}

/**
 * 内容面的用户表示：已注销用户的名字带上后缀。
 *
 * 返回普通对象，可安全 spread 来附加字段，例如日程参与人的报名状态：
 *   `{ ...toPublicUser(p), status: p.status }`
 *
 * 刻意不含 role：现有的会话成员接口就没有暴露 role，加上等于扩大信息暴露面
 * （谁是管理员），而内容面并不需要它。
 */
export function toPublicUser(u: DbUser): PublicUser {
  const deleted = u.deleted_at !== null;
  return {
    id: u.id,
    username: u.username,
    displayName: deleted ? u.display_name + DELETED_SUFFIX : u.display_name,
    avatar: u.avatar,
    deleted,
  };
}

/**
 * 账号面的用户表示：**不加后缀**，带 role 和 deletedAt。
 *
 * 命名不叫 toAdminUser，是因为它同时服务 GET /auth/me —— 那不是管理员专属接口。
 * 字段是原 toSafeUser 的超集（多一个 deletedAt），所以替换掉 toSafeUser 时前端无需改动。
 */
export function toAccountUser(u: DbUser): AccountUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    avatar: u.avatar,
    deletedAt: u.deleted_at,
  };
}

/**
 * 取用户的显示名字符串，供只需要一个名字的接口使用（任务评论、文献笔记的 userName）。
 *
 * 接受 undefined 是刻意的：调用点是 `db.getUser(row.user_id)` 的结果，用户行理论上
 * 一定存在（有外键），但旧库可能有历史脏数据，原先的写法就是 `|| '未知'`。这里保留
 * 同样的兜底，避免为了「更严格」把一个能正常显示的页面变成 500。
 */
export function displayNameOf(u: DbUser | undefined): string {
  if (!u) return '未知';
  return toPublicUser(u).displayName;
}
