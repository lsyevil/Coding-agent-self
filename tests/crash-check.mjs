/**
 * 进程存活验证 —— 「一条畸形请求能不能打死服务」
 *
 * 为什么必须**另起进程**跑，不能写成 vitest 用例：
 *
 * 这个缺陷本身就是被 in-process 测试藏起来的。PR C 里我用 vitest 验证过同一类问题，
 * 观察到的现象是「请求永久挂起」，于是记录成了体验问题。但 vitest 自己注册了
 * unhandledRejection 处理器，把**进程崩溃**吞成了挂起 —— 独立跑的服务实际是直接死。
 * 一个未认证请求打死全公司的服务，被误判成一个请求返回慢。
 *
 * 所以这里必须 spawn 真实的 `tsx server/index.ts`，用「发请求 → 再探 /api/health」
 * 来判定进程是否还活着。任何 in-process 断言都无法覆盖这个失效模式。
 *
 * 用法：node tests/crash-check.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const AUTH_FILE = 'server/routes/auth.ts';
const INDEX_FILE = 'server/index.ts';

/** 畸形登录请求：password 传数字，过得了 `!password` 判断，进 bcrypt 就抛。 */
const PAYLOAD = { username: 'admin', password: 12345 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 杀掉整棵进程树。
 *
 * Windows 上 `spawn(..., {shell: true})` 的直接子进程是 cmd.exe，`proc.kill()` 只杀掉它，
 * 真正监听端口的 tsx/node **会活下来**。下一个场景启动时就撞 EADDRINUSE 起不来，
 * 而现象是「服务在 40s 内没起来」—— 看着像超时，实际是上一轮没清干净。
 * 所以要用 taskkill /T 连整棵树一起收。
 */
function killTree(proc) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
  } else {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); }
  }
}

async function startServer() {
  // 直接用当前的 node 可执行文件 + tsx 的 ESM loader，不经 npx、不开 shell：
  //  - `spawn('npx.cmd', ...)` 不带 shell 在 Windows 上直接抛 EINVAL
  //    （Node 修 CVE-2024-27980 后禁止无 shell 启动 .cmd/.bat）；
  //  - 而开 shell 又会多一层 cmd.exe，proc.kill() 杀不到真正监听端口的那个进程。
  // 直接起 node 两个问题都没有，killTree 也能干净收尾。
  const proc = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));

  // 轮询等就绪，最多 40s（首次要编译 TS，慢）
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return { proc, getLog: () => log };
    } catch { /* 还没起来 */ }
  }
  killTree(proc);
  throw new Error(`服务在 40s 内没起来。日志：\n${log}`);
}

/** 返回 'alive' | 'dead'：发一条畸形请求，再探 health。 */
async function probe() {
  let status;
  try {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PAYLOAD),
      // 超时必须给：原始缺陷的另一种表现就是永不返回
      signal: AbortSignal.timeout(6000),
    });
    status = r.status;
  } catch (e) {
    status = e.name === 'TimeoutError' ? 'HANG' : 'CONN_FAIL';
  }

  await sleep(800);
  let alive = false;
  try {
    const h = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2500) });
    alive = h.ok;
  } catch { alive = false; }

  return { status, alive };
}

/**
 * 在文件里做一次唯一替换；返回还原用的函数。
 *
 * 匹配前把**整个文件**归一成 LF，锚点也统一按 LF 书写。不要去猜文件的行尾风格：
 * 本仓库 core.autocrlf=true（入库 LF、检出 CRLF），而任何用脚本插入过内容的文件
 * 都很可能是 **CRLF 和 LF 混用**的 —— 按「文件里有 CRLF 就把锚点全转成 CRLF」来处理，
 * 恰好会在那些新插入的 LF 段落上失配。这已经真实发生过一次，报出来的是
 * 「锚点找不到」，读着像是代码变了，会把人带到完全错误的方向。
 *
 * 变异期间写回的是 LF 版本，这没有副作用：还原时写回的是 orig 的原始字节。
 */
function mutate(file, from, to) {
  const orig = readFileSync(file, 'utf8');
  const lf = orig.replace(/\r\n/g, '\n');

  const count = lf.split(from).length - 1;
  if (count !== 1) {
    throw new Error(
      `变异锚点在 ${file} 命中 ${count} 次（需要恰好 1 次）：${from.slice(0, 60)}`
    );
  }
  writeFileSync(file, lf.replace(from, to));
  return () => writeFileSync(file, orig);
}

// ---- 四个场景。M3 就是修复前的原始状态，必须能复现「进程死掉」，否则这套测试是空的。----

/** 去掉 typeof 守卫，让畸形入参重新走到 bcrypt。 */
const DROP_GUARDS = [
  AUTH_FILE,
  // 带上前一行注释：`trimmedField(req.body?.username)` 在 /register 里也有一份。
  `    // 而看到的提示是「用户名或密码错误」—— 没有任何线索指向空格。\n    const username = trimmedField(req.body?.username);`,
  `    const username = req.body?.username;`,
];
const DROP_GUARDS_2 = [
  AUTH_FILE,
  // 必须带上前一行注释：同一行 typeof password 判断在 /register 里也有一份，
  // 只按这一行匹配会命中 2 次。
  `    // 口令不 trim：首尾空格是合法口令内容。\n    const password = typeof req.body?.password === 'string' ? req.body.password : '';`,
  `    const password = req.body?.password;`,
];
/** 去掉 asyncHandler 包装，reject 就没人接了。 */
const DROP_WRAPPER = [
  AUTH_FILE,
  `router.post(\n  '/login',\n  asyncHandler(async (req, res) => {`,
  `router.post(\n  '/login',\n  (async (req, res) => {`,
];
/** 去掉进程级兜底，unhandledRejection 恢复默认的 throw 行为。 */
const DROP_PROCESS_GUARD = [
  INDEX_FILE,
  `process.on("unhandledRejection", (reason) => {`,
  `process.on("__disabled_for_test__", (reason: any) => {`,
];

const SCENARIOS = [
  {
    name: 'M0 基线（守卫 + asyncHandler + 进程兜底 全在）',
    mutations: [],
    expect: { status: 400, alive: true },
    why: '类型不对是请求的问题，应答 400',
  },
  {
    name: 'M1 摘掉 typeof 守卫',
    mutations: [DROP_GUARDS, DROP_GUARDS_2],
    expect: { status: 500, alive: true },
    why: 'asyncHandler + 错误中间件接住 bcrypt 的抛错，答 500 且进程活着',
  },
  {
    name: 'M2 再摘掉 asyncHandler',
    mutations: [DROP_GUARDS, DROP_GUARDS_2, DROP_WRAPPER],
    expect: { status: 'HANG', alive: true },
    why: '没人把 reject 转给错误中间件，请求永不返回；但进程兜底还在，服务不死',
  },
  {
    name: 'M3 三层全摘（= 修复前的原始状态）',
    mutations: [DROP_GUARDS, DROP_GUARDS_2, DROP_WRAPPER, DROP_PROCESS_GUARD],
    expect: { status: 'CONN_FAIL', alive: false },
    why: '复现原始 P0：一条未认证请求打死整个进程',
  },
];

let failed = 0;

for (const sc of SCENARIOS) {
  const restores = [];
  try {
    for (const [file, from, to] of sc.mutations) restores.push(mutate(file, from, to));

    const { proc, getLog } = await startServer();
    const got = await probe();
    killTree(proc);
    await sleep(1200);

    const ok = got.status === sc.expect.status && got.alive === sc.expect.alive;
    if (!ok) failed++;
    console.log(
      `${ok ? '✓' : '✗'} ${sc.name}\n` +
        `    期望 status=${sc.expect.status} alive=${sc.expect.alive}` +
        `  实际 status=${got.status} alive=${got.alive}\n` +
        `    ${sc.why}`
    );
    if (!ok) console.log(`    服务端日志尾：\n${getLog().split('\n').slice(-12).join('\n')}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${sc.name}\n    脚本自身出错：${e.message}`);
  } finally {
    // 必须逆序还原，且必须在 finally 里 —— 上面任何一步抛错都不能把变异留在工作区
    for (const r of restores.reverse()) r();
  }
}

console.log(
  failed === 0
    ? '\n全部场景符合预期 ✓（M3 能复现原始崩溃，说明这套断言不是空的）'
    : `\n${failed} 个场景不符合预期 ✗`
);
process.exit(failed === 0 ? 0 : 1);
