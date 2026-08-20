import { create } from 'zustand';
import { apiFetch } from '../api/http';

interface TaskAssignee {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date: string | null;
  created_by: string;
  assignees: TaskAssignee[];
  created_at: string;
  updated_at: string;
}

interface TaskComment {
  id: string;
  task_id: string;
  user_id: string;
  userName: string;
  content: string;
  created_at: string;
}

interface TaskState {
  tasks: Task[];
  currentTaskId: string | null;
  comments: TaskComment[];
  loading: boolean;
  fetchTasks: (filter?: { status?: string; assignee?: string }) => Promise<void>;
  selectTask: (id: string | null) => void;
  createTask: (data: { title: string; description?: string; priority?: string; due_date?: string; assigneeIds?: string[] }) => Promise<string>;
  updateTask: (id: string, data: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  fetchComments: (taskId: string) => Promise<void>;
  addComment: (taskId: string, content: string) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  currentTaskId: null,
  comments: [],
  loading: false,

  fetchTasks: async (filter) => {
    set({ loading: true });
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.assignee) params.set('assignee', filter.assignee);

    const res = await apiFetch(`/api/tasks?${params}`);
    if (res.ok) {
      const data = await res.json();
      set({ tasks: data.tasks || [], loading: false });
    } else {
      set({ loading: false });
    }
  },

  selectTask: (id) => {
    set({ currentTaskId: id });
    if (id) {
      get().fetchComments(id);
    } else {
      set({ comments: [] });
    }
  },

  createTask: async (data) => {
    const res = await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    const result = await res.json();
    await get().fetchTasks();
    return result.task.id;
  },

  updateTask: async (id, data) => {
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    await get().fetchTasks();
  },

  deleteTask: async (id) => {
    await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
    const state = get();
    if (state.currentTaskId === id) {
      set({ currentTaskId: null, comments: [] });
    }
    await get().fetchTasks();
  },

  fetchComments: async (taskId) => {
    const res = await apiFetch(`/api/tasks/${taskId}/comments`);
    if (res.ok) {
      const data = await res.json();
      set({ comments: data.comments || [] });
    }
  },

  addComment: async (taskId, content) => {
    await apiFetch(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    await get().fetchComments(taskId);
  },
}));

export type { Task, TaskAssignee, TaskComment };
