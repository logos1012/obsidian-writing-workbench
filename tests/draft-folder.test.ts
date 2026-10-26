import { describe, expect, it, vi } from 'vitest';
import { checkDraftFolder, createDraft, initialDraftFolder, normalizeDraftFolder, type DraftVault } from '../src/storage/draft-folder';
import { SettingsSchema } from '../src/domain/model';

function vault() {
  const entries = new Map<string, 'file' | 'folder'>();
  const port: DraftVault<string> = {
    kind: path => entries.get(path),
    createFolder: vi.fn(async path => { entries.set(path, 'folder'); }),
    createNote: vi.fn(async path => { if (entries.has(path)) throw new Error('already exists'); entries.set(path, 'file'); return path; }),
  };
  return { entries, port };
}
const date = new Date('2026-10-27T10:00:00Z');

describe('configurable draft folder', () => {
  it('keeps legacy folders on upgrade while honoring explicit custom and root settings on reload', () => {
    expect(initialDraftFolder(undefined, true)).toBe('Writing Workbench');
    expect(initialDraftFolder(undefined, false)).toBe('글쓰기');
    expect(initialDraftFolder('콘텐츠/원고', true)).toBe('콘텐츠/원고');
    expect(initialDraftFolder('', true)).toBe('');
  });
  it('keeps old CLI settings while supplying the new field, and persists an explicitly empty root setting', () => {
    expect(SettingsSchema.parse({ claudePath: '/custom/claude', timeoutSeconds: 600 })).toMatchObject({ claudePath: '/custom/claude', timeoutSeconds: 600, draftFolder: '글쓰기' });
    expect(SettingsSchema.parse({ draftFolder: '' }).draftFolder).toBe('');
  });
  it('accepts Korean and nested paths and normalizes separator repetition and outer spaces', () => {
    expect(normalizeDraftFolder('  나의 글//LinkedIn/  ', '.obsidian')).toBe('나의 글/LinkedIn');
    expect(normalizeDraftFolder('   ', '.obsidian')).toBe('');
  });
  it.each(['/Users/jake/글', '~/글', '../글', '글/../밖', './글', '글/.숨김', 'C:\\notes', '글\\원고', '글:원고', '글/ 원고', '글\n원고'])('rejects unsafe or inaccessible paths: %s', path => {
    expect(() => normalizeDraftFolder(path, '.obsidian')).toThrow();
  });
  it('protects custom configuration directories and their children but allows similarly named folders', () => {
    expect(() => normalizeDraftFolder('CONFIG/Plugins', 'Config')).toThrow('설정 폴더');
    expect(() => normalizeDraftFolder('설정/옵시디안/자료', '설정/옵시디안')).toThrow('설정 폴더');
    expect(normalizeDraftFolder('Config notes/글', 'Config')).toBe('Config notes/글');
  });
  it('creates every missing parent and uses the selected folder', async () => {
    const { port, entries } = vault(); const path = await createDraft(port, '작업/글/LinkedIn', '.obsidian', date);
    expect([...entries.keys()].slice(0, 3)).toEqual(['작업', '작업/글', '작업/글/LinkedIn']);
    expect(path).toMatch(/^작업\/글\/LinkedIn\/새 글 .*\.md$/);
    expect(entries.has('Writing Workbench')).toBe(false);
  });
  it('uses existing folders without moving old notes or creating an extra legacy folder', async () => {
    const { port, entries } = vault(); entries.set('내 글', 'folder'); entries.set('Writing Workbench/기존.md', 'file');
    await createDraft(port, '내 글', '.obsidian', date);
    expect(port.createFolder).not.toHaveBeenCalled(); expect(entries.get('Writing Workbench/기존.md')).toBe('file');
  });
  it('creates a note at the vault root when empty without creating a folder', async () => {
    const { port } = vault(); const path = await createDraft(port, '', '.obsidian', date);
    expect(path).not.toContain('/'); expect(port.createFolder).not.toHaveBeenCalled();
  });
  it('does not create anything if a path segment is an existing file', async () => {
    const { port, entries } = vault(); entries.set('작업', 'file');
    expect(() => checkDraftFolder('작업/원고', '.obsidian', port.kind)).toThrow('파일입니다');
    await expect(createDraft(port, '작업/원고', '.obsidian', date)).rejects.toThrow('파일입니다');
    expect(port.createFolder).not.toHaveBeenCalled(); expect(port.createNote).not.toHaveBeenCalled();
  });
  it('creates distinct filenames for rapid requests without overwriting existing content', async () => {
    const { port, entries } = vault();
    const paths = await Promise.all(Array.from({ length: 4 }, () => createDraft(port, '', '.obsidian', date)));
    expect(new Set(paths).size).toBe(4); expect(entries.size).toBe(4);
  });
  it('survives a concurrent folder creation and propagates genuine write failures', async () => {
    const { port, entries } = vault();
    port.createFolder = async path => { entries.set(path, 'folder'); throw new Error('already exists'); };
    expect(await createDraft(port, '원고', '.obsidian', date)).toMatch(/^원고\//);
    port.createNote = async () => { throw new Error('permission denied'); };
    await expect(createDraft(port, '원고', '.obsidian', date)).rejects.toThrow('permission denied');
  });
});
