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
  /** 部门，可不填；服务端会 trim，空串存成 null */
  department?: string;
}

export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  avatar: string | null;
  /**
   * 部门，null = 未填。仅用于同名消歧的展示，选人器里拼成「张三 · 技术部」。
   * 拼接在前端做，与「（已注销）」后缀在服务端做相反 —— 原因见 server/presenters.ts。
   */
  department?: string | null;
  /**
   * 注销时间，null = 在职。
   *
   * 注意本接口（账号面）给的 displayName 是**原始**姓名、不带「（已注销）」后缀 ——
   * 编辑弹窗要把它回填进输入框，带后缀的话一保存就写成了真实姓名。
   * 会话成员、任务负责人等内容面接口走的是另一套表示，那里的 displayName 带后缀。
   */
  deletedAt?: string | null;
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

/** includeDeleted 仅管理员有效，服务端会忽略非管理员的该参数。 */
export async function fetchUsers(options?: { includeDeleted?: boolean }): Promise<UserInfo[]> {
  const res = await apiFetch(
    options?.includeDeleted ? '/api/auth/users?includeDeleted=1' : '/api/auth/users'
  );
  if (!res.ok) throw new Error('获取用户列表失败');
  const data = await res.json();
  return data.users || [];
}
