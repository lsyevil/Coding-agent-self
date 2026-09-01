/**
 * 反向变异验证：逐个摘掉守卫，确认对应的测试用例真的会红。
 * 守卫写了但测不到 = 没写。跑完自动从 .bak 还原。
 *
 * 用法：node tests/mutation-check.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';

const FILES = ['server/db.ts', 'server/routes/auth.ts', 'server/presenters.ts'];

/** 变异默认针对哪个 spec。带 spec 字段的变异点单独指定，避免每轮都跑无关用例。 */
const DEFAULT_SPEC = 'tests/soft-delete.test.ts';

const MUTATIONS = [
  {
    name: 'getAllUsers 默认不过滤已注销用户',
    file: 'server/db.ts',
    from: "'SELECT * FROM users WHERE id != ? AND deleted_at IS NULL ORDER BY created_at ASC'",
    to: "'SELECT * FROM users WHERE id != ? ORDER BY created_at ASC'",
    expectFail: '已注销用户默认不在用户列表里',
  },
  {
    name: 'restoreUser 不清吊销哨兵',
    file: 'server/db.ts',
    from: "db.prepare('DELETE FROM token_blacklist WHERE jti = ?').run(`user_deleted_${userId}`);",
    to: '// mutated: 哨兵未清除',
    expectFail: '恢复必须同时清掉吊销哨兵',
  },
  {
    name: 'EXTRA_USER_REF_COLUMNS 漏掉 sessions.owner_id',
    file: 'server/db.ts',
    from: "  { table: 'sessions', column: 'owner_id' },",
    to: '',
    expectFail: '引用统计覆盖 sessions.owner_id',
  },
  {
    name: 'softDeleteUser 不挡最后一个在职管理员',
    file: 'server/db.ts',
    from: "if (row.n === 0) throw new UserOperationError('不能注销最后一个在职管理员');",
    to: '/* mutated: 不挡 */',
    expectFail: '不能注销最后一个在职管理员',
  },
  {
    name: 'hardDeleteUser 不检查引用数',
    file: 'server/db.ts',
    // 锚点带上前一行：单独的 `if (total > 0) {` 在 db.ts 里不唯一。
    from: `const { total, detail } = countUserReferences(userId);
    if (total > 0) {`,
    to: `const { total, detail } = countUserReferences(userId);
    if (false) {`,
    expectFail: '有引用的用户硬删被拒绝',
  },
  {
    name: '登录不拒绝已注销用户',
    file: 'server/routes/auth.ts',
    // 缩进是 4 空格：login 的函数体被 asyncHandler(...) 包了一层。
    from: `    if (user.deleted_at) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }`,
    to: '    // mutated: 不拒绝已注销用户',
    expectFail: '已注销用户即使密码正确也登录失败',
  },
  {
    name: 'toAccountUser 错误地加上了后缀（编辑弹窗回写陷阱）',
    file: 'server/presenters.ts',
    from: '    displayName: u.display_name,\n    role: u.role,',
    to: '    displayName: u.deleted_at ? u.display_name + DELETED_SUFFIX : u.display_name,\n    role: u.role,',
    expectFail: '内容面加「（已注销）」后缀，账号面不加',
  },
  {
    name: 'toPublicUser 不加后缀',
    file: 'server/presenters.ts',
    from: '    displayName: deleted ? u.display_name + DELETED_SUFFIX : u.display_name,',
    to: '    displayName: u.display_name,',
    expectFail: '内容面加「（已注销）」后缀，账号面不加',
  },

  // ===== 以下是 department（同名消歧）这一批的守卫 =====
  {
    name: 'trimmedField 不 trim',
    file: 'server/routes/auth.ts',
    from: "  return typeof v === 'string' ? v.trim() : '';",
    to: "  return typeof v === 'string' ? v : '';",
    spec: 'tests/department.test.ts',
    expectFail: '注册时全是空格的显示名被拒绝',
  },
  {
    name: 'trimmedField 不判 typeof（非字符串会让请求永久挂起）',
    file: 'server/routes/auth.ts',
    from: "  return typeof v === 'string' ? v.trim() : '';",
    to: "  return v.trim();",
    spec: 'tests/department.test.ts',
    expectFail: '注册时非字符串的显示名返回 400',
  },
  {
    name: '注册不校验必填项',
    file: 'server/routes/auth.ts',
    from: "  if (!username || !password || !displayName) {",
    to: "  if (false) {",
    spec: 'tests/department.test.ts',
    expectFail: '注册时全是空格的显示名被拒绝',
  },
  {
    name: '注册不归一非字符串口令（进 bcrypt 会挂起）',
    file: 'server/routes/auth.ts',
    // 前面补一个换行来锚住缩进：login 里那行是 4 空格缩进，2 空格的版本会被它当子串包含。
    from: "\n  const password = typeof req.body?.password === 'string' ? req.body.password : '';",
    to: "\n  const password = req.body?.password;",
    spec: 'tests/department.test.ts',
    expectFail: '注册时非字符串的密码返回 400',
  },
  {
    name: 'login 的 username 不 trim / 不判类型',
    file: 'server/routes/auth.ts',
    // 锚点带上 login 专属的注释行：trimmedField(req.body?.username) 在 /register 里也有一份。
    from: "    // 而看到的提示是「用户名或密码错误」—— 没有任何线索指向空格。\n    const username = trimmedField(req.body?.username);",
    to: "    const username = req.body?.username;",
    spec: 'tests/login-hardening.test.ts',
    expectFail: 'username 首尾空格被 trim 掉，仍能登录成功',
  },
  {
    name: 'login 的 password 不判 typeof（进 bcrypt 会打死进程）',
    file: 'server/routes/auth.ts',
    from: "    // 口令不 trim：首尾空格是合法口令内容。\n    const password = typeof req.body?.password === 'string' ? req.body.password : '';",
    to: "    const password = req.body?.password;",
    spec: 'tests/login-hardening.test.ts',
    expectFail: 'password 传数字时答 400，不进 bcrypt',
  },
  {
    name: 'createUser 不归一空部门',
    file: 'server/db.ts',
    from: "    user.department?.trim() || null,",
    to: "    user.department ?? null,",
    spec: 'tests/department.test.ts',
    expectFail: 'createUser 把空串和纯空格的部门都归一成 null',
  },
  {
    name: 'PATCH 不校验显示名非空',
    file: 'server/routes/auth.ts',
    from: "    if (!trimmedName) return res.status(400).json({ error: '显示名不能为空' });",
    to: "    /* mutated: 不校验 */",
    spec: 'tests/department.test.ts',
    expectFail: 'PATCH 的显示名全是空格被拒绝',
  },
  {
    name: 'PATCH 的空串部门不归一成 null',
    file: 'server/routes/auth.ts',
    from: "    updates.department = trimmedField(req.body.department) || null;",
    to: "    updates.department = trimmedField(req.body.department);",
    spec: 'tests/department.test.ts',
    expectFail: 'PATCH 传空串部门表示清空',
  },
  {
    name: 'PATCH 的口令校验被挪到 DB 写之后（半更新）',
    file: 'server/routes/auth.ts',
    from: `  if (password !== undefined && (typeof password !== 'string' || password === '')) {
    return res.status(400).json({ error: '密码必须是非空字符串' });
  }

  if (Object.keys(updates).length > 0) {
    db.updateUser(user.id, updates);
  }`,
    to: `  if (Object.keys(updates).length > 0) {
    db.updateUser(user.id, updates);
  }

  if (password !== undefined && (typeof password !== 'string' || password === '')) {
    return res.status(400).json({ error: '密码必须是非空字符串' });
  }`,
    spec: 'tests/department.test.ts',
    expectFail: 'PATCH 的非法密码被拒绝时',
  },
  {
    name: 'toAccountUser 不归一空串部门',
    file: 'server/presenters.ts',
    from: "    department: u.department || null,",
    to: "    department: u.department,",
    spec: 'tests/department.test.ts',
    expectFail: '账号面把空串部门也报成 null',
  },
  {
    name: 'toPublicUser 也带上了 department（内容面不该有）',
    file: 'server/presenters.ts',
    from: "    avatar: u.avatar,\n    deleted,",
    to: "    avatar: u.avatar,\n    department: u.department,\n    deleted,",
    spec: 'tests/department.test.ts',
    expectFail: '账号面带 department，内容面刻意不带',
  },
];

/** 自行建立备份。不能依赖外部预先准备好 .bak —— 那样别人克隆下来第一次就跑不通。 */
function backupAll() {
  for (const f of FILES) copyFileSync(f, f + '.bak');
}

function restoreAll() {
  for (const f of FILES) copyFileSync(f + '.bak', f);
}

function dropBackups() {
  for (const f of FILES) {
    try { unlinkSync(f + '.bak'); } catch { /* 已经不在了 */ }
  }
}

/**
 * 变异跑的是**真实开发库**（db.ts 把路径硬编码为 data/chat.db，没有注入点）。
 * 守卫被摘掉时，本该被拒绝的写入会真的发生 —— 已经踩过一次：把守卫摘掉后
 * 「不能注销最后一个在职管理员」那个用例真的把开发库的 admin 注销了，导致下一轮
 * 「在职管理员数 = 0」让该用例静默跳过、假装变绿。
 * 所以每轮变异之后必须把库修回去，否则脚本的后续结论全部不可信。
 */
function repairDb() {
  const db = new Database('data/chat.db');
  try {
    const r = db.prepare("UPDATE users SET deleted_at = NULL WHERE role = 'admin' AND deleted_at IS NOT NULL").run();
    db.prepare("DELETE FROM token_blacklist WHERE jti LIKE 'user_deleted_%'").run();
    // 必须**同时**按 username 过滤：走 HTTP 注册造出来的测试账号，id 是服务端生成的
    // uuid，只有 username 带前缀，只按 id 清扫会漏掉它们（已经漏过 10 个）。
    const WHERE =
      "id LIKE 'test-user-%' OR id LIKE 'test-dept-%' OR id LIKE 'test-login-%' " +
      "OR username LIKE 'test-dept-%' OR username LIKE 'test-login-%'";
    const leftover = db.prepare(`SELECT id FROM users WHERE ${WHERE}`).all();
    for (const u of leftover) {
      try { db.prepare('DELETE FROM users WHERE id = ?').run(u.id); } catch { /* 有引用就留着，后面报告 */ }
    }
    if (r.changes > 0) console.log(`   (已修复被变异注销的管理员 ×${r.changes})`);
    const stillThere = db.prepare(`SELECT COUNT(*) n FROM users WHERE ${WHERE}`).get().n;
    if (stillThere > 0) console.log(`   ⚠ 开发库里残留 ${stillThere} 个测试用户，需人工清理`);
  } finally {
    db.close();
  }
}

function runTests(spec = DEFAULT_SPEC) {
  try {
    const out = execSync(`npx vitest run ${spec} --reporter=basic`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { failed: false, out };
  } catch (e) {
    return { failed: true, out: (e.stdout || '') + (e.stderr || '') };
  }
}

backupAll();
// 任何异常退出（含 Ctrl-C）都必须把源文件还原，否则会把变异后的代码留在工作区 ——
// 那是最糟的失败模式：守卫被悄悄摘掉，而 git diff 看起来只是「一次跑挂了」。
process.on('exit', () => { try { restoreAll(); dropBackups(); } catch { /* 尽力而为 */ } });
process.on('SIGINT', () => process.exit(130));

repairDb();
console.log('=== 基线：未变异时必须全绿 ===');
for (const spec of new Set(MUTATIONS.map((m) => m.spec || DEFAULT_SPEC))) {
  const baseline = runTests(spec);
  if (baseline.failed) {
    console.error(`基线就是红的（${spec}），变异验证无意义。先修测试。`);
    console.error(baseline.out.slice(-3000));
    process.exit(1);
  }
}
console.log('基线全绿 ✓\n');

let allGood = true;
for (const m of MUTATIONS) {
  restoreAll();
  // 匹配前把整个文件归一成 LF，锚点也一律按 LF 书写。
  //
  // 早先这里是「探测文件用不用 CRLF，再把锚点转成同一种」。那个做法有个盲点：
  // 被脚本插入过内容的文件很可能 **CRLF 与 LF 混用**，于是按整文件猜出来的行尾
  // 恰好在新插入的那几行上失配。已经真实踩过一次，报出来的是「变异点找不到」，
  // 读着像代码变了，会把人带去完全错误的方向。归一之后行尾就彻底不参与匹配了。
  const LF = String.fromCharCode(10);
  const src = readFileSync(m.file, 'utf-8').split(String.fromCharCode(13) + LF).join(LF);
  const from = m.from;
  const to = m.to;
  // 锚点必须**唯一**：String.replace 只替换第一处，锚点撞车会静默改到别的地方，
  // 于是守卫其实没被摘掉，脚本却报告「守卫没有测试覆盖」—— 一次假阴性。
  // （已经踩过：`if (total > 0) {` 在 db.ts 里有两处。）
  const occurrences = src.split(from).length - 1;
  if (occurrences === 0) {
    console.log(`✗ [${m.name}] 变异点在 ${m.file} 中找不到 —— 代码已变，需更新本脚本`);
    allGood = false;
    continue;
  }
  if (occurrences > 1) {
    console.log(`✗ [${m.name}] 变异点在 ${m.file} 中出现 ${occurrences} 次，不唯一 —— 换一个更长的锚点`);
    allGood = false;
    continue;
  }
  writeFileSync(m.file, src.replace(from, to));

  const r = runTests(m.spec || DEFAULT_SPEC);
  restoreAll();
  repairDb();

  if (!r.failed) {
    console.log(`✗ [${m.name}] 摘掉守卫后测试仍全绿 —— 这个守卫没有被任何测试覆盖`);
    allGood = false;
  } else if (!r.out.includes(m.expectFail)) {
    console.log(
      `~ [${m.name}] 测试变红了，但失败的不是预期用例「${m.expectFail}」—— 可能是连带崩溃而非真的测到`
    );
    allGood = false;
  } else {
    console.log(`✓ [${m.name}] → 「${m.expectFail}」如期变红`);
  }
}

restoreAll();
console.log(allGood ? '\n全部守卫都有测试覆盖 ✓' : '\n存在未被覆盖的守卫 ✗');
process.exit(allGood ? 0 : 1);
