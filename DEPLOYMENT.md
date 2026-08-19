# 部署指南（服务器部署）

ProCoder 是一个**单进程**全栈应用：Express 后端同时托管构建后的前端静态资源（生产模式下），开箱即用，便于部署到任意 Linux 服务器 / 容器。

---

## 一、准备模型凭证（OpenAI 兼容）

本应用使用**任意 OpenAI 兼容端点**，只需三个变量：

1. `OPENAI_API_KEY`：你的模型 API Key（必填）。
2. `OPENAI_BASE_URL`：API 基址。OpenAI 官方留空；第三方/自建填其地址，例如：
   - DeepSeek：`https://api.deepseek.com/v1`
   - OpenRouter：`https://openrouter.ai/api/v1`
   - 本地 Ollama：`http://localhost:11434/v1`
   - Azure OpenAI：`https://<resource>.openai.azure.com/openai`
3. `OPENAI_MODEL`：默认模型名（必填，如 `gpt-4o`、`deepseek-chat`）。
4. `JWT_SECRET`：**生产环境必改**。JWT 签名密钥，默认 `change-me-in-production` 可被伪造。用 `openssl rand -base64 48` 生成随机串填入。

---

## 二、方式 A：直接用 Node 运行（裸机 / 云主机）

```bash
# 1. 安装依赖（含 better-sqlite3 原生编译，需要 python3 + make + g++）
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY、OPENAI_MODEL，并设置 DEFAULT_CWD 指向代码仓库

# 3. 构建前端
npm run build

# 4. 启动（单进程，已自动托管前端）
npm start
# 访问 http://<服务器IP>:3000
```

> 生产环境下建议用进程管理器保活：
> ```bash
> # 例：pm2
> npm install -g pm2
> pm2 start "npm start" --name procoder
> pm2 save && pm2 startup
> ```

---

## 三、方式 B：Docker（推荐）

```bash
# 1. 准备 .env（至少包含 OPENAI_API_KEY、OPENAI_MODEL 与 DEFAULT_CWD）
cp .env.example .env

# 2. 构建并启动
docker compose up -d --build

# 3. 访问 http://<服务器IP>:3000
```

- 会话数据库持久化在具名卷 `procoder-data`。
- 代码仓库通过 `./repos` 挂载进容器（对应 `DEFAULT_CWD=/workspace/repos`），Agent 在该目录内读写代码。

如需手动 `docker run`：

```bash
docker build -t procoder:latest .
docker run -d --name procoder -p 3000:3000 \
  -e OPENAI_API_KEY=xxx \
  -e OPENAI_MODEL=gpt-4o \
  -e DEFAULT_CWD=/workspace/repos \
  -v procoder-data:/app/data \
  -v $(pwd)/repos:/workspace/repos:rw \
  procoder:latest
```

---

## 四、方式 C：放在 Nginx 反向代理后（域名 + HTTPS）

1. 启动应用（监听 `127.0.0.1:3000`）。
2. 将 `nginx.conf.example` 的内容并入你的 `nginx.conf` 的 `http {}`（替换 `server_name`）。
3. **关键**：`/api/chat` 必须 `proxy_buffering off;`，否则 SSE 流式响应会被缓冲、前端看不到实时输出。
4. 重新加载：`nginx -t && nginx -s reload`。

---

## 五、关键环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `OPENAI_API_KEY` | 模型 API Key（必填） | 无 |
| `OPENAI_BASE_URL` | 兼容端点基址（OpenAI 官方留空） | 无 |
| `OPENAI_MODEL` | 默认模型名（必填） | 无 |
| `OPENAI_MODELS` | 可选模型下拉列表（逗号分隔） | 无 |
| `JWT_SECRET` | JWT 签名密钥（**生产必改**） | `change-me-in-production` |
| `JWT_EXPIRES_IN` | 访问令牌有效期 | `7d` |
| `DEFAULT_ADMIN_USERNAME` | 首次启动创建的管理员用户名 | `admin` |
| `DEFAULT_ADMIN_PASSWORD` | 首次启动创建的管理员密码 | `admin123` |
| `DEFAULT_CWD` | 新建会话默认工作目录 | 进程启动目录 |
| `DEFAULT_PERMISSION_MODE` | `default`/`acceptEdits`/`plan`/`bypassPermissions` | `default` |
| `MAX_TURNS` | 单次请求最大工具轮数 | `10` |
| `DEFAULT_SYSTEM_PROMPT` | 覆盖内置默认提示词 | 内置编码提示词 |

> **登录说明**：首次启动若库中无用户，会自动创建默认管理员（`admin`/`admin123`）。访问 `http://<服务器IP>:3000` 会被重定向到登录页，登录后即可使用。请尽快修改默认密码与 `JWT_SECRET`。

---

## 六、权限模式建议

- **`acceptEdits`（推荐）**：Agent 可自动编辑文件，但执行命令（如测试、构建、git）会弹出确认。兼顾自动化与安全。
- **`default`**：每次工具调用都需确认，最保守。
- **`plan`**：只读，仅做分析与方案，不动文件（适合架构师角色）。
- **`bypassPermissions`**：完全自动，仅在你完全信任运行环境时使用。

> 这些也可在界面右上角「新建对话」时按会话单独选择，或在「设置」里给不同 Agent 配置固定权限。
