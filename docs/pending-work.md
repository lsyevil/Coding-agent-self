# 待办汇总(2026-09-01)

> 这份文档只做**汇总与对账**,不新增需求。每一条状态都是当天用 grep/读码核实过的,
> 不是照抄旧文档。核实不了的地方明确标注「内容缺失」,没有猜。

## 先说一个记录本身的问题:三套编号并存,其中一套的内容丢了

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
| **①** | 抽 `server/model-registry.ts` 收敛散在 5 文件 **9 处** 的 `process.env.OPENAI_*`;在唯一入口做服务端强制校验;`/api/chat` 改收 `agentId`,**忽略客户端传的 `systemPrompt`** | ~250 行 | 无 |
| **②** | 助手预设进库 + Agent 管理 UI(填掉 `SettingsPage.tsx:15` 的 `Empty`),删掉 `src/config/agents.ts` | ~450 行 | ① |
| **③′** | `.env` 供应商槽位(`deepseek-chat@DEEPSEEK` + `PROVIDER_*`),多厂商并存,仍需重启 | ~80 行 | ① |

### ① 附带修掉的三个独立问题

- **`member_models` / `member_agents` 两道权限目前是纯装饰。** `server/index.ts:272` 直接取 body 的
  `model` 和 `systemPrompt`,无任何服务端校验(`index.ts:399` 把客户端传来的 `systemPrompt` 原样
  当 system message)。任何登录用户一条 curl 就能用任意模型、注入任意 system prompt。
- **`/api/models` 没有 `authMiddleware`** —— 未登录也能列举模型清单。
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

## 三、B 组:`#N` 编号(内容缺失,**不具备可执行性**)

| 批次 | 编号 | 内容 |
|---|---|---|
| 第 2 批其余 | `#3` `#6` `#7` `#8` | ❌ 未知(v4 文档不在仓库) |
| 第 2 批 | `#4` AGENT_PROMPTS 键名对齐 | ⚠️ **前提已过期** —— 全仓 grep 无 `AGENT_PROMPTS`,该符号不存在 |
| 第 2 批 | `#5` 模型解析 | ✅ 将由 **A 组 PR ①** 覆盖 |
| 第 3 批 | `#10` `#11` `#13` `#15b` `#16` `#17` | ❌ 未知 |
| 第 4 批 | `F1`–`F6`、`P2-1`..`P2-6` | ❌ 未知 |

**处理建议**:这 20+ 个编号目前是空壳。要么找回 v4 原文补进仓库,要么正式作废、以 Phase 文档和
实际 code review 为准。**保留一份「只有号码没有内容」的清单没有意义**,它会让人误以为还有 20 项
已知工作待做。

---

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

1. **零成本**:线上 `.env` 填 `OPENAI_MODELS`(不用 PR,立刻见效)
2. **提交 `docs/optimization-plan.md`**(831 行未入版本控制,风险不对称)
3. **A 组 PR ①** —— 同时关掉两个越权,且已确认行为中性
4. **A 组 PR ②** —— 真正解决「硬编码」这个原始诉求
5. **裁决 B 组**:找回 v4 原文,或正式作废这 20+ 个空壳编号
6. **裁决 12.4**:自动路由还要不要
7. A 组 ③′ / C 组其余按需

## 七、每个 PR 的验证门槛(本仓已建立的做法,勿降级)

- `tsc -b` + `npm run build` 零错误
- vitest 全绿(当前 49/49)
- `npm run test:crash` 4/4 —— **崩溃类缺陷不能只在 vitest 里测**
- **反向变异**:新加的守卫逐条删掉必须变红。注意锚点要 LF 归一、断言命中次数恰好 1
- 真实服务端到端手测
- 开发库跑完自清:无残留测试数据、`foreign_keys = 1`、零孤儿行
