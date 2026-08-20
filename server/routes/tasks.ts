import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthPayload } from '../auth.js';
import * as db from '../db.js';

const router = Router();

// GET /api/tasks — 任务列表（支持筛选）
router.get('/', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const { status, assignee } = req.query;

  const filter: any = {};
  if (status) filter.status = status as string;
  if (assignee === 'me') filter.assigneeId = user.userId;
  else if (assignee) filter.assigneeId = assignee as string;

  const tasks = db.getTasks(filter);

  const result = tasks.map((task) => {
    const assignees = db.getTaskAssignees(task.id);
    return {
      ...task,
      assignees: assignees.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatar: u.avatar,
      })),
    };
  });

  res.json({ tasks: result });
});

// POST /api/tasks — 创建任务
router.post('/', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const { title, description, priority, due_date, assigneeIds } = req.body;

  if (!title?.trim()) {
    return res.status(400).json({ error: '任务标题不能为空' });
  }

  const now = new Date().toISOString();
  const task = db.createTask({
    id: uuidv4(),
    title: title.trim(),
    description: description || null,
    status: 'todo',
    priority: priority || 'medium',
    due_date: due_date || null,
    created_by: user.userId,
    conversation_id: null,
    created_at: now,
    updated_at: now,
  });

  const allAssignees = Array.from(new Set([user.userId, ...(assigneeIds || [])]));
  for (const uid of allAssignees) {
    const role = uid === user.userId ? 'owner' : 'collaborator';
    db.addTaskAssignee(task.id, uid, role as 'owner' | 'collaborator');
  }

  const assignees = db.getTaskAssignees(task.id).map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar,
  }));

  res.json({ task: { ...task, assignees } });
});

// GET /api/tasks/:id — 任务详情
router.get('/:id', (req, res) => {
  const task = db.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  const assignees = db.getTaskAssignees(task.id).map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar,
  }));

  res.json({ task: { ...task, assignees } });
});

// PATCH /api/tasks/:id — 更新任务
router.patch('/:id', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const task = db.getTask(req.params.id);

  if (!task) return res.status(404).json({ error: '任务不存在' });

  const assignees = db.getTaskAssignees(task.id);
  const isAssignee = assignees.some((a) => a.id === user.userId);
  if (task.created_by !== user.userId && !isAssignee) {
    return res.status(403).json({ error: '无权修改此任务' });
  }

  const { title, description, status, priority, due_date } = req.body;
  const updates: any = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (status !== undefined) updates.status = status;
  if (priority !== undefined) updates.priority = priority;
  if (due_date !== undefined) updates.due_date = due_date;

  db.updateTask(task.id, updates);
  res.json({ success: true });
});

// DELETE /api/tasks/:id — 删除任务
router.delete('/:id', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const task = db.getTask(req.params.id);

  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.created_by !== user.userId) {
    return res.status(403).json({ error: '只有创建者可删除任务' });
  }

  db.deleteTask(task.id);
  res.json({ success: true });
});

// POST /api/tasks/:id/assign — 添加负责人
router.post('/:id/assign', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const task = db.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  // 权限检查：只有创建者或现有负责人可以添加新负责人
  const assignees = db.getTaskAssignees(task.id);
  const isCreator = task.created_by === user.userId;
  const isAssignee = assignees.some((a) => a.id === user.userId);
  if (!isCreator && !isAssignee) {
    return res.status(403).json({ error: '无权修改此任务的负责人' });
  }

  const { userIds } = req.body;
  if (!Array.isArray(userIds)) {
    return res.status(400).json({ error: 'userIds 必须是数组' });
  }

  for (const uid of userIds) {
    db.addTaskAssignee(task.id, uid, 'collaborator');
  }
  res.json({ success: true });
});

// DELETE /api/tasks/:id/assign/:userId — 移除负责人
router.delete('/:id/assign/:userId', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const task = db.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  const isCreator = task.created_by === user.userId;
  const isSelf = req.params.userId === user.userId;
  if (!isCreator && !isSelf) {
    return res.status(403).json({ error: '无权移除负责人' });
  }

  db.removeTaskAssignee(task.id, req.params.userId);
  res.json({ success: true });
});

// GET /api/tasks/:id/comments — 获取评论
router.get('/:id/comments', (req, res) => {
  const task = db.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  const comments = db.getTaskComments(task.id);
  const enriched = comments.map((c) => {
    const u = db.getUser(c.user_id);
    return { ...c, userName: u?.display_name || u?.username || '未知' };
  });
  res.json({ comments: enriched });
});

// POST /api/tasks/:id/comments — 添加评论
router.post('/:id/comments', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const task = db.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: '评论内容不能为空' });

  const comment = db.addTaskComment({
    id: uuidv4(),
    task_id: task.id,
    user_id: user.userId,
    content: content.trim(),
    created_at: new Date().toISOString(),
  });
  res.json({ comment });
});

// DELETE /api/tasks/:id/comments/:commentId — 删除评论
router.delete('/:id/comments/:commentId', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const success = db.deleteTaskComment(req.params.commentId, user.userId);
  if (!success) return res.status(404).json({ error: '评论不存在或无权删除' });
  res.json({ success: true });
});

export default router;
