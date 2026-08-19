import { apiFetch } from './http';
import type { AuthUser } from '../stores/authStore';

export interface LoginResult {
  token: string;
  user: AuthUser;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '登录失败');
  }
  return res.json();
}

export async function registerUser(input: {
  username: string;
  password: string;
  displayName: string;
  role?: 'admin' | 'member';
}): Promise<{ user: AuthUser }> {
  const res = await apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '创建用户失败');
  }
  return res.json();
}

export async function refreshToken(): Promise<{ token: string }> {
  const res = await apiFetch('/api/auth/refresh', { method: 'POST' });
  if (!res.ok) throw new Error('刷新失败');
  return res.json();
}

export async function listUsers(): Promise<{ users: AuthUser[] }> {
  const res = await apiFetch('/api/auth/users');
  if (!res.ok) throw new Error('获取用户列表失败');
  return res.json();
}
