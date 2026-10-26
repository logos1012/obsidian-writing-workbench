import { AgentReplySchema, id, now, type Preferences, type Project, type Provider, type Settings } from './model';
import { acceptSuggestion, ConflictError, validateSuggestions } from './review';
import { buildPrompt, type Task } from './prompt';
import type { Agent } from '../providers/cli';

export interface Store<T> { save(value: T): Promise<void> }
export interface DocumentPort {
  read(path: string): Promise<string>;
  compareAndSwap(path: string, expected: string, next: string): Promise<void>;
}
export interface RequestActivity {
  provider: Provider; task: Task; research: boolean; startedAt: number;
  phase: 'preparing' | 'running' | 'processing' | 'cancelling';
}
export class Workspace {
  busy = false;
  error = '';
  status = '작업 기록 저장됨';
  activity: RequestActivity | null = null;
  onChange: () => void = () => undefined;
  private aborter?: AbortController;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    public project: Project,
    public preferences: Preferences,
    private projectStore: Store<Project>,
    private preferencesStore: Store<Preferences>,
    private documents: DocumentPort,
    private agent: Agent,
    private getSettings: () => Settings,
  ) {}

  private persist(): Promise<void> {
    this.project.updatedAt = now();
    const copy = structuredClone(this.project);
    const work = this.writes.then(() => this.projectStore.save(copy));
    this.writes = work.catch(() => undefined);
    return work;
  }
  async flush(): Promise<void> { await this.writes; if (this.error.startsWith('작업 기록 저장 실패')) throw new Error(this.error); }
  async edit(patch: Partial<Pick<Project, 'draft' | 'materials' | 'memo' | 'composer'>>): Promise<void> {
    if (this.busy) return;
    Object.assign(this.project, patch);
    this.status = '작업 기록 저장 중';
    try { await this.persist(); this.status = '작업 기록 저장됨'; this.error = ''; }
    catch { this.error = '작업 기록 저장 실패: 입력 내용은 화면에 남아 있습니다. 원고를 복사하고 디스크 공간·권한을 확인해 주세요.'; throw new Error(this.error); }
  }
  async chooseProvider(provider: Provider): Promise<void> {
    if (this.busy) return;
    this.project.provider = provider;
    await this.persist(); this.onChange();
  }
  cancel(): void {
    if (this.activity) this.activity.phase = 'cancelling';
    this.aborter?.abort(); this.onChange();
  }
  private async operation(work: () => Promise<void>, activity: RequestActivity | null = null): Promise<void> {
    if (this.busy) throw new Error('현재 작업이 끝나거나 중지될 때까지 기다려 주세요.');
    this.busy = true; this.error = ''; this.activity = activity;
    if (activity) this.aborter = new AbortController();
    this.onChange();
    try { await this.flush(); await work(); }
    catch (error) { this.error = error instanceof Error ? error.message : '작업에 실패했습니다.'; throw error; }
    finally { this.busy = false; this.aborter = undefined; this.activity = null; this.onChange(); }
  }
  async run(task: Task, request: string, research: boolean): Promise<void> {
    await this.operation(async () => {
      if (task === 'review' && !this.project.draft.trim()) throw new Error('먼저 직접 초안을 작성해 주세요.');
      if (!request.trim()) throw new Error('답변이나 요청을 입력해 주세요.');
      const provider = this.project.provider;
      const prompt = buildPrompt(this.project, this.preferences, task, request, research);
      this.project.messages.push({ id: id(), role: 'user', text: request, provider, createdAt: now() });
      await this.persist();
      this.status = `${provider === 'claude' ? 'Claude Code' : 'Codex'} 응답을 기다리는 중`;
      const signal = this.aborter!.signal;
      if (signal.aborted) throw new Error('요청을 중지했습니다.');
      this.onChange();
      const reply = AgentReplySchema.parse(await this.agent.run({ provider, prompt, research, signal, settings: this.getSettings(), onProgress: phase => {
        if (!this.activity || signal.aborted) return;
        this.activity.phase = phase; this.onChange();
      } }));
      if (signal.aborted) throw new Error('요청을 중지했습니다.');
      if (task !== 'review' && reply.suggestions.length) throw new Error('인터뷰 응답에 원고 수정이 포함되어 반영하지 않았습니다. 다시 요청해 주세요.');
      if (task === 'interview' && (!reply.question.trim() || (reply.question.match(/[?？]/g)?.length ?? 0) > 1)) throw new Error('AI가 한 번에 한 질문 형식을 지키지 않았습니다. 다시 요청해 주세요.');
      const sourceIds = new Set(reply.sources.map(s => s.id));
      if (task === 'review') validateSuggestions(this.project.draft, reply.suggestions);
      if (sourceIds.size !== reply.sources.length) throw new Error('AI 응답에 중복된 출처 ID가 있습니다. 다시 검토해 주세요.');
      if (reply.suggestions.some(s => s.sourceIds.some(source => !sourceIds.has(source)))) throw new Error('수정 제안의 출처 연결이 올바르지 않습니다. 다시 검토해 주세요.');
      this.project.messages.push({ id: id(), role: 'assistant', text: [reply.message, reply.question].filter(Boolean).join('\n\n'), provider, createdAt: now() });
      // Never erase the user's memo with an empty model field.
      for (const memo of reply.memo) {
        const existing = this.project.memo.find(m => m.key === memo.key);
        if (existing && memo.text.trim()) existing.text = memo.text;
      }
      if (task === 'review') {
        this.project.reviews.push({
          id: id(), provider, createdAt: now(), original: this.project.draft, expected: this.project.draft,
          message: reply.message, diagnosis: reply.diagnosis, sources: reply.sources,
          suggestions: reply.suggestions.map(s => ({ ...s, id: id(), status: 'pending' })),
        });
      }
      for (const proposal of reply.preferences) {
        if (!this.preferences.items.some(p => p.text === proposal.text)) this.preferences.items.push({ ...proposal, id: id(), provider, status: 'pending', createdAt: now() });
      }
      await this.preferencesStore.save(this.preferences);
      await this.persist(); this.status = '검토 결과와 대화를 저장했습니다';
    }, { provider: this.project.provider, task, research, startedAt: Date.now(), phase: 'preparing' });
  }
  async decide(reviewId: string, suggestionId: string, decision: 'accepted' | 'rejected'): Promise<void> {
    await this.operation(async () => {
      const review = this.project.reviews.find(r => r.id === reviewId);
      const proposal = review?.suggestions.find(s => s.id === suggestionId);
      if (!review || !proposal || proposal.status !== 'pending') throw new Error('처리할 제안을 찾을 수 없습니다.');
      const previous = structuredClone(this.project);
      if (decision === 'accepted') {
        const next = acceptSuggestion(this.project, review, suggestionId);
        this.snapshot('제안 수락 전');
        this.project.draft = next; review.expected = next;
      }
      proposal.status = decision;
      try { await this.persist(); }
      catch (error) { this.project = previous; throw error; }
      this.status = decision === 'accepted' ? '작업 원고에 반영했습니다. 파일에 저장하려면 원고 저장을 누르세요.' : '거절한 제안을 기록했습니다';
    });
  }
  private snapshot(label: string): void {
    const last = this.project.revisions.at(-1);
    if (last?.text !== this.project.draft) this.project.revisions.push({ id: id(), createdAt: now(), label, text: this.project.draft });
  }
  async saveDocument(): Promise<void> {
    await this.operation(async () => {
      if (this.project.pendingWrite) await this.recoverWrite();
      if (this.project.draft === this.project.base) { this.status = '원고 파일과 작업 사본이 같습니다'; return; }
      const before = this.project.base, after = this.project.draft;
      this.project.pendingWrite = { before, after, createdAt: now() };
      await this.persist();
      try { await this.documents.compareAndSwap(this.project.path, before, after); }
      catch (error) {
        this.project.pendingWrite = null; await this.persist(); throw error;
      }
      this.project.base = after; this.snapshot('원고 저장'); this.project.pendingWrite = null;
      await this.persist(); this.status = '원고 파일에 저장했습니다';
    });
  }
  async recoverWrite(): Promise<void> {
    const pending = this.project.pendingWrite;
    if (!pending) return;
    const text = await this.documents.read(this.project.path);
    if (text === pending.after) {
      this.project.base = text; this.project.pendingWrite = null;
      this.snapshot('중단된 저장 복구'); await this.persist();
    } else if (text === pending.before) { this.project.pendingWrite = null; await this.persist(); }
    else throw new ConflictError('중단된 저장 이후 파일이 바뀌었습니다. 작업 사본을 복사한 뒤 파일에서 다시 불러와 주세요.');
  }
  async reloadDocument(): Promise<void> {
    await this.operation(async () => {
      const text = await this.documents.read(this.project.path);
      this.snapshot('파일에서 불러오기 전 작업 사본');
      this.project.base = text; this.project.draft = text; this.project.pendingWrite = null;
      this.snapshot('파일에서 다시 불러옴'); await this.persist(); this.status = '최신 원고 파일을 불러왔습니다. 이전 작업 사본은 이력에 남겼습니다.';
    });
  }
  async restoreRevision(revisionId: string): Promise<void> {
    await this.operation(async () => {
      const revision = this.project.revisions.find(r => r.id === revisionId);
      if (!revision) throw new Error('버전을 찾을 수 없습니다.');
      this.snapshot('복원 전 작업 사본'); this.project.draft = revision.text;
      await this.persist(); this.status = '이전 원고를 작업 사본으로 복원했습니다. 파일 저장 전 검토해 주세요.';
    });
  }
  async preference(preferenceId: string, status: 'approved' | 'dismissed', text?: string): Promise<void> {
    await this.operation(async () => {
      const preference = this.preferences.items.find(p => p.id === preferenceId);
      if (!preference) throw new Error('문체 원칙을 찾을 수 없습니다.');
      const previous = structuredClone(this.preferences);
      preference.status = status; if (text?.trim()) preference.text = text.trim();
      try { await this.preferencesStore.save(this.preferences); }
      catch (error) { this.preferences = previous; throw error; }
      this.status = status === 'approved' ? '다음 글에도 적용할 원칙을 저장했습니다' : '문체 원칙 적용을 해제했습니다';
    });
  }
  async rename(path: string): Promise<void> { this.project.path = path; await this.persist(); this.onChange(); }
}
