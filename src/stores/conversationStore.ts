import { create } from 'zustand';
import { apiFetch } from '../api/http';

export interface ConvMember {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

export interface Conversation {
  id: string;
  title: string | null;
  type: 'private' | 'group';
  created_by: string;
  created_at: string;
  updated_at: string;
  members: ConvMember[];
  unreadCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
}

export interface ImMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  senderName: string;
  content: string;
  created_at: string;
}

interface ConvState {
  conversations: Conversation[];
  currentConvId: string | null;
  messages: ImMessage[];
  loadingMessages: boolean;

  fetchConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: (type: 'private' | 'group', memberIds: string[], title?: string) => Promise<string>;
  addMessage: (msg: ImMessage) => void;
  markRead: (id: string) => Promise<void>;
}

export const useConversationStore = create<ConvState>((set, get) => ({
  conversations: [],
  currentConvId: null,
  messages: [],
  loadingMessages: false,

  fetchConversations: async () => {
    try {
      const res = await apiFetch('/api/conversations');
      if (res.ok) {
        const data = await res.json();
        set({ conversations: data.conversations || [] });
      }
    } catch (e) {
      console.error('Failed to fetch conversations:', e);
    }
  },

  selectConversation: async (id: string) => {
    set({ currentConvId: id, loadingMessages: true, messages: [] });

    try {
      const res = await apiFetch(`/api/conversations/${id}/messages`);
      if (res.ok) {
        const data = await res.json();
        set({ messages: data.messages || [], loadingMessages: false });
      } else {
        set({ loadingMessages: false });
      }
    } catch (e) {
      console.error('Failed to load messages:', e);
      set({ loadingMessages: false });
    }

    // 标记已读 + 重置本地未读数
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === id ? { ...conv, unreadCount: 0 } : conv
      ),
    }));
    get().markRead(id);
  },

  createConversation: async (type, memberIds, title) => {
    const res = await apiFetch('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ type, memberIds, title }),
    });
    const data = await res.json();
    await get().fetchConversations();
    return data.conversation.id;
  },

  addMessage: (msg) => {
    set((state) => {
      const isCurrent = msg.conversation_id === state.currentConvId;
      const newMessages = isCurrent ? [...state.messages, msg] : state.messages;

      // 局部更新会话列表：lastMessage / lastMessageAt / unreadCount
      const newConversations = state.conversations.map((conv) => {
        if (conv.id !== msg.conversation_id) return conv;
        return {
          ...conv,
          lastMessage: msg.content,
          lastMessageAt: msg.created_at,
          unreadCount: isCurrent ? conv.unreadCount : conv.unreadCount + 1,
        };
      });

      return { messages: newMessages, conversations: newConversations };
    });
  },

  markRead: async (id) => {
    try {
      await apiFetch(`/api/conversations/${id}/read`, { method: 'POST' });
    } catch (e) {
      console.error('Failed to mark read:', e);
    }
  },
}));
