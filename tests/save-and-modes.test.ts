// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { harness } from './helpers';
import { createProject, ProjectSchema, defaultSettings } from '../src/domain/model';
import { Workspace } from '../src/domain/workspace';
import { buildPrompt } from '../src/domain/prompt';
import { draftPath } from '../src/storage/draft-folder';
import { WorkbenchUI } from '../src/ui/workbench';

function filesHarness(path = '') {
  const h = harness('내 원고'); h.ws.project.path = path;
  const files = new Map<string, string>();
  if (path) files.set(path, '기존 파일');
  h.documents.exists = path => files.has(path);
  h.documents.read = async path => { if (!files.has(path)) throw new Error('missing'); return files.get(path)!; };
  h.documents.create = vi.fn(async (path, text) => { if (files.has(path)) throw new Error('exists'); files.set(path, text); });
  return { ...h, files };
}
afterEach(() => document.body.replaceChildren());

describe('save destination and recovery', () => {
  it('preserves a draft without a document and requires a destination for its first save', async () => {
    const h = filesHarness(); await h.ws.edit({ draft: '저장 전 초안' });
    expect(h.projectStore.value?.path).toBe(''); expect(h.files.size).toBe(0);
    await expect(h.ws.saveDocument()).rejects.toThrow('폴더와 파일명');
    await h.ws.saveDocument('에세이/오늘의 기록.md');
    expect(h.files.get('에세이/오늘의 기록.md')).toBe('저장 전 초안');
    expect(h.projectStore.value?.path).toBe('에세이/오늘의 기록.md');
  });
  it('creates even an empty first draft, without needing a changed base', async () => {
    const h = filesHarness(); h.ws.project.draft = ''; h.ws.project.base = '';
    await h.ws.saveDocument('빈 글.md'); expect(h.files.get('빈 글.md')).toBe('');
  });
  it('preserves the old file when saving to another folder or name', async () => {
    const h = filesHarness('LinkedIn/원본.md'); await h.ws.saveDocument('에세이/새 이름.md');
    expect(h.files.get('LinkedIn/원본.md')).toBe('기존 파일');
    expect(h.files.get('에세이/새 이름.md')).toBe('내 원고');
  });
  it('never overwrites a different existing file', async () => {
    const h = filesHarness(); h.files.set('다른 글.md', '보존');
    await expect(h.ws.saveDocument('다른 글.md')).rejects.toThrow('같은 이름');
    expect(h.files.get('다른 글.md')).toBe('보존'); expect(h.ws.project.path).toBe('');
  });
  it('keeps the old connection on a failed file creation', async () => {
    const h = filesHarness('원본.md'); h.documents.create = async () => { throw new Error('disk full'); };
    await expect(h.ws.saveDocument('새 글.md')).rejects.toThrow('disk full');
    expect(h.ws.project.path).toBe('원본.md'); expect(h.ws.project.pendingWrite).toBeNull();
  });
  it('does not create a file when write-ahead persistence fails', async () => {
    const h = filesHarness(); h.projectStore.failure = true;
    await expect(h.ws.saveDocument('새 글.md')).rejects.toThrow(); expect(h.files.size).toBe(0);
  });
  it('recovers a crash after the new file was created', async () => {
    const h = filesHarness(); h.documents.create = async (path, text) => {
      expect(h.projectStore.value?.pendingWrite?.targetPath).toBe(path);
      h.files.set(path, text); h.projectStore.failure = true;
    };
    await expect(h.ws.saveDocument('에세이/기록.md')).rejects.toThrow();
    h.projectStore.failure = false;
    const restored = new Workspace(h.projectStore.value!, h.ws.preferences, h.projectStore, h.preferencesStore, h.documents, h.agent, () => defaultSettings);
    await restored.recoverWrite(); expect(restored.project.path).toBe('에세이/기록.md');
    expect(restored.project.pendingWrite).toBeNull(); expect(restored.project.base).toBe('내 원고');
  });
  it('clears an uncompleted new-file intent without losing the draft', async () => {
    const h = filesHarness(); h.ws.project.pendingWrite = { targetPath: '없음.md', before: '', after: '내 원고', createdAt: '' };
    await h.ws.recoverWrite(); expect(h.ws.project.path).toBe(''); expect(h.ws.project.draft).toBe('내 원고'); expect(h.ws.project.pendingWrite).toBeNull();
  });
  it('accepts selected folders and filenames while rejecting path injection', () => {
    expect(draftPath('글/에세이', '오늘.MD', '.obsidian', () => undefined)).toBe('글/에세이/오늘.md');
    for (const name of ['../기록', '하위/이름', '.숨김', '', 'a\\b']) expect(() => draftPath('', name, '.obsidian', () => undefined)).toThrow();
  });
});

describe('writing modes', () => {
  it('migrates old projects to LinkedIn without removing their text or history', () => {
    const { writingMode, ...old } = createProject('원고.md', '기존 원고');
    const restored = ProjectSchema.parse(old); expect(restored.writingMode).toBe('linkedin'); expect(restored.draft).toBe('기존 원고'); expect(restored.revisions).toEqual(old.revisions);
  });
  it('persists mode changes and applies them to the next prompt', async () => {
    const h = harness(); const draft = h.ws.project.draft;
    await h.ws.chooseMode('essay'); expect(h.projectStore.value?.writingMode).toBe('essay');
    const prompt = buildPrompt(h.ws.project, h.ws.preferences, 'interview', '시작', false);
    expect(prompt).toContain('한국어 에세이 편집자'); expect(prompt).toContain('감정의 진실성'); expect(prompt).not.toContain('한국어 LinkedIn');
    expect(h.ws.project.draft).toBe(draft);
    await h.ws.chooseMode('marketing'); expect(buildPrompt(h.ws.project, h.ws.preferences, 'review', '검토', false)).toContain('구매 장벽');
  });
  it('rolls back a mode change if it cannot be saved', async () => {
    const h = harness(); h.projectStore.failure = true;
    await expect(h.ws.chooseMode('essay')).rejects.toThrow(); expect(h.ws.project.writingMode).toBe('linkedin');
  });
  it('uses the selected mode for memo labels and preview, and opens save selection', async () => {
    const h = harness(); await h.ws.chooseMode('essay'); h.ws.project.path = '';
    const host = document.createElement('div'); document.body.append(host); const saveDocument = vi.fn();
    const ui = new WorkbenchUI(host, h.ws, { newProject() {}, openProject() {}, addMaterial() {}, settings() {}, saveDocument });
    expect(host.textContent).toContain('경험·장면'); expect(host.textContent).not.toContain('파일에서 다시 불러오기');
    [...host.querySelectorAll('button')].find(b => b.textContent === '원고 저장')!.click(); expect(saveDocument).toHaveBeenCalledOnce();
    [...host.querySelectorAll('button')].find(b => b.textContent === '미리보기')!.click();
    expect(host.querySelector('.ww-linkedin-body')).toBeNull(); expect(host.querySelector('.ww-prose-body')?.textContent).toBe(h.ws.project.draft);
    ui.destroy();
  });
});
