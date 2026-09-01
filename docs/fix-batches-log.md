# ProCoder 修复批次执行记录

> 本文档记录 v4 修复指令的分批执行情况,用于追溯「改了什么 / 为什么这么改 / 验证到什么程度」。
> 与 [optimization-plan.md](./optimization-plan.md) 的关系:那份是 Phase 8–12 的功能路线图,
> 本文档是 code review 导出的缺陷修复批次,两者独立并行。

**状态总览**

| 批次 | 内容 | 状态 |
|---|---|---|
| 第 0 批 | A1–A7 + B4(启动/配置/基础设施) | ✅ 已完成并验证 |
| 第 1 批 | #1 #2 #12 #18 | ✅ 已完成并验证 |
| 类型清零 | 补 dayjs + todo 校验 + EventCard 签名 | ✅ `tsc -b` 全绿,前端恢复可构建 |
| **#9** | 删除用户挂死(线上故障,已提前处理) | ✅ 已完成并端到端验证 |
| PR #2 | `/api/version` 部署版本自省端点 | ✅ 已合并 |
| PR #3 | `build` 加入 `tsc -b`,类型错误不再带上线 | ✅ 已合并 |
| PR #4 | 删除用户改为软删除(注销),保留内容与发言归属 | ✅ 已合并 |
| PR #5 | 用户增加 `department` 字段,用于同名同事消歧 | ✅ 已合并 |
| **登录端点崩溃 P0** | asyncHandler + 登录入参类型守卫 + 进程级兜底 | ✅ 已完成,四场景变异 + 15 项端到端验证 |
| 第 2 批其余 | #3–#8 | ⬜ 未授权 |
| 第 3 批 | #10 #11 #13 #15b #16 #17 | ⬜ 未授权 |
| 第 4 批 | F1–F6 + P2-1..P2-6 | ⬜ 未授权 |

**当前可用状态**:`npm run build` 后 `npx tsx server/index.ts`,访问
`http://localhost:3000` 可测完整应用。`tsc -b` 退出码 0,`vitest` 16/16。

---

## 一、本次执行的重大前提修正

### better-sqlite3 默认开启外键约束

v2 → v4 的指令一直写着「FK 未开启,删用户的外键洞属于潜在隐患」,据此把 `#9` 排到第 2 批。

**这个前提是错的。** 实测:

```js
new Database(':memory:').pragma('foreign_keys', { simple: true })  // === 1
```

better-sqlite3 与 sqlite3 CLI 相反,开连接时默认 `foreign_keys = ON`,`server/db.ts` 里
无需也不该再补 `PRAGMA foreign_keys = ON`。

**因此外键一直在生效**,`#9` 不是隐患而是**当前线上故障**:

- `users` 上共 10 个外键引用,其中 7 个为 `ON DELETE NO ACTION`(会阻塞删除)
- `db.cleanupUserData()` 覆盖了 `im_messages.sender_id` / `task_comments.user_id` / `paper_notes.user_id`
- **仍漏 4 个「归属」列**:`conversations.created_by`、`tasks.created_by`、
  `events.created_by`、`papers.added_by`
- 后果:`DELETE /api/auth/users/:id` 删一个建过群 / 加过文献 / 建过任务或日程的用户时,
  `db.deleteUser` 抛 `SQLITE_CONSTRAINT_FOREIGNKEY`。且 Express 4 不捕获 async handler 的
  rejection,请求**挂死不返回**(不是 500),用户也没被删掉。

**这条前提错误是靠实测撞出来的,不是静态阅读得出的。** 教训:判断 SQLite 外键行为前先跑 pragma。

---

## 二、第 0 批(已完成)

### A1 · 历史消息窗口

`server/index.ts` 原先无上限读取整个会话历史,长会话会把上下文打满导致 400。
改为只取最近 `MAX_HISTORY_MESSAGES`(默认 20)条。

**刻意未做**:没有一并回放 `tool_calls`。原因是 `messages.role` 上有
`CHECK (role IN ('user','assistant'))`,库里不存在 `tool` 角色的行;而 OpenAI 协议要求带
`tool_calls` 的 assistant 消息必须紧跟对应的 `tool` 消息,否则整个请求被拒。
要恢复跨轮工具上下文得先改 schema,是独立一项。

### A2 · SSE 生命周期

- `emit()` 加 `isClosed || res.writableEnded` 守卫,避免向已结束的响应写入
- `req.on('close')` 断开时中断 Agent,**但必须用 `writableEnded` 区分正常收尾**——
  `close` 在响应正常结束后也会触发,不加判断会让每次请求都残留一个 cancel 标记,
  把该会话的下一条消息在第 0 轮打断
- `startHeartbeat` 在 `writableEnded` 时清理自身 interval

### A3 / A4 · 经核实为空操作

- **A3**:要求在 `PATCH /users/:id` 中移除 `blacklistUserTokens` 调用 —— 该调用从未存在
  (v4 假定的 7b 从未实现)
- **A4**:要求解决 `DEFAULT_SYSTEM_PROMPT` 变量冲突 —— `index.ts` 原本读取正确,
  冲突是 v4 自身的重命名引入的

两项均未改动代码,已如实上报。

### A5 · Skill 启用状态持久化

v4 的代码片段直接访问 `skillRegistry.skills`(private 字段,TS 报错),且存在启动期顺序错误:
用会落库的 setter 应用静态默认值,会在读取 DB 之前就把持久化状态覆盖掉。

改为拆分职责:

| 方法 | 行为 | 调用方 |
|---|---|---|
| `has(name)` | 公开的存在性判断 | 替代 private 字段访问 |
| `applyEnabled(name, enabled)` | 仅改内存 | `skills/index.ts` 启动期 |
| `setEnabled(name, enabled)` | 内存 + 落库 | `routes/settings.ts` 管理接口 |

`registerBuiltinSkills()` 顺序修正为:**先读** `db.getSystemConfig('skill_registry')` →
应用静态默认值 → 让持久化值覆盖。

### A6 · dotenv 加载时机

`import "dotenv/config"` 提到所有 import 之前。ESM 的求值顺序意味着:只要它不是第一个,
`auth.ts` / `db.ts` / `agent.ts` / `ws.ts` 在模块作用域读 `process.env` 时就还是空的。

### A7 · JWT_SECRET — 已声明的偏离

**v4 原文要求**:`.env.example` 中 `JWT_SECRET` 留空,使启动失败以强制用户设置。

**冲突**:这与 v4 自己的验收清单「`cp .env.example .env && npm run dev` 能正常启动」直接矛盾。

**实际实现**(开发宽松 / 生产严格,沿用已获批准的 P2-4 模式):

- 有强 secret → 直接使用
- 弱 secret(`change-me-in-production` 等黑名单)或空 + `NODE_ENV=production` → 打印生成方式后 `exit(1)`
- 弱或空 + 非生产 → 生成随机 secret 并**持久化到 `data/.jwt-secret`**

持久化是必需的:`tsx watch` 每次存盘都会重载模块,若每次重新生成会导致所有人在每次编辑后掉线。

同时新增共享的 `verifyToken()`,`ws.ts` 删掉了自己那份重复的
`JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production'` 改为复用——
比 v4 提出的「复制一份校验逻辑」更彻底地关闭了 #2e。

### B4 · 构建配置

`tsconfig.node.json` 补 `target: ES2022` / `lib: ["ES2022"]`。
**缺失 target 时 tsc 默认 ES5**,`for...of` 遍历 Map/Set 直接报 TS2802,
而且报错会让被遍历变量退化成 `any`、连带触发一串 implicit-any 误报。
另加 `outDir: ./.tsbuild` 并写入 `.gitignore`。

---

## 三、第 1 批(已完成)

| 编号 | 内容 |
|---|---|
| **#1** | `runCodingAgent({...})` 补传 `sessionId`,中断机制才真正接通 |
| **#2** | `ws.ts` 复用 `auth.ts` 的 `verifyToken`,消除重复的 secret 定义(见 A7) |
| **#12** | Agent 循环退出原因改为四值 `stopReason` |
| **#18** | 删除 `db.ts` 中重复的 `system_config` 建表语句;新增 `deleteConversation()` |

### #12 的两处纠正(v4 原方案会引入 bug)

**1. 取消标记的清理位置。** v4 的 A2b 把 `cancelFlags.delete(sessionId)` 放进循环体。
但 `agent.ts` 循环顶部的真实顺序是 **超时检查 → 取消检查**,在其之前 delete 会让
`has()` 永远为 false,**取消功能彻底失效**。正确做法是在循环**外**只清一次。

**2. `completed` 布尔量会重复报错。** v4 用单个 boolean 判断是否提示「已达最大轮数」,
但 timeout / cancel 的 `break` 同样会留下 `completed === false`,导致超时或中断时
额外多报一条「已达最大轮数」。改为四值枚举,只有 `'exhausted'`(真把轮数跑完)才提示:

```ts
let stopReason: 'done' | 'timeout' | 'cancelled' | 'exhausted' = 'exhausted';
```

### 附带修复的 grepWalk(`skills/coding/index.ts`)

原实现有 4 个缺陷,全部修正:

1. **正则复用 `g` 标记** —— `RegExp` 带 `g` 时携带 `lastIndex` 状态,跨行复用同一实例会静默漏匹配
2. **大文件终止整个目录** —— 超过 1MB 时 `return` 应改为 `continue`,否则该目录后续文件全被跳过
3. **相对路径基准错误** —— 递归时需同时传入 `startDir` 作为 `path.relative` 的基准
4. **计数器按栈帧独立** —— 文件计数改为共享的 `state` 对象,上限才真正生效

---

## 四、验证方式与结果

> 这是本仓库**第一次真正跑起验证**。此前所有 review 结论均为静态阅读,无运行期证据。

环境:Node v24.18.1 / npm 11.11.0

### 类型检查:12 条 → 5 条

补 `target` 一次消掉 4 条(3 × TS2802 + 1 条级联 implicit-any + 测试文件的 top-level await)。
另修 2 条落在本批文件内的:

- `db.ts` — 显式标注 `const db: Database.Database`,解 TS4023(composite 项目要发 .d.ts,
  否则 tsc 无法为 better-sqlite3 内部类型取名)
- `auth.ts` — `expiresIn` 断言到 `jwt.SignOptions['expiresIn']`
  (@types/jsonwebtoken v9 把它收窄成 `number | StringValue`,而 env 值只能是 string)

**剩余 5 条全部是既有错误,均不在第 0/1 批碰过的文件中,故未改动:**

| 位置 | 问题 |
|---|---|
| `server/skills/todo/index.ts:101` | `priority` 未校验就赋给联合类型字段 |
| `src/components/Calendar/CalendarView.tsx:161` | `EventCard.onClick` 声明为 `() => void`,实参需 `e.stopPropagation()` |
| `EventDetailDrawer.tsx` / `NewEventModal.tsx` | 找不到模块 `dayjs` |

**`dayjs` 的来历已查明**:锁文件中曾存在 `@tdesign-react/chat/node_modules/dayjs`,
dayjs 原本靠 tdesign 传递引入;tdesign 被移除后这两个组件的 import 就悄悄断了,
`node_modules` 中现已没有 dayjs —— **前端目前是真的构建不了**。修复 = `package.json` 补一行。

### 单元测试:13/13 通过,并做了变异验证

新增 vitest + 3 个测试文件。**通过不等于有效**,故对每个守卫做反向变异确认:

| 变异操作 | 结果 |
|---|---|
| 把 `cancelFlags.delete` 挪回 v4 A2b 的位置(循环内、检查前) | 🔴 1 failed |
| grep 正则加回 `g` 标记 | 🔴 1 failed |
| 大文件 `continue` 改回 `return` | 🔴 3 failed |

`tests/delete-user.test.ts` 中涉及 `#9` 的两个用例用 **`it.fails`** 标记 ——
它们**当前必须抛错**。等 `#9` 落地、删除不再抛错时 `it.fails` 会自行变红,
强制改回普通 `it`,不会出现「修好了却没人发现」的情况。

**已知局限**:`db.ts` 在模块加载时把路径硬编码为 `data/chat.db`,没有注入点,
所以 DB 测试直接跑在开发库上,靠 `finally` 自行清理。彻底隔离需要支持 `DB_PATH`
环境变量 —— 列为独立一项。

### 启动验证

`cp .env.example .env && npx tsx server/index.ts` 实测:

```
[Auth] 未设置 JWT_SECRET,已生成随机密钥并写入 data/.jwt-secret(仅限开发环境)
[SkillRegistry] 已加载 Skill: coding(off), todo, calendar, literature
GET /api/health          -> 200
POST /api/auth/login     -> 返回带 jti 的有效 JWT
启动后错误日志            -> 无
```

确认两件事:A7 的偏离让验收清单那条**依然通过**;日志中的 `coding(off)` 说明
A5 的持久化路径生效(库中状态正确覆盖了静态默认值)。

### 一次差点误报的阻塞

`npm install` 因 better-sqlite3 编译失败(无 Node 24 预编译包 → node-gyp →
`Could not find any Visual Studio installation to use`)而**整体回滚**,node_modules 变空。
差一步就上报「本机装不上,请选择装 VS Build Tools / 降 Node / 锁版本」。

实际:`npm install --ignore-scripts` + **单独 `npm rebuild better-sqlite3` 一次成功**,
prebuild-install 有 Node 24 的预编译包。**该阻塞不存在**。
教训:报告环境问题前必须单独 rebuild 并 `require()` 实测,不能把整体 install
的失败当作单包结论。

---

## 五、后续批次

### `#9` 已完成(从第 2 批提前处理)

**实现方式**(Owner 裁决「保留」):新增占位账号 `__deleted_user__`(显示名「已注销用户」),
4 个归属列改判给它,内容保留;成员关系列照旧删除。

关键点:

- `deleteUserAndReassignContent()` 把「改判 → 清理 → 删除」放进**单个事务**。
  原先路由是 `cleanupUserData()` 和 `deleteUser()` 两次独立提交,后者失败会留下
  已提交的半截修改(内容改判了但用户还在)
- 路由补 `try/catch`,失败返回 500 而非让请求挂死
- `getAllUsers()` 排除占位账号,否则它会出现在成员选择器和 Agent 的 `list_users` 结果里
- 占位账号 `password_hash` 存 `'!'`(非法 bcrypt hash,`compare` 恒 false,实测不抛错),
  且 `deleteUser` 拒绝删除它自身

**两个差点致命的坑**:

1. `ensureAdminUser()` 原先靠 `COUNT(*) FROM users === 0` 判断是否创建管理员。
   占位账号一旦存在,**全新库就永远不会创建管理员,结果是没有任何人能登录**。
   计数已改为排除占位账号(而非只靠调用顺序)。
2. `DELETED_USER_ID` 必须声明在文件顶部。`ensureAdminUser()` 在模块加载期
   (db.ts:208 附近)就会用到它,而 `const` 不像函数声明那样提升,放在后面会因 TDZ 抛
   `ReferenceError: Cannot access 'DELETED_USER_ID' before initialization`,
   **导致 db.ts 加载失败、整个服务起不来**。这个坑是测试当场抓出来的。

**端到端验证**:admin 删除一个建过群并在群里发过言的用户 → 返回 `200 {"success":true}`
(原先永久挂死),用户已删,群记录保留且 `created_by` 变为 `__deleted_user__`,服务端零报错。

### 仍待处理:用户的历史消息是删还是留?

`cleanupUserData` 原有行为是**删除** `im_messages.sender_id` / `task_comments.user_id` /
`paper_notes.user_id` 对应的行,`#9` 保持了这个行为没有改动。

但按「保留内容」的同一逻辑,群聊里的历史消息同样属于**其他人的上下文** ——
删掉一个人的发言会让群聊记录出现断裂。是否也改判给占位账号,涉及
「上下文完整性 vs 用户数据擦除权」的产品取舍,**留给 Owner 裁决**,未擅自改动。

### 第 2 批其余项(#3–#8)

按 v4 编号跟踪,其中已明确的:

- **#4 · `AGENT_PROMPTS` 键名对齐**:后端键改为 `default` / `research` / `writing`,
  前端补 `agentId: state.currentAgentId` 一行
- **#5 · 模型解析**:引入 `resolveModel(requested, role)`,查询 `member_models` 表

### 第 3 批 / 第 4 批

`#10` `#11` `#13` `#15b` `#16` `#17` 及 `F1–F6` / `P2-1..P2-6`,均未授权,按 v4 编号跟踪。

### 独立列出的技术债

1. `db.ts` 支持 `DB_PATH` 环境变量(测试隔离前置条件 —— 目前 DB 测试跑在开发库上)
2. `messages` 表 schema 扩展以支持回放 `tool_calls`(A1 未做的部分)
3. ~~**Express 4 缺少统一的 async 错误捕获**~~ —— **已完成**,见下节「登录端点崩溃」。
   ⚠️ 这一条原先的描述是**错的**:写的是「让请求挂死不返回,而不是回 500」。
   实测(Node v24.18.1)是**整个进程退出**,不是挂死。定级从体验问题上调为 P0 可用性缺陷。
4. `dist/` 构建产物体积 1.35 MB(gzip 432 KB)未做分包

---

## 登录端点崩溃(P0,2026-08-31)

### 现象

一条**不需要任何凭证**的请求能让整个服务进程退出:

```bash
curl -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":12345}'
```

复现两次,均为 `/api/health` 200 → 打这一条 → `/api/health` 000(连不上)。
调用链:`server/routes/auth.ts` → `server/auth.ts:104` → `bcryptjs/index.js:252`
抛 `Illegal arguments: number, string`。

同一类问题在 `/api/auth/register`(`username` 传 `true`/对象/数组 → better-sqlite3
绑定参数抛 `Invalid value`)和 `/api/chat`(`{"message":123}` → `message.slice()`)上都存在,
后者需要认证,前者不需要。

### 为什么之前没发现:先前的结论是错的

技术债 #3 记的是「请求挂死不返回」。**这个结论来自 vitest 里的观察,而 vitest 会自己
注册 `unhandledRejection` 处理器** —— 它把进程崩溃转成了一个挂起的请求。也就是说
**在同进程内测试这类缺陷,结构上就看不见真实后果**,只会得到一个偏轻的定级。

这是本次把回归测试改成**拉起真实子进程**的直接原因,不是风格偏好。

### 修法:三层,每层都可独立证明是承重的

| 层 | 位置 | 作用 |
|---|---|---|
| 入参类型守卫 | `server/routes/auth.ts` | 非字符串入参直接 400,而不是让它流到 bcrypt/SQLite |
| `asyncHandler` + 错误中间件 | `server/async-handler.ts`、`server/index.ts` | async handler 的 reject 转成 500;SSE 已发头时改写流内错误事件 |
| 进程级 `unhandledRejection` | `server/index.ts` | 兜住漏包 `asyncHandler` 的 handler,记日志但不退出 |

三点实现细节值得记:

- 错误中间件**必须写满 4 个参数**。Express 靠参数个数区分错误中间件和普通中间件,
  少写一个 `next` 它会被当普通中间件,永远不被调用。
- **只拦 `unhandledRejection`,不拦 `uncaughtException`**。同步异常本来就会被 Express
  路由到错误中间件;真正逃到 `uncaughtException` 说明进程状态已不可信,咽下去继续跑
  比退出更危险。
- 错误响应**刻意不回显 `err.message`** —— 它可能带 SQL 片段、文件路径或口令哈希。

### 顺手修掉的一个登录门槛

`/register` 对 `username` 做了 trim,`/login` 没做。库里的 `username` 绝不带首尾空格,
所以手机输入法或浏览器自动填充带出来的**一个尾随空格就让人永远登不进去**,而提示是
「用户名或密码错误」—— 没有任何线索指向空格。已对齐。口令**不 trim**:首尾空格是
合法口令内容。

### 验证

`npm run test:crash` 拉起真实子进程,逐层剥掉修复看行为是否退化:

| 场景 | 剥掉的层 | 期望 |
|---|---|---|
| M0 | 无(基线) | 400,进程存活 |
| M1 | 类型守卫 | 500,进程存活 |
| M2 | + asyncHandler | 请求挂起,进程存活 |
| M3 | + 进程兜底(= 修复前状态) | 连接失败,**进程已死** |

**M3 必须复现原始崩溃**,否则这套断言是空的 —— 它证明的是「这三层里没有一层是
装饰品」。四场景全部符合预期。

其余:`tsc -b` 0 错误;`npm run build` 0 错误;vitest 49/49(含新增
`tests/login-hardening.test.ts` 9 项);反向变异 20/20 守卫有测试覆盖;
真实服务端到端 15/15。开发库核对完毕:仅剩 `admin` 与 `__deleted_user__`,
`foreign_keys = 1`,孤儿行 0,残留测试账号 0。

### 遗留

`tests/login-hardening.test.ts` 的文档块里写明了它**能**证明什么(400/401 行为)和
**不能**证明什么(服务是否存活),并指向 `npm run test:crash`。这个分工是刻意的,
不要把崩溃类断言搬回 vitest。
