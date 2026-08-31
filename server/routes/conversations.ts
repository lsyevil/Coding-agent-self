import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthPayload } from '../auth.js';
import * as db from '../db.js';
import { toPublicUser, displayNameOf } from '../presenters.js';

const router = Router();

// 会话成员统一走 toPublicUser：已注销成员的名字会带上「（已注销）」后缀。
// 成员列表刻意保留已注销的人（getConversationMembers 不过滤）—— 把他们从历史会话的
// 成员列表里抹掉，会让「这条消息是谁发的」失去上下文。

// GET /api/conversations — 我的会话列表（含成员、未读数、最后消息预览）
router.get('/', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const conversations = db.getConversationsByUserId(user.userId);

  const result = conversations.map((conv) => {
    const members = db.getConversationMembers(conv.id).map(toPublicUser);
    const unreadCount = db.getUnreadCount(conv.id, user.userId);
    const latest = db.getImMessages(conv.id, 1)[0];
    return {
      ...conv,
      members,
      unreadCount,
      lastMessage: latest?.content ?? null,
      lastMessageAt: latest?.created_at ?? null,
    };
  });

  res.json({ conversations: result });
});

// POST /api/conversations — 创建会话
router.post('/', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const { type, title, memberIds } = req.body;

  if (!type || !['private', 'group'].includes(type)) {
    return res.status(400).json({ error: 'type 必须是 private 或 group' });
  }

  // 私聊：检查是否已存在（两人之间唯一）
  if (type === 'private' && memberIds?.length === 1) {
    const existing = db.findPrivateConversation(user.userId, memberIds[0]);
    if (existing) {
      return res.json({ conversation: existing });
    }
  }

  // 成员列表 = 发起者 + 邀请的人
  const allMemberIds = Array.from(new Set([user.userId, ...(memberIds || [])]));

  const conv = db.createConversation({
    id: uuidv4(),
    title: type === 'private' ? null : title || null,
    type,
    created_by: user.userId,
    member_ids: allMemberIds,
    created_at: new Date().toISOString(),
  });

  res.json({ conversation: conv });
});

// GET /api/conversations/:id — 会话详情
router.get('/:id', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const conv = db.getConversation(req.params.id);

  if (!conv) return res.status(404).json({ error: '会话不存在' });
  if (!db.isConversationMember(conv.id, user.userId)) {
    return res.status(403).json({ error: '无权访问' });
  }

  const members = db.getConversationMembers(conv.id).map(toPublicUser);
  const unreadCount = db.getUnreadCount(conv.id, user.userId);

  res.json({
    conversation: {
      ...conv,
      members,
      unreadCount,
    },
  });
});

// GET /api/conversations/:id/messages — 获取历史消息
router.get('/:id/messages', (req, res) => {
  const user = (req as any).user as AuthPayload;
  if (!db.isConversationMember(req.params.id, user.userId)) {
    return res.status(403).json({ error: '无权访问' });
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const before = req.query.before as string | undefined;
  const messages = db.getImMessages(req.params.id, limit, before);

  // 附带发送者名称
  const enriched = messages.map((msg) => {
    const sender = db.getUser(msg.sender_id);
    return {
      ...msg,
      senderName: displayNameOf(sender),
    };
  });

  res.json({ messages: enriched });
});

// POST /api/conversations/:id/messages — REST 方式发消息（备用，主要走 WebSocket）
router.post('/:id/messages', (req, res) => {
  const user = (req as any).user as AuthPayload;
  if (!db.isConversationMember(req.params.id, user.userId)) {
    return res.status(403).json({ error: '无权访问' });
  }

  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: '消息内容不能为空' });

  const now = new Date().toISOString();
  const msg = db.createImMessage({
    id: uuidv4(),
    conversation_id: req.params.id,
    sender_id: user.userId,
    content,
    created_at: now,
  });

  // 通过 WebSocket 广播
  const io = (req.app as any).get('io');
  if (io) {
    io.to(`conv:${req.params.id}`).emit('im:message', {
      id: msg.id,
      conversationId: msg.conversation_id,
      senderId: msg.sender_id,
      senderName: user.username,
      content: msg.content,
      createdAt: msg.created_at,
    });
  }

  res.json({ message: msg });
});

// POST /api/conversations/:id/read — 标记已读
router.post('/:id/read', (req, res) => {
  const user = (req as any).user as AuthPayload;
  db.updateLastReadAt(req.params.id, user.userId);
  res.json({ success: true });
});

// POST /api/conversations/:id/members — 添加成员
router.post('/:id/members', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const { userIds } = req.body;

  if (!db.isConversationMember(req.params.id, user.userId)) {
    return res.status(403).json({ error: '无权操作' });
  }

  const ids: string[] = Array.isArray(userIds) ? userIds : [];
  for (const uid of ids) {
    db.addConversationMember(req.params.id, uid);
    // 通知新用户
    const io = (req.app as any).get('io');
    if (io) {
      io.to(`user:${uid}`).emit('conv:added', { conversationId: req.params.id });
    }
  }

  res.json({ success: true });
});

// DELETE /api/conversations/:id/members/:userId — 移除成员
router.delete('/:id/members/:userId', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const conv = db.getConversation(req.params.id);

  if (!conv) return res.status(404).json({ error: '会话不存在' });
  // 只有创建者或本人可以移除
  if (conv.created_by !== user.userId && req.params.userId !== user.userId) {
    return res.status(403).json({ error: '无权操作' });
  }

  db.removeConversationMember(req.params.id, req.params.userId);
  res.json({ success: true });
});

// POST /api/conversations/:id/summarize — Agent 总结
router.post('/:id/summarize', async (req, res) => {
  const user = (req as any).user as AuthPayload;
  if (!db.isConversationMember(req.params.id, user.userId)) {
    return res.status(403).json({ error: '无权访问' });
  }

  const messages = db.getImMessages(req.params.id, 200);
  if (messages.length === 0) {
    return res.status(400).json({ error: '没有消息可以总结' });
  }

  // 构造总结请求
  const messageText = messages
    .map((m) => {
      const sender = db.getUser(m.sender_id);
      return `${displayNameOf(sender)}: ${m.content}`;
    })
    .join('\n');

  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            '你是一个会议记录助手。请根据以下聊天记录，生成简洁的总结，包括：1) 主要讨论话题 2) 关键结论 3) 待办事项（如有）。用中文回复，保持简洁。',
        },
        { role: 'user', content: messageText },
      ],
    });

    const summary = completion.choices[0]?.message?.content || '总结生成失败';
    res.json({ summary });
  } catch (e: any) {
    res.status(500).json({ error: '总结生成失败: ' + (e?.message || e) });
  }
});

export default router;
