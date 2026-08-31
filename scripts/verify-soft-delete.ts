/**
 * 软删除的端到端验证。跑在真实服务上（默认 http://127.0.0.1:3000）。
 * 会创建自己的临时管理员和测试用户，结束时全部清理。
 *
 * 用法：npx tsx scripts/verify-soft-delete.ts
 */
import * as db from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:3000';
const STAMP = Date.now().toString(36);
const ADMIN = `verify-admin-${STAMP}`;
const VICTIM = `verify-victim-${STAMP}`;
const GHOST = `verify-ghost-${STAMP}`;
const PW = 'verify-pass-123';

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await fetch(BASE + path, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body: body as any };
}

async function login(username: string) {
  return api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password: PW }) });
}

async function main() {
  const now = new Date().toISOString();
  const hash = await hashPassword(PW);

  // 直接写库造一个临时管理员：不知道真实 admin 的口令，也不该去改它。
  const adminId = `test-user-${ADMIN}`;
  db.createUser({
    id: adminId, username: ADMIN, password_hash: hash,
    display_name: '验证管理员', role: 'admin', created_at: now, updated_at: now,
  });

  const adminLogin = await login(ADMIN);
  check('临时管理员登录成功', adminLogin.status === 200, adminLogin.body);
  const adminToken = adminLogin.body.token;

  // ---- 1. 有关联数据的用户 → 注销（软删除） ----
  const reg = await api('/api/auth/register', {
    method: 'POST', token: adminToken,
    body: JSON.stringify({ username: VICTIM, password: PW, displayName: '张三' }),
  });
  check('创建 victim 用户', reg.status === 200, reg.body);
  const victimId = reg.body.user?.id;
  check('账号面返回的 displayName 是原始姓名', reg.body.user?.displayName === '张三', reg.body.user);

  const victimLogin = await login(VICTIM);
  check('victim 注销前能登录', victimLogin.status === 200, victimLogin.body);

  const conv = await api('/api/conversations', {
    method: 'POST', token: adminToken,
    body: JSON.stringify({ type: 'group', title: '验证群', memberIds: [victimId] }),
  });
  check('建群并把 victim 拉进去', conv.status === 200, conv.body);
  const convId = conv.body.conversation?.id;

  const del = await api(`/api/auth/users/${victimId}`, { method: 'DELETE', token: adminToken });
  check('有关联数据 → mode=soft', del.status === 200 && del.body.mode === 'soft', del.body);

  const relogin = await login(VICTIM);
  check('注销后无法登录（401）', relogin.status === 401, relogin.body);
  check('拒绝文案与密码错误一致', relogin.body.error === '用户名或密码错误', relogin.body);

  // 内容面：成员列表里名字带后缀，且成员关系没被抹掉
  const convs = await api('/api/conversations', { token: adminToken });
  const target = (convs.body.conversations || []).find((c: any) => c.id === convId);
  const member = (target?.members || []).find((m: any) => m.id === victimId);
  check('已注销成员仍在会话成员列表里', !!member, target?.members);
  check('内容面 displayName 带「（已注销）」后缀', member?.displayName === '张三（已注销）', member);
  check('内容面带 deleted 标记', member?.deleted === true, member);

  // 账号面：默认列表看不到，includeDeleted 才可见，且姓名不带后缀
  const listDefault = await api('/api/auth/users', { token: adminToken });
  check('默认用户列表不含已注销用户',
    !(listDefault.body.users || []).some((u: any) => u.id === victimId));
  const listAll = await api('/api/auth/users?includeDeleted=1', { token: adminToken });
  const shown = (listAll.body.users || []).find((u: any) => u.id === victimId);
  check('includeDeleted=1 能看到已注销用户', !!shown, listAll.body.users?.length);
  check('账号面 displayName 不带后缀（编辑弹窗回写陷阱）', shown?.displayName === '张三', shown);
  check('账号面带 deletedAt', !!shown?.deletedAt, shown);

  // 注册查重：用户名仍被占用，且提示指向「恢复」
  const dup = await api('/api/auth/register', {
    method: 'POST', token: adminToken,
    body: JSON.stringify({ username: VICTIM, password: PW, displayName: '冒名者' }),
  });
  check('撞已注销用户名 → 409（而非 500）', dup.status === 409, dup.body);
  check('409 提示指向恢复', /恢复/.test(dup.body.error || ''), dup.body);

  // ---- 2. 恢复 ----
  const restore = await api(`/api/auth/users/${victimId}/restore`, { method: 'POST', token: adminToken });
  check('恢复成功', restore.status === 200, restore.body);
  const afterRestore = await login(VICTIM);
  // 这条是整个改动最关键的回归点：注销时写下的 user_deleted_<id> 吊销哨兵
  // 若没被清掉，恢复出来的账号连重新登录都会被 401。
  check('恢复后能重新登录（证明吊销哨兵已清）', afterRestore.status === 200, afterRestore.body);

  const convs2 = await api('/api/conversations', { token: adminToken });
  const member2 = ((convs2.body.conversations || []).find((c: any) => c.id === convId)?.members || [])
    .find((m: any) => m.id === victimId);
  check('恢复后后缀消失', member2?.displayName === '张三', member2);

  // ---- 3. 0 关联数据的误建账号 → 硬删 ----
  const reg2 = await api('/api/auth/register', {
    method: 'POST', token: adminToken,
    body: JSON.stringify({ username: GHOST, password: PW, displayName: '误建账号' }),
  });
  const ghostId = reg2.body.user?.id;
  check('创建 ghost 用户', reg2.status === 200, reg2.body);

  const del2 = await api(`/api/auth/users/${ghostId}`, { method: 'DELETE', token: adminToken });
  check('0 关联数据 → mode=hard', del2.status === 200 && del2.body.mode === 'hard', del2.body);
  check('硬删后库里确实没有这一行', !db.getUser(ghostId));

  // ---- 4. 不能注销自己 ----
  const self = await api(`/api/auth/users/${adminId}`, { method: 'DELETE', token: adminToken });
  check('不能注销自己（400）', self.status === 400, self.body);

  // ---- 清理 ----
  try {
    if (convId) db.deleteConversation(convId);
    if (victimId) { db.restoreUser(victimId); db.hardDeleteUser(victimId); }
    db.restoreUser(adminId); db.hardDeleteUser(adminId);
    console.log('\n清理完成');
  } catch (e: any) {
    console.log('\n⚠ 清理未完成:', e?.message);
    failures++;
  }
  const leftover = db.getAllUsers({ includeDeleted: true }).filter((u) => u.username.startsWith('verify-'));
  check('没有残留 verify-* 用户', leftover.length === 0, leftover.map((u) => u.username));

  console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
