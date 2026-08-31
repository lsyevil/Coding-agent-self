import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { AuthPayload, verifyToken } from './auth.js';
import * as db from './db.js';

export function setupWebSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    path: '/ws',
  });

  // JWT 认证中间件
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('未认证'));
    try {
      const payload = verifyToken(token);
      (socket as any).user = payload;
      next();
    } catch {
      next(new Error('Token 无效'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as any).user as AuthPayload;

    // 加入个人房间（用于新会话通知）与所有 IM 会话房间
    socket.join(`user:${user.userId}`);
    const conversations = db.getConversationsByUserId(user.userId);
    for (const conv of conversations) {
      socket.join(`conv:${conv.id}`);
    }

    // 发送 IM 消息
    socket.on('im:message', (data: { conversationId: string; content: string }) => {
      if (!data?.conversationId || !data?.content?.trim()) return;

      // 校验是否为会话成员
      if (!db.isConversationMember(data.conversationId, user.userId)) {
        socket.emit('error', { message: '不是会话成员' });
        return;
      }

      const now = new Date().toISOString();
      const msg = db.createImMessage({
        id: uuidv4(),
        conversation_id: data.conversationId,
        sender_id: user.userId,
        content: data.content,
        created_at: now,
      });

      // 广播给同会话所有人
      io.to(`conv:${data.conversationId}`).emit('im:message', {
        id: msg.id,
        conversationId: msg.conversation_id,
        senderId: msg.sender_id,
        senderName: user.username,
        content: msg.content,
        createdAt: msg.created_at,
      });
    });

    // 加入新会话房间
    socket.on('conv:join', (conversationId: string) => {
      if (db.isConversationMember(conversationId, user.userId)) {
        socket.join(`conv:${conversationId}`);
      }
    });

    // 离开会话房间
    socket.on('conv:leave', (conversationId: string) => {
      socket.leave(`conv:${conversationId}`);
    });

    // 正在输入
    socket.on('im:typing', (data: { conversationId: string }) => {
      socket.to(`conv:${data.conversationId}`).emit('im:typing', {
        userId: user.userId,
        username: user.username,
      });
    });

    socket.on('disconnect', () => {
      // 可选：通知同会话的人
    });
  });

  return io;
}
