# ProCoder 代码修改指令（v4 定稿 · 已逐条核实）

> **来源**:这份文档原先不在仓库里,`docs/pending-work.md` 曾把它引用的 20+ 个编号记为
> 「内容缺失、不具备可执行性」。2026-09-01 Owner 提供了原文,转录归档于此。
>
> **转录说明**:原文经过一次编码往返(UTF-8 被按 latin1 读),由我逐条转录还原。
> 条目定义、文件路径、编号按原文保留;部分长代码块做了压缩。如与原件有出入,以原件为准。

> ⚠️ **这份文档有三条是错的或已被更好的实现取代**,照抄会引入回归 —— 见文末
> 「v4 自身的错误」。**不要把本文档当待办清单直接执行**,每条都带 2026-09-01 的核实状态。

图例:✅ 已完成 / ❌ 未完成 / 🟡 部分 / ⛔ **已否决,不应执行**

---

## 第 0 批:开工前订正(不做完,后续修改会破坏主路径)

### A1 · #11 对话历史窗口(去掉 tool_calls,只保留截断)

**文件**:`server/index.ts`

**当前问题**:v3 给历史消息加了 `tool_calls` replay,但 DB 里 `messages.role` 是
`CHECK(role IN ('user','assistant'))`,存不了 `tool` 角色。这会让**任何用过工具的会话**
**从第二条消息起全部 400 报错**。

**正确修改**:只加窗口截断。

```ts
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES) || 20;
const historyMessages = db.getMessagesBySession(session.id)
  .filter((m) => m.role === "user" || m.role === "assistant")
  .slice(-MAX_HISTORY_MESSAGES)
  .map((m) => ({ role: m.role, content: m.content || "" }));
```

> 恢复跨轮工具上下文需要:放弃 role 约束 → 按 API 形状存 tool/tool_call 对 → 发送时
> 对齐 pair 边界。独立大项,不裹进本条。

**核实:✅ 已完成** —— `server/index.ts:390-399`。

### A2 · #13 SSE close 应区分正常完成与异常断开

**文件**:`server/index.ts` + `server/agent.ts`

**当前问题**:v3 的 `req.on('close')` 在正常完成后也触发,`cancelFlags` 残留。下一条消息
在 turn 0 被标记、break、返回空内容 —— **每个会话的第二条消息都静默失败**。

**A2a — index.ts 区分正常/异常**:

```ts
req.on('close', () => {
  if (res.writableEnded) return;   // 正常收尾,不当作中断
  isClosed = true;
  if (session) cancelAgent(session.id);
});
```

**A2b — agent.ts 每轮清理残留标记**:v4 要求在 `for` 循环**开头**加
`if (sessionId) cancelFlags.delete(sessionId);`

**核实**:

- **A2a:✅ 已完成** —— `index.ts:338-342`,带注释说明为何必须用 `writableEnded` 区分。
- **A2b:⛔ 已否决(v4 写法是错的)** —— 见文末。代码放在循环**外面**(`agent.ts:82`),这才是对的。

### A3 · #7 去掉 7b,只留 7a

**文件**:`server/routes/auth.ts`

**当前问题**:v3 的 #7b 用 `blacklistUserTokens` 做「改 role 后吊销」,但该函数写的是
`jti = user_deleted_${userId}`、`expires_at = '2099-12-31'`,auth.ts 会报「用户已被删除」。
**admin 把某人降权后,该用户永远无法登录。**

**修改**:保留 #7a(refresh 时查 DB 拿最新 role),**删除 #7b**。
若要 role 变更即时生效,正确做法是独立新增 `users.token_version`,签名时写进 payload,
authMiddleware 比对不一致就 401 —— 不在本条范围。

**核实:✅ 已完成(#7b 正确地不存在)** —— PATCH /users/:id(`auth.ts:147+`)改 role 时
不调 `blacklistUserTokens`。

⚠️ **但配套的 #7a 没做**(见第 2 批)。A3 删掉了兜底、7a 又没补上,**等于净损失**:
目前 refresh 从旧 payload 重签 role,**被降权的 admin 靠续期可无限保留 admin 身份**。

### A4 · #3 变量名冲突

**当前问题**:v3 的片段 `const finalSystemPrompt = process.env.DEFAULT_SYSTEM_PROMPT || defaultSystemPrompt;`
中 `defaultSystemPrompt` 是已存在的变量名,运行会报重复声明。

**修改**:保留原变量名,另起 `finalSystemPrompt`,传给 messages 时用后者。

**核实:✅ 已完成(问题不存在)** —— `index.ts:359` 只有一个 `defaultSystemPrompt`,无遮蔽。
⚠️ 但 `:398` 的 `systemPrompt` 仍来自 `req.body`,属第 2 批 #3,未做。

### A5 · #17 setEnabled 落库(修正 await / 路径 / 无效判断)

**文件**:`server/skills/registry.ts`

**当前问题**:v3 在非 async 方法里用 `await import`,路径 `../../db.js` 错,
`isEnabled !== undefined` 无效。

**修改**:顶层静态 `import * as db from '../db.js'`;`setEnabled` 里 try/catch 调
`db.setSystemConfig('skill_registry', JSON.stringify(this.dumpConfig()))`;新增 `dumpConfig()`。
启动恢复也改同步,直接查 Map(`skillRegistry.skills.has(name)`)而不用 `isEnabled`。

**核实:✅ 已完成** —— `registry.ts:2` 顶层 import、`:69` setEnabled、`:72` 落库、`:79` dumpConfig;
`skills/index.ts:24` 启动恢复。

### A6 · #10 grepWalk 三处补全

**文件**:`server/skills/coding/index.ts`

- **A6a · startDir 加进签名** —— 让 `path.relative(startDir, full)` 输出相对起始目录的路径,
  而不是相对当前递归层。
- **A6b · `catch { return; }` 改 `continue`** —— 文件遍历循环内部两处(`stat.size` 检查、
  `readFileSync` 的 catch)要 `continue`,否则一个读不了的文件会终止整个目录的遍历。
- **A6c · fallback RegExp 去掉 `g`** —— `'gi'` → `'i'`。带 `g` 的正则有 `lastIndex` 状态,
  复用同一对象逐行 `test()` 会跳过匹配。

**核实:✅ 三处全部完成** —— `coding/index.ts:69-75` 签名含 startDir;`:84`/`:94` 用 `continue`
(且注释区分了唯一该保持 `return` 的位置:整个目录读不了);`:103`/`:105` 两处都是 `i`。

### A7 · .env.example 改空值

**当前问题**:`JWT_SECRET=change-me-in-production` 正好是 #2d 要拒绝的弱密钥值,导致
`cp .env.example .env && npm run dev` 直接 exit(1)。

**修改**:改空值(空值触发 #2d 的校验错误、提示用户生成,这是预期行为),并补齐
`WS_ORIGIN=` / `OPENAI_MODELS=` / `DEFAULT_SYSTEM_PROMPT=`。

**核实:✅ 已完成** —— `.env.example:47` 空值、`:19` OPENAI_MODELS、`:55` WS_ORIGIN、
`:40` DEFAULT_SYSTEM_PROMPT(注释形式)。

### B4 · tsconfig.node.json 加 outDir

**当前问题**:`tsc -b` 会把编译产物吐到 `server/` 源码旁边。

**修改**:`"outDir": "./.tsbuild"`,并加进 `.gitignore`。

**核实:✅ 已完成** —— `tsconfig.node.json` 有该 outDir;`.gitignore:32` 有 `.tsbuild`。
实现还额外加了 `target/lib: ES2022`,注释说明缺失时 tsc 默认 ES5 会让 Map/Set 的
`for...of` 报 TS2802。

---

## 第 1 批:基础与行修

### #1 给 runCodingAgent 传 sessionId

`server/index.ts` 调用参数里加 `sessionId: session.id`,否则 `cancelAgent` 无法生效。

**核实:✅ 已完成** —— `index.ts:459`。

### #2 装 dotenv + compose 补齐 env + JWT_SECRET 校验(含 A7)

| 子项 | 内容 | 核实 |
|---|---|---|
| 2a | `package.json` 加 `dotenv` | ✅ `package.json:24` `^16.4.5` |
| 2b | `index.ts` 开头 `import 'dotenv/config'` | ✅ `index.ts:3`,带注释说明为何必须最先 |
| 2c | `docker-compose.yml` 补 JWT/ADMIN/WS_ORIGIN | ✅ `docker-compose.yml:8-26` |
| 2d | `auth.ts` JWT_SECRET 启动校验 | ✅ `auth.ts:26` `resolveJwtSecret()`,生产缺失或用弱默认值即 exit |
| 2e | `ws.ts` JWT_SECRET 同步校验 | ✅ 走 `auth.ts` 的 `verifyToken` 单一入口(`auth.ts:94` 注释说明原因) |

⚠️ **2c 的注释有一处假承诺**:compose 第 21-22 行写「JWT_SECRET 与 DEFAULT_ADMIN_PASSWORD 必填,
缺失服务会拒绝启动(见 server/auth.ts / server/db.ts)」。`auth.ts` 确实有守卫,**`db.ts` 没有**
—— `db.ts:349` 是 `|| 'admin123'`。见 P2-4。

### #12 MAX_TURNS 读 env + 放对位置

- **12a**:`const MAX_TURNS = Number(process.env.MAX_TURNS) || 25;`
- **12b**:轮数耗尽的提示放到循环**外**,用 `let completed = false` 标记,正常收尾时置 true。

**核实**:12a ✅ `agent.ts:55`。
12b ✅ 已完成,**但实现优于 v4** —— 用 4 态 `stopReason` 而非 boolean,见文末。

### #18 删 system_config 重复 DDL

**核实:✅ 已完成** —— `db.ts` 全文只有 1 处该 DDL。

---

## 第 2 批:安全主体

> ⚠️ **本批风险最集中。#3 / #8 / #16 三条未做项串成一条完整提权链,见文末。**

### #3 服务端接管关键参数(架构上枚举映射,不减功能)

**文件**:`server/index.ts` + 新建 `server/agents.ts`

**当前问题**:v3 直接忽略客户端传来的 model/systemPrompt,把角色切换变成纯装饰。

**3a · 新建 server/agents.ts** —— 导出 `AGENT_PROMPTS`(`default`/`coding`/`research`)、
`DEFAULT_AGENT_ID`、`resolveSystemPrompt(agentId)`(未知 id 回落默认),以及模型白名单:

```ts
export function resolveModel(requested: string | undefined): string {
  const allowed = (process.env.ALLOWED_MODELS || process.env.OPENAI_MODEL || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const fallback = allowed[0] || 'gpt-4o';
  if (!requested) return fallback;
  if (allowed.includes(requested)) return requested;
  return fallback; // 非法值回落默认
}
```

**3b · /api/chat 改签** —— 只从 body 取 `sessionId` / `message` / `agentId`;
`permissionMode`、`cwd`、`systemPrompt` 全部由服务端决定。

**3c · 建/改 session 时校验 model** —— `POST /api/sessions` 与 `PATCH /api/sessions/:id`
用 `resolveModel(req.body.model)` 的结果替代 `req.body.model`。

**核实:❌ 未完成** —— `server/agents.ts` 不存在,全仓零 `AGENT_PROMPTS` 命中。
`index.ts:271` 仍是 `const { sessionId, message, model, systemPrompt, cwd, permissionMode } = req.body;`,
`:383` `pm = permissionMode || ...`,`:384` `workingDir = cwd || ...`。**四个参数全部客户端可控。**

> 📌 2026-09-01 裁决:本条并入「助手可编辑化 PR ①」一起做 —— 同一段参数解析,分开改等于改两遍。
> `resolveModel` 落点改为 `server/model-registry.ts`;`AGENT_PROMPTS` 这个符号不再新建
> (助手预设改为入库,见 PR ②),所以 3a 只取 `resolveModel` 部分。

### #4 resolveWithin 路径安全(找最近存在的祖先)

**修改**:不能只比较 `path.relative`。要沿父链向上找到第一个真实存在的祖先、各自 `realpath`,
再比较。判断条件写全:`rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)`。

**核实:❌ 未完成** —— `coding/index.ts:13-21` 仍是朴素实现,无 `realpathSync`,
**符号链接可以逃逸工作目录**。
另外现有条件是 `rel.startsWith('..')`,会**误拒**名为 `..foo` 的合法文件 —— v4 的三段式条件是对的。

### #5 Skill 层补归属校验

`server/skills/todo/index.ts` 等:所有 mutation 工具校验调用者是否创建者/负责人。

**核实:❌ 未完成** —— `todo/index.ts` 只在创建时写 `created_by: context.userId`(`:120`),
无任何 mutation 归属校验。

### #6 ws.ts 补 token 黑名单 + 收紧 origin

**核实:❌ 未完成** —— `ws.ts:9` 是 `cors: { origin: '*' }`,且无 `isBlacklisted` 校验
(全文零命中)。`.env.example` 里的 `WS_ORIGIN` 目前无人读取。

### #7a /auth/refresh 查 DB

**核实:❌ 未完成** —— `auth.ts:122-129` 直接用旧 token 的 payload 重签:

```ts
router.post('/refresh', authMiddleware, (req, res) => {
  const payload = (req as any).user as AuthPayload;
  const token = generateToken({ id: payload.userId, username: payload.username, role: payload.role });
```

**从不查库。**配合 A3 已删掉 #7b,结果是:**被降权的 admin 只要在 token 过期前调一次**
**refresh,就能无限续期 admin 身份。**这是 A3 + #7a 组合下的净损失,优先级应高于 v4 给的第 2 批。

### #8 子进程 env 最小化(补代理变量)

**修改**:给子进程显式传 `env` 白名单 —— `PATH` / `HOME` / `USERPROFILE` / `SystemRoot` /
`COMSPEC` / `TEMP` / `TMP` / `LANG` / `PATHEXT` / `windir`,加上代理三项 `HTTP_PROXY` /
`HTTPS_PROXY` / `NO_PROXY`(公司网络必需)。**不传递 `OPENAI_API_KEY` 等敏感变量。**

**核实:❌ 未完成** —— `coding/index.ts:290` 的 `execAsync(cmd, { cwd, maxBuffer, timeout })`
**根本没有 `env` 选项**,子进程继承父进程全部环境变量,包括 `OPENAI_API_KEY` 和 `JWT_SECRET`。
且 `env` / `printenv` / `set` 都不在 `BLOCKED_PATTERNS`(`:31`)里。

### #9 开启外键约束 + 扩 cleanupUserData

- **9a**:`db.pragma('foreign_keys = ON')`
- **9b**:`cleanupUserData` 扩大覆盖,把用户创建的 papers / tasks / events / conversations 一并 DELETE

**核实**:

- **9a:❌ 未显式写,但很可能是空操作** —— `db.ts:39` 只有 `journal_mode = WAL`。不过
  **better-sqlite3 默认就开外键**(与 sqlite3 CLI 相反),加上大概不改变行为。仍建议显式写一行,
  成本为零、消除歧义。
- **9b:⛔ 已否决(被更好的方案取代)** —— 见文末。仓库走软删除方案。

---

## 第 3 批:功能 bug

| 编号 | 内容 | 核实 |
|---|---|---|
| #10 | grepWalk 三个 bug | ✅ 已完成(= A6) |
| #11 | 对话历史窗口截断 | ✅ 已完成(= A1) |
| #13 | SSE close + safeEmit | ✅ 已完成(= A2a) |
| #15b | cancel 归属校验 | ❌ **未完成** |
| #16 | 权限确认改服务端决策 | ❌ **未完成** |
| #17 | setEnabled 落库 | ✅ 已完成(= A5) |

### #15b cancel 归属校验

**核实:❌ 未完成** —— `index.ts:265-266`:

```ts
app.post("/api/chat/:sessionId/cancel", authMiddleware, (req, res) => {
  cancelAgent(req.params.sessionId);
```

**不校验会话归属。**任何登录用户可以中断任何人正在跑的会话(拿到或猜到 sessionId 即可)。

### #16 权限确认(改服务端决策)

**当前问题**:客户端没有 permission_request UI(chatStore 只处理 4 种事件),卡 5 分钟后自动拒绝。

**修改**:直接拒绝并附明确原因,同时跳过 #14(pendingPermissions 清理)与 #15a
(permission-response 归属校验)—— 因为不再有 pending 需要清理。`pendingPermissions` Map 与
`PERMISSION_TIMEOUT` 可整块删掉(死代码),或保留但加注释。

**核实:❌ 未完成** —— `pendingPermissions`(`index.ts:59`)与 `PERMISSION_TIMEOUT`(`:62`)
都还在,`:430` 仍在注册 pending,前端仍无 UI。
**注意 `:408` 的 `if (pm === "bypassPermissions") return allow` 是提权链的第二环。**

---

## 第 4 批:前端 + P2 清理 + 遗漏项

| 编号 | 内容 | 文件 | 核实 |
|---|---|---|---|
| F1 | sendMessage 查 res.ok | `src/stores/chatStore.ts` | ❌ `:160` 的 `/api/chat` fetch 无 ok 检查 |
| F2 | LoginPage 去掉预填密码 | `src/pages/LoginPage.tsx` | ❌ `:56` 预填 + `:71` 明文提示 |
| F3 | ProtectedRoute 解 JWT exp | `src/components/ProtectedRoute.tsx` | ❌ 无 jwt-decode 依赖,无 exp 检查 |
| F4 | 所有 store 的 create 路径查 res.ok | `src/stores/*` | ❌ 6 个 store 的 apiFetch 数都多于 res.ok 数 |
| F5 | permission_request 不丢弃(打 warn) | `src/stores/chatStore.ts` | ❌ 零命中 |
| F6 | stop 的 stale closure | `src/stores/chatStore.ts` | ❌ `:253` 仍是 `state.streamingContent` |
| P2-1 | 删掉 /api/check-login | `server/index.ts` | ❌ `:80` 还在(已确认前端零消费) |
| P2-2 | 删掉 clearAllData | `server/db.ts` | ❌ `:599` 还在,零调用 |
| P2-3 | cleanupExpiredBlacklist 定时任务 | `server/index.ts` | 🟡 在 `auth.ts:221/231` 被顺手调,无启动调用/无定时器 |
| P2-4 | ensureAdminUser 不打印密码 | `server/db.ts` | ❌ `:355` 无条件明文打印,无生产守卫 |
| P2-5 | Express Request 类型扩展 | 新建 `server/types/express.d.ts` | ❌ 目录不存在,51 处 `req as any` |
| P2-6 | agent.ts 接入 OpenAI SDK 类型 | `server/agent.ts` | ❌ `:43` `messages: any[]` |

### F6 细节(容易看错)

```ts
// 错误(读闭包捕获的旧快照,可能为空):
content: state.streamingContent || '(已停止)',
// 正确(读最新状态):
content: get().streamingContent || '(已停止)',
```

> ⚠️ 这一行(`chatStore.ts:253`)曾被当作「Agent 中断后前端落 `(已停止)`」的**正面证据**写进
> 过进度记录。它确实是中断分支,但**本身是 v4 标记的 bug** —— 读旧快照,很可能落空字符串。

### P2-4 要求的实现

生产环境(`NODE_ENV=production`)未设 `DEFAULT_ADMIN_PASSWORD` 就**拒绝启动**;开发环境保留
`admin123` 但只打印一次提示,且生产环境**绝不打印密码**。

---

## 验收清单(v4 原文)

- [ ] `npm run typecheck` 无类型错误(验 B4 outDir 生效)
- [ ] `cp .env.example .env && npm run dev` 能正常启动(验 A7 + #2)
- [ ] 登录 → 创建会话 → 发消息 → 模型正常回复
- [ ] **同一会话发第二条消息正常**(验 A2)
- [ ] **用过工具之后再追问一句正常**(验 A1)
- [ ] 点「停止」→ 服务端不再继续执行(验 #1 + #13)
- [ ] 删除一个添加过书目/建过任务的用户仍能成功(验 B1)
- [ ] 把一个 admin 降级为 member,该用户仍能登录(验 A3)
- [ ] `grepWalk` 搜索大目录不崩(验 #10)
- [ ] 前端 `admin123` 不再预填(验 F2)

---

## v4 自身的错误(三条,不要照抄)

### 1. A2b 的写法会让「取消」永远失效 ⛔

v4 要求把 `cancelFlags.delete(sessionId)` 放进 **for 循环开头**。但循环里紧接着就是
`if (cancelFlags.has(sessionId))` 检查 —— **先删再查,用户点停止设的标记会在下一轮开头被抹掉,**
**检查永远不命中。**

仓库的实现放在循环**外面**只清一次(`agent.ts:79-82`)并写了注释。这既达到 v4 想要的目的
(清掉上次残留),又不破坏取消。**以代码为准。**

### 2. #12b 的 boolean 会多报一条错误提示 ⛔(已被更好实现取代)

v4 用 `let completed = false` + 循环末尾 `if (!completed) emit(已达最大轮数)`。问题:
**超时和用户中断也会 break 且 `completed` 仍是 false**,于是用户同时收到「执行超时」和
「已达最大轮数」两条互相矛盾的错误。

仓库用 4 态 `stopReason: 'done' | 'timeout' | 'cancelled' | 'exhausted'`(`agent.ts:91`),
只有 `exhausted` 才提示。**以代码为准。**

### 3. #9b 的 DELETE 方案会永久丢失归属 ⛔(已被更好实现取代)

v4 要求 `cleanupUserData` 把用户创建的 papers / tasks / events / conversations 一并 `DELETE`,
并在备注里提议「或改为 `UPDATE ... SET created_by = 'deleted_user'`」。

**这个备选方案是有害的** —— `db.ts:256-262` 有一段注释记录了它的后果:早先的
`deleteUserAndReassignContent()` 正是用 UPDATE 改判归属,**原始 user id 被覆盖、没有任何副本**,
那些行的真实归属**已经永久丢失,软删除也救不回来**。

仓库现在走软删除:`countUserReferences()` 先数引用,零引用才 `hardDeleteUser`,否则
`softDeleteUser` 只写 `deleted_at`、保留全部归属。**这比 v4 的两个方案都好,#9b 应作废。**

---

## 未做项串成的提权链(v4 未指出,2026-09-01 核实发现)

#3 / #16 / #8 三条未做项加上黑名单的一个缺口,合起来是一条完整的**普通成员 → admin** 提权路径。

| 环 | 位置 | 对应未做项 |
|---|---|---|
| ① `permissionMode` 由客户端传入 | `index.ts:271` → `:383` | #3 |
| ② `pm === "bypassPermissions"` 时全部工具自动放行 | `index.ts:408` | #16 |
| ③ `execAsync` 无 `env` 白名单,子进程继承全部环境变量 | `coding/index.ts:290` | #8 |
| ④ `env` / `printenv` 不在 `BLOCKED_PATTERNS` 里 | `coding/index.ts:31` | 新发现 |

任何**已登录的普通成员**发一个请求:

```
POST /api/chat
{"message":"运行 printenv","permissionMode":"bypassPermissions","cwd":"/"}
```

就能读到 `JWT_SECRET`(据此自签 admin token)与 `OPENAI_API_KEY`。`cwd` 同样来自 `req.body`
(`:384`),顺带绕开 `DEFAULT_CWD=/workspace/repos` 的目录限制。

**不是未认证可达** —— `index.ts:44` 有全局 `app.use("/api", ...)` 网关,`PUBLIC_API_PATHS`
(`:38`)只放行 `/health` `/version` `/auth/login` `/auth/refresh`,`/chat` 需要 JWT。
所以门槛是「任意有效账号」,不是匿名。

> 📌 2026-09-01 裁决:#3 + #8 + #16 并入「助手可编辑化 PR ①」优先发。

---

## 核实汇总

| 批次 | 已完成 | 未完成 | 已否决 |
|---|---|---|---|
| 第 0 批 | A1 A2a A3 A4 A5 A6a A6b A6c A7 B4 | —— | A2b(v4 写法错) |
| 第 1 批 | #1 #2a-e #12a #12b #18 | —— | —— |
| 第 2 批 | —— | **#3 #4 #5 #6 #7a #8 #9a** | #9b(被软删除方案取代) |
| 第 3 批 | #10 #11 #13 #17(均为第 0 批的重复引用) | **#15b #16** | —— |
| 第 4 批 | —— | **F1-F6 P2-1 P2-2 P2-4 P2-5 P2-6**(P2-3 部分) | —— |

**第 0 批与第 1 批全绿;第 2 / 3 / 4 批共约 19 项未做,其中 4 项构成上述提权链。**

待办与排期见 `docs/pending-work.md`。
