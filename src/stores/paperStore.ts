import { create } from 'zustand';
import { apiFetch } from '../api/http';

export interface Paper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  doi: string | null;
  url: string | null;
  source: string | null;
  tags: string[];
  status: 'unread' | 'reading' | 'finished';
  notes: string | null;
  added_by: string;
  added_at: string;
  updated_at: string;
}

export interface PaperNote {
  id: string;
  paper_id: string;
  user_id: string;
  userName: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface PaperState {
  papers: Paper[];
  currentPaperId: string | null;
  notes: PaperNote[];
  loading: boolean;
  fetchPapers: (filter?: { status?: string; tag?: string; search?: string }) => Promise<void>;
  selectPaper: (id: string | null) => void;
  createPaper: (data: any) => Promise<void>;
  updatePaper: (id: string, data: any) => Promise<void>;
  deletePaper: (id: string) => Promise<void>;
  fetchNotes: (paperId: string) => Promise<void>;
  addNote: (paperId: string, content: string) => Promise<void>;
  updateNote: (paperId: string, noteId: string, content: string) => Promise<void>;
  deleteNote: (paperId: string, noteId: string) => Promise<void>;
  summarize: (paperId: string) => Promise<string>;
}

export const usePaperStore = create<PaperState>((set, get) => ({
  papers: [],
  currentPaperId: null,
  notes: [],
  loading: false,

  fetchPapers: async (filter) => {
    set({ loading: true });
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.tag) params.set('tag', filter.tag);
    if (filter?.search) params.set('search', filter.search);
    const res = await apiFetch(`/api/papers?${params}`);
    if (res.ok) {
      const data = await res.json();
      set({ papers: data.papers || [], loading: false });
    } else {
      set({ loading: false });
    }
  },

  selectPaper: (id) => {
    set({ currentPaperId: id });
    if (id) get().fetchNotes(id);
    else set({ notes: [] });
  },

  createPaper: async (data) => {
    await apiFetch('/api/papers', { method: 'POST', body: JSON.stringify(data) });
    await get().fetchPapers();
  },

  updatePaper: async (id, data) => {
    await apiFetch(`/api/papers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
    await get().fetchPapers();
  },

  deletePaper: async (id) => {
    await apiFetch(`/api/papers/${id}`, { method: 'DELETE' });
    const state = get();
    if (state.currentPaperId === id) set({ currentPaperId: null, notes: [] });
    await get().fetchPapers();
  },

  fetchNotes: async (paperId) => {
    const res = await apiFetch(`/api/papers/${paperId}/notes`);
    if (res.ok) {
      const data = await res.json();
      set({ notes: data.notes || [] });
    }
  },

  addNote: async (paperId, content) => {
    await apiFetch(`/api/papers/${paperId}/notes`, { method: 'POST', body: JSON.stringify({ content }) });
    await get().fetchNotes(paperId);
  },

  updateNote: async (paperId, noteId, content) => {
    await apiFetch(`/api/papers/${paperId}/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify({ content }) });
    await get().fetchNotes(paperId);
  },

  deleteNote: async (paperId, noteId) => {
    await apiFetch(`/api/papers/${paperId}/notes/${noteId}`, { method: 'DELETE' });
    await get().fetchNotes(paperId);
  },

  summarize: async (paperId) => {
    const res = await apiFetch(`/api/papers/${paperId}/summarize`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      return data.summary || '综述生成失败';
    }
    return '综述生成失败';
  },
}));
