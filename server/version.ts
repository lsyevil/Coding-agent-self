/**
 * 部署版本自省。
 *
 * 存在的理由:此前无法回答「服务器上正在跑的是哪个版本」——只能靠查库里的标记行、
 * 翻启动日志这类考古手段,而且最容易漏的一步(拉了代码但没重启进程)恰好是考古查不出来的。
 *
 * 核心设计:**正在运行的 commit 在模块加载期读一次就固定下来**(RUNNING_COMMIT),
 * 请求时再读一次磁盘上的 commit(带 TTL 缓存)。两者不一致 = 代码拉下来了但进程没重启。
 * 这正是「我改动上没上服务器」这个问题需要的判据 —— 报告的是进程里跑的东西,
 * 不是磁盘上躺的东西。
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export interface VersionInfo {
  /** 正在运行的 commit(进程启动时读到的) */
  commit: string;
  commitShort: string;
  branch: string;
  /** 工作区是否有未提交改动;null = 无法判断(没有 git 或未安装) */
  dirty: boolean | null;
  startedAt: string;
  uptimeSeconds: number;
  /** dist/index.html 的 mtime;null = 前端产物不存在 */
  frontendBuiltAt: string | null;
  /** 请求时磁盘上的 commit */
  commitOnDisk: string;
  /** true = 磁盘代码比进程新,说明拉了代码但没重启 */
  stale: boolean;
  /** false = 部署不一致或无法验证;路由据此回 503,好让 `curl -f` 直接非零退出 */
  ok: boolean;
  /** 阻塞性问题,决定 ok */
  warnings: string[];
  /** 提示性信息,不影响 ok */
  notes: string[];
}

/** 解析 .git 目录位置。worktree / submodule 下 .git 是文件而非目录。 */
function resolveGitDir(): string | null {
  const dotGit = path.join(ROOT, '.git');
  try {
    const st = fs.statSync(dotGit);
    if (st.isDirectory()) return dotGit;
    // `gitdir: /abs/or/relative/path`
    const m = fs.readFileSync(dotGit, 'utf-8').match(/^gitdir:\s*(.+)$/m);
    if (!m) return null;
    const p = m[1].trim();
    return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
  } catch {
    return null;
  }
}

/**
 * 直接读 git 的引用文件,不起子进程 —— 这个函数在请求路径上会被调用,
 * 每次请求 spawn 一个 git 进程是不能接受的。
 */
function readCommitFromDisk(): { commit: string; branch: string } {
  // 部署流水线常把 commit 注入环境变量;也覆盖了服务器上没有 .git 的情况(只拷产物)
  const fromEnv = (process.env.GIT_COMMIT || '').trim();
  if (fromEnv) {
    return { commit: fromEnv, branch: (process.env.GIT_BRANCH || '(env)').trim() };
  }

  const gitDir = resolveGitDir();
  if (!gitDir) return { commit: 'unknown', branch: 'unknown' };

  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();

    // detached HEAD:HEAD 里直接是 sha
    if (!head.startsWith('ref:')) {
      return { commit: head, branch: '(detached)' };
    }

    const ref = head.slice(4).trim();
    const branch = ref.replace(/^refs\/heads\//, '');

    // 松散引用
    const loose = path.join(gitDir, ref);
    if (fs.existsSync(loose)) {
      return { commit: fs.readFileSync(loose, 'utf-8').trim(), branch };
    }

    // 打包引用:`<sha> <refname>`
    const packed = path.join(gitDir, 'packed-refs');
    if (fs.existsSync(packed)) {
      for (const line of fs.readFileSync(packed, 'utf-8').split('\n')) {
        if (line.startsWith('#') || line.startsWith('^')) continue;
        const [sha, name] = line.trim().split(/\s+/);
        if (name === ref) return { commit: sha, branch };
      }
    }

    return { commit: 'unknown', branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

/**
 * 工作区脏检查只在启动时做一次:它需要遍历索引与工作区,只有 git 自己算得准,
 * 而起子进程的开销不该进请求路径。
 *
 * 用 `-uno` 排除未跟踪文件:服务器上总会有日志、临时文件之类的未跟踪内容,
 * 算进来会让 dirty 永远为 true、这个字段彻底失去信号价值。
 * 真正需要知道的是「被跟踪的文件是否被改过」。
 */
function readDirtyOnce(): boolean | null {
  try {
    const out = execSync('git status --porcelain -uno', {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return null;
  }
}

// ---- 进程启动时固定下来的事实 ----
const STARTED_AT = new Date();
const RUNNING = readCommitFromDisk();
const RUNNING_DIRTY = readDirtyOnce();

// 磁盘 commit 的短 TTL 缓存:/api/version 可能被健康轮询打,别每次都读文件
let diskCache: { commit: string; at: number } | null = null;
const DISK_TTL_MS = 5000;

function commitOnDisk(): string {
  const now = Date.now();
  if (diskCache && now - diskCache.at < DISK_TTL_MS) return diskCache.commit;
  const commit = readCommitFromDisk().commit;
  diskCache = { commit, at: now };
  return commit;
}

function frontendBuiltAt(): string | null {
  try {
    return fs.statSync(path.join(ROOT, 'dist', 'index.html')).mtime.toISOString();
  } catch {
    return null;
  }
}

export function getVersionInfo(): VersionInfo {
  const onDisk = commitOnDisk();
  const built = frontendBuiltAt();
  // unknown 时不判定 stale:两边都取不到值,相等只是巧合,报 stale=false 会给出虚假的安心
  const stale =
    RUNNING.commit !== 'unknown' && onDisk !== 'unknown' && RUNNING.commit !== onDisk;

  const warnings: string[] = [];
  const notes: string[] = [];
  if (stale) {
    warnings.push(
      `磁盘上的代码(${onDisk.slice(0, 7)})比进程里跑的(${RUNNING.commit.slice(0, 7)})新:` +
        '拉取后没有重启进程,当前生效的仍是旧代码。'
    );
  }
  if (!built) {
    warnings.push('dist/index.html 不存在:没有执行 npm run build,前端无法提供。');
  }
  if (RUNNING.commit === 'unknown') {
    // 「查不出来」不等于「没问题」,所以算阻塞项
    warnings.push('无法确定运行版本:既没有 .git 也没有 GIT_COMMIT 环境变量。');
  }
  if (RUNNING_DIRTY) {
    // 只作提示:npm install 有可能改写 package-lock.json,
    // 把 dirty 算成阻塞项会让正常部署每次都报失败。
    notes.push('工作区有未提交改动,服务器代码与该 commit 不完全一致(常见于 npm 改写锁文件)。');
  }

  return {
    commit: RUNNING.commit,
    commitShort: RUNNING.commit.slice(0, 7),
    branch: RUNNING.branch,
    dirty: RUNNING_DIRTY,
    startedAt: STARTED_AT.toISOString(),
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT.getTime()) / 1000),
    frontendBuiltAt: built,
    commitOnDisk: onDisk,
    stale,
    ok: warnings.length === 0,
    warnings,
    notes,
  };
}
