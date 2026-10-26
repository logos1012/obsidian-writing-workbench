import type { Workspace } from '../domain/workspace';
import { memoKeys, safeSourceUrl, type Provider, type Review } from '../domain/model';

export interface Actions { newProject(): void; openProject(): void; addMaterial(): void; settings(): void; recoverProject?(): void }
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
  constructor(private host: HTMLElement, private workspace: Workspace, private actions: Actions) {
    this.input = workspace.project.composer;
    workspace.onChange = () => this.render(); this.render();
  }
  destroy(): void { this.workspace.onChange = () => undefined; this.host.replaceChildren(); }
  private button(text: string, callback: () => void | Promise<void>, className = ''): HTMLButtonElement {
    const button = element('button', className, text); button.type = 'button';
    button.disabled = this.workspace.busy;
    button.addEventListener('click', () => {
      try { Promise.resolve(callback()).catch(error => this.showError(error)); } catch (error) { this.showError(error); }
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
    this.host.replaceChildren(); this.host.classList.add('ww-root');
    const toolbar = element('header', 'ww-toolbar');
    const title = element('div', 'ww-title'); title.append(element('strong', '', p.path.split('/').at(-1)?.replace(/\.md$/, '') || '새 글'), element('span', 'ww-subtle', 'LinkedIn 글쓰기'));
    const controls = element('div', 'ww-controls');
    const provider = element('select'); provider.setAttribute('aria-label', 'AI 선택'); provider.disabled = ws.busy;
    for (const value of ['claude', 'codex'] as const) { const option = element('option', '', providerName(value)); option.value = value; option.selected = p.provider === value; provider.append(option); }
    provider.addEventListener('change', () => { void ws.chooseProvider(provider.value as Provider).catch(error => this.showError(error)); });
    controls.append(provider, this.button('새 글', this.actions.newProject), this.button('글 열기', this.actions.openProject), this.button('설정', this.actions.settings), this.button('원고 저장', () => ws.saveDocument(), 'mod-cta'));
    if (this.actions.recoverProject) controls.insertBefore(this.button('작업 기록', this.actions.recoverProject), controls.lastChild);
    toolbar.append(title, controls); this.host.append(toolbar);
    const statusbar = element('div', 'ww-statusbar');
    this.status = element('span', 'ww-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite'); this.refreshStatus(); statusbar.append(this.status);
    if (ws.busy) { const cancel = this.button('중지', () => ws.cancel()); cancel.disabled = false; statusbar.append(cancel); }
    else statusbar.append(this.button('파일에서 다시 불러오기', () => ws.reloadDocument(), 'ww-text-button'));
    this.host.append(statusbar);
    const columns = element('div', 'ww-columns');
    columns.append(this.renderMemo(), this.renderDraft(), this.renderSide()); this.host.append(columns);
  }
  private renderMemo(): HTMLElement {
    const ws = this.workspace;
    const panel = element('section', 'ww-memo ww-panel'); panel.setAttribute('aria-label', '글의 방향과 자료');
    panel.append(element('h3', '', '글의 방향'), element('p', 'ww-hint', '인터뷰에서 정리한 생각을 직접 고칠 수 있어요.'));
    for (const key of memoKeys) {
      const label = element('label', 'ww-field'); label.append(element('span', 'ww-field-label', key));
      const area = element('textarea', 'ww-memo-input'); area.rows = key === '개요' ? 5 : 3;
      area.value = ws.project.memo.find(m => m.key === key)?.text ?? ''; area.disabled = ws.busy;
      area.placeholder = key === '관점' ? '이 글에서 하고 싶은 말' : '인터뷰를 하거나 직접 적어 주세요';
      area.addEventListener('input', () => {
        const memo = ws.project.memo.map(m => m.key === key ? { ...m, text: area.value } : m);
        void ws.edit({ memo }).then(() => this.refreshStatus()).catch(error => this.showError(error));
      }); label.append(area); panel.append(label);
    }
    const material = element('details', 'ww-materials'); material.append(element('summary', '', '참고 자료'));
    material.append(this.button('볼트의 노트 추가', this.actions.addMaterial));
    const area = element('textarea'); area.setAttribute('aria-label', '참고 자료'); area.rows = 7; area.disabled = ws.busy;
    area.placeholder = '참고할 글, 데이터, URL과 요청을 적어 주세요. URL 내용 확인은 외부 자료 검색을 켜고 요청하세요.';
    area.value = ws.project.materials; area.addEventListener('input', () => { void ws.edit({ materials: area.value }).then(() => this.refreshStatus()).catch(error => this.showError(error)); });
    material.append(area); panel.append(material);
    const principles = element('section', 'ww-principles'); principles.append(element('h3', '', '내 문체 원칙'));
    const preferences = ws.preferences.items.filter(p => p.status !== 'dismissed');
    if (!preferences.length) principles.append(element('p', 'ww-hint', 'AI가 발견한 취향은 확인 후 저장합니다.'));
    for (const pref of preferences) {
      const box = element('div', 'ww-preference'); box.append(element('span', 'ww-badge', pref.status === 'approved' ? '적용 중' : '확인 필요'));
      const text = element('textarea'); text.setAttribute('aria-label', '문체 원칙 수정'); text.rows = 3; text.value = pref.text; text.disabled = ws.busy; box.append(text);
      box.append(element('p', 'ww-hint', pref.reason));
      box.append(this.button(pref.status === 'approved' ? '변경 저장' : '원칙으로 저장', () => ws.preference(pref.id, 'approved', text.value)), this.button(pref.status === 'approved' ? '적용 해제' : '저장 안 함', () => ws.preference(pref.id, 'dismissed')));
      principles.append(box);
    }
    panel.append(principles); return panel;
  }
  private renderDraft(): HTMLElement {
    const ws = this.workspace;
    const panel = element('section', 'ww-writing ww-panel'); panel.setAttribute('aria-label', '원고');
    const tabs = element('div', 'ww-tabs');
    for (const [value, label] of [['draft', '원고'], ['preview', '미리보기']] as const) {
      const button = this.button(label, () => { this.mode = value; this.render(); }, this.mode === value ? 'is-active' : ''); button.setAttribute('aria-pressed', String(this.mode === value)); tabs.append(button);
    }
    const count = element('span', 'ww-count', `${Array.from(ws.project.draft).length.toLocaleString()}자`); tabs.append(count); panel.append(tabs);
    if (this.mode === 'draft') {
      const hint = element('p', 'ww-hint', '초안은 직접 써 주세요. AI 제안은 수락할 때만 작업 원고에 반영됩니다.'); panel.append(hint);
      this.draft = element('textarea', 'ww-draft'); this.draft.setAttribute('aria-label', '원고 작성'); this.draft.spellcheck = false;
      this.draft.placeholder = '첫 문장을 적어 보세요.\n\n아직 주제가 없다면 오른쪽에서 인터뷰를 시작해도 좋아요.';
      this.draft.value = ws.project.draft; this.draft.disabled = ws.busy;
      this.draft.addEventListener('input', () => {
        const value = this.draft?.value ?? ''; count.textContent = `${Array.from(value).length.toLocaleString()}자`;
        void ws.edit({ draft: value }).then(() => this.refreshStatus()).catch(error => this.showError(error));
      }); panel.append(this.draft);
    } else {
      const controls = element('div', 'ww-preview-controls');
      controls.append(this.button('데스크톱', () => { this.mobile = false; this.render(); }, !this.mobile ? 'is-active' : ''), this.button('모바일', () => { this.mobile = true; this.render(); }, this.mobile ? 'is-active' : ''));
      panel.append(controls, element('p', 'ww-hint', '줄바꿈과 읽기 흐름을 확인하는 예상 화면입니다. 실제 피드의 접힘 위치와는 다를 수 있어요.'));
      const preview = element('article', `ww-preview ${this.mobile ? 'is-mobile' : ''}`);
      const header = element('div', 'ww-preview-author'); header.append(element('div', 'ww-avatar', '나'), element('div', '', '내 LinkedIn 글\n전체 공개'));
      preview.append(header, element('div', 'ww-preview-body', ws.project.draft || '원고를 작성하면 여기에 표시됩니다.'));
      panel.append(preview);
      panel.append(this.button('원고 복사', async () => { await navigator.clipboard.writeText(ws.project.draft); ws.status = '원고를 복사했습니다'; this.refreshStatus(); }));
    }
    return panel;
  }
  private renderSide(): HTMLElement {
    const panel = element('section', 'ww-side ww-panel'); panel.setAttribute('aria-label', 'AI와 작업');
    const tabs = element('div', 'ww-tabs');
    for (const [value, label] of [['interview', '인터뷰'], ['review', '검토'], ['history', '이력']] as const) {
      const button = this.button(label, () => { this.tab = value; this.render(); }, this.tab === value ? 'is-active' : ''); button.setAttribute('aria-pressed', String(this.tab === value)); tabs.append(button);
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
    input.setAttribute('aria-label', review ? '검토 요청' : '인터뷰 답변');
    input.placeholder = review ? '특히 확인하고 싶은 주장이나 표현을 알려 주세요.' : '경험이나 생각을 편하게 적어 주세요.';
    input.addEventListener('input', () => {
      this.input = input.value;
      void ws.edit({ composer: this.input }).then(() => this.refreshStatus()).catch(error => this.showError(error));
    }); form.append(input);
    const label = element('label', 'ww-research'); const check = element('input'); check.type = 'checkbox'; check.checked = this.research; check.disabled = ws.busy;
    check.addEventListener('change', () => { this.research = check.checked; }); label.append(check, document.createTextNode('이번 요청에 외부 자료 검색 허용')); form.append(label);
    const submit = this.button(review ? '전체 진단과 수정 제안 받기' : '답변 보내기', async () => {
      const request = this.input.trim() || (review ? '현재 초안을 전체 진단하고 문장별 개선과 근거 확인이 필요한 부분을 제안해 주세요.' : '내 경험에서 LinkedIn 글감을 찾을 수 있도록 첫 질문 하나를 해 주세요.');
      await ws.run(review ? 'review' : 'interview', request, this.research); this.input = ''; await ws.edit({ composer: '' }); this.research = false; this.reviewId = ''; this.render();
    }, 'mod-cta'); form.append(submit);
    form.addEventListener('submit', event => { event.preventDefault(); submit.click(); });
    input.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit.click(); } });
    panel.append(form);
  }
  private renderInterview(panel: HTMLElement): void {
    const messages = this.workspace.project.messages;
    if (!messages.length) {
      const empty = element('div', 'ww-empty'); empty.append(element('h3', '', '어떤 경험을 글로 남길까요?'), element('p', '', '한 번에 하나씩 묻고, 답변에서 주제와 관점을 함께 찾습니다. 초안은 직접 쓰게 됩니다.'));
      panel.append(empty);
    }
    const conversation = element('div', 'ww-conversation');
    for (const msg of messages) {
      const item = element('article', `ww-message is-${msg.role}`);
      item.append(element('div', 'ww-message-meta', `${msg.role === 'user' ? '나' : providerName(msg.provider)} · ${time(msg.createdAt)}`), element('p', '', msg.text)); conversation.append(item);
    }
    panel.append(conversation); this.composer(panel, false);
    if (messages.length) panel.append(this.button('지금까지 개요로 정리', async () => {
      await this.workspace.run('outline', '지금까지의 대화로 글의 주제·관점·개요를 정리해 주세요. 초안은 제가 직접 쓰겠습니다.', false);
    }, 'ww-outline-button'));
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
      panel.append(element('h3', '', '전체 진단'), element('p', 'ww-review-summary', review.message));
      for (const finding of review.diagnosis) {
        const item = element('div', `ww-finding is-${finding.severity}`);
        item.append(element('strong', '', `${finding.criterion} · ${{ strength: '강점', improve: '다듬기', verify: '확인 필요' }[finding.severity]}`), element('p', '', finding.detail));
        if (finding.quote) item.append(this.button('해당 문장 보기', () => this.selectQuote(finding.quote), 'ww-text-button'));
        panel.append(item);
      }
      panel.append(element('h3', '', '문장별 제안'));
      if (!review.suggestions.length) panel.append(element('p', 'ww-hint', '이번 검토에는 문장 수정 제안이 없습니다.'));
      for (const suggestion of review.suggestions) {
        const card = element('article', 'ww-suggestion'); card.append(element('p', 'ww-reason', suggestion.reason));
        card.append(element('span', 'ww-diff-label', '원문'), element('del', 'ww-before', suggestion.before), element('span', 'ww-diff-label', '제안'), element('ins', 'ww-after', suggestion.after || '(삭제)'));
        for (const sourceId of suggestion.sourceIds) { const source = review.sources.find(s => s.id === sourceId); if (source) this.source(card, source); }
        if (suggestion.status === 'pending') {
          const accept = this.button('수락', () => ws.decide(review.id, suggestion.id, 'accepted'), 'ww-accept');
          accept.disabled = ws.busy || review.expected !== ws.project.draft;
          if (review.expected !== ws.project.draft) accept.title = '원고가 바뀌어 다시 검토해야 합니다';
          card.append(accept, this.button('거절', () => ws.decide(review.id, suggestion.id, 'rejected')));
        } else card.append(element('span', 'ww-badge', suggestion.status === 'accepted' ? '수락함' : '거절함'));
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
    container.append(element('span', 'ww-badge', { supports: '뒷받침 자료', contradicts: '반대 근거', unverified: '미확인' }[source.relation]), element('p', 'ww-hint', source.excerpt)); parent.append(container);
  }
  private selectQuote(quote: string): void {
    const index = this.workspace.project.draft.indexOf(quote);
    if (index < 0) { this.showError(new Error('현재 원고에서 해당 구절을 찾을 수 없습니다.')); return; }
    this.mode = 'draft'; this.render(); this.draft?.focus(); this.draft?.setSelectionRange(index, index + quote.length);
  }
  private renderHistory(panel: HTMLElement): void {
    panel.append(element('p', 'ww-hint', '이전 원고를 복원해도 현재 내용은 이력에 남습니다. 복원 후 파일 저장 여부를 선택하세요.'));
    for (const revision of [...this.workspace.project.revisions].reverse()) {
      const item = element('details', 'ww-revision'); item.append(element('summary', '', `${revision.label} · ${time(revision.createdAt)}`));
      item.append(element('pre', '', revision.text || '(빈 원고)'), this.button('작업 원고로 복원', () => this.workspace.restoreRevision(revision.id))); panel.append(item);
    }
    const decisions = this.workspace.project.reviews.flatMap(r => r.suggestions.filter(s => s.status !== 'pending').map(s => ({ ...s, provider: r.provider })));
    if (decisions.length) panel.append(element('h3', '', '수정 결정 기록'));
    for (const decision of decisions) { const item = element('details', 'ww-revision'); item.append(element('summary', '', `${decision.status === 'accepted' ? '수락' : '거절'} · ${providerName(decision.provider)}`), element('p', '', decision.reason), element('del', 'ww-before', decision.before), element('ins', 'ww-after', decision.after)); panel.append(item); }
  }
}
