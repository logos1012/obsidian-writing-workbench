import { createProject, defaultSettings, type AgentReply, type Preferences, type Project } from '../src/domain/model';
import { Workspace, type DocumentPort, type Store } from '../src/domain/workspace';
import { ConflictError } from '../src/domain/review';
import type { Agent, AgentRequest } from '../src/providers/cli';

export const reply: AgentReply = {
  message: '주장을 더 구체적으로 만들 수 있습니다.', question: '', memo: [], sources: [], preferences: [],
  diagnosis: [{ criterion: '근거', severity: 'verify', detail: '수치를 확인해 주세요.', quote: '효율이 좋아졌다.' }],
  suggestions: [{ before: '효율이 좋아졌다.', after: '반복 작업 시간이 줄었다.', reason: '변화를 구체화합니다.', sourceIds: [] }],
};
export class MemoryStore<T> implements Store<T> {
  value?: T; failure = false;
  async save(value: T): Promise<void> { if (this.failure) throw new Error('disk full'); this.value = structuredClone(value); }
}
export function harness(text = '효율이 좋아졌다. 내 경험이다.') {
  const project = createProject('draft.md', text);
  const projectStore = new MemoryStore<Project>(), preferencesStore = new MemoryStore<Preferences>();
  let document = text;
  const documents: DocumentPort = {
    read: async () => document,
    compareAndSwap: async (_, expected, next) => { if (document !== expected) throw new ConflictError('external modification'); document = next; },
  };
  const requests: AgentRequest[] = [];
  const agent: Agent = { run: async request => { requests.push(request); return structuredClone(reply); } };
  const ws = new Workspace(project, { version: 1, items: [] }, projectStore, preferencesStore, documents, agent, () => defaultSettings);
  return { ws, projectStore, preferencesStore, documents, agent, requests, getDocument: () => document, setDocument: (text: string) => { document = text; } };
}
