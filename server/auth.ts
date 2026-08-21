import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const TOKEN_EXPIRES = process.env.JWT_EXPIRES_IN || '24h';

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
