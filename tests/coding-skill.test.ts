/**
 * coding skill 的路径边界与 search_files 回归。
 *
 * search_files 的四个 bug（A6）都在这里设了守卫：
 *  1. 相对路径基准错（原来用 dir 而非搜索起点，子目录里的命中丢掉路径）
 *  2. 大文件 return 中止整个目录遍历（应只跳过该文件）
 *  3. 不可读文件 return 中止整个目录遍历（同上）
 *  4. 带 g 的 RegExp 跨行复用，lastIndex 导致漏匹配
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { codingSkill } from '../server/skills/coding/index.js';

let tmpDir: string;

const ctx = () => ({ workingDir: tmpDir, userId: 'test-user' });

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procoder-coding-'));

  // 子目录里的命中 —— 验证相对路径基准
  fs.mkdirSync(path.join(tmpDir, 'nested', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'nested', 'deep', 'target.txt'), 'NEEDLE here\n');

  // 同一文件里多行命中 —— 验证 g 标志已去掉
  fs.writeFileSync(
    path.join(tmpDir, 'multi.txt'),
    ['NEEDLE line 1', 'NEEDLE line 2', 'NEEDLE line 3'].join('\n')
  );

  // 一个超过 1MB 的文件，排在字母序前面，后面的文件必须仍被搜到
  fs.writeFileSync(path.join(tmpDir, 'aaa-big.txt'), 'x'.repeat(1024 * 1024 + 10));
  fs.writeFileSync(path.join(tmpDir, 'zzz-after-big.txt'), 'NEEDLE after big file\n');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveWithin 路径边界', () => {
  it('拒绝用 .. 逃出工作目录', async () => {
    await expect(
      codingSkill.execute('read_file', { path: '../../../etc/passwd' }, ctx())
    ).rejects.toThrow(/工作目录/);
  });

  it('拒绝绝对路径逃出工作目录', async () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/passwd';
    await expect(codingSkill.execute('read_file', { path: outside }, ctx())).rejects.toThrow(
      /工作目录/
    );
  });

  it('允许工作目录内的相对路径', async () => {
    const out = await codingSkill.execute('read_file', { path: 'multi.txt' }, ctx());
    expect(out).toContain('NEEDLE line 1');
  });
});

describe('search_files 回归', () => {
  it('子目录命中要带上相对搜索起点的完整路径', async () => {
    const out = await codingSkill.execute('search_files', { pattern: 'NEEDLE', path: '.' }, ctx());
    const normalized = out.replace(/\\/g, '/');
    expect(normalized).toContain('nested/deep/target.txt');
  });

  it('同一文件的多行命中都要报出来（g 标志的 lastIndex 会漏）', async () => {
    const out = await codingSkill.execute('search_files', { pattern: 'NEEDLE', path: '.' }, ctx());
    for (const line of ['1', '2', '3']) {
      expect(out).toContain(`NEEDLE line ${line}`);
    }
  });

  it('遇到超限大文件后，同目录后续文件仍要被搜到', async () => {
    const out = await codingSkill.execute('search_files', { pattern: 'NEEDLE', path: '.' }, ctx());
    expect(out).toContain('zzz-after-big.txt');
  });

  it('无命中时给出明确提示而不是空串', async () => {
    const out = await codingSkill.execute(
      'search_files',
      { pattern: 'PATTERN_THAT_DOES_NOT_EXIST_ANYWHERE', path: '.' },
      ctx()
    );
    expect(out).toContain('未找到匹配');
  });
});
