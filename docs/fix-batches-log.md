# ProCoder 修复批次执行记录

> 本文档记录 v4 修复指令的分批执行情况,用于追溯「改了什么 / 为什么这么改 / 验证到什么程度」。
> 与 [optimization-plan.md](./optimization-plan.md) 的关系:那份是 Phase 8–12 的功能路线图,
> 本文档是 code review 导出的缺陷修复批次,两者独立并行。

**状态总览**

| 批次 | 内容 | 状态 |
|---|---|---|
| 第 0 批 | A1–A7 + B4(启动/配置/基础设施) | ✅ 已完成并验证 |
| 第 1 批 | #1 #2 #12 #18 | ✅ 已完成并验证 |
| 第 2 批 | #3–#9 | ⬜ 未授权 · **#9 建议提前** |
| 第 3 批 | #10 #11 #13 #15b #16 #17 | ⬜ 未授权 |
| 第 4 批 | F1–F6 + P2-1..P2-6 | ⬜ 未授权 |

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

### 建议调整:`#9` 从第 2 批提前单独处理

理由见第一节 —— 它是当前线上故障(请求挂死),且守卫测试已就位。

**已裁决的实现方向(Owner 拍板「保留」)**:删除用户时**保留其内容**,把归属改判给占位用户
`__deleted_user__`,而非 v4 原方案的 `DELETE`。

理由:那 4 个漏掉的列全是**共享内容的归属列**(群聊 / 任务 / 日程 / 文献)。
直接 DELETE 会连带销毁其他用户的上下文——删掉一个建群的人就会让整个群和全部消息消失。
且即便 DELETE 也仍需另行修补群聊的外键洞。

### 第 2 批其余项(#3–#8)

按 v4 编号跟踪,其中已明确的:

- **#4 · `AGENT_PROMPTS` 键名对齐**:后端键改为 `default` / `research` / `writing`,
  前端补 `agentId: state.currentAgentId` 一行
- **#5 · 模型解析**:引入 `resolveModel(requested, role)`,查询 `member_models` 表

### 第 3 批 / 第 4 批

`#10` `#11` `#13` `#15b` `#16` `#17` 及 `F1–F6` / `P2-1..P2-6`,均未授权,按 v4 编号跟踪。

### 独立列出的技术债

1. `db.ts` 支持 `DB_PATH` 环境变量(测试隔离前置条件)
2. `messages` 表 schema 扩展以支持回放 `tool_calls`(A1 未做的部分)
3. 清零剩余 5 条既有类型错误(含 `dayjs` 依赖缺失导致的前端构建失败)
4. Express 4 的 async handler 缺少统一错误捕获 —— 任何 handler 内的异常都会让请求挂死
