import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 曾经作为默认值出现过的弱密钥，一律不接受 */
const WEAK_SECRETS = new Set(['change-me-in-production', 'changeme', 'secret', 'your_secret_here']);

/**
 * 解析 JWT 签名密钥。
 *
 * 生产环境（NODE_ENV=production）必须显式提供强密钥，缺失或仍是弱默认值就拒绝启动 ——
 * 否则任何人都能用公开的默认密钥伪造管理员 Token。
 *
 * 开发环境允许不配：生成随机密钥并持久化到 data/.jwt-secret。
 * 持久化是必需的 —— tsx watch 每次热重启都会重新加载本模块，
 * 若每次生成新密钥，改一行代码就会把所有人踢下线。
 */
function resolveJwtSecret(): string {
  const fromEnv = (process.env.JWT_SECRET || '').trim();
  const isProd = process.env.NODE_ENV === 'production';

  if (fromEnv && !WEAK_SECRETS.has(fromEnv)) return fromEnv;

  if (isProd) {
    console.error(
      fromEnv
        ? '[Auth] 致命错误: JWT_SECRET 是公开的默认弱密钥，生产环境拒绝启动。'
        : '[Auth] 致命错误: 生产环境必须设置 JWT_SECRET。'
    );
    console.error('[Auth] 生成方式:  openssl rand -base64 48');
    process.exit(1);
  }

  const secretFile = path.join(__dirname, '..', 'data', '.jwt-secret');
  try {
    if (fs.existsSync(secretFile)) {
      const cached = fs.readFileSync(secretFile, 'utf8').trim();
      if (cached) {
        console.warn('[Auth] 未设置 JWT_SECRET，已复用 data/.jwt-secret（仅限开发环境）');
        return cached;
      }
    }
    const generated = crypto.randomBytes(48).toString('base64');
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    console.warn('[Auth] 未设置 JWT_SECRET，已生成随机密钥并写入 data/.jwt-secret（仅限开发环境）');
    return generated;
  } catch (e: any) {
    console.warn(
      `[Auth] 未设置 JWT_SECRET，且无法写入 data/.jwt-secret（${e?.message || e}）；` +
        '本次使用内存临时密钥，重启后需重新登录。'
    );
    return crypto.randomBytes(48).toString('base64');
  }
}

const JWT_SECRET = resolveJwtSecret();
// @types/jsonwebtoken v9 把 expiresIn 收窄成 `number | StringValue`（模板字面量类型），
// 而这里的值来自 env，只能是 string。断言到 SignOptions 上对应的字段类型，
// 保留运行期由 jsonwebtoken 自己校验格式（非法值会在 sign 时抛错）。
const TOKEN_EXPIRES = (process.env.JWT_EXPIRES_IN ||
  '24h') as jwt.SignOptions['expiresIn'];

export interface AuthPayload {
  userId: string;
  username: string;
  role: string;
  jti?: string;
}

/** 生成 JWT */
export function generateToken(user: {
  id: string;
  username: string;
  role: string;
}): string {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role, jti: uuidv4() } as AuthPayload & { jti: string },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRES }
  );
}

/**
 * 校验并解析 Token。
 * ws.ts 走这个入口而不是自己再读一遍 JWT_SECRET ——
 * 两处各自 `process.env.JWT_SECRET || '默认值'` 的写法会在密钥解析规则变化时不一致。
 * 校验失败会抛异常，由调用方处理。
 */
export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

/** 验证密码 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** 哈希密码 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/** 同步哈希（用于初始化） */
export function hashPasswordSync(password: string): string {
  return bcrypt.hashSync(password, 10);
}

/** Express 认证中间件 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: '未登录' });
    return;
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    // 检查 Token 黑名单
    if (payload.jti) {
      if (db.isBlacklisted(payload.jti)) {
        res.status(401).json({ error: 'Token 已被吊销' });
        return;
      }
    } else {
      // 旧 Token 无 jti，记录警告
      console.warn(`[Auth] Token without jti from user ${payload.userId}, skipping blacklist check`);
    }
    // 检查用户是否已被删除
    if (db.isBlacklisted(`user_deleted_${payload.userId}`)) {
      res.status(401).json({ error: '用户已被删除' });
      return;
    }
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token 无效或已过期' });
  }
}

/** 可选认证 — 不强制登录，但如果有 token 就解析 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const token = header.slice(7);
      (req as any).user = jwt.verify(token, JWT_SECRET) as AuthPayload;
    } catch {
      // token 无效，忽略
    }
  }
  next();
}
