/**
 * OpenAI 兼容的 Coding Agent 引擎
 *
 * 替代原 @tencent-ai/agent-sdk：用任意 OpenAI 兼容端点（baseURL 可配）
 * 驱动一个会读写文件、搜索代码、执行命令的专业级编程 Agent。
 *
 * 该模块只负责「一次用户请求」内的 Agent 循环，并通过 emit / requestPermission
 * 回调把事件与权限流对接到现有 Express + SSE 前端协议，不改变前端。
 */
import OpenAI from "openai";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ---- 类型 ----
export interface ToolCallRec {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "running" | "completed" | "error";
  result?: string;
  isError?: boolean;
}

export type EmitFn = (obj: Record<string, unknown>) => void;

export interface PermissionResult {
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown>;
  message?: string;
}

export type RequestPermissionFn = (
  toolName: string,
  input: Record<string, unknown>,
  toolUseId: string
) => Promise<PermissionResult>;

export interface RunAgentParams {
  apiKey: string;
  baseURL?: string;
  model: string;
  // OpenAI 消息数组（system + 历史 + 当前 user 消息），循环中会原地追加
  messages: any[];
  workingDir: string;
  permissionMode: string;
  emit: EmitFn;
  requestPermission: RequestPermissionFn;
}

const MAX_OUTPUT = 20000; // 单条工具结果最大返回长度
const MAX_TURNS = 25; // 单次请求最大工具轮数

// ---- 工具定义（OpenAI function calling 格式）----
function getToolDefs(): any[] {
  return [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "读取文件内容（UTF-8）。用于查看现有代码、配置、日志等。",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "相对或绝对文件路径" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_directory",
        description: "列出目录内容，标注目录(DIR)/文件(FILE)。",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "目录路径，默认当前工作目录" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_files",
        description: "在工作目录内递归搜索文件内容（支持正则）。忽略 node_modules/.git/dist 等。",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "搜索关键词或正则表达式" },
            path: { type: "string", description: "搜索起点目录，默认工作目录" },
          },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description: "创建或覆盖写入文件（会修改磁盘，需要权限）。",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "文件路径" },
            content: { type: "string", description: "完整文件内容" },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit_file",
        description: "用精确字符串替换修改文件中的一处或多处文本（会修改磁盘，需要权限）。old_string 必须唯一。",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "文件路径" },
            old_string: { type: "string", description: "要被替换的原始文本（需唯一）" },
            new_string: { type: "string", description: "替换后的新文本" },
          },
          required: ["path", "old_string", "new_string"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_file",
        description: "删除文件（会修改磁盘，需要权限）。",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "文件路径" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_command",
        description: "在服务器上执行 shell 命令（会修改环境，需要权限）。用于安装依赖、运行测试、构建、git 等操作。",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "要执行的 shell 命令" },
            cwd: { type: "string", description: "命令工作目录，默认 Agent 工作目录" },
          },
          required: ["command"],
        },
      },
    },
  ];
}

// ---- 路径安全：限制在 workingDir 内 ----
function resolveWithin(workingDir: string, p: string): string {
  const base = path.resolve(workingDir);
  const target = path.isAbsolute(p) ? path.resolve(p) : path.resolve(base, p);
  const rel = path.relative(base, target);
  if (rel.startsWith("..")) {
    throw new Error(`路径超出工作目录，已拒绝: ${p}`);
  }
  return target;
}

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT) return s;
  return (
    `...（输出过长，仅显示末尾 ${MAX_OUTPUT} 字符）...\n` + s.slice(s.length - MAX_OUTPUT)
  );
}

// ---- 递归内容搜索 ----
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache", ".next", "coverage"]);

function grepWalk(dir: string, pattern: string, matches: string[], filesSeen: number): void {
  if (filesSeen > 400 || matches.length > 80) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (matches.length > 80 || filesSeen > 400) break;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      grepWalk(full, pattern, matches, filesSeen);
    } else if (e.isFile()) {
      filesSeen++;
      let content: string;
      try {
        const stat = fs.statSync(full);
        if (stat.size > 1024 * 1024) return; // 跳过 >1MB
        content = fs.readFileSync(full, "utf8");
      } catch {
        return;
      }
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, "gi");
      } catch {
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push(`${path.relative(dir, full)}:${i + 1}: ${lines[i].slice(0, 200)}`);
          if (matches.length > 80) break;
        }
      }
    }
  }
}

// ---- 执行单个工具 ----
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  workingDir: string
): Promise<string> {
  switch (name) {
    case "read_file": {
      const p = resolveWithin(workingDir, String(input.path));
      const content = await fsp.readFile(p, "utf8");
      return truncate(content);
    }
    case "list_directory": {
      const p = resolveWithin(workingDir, String(input.path || "."));
      const entries = await fsp.readdir(p, { withFileTypes: true });
      const lines = entries
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()))
        .map((e) => `${e.isDirectory() ? "[DIR] " : "[FILE] "}${e.name}`);
      return `目录 ${p}:\n` + lines.join("\n");
    }
    case "search_files": {
      const start = resolveWithin(workingDir, String(input.path || "."));
      const matches: string[] = [];
      grepWalk(start, String(input.pattern), matches, 0);
      return matches.length
        ? `匹配 "${input.pattern}" (${matches.length}):\n` + matches.join("\n")
        : `未找到匹配 "${input.pattern}"`;
    }
    case "write_file": {
      const p = resolveWithin(workingDir, String(input.path));
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, String(input.content), "utf8");
      const size = Buffer.byteLength(String(input.content));
      return `已写入 ${p} (${size} 字节)`;
    }
    case "edit_file": {
      const p = resolveWithin(workingDir, String(input.path));
      const oldStr = String(input.old_string);
      const newStr = String(input.new_string);
      const text = await fsp.readFile(p, "utf8");
      const count = text.split(oldStr).length - 1;
      if (count === 0) throw new Error("未找到 old_string，请确认文本与缩进完全一致");
      if (count > 1) throw new Error(`old_string 出现 ${count} 次，不唯一，请提供更多上下文`);
      const updated = text.replace(oldStr, newStr);
      await fsp.writeFile(p, updated, "utf8");
      return `已更新 ${p}`;
    }
    case "delete_file": {
      const p = resolveWithin(workingDir, String(input.path));
      await fsp.unlink(p);
      return `已删除 ${p}`;
    }
    case "run_command": {
      const cmd = String(input.command);
      const cwd = resolveWithin(workingDir, String(input.cwd || "."));
      try {
        const { stdout, stderr } = await execAsync(cmd, {
          cwd,
          maxBuffer: 20 * 1024 * 1024,
          timeout: 120000,
        });
        const out = (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "");
        return truncate(out || "(命令无输出)");
      } catch (e: any) {
        const out = `${(e.stdout || "") + (e.stderr ? "\n" + e.stderr : "")}\n[exit ${e.code ?? "?"}] ${e.message || ""}`;
        return truncate(out);
      }
    }
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

// ---- 主循环 ----
export async function runCodingAgent(params: RunAgentParams): Promise<{
  content: string;
  toolCalls: ToolCallRec[];
}> {
  const { apiKey, baseURL, model, messages, workingDir, permissionMode, emit, requestPermission } = params;
  const client = new OpenAI({ apiKey, baseURL: baseURL || undefined });
  const toolDefs = getToolDefs();

  const toolCallsAcc: ToolCallRec[] = [];
  let fullResponse = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = await client.chat.completions.create({
      model,
      messages,
      tools: toolDefs,
      tool_choice: "auto",
      stream: true,
      temperature: 0.2,
    });

    let content = "";
    const toolAccum: any[] = [];

    for await (const chunk of stream) {
      const delta = (chunk as any).choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        emit({ type: "text", content: delta.content });
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolAccum[idx]) toolAccum[idx] = { id: "", name: "", arguments: "" };
          if (tc.id) toolAccum[idx].id = tc.id;
          if (tc.function?.name) toolAccum[idx].name = tc.function.name;
          if (tc.function?.arguments) toolAccum[idx].arguments += tc.function.arguments;
        }
      }
    }

    fullResponse += content;

    const finalTools = toolAccum
      .filter(Boolean)
      .map((t) => ({ id: t.id || `call_${Math.random().toString(36).slice(2)}`, name: t.name, arguments: t.arguments || "{}" }));

    // 无工具调用 -> 本轮结束
    if (finalTools.length === 0) {
      if (content) messages.push({ role: "assistant", content });
      break;
    }

    // 把 assistant（含 tool_calls）写入对话历史
    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: finalTools.map((t) => ({
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: t.arguments },
      })),
    });

    // 逐个执行工具
    for (const t of finalTools) {
      const toolId = t.id;
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(t.arguments || "{}");
      } catch {
        parsedInput = {};
      }

      const rec: ToolCallRec = { id: toolId, name: t.name, input: parsedInput, status: "running" };
      toolCallsAcc.push(rec);
      emit({ type: "tool", id: toolId, name: t.name, input: parsedInput, status: "running" });

      const mutating = ["write_file", "edit_file", "delete_file"].includes(t.name);
      const isCommand = t.name === "run_command";

      let allowed = true;
      let denyMsg = "";

      if (permissionMode === "plan" && (mutating || isCommand)) {
        allowed = false;
        denyMsg = "⚠️ plan 模式：只读，已拒绝该操作";
      } else if (permissionMode === "bypassPermissions") {
        allowed = true;
      } else if (mutating) {
        // default -> 询问；acceptEdits -> 自动
        if (permissionMode !== "acceptEdits") {
          const r = await requestPermission(t.name, parsedInput, toolId);
          if (r.behavior !== "allow") {
            allowed = false;
            denyMsg = r.message || "用户拒绝了此操作";
          }
        }
      } else if (isCommand) {
        // default & acceptEdits -> 询问；bypass -> 自动
        if (permissionMode !== "bypassPermissions") {
          const r = await requestPermission(t.name, parsedInput, toolId);
          if (r.behavior !== "allow") {
            allowed = false;
            denyMsg = r.message || "用户拒绝了此操作";
          }
        }
      }

      let result = "";
      let isError = false;
      if (!allowed) {
        result = denyMsg;
      } else {
        try {
          result = await executeTool(t.name, parsedInput, workingDir);
        } catch (e: any) {
          result = `工具执行错误: ${e?.message || String(e)}`;
          isError = true;
        }
      }

      rec.status = isError ? "error" : "completed";
      rec.isError = isError;
      rec.result = result;

      emit({ type: "tool_result", toolId, content: result, isError });
      messages.push({ role: "tool", tool_call_id: toolId, content: result });
    }
  }

  return { content: fullResponse, toolCalls: toolCallsAcc };
}
