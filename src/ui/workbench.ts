import type { Workspace } from '../domain/workspace';
import { memoKeys, safeSourceUrl, type Project, type Provider, type Review } from '../domain/model';
import { markdown } from './markdown';
import { ColumnResizer, defaultWidths, type ColumnWidths } from './layout';
import { ViewState } from './view-state';
import { linkedinPreview } from './linkedin-preview';

export interface Actions {
  newProject(): void; openProject(): void; addMaterial(): void; settings(): void; recoverProject?(): void;
  columnWidths?: ColumnWidths; saveColumnWidths?(widths: ColumnWidths): Promise<void>;
}
const providerName = (provider: Provider) => provider === 'claude' ? 'Claude Code' : 'Codex';
const time = (value: string) => new Date(value).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
}
export class WorkbenchUI {
  private tab: 'interview' | 'review' | 'history' = 'interview';
  private mode: 'draft' | 'preview' = 'draft';
  private mobile = false;
  private research = false;
  private input = '';
  private reviewId = '';
  private status?: HTMLElement;
  private draft?: HTMLTextAreaElement;
  private viewState = new ViewState();
  private activeAnchor?: string;
  private resizer?: ColumnResizer;
  private widths: ColumnWidths;
  private memoEdits = new Map<string, string>();
  private activityTimer?: ReturnType<typeof setInterval>;
  constructor(private host: HTMLElement, private workspace: Workspace, private actions: Actions) {
    this.input = workspace.project.composer;
    this.widths = [...(actions.columnWidths ?? defaultWidths)];
    workspace.onChange = () => this.render(); this.render();
  }
  destroy(): void { this.resizer?.destroy(); if (this.activityTimer) clearInterval(this.activityTimer); this.workspace.onChange = () => undefined; this.host.replaceChildren(); }
  private button(text: string, callback: () => void | Promise<void>, className = ''): HTMLButtonElement {
    const button = element('button', className, text); button.type = 'button';
    button.disabled = this.workspace.busy;
    button.addEventListener('click', () => {
      this.activeAnchor = button.closest<HTMLElement>('[data-ww-anchor]')?.dataset.wwAnchor;
      try { Promise.resolve(callback()).catch(error => this.showError(error)).finally(() => { this.activeAnchor = undefined; }); }
      catch (error) { this.showError(error); this.activeAnchor = undefined; }
    });
    return button;
  }
  private showError(error: unknown): void {
    this.workspace.error = error instanceof Error ? error.message : '작업에 실패했습니다.';
    this.refreshStatus();
  }
  private refreshStatus(): void {
    if (!this.status) return;
    this.status.textContent = this.workspace.error || this.workspace.status;
    this.status.classList.toggle('ww-error', Boolean(this.workspace.error));
    const review = this.workspace.project.reviews.find(r => r.id === this.reviewId) ?? this.workspace.project.reviews.at(-1);
    for (const button of this.host.querySelectorAll<HTMLButtonElement>('.ww-accept')) button.disabled = this.workspace.busy || (review ? review.expected !== this.workspace.project.draft : true);
  }
  render(): void {
    const ws = this.workspace, p = ws.project;
    this.viewState.capture(this.host, this.activeAnchor);
    this.resizer?.destroy();
    if (this.activityTimer) { clearInterval(this.activityTimer); this.activityTimer = undefined; }
    this.host.replaceChildren(); this.host.classList.add('ww-root');
    this.host.dataset.wwScroll = 'workbench';
    const toolbar = element('header', 'ww-toolbar');
    const title = element('div', 'ww-title'); title.append(element('strong', '', p.path.split('/').at(-1)?.replace(/\.md$/, '') || '새 글'), element('span', 'ww-subtle', 'LinkedIn 글쓰기'));
    const controls = element('div', 'ww-controls');
    const provider = element('select'); provider.setAttribute('aria-label', 'AI 선택'); provider.disabled = ws.busy;
    provider.dataset.wwFocus = 'provider';
    for (const value of ['claude', 'codex'] as const) { const option = element('option', '', providerName(value)); option.value = value; option.selected = p.provider === value; provider.append(option); }
    provider.addEventListener('change', () => { void ws.chooseProvider(provider.value as Provider).catch(error => this.showError(error)); });
    controls.append(provider, this.button('새 글', this.actions.newProject), this.button('글 열기', this.actions.openProject), this.button('설정', this.actions.settings), this.button('원고 저장', () => ws.saveDocument(), 'mod-cta'));
    if (this.actions.recoverProject) controls.insertBefore(this.button('작업 기록', this.actions.recoverProject), controls.lastChild);
    toolbar.append(title, controls); this.host.append(toolbar);
    const statusbar = element('div', 'ww-statusbar');
    this.status = element('span', 'ww-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite'); this.refreshStatus(); statusbar.append(this.status);
    if (ws.busy && !ws.activity) statusbar.append(element('span', 'ww-subtle', '변경 사항 저장 중'));
    else statusbar.append(this.button('파일에서 다시 불러오기', () => ws.reloadDocument(), 'ww-text-button'));
    this.host.append(statusbar);
    if (ws.activity) this.host.append(this.renderActivity());
    const columns = element('div', 'ww-columns');
    this.resizer = new ColumnResizer(columns, this.widths, (widths, save) => {
      this.widths = [...widths];
      if (save) void this.actions.saveColumnWidths?.([...widths]).catch(error => this.showError(error));
    });
    columns.append(this.renderMemo(), this.resizer.separator(0), this.renderDraft(), this.resizer.separator(1), this.renderSide()); this.host.append(columns);
    this.viewState.restore(this.host);
    this.refreshStatus();
  }
  private renderActivity(): HTMLElement {
    const activity = this.workspace.activity!;
    const banner = element('section', 'ww-activity'); banner.setAttribute('aria-label', 'AI 실행 상태');
    const spinner = element('span', 'ww-spinner'); spinner.setAttribute('aria-hidden', 'true');
    const body = element('div', 'ww-activity-body');
    const title = element('strong', '', `${providerName(activity.provider)} · ${{ interview: '글감 찾기 진행 중', outline: '개요 정리 중', review: '원고 검토 중' }[activity.task]}`);
    title.setAttribute('role', 'status');
    const phase = { preparing: '연결을 준비하고 있습니다', running: '실행 중 · AI 응답을 기다리고 있습니다', processing: '받은 결과를 정리하고 있습니다', cancelling: '요청을 중지하고 있습니다' }[activity.phase];
    body.append(title, element('span', '', phase), element('small', '', activity.research ? '외부 자료 검색을 허용한 요청입니다. 결과가 완성되면 표시합니다.' : '결과가 완성되면 표시합니다. 기다리는 동안 다른 글로 이동하지 않아도 됩니다.'));
    const elapsed = element('span', 'ww-activity-elapsed'); elapsed.setAttribute('aria-label', '경과 시간');
    const tick = () => { const seconds = Math.max(0, Math.floor((Date.now() - activity.startedAt) / 1000)); elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} 경과`; };
    tick(); this.activityTimer = setInterval(tick, 1000);
    const cancel = this.button(activity.phase === 'cancelling' ? '중지 중…' : '요청 중지', () => this.workspace.cancel()); cancel.disabled = activity.phase === 'cancelling';
    banner.append(spinner, body, elapsed, cancel); return banner;
  }
  private renderMemo(): HTMLElement {
    const ws = this.workspace;
    const panel = element('section', 'ww-memo ww-panel'); panel.setAttribute('aria-label', '글의 방향과 자료');
    panel.dataset.wwScroll = 'memo';
    panel.append(element('h2', 'ww-panel-title', '글의 방향'), element('p', 'ww-hint', '내용을 두 번 클릭하면 바로 수정할 수 있어요. 키보드로는 항목을 선택한 뒤 Enter를 누르세요.'));
    for (const key of memoKeys) {
      const section = element('section', 'ww-memo-section'); section.dataset.wwAnchor = `memo-${key}`;
      const heading = element('div', 'ww-memo-heading'); heading.append(element('h3', '', key));
      const text = ws.project.memo.find(m => m.key === key)?.text ?? '';
      if (!this.memoEdits.has(key)) {
        section.classList.add('ww-memo-reader'); section.tabIndex = ws.busy ? -1 : 0;
        section.dataset.wwFocus = `memo-reader-${key}`;
        section.setAttribute('aria-label', `${key} — 두 번 클릭하거나 Enter로 편집`);
        section.setAttribute('aria-keyshortcuts', 'Enter');
        const edit = () => {
          if (ws.busy) return;
          this.memoEdits.set(key, text); this.render();
          const input = [...this.host.querySelectorAll<HTMLTextAreaElement>('.ww-memo-input')].find(node => node.dataset.wwFocus === `memo-edit-${key}`);
          input?.focus({ preventScroll: true });
        };
        section.addEventListener('dblclick', event => { if (!(event.target as Element).closest('a,button')) edit(); });
        section.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target === section && !event.isComposing) { event.preventDefault(); edit(); } });
        section.append(heading, text.trim() ? markdown(text, 'ww-memo-content') : element('p', 'ww-memo-empty', key === '관점' ? '어떤 이야기를 전하고 싶은가요?' : '글감을 찾는 대화에서 여기에 정리됩니다.'));
      } else {
        const area = element('textarea', 'ww-memo-input'); area.rows = key === '개요' ? 8 : 5;
        area.value = this.memoEdits.get(key)!; area.disabled = ws.busy; area.setAttribute('aria-label', `${key} 편집`); area.dataset.wwFocus = `memo-edit-${key}`; area.dataset.wwScroll = `memo-editor-${key}`;
        area.addEventListener('input', () => { this.memoEdits.set(key, area.value); });
        const buttons = element('div', 'ww-edit-actions');
        const save = this.button('저장', async () => {
          await ws.edit({ memo: ws.project.memo.map(m => m.key === key ? { ...m, text: this.memoEdits.get(key) ?? '' } : m) });
          this.memoEdits.delete(key); this.render();
        }, 'mod-cta');
        const cancel = this.button('취소', () => { this.memoEdits.delete(key); this.render(); });
        buttons.append(save, cancel);
        area.addEventListener('keydown', event => {
          if (event.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); cancel.click(); }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save.click(); }
        });
        section.append(heading, area, buttons);
      }
      panel.append(section);
    }
    const material = element('details', 'ww-materials'); material.append(element('summary', '', '참고 자료'));
    material.dataset.wwDetail = 'materials';
    material.append(this.button('볼트의 노트 추가', this.actions.addMaterial));
    const area = element('textarea'); area.setAttribute('aria-label', '참고 자료'); area.rows = 7; area.disabled = ws.busy; area.dataset.wwScroll = 'materials-editor'; area.dataset.wwFocus = 'materials-editor';
    area.placeholder = '참고할 글, 데이터, URL과 요청을 적어 주세요. URL 내용 확인은 외부 자료 검색을 켜고 요청하세요.';
    area.value = ws.project.materials; area.addEventListener('input', () => { void ws.edit({ materials: area.value }).then(() => this.refreshStatus()).catch(error => this.showError(error)); });
    material.append(area); panel.append(material);
    const principles = element('section', 'ww-principles'); principles.append(element('h3', '', '내 문체 원칙'));
    const preferences = ws.preferences.items.filter(p => p.status !== 'dismissed');
    if (!preferences.length) principles.append(element('p', 'ww-hint', 'AI가 발견한 취향은 확인 후 저장합니다.'));
    for (const pref of preferences) {
      const box = element('div', 'ww-preference'); box.append(element('span', 'ww-badge', pref.status === 'approved' ? '적용 중' : '확인 필요'));
      const text = element('textarea'); text.setAttribute('aria-label', '문체 원칙 수정'); text.rows = 3; text.value = pref.text; text.disabled = ws.busy; text.dataset.wwUnsaved = pref.id; text.dataset.wwFocus = `preference-${pref.id}`; box.append(text);
      box.append(markdown(pref.reason, 'ww-hint'));
      box.append(this.button(pref.status === 'approved' ? '변경 저장' : '원칙으로 저장', () => ws.preference(pref.id, 'approved', text.value)), this.button(pref.status === 'approved' ? '적용 해제' : '저장 안 함', () => ws.preference(pref.id, 'dismissed')));
      principles.append(box);
    }
    panel.append(principles); return panel;
  }
  private renderDraft(): HTMLElement {
    const ws = this.workspace;
    const panel = element('section', 'ww-writing ww-panel'); panel.setAttribute('aria-label', '원고');
    panel.dataset.wwScroll = `writing-${this.mode}`;
    const tabs = element('div', 'ww-tabs');
    for (const [value, label] of [['draft', '원고'], ['preview', '미리보기']] as const) {
      const button = this.button(label, () => { this.mode = value; this.render(); }, this.mode === value ? 'is-active' : ''); button.setAttribute('aria-pressed', String(this.mode === value)); button.dataset.wwFocus = `mode-${value}`; tabs.append(button);
    }
    const count = element('span', 'ww-count', `${Array.from(ws.project.draft).length.toLocaleString()}자`); tabs.append(count); panel.append(tabs);
    if (this.mode === 'draft') {
      const hint = element('p', 'ww-hint', '초안은 직접 써 주세요. AI 제안은 수락할 때만 작업 원고에 반영됩니다.'); panel.append(hint);
      this.draft = element('textarea', 'ww-draft'); this.draft.setAttribute('aria-label', '원고 작성'); this.draft.spellcheck = false;
      this.draft.dataset.wwScroll = 'draft-editor'; this.draft.dataset.wwFocus = 'draft-editor';
      this.draft.placeholder = '첫 문장을 적어 보세요.\n\n아직 주제가 없다면 오른쪽의 글감 찾기에서 대화를 시작해도 좋아요.';
      this.draft.value = ws.project.draft; this.draft.disabled = ws.busy;
      this.draft.addEventListener('input', () => {
        const value = this.draft?.value ?? ''; count.textContent = `${Array.from(value).length.toLocaleString()}자`;
        void ws.edit({ draft: value }).then(() => this.refreshStatus()).catch(error => this.showError(error));
      }); panel.append(this.draft);
    } else {
      const controls = element('div', 'ww-preview-controls');
      for (const [mobile, label] of [[false, '데스크톱'], [true, '모바일']] as const) {
        const control = this.button(label, () => { this.mobile = mobile; this.render(); }, this.mobile === mobile ? 'is-active' : '');
        control.setAttribute('aria-pressed', String(this.mobile === mobile)); controls.append(control);
      }
      panel.append(controls, element('p', 'ww-hint', 'LinkedIn 밝은 피드 화면을 참고한 미리보기입니다. 실제 게시 화면과 줄바꿈·접힘 위치는 다를 수 있어요.'), linkedinPreview(ws.project.draft, this.mobile));
      panel.append(this.button('원고 복사', async () => { await navigator.clipboard.writeText(ws.project.draft); ws.status = '원고를 복사했습니다'; this.refreshStatus(); }));
    }
    return panel;
  }
  private renderSide(): HTMLElement {
    const panel = element('section', 'ww-side ww-panel'); panel.setAttribute('aria-label', 'AI와 작업');
    panel.dataset.wwScroll = `side-${this.tab}`;
    panel.append(element('h2', 'ww-panel-title', 'AI와 작업'));
    const tabs = element('div', 'ww-tabs');
    for (const [value, label] of [['interview', '글감 찾기'], ['review', '검토'], ['history', '이력']] as const) {
      const button = this.button(label, () => { this.tab = value; this.render(); }, this.tab === value ? 'is-active' : ''); button.setAttribute('aria-pressed', String(this.tab === value)); button.dataset.wwFocus = `tab-${value}`; tabs.append(button);
    }
    panel.append(tabs);
    if (this.tab === 'interview') this.renderInterview(panel);
    if (this.tab === 'review') this.renderReview(panel);
    if (this.tab === 'history') this.renderHistory(panel);
    return panel;
  }
  private composer(panel: HTMLElement, review: boolean): void {
    const ws = this.workspace;
    const form = element('form', 'ww-composer');
    const input = element('textarea'); input.rows = 4; input.value = this.input; input.disabled = ws.busy;
    input.setAttribute('aria-label', review ? '검토 요청' : '글감 찾기 답변');
    input.dataset.wwScroll = 'composer'; input.dataset.wwFocus = 'composer';
    input.placeholder = review ? '특히 확인하고 싶은 주장이나 표현을 알려 주세요.' : '질문에 대한 내 경험과 생각을 적어 주세요. 짧게 답해도 괜찮아요.';
    input.addEventListener('input', () => {
      this.input = input.value;
      void ws.edit({ composer: this.input }).then(() => this.refreshStatus()).catch(error => this.showError(error));
    }); form.append(input);
    const label = element('label', 'ww-research'); const check = element('input'); check.type = 'checkbox'; check.checked = this.research; check.disabled = ws.busy;
    check.addEventListener('change', () => { this.research = check.checked; }); label.append(check, document.createTextNode('이번 요청에 외부 자료 검색 허용')); form.append(label);
    const started = ws.project.messages.some(m => m.task !== 'review');
    const submit = this.button(review ? '전체 진단과 수정 제안 받기' : started ? '답변 보내기' : '글감 찾기 시작', async () => {
      const request = this.input.trim() || (review ? '현재 초안을 전체 진단하고 문장별 개선과 근거 확인이 필요한 부분을 제안해 주세요.' : '내 경험에서 LinkedIn 글감을 찾을 수 있도록 첫 질문 하나를 해 주세요.');
      await ws.run(review ? 'review' : 'interview', request, this.research); this.input = ''; await ws.edit({ composer: '' }); this.research = false; this.reviewId = ''; this.render();
    }, 'mod-cta'); form.append(submit);
    form.addEventListener('submit', event => { event.preventDefault(); submit.click(); });
    input.addEventListener('keydown', event => { if (!event.isComposing && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit.click(); } });
    panel.append(form);
  }
  private renderInterview(panel: HTMLElement): void {
    const messages = this.workspace.project.messages.filter(m => m.task !== 'review');
    const intro = element('div', 'ww-interview-guide');
    intro.append(element('h3', '', '내 경험에서 글의 주제 찾기'), element('p', '', 'AI가 한 번에 하나씩 질문하고, 내 답변에서 관점과 개요를 정리합니다. 초안은 직접 작성해요.'));
    panel.append(intro);
    if (messages.length > 2) {
      const earlier = element('details', 'ww-earlier-conversation'); earlier.dataset.wwDetail = 'earlier-conversation';
      earlier.append(element('summary', '', `이전 대화 ${messages.length - 2}개 보기`));
      for (const message of messages.slice(0, -2)) earlier.append(this.conversationMessage(message));
      panel.append(earlier);
    }
    const conversation = element('div', 'ww-conversation');
    for (const msg of messages.slice(-2)) conversation.append(this.conversationMessage(msg));
    panel.append(conversation); this.composer(panel, false);
    if (messages.length) panel.append(this.button('지금까지 개요로 정리', async () => {
      await this.workspace.run('outline', '지금까지의 대화로 글의 주제·관점·개요를 정리해 주세요. 초안은 제가 직접 쓰겠습니다.', false);
    }, 'ww-outline-button'));
  }
  private conversationMessage(msg: Project['messages'][number]): HTMLElement {
    const item = element('article', `ww-message is-${msg.role}`);
    const meta = element('div', 'ww-message-meta');
    meta.append(element('strong', '', msg.role === 'user' ? '나의 답변' : providerName(msg.provider)), element('time', '', time(msg.createdAt))); item.append(meta);
    const question = msg.role === 'assistant' ? msg.question?.trim() : '';
    const messageText = msg.text.trimEnd();
    const text = question && messageText.endsWith(question) ? messageText.slice(0, -question.length).trimEnd() : messageText;
    if (text) item.append(markdown(text, 'ww-message-body'));
    if (question) {
      const block = element('div', 'ww-message-question');
      block.append(element('span', 'ww-question-label', '이번 질문'), markdown(question)); item.append(block);
    }
    return item;
  }
  private renderReview(panel: HTMLElement): void {
    const ws = this.workspace;
    const reviews = ws.project.reviews;
    const review = reviews.find(r => r.id === this.reviewId) ?? reviews.at(-1);
    if (!review) panel.append(element('div', 'ww-empty', '초안을 쓴 뒤 검토를 요청하세요. 전체 진단과 문장별 제안을 함께 보여드립니다.'));
    else {
      const select = element('select'); select.setAttribute('aria-label', '검토 기록 선택');
      for (const item of [...reviews].reverse()) { const option = element('option', '', `${providerName(item.provider)} · ${time(item.createdAt)}`); option.value = item.id; option.selected = item.id === review.id; select.append(option); }
      select.addEventListener('change', () => { this.reviewId = select.value; this.render(); }); panel.append(select);
      if (review.original !== ws.project.draft) panel.append(element('p', 'ww-warning', '이 진단은 이전 원고 기준입니다. 현재 원고의 평가가 필요하면 다시 검토하세요.'));
      panel.append(element('h3', '', '전체 진단'), markdown(review.message, 'ww-review-summary'));
      for (const finding of review.diagnosis) {
        const item = element('div', `ww-finding is-${finding.severity}`);
        item.append(element('strong', '', `${finding.criterion} · ${{ strength: '강점', improve: '다듬기', verify: '확인 필요' }[finding.severity]}`), markdown(finding.detail));
        if (finding.quote) item.append(this.button('해당 문장 보기', () => this.selectQuote(finding.quote), 'ww-text-button'));
        panel.append(item);
      }
      panel.append(element('h3', '', '문장별 제안'));
      if (!review.suggestions.length) panel.append(element('p', 'ww-hint', '이번 검토에는 문장 수정 제안이 없습니다.'));
      for (const suggestion of review.suggestions) {
        const card = element('article', 'ww-suggestion'); card.dataset.wwAnchor = suggestion.id; card.append(markdown(suggestion.reason, 'ww-reason'));
        card.append(element('span', 'ww-diff-label', '원문'), element('del', 'ww-before', suggestion.before), element('span', 'ww-diff-label', '제안'), element('ins', 'ww-after', suggestion.after || '(삭제)'));
        for (const sourceId of suggestion.sourceIds) { const source = review.sources.find(s => s.id === sourceId); if (source) this.source(card, source); }
        const decisionControls = element('div', 'ww-decision-controls');
        if (suggestion.status === 'pending') {
          const accept = this.button('수락', () => ws.decide(review.id, suggestion.id, 'accepted'), 'ww-accept');
          accept.disabled = ws.busy || review.expected !== ws.project.draft;
          if (review.expected !== ws.project.draft) accept.title = '원고가 바뀌어 다시 검토해야 합니다';
          decisionControls.append(accept, this.button('거절', () => ws.decide(review.id, suggestion.id, 'rejected')));
        } else {
          decisionControls.append(element('span', 'ww-badge', suggestion.status === 'accepted' ? '수락함' : '거절함'));
          if (suggestion.status === 'accepted') decisionControls.append(this.button('수락 취소', () => ws.undoAcceptance(review.id, suggestion.id), 'ww-undo'));
        }
        card.append(decisionControls);
        panel.append(card);
      }
      if (review.sources.length) { panel.append(element('h3', '', '참고 출처')); for (const source of review.sources) this.source(panel, source); }
    }
    this.composer(panel, true);
  }
  private source(parent: HTMLElement, source: Review['sources'][number]): void {
    const container = element('div', 'ww-source');
    const url = safeSourceUrl(source.url);
    if (url) { const link = element('a', '', source.title || url); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; container.append(link); }
    else container.append(element('span', '', source.title || '출처 URL 확인 필요'));
    container.append(element('span', 'ww-badge', { supports: '뒷받침 자료', contradicts: '반대 근거', unverified: '미확인' }[source.relation]), markdown(source.excerpt, 'ww-hint')); parent.append(container);
  }
  private selectQuote(quote: string): void {
    const index = this.workspace.project.draft.indexOf(quote);
    if (index < 0) { this.showError(new Error('현재 원고에서 해당 구절을 찾을 수 없습니다.')); return; }
    this.mode = 'draft'; this.render(); this.draft?.focus(); this.draft?.setSelectionRange(index, index + quote.length);
  }
  private renderHistory(panel: HTMLElement): void {
    panel.append(element('p', 'ww-hint', '이전 원고를 복원해도 현재 내용은 이력에 남습니다. 복원 후 파일 저장 여부를 선택하세요.'));
    for (const revision of [...this.workspace.project.revisions].reverse()) {
      const item = element('details', 'ww-revision'); item.dataset.wwDetail = `revision-${revision.id}`; item.append(element('summary', '', `${revision.label} · ${time(revision.createdAt)}`));
      item.append(markdown(revision.text || '(빈 원고)', 'ww-revision-content'), this.button('작업 원고로 복원', () => this.workspace.restoreRevision(revision.id))); panel.append(item);
    }
    const decisions = this.workspace.project.reviews.flatMap(r => {
      const logged = new Set(r.decisions.map(event => event.suggestionId));
      const legacy = r.suggestions.filter(s => s.status !== 'pending' && !logged.has(s.id)).map(s => ({ ...s, label: s.status === 'accepted' ? '수락' : '거절', eventId: s.id, provider: r.provider }));
      const events = r.decisions.flatMap((event, index) => {
        const proposal = r.suggestions.find(s => s.id === event.suggestionId);
        return proposal ? [{ ...proposal, label: { accepted: '수락', rejected: '거절', 'accept-undone': '수락 취소' }[event.action], eventId: `${r.id}-${index}`, provider: r.provider }] : [];
      });
      return [...legacy, ...events];
    });
    if (decisions.length) panel.append(element('h3', '', '수정 결정 기록'));
    for (const decision of decisions) { const item = element('details', 'ww-revision'); item.dataset.wwDetail = `decision-${decision.eventId}`; item.append(element('summary', '', `${decision.label} · ${providerName(decision.provider)}`), markdown(decision.reason), element('del', 'ww-before', decision.before), element('ins', 'ww-after', decision.after)); panel.append(item); }
  }
}
