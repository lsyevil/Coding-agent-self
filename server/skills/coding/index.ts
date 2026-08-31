import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Skill, SkillContext, ToolDefinition } from '../base.js';

const execAsync = promisify(exec);

const MAX_OUTPUT = 20000;

// ---- 路径安全：限制在 workingDir 内 ----
function resolveWithin(workingDir: string, p: string): string {
  const base = path.resolve(workingDir);
  const target = path.isAbsolute(p) ? path.resolve(p) : path.resolve(base, p);
  const rel = path.relative(base, target);
  if (rel.startsWith('..')) {
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

// ---- 命令安全：危险命令黑名单 ----
const BLOCKED_PATTERNS: Array<string | RegExp> = [
  // 字符串（精确匹配）
  'rm -rf /', 'rm -rf /*', 'rm -r /', 'rm -r /*',
  'mkfs', 'dd if=',
  ':(){:|:&};:',
  'chmod -r 777 /', 'chmod -r 777 /*',
  '> /dev/sda', '> /dev/nvme',
  'shutdown', 'reboot', 'halt', 'poweroff', 'init 0', 'init 6',
  'format c:', 'del /s /q',
  'rd /s /q c:\\', 'rmdir /s /q c:\\',
  'reg delete', 'bcdedit',
  // 正则（模式匹配）
  /curl.*\|.*sh/, /wget.*\|.*sh/,
  /curl.*\|.*bash/, /wget.*\|.*bash/,
];

function validateCommand(cmd: string): { safe: boolean; reason?: string } {
  const normalized = cmd.toLowerCase().trim();
  for (const pattern of BLOCKED_PATTERNS) {
    const matched = pattern instanceof RegExp
      ? pattern.test(normalized)
      : normalized.includes(pattern);
    if (matched) {
      return { safe: false, reason: `命令包含危险操作: ${pattern}` };
    }
  }
  return { safe: true };
}

// ---- 递归内容搜索 ----
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', '.next', 'coverage']);

/**
 * 递归内容搜索。
 * - startDir 独立于 dir 传递：匹配结果的相对路径必须以搜索起点为基准，
 *   用 dir 会让每层子目录都只输出文件名，丢掉路径信息。
 * - filesSeen 用对象包裹：number 是值传递，递归里的自增传不回来，限流形同虚设。
 */
function grepWalk(
  dir: string,
  startDir: string,
  pattern: string,
  matches: string[],
  state: { filesSeen: number }
): void {
  if (state.filesSeen > 400 || matches.length > 80) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 整个目录都读不了 —— 这一处必须保持 return
  }
  for (const e of entries) {
    if (matches.length > 80 || state.filesSeen > 400) break;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      grepWalk(full, startDir, pattern, matches, state);
    } else if (e.isFile()) {
      state.filesSeen++;
      let content: string;
      try {
        const stat = fs.statSync(full);
        if (stat.size > 1024 * 1024) continue; // 跳过这个大文件，而不是终止整个目录
        content = fs.readFileSync(full, 'utf8');
      } catch {
        continue; // 单个文件读不了也只跳过它
      }
      // 每个文件重建正则，且不带 g：带 g 的 RegExp 有 lastIndex 状态，
      // 跨行复用同一个实例会漏掉后面行的匹配。
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, 'i');
      } catch {
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push(`${path.relative(startDir, full)}:${i + 1}: ${lines[i].slice(0, 200)}`);
          if (matches.length > 80) break;
        }
      }
    }
  }
}

const TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取文件内容（UTF-8）。用于查看现有代码、配置、日志等。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '相对或绝对文件路径' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出目录内容，标注目录(DIR)/文件(FILE)。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '目录路径，默认当前工作目录' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: '在工作目录内递归搜索文件内容（支持正则）。忽略 node_modules/.git/dist 等。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索关键词或正则表达式' },
          path: { type: 'string', description: '搜索起点目录，默认工作目录' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '创建或覆盖写入文件（会修改磁盘，需要权限）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '完整文件内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '用精确字符串替换修改文件中的一处或多处文本（会修改磁盘，需要权限）。old_string 必须唯一。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          old_string: { type: 'string', description: '要被替换的原始文本（需唯一）' },
          new_string: { type: 'string', description: '替换后的新文本' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除文件（会修改磁盘，需要权限）。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '文件路径' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: '在服务器上执行 shell 命令（会修改环境，需要权限）。用于安装依赖、运行测试、构建、git 等操作。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 shell 命令' },
          cwd: { type: 'string', description: '命令工作目录，默认 Agent 工作目录' },
        },
        required: ['command'],
      },
    },
  },
];

export const codingSkill: Skill = {
  name: 'coding',
  displayName: '代码操作',
  description: '读写文件、搜索代码、执行命令，用于专业级编程任务。',
  enabled: true,

  getTools(): ToolDefinition[] {
    return TOOL_DEFS;
  },

  async execute(
    name: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<string> {
    const workingDir = context.workingDir;
    switch (name) {
      case 'read_file': {
        const p = resolveWithin(workingDir, String(input.path));
        const content = await fsp.readFile(p, 'utf8');
        return truncate(content);
      }
      case 'list_directory': {
        const p = resolveWithin(workingDir, String(input.path || '.'));
        const entries = await fsp.readdir(p, { withFileTypes: true });
        const lines = entries
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()))
          .map((e) => `${e.isDirectory() ? '[DIR] ' : '[FILE] '}${e.name}`);
        return `目录 ${p}:\n` + lines.join('\n');
      }
      case 'search_files': {
        const start = resolveWithin(workingDir, String(input.path || '.'));
        const matches: string[] = [];
        const state = { filesSeen: 0 };
        grepWalk(start, start, String(input.pattern), matches, state);
        return matches.length
          ? `匹配 "${input.pattern}" (${matches.length}):\n` + matches.join('\n')
          : `未找到匹配 "${input.pattern}"`;
      }
      case 'write_file': {
        const p = resolveWithin(workingDir, String(input.path));
        await fsp.mkdir(path.dirname(p), { recursive: true });
        await fsp.writeFile(p, String(input.content), 'utf8');
        const size = Buffer.byteLength(String(input.content));
        return `已写入 ${p} (${size} 字节)`;
      }
      case 'edit_file': {
        const p = resolveWithin(workingDir, String(input.path));
        const oldStr = String(input.old_string);
        const newStr = String(input.new_string);
        const text = await fsp.readFile(p, 'utf8');
        const count = text.split(oldStr).length - 1;
        if (count === 0) throw new Error('未找到 old_string，请确认文本与缩进完全一致');
        if (count > 1) throw new Error(`old_string 出现 ${count} 次，不唯一，请提供更多上下文`);
        const updated = text.replace(oldStr, newStr);
        await fsp.writeFile(p, updated, 'utf8');
        return `已更新 ${p}`;
      }
      case 'delete_file': {
        const p = resolveWithin(workingDir, String(input.path));
        await fsp.unlink(p);
        return `已删除 ${p}`;
      }
      case 'run_command': {
        const cmd = String(input.command);
        // 命令安全校验
        const validation = validateCommand(cmd);
        if (!validation.safe) {
          return `[已拒绝] ${validation.reason}`;
        }
        const cwd = resolveWithin(workingDir, String(input.cwd || '.'));
        try {
          const { stdout, stderr } = await execAsync(cmd, {
            cwd,
            maxBuffer: 1024 * 1024,
            timeout: 30000,
          });
          const out = (stdout || '') + (stderr ? `\n[stderr]\n${stderr}` : '');
          return truncate(out || '(命令无输出)');
        } catch (e: any) {
          if (e.killed) {
            return '[错误] 命令执行超时（30秒）';
          }
          const out = `${(e.stdout || '') + (e.stderr ? '\n' + e.stderr : '')}\n[exit ${e.code ?? '?'}] ${e.message || ''}`;
          return truncate(out);
        }
      }
      default:
        throw new Error(`未知工具: ${name}`);
    }
  },
};
