# 待办汇总(2026-09-01)

> 这份文档只做**汇总与对账**,不新增需求。每一条状态都是当天用 grep/读码核实过的,
> 不是照抄旧文档。核实不了的地方明确标注「内容缺失」,没有猜。

## 先说一个记录本身的问题:三套编号并存(其中一套的内容已于 2026-09-01 找回)

| 来源 | 编号体系 | 内容是否可查 |
|---|---|---|
| `docs/fix-batches-log.md` | `#1`–`#17`、`F1`–`F6`、`P2-1`..`P2-6` | ❌ **大部分查不到** |
| `docs/optimization-plan.md`(831 行) | `Phase 8`–`Phase 12` | ✅ 完整,含代码样例与验收标准 |
| 本次新定的方案 | `PR ①②③′` | ✅ 见下 |

两个必须记下来的隐患:

1. **定义 `#N` 编号的那份「v4 指令」文档不在仓库里。** `fix-batches-log.md` 只按编号跟踪进度,
   没有抄录内容。所以下面 B 组里 **20 多个编号我只能列出号码,列不出它们要改什么** ——
   已完成的 `#4` `#5` 是例外(日志里记了)。这些编号目前**没有任何可执行信息**。
2. **`docs/optimization-plan.md` 至今未提交**(`git status` 里是 `??`)。831 行、唯一一份内容完整的
   规划文档却不在版本控制里,误删就没了。建议尽快提交。

---

## 一、已完成(用于对账)

### 已合并的 PR

| PR | 内容 |
|---|---|
| #2 | `/api/version` 部署版本自省端点 |
| #3 | `build` 加入 `tsc -b`,类型错误不再带上线 |
| #4 | 删除用户改为软删除(注销),保留内容与发言归属 |
| #5 | 用户增加 `department` 字段,同名同事消歧 |
| #6 | 登录端点崩溃 P0(详见本节末) |

### Phase 8–12 里已做掉的(本次 grep 核实)

| 项 | 证据 |
|---|---|
| 8.1 命令执行沙箱 | `server/skills/coding/index.ts` 有 `BLOCKED_COMMANDS` / `validateCommand` |
| 8.2 JWT 吊销机制 | `server/db.ts` 有 `token_blacklist` 表 |
| 9.1 SSE 心跳 | `server/index.ts` 有 `startHeartbeat` |
| 9.2 Agent 超时与中断 | `cancelAgent` + `tests/agent-cancel.test.ts` |
| 11.1 统一 UI 框架 | 已在用 antd `^6.6.1` + `@ant-design/icons ^6.3.2` |

Skill 开关(12.3 的一部分)也已有:`server/skills/registry.ts:69` 的 `setEnabled` + 设置页开关。
**但 12.3 要求的「动态加载」未核实**,不能算完成。

### 已修的严重问题(PR #6,2026-08-31)

一条**无需凭证**的 curl 能打死整个服务进程:`POST /api/auth/login` 传 `password` 为数字 →
bcryptjs 抛异常 → Express 4 不接管 async reject → Node 默认 throw → 进程退出。
修法三层(入参类型守卫 / `asyncHandler` + 全局错误中间件 / 进程级 `unhandledRejection`),
四场景变异验证,M3 复现原始崩溃以证明断言非空。

**同时纠正了一条错误定级**:此前技术债记的是「请求挂死不返回」、定 P2 —— 那结论来自 vitest,
而 vitest 自己注册了 `unhandledRejection` 处理器,把进程崩溃掩盖成了挂起。
**教训:崩溃类缺陷不能只在同进程内测**,已固化为 `npm run test:crash`。

---

## 二、A 组:助手可编辑化(已定方案,待开工)

起因:「办公助手的模型是硬编码写死的,能做成可编辑吗」。查完的结论是**真正硬编码的不是模型,
是助手预设** —— 加一个助手今天要改源码 4 处,其中 2 处漏改不报错(静默显示成办公助手的欢迎语):

- `src/config/agents.ts:9` — id/name/icon/systemPrompt
- `server/routes/settings.ts:57` — id/name/icon(**无 prompt**,与上面手工同步)
- `src/components/Chat/NewChatView.tsx:19` — `WELCOME`
- `src/components/Chat/NewChatView.tsx:25` — `QUICK_ACTIONS`

**范围已按成本质疑砍过**:密钥与模型列表**继续留 `.env`,不进库、不加密**。理由:`.env` 本就是
放密钥的正确位置(已 gitignore、不进 DB 备份);进库唯一买到的是「免重启」,而发布本来就走部署
agent,重启已在流程内 —— 收益接近零,却新造一条泄露面。

| PR | 内容 | 规模 | 依赖 |
|---|---|---|---|
| **①** | **已扩范围(含 P0)**:抽 `server/model-registry.ts` 收敛散在 5 文件 **9 处** 的 `process.env.OPENAI_*`;`/api/chat` 改收 `agentId`,服务端接管 `model` / `permissionMode` / `cwd` / `systemPrompt`(即 v4 **#3**);子进程 `env` 白名单(v4 **#8**);权限确认改硬拒绝并清掉 `pendingPermissions` 死代码(v4 **#16**);`env`/`printenv` 入黑名单 | ~350 行 | 无 |
| **②** | 助手预设进库 + Agent 管理 UI(填掉 `SettingsPage.tsx:15` 的 `Empty`),删掉 `src/config/agents.ts` | ~450 行 | ① |
| **③′** | `.env` 供应商槽位(`deepseek-chat@DEEPSEEK` + `PROVIDER_*`),多厂商并存,仍需重启 | ~80 行 | ① |

### ① 附带修掉的问题(2026-09-01 扩范围后)

**扩范围的理由**:v4 的 #3 改的就是 PR ① 要动的那一段参数解析(`index.ts:271`)。
#3 未做正是 P0 提权链的第一环,分开做等于改两遍还会冲突。见第三节。

- **`member_models` / `member_agents` 两道权限目前是纯装饰。** `server/index.ts:272` 直接取 body 的
  `model` 和 `systemPrompt`,无任何服务端校验(`index.ts:399` 把客户端传来的 `systemPrompt` 原样
  当 system message)。任何登录用户一条 curl 就能用任意模型、注入任意 system prompt。
- ~~**`/api/models` 没有 `authMiddleware`** —— 未登录也能列举模型清单。~~
  ⚠️ **这条是我写错的,2026-09-01 更正**:`index.ts:44` 有全局 `app.use("/api", ...)` 网关,
  `PUBLIC_API_PATHS`(`:38`)只放行 `/health` `/version` `/auth/login` `/auth/refresh`。
  `/models` 不在其中,**认证是生效的**。我当初只看了 `app.get("/api/models", ...)` 这一行
  没挂中间件就下了结论 —— 教训:Express 的认证可能在上游 `app.use` 里,不能只看路由那一行。
- backlog `#5`:`conversations.ts:213` 与 `papers.ts:149` 忽略用户的模型选择,硬用 env 默认值。

### 线上配置形状(2026-09-01 Owner 提供,据此判定 ① 行为中性)

| 项 | 值 |
|---|---|
| `OPENAI_BASE_URL` | `token-plan.cn-beijing.maas.aliyuncs.com`(阿里云百炼 OpenAI 兼容端点) |
| `OPENAI_MODEL` | `qwen3.7-plus` |
| `OPENAI_MODELS` | 空 |
| `DEFAULT_SYSTEM_PROMPT` | 未设置 → 实际生效的是 `index.ts:359` 内联文案 |

由此确定:允许列表当前只有一个成员,**① 加 allow-list 前后结果不变**;② 的播种改用
`system_prompt = ''` 哨兵值(空 = 回落到内联文案),避免长 prompt 在代码和库里各存一份后分叉。

### 零成本的一步(不需要任何 PR)

百炼那个端点本身就供多个 Qwen 模型。在线上 `.env` 把 `OPENAI_MODELS` 填上几个 id、重启,
下拉框立刻可选(并从灰变可点 —— `ChatInput.tsx:59` 是 `disabled={models.length <= 1}`)。
可用 id 用 `curl $OPENAI_BASE_URL/models -H "Authorization: Bearer $OPENAI_API_KEY"` 取。

详细方案:`~/.claude/projects/d-------coding-Git-repo/plans/model-agent-editable.md`

---

## 三、B 组:`#N` / `F1-F6` / `P2-N` 编号 —— **已找回并逐条核实**

> **2026-09-01 更新**:Owner 提供了 v4 原文,已转录归档为 `docs/fix-plan-v4.md`,
> 并逐条核实到代码。这一节此前写的「内容缺失、不具备可执行性」**已作废**。

### 结论:第 0 批与第 1 批全绿,第 2/3/4 批约 19 项未做

| 批次 | 已完成 | 未完成 | 已否决 |
|---|---|---|---|
| 第 0 批 | A1 A2a A3 A4 A5 A6a-c A7 B4 | —— | A2b |
| 第 1 批 | #1 #2a-e #12a #12b #18 | —— | —— |
| 第 2 批 | —— | **#3 #4 #5 #6 #7a #8 #9a** | #9b |
| 第 3 批 | #10 #11 #13 #17(第 0 批的重复引用) | **#15b #16** | —— |
| 第 4 批 | —— | **F1-F6 P2-1 P2-2 P2-4 P2-5 P2-6**(P2-3 部分) | —— |

### 🔴 P0:四条未做项串成 member → admin 提权链

v4 把 #3 / #8 / #16 分散在两个批次里,**没有指出它们合起来是一条完整路径**:

| 环 | 位置 | 未做项 |
|---|---|---|
| ① `permissionMode` 由客户端传入 | `index.ts:271` → `:383` | #3 |
| ② `bypassPermissions` 时全部工具自动放行 | `index.ts:408` | #16 |
| ③ `execAsync` 无 `env` 白名单,子进程继承全部环境变量 | `coding/index.ts:290` | #8 |
| ④ `env` / `printenv` 不在黑名单里 | `coding/index.ts:31` | 新发现 |

任何**已登录的普通成员**发 `POST /api/chat` 带
`{"permissionMode":"bypassPermissions","cwd":"/","message":"运行 printenv"}`,
即可读到 `JWT_SECRET`(自签 admin token)和 `OPENAI_API_KEY`。

**不是未认证可达** —— `index.ts:44` 的全局网关要求 JWT,门槛是「任意有效账号」。

> 📌 **裁决(2026-09-01)**:#3 + #8 + #16 **并入 PR ①** 一起发。
> 理由:#3 改的就是 PR ① 要动的那一段参数解析(`index.ts:271`),分开做等于改两遍还会冲突。

### 🟠 P1:A3 与 #7a 的组合造成净损失

v4 的 A3 要求**删掉** #7b(改 role 时吊销 token),因为原实现会让降权用户**永久无法登录**。
这一条正确地做了。但 A3 明确说「保留 #7a(refresh 查 DB)作为兜底」—— **#7a 没做**。

`auth.ts:122-129` 的 refresh 直接用旧 payload 重签 role,从不查库。结果:
**被降权的 admin 只要在 token 过期前调一次 refresh,就能无限续期 admin 身份。**

修法很小(refresh 里 `db.getUser(payload.userId)` 取当前 role 再签),建议紧随 PR ① 之后。

### 其余未做项(按性质分组)

**安全加固** —— #4 `resolveWithin` 无 realpath,符号链接可逃逸(且现有
`rel.startsWith('..')` 会误拒 `..foo` 这类合法文件);#5 todo skill 无 mutation 归属校验;
#6 `ws.ts:9` 是 `origin: '*'` 且不查 token 黑名单;#15b cancel 端点不校验会话归属,
任何登录用户可中断他人会话。

**前端健壮性** —— F1 `/api/chat` 的 fetch 不查 `response.ok`(4xx 的错误体被当 SSE 解析,
静默无输出);F4 六个 store 都有 `apiFetch` 后直接 `.json()` 的路径;F3 无 JWT `exp` 检查;
F5 收到 `permission_request` 静默丢弃。

**F6 需要更正一处旧记录** —— `chatStore.ts:253` 的 `state.streamingContent` 是 v4 标记的
stale closure bug(应为 `get().streamingContent`)。**这一行曾被当作 9.2「中断后落 (已停止)」**
**的正面证据写进核实记录**;它确实是中断分支,但本身有 bug,读旧快照很可能落空字符串。

**凭据卫生** —— F2 登录页预填 `admin123` 且明文提示;P2-4 `db.ts:355` 无条件把管理员密码
打进日志、无生产守卫。⚠️ 而 `docker-compose.yml:21-22` 的注释**承诺**了
「生产缺 `DEFAULT_ADMIN_PASSWORD` 会拒绝启动(见 db.ts)」—— **`db.ts` 里没有这个守卫**,
注释在骗人。

**死代码与类型** —— P2-1 `/api/check-login`(前端零消费)、P2-2 `clearAllData`(零调用)、
P2-5 无 `server/types/express.d.ts`(51 处 `req as any`)、P2-6 `agent.ts:43` `messages: any[]`。
P2-3 `cleanupExpiredBlacklist` 已在登录/注销路径被顺手调用,只缺启动调用与定时器,属 🟡。

### v4 有三条不能照抄

| 条目 | 问题 | 以什么为准 |
|---|---|---|
| A2b | 要求把 `cancelFlags.delete()` 放进循环开头 —— 会在 `has()` 检查前抹掉标记,**取消永远失效** | 代码(放循环外,`agent.ts:79-82` 有注释) |
| #12b | 用 boolean `completed` —— 超时/中断也会让它为 false,**同时报两条矛盾错误** | 代码(4 态 `stopReason`,`agent.ts:91`) |
| #9b | 要求 DELETE 用户创建的内容,备注还提议 UPDATE 改判归属 —— **后者会永久丢失原始归属**,`db.ts:256-262` 记录了这个后果 | 代码(软删除 + `countUserReferences`) |

**这三条应从待办中永久移除**,不是「还没做」。

### #4 之外还有一条 v4 写对了、现有代码写窄了

现有 `resolveWithin` 的越界判断是 `rel.startsWith('..')`,v4 给的是
`rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)`。
前者会误拒名为 `..foo` 的合法文件。修 #4 时一并按 v4 的三段式写。

## 四、C 组:Phase 8–12 未完成项(内容完整,可执行)

> **2026-09-01 逐条核实过 `docs/optimization-plan.md` 全部 12 节**,结论写进了该文档:
> 顶部有总览表,每节标题下有核实依据。**8.1 / 8.2 / 9.2 已全部完成,11.1 代码已完成**
> —— 也就是说批 3/批 4 不是整块未动,进度比原文档呈现的靠前。
> 下表只列**仍未完成**的部分。

| 项 | 内容 | 状态 | 备注 |
|---|---|---|---|
| 9.1 | SSE 自动重连 | 🟡 部分 | **原表漏了这一项**。后端心跳已有(`index.ts:254`),但前端用 `fetch`+`ReadableStream` 而非 `EventSource`,**无自动重连**,断流要手动重发 |
| 10.1 | 浏览器推送 Web Push | ⬜ 未做 | 全仓无 `serviceWorker` / `web-push` / `PushManager` |
| 11.2 | 移动端适配 | ⬜ 未做 | 无 `@media` / `useMediaQuery` / `isMobile` |
| 11.3 | MySQL 迁移 | ⬜ 未做 | 仍是 `better-sqlite3`。与技术债「`DB_PATH` 环境变量」相关,应合并考虑 |
| 12.1 | 前后端分离部署 | 🟡 部分 | 单容器已能跑(`index.ts:499` 用 `express.static` 托管 `dist/`),数据卷已持久化;但本节要的 `Dockerfile.frontend` / `nginx.conf` 都不存在。**需 Owner 定:接受现状还是真拆** |
| 12.2 | 文件操作缓存 | ⬜ 未做 | 无 `fileCache` |
| 12.3 | Skill 动态加载 | 🟡 部分 | 开关已有(`registry.ts:69`);**已核实** `server/skills/*.ts` 无 `readdirSync`,即静态 import,新目录不会自动加载 |
| 12.4 | 多模型路由 | ⬜ 未做 | ⚠️ **与 A 组重叠,见下** |

### 12.4 与 A 组的关系:目标不同,不是重复工作

- **12.4** 是**自动**路由:按消息长度/关键词判复杂度,短消息走便宜模型以省成本。
- **A 组 ①③′** 是**显式**配置:管理员配哪些模型可用、用户自己选。

12.4 需要 ① 的 `resolveModel` 作地基,但自动判定逻辑是独立需求。**需 Owner 决定 12.4 还做不做**
—— 按消息长度猜复杂度这套启发式很容易判错,把需要强模型的短问题路由到弱模型上,
用户看不出原因、只觉得答得差。

---

## 五、独立技术债

| 项 | 说明 | 定级 |
|---|---|---|
| `DB_PATH` 环境变量 | 测试隔离前置条件 —— **目前 DB 测试跑在开发库上**,靠测试自清 | P1 |
| `messages` 表扩展 `tool_calls` | 无法回放工具调用 | P2 |
| `dist/` 未分包 | 单 chunk 1.35 MB(gzip 432 KB) | P2 |
| Skill 入参未校验 | `createTask` / `createEvent` 不验证 assignee 是否为在职用户 | P2 |
| `server/skills/todo/index.ts` | 残留 198 处 `uXXXX` 转义,中文注释读不了 | P3 |
| 群聊消息的软删除归属 | `#9` 只处理了任务/事件/论文;群聊历史发言是否也改判给占位账号,**留待 Owner 裁决** | 待定 |

---

## 六、建议顺序

1. ~~提交 `docs/optimization-plan.md`~~ ✅ 已完成(PR #7)
2. ~~找回或作废 B 组编号~~ ✅ 已完成 —— v4 原文已归档为 `docs/fix-plan-v4.md` 并逐条核实
3. **零成本**:线上 `.env` 填 `OPENAI_MODELS`(不用 PR,立刻见效)
4. 🔴 **A 组 PR ①(已扩范围,含 v4 #3 + #8 + #16)** —— 断掉 P0 提权链,同时收敛模型配置
5. 🟠 **v4 #7a** —— refresh 查 DB 取当前 role。修法很小,但不修就等于降权无效
6. **A 组 PR ②** —— 真正解决「硬编码」这个原始诉求
7. **v4 剩余安全项**:#4(realpath)、#6(WS origin + 黑名单)、#15b(cancel 归属)、#5(skill 归属)
8. **v4 前端与清理项**:F1-F6、P2-1/2/4/5/6(可合成 1-2 个 PR)
9. **裁决 12.4**:自动路由还要不要
10. A 组 ③′ / C 组其余按需

## 七、每个 PR 的验证门槛(本仓已建立的做法,勿降级)

- `tsc -b` + `npm run build` 零错误
- vitest 全绿(当前 49/49)
- `npm run test:crash` 4/4 —— **崩溃类缺陷不能只在 vitest 里测**
- **反向变异**:新加的守卫逐条删掉必须变红。注意锚点要 LF 归一、断言命中次数恰好 1
- 真实服务端到端手测
- 开发库跑完自清:无残留测试数据、`foreign_keys = 1`、零孤儿行
