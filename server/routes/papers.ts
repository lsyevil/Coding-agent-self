import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthPayload } from '../auth.js';
import * as db from '../db.js';
import { displayNameOf } from '../presenters.js';

const router = Router();

// GET /api/papers
router.get('/', (req, res) => {
  const { status, tag, search } = req.query;
  const filter: any = {};
  if (status) filter.status = status;
  if (tag) filter.tag = tag;
  if (search) filter.search = search;
  const papers = db.getPapers(filter);
  const result = papers.map((p) => ({
    ...p,
    authors: p.authors ? JSON.parse(p.authors) : [],
    tags: p.tags ? JSON.parse(p.tags) : [],
  }));
  res.json({ papers: result });
});

// POST /api/papers
router.post('/', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const { title, authors, year, venue, abstract, doi, url, source, tags } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: '标题不能为空' });
  const now = new Date().toISOString();
  const paper = db.createPaper({
    id: uuidv4(),
    title: title.trim(),
    authors: authors ? JSON.stringify(authors) : null,
    year: year || null,
    venue: venue || null,
    abstract: abstract || null,
    doi: doi || null,
    url: url || null,
    source: source || 'manual',
    tags: tags ? JSON.stringify(tags) : null,
    status: 'unread',
    notes: null,
    added_by: user.userId,
    added_at: now,
    updated_at: now,
  });
  res.json({ paper: { ...paper, authors: authors || [], tags: tags || [] } });
});

// POST /api/papers/search (before /:id!)
router.post('/search', async (req, res) => {
  const { query, maxResults = 10 } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: '搜索词不能为空' });
  try {
    const arxivUrl = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${maxResults}`;
    const response = await fetch(arxivUrl);
    const text = await response.text();
    const entries = parseArxivXml(text);
    res.json({ results: entries });
  } catch (e: any) {
    res.status(500).json({ error: '搜索失败: ' + e.message });
  }
});

// GET /api/papers/:id
router.get('/:id', (req, res) => {
  const paper = db.getPaper(req.params.id);
  if (!paper) return res.status(404).json({ error: '文献不存在' });
  res.json({ paper: { ...paper, authors: paper.authors ? JSON.parse(paper.authors) : [], tags: paper.tags ? JSON.parse(paper.tags) : [] } });
});

// PATCH /api/papers/:id
router.patch('/:id', (req, res) => {
  const paper = db.getPaper(req.params.id);
  if (!paper) return res.status(404).json({ error: '文献不存在' });
  const { title, authors, year, venue, abstract, doi, url, tags, status, notes } = req.body;
  const updates: any = {};
  if (title !== undefined) updates.title = title;
  if (authors !== undefined) updates.authors = JSON.stringify(authors);
  if (year !== undefined) updates.year = year;
  if (venue !== undefined) updates.venue = venue;
  if (abstract !== undefined) updates.abstract = abstract;
  if (doi !== undefined) updates.doi = doi;
  if (url !== undefined) updates.url = url;
  if (tags !== undefined) updates.tags = JSON.stringify(tags);
  if (status !== undefined) updates.status = status;
  if (notes !== undefined) updates.notes = notes;
  db.updatePaper(paper.id, updates);
  res.json({ success: true });
});

// DELETE /api/papers/:id
router.delete('/:id', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const paper = db.getPaper(req.params.id);
  if (!paper) return res.status(404).json({ error: '文献不存在' });
  if (paper.added_by !== user.userId) return res.status(403).json({ error: '只有添加者可删除' });
  db.deletePaper(paper.id);
  res.json({ success: true });
});

// GET /api/papers/:id/notes
router.get('/:id/notes', (req, res) => {
  const paper = db.getPaper(req.params.id);
  if (!paper) return res.status(404).json({ error: '文献不存在' });
  const notes = db.getPaperNotes(paper.id);
  const enriched = notes.map((n) => { const u = db.getUser(n.user_id); return { ...n, userName: displayNameOf(u) }; });
  res.json({ notes: enriched });
});

// POST /api/papers/:id/notes
router.post('/:id/notes', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const paper = db.getPaper(req.params.id);
  if (!paper) return res.status(404).json({ error: '文献不存在' });
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: '笔记内容不能为空' });
  const now = new Date().toISOString();
  const note = db.createPaperNote({ id: uuidv4(), paper_id: paper.id, user_id: user.userId, content: content.trim(), created_at: now, updated_at: now });
  res.json({ note: { ...note, userName: user.username } });
});

// PATCH /api/papers/:id/notes/:noteId
router.patch('/:id/notes/:noteId', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '内容不能为空' });
  const success = db.updatePaperNote(req.params.noteId, content, user.userId);
  if (!success) return res.status(404).json({ error: '笔记不存在或无权修改' });
  res.json({ success: true });
});

// DELETE /api/papers/:id/notes/:noteId
router.delete('/:id/notes/:noteId', (req, res) => {
  const user = (req as any).user as AuthPayload;
  const success = db.deletePaperNote(req.params.noteId, user.userId);
  if (!success) return res.status(404).json({ error: '笔记不存在或无权删除' });
  res.json({ success: true });
});

// POST /api/papers/:id/summarize
router.post('/:id/summarize', async (req, res) => {
  const paper = db.getPaper(req.params.id);
  if (!paper) return res.status(404).json({ error: '文献不存在' });
  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '你是一个学术文献分析助手。请根据提供的文献信息，生成简洁的中文综述，包括：1) 研究背景与动机 2) 核心方法/贡献 3) 主要结论 4) 局限性。保持客观、简洁。' },
        { role: 'user', content: '标题：' + paper.title + '\n作者：' + (paper.authors || '未知') + '\n年份：' + (paper.year || '未知') + '\n摘要：' + (paper.abstract || '无摘要') },
      ],
    });
    const summary = completion.choices[0]?.message?.content || '综述生成失败';
    res.json({ summary });
  } catch (e: any) {
    res.status(500).json({ error: '综述生成失败: ' + e.message });
  }
});

function parseArxivXml(xml: string): Array<{ title: string; authors: string[]; abstract: string; url: string; doi: string | null; year: number | null; venue: string | null; source: string }> {
  const entries: any[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim() || '';
    const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, ' ').trim() || '';
    const url = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || '';
    const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim() || '';
    const year = published ? new Date(published).getFullYear() : null;
    const authors: string[] = [];
    const authorRegex = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(entry)) !== null) { authors.push(authorMatch[1].trim()); }
    const arxivId = url.split('/abs/').pop() || '';
    entries.push({ title, authors, abstract: summary, url, doi: arxivId ? 'arXiv:' + arxivId : null, year, venue: 'arXiv', source: 'arxiv' });
  }
  return entries;
}

export default router;
