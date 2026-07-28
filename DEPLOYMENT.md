# 部署指南（服务器部署）

ProCoder 是一个**单进程**全栈应用：Express 后端同时托管构建后的前端静态资源（生产模式下），开箱即用，便于部署到任意 Linux 服务器 / 容器。

---

## 一、准备 CodeBuddy 凭证

从 https://www.codebuddy.cn 获取 `CODEBUDDY_API_KEY`。三种登录方式任选其一：

1. **API Key（推荐服务器）**：设置 `CODEBUDDY_API_KEY`。
2. **Auth Token**：设置 `CODEBUDDY_AUTH_TOKEN`。
3. **CLI 登录**：在部署机上执行 `codebuddy login`，应用会自动复用其登录态（仅同机有效）。

---

## 二、方式 A：直接用 Node 运行（裸机 / 云主机）

```bash
# 1. 安装依赖（含 better-sqlite3 原生编译，需要 python3 + make + g++）
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 CODEBUDDY_API_KEY，并设置 DEFAULT_CWD 指向代码仓库

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
# 1. 准备 .env（至少包含 CODEBUDDY_API_KEY 与 DEFAULT_CWD）
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
  -e CODEBUDDY_API_KEY=xxx \
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
| `CODEBUDDY_API_KEY` | API Key | 无 |
| `CODEBUDDY_AUTH_TOKEN` | Auth Token | 无 |
| `CODEBUDDY_INTERNET_ENVIRONMENT` | `external` / `internal` | `external` |
| `CODEBUDDY_BASE_URL` | 私有化网关地址 | 无 |
| `DEFAULT_CWD` | 新建会话默认工作目录 | 进程启动目录 |
| `DEFAULT_PERMISSION_MODE` | `default`/`acceptEdits`/`plan`/`bypassPermissions` | `default` |
| `MAX_TURNS` | 单次请求最大工具轮数 | `10` |
| `DEFAULT_SYSTEM_PROMPT` | 覆盖内置默认提示词 | 内置编码提示词 |

---

## 六、权限模式建议

- **`acceptEdits`（推荐）**：Agent 可自动编辑文件，但执行命令（如测试、构建、git）会弹出确认。兼顾自动化与安全。
- **`default`**：每次工具调用都需确认，最保守。
- **`plan`**：只读，仅做分析与方案，不动文件（适合架构师角色）。
- **`bypassPermissions`**：完全自动，仅在你完全信任运行环境时使用。

> 这些也可在界面右上角「新建对话」时按会话单独选择，或在「设置」里给不同 Agent 配置固定权限。
