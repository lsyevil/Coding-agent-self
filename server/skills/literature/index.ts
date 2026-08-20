import { Skill, ToolDefinition, SkillContext } from '../base.js';
import * as db from '../../db.js';
import { v4 as uuidv4 } from 'uuid';

export class LiteratureSkill implements Skill {
  name = 'literature';
  displayName = '文献助手';
  description = '搜索、管理、分析学术文献';
  enabled = true;

  getTools(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'search_papers',
          description: '从 arXiv 搜索学术论文',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键词' },
              max_results: { type: 'number', description: '最大结果数（默认 10）' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'add_paper',
          description: '将一篇文献添加到团队文献库',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '文献标题' },
              authors: { type: 'array', items: { type: 'string' }, description: '作者列表' },
              year: { type: 'number', description: '发表年份' },
              url: { type: 'string', description: '文献链接' },
              abstract: { type: 'string', description: '摘要' },
              doi: { type: 'string', description: 'DOI 或 arXiv ID' },
              tags: { type: 'array', items: { type: 'string' }, description: '标签' },
            },
            required: ['title'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_papers',
          description: '查询团队文献库中的文献',
          parameters: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['unread', 'reading', 'finished'], description: '按阅读状态筛选' },
              search: { type: 'string', description: '按关键词搜索' },
            },
          },
        },
      },
    ];
  }

  async execute(toolName: string, input: Record<string, unknown>, context: SkillContext): Promise<string> {
    switch (toolName) {
      case 'search_papers': return this.searchPapers(input);
      case 'add_paper': return this.addPaper(input, context);
      case 'list_papers': return this.listPapers(input);
      default: throw new Error('Unknown tool: ' + toolName);
    }
  }

  private async searchPapers(input: Record<string, unknown>): Promise<string> {
    const query = input.query as string;
    const maxResults = (input.max_results as number) || 10;
    try {
      const url = 'http://export.arxiv.org/api/query?search_query=all:' + encodeURIComponent(query) + '&start=0&max_results=' + maxResults;
      const response = await fetch(url);
      const text = await response.text();
      const entries: any[] = [];
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      let match;
      while ((match = entryRegex.exec(text)) !== null && entries.length < maxResults) {
        const entry = match[1];
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\n/g, ' ').trim() || '';
        const authors: string[] = [];
        const authorRegex = /<name>([\s\S]*?)<\/name>/g;
        let am;
        while ((am = authorRegex.exec(entry)) !== null) authors.push(am[1].trim());
        const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\n/g, ' ').trim() || '';
        const link = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || '';
        const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim();
        const year = published ? new Date(published).getFullYear() : null;
        entries.push({ title, authors: authors.slice(0, 3).join(', ') + (authors.length > 3 ? ' et al.' : ''), year, link, abstract: summary.slice(0, 200) + '...' });
      }
      if (entries.length === 0) return '没有找到相关文献。';
      const lines = entries.map((e, i) => `${i + 1}. **${e.title}** (${e.year || '未知'})\n   作者：${e.authors}\n   链接：${e.link}`);
      return `从 arXiv 找到 ${entries.length} 篇相关文献：\n\n${lines.join('\n\n')}`;
    } catch (e: any) {
      return '搜索失败：' + e.message;
    }
  }

  private addPaper(input: Record<string, unknown>, context: SkillContext): string {
    const title = input.title as string;
    const authors = (input.authors as string[]) || [];
    const year = (input.year as number) || null;
    const url = (input.url as string) || null;
    const abstract = (input.abstract as string) || null;
    const doi = (input.doi as string) || null;
    const tags = (input.tags as string[]) || [];
    const now = new Date().toISOString();
    db.createPaper({
      id: uuidv4(), title, authors: JSON.stringify(authors), year, venue: null, abstract, doi, url,
      source: 'manual', tags: JSON.stringify(tags), status: 'unread', notes: null,
      added_by: context.userId, added_at: now, updated_at: now,
    });
    return `✅ 文献已添加：「${title}」\n作者：${authors.join(', ') || '未知'}${year ? `\n年份：${year}` : ''}`;
  }

  private listPapers(input: Record<string, unknown>): string {
    const status = input.status as string | undefined;
    const search = input.search as string | undefined;
    const filter: any = {};
    if (status) filter.status = status;
    if (search) filter.search = search;
    const papers = db.getPapers(filter);
    if (papers.length === 0) return '文献库为空，或没有找到匹配的文献。';
    const statusEmoji: any = { unread: '📖', reading: '📝', finished: '✅' };
    const lines = papers.map((p: any) => {
      const authors = p.authors ? JSON.parse(p.authors).slice(0, 2).join(', ') : '未知';
      return `${statusEmoji[p.status] || '📖'} **${p.title}** (${p.year || '未知'})\n   作者：${authors} | 状态：${p.status}`;
    });
    return `文献库共 ${papers.length} 篇：\n\n${lines.join('\n\n')}`;
  }
}

export const literatureSkill = new LiteratureSkill();
