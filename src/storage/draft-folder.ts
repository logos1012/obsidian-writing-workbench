export const DEFAULT_DRAFT_FOLDER = '글쓰기';
export const LEGACY_DRAFT_FOLDER = 'Writing Workbench';

export function initialDraftFolder(saved: string | undefined, legacyFolderExists: boolean): string {
  return saved ?? (legacyFolderExists ? LEGACY_DRAFT_FOLDER : DEFAULT_DRAFT_FOLDER);
}

type EntryKind = 'file' | 'folder' | undefined;
export interface DraftVault<T> {
  kind(path: string): EntryKind;
  createFolder(path: string): Promise<unknown>;
  createNote(path: string): Promise<T>;
}

export function normalizeDraftFolder(input: string, configDir: string): string {
  const value = input.trim();
  if (!value) return '';
  if (/^(\/|~|[a-z]:)/i.test(value)) throw new Error('볼트 안의 상대 경로를 입력하세요. 볼트 최상위에 저장하려면 비워 두세요.');
  if (/[<>:"|?*\\\u0000-\u001f\u007f]/.test(value)) throw new Error('폴더 이름에 사용할 수 없는 문자가 있습니다. 하위 폴더는 /로 구분하세요.');
  const parts = value.split('/').filter(Boolean);
  if (parts.some(part => part.startsWith('.') || part !== part.trim())) throw new Error('숨김 폴더, 상위 경로(..), 폴더 이름 앞뒤의 공백은 사용할 수 없습니다.');
  const path = parts.join('/');
  const comparable = (text: string) => text.normalize('NFC').toLocaleLowerCase();
  const config = comparable(configDir.replace(/^\/+|\/+$/g, ''));
  if (config && (comparable(path) === config || comparable(path).startsWith(`${config}/`))) throw new Error('Obsidian 설정 폴더에는 원고를 저장할 수 없습니다. 다른 폴더를 선택하세요.');
  return path;
}

function ancestors(path: string): string[] {
  return path ? path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/')) : [];
}

export function checkDraftFolder(input: string, configDir: string, kind: (path: string) => EntryKind): string {
  const path = normalizeDraftFolder(input, configDir);
  for (const parent of ancestors(path)) {
    if (kind(parent) === 'file') throw new Error(`“${parent}”은 파일입니다. 다른 폴더 경로를 선택하세요.`);
  }
  return path;
}

export async function createDraft<T>(vault: DraftVault<T>, input: string, configDir: string, date = new Date()): Promise<T> {
  const folder = checkDraftFolder(input, configDir, path => vault.kind(path));
  for (const parent of ancestors(folder)) {
    if (vault.kind(parent) === 'folder') continue;
    try { await vault.createFolder(parent); }
    catch (error) { if (vault.kind(parent) !== 'folder') throw error; }
  }
  const stamp = date.toLocaleString('sv-SE').replace(/[: ]/g, '-');
  const base = `${folder ? `${folder}/` : ''}새 글 ${stamp}`;
  for (let index = 0; index < 1000; index++) {
    const path = `${base}${index ? `-${index}` : ''}.md`;
    if (vault.kind(path)) continue;
    try { return await vault.createNote(path); }
    catch (error) { if (!vault.kind(path)) throw error; }
  }
  throw new Error('같은 이름의 원고가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
}
