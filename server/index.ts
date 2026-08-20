import express from "express";
import { createServer } from "http";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as db from "./db.js";
import { runCodingAgent, PermissionResult } from "./agent.js";
import { authMiddleware } from "./auth.js";
import authRouter from "./routes/auth.js";
import { registerBuiltinSkills } from "./skills/index.js";
import settingsRouter from "./routes/settings.js";
import conversationsRouter from "./routes/conversations.js";
import tasksRouter from "./routes/tasks.js";
import eventsRouter from "./routes/events.js";
import papersRouter from "./routes/papers.js";
import { setupWebSocket } from "./ws.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// 启动时注册内置 Skill（工具定义与执行改由注册表动态提供）
registerBuiltinSkills();

// Middleware
app.use(express.json());

// ============= 认证保护（/api 下除公开接口外均需 JWT）=============
const PUBLIC_API_PATHS = new Set(["/health", "/auth/login", "/auth/refresh"]);
app.use("/api", (req, res, next) => {
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  return authMiddleware(req, res, next);
});

// 待处理的权限请求
interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  reject: (error: Error) => void;
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
  timestamp: number;
}

const pendingPermissions = new Map<string, PendingPermission>();

// 权限请求超时时间（5分钟）
const PERMISSION_TIMEOUT = 5 * 60 * 1000;

const __dirnameDir = __dirname;

// ============= 健康检查 =============
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============= 登录 / 配置状态 =============
app.get("/api/check-login", (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL;
  const model = process.env.OPENAI_MODEL;
  const response: any = {
    isLoggedIn: false,
    envConfigured: false,
    cliConfigured: false,
    envVars: {},
    method: "none",
  };

  if (apiKey) {
    response.envConfigured = true;
    response.isLoggedIn = true;
    response.method = "env";
    const masked = apiKey.slice(0, 6) + "****" + apiKey.slice(-4);
    response.envVars = {
      apiKey: masked,
      baseUrl: baseUrl || "(默认官方端点)",
      model: model || "(未设置)",
    };
  }

  res.json(response);
});

// ============= 认证路由 =============
app.use("/api/auth", authRouter);

// ============= 设置路由 =============
app.use("/api/settings", settingsRouter);

// ============= IM 会话路由 =============
app.use("/api/conversations", conversationsRouter);

// ============= Tasks Route =============
app.use("/api/tasks", tasksRouter);

// ============= Events Route =============
app.use("/api/events", eventsRouter);
app.use("/api/papers", papersRouter);

// ============= 模型列表 =============
app.get("/api/models", (req, res) => {
  const model = process.env.OPENAI_MODEL || "";
  const extra = (process.env.OPENAI_MODELS || "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
  const ids = model ? [model, ...extra.filter((m) => m !== model)] : extra;
  const models = ids.map((id) => ({ modelId: id, name: id }));
  res.json({
    models,
    defaultModel: model,
    error: ids.length === 0 ? "未配置 OPENAI_MODEL，请在 .env 中设置" : undefined,
  });
});

// ============= 会话 API =============
app.get("/api/sessions", (req, res) => {
  try {
    const ownerId = (req as any).user?.userId;
    const sessions = db.getAllSessions(ownerId);
    const sessionsWithMessages = sessions.map((session) => {
      const messages = db.getMessagesBySession(session.id);
      return { ...session, messageCount: messages.length };
    });
    res.json({ sessions: sessionsWithMessages });
  } catch (error: any) {
    console.error("[Sessions] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

app.get("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = db.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "会话不存在" });
    if (session.owner_id !== (req as any).user?.userId) {
      return res.status(403).json({ error: "无权访问该会话" });
    }
    const messages = db.getMessagesBySession(sessionId);
    const parsedMessages = messages.map((msg) => ({
      ...msg,
      tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null,
    }));
    res.json({ session, messages: parsedMessages });
  } catch (error: any) {
    console.error("[Session] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

app.post("/api/sessions", (req, res) => {
  try {
    const { model = process.env.OPENAI_MODEL || "unknown", title = "新对话" } = req.body;
    const now = new Date().toISOString();
    const session = db.createSession({
      id: uuidv4(),
      title,
      model,
      owner_id: (req as any).user?.userId,
      sdk_session_id: null,
      created_at: now,
      updated_at: now,
    });
    res.json({ session });
  } catch (error: any) {
    console.error("[Create Session] Error:", error);
    res.status(500).json({ error: error?.message || "创建会话失败" });
  }
});

app.patch("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title, model } = req.body;
    const session = db.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "会话不存在" });
    if (session.owner_id !== (req as any).user?.userId) {
      return res.status(403).json({ error: "无权访问该会话" });
    }
    const success = db.updateSession(sessionId, { title, model });
    if (!success) return res.status(404).json({ error: "会话不存在" });
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Update Session] Error:", error);
    res.status(500).json({ error: error?.message || "更新会话失败" });
  }
});

app.delete("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = db.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "会话不存在" });
    if (session.owner_id !== (req as any).user?.userId) {
      return res.status(403).json({ error: "无权访问该会话" });
    }
    const success = db.deleteSession(sessionId);
    if (!success) return res.status(404).json({ error: "会话不存在" });
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Delete Session] Error:", error);
    res.status(500).json({ error: error?.message || "删除会话失败" });
  }
});

// ============= 聊天 API =============
app.post("/api/permission-response", (req, res) => {
  const { requestId, behavior, message } = req.body;
  console.log(`[Permission] Response received: requestId=${requestId}, behavior=${behavior}`);

  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    console.log(`[Permission] Request not found: ${requestId}`);
    return res.status(404).json({ error: "权限请求不存在或已超时" });
  }

  pendingPermissions.delete(requestId);

  if (behavior === "allow") {
    pending.resolve({ behavior: "allow", updatedInput: pending.input });
  } else {
    pending.resolve({ behavior: "deny", message: message || "用户拒绝了此操作" });
  }

  res.json({ success: true });
});

app.post("/api/chat", async (req, res) => {
  const { sessionId, message, model, systemPrompt, cwd, permissionMode } = req.body;

  console.log(`\n[Chat] ========== 新请求 ==========`);
  console.log(`[Chat] SessionId: ${sessionId}`);
  console.log(`[Chat] Model: ${model}`);
  console.log(`[Chat] Message: ${message?.slice(0, 100)}${message?.length > 100 ? "..." : ""}`);
  console.log(`[Chat] CWD: ${cwd || "default"}`);

  if (!message) {
    console.log(`[Chat] 错误: 消息为空`);
    return res.status(400).json({ error: "消息不能为空" });
  }

  // 获取或创建会话
  let session = sessionId ? db.getSession(sessionId) : null;
  if (session && session.owner_id !== (req as any).user?.userId) {
    console.log(`[Chat] 无权访问会话: ${sessionId}`);
    return res.status(403).json({ error: "无权访问该会话" });
  }
  const now = new Date().toISOString();

  if (!session) {
    console.log(`[Chat] 创建新会话`);
    session = db.createSession({
      id: sessionId || uuidv4(),
      title: message.slice(0, 30) + (message.length > 30 ? "..." : ""),
      model: model || process.env.OPENAI_MODEL || "unknown",
      owner_id: (req as any).user?.userId || "system",
      sdk_session_id: null,
      created_at: now,
      updated_at: now,
    });
  }

  const selectedModel = model || session.model || process.env.OPENAI_MODEL || "gpt-4o";

  const userMessageId = uuidv4();
  const assistantMessageId = uuidv4();

  try {
    db.createMessage({
      id: userMessageId,
      session_id: session.id,
      role: "user",
      content: message,
      model: null,
      created_at: now,
      tool_calls: null,
    });
    console.log(`[Chat] 用户消息已保存: ${userMessageId}`);
  } catch (dbError: any) {
    console.error(`[Chat] 保存用户消息失败:`, dbError);
    return res.status(500).json({ error: "保存消息失败", detail: dbError?.message });
  }

  // 设置 SSE 头
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const emit = (obj: Record<string, unknown>) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    emit({
      type: "text",
      content: "\n\n⚠️ 未配置 OPENAI_API_KEY，请在服务器 .env 中设置后重启服务。",
    });
    emit({ type: "done" });
    return res.end();
  }

  const defaultSystemPrompt =
    process.env.DEFAULT_SYSTEM_PROMPT ||
    `你是「办公助手」，一个小团队（≤5 人）的 AI 办公协作伙伴。目标是用清晰、可靠、可执行的方式，帮团队成员把日常工作做得更顺。

## 核心能力
- 写作与润色：起草/改写/总结/翻译各类文档（周报、邮件、方案、公告、纪要等），保持语气得体、结构清晰。
- 信息整理：从杂乱信息中提取要点、归纳结构、制作清单与对比表。
- 科研辅助：帮助检索学术文献、梳理研究脉络、对比不同方法、生成综述摘要。引用时标注来源，区分已发表成果与预印本。
- 思考与规划：帮用户拆解任务、梳理流程、权衡方案、做决策辅助。涉及多人协作时，主动建议任务分配方案。
- 知识问答：基于用户提供的信息作答；不确定时明确说明，不编造事实或数据。
- 轻量分析：对用户给出的数据做归纳、统计说明与可视化建议。

## 工作原则
1. 先理解，再动手：动手前确认真实意图、受众与格式；信息不足主动提问，不臆测。
2. 务实可落地：交付物要能直接用——给具体文本、步骤或模板，而非空泛建议。
3. 善用工具：主动使用管理员已启用的工具完成任务（如待办管理、日程安排、文献检索等），而非只给口头建议。如果某项操作没有对应工具，如实告知用户需手动处理。
4. 团队意识：当任务涉及多人时，主动建议分配给合适的团队成员，并考虑时间冲突与优先级。
5. 诚实边界：不确定的事情说"不确定"，不编造数据或引用。涉及对外发送内容时提示用户复核。
6. 简洁优先：默认精炼；用户要求详尽时再展开。

## 语气
专业、平实、友好，不堆砌客套话。默认中文（用户切换语言时跟随）。`;

  const workingDir = cwd || process.env.DEFAULT_CWD || process.cwd();
  const pm = permissionMode || process.env.DEFAULT_PERMISSION_MODE || "default";

  // 构建对话历史（含刚刚保存的当前 user 消息）
  const historyRows = db.getMessagesBySession(session.id);
  const historyMessages = historyRows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content || "" }));

  const messages: any[] = [
    { role: "system", content: systemPrompt || defaultSystemPrompt },
    ...historyMessages,
  ];

  // 权限请求回调
  const requestPermission = (
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string
  ): Promise<PermissionResult> => {
    if (pm === "bypassPermissions") {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }
    const requestId = uuidv4();
    emit({
      type: "permission_request",
      requestId,
      toolUseId,
      toolName,
      input,
      sessionId: session!.id,
      timestamp: Date.now(),
    });
    return new Promise<PermissionResult>((resolve, reject) => {
      const pending: PendingPermission = {
        resolve,
        reject,
        toolName,
        input,
        sessionId: session!.id,
        timestamp: Date.now(),
      };
      pendingPermissions.set(requestId, pending);
      setTimeout(() => {
        if (pendingPermissions.has(requestId)) {
          pendingPermissions.delete(requestId);
          resolve({ behavior: "deny", message: "权限请求超时" });
        }
      }, PERMISSION_TIMEOUT);
    });
  };

  emit({
    type: "init",
    sessionId: session.id,
    userMessageId,
    assistantMessageId,
    model: selectedModel,
  });

  try {
    console.log(`[Chat] 调用 OpenAI 兼容模型: ${selectedModel} | CWD: ${workingDir} | PM: ${pm}`);
    const { content, toolCalls } = await runCodingAgent({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL,
      model: selectedModel,
      messages,
      workingDir,
      permissionMode: pm,
      emit,
      requestPermission,
      userId: (req as any).user?.userId,
    });

    db.createMessage({
      id: assistantMessageId,
      session_id: session.id,
      role: "assistant",
      content,
      model: selectedModel,
      created_at: new Date().toISOString(),
      tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
    });

    const messagesNow = db.getMessagesBySession(session.id);
    if (messagesNow.length <= 2) {
      db.updateSession(session.id, {
        title: message.slice(0, 30) + (message.length > 30 ? "..." : ""),
        model: selectedModel,
      });
    }

    console.log(`[Chat] 请求完成 ✓`);
    emit({ type: "done" });
    res.end();
  } catch (error: any) {
    console.error(`\n[Chat] ========== 错误 ==========`);
    console.error(`[Chat] Error:`, error?.message || error);
    const msg = error?.message || "处理请求时发生错误";
    emit({ type: "text", content: `\n\n⚠️ 出错: ${msg}` });
    emit({ type: "done" });
    res.end();
  }
});

// ============= 生产环境静态托管 =============
const distDir = path.join(__dirnameDir, "..", "dist");
if (fs.existsSync(distDir)) {
  console.log(`[Server] 生产模式：托管前端静态资源 -> ${distDir}`);
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  console.log("[Server] 开发模式：未检测到 dist/，仅启动 API 服务（请用 npm run dev 启动前端）");
}

app.set("trust proxy", true);

// ============= WebSocket（IM 实时通信）=============
const httpServer = createServer(app);
const io = setupWebSocket(httpServer);
// 把 io 实例挂到 app 上，供 REST 路由广播使用
app.set("io", io);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔════════════════════════════════════════════╗
║                                            ║
║     ◉ ProCoder Agent 服务已启动            ║
║                                            ║
║     地址: http://0.0.0.0:${PORT}              ║
║     数据库: SQLite (data/chat.db)          ║
║     默认工作目录: ${process.env.DEFAULT_CWD || process.cwd()} ║
║     WebSocket: /ws                         ║
║                                            ║
╚════════════════════════════════════════════╝
  `);
});
