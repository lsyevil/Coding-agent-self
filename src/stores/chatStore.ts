import { create } from 'zustand';
import { apiFetch } from '../api/http';

interface Session {
  id: string;
  title: string;
  model: string;
  messageCount: number;
  updated_at: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: ToolCall[];
  created_at: string;
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  result?: string;
  isError?: boolean;
}

interface ChatState {
  sessions: Session[];
  currentSessionId: string | null;
  messages: Message[];
  isLoading: boolean;
  streamingContent: string;
  streamingToolCalls: ToolCall[];
  
  fetchSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  createSession: (title?: string) => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  stopGeneration: () => void;
  clearStreaming: () => void;
}

let abortController: AbortController | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  isLoading: false,
  streamingContent: '',
  streamingToolCalls: [],

  fetchSessions: async () => {
    try {
      const res = await apiFetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        set({ sessions: data.sessions });
      }
    } catch (e) {
      console.error('Failed to fetch sessions:', e);
    }
  },

  selectSession: async (id: string) => {
    try {
      const res = await apiFetch(`/api/sessions/${id}`);
      if (res.ok) {
        const data = await res.json();
        set({
          currentSessionId: id,
          messages: data.messages || [],
          streamingContent: '',
          streamingToolCalls: [],
        });
      }
    } catch (e) {
      console.error('Failed to select session:', e);
    }
  },

  createSession: async (title?: string) => {
    const res = await apiFetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: title || '新对话' }),
    });
    const data = await res.json();
    await get().fetchSessions();
    return data.session.id;
  },

  deleteSession: async (id: string) => {
    await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
    const state = get();
    if (state.currentSessionId === id) {
      set({ currentSessionId: null, messages: [], streamingContent: '', streamingToolCalls: [] });
    }
    await get().fetchSessions();
  },

  sendMessage: async (content: string) => {
    const state = get();
    let sessionId = state.currentSessionId;

    // 如果没有当前会话，先创建
    if (!sessionId) {
      sessionId = await state.createSession(content.slice(0, 30));
    }

    // 添加用户消息到本地列表
    const userMsg: Message = {
      id: `temp_${Date.now()}`,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    set({
      messages: [...state.messages, userMsg],
      isLoading: true,
      streamingContent: '',
      streamingToolCalls: [],
    });

    // 创建 AbortController
    abortController = new AbortController();

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId, message: content }),
        signal: abortController.signal,
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      const toolCalls: ToolCall[] = [];
      let buffer = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);

            switch (data.type) {
              case 'text':
                assistantContent += data.content;
                set({ streamingContent: assistantContent });
                break;
              case 'tool':
                toolCalls.push({
                  id: data.id,
                  name: data.name,
                  input: data.input,
                  status: 'running',
                });
                set({ streamingToolCalls: [...toolCalls] });
                break;
              case 'tool_result':
                const tc = toolCalls.find(t => t.id === data.toolId);
                if (tc) {
                  tc.result = data.content;
                  tc.status = data.isError ? 'error' : 'completed';
                  tc.isError = data.isError;
                  set({ streamingToolCalls: [...toolCalls] });
                }
                break;
              case 'done':
                break;
            }
          } catch {
            // JSON parse error, skip
          }
        }
      }

      // 完成后把 assistant 消息加入列表
      const assistantMsg: Message = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: assistantContent,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        created_at: new Date().toISOString(),
      };

      set({
        messages: [...get().messages, assistantMsg],
        isLoading: false,
        streamingContent: '',
        streamingToolCalls: [],
      });

      // 刷新会话列表
      get().fetchSessions();
    } catch (e: any) {
      if (e.name === 'AbortError') {
        // 用户主动停止
        const assistantMsg: Message = {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: state.streamingContent || '(已停止)',
          created_at: new Date().toISOString(),
        };
        set({
          messages: [...get().messages.filter(m => m.id !== userMsg.id || m.content), assistantMsg],
          isLoading: false,
        });
      } else {
        console.error('Send message error:', e);
        set({ isLoading: false });
      }
      abortController = null;
    }
  },

  stopGeneration: () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    set({ isLoading: false });
  },

  clearStreaming: () => {
    set({ streamingContent: '', streamingToolCalls: [] });
  },
}));
