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


export interface RegisterData {
  username: string;
  password: string;
  displayName: string;
  role?: 'admin' | 'member';
}

export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  avatar: string | null;
}

export async function registerUser(data: RegisterData): Promise<{ user: UserInfo }> {
  const res = await apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '创建失败' }));
    throw new Error(err.error || '创建失败');
  }
  return res.json();
}

export async function fetchUsers(): Promise<UserInfo[]> {
  const res = await apiFetch('/api/auth/users');
  if (!res.ok) throw new Error('获取用户列表失败');
  const data = await res.json();
  return data.users || [];
}
