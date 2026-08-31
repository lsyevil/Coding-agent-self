import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthPayload } from '../auth.js';
import * as db from '../db.js';
import { toPublicUser } from '../presenters.js';

const router = Router();

// GET /api/events — 日程列表（支持时间范围筛选）
router.get('/', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const { start, end, userId } = req.query;

  const filter: any = {};
  if (start) filter.startTime = start;
  if (end) filter.endTime = end;
  if (userId === 'me') filter.userId = user.userId;
  else if (userId) filter.userId = userId;

  const events = db.getEvents(filter);

  const result = events.map((event) => {
    const participants = db.getEventParticipants(event.id);
    return {
      ...event,
      participants: participants.map((p) => ({ ...toPublicUser(p), status: p.status })),
    };
  });

  res.json({ events: result });
});

// POST /api/events — 创建日程
router.post('/', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const { title, description, location, start_time, end_time, is_all_day, reminder_minutes, participantIds } = req.body;

  if (!title?.trim()) {
    return res.status(400).json({ error: '日程标题不能为空' });
  }
  if (!start_time || !end_time) {
    return res.status(400).json({ error: '开始时间和结束时间不能为空' });
  }
  if (new Date(start_time) >= new Date(end_time)) {
    return res.status(400).json({ error: '结束时间必须晚于开始时间' });
  }

  const conflicts = db.findConflictingEvents(start_time, end_time);
  const conflictWarning = conflicts.length > 0 
    ? `注意：该时段与 ${conflicts.length} 个日程有冲突`
    : null;

  const now = new Date().toISOString();
  const event = db.createEvent({
    id: uuidv4(),
    title: title.trim(),
    description: description || null,
    location: location || null,
    start_time,
    end_time,
    is_all_day: is_all_day ? 1 : 0,
    created_by: user.userId,
    reminder_minutes: reminder_minutes ?? 15,
    created_at: now,
    updated_at: now,
  });

  const allParticipants = Array.from(new Set([user.userId, ...(participantIds || [])]));
  for (const uid of allParticipants) {
    const status = uid === user.userId ? 'accepted' : 'pending';
    db.addEventParticipant(event.id, uid, status);
  }

  const participants = db.getEventParticipants(event.id).map((p) => ({ ...toPublicUser(p), status: p.status }));

  res.json({ 
    event: { ...event, participants },
    conflictWarning,
  });
});

// GET /api/events/availability/check — 检查用户空闲状态
router.get('/availability/check', (req, res) => {
  const { userId, start, end } = req.query;

  if (!userId || !start || !end) {
    return res.status(400).json({ error: '缺少 userId、start、end 参数' });
  }

  const availability = db.getUserAvailability(
    userId as string,
    start as string,
    end as string
  );

  res.json({
    busy: availability.busy,
    events: availability.events.map((e) => ({
      id: e.id,
      title: e.title,
      start_time: e.start_time,
      end_time: e.end_time,
    })),
  });
});

// GET /api/events/:id — 日程详情
router.get('/:id', (req, res) => {
  const event = db.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '日程不存在' });

  const participants = db.getEventParticipants(event.id).map((p) => ({ ...toPublicUser(p), status: p.status }));

  res.json({ event: { ...event, participants } });
});

// PATCH /api/events/:id — 更新日程
router.patch('/:id', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const event = db.getEvent(req.params.id);

  if (!event) return res.status(404).json({ error: '日程不存在' });

  const participants = db.getEventParticipants(event.id);
  const isParticipant = participants.some((p) => p.id === user.userId);
  if (event.created_by !== user.userId && !isParticipant) {
    return res.status(403).json({ error: '无权修改此日程' });
  }

  const { title, description, location, start_time, end_time, is_all_day, reminder_minutes } = req.body;
  const updates: any = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (location !== undefined) updates.location = location;
  if (start_time !== undefined) updates.start_time = start_time;
  if (end_time !== undefined) updates.end_time = end_time;
  if (is_all_day !== undefined) updates.is_all_day = is_all_day ? 1 : 0;
  if (reminder_minutes !== undefined) updates.reminder_minutes = reminder_minutes;

  const newStart = start_time || event.start_time;
  const newEnd = end_time || event.end_time;
  const conflicts = db.findConflictingEvents(newStart, newEnd, event.id);
  const conflictWarning = conflicts.length > 0
    ? `注意：该时段与 ${conflicts.length} 个日程有冲突`
    : null;

  db.updateEvent(event.id, updates);
  res.json({ success: true, conflictWarning });
});

// DELETE /api/events/:id — 删除日程
router.delete('/:id', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const event = db.getEvent(req.params.id);

  if (!event) return res.status(404).json({ error: '日程不存在' });
  if (event.created_by !== user.userId) {
    return res.status(403).json({ error: '只有创建者可删除日程' });
  }

  db.deleteEvent(event.id);
  res.json({ success: true });
});

// POST /api/events/:id/participants — 添加参与人
router.post('/:id/participants', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const event = db.getEvent(req.params.id);

  if (!event) return res.status(404).json({ error: '日程不存在' });
  if (event.created_by !== user.userId) {
    return res.status(403).json({ error: '只有创建者可添加参与人' });
  }

  const { userIds } = req.body;
  if (!Array.isArray(userIds)) {
    return res.status(400).json({ error: 'userIds 必须是数组' });
  }

  for (const uid of userIds) {
    db.addEventParticipant(event.id, uid, 'pending');
  }

  res.json({ success: true });
});

// DELETE /api/events/:id/participants/:userId — 移除参与人
router.delete('/:id/participants/:userId', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const event = db.getEvent(req.params.id);

  if (!event) return res.status(404).json({ error: '日程不存在' });

  const isCreator = event.created_by === user.userId;
  const isSelf = req.params.userId === user.userId;
  if (!isCreator && !isSelf) {
    return res.status(403).json({ error: '无权移除参与人' });
  }

  db.removeEventParticipant(event.id, req.params.userId);
  res.json({ success: true });
});

// PATCH /api/events/:id/rsvp — 更新自己的 RSVP 状态
router.patch('/:id/rsvp', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const event = db.getEvent(req.params.id);

  if (!event) return res.status(404).json({ error: '日程不存在' });

  const { status } = req.body;
  if (!['accepted', 'declined'].includes(status)) {
    return res.status(400).json({ error: 'status 必须是 accepted 或 declined' });
  }

  const success = db.updateParticipantStatus(event.id, user.userId, status);
  if (!success) {
    return res.status(404).json({ error: '你不是此日程的参与人' });
  }

  res.json({ success: true });
});

export default router;
