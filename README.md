# ProCoder · 专业级 AI 编程助手

一个可部署在服务器上的 Web Agent 应用，面向**专业级别 coding**：Agent 能读写文件、搜索代码、运行测试与构建，并交付经过验证的代码。后端基于 **任意 OpenAI 兼容模型端点**（OpenAI / DeepSeek / OpenRouter / 本地 Ollama / Azure 等）驱动。

> **产品演进（进行中）**：本项目正在按设计文档改造为面向小团队（≤5 人）的「办公助手平台」，分阶段加入登录鉴权、即时通讯、待办、日历、文献管理等模块。当前已完成 **Phase 1：用户认证 + Skill 插件架构 + 前端框架（登录页 / 布局 / 路由守卫）**；编码 Agent 功能保持可用。后续 Phase 见设计文档。

## 特性

- 🔐 **用户认证（Phase 1）**：基于 JWT + bcrypt 的登录 / 注册，受保护路由；默认管理员 `admin/admin123`
- 🧩 **Skill 插件架构（Phase 1）**：工具以 Skill 插件形式注册（编码 / 待办 / 日历 / 文献 / 联网搜索占位），Agent 动态加载工具
- 💻 **专业编码 Agent**：内置「专业编码助手 / 代码审查员 / 系统架构师」三种预设角色
- 🌊 **流式对话**：基于 SSE 实时展示 AI 回复与工具调用过程
- 🔧 **工具调用可视化**：文件读写、命令执行、搜索等操作实时呈现
- 🔒 **权限控制**：支持 `default` / `acceptEdits` / `plan` / `bypassPermissions` 多种模式
- 📝 **多会话与持久化**：SQLite 存储用户 / 会话 / 消息（会话归属 `owner_id`）
- 🎨 **界面框架**：Ant Design 负责登录页 / 布局 / 路由守卫；编码聊天页暂沿用 TDesign（Phase 2 迁移）
- 🐳 **一键部署**：单进程同时托管前后端，支持裸机 / Docker / Nginx
- 🔌 **模型无关**：只要给 OpenAI 兼容的 `baseURL` + `apiKey` + `model` 即可

## 技术栈

- 后端：Node.js + Express + TypeScript + OpenAI SDK（兼容端点）+ jsonwebtoken + bcryptjs
- 前端：React 18 + Vite + TDesign React（编码页）+ **Ant Design v6**（框架/鉴权）+ zustand + axios
- 数据库：SQLite（better-sqlite3）
- 通信：Server-Sent Events（SSE）流式；后续 Phase 引入 Socket.IO（IM）

## 快速开始（本地开发）

```bash
npm install
cp .env.example .env        # 填入 OPENAI_API_KEY 与 OPENAI_MODEL
npm run dev                 # 同时启动前端(6173)与后端(3000)
```

打开 http://localhost:6173

## 登录与认证（Phase 1）

- 应用启动后，所有页面（除 `/login`）均需登录。首次访问会被重定向到登录页。
- **默认管理员账号**：`admin` / `admin123`（首次启动自动创建，库中无用户时生效）。
- 登录成功后前端将 JWT 存入 `localStorage`，后续请求自动在 `Authorization` 头携带。
- **生产环境务必**：
  1. 在 `.env` 中把 `JWT_SECRET` 改为随机长字符串（`openssl rand -base64 48`）；
  2. 登录后修改 `admin` 密码（改密 UI 待后续 Phase 提供，可暂通过 API 或数据库修改 `users` 表）。
- 注册新用户：仅管理员可调用 `POST /api/auth/register`（请求体带 `Authorization: Bearer <admin_token>`）。

## 服务器部署

单进程同时托管前端与 API，详见 **[DEPLOYMENT.md](./DEPLOYMENT.md)**。

```bash
# Docker 方式（推荐）
cp .env.example .env        # 至少填 OPENAI_API_KEY、OPENAI_MODEL、DEFAULT_CWD
docker compose up -d --build
# 访问 http://<服务器IP>:3000
```

## 目录结构

```
pro-coding-agent/
├── server/                # 后端（Express + SSE + OpenAI 兼容 Agent）
│   ├── index.ts           # 路由 / SSE / 鉴权中间件 / 会话 / 静态托管
│   ├── agent.ts           # OpenAI 兼容的 coding agent 循环（从 skillRegistry 取工具）
│   ├── auth.ts            # JWT 签发 / 校验 / bcrypt 密码哈希
│   ├── db.ts              # SQLite：users/conversations/sessions/... + ensureAdminUser
│   ├── routes/auth.ts     # 登录 / 注册 / 刷新 / 当前用户 / 用户列表
│   └── skills/            # Skill 插件架构（base/registry/config + coding 等）
├── src/                   # 前端（React + Vite）
│   ├── api/               # http.ts（带 Token 的 apiFetch）/ auth.ts
│   ├── stores/authStore.ts# zustand 鉴权状态
│   ├── components/Layout/ # 侧边导航 + 整体布局
│   ├── pages/LoginPage.tsx# 登录页（antd）
│   ├── hooks/             # useChat / useModels / useSessions（已切到 apiFetch）
│   ├── config.ts          # 应用名称等全局配置
│   └── App.tsx            # 路由 + 受保护路由守卫
├── data/chat.db           # SQLite 数据库（运行时生成）
├── Dockerfile
├── docker-compose.yml
├── nginx.conf.example     # 反向代理示例（含 SSE 配置）
├── .env.example
├── DEPLOYMENT.md          # 部署指南
└── README.md
```

## 核心 API

| 端点 | 方法 | 描述 | 鉴权 |
|------|------|------|------|
| `/api/health` | GET | 健康检查 | 公开 |
| `/api/auth/login` | POST | 用户名/密码登录，返回 JWT | 公开 |
| `/api/auth/register` | POST | 注册新用户（仅管理员） | 需 Token |
| `/api/auth/refresh` | POST | 用刷新令牌换新访问令牌 | 公开 |
| `/api/auth/me` | GET | 当前登录用户 | 需 Token |
| `/api/auth/users` | GET | 用户列表（仅管理员） | 需 Token |
| `/api/models` | GET | 可用模型列表（来自 .env） | 需 Token |
| `/api/sessions` | GET/POST | 会话列表 / 创建（归属当前用户） | 需 Token |
| `/api/sessions/:id` | GET/PATCH/DELETE | 获取 / 更新 / 删除会话 | 需 Token |
| `/api/chat` | POST | 发送消息（SSE 流式） | 需 Token |
| `/api/permission-response` | POST | 响应权限请求 | 需 Token |

> 除 `/api/health` 与 `/api/auth/*` 外，所有 `/api/*` 均需 `Authorization: Bearer <token>`。

## 环境变量

见 `.env.example` 与 `DEPLOYMENT.md`。核心项：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`、`DEFAULT_CWD`、`DEFAULT_PERMISSION_MODE`、`MAX_TURNS`、`JWT_SECRET`（**生产必改**）。

## License

MIT
