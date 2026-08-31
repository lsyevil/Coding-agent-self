import { Skill, ToolDefinition, SkillContext } from '../base.js';
import * as db from '../../db.js';
import { v4 as uuidv4 } from 'uuid';

// tasks 表对 priority / status 都带 CHECK 约束。工具入参来自模型，
// 即使 schema 里声明了 enum 也可能收到别的值 —— 不校验就会在写库时抛
// SQLITE_CONSTRAINT_CHECK。这里统一收敛：非法值回退到默认值。
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const STATUSES = ['todo', 'in_progress', 'done', 'blocked'] as const;
type Priority = (typeof PRIORITIES)[number];
type Status = (typeof STATUSES)[number];

function toPriority(v: unknown, fallback: Priority = 'medium'): Priority {
  return PRIORITIES.includes(v as Priority) ? (v as Priority) : fallback;
}

function toStatus(v: unknown, fallback: Status = 'todo'): Status {
  return STATUSES.includes(v as Status) ? (v as Status) : fallback;
}

export class TodoSkill implements Skill {
  name = 'todo';
  displayName = '\u5f85\u529e\u7ba1\u7406';
  description = '\u521b\u5efa\u3001\u67e5\u8be2\u3001\u66f4\u65b0\u56e2\u961f\u5f85\u529e\u4efb\u52a1';
  enabled = true;

  getTools(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'create_task',
          description: '\u521b\u5efa\u4e00\u4e2a\u65b0\u7684\u5f85\u529e\u4efb\u52a1\uff0c\u53ef\u5206\u914d\u7ed9\u56e2\u961f\u6210\u5458\u3002\u5206\u914d\u524d\u8bf7\u5148\u8c03\u7528 list_users \u83b7\u53d6\u7528\u6237 ID\u3002',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '\u4efb\u52a1\u6807\u9898' },
              description: { type: 'string', description: '\u4efb\u52a1\u63cf\u8ff0\uff08\u53ef\u9009\uff09' },
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: '\u4f18\u5148\u7ea7' },
              due_date: { type: 'string', description: '\u622a\u6b62\u65e5\u671f\uff0c\u683c\u5f0f YYYY-MM-DD\uff08\u53ef\u9009\uff09' },
              assignee_ids: { type: 'array', items: { type: 'string' }, description: '\u8d1f\u8d23\u4eba ID \u5217\u8868\uff08\u53ef\u9009\uff09' },
            },
            required: ['title'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_tasks',
          description: '\u67e5\u8be2\u5f85\u529e\u4efb\u52a1\u5217\u8868\uff0c\u53ef\u6309\u72b6\u6001\u6216\u8d1f\u8d23\u4eba\u7b5b\u9009',
          parameters: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'blocked'], description: '\u6309\u72b6\u6001\u7b5b\u9009' },
              assignee_id: { type: 'string', description: '\u6309\u8d1f\u8d23\u4eba ID \u7b5b\u9009' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'update_task',
          description: '\u66f4\u65b0\u4efb\u52a1\u72b6\u6001\u3001\u4f18\u5148\u7ea7\u7b49\u4fe1\u606f',
          parameters: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: '\u4efb\u52a1 ID' },
              title: { type: 'string', description: '\u65b0\u6807\u9898' },
              description: { type: 'string', description: '\u65b0\u63cf\u8ff0' },
              status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'blocked'], description: '\u65b0\u72b6\u6001' },
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: '\u65b0\u4f18\u5148\u7ea7' },
              due_date: { type: 'string', description: '\u65b0\u622a\u6b62\u65e5\u671f' },
            },
            required: ['task_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_users',
          description: '查询所有可分配任务的团队成员，返回用户 ID 和显示名。分配任务前请先调用此工具获取正确的用户 ID。',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
    ];
  }

  async execute(toolName: string, input: Record<string, unknown>, context: SkillContext): Promise<string> {
    switch (toolName) {
      case 'create_task': return this.createTask(input, context);
      case 'list_tasks': return this.listTasks(input);
      case 'list_users': return this.listUsers();
      case 'update_task': return this.updateTask(input, context);
      default: throw new Error('Unknown tool: ' + toolName);
    }
  }

  private createTask(input: Record<string, unknown>, context: SkillContext): string {
    const title = input.title as string;
    const description = (input.description as string) || null;
    const priority = toPriority(input.priority);
    const due_date = (input.due_date as string) || null;
    const assignee_ids = (input.assignee_ids as string[]) || [];

    const now = new Date().toISOString();
    const task = db.createTask({
      id: uuidv4(),
      title,
      description,
      status: 'todo',
      priority,
      due_date,
      created_by: context.userId,
      conversation_id: null,
      created_at: now,
      updated_at: now,
    });

    const allAssignees = Array.from(new Set([context.userId, ...assignee_ids]));
    for (const uid of allAssignees) {
      const role = uid === context.userId ? 'owner' : 'collaborator';
      db.addTaskAssignee(task.id, uid, role as 'owner' | 'collaborator');
    }

    const assignees = db.getTaskAssignees(task.id);
    const assigneeNames = assignees.map((u: any) => u.display_name).join(', ');
    return '\u2705 \u4efb\u52a1\u5df2\u521b\u5efa\uff1a\u300c' + title + '\u300d\n\u8d1f\u8d23\u4eba\uff1a' + assigneeNames + '\n\u4f18\u5148\u7ea7\uff1a' + priority;
  }

  private listTasks(input: Record<string, unknown>): string {
    const status = input.status as string | undefined;
    const assignee_id = input.assignee_id as string | undefined;

    const filter: any = {};
    if (status) filter.status = status;
    if (assignee_id) filter.assigneeId = assignee_id;

    const tasks = db.getTasks(filter);
    if (tasks.length === 0) return '\u6ca1\u6709\u627e\u5230\u7b26\u5408\u6761\u4ef6\u7684\u4efb\u52a1\u3002';

    const lines = tasks.map((t: any) => {
      const assignees = db.getTaskAssignees(t.id).map((u: any) => u.display_name).join(', ');
      return '- [' + t.status + '] ' + t.title + ' (priority: ' + t.priority + ', assignees: ' + (assignees || 'none') + ')';
    });
    return '\u627e\u5230 ' + tasks.length + ' \u4e2a\u4efb\u52a1\uff1a\n' + lines.join('\n');
  }


  private listUsers(): string {
    const users = db.getAllUsers();
    if (users.length === 0) return '没有可分配的团队成员。';

    const lines = users.map((u: any) => 
      `- ${u.display_name}（ID: ${u.id}，用户名: ${u.username}）`
    );
    return '团队成员列表：\n' + lines.join('\n');
  }

  private updateTask(input: Record<string, unknown>, context: SkillContext): string {
    const task_id = input.task_id as string;
    const task = db.getTask(task_id);
    if (!task) return '\u4efb\u52a1\u4e0d\u5b58\u5728\u3002';

    const updates: any = {};
    if (input.title) updates.title = input.title;
    if (input.description) updates.description = input.description;
    if (input.status) updates.status = toStatus(input.status, task.status as Status);
    if (input.priority) updates.priority = toPriority(input.priority, task.priority);
    if (input.due_date) updates.due_date = input.due_date;

    db.updateTask(task_id, updates);
    return '\u2705 \u4efb\u52a1\u5df2\u66f4\u65b0\uff1a\u300c' + task.title + '\u300d';
  }
}

export const todoSkill = new TodoSkill();
