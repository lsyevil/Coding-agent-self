import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { useConversationStore, ImMessage } from '../stores/conversationStore';

export function useWebSocket() {
  const socketRef = useRef<Socket | null>(null);
  const token = useAuthStore((s) => s.token);
  const addMessage = useConversationStore((s) => s.addMessage);

  useEffect(() => {
    if (!token) return;

    const socket = io({
      path: '/ws',
      auth: { token },
    });

    socketRef.current = socket;

    // 服务端广播为 camelCase，归一化为 store 的 snake_case 结构
    socket.on('im:message', (raw: any) => {
      const msg: ImMessage = {
        id: raw.id,
        conversation_id: raw.conversationId,
        sender_id: raw.senderId,
        senderName: raw.senderName,
        content: raw.content,
        created_at: raw.createdAt,
      };
      addMessage(msg);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, addMessage]);

  const sendMessage = useCallback((conversationId: string, content: string) => {
    socketRef.current?.emit('im:message', { conversationId, content });
  }, []);

  const joinConversation = useCallback((conversationId: string) => {
    socketRef.current?.emit('conv:join', conversationId);
  }, []);

  const leaveConversation = useCallback((conversationId: string) => {
    socketRef.current?.emit('conv:leave', conversationId);
  }, []);

  const sendTyping = useCallback((conversationId: string) => {
    socketRef.current?.emit('im:typing', { conversationId });
  }, []);

  return { sendMessage, joinConversation, leaveConversation, sendTyping };
}
