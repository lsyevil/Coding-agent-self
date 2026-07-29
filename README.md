# ProCoder · 专业级 AI 编程助手

一个可部署在服务器上的 Web Agent 应用，面向**专业级别 coding**：Agent 能读写文件、搜索代码、运行测试与构建，并交付经过验证的代码。后端基于 **任意 OpenAI 兼容模型端点**（OpenAI / DeepSeek / OpenRouter / 本地 Ollama / Azure 等）驱动。

## 特性

- 💻 **专业编码 Agent**：内置「专业编码助手 / 代码审查员 / 系统架构师」三种预设角色
- 🌊 **流式对话**：基于 SSE 实时展示 AI 回复与工具调用过程
- 🔧 **工具调用可视化**：文件读写、命令执行、搜索等操作实时呈现
- 🔒 **权限控制**：支持 `default` / `acceptEdits` / `plan` / `bypassPermissions` 多种模式
- 📝 **多会话与持久化**：SQLite 存储会话与消息
- 🎨 **深/浅色主题**：TDesign React 组件库
- 🐳 **一键部署**：单进程同时托管前后端，支持裸机 / Docker / Nginx
- 🔌 **模型无关**：只要给 OpenAI 兼容的 `baseURL` + `apiKey` + `model` 即可

## 技术栈

- 后端：Node.js + Express + TypeScript + OpenAI SDK（兼容端点）
- 前端：React 18 + Vite + TDesign React + Tailwind CSS
- 数据库：SQLite（better-sqlite3）
- 通信：Server-Sent Events（SSE）流式

## 快速开始（本地开发）

```bash
npm install
cp .env.example .env        # 填入 OPENAI_API_KEY 与 OPENAI_MODEL
npm run dev                 # 同时启动前端(6173)与后端(3000)
```

打开 http://localhost:6173

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
│   ├── index.ts           # 路由 / SSE / 权限 / 会话 / 静态托管
│   ├── agent.ts           # OpenAI 兼容的 coding agent 循环 + 工具
│   └── db.ts
├── src/                   # 前端（React + Vite）
│   ├── components/
│   ├── hooks/             # useChat / useAgents / useSessions ...
│   ├── pages/
│   ├── config.ts          # 应用名称等全局配置
│   └── App.tsx
├── data/chat.db           # SQLite 数据库（运行时生成）
├── Dockerfile
├── docker-compose.yml
├── nginx.conf.example     # 反向代理示例（含 SSE 配置）
├── .env.example
├── DEPLOYMENT.md          # 部署指南
└── README.md
```

## 核心 API

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/check-login` | GET | 检查模型凭证配置状态 |
| `/api/models` | GET | 可用模型列表（来自 .env） |
| `/api/sessions` | GET/POST | 会话列表 / 创建 |
| `/api/sessions/:id` | GET/PATCH/DELETE | 获取 / 更新 / 删除会话 |
| `/api/chat` | POST | 发送消息（SSE 流式） |
| `/api/permission-response` | POST | 响应权限请求 |

## 环境变量

见 `.env.example` 与 `DEPLOYMENT.md`。核心项：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`、`DEFAULT_CWD`、`DEFAULT_PERMISSION_MODE`、`MAX_TURNS`。

## License

MIT
