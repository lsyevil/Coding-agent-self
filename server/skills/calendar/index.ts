import { Skill, ToolDefinition, SkillContext } from '../base.js';
import * as db from '../../db.js';
import { v4 as uuidv4 } from 'uuid';

export class CalendarSkill implements Skill {
  name = 'calendar';
  displayName = '日程管理';
  description = '创建、查询、管理团队日程';
  enabled = true;

  getTools(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'create_event',
          description: '创建一个新的日程，可邀请团队成员参加',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '日程标题' },
              description: { type: 'string', description: '日程描述（可选）' },
              location: { type: 'string', description: '地点（可选）' },
              start_time: { type: 'string', description: '开始时间，ISO 格式（如 2024-01-15T14:00:00）' },
              end_time: { type: 'string', description: '结束时间，ISO 格式' },
              is_all_day: { type: 'boolean', description: '是否全天事件' },
              participant_ids: { type: 'array', items: { type: 'string' }, description: '参与人 ID 列表（可选）' },
            },
            required: ['title', 'start_time', 'end_time'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_events',
          description: '查询日程列表，可按时间范围筛选',
          parameters: {
            type: 'object',
            properties: {
              start_time: { type: 'string', description: '开始时间范围（ISO 格式）' },
              end_time: { type: 'string', description: '结束时间范围（ISO 格式）' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'check_availability',
          description: '检查指定用户在某个时间段是否有空',
          parameters: {
            type: 'object',
            properties: {
              user_id: { type: 'string', description: '用户 ID' },
              start_time: { type: 'string', description: '开始时间（ISO 格式）' },
              end_time: { type: 'string', description: '结束时间（ISO 格式）' },
            },
            required: ['user_id', 'start_time', 'end_time'],
          },
        },
      },
    ];
  }

  async execute(toolName: string, input: Record<string, unknown>, context: SkillContext): Promise<string> {
    switch (toolName) {
      case 'create_event': return this.createEvent(input, context);
      case 'list_events': return this.listEvents(input);
      case 'check_availability': return this.checkAvailability(input);
      default: throw new Error('Unknown tool: ' + toolName);
    }
  }

  private createEvent(input: Record<string, unknown>, context: SkillContext): string {
    const title = input.title as string;
    const description = (input.description as string) || null;
    const location = (input.location as string) || null;
    const start_time = input.start_time as string;
    const end_time = input.end_time as string;
    const is_all_day = (input.is_all_day as boolean) || false;
    const participant_ids = (input.participant_ids as string[]) || [];

    const conflicts = db.findConflictingEvents(start_time, end_time);
    let conflictMsg = '';
    if (conflicts.length > 0) {
      conflictMsg = `\n⚠️ 注意：该时段与 ${conflicts.length} 个日程有冲突`;
    }

    const now = new Date().toISOString();
    const event = db.createEvent({
      id: uuidv4(),
      title,
      description,
      location,
      start_time,
      end_time,
      is_all_day: is_all_day ? 1 : 0,
      created_by: context.userId,
      reminder_minutes: 15,
      created_at: now,
      updated_at: now,
    });

    const allParticipants = Array.from(new Set([context.userId, ...participant_ids]));
    for (const uid of allParticipants) {
      const status = uid === context.userId ? 'accepted' : 'pending';
      db.addEventParticipant(event.id, uid, status);
    }

    const participants = db.getEventParticipants(event.id);
    const participantNames = participants.map((u: any) => u.display_name).join(', ');

    const startDate = new Date(start_time);
    const endDate = new Date(end_time);
    const timeStr = is_all_day 
      ? '全天'
      : `${startDate.toLocaleString('zh-CN')} - ${endDate.toLocaleTimeString('zh-CN')}`;

    return `✅ 日程已创建：「${title}」\n时间：${timeStr}${location ? `\n地点：${location}` : ''}\n参与人：${participantNames}${conflictMsg}`;
  }

  private listEvents(input: Record<string, unknown>): string {
    const start_time = input.start_time as string | undefined;
    const end_time = input.end_time as string | undefined;

    const filter: any = {};
    if (start_time) filter.startTime = start_time;
    if (end_time) filter.endTime = end_time;

    const events = db.getEvents(filter);
    if (events.length === 0) return '没有找到日程。';

    const lines = events.map((e: any) => {
      const start = new Date(e.start_time);
      const timeStr = e.is_all_day ? '全天' : start.toLocaleString('zh-CN');
      const participants = db.getEventParticipants(e.id).map((u: any) => u.display_name).join(', ');
      return `- ${e.title} (${timeStr}${e.location ? ', ' + e.location : ''}) 参与人: ${participants || '无'}`;
    });

    return `找到 ${events.length} 个日程：\n${lines.join('\n')}`;
  }

  private checkAvailability(input: Record<string, unknown>): string {
    const user_id = input.user_id as string;
    const start_time = input.start_time as string;
    const end_time = input.end_time as string;

    const availability = db.getUserAvailability(user_id, start_time, end_time);

    if (!availability.busy) {
      return '该时间段空闲。';
    }

    const conflicts = availability.events.map((e: any) => {
      return `- ${e.title} (${new Date(e.start_time).toLocaleString('zh-CN')} - ${new Date(e.end_time).toLocaleTimeString('zh-CN')})`;
    });

    return `该时间段有 ${availability.events.length} 个日程冲突：\n${conflicts.join('\n')}`;
  }
}

export const calendarSkill = new CalendarSkill();
