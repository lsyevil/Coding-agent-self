# ProCoder 办公助手平台 — 优化指令文档

> 按阶段拆分，每阶段独立可验收。完成一阶段后可调整后续方向。

## 核实总览(2026-09-01)

> 下表由当天逐条 grep / 读码核实得出,**不是照抄进度记录**。每节标题下都有对应的核实依据。
> 「部分完成」的项都写明了**差哪一块**,不要当成已完成。

| 项 | 状态 | 一句话 |
|---|---|---|
| 8.1 命令执行沙箱 | ✅ 已完成 | 黑名单 + 30s 超时都在 |
| 8.2 JWT 吊销机制 | ✅ 已完成 | 表/索引/吊销/校验/过期清理齐全 |
| 9.1 SSE 心跳与自动重连 | 🟡 部分 | 后端心跳有,**前端自动重连没做** |
| 9.2 Agent 超时与中断 | ✅ 已完成 | 5 分钟超时 + 中断 + 前端提示 |
| 10.1 Web Push | ⬜ 未做 | |
| 11.1 统一 UI 框架 | ✅ 代码已完成 | 零 tdesign 引用;`DEVELOPMENT.md` 描述过期 |
| 11.2 移动端适配 | ⬜ 未做 | |
| 11.3 MySQL 迁移 | ⬜ 未做 | 与 `DB_PATH` 技术债应合并考虑 |
| 12.1 前后端分离部署 | 🟡 部分 | 单容器可跑,但没拆前后端 |
| 12.2 文件操作缓存 | ⬜ 未做 | |
| 12.3 Skill 动态加载 | 🟡 部分 | 有开关,无目录扫描 |
| 12.4 多模型路由 | ⬜ 未做 | **与新方案重叠,需裁决** |

Phase 8 与 Phase 9 原定「1 周 + 3-5 天」,现在 8 全完成、9 只差前端重连 ——
**实际进度比这份文档原先呈现的要靠前**,批 3/批 4 并不是整块未动。

完整待办汇总见 `docs/pending-work.md`。

---

---

## Phase 8：安全加固（P0）

### 8.1 命令执行沙箱

> **核实状态(2026-09-01):** ✅ **已完成**
>
> `server/skills/coding/index.ts:33` 有 `BLOCKED_COMMANDS`(含 `rm -rf /`)+ `validateCommand`;`:293` 有 `timeout: 30000`。

**目标：** `run_command` 工具不能直接执行危险命令。

**实现：**

1. 在 `server/skills/coding/index.ts` 中，`run_command` 执行前加命令校验：

```ts
// 危险命令黑名单
const BLOCKED_COMMANDS = [
  'rm -rf', 'rm -r /', 'mkfs', 'dd if=', 
  ':(){:|:&};:',  // fork bomb
  'chmod -R 777', 'sudo', 'su ',
  '> /dev/', 'shutdown', 'reboot',
  'curl.*|sh', 'wget.*|sh',  // 管道执行
];

function validateCommand(cmd: string): { safe: boolean; reason?: string } {
  const normalized = cmd.toLowerCase().trim();
  for (const blocked of BLOCKED_COMMANDS) {
    if (normalized.includes(blocked.toLowerCase())) {
      return { safe: false, reason: `命令包含危险操作: ${blocked}` };
    }
  }
  return { safe: true };
}
```

2. 在 `execute` 方法中调用校验，不安全直接返回拒绝信息。

3. 给 `run_command` 加超时（默认 30s）：

```ts
import { spawn } from 'child_process';

function runWithTimeout(cmd: string, cwd: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('sh', ['-c', cmd], { cwd, shell: false });
    let output = '';
    let killed = false;
    
    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
      reject(new Error(`命令超时 (${timeoutMs/1000}s)`));
    }, timeoutMs);
    
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (!killed) resolve(output.slice(-5000)); // 截断过长输出
    });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
```

**验收：**
- [x] `rm -rf /` 被拦截并返回拒绝信息
- [x] 正常命令（`ls`, `git status`）正常执行
- [x] 长时间命令（`sleep 60`）30s 后超时

---

### 8.2 JWT 吊销机制

> **核实状态(2026-09-01):** ✅ **已完成**
>
> `token_blacklist` 表 + `expires_at` 索引;删用户时吊销(`db.ts:1366`);`isBlacklisted` 校验(`:1412`);过期清理(`:1424` `DELETE ... WHERE expires_at < ?`)。

**目标：** 删除用户后，已签发的 Token 立即失效。

**实现：**

1. `server/db.ts` 新增表：

```sql
CREATE TABLE IF NOT EXISTS token_blacklist (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blacklist_expires ON token_blacklist(expires_at);
```

2. 新增函数：

```ts
export function addToBlacklist(jti: string, userId: string, expiresAt: string): void {
  db.prepare('INSERT INTO token_blacklist (jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(jti, userId, expiresAt, new Date().toISOString());
}

export function isBlacklisted(jti: string): boolean {
  const row = db.prepare('SELECT 1 FROM token_blacklist WHERE jti = ?').get(jti);
  return !!row;
}

export function blacklistUserTokens(userId: string): void {
  // 将该用户所有未过期的 token 加入黑名单
  // 简化实现：直接标记当前时间之后的所有可能 token
  // 因为没存完整 jwt 列表，用 user_id 标记
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO token_blacklist (jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(`user_deleted_${userId}`, userId, '2099-12-31', now);
}

export function cleanupExpiredBlacklist(): void {
  db.prepare('DELETE FROM token_blacklist WHERE expires_at < ?').run(new Date().toISOString());
}
```

3. `server/auth.ts` 修改：

```ts
// 签发时加 jti
import { v4 as uuid } from 'uuid';

export function signToken(payload: AuthPayload): string {
  return jwt.sign(
    { ...payload, jti: uuid() },
    process.env.JWT_SECRET || 'dev-secret',
    { expiresIn: '2h' }
  );
}

// 校验时检查黑名单
export function verifyToken(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret') as any;
    if (db.isBlacklisted(decoded.jti)) return null;
    // 检查用户是否被删除
    if (db.isBlacklisted(`user_deleted_${decoded.userId}`)) return null;
    return decoded;
  } catch {
    return null;
  }
}
```

4. `server/routes/auth.ts` DELETE 用户时调用：

```ts
db.blacklistUserTokens(user.id);
db.cleanupUserData(user.id);
db.deleteUser(user.id);
```

**验收：**
- [x] 删除用户后，该用户的旧 Token 请求返回 401
- [x] 正常用户 Token 不受影响
- [x] Token 过期后黑名单自动清理

---

## Phase 9：通信稳定性（P1）

### 9.1 SSE 心跳与自动重连

> **核实状态(2026-09-01):** 🟡 **部分完成 —— 只做了后端心跳,前端自动重连没做**
>
> `server/index.ts:254` `startHeartbeat` 每 30s 发 `: heartbeat`(SSE 注释);前端 `chatStore` 只处理 `data: ` 开头的行,所以注释天然被忽略。**但全仓 grep 无 `reconnect` / `retryCount` / 重连逻辑** —— 前端用的是 `fetch` + `ReadableStream` 而非 `EventSource`,**没有浏览器内置的自动重连**,断流后需要用户手动重发。要补这一项还得先解决「重连后消息如何续传」,不是加几行就行。

**目标：** 长连接断开后自动恢复，用户无感知。

**后端 `server/index.ts`：**

```ts
// SSE 连接后启动心跳
function startHeartbeat(res: Response) {
  const interval = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);
  
  res.on('close', () => {
    clearInterval(interval);
  });
}
```

在 SSE 端点调用 `startHeartbeat(res)`。

**前端 `src/hooks/useChat.ts`（或相关 SSE 连接处）：**

```ts
function connectSSE(url: string, onMessage: (data: any) => void) {
  let es: EventSource | null = null;
  let reconnectTimer: NodeJS.Timeout;
  let reconnectCount = 0;
  const MAX_RECONNECT = 5;

  const connect = () => {
    es = new EventSource(url);
    
    es.onmessage = (e) => {
      if (e.data === ': heartbeat') return; // 忽略心跳
      reconnectCount = 0; // 重置计数
      try {
        onMessage(JSON.parse(e.data));
      } catch {}
    };

    es.onerror = () => {
      es?.close();
      if (reconnectCount < MAX_RECONNECT) {
        reconnectCount++;
        const delay = Math.min(1000 * Math.pow(2, reconnectCount), 30000);
        reconnectTimer = setTimeout(connect, delay);
      }
    };
  };

  connect();

  return () => {
    es?.close();
    clearTimeout(reconnectTimer);
  };
}
```

**验收：**
- [x] 后端每 30s 发送心跳注释
- [x] 前端忽略心跳消息
- [ ] 断网后恢复，SSE 自动重连
- [ ] 超过 5 次重连停止，显示"连接断开"提示

---

### 9.2 Agent 超时与用户中断

> **核实状态(2026-09-01):** ✅ **已完成**
>
> `server/agent.ts:56` `TOTAL_TIMEOUT = 5 * 60 * 1000`;`cancelAgent` + `tests/agent-cancel.test.ts`;前端中断后落 `(已停止)`(`chatStore.ts:253`)。超时路径的具体文案未单独核实。

**目标：** 防止 Agent 死循环；用户可随时停止。

**后端 `server/agent.ts`：**

```ts
// 1. 总超时
const TOTAL_TIMEOUT = 5 * 60 * 1000; // 5 分钟
const startTime = Date.now();

// 在循环中检查
if (Date.now() - startTime > TOTAL_TIMEOUT) {
  emit({ type: 'error', message: 'Agent 执行超时（5分钟）' });
  break;
}

// 2. 用户中断
// 内存中维护中断标记
const cancelFlags = new Set<string>();

export function cancelAgent(sessionId: string) {
  cancelFlags.add(sessionId);
}

// 循环中检查
if (cancelFlags.has(sessionId)) {
  cancelFlags.delete(sessionId);
  emit({ type: 'info', message: '用户已中断' });
  break;
}
```

**后端新增路由 `server/routes/chat.ts`（或 index.ts）：**

```ts
POST /api/chat/:sessionId/cancel
- 调用 cancelAgent(sessionId)
- 返回 { success: true }
```

**前端 Chat 页面：**

```tsx
// 正在生成时显示停止按钮
{isLoading && (
  <Button 
    icon={<StopOutlined />} 
    onClick={() => apiFetch(`/api/chat/${sessionId}/cancel`, { method: 'POST' })}
    danger
  >
    停止
  </Button>
)}
```

**验收：**
- [x] Agent 执行超过 5 分钟自动停止
- [x] 点击停止按钮后，Agent 在当前工具执行完毕后停止
- [x] 前端显示超时/中断提示

---

## Phase 10：通知系统（P1）

### 10.1 浏览器推送（Web Push）

> **核实状态(2026-09-01):** ⬜ **未做**
>
> 全仓无 `serviceWorker` / `web-push` / `PushManager` / `new Notification(`。

**目标：** IM 消息、待办分派、日程提醒推送到桌面。

**后端：**

1. 安装依赖：`npm install web-push`

2. `server/db.ts` 新增表：

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

3. `server/routes/push.ts` 新增：

```ts
// POST /api/push/subscribe — 保存订阅
// DELETE /api/push/subscribe — 删除订阅
// 内部函数 sendPush(userId, title, body, url?) — 给用户所有设备推送
```

4. 在以下场景触发推送：
   - IM 收到新消息（`server/routes/im.ts`）
   - 待办被分派（`server/routes/tasks.ts`）
   - 日程开始前 15 分钟（定时任务检查）

**前端：**

1. `public/sw.js` — Service Worker：

```js
self.addEventListener('push', (event) => {
  const data = event.data?.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon.png',
      data: { url: data.url }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/')
  );
});
```

2. `src/utils/push.ts` — 订阅管理：

```ts
export async function subscribePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;
  
  const reg = await navigator.serviceWorker.register('/sw.js');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: VAPID_PUBLIC_KEY
  });
  
  await apiFetch('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription: sub })
  });
}
```

3. 登录后自动请求通知权限。

**验收：**
- [ ] 登录后弹出通知权限请求
- [ ] 收到 IM 消息时桌面弹出通知
- [ ] 点击通知跳转到对应页面
- [ ] 关闭通知权限后不再推送

---

## Phase 11：体验优化（P2）

### 11.1 统一 UI 框架

> **核实状态(2026-09-01):** ✅ **代码已完成**(文档有过期残留)
>
> `package.json` 与 `src/` 里**零** `tdesign` 引用,已在用 antd `^6.6.1`。但 `DEVELOPMENT.md:28` 仍写着「TDesign React (UI 组件库)」—— 过期描述,需一并改。后两项(视觉一致/无回归)属人工验收,无法自动核实。

**目标：** 将 TDesign 组件替换为 Ant Design，视觉统一。

**步骤：**

1. 搜索所有 `tdesign-react` 的 import：
   ```bash
   grep -r "from 'tdesign-react'" src/
   ```

2. 逐个替换为 Ant Design 等价组件：
   - `t-button` → `antd Button`
   - `t-input` → `antd Input`
   - `t-dialog` → `antd Modal`
   - `t-table` → `antd Table`
   - `t-tag` → `antd Tag`
   - 等等

3. 统一主题变量（`src/styles/theme.ts`）：
   ```ts
   export const theme = {
     token: {
       colorPrimary: '#1677ff',
       borderRadius: 6,
       fontSize: 14,
     }
   };
   ```

4. 卸载 `tdesign-react`。

**验收：**
- [x] 无 tdesign-react 引用
- [ ] 所有页面视觉风格一致
- [ ] 功能无回归

---

### 11.2 移动端适配

> **核实状态(2026-09-01):** ⬜ **未做**
>
> `src/` 无 `@media` / `useMediaQuery` / `isMobile` / `useBreakpoint`。

**目标：** 手机端可用，响应式布局。

**实现：**

1. `src/hooks/useResponsive.ts`：

```ts
export function useResponsive() {
  const [width, setWidth] = useState(window.innerWidth);
  
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  
  return {
    isMobile: width < 768,
    isTablet: width >= 768 && width < 1024,
    isDesktop: width >= 1024
  };
}
```

2. 布局适配：

```tsx
// Layout.tsx
const { isMobile } = useResponsive();

<Sider 
  collapsed={isMobile} 
  breakpoint="md"
  trigger={null}
  style={isMobile ? { position: 'absolute', zIndex: 100 } : {}}
/>

// 移动端抽屉式侧边栏
{isMobile && !collapsed && (
  <div className="sidebar-overlay" onClick={() => setCollapsed(true)} />
)}
```

3. 关键页面适配：
   - Chat：消息气泡全宽，输入框固定底部
   - Tasks：卡片布局替代表格
   - Calendar：日视图/周视图切换

**验收：**
- [ ] 375px 宽度下所有页面可用
- [ ] 侧边栏移动端可收起/展开
- [ ] Chat 输入框不被键盘遮挡
- [ ] 表格移动端可横向滚动或切换卡片

---

### 11.3 MySQL 迁移

> **核实状态(2026-09-01):** ⬜ **未做**
>
> 仍是 `better-sqlite3`,无 `mysql2` 依赖、无双模式抽象。**与独立技术债「`DB_PATH` 环境变量」相关**(目前 DB 测试跑在开发库上),两者应合并考虑再动。

**目标：** 支持 MySQL，兼容 SQLite 开发。

**实现：**

1. 安装：`npm install knex mysql2`

2. `server/db.ts` 重构为 Knex：

```ts
import knex from 'knex';

const db = knex({
  client: process.env.DB_CLIENT || 'better-sqlite3',
  connection: process.env.DB_CLIENT === 'mysql'
    ? {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      }
    : { filename: process.env.DB_FILE || './data/chat.db' },
  useNullAsDefault: true,
  pool: process.env.DB_CLIENT === 'mysql' ? { min: 2, max: 10 } : undefined,
});

export default db;
```

3. 写迁移文件 `server/migrations/001_init.ts`：

```ts
export async function up(knex: Knex) {
  await knex.schema.createTable('users', (t) => {
    t.string('id').primary();
    t.string('username').unique().notNullable();
    t.string('password_hash').notNullable();
    t.string('display_name');
    t.string('role').defaultTo('member');
    t.string('avatar');
    t.text('created_at').notNullable();
    t.text('updated_at').notNullable();
  });
  
  // ... 其他表
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('users');
  // ...
}
```

4. 替换所有 raw SQL 为 Knex 查询构建器：

```ts
// 之前
db.prepare('SELECT * FROM users WHERE id = ?').get(id);

// 之后
db('users').where({ id }).first();
```

5. `.env.example` 新增：

```
DB_CLIENT=better-sqlite3  # 或 mysql
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=procoder
DB_FILE=./data/chat.db
```

**验收：**
- [ ] SQLite 模式下所有功能正常
- [ ] 切换 MySQL 后所有功能正常
- [ ] 迁移脚本可重复执行
- [ ] 无 raw SQL 残留

---

## Phase 12：扩展优化（P3）

### 12.1 前后端分离部署

> **核实状态(2026-09-01):** 🟡 **验收项基本满足,但「前后端分离」这个目标没达成**
>
> 已有 `Dockerfile` + `docker-compose.yml`(单容器,数据卷 `procoder-data` 持久化),`server/index.ts:499` 用 `express.static` 托管 `dist/`,所以一键启动和前端访问都是通的。**但本节要求的 `Dockerfile.frontend` 与 `nginx.conf` 都不存在** —— 前端仍由 Node 进程托管,没有拆开。需 Owner 定:是接受现状(单容器够用)还是真要拆。

**目标：** 前端静态文件 + 后端 API 独立部署。

**实现：**

1. `Dockerfile.frontend`：

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

2. `nginx.conf`：

```nginx
server {
    listen 80;
    
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

3. `docker-compose.yml`：

```yaml
services:
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports: ["80:80"]
    depends_on: [backend]
  
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    environment:
      - DB_CLIENT=mysql
      - DB_HOST=db
      - DB_USER=root
      - DB_PASSWORD=${DB_PASSWORD}
      - DB_NAME=procoder
    depends_on: [db]
  
  db:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_PASSWORD}
      MYSQL_DATABASE: procoder
    volumes:
      - mysql_data:/var/lib/mysql

volumes:
  mysql_data:
```

**验收：**
- [x] `docker compose up -d` 一键启动
- [x] 前端访问正常，API 代理正常
- [x] 数据库持久化

---

### 12.2 文件操作缓存

> **核实状态(2026-09-01):** ⬜ **未做**
>
> 无 `fileCache` / `lru-cache`。

**目标：** 减少重复磁盘 IO。

**实现：**

```ts
// server/utils/fileCache.ts
import { watch } from 'chokidar';

class FileCache {
  private cache = new Map<string, { content: string; ts: number }>();
  private watcher?: FSWatcher;
  
  constructor(private ttl = 60000) {} // 1 分钟 TTL
  
  async read(path: string): Promise<string> {
    const cached = this.cache.get(path);
    if (cached && Date.now() - cached.ts < this.ttl) {
      return cached.content;
    }
    const content = await fs.readFile(path, 'utf-8');
    this.cache.set(path, { content, ts: Date.now() });
    return content;
  }
  
  invalidate(path: string) {
    this.cache.delete(path);
  }
  
  startWatching(dir: string) {
    this.watcher = watch(dir, { ignoreInitial: true });
    this.watcher.on('change', (p) => this.invalidate(p));
    this.watcher.on('unlink', (p) => this.invalidate(p));
  }
}

export const fileCache = new FileCache();
```

在 coding skill 中使用 `fileCache.read(path)` 替代 `fs.readFile`。

**验收：**
- [ ] 连续读取同一文件，第二次走缓存
- [ ] 文件修改后缓存自动失效
- [ ] 内存占用可控（LRU 淘汰）

---

### 12.3 Skill 动态加载

> **核实状态(2026-09-01):** 🟡 **部分完成 —— 有开关,没有动态加载**
>
> `server/skills/registry.ts:69` 有 `setEnabled`,设置页也有开关。**但 `server/skills/*.ts` 里无 `readdirSync`** —— Skill 仍是静态 import 注册,新建目录重启后不会自动加载。

**目标：** 支持从目录/npm 加载 Skill，无需硬编码注册。

**实现：**

1. `server/skills/registry.ts` 新增：

```ts
async function loadSkillFromDir(skillName: string): Promise<Skill | null> {
  const skillDir = path.join(process.cwd(), 'skills', skillName);
  const indexPath = path.join(skillDir, 'index.ts');
  
  if (!fs.existsSync(indexPath)) return null;
  
  try {
    const mod = await import(indexPath);
    return mod.default || mod;
  } catch (e) {
    console.error(`Failed to load skill ${skillName}:`, e);
    return null;
  }
}

async function discoverSkills(): Promise<Skill[]> {
  const skillsDir = path.join(process.cwd(), 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  
  const dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  const skills: Skill[] = [];
  for (const dir of dirs) {
    const skill = await loadSkillFromDir(dir);
    if (skill) skills.push(skill);
  }
  return skills;
}
```

2. 启动时自动发现并注册：

```ts
// server/skills/index.ts
const discovered = await discoverSkills();
for (const skill of discovered) {
  skillRegistry.register(skill);
}
```

**验收：**
- [ ] 在 `skills/` 目录新建 Skill，重启后自动加载
- [ ] 删除 Skill 目录，重启后不再加载
- [ ] 加载失败不影响其他 Skill

---

### 12.4 多模型路由

> **核实状态(2026-09-01):** ⬜ **未做,且与新方案重叠 —— 需 Owner 裁决**
>
> `MODEL_FAST` / `selectModel` 只出现在本文档里,代码中无实现。⚠️ **它与 2026-09-01 定的「助手可编辑化」PR ①③′ 目标不同**:本节要做的是**自动**按复杂度路由以省成本,PR ①③′ 做的是**显式**配置(管理员配可用模型、用户自选)。本节需要 PR ① 的 `resolveModel` 作地基。**建议重新评估是否还要做** —— 按消息长度猜复杂度(`len < 50`)很容易判错,把需要强模型的短问题路由到弱模型,用户看不出原因、只觉得答得差。详见 `docs/pending-work.md`。

**目标：** 根据场景自动选择模型，节省成本。

**实现：**

1. `.env` 新增：

```
MODEL_FAST=gpt-3.5-turbo
MODEL_BALANCED=gpt-4
MODEL_POWERFUL=claude-3-opus
```

2. `server/agent.ts` 路由逻辑：

```ts
function selectModel(message: string, config: ModelConfig): string {
  // 用户显式选择
  if (config.userSelected) return config.userSelected;
  
  // 自动路由
  const len = message.length;
  if (len < 50) return config.fast;
  if (len < 500 || !/代码|分析|debug|复杂/.test(message)) return config.balanced;
  return config.powerful;
}
```

3. 前端 ChatInput 加模型选择器（可选）：

```tsx
<Select
  value={modelTier}
  onChange={setModelTier}
  options={[
    { label: '⚡ 快速', value: 'fast' },
    { label: '⚖️ 均衡', value: 'balanced' },
    { label: '🚀 强力', value: 'powerful' },
  ]}
/>
```

**验收：**
- [ ] 短消息自动用快速模型
- [ ] 复杂问题自动用强力模型
- [ ] 用户可手动覆盖
- [ ] 日志记录每次使用的模型

---

## 📊 阶段总结

| Phase | 内容 | 预估时间 | 依赖 |
|-------|------|----------|------|
| 8 | 安全加固（沙箱 + JWT） | 1 周 | 无 |
| 9 | 通信稳定（心跳 + 中断） | 3-5 天 | 无 |
| 10 | 通知系统（Web Push） | 1 周 | 无 |
| 11 | 体验优化（UI + 移动端 + MySQL） | 2-3 周 | Phase 8-10 |
| 12 | 扩展优化（部署 + 缓存 + Skill + 路由） | 2-3 周 | Phase 11 |

---

## 🔄 执行说明

1. 每完成一个 Phase，跑一遍回归测试
2. 每阶段结束后可调整后续优先级
3. 如遇技术问题，先解决再继续
4. 每个 Phase 独立分支，合并前 review
