// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { harness, reply } from './helpers';
import { suggestionLocation } from '../src/ui/suggestion-location';
import { EditorHighlight } from '../src/ui/draft-highlight';
import { WorkbenchUI } from '../src/ui/workbench';
import { outline } from '../src/ui/outline';

const live: WorkbenchUI[] = [];
function mount(h = harness()) {
  const host = document.createElement('div'); document.body.append(host);
  const ui = new WorkbenchUI(host, h.ws, { newProject() {}, openProject() {}, addMaterial() {}, settings() {} }); live.push(ui);
  const click = (text: string) => { const b = [...host.querySelectorAll('button')].find(b => b.textContent === text)!; b.focus(); b.click(); };
  click('검토');
  return { ...h, host, click, ui };
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
afterEach(() => { live.splice(0).forEach(ui => ui.destroy()); vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren(); });

describe('suggestion locations', () => {
  it('tracks accepted offsets and identical replacement text using original positions', async () => {
    const h = harness('첫 문단 😀\n\n효율이 좋아졌다.\n\n내 경험이다.');
    h.agent.run = async () => ({ ...reply, suggestions: [{ ...reply.suggestions[0]!, after: '같은 문장.' }, { before: '내 경험이다.', after: '같은 문장.', reason: '구체화', sourceIds: [] }] });
    await h.ws.run('review', '검토', false); const r = h.ws.project.reviews[0]!;
    expect(suggestionLocation(h.ws.project.draft, r, r.suggestions[1]!.id)).toMatchObject({ paragraph: 3, line: 5 });
    for (const s of r.suggestions) await h.ws.decide(r.id, s.id, 'accepted');
    const first = suggestionLocation(h.ws.project.draft, r, r.suggestions[0]!.id)!;
    const last = suggestionLocation(h.ws.project.draft, r, r.suggestions[1]!.id)!;
    expect(first.start).toBe(h.ws.project.draft.indexOf('같은 문장.'));
    expect(last.start).toBe(h.ws.project.draft.lastIndexOf('같은 문장.'));
    expect(h.ws.project.draft.slice(last.start, last.end)).toBe('같은 문장.');
    await h.ws.undoAcceptance(r.id, r.suggestions[0]!.id);
    expect(suggestionLocation(h.ws.project.draft, r, r.suggestions[1]!.id)?.start).toBe(h.ws.project.draft.indexOf('같은 문장.'));
  });
  it('returns a deletion point and refuses stale or inconsistent reviews', async () => {
    const h = harness(); h.agent.run = async () => ({ ...reply, suggestions: [{ ...reply.suggestions[0]!, after: '' }] });
    await h.ws.run('review', '검토', false); const r = h.ws.project.reviews[0]!, s = r.suggestions[0]!;
    await h.ws.decide(r.id, s.id, 'accepted');
    expect(suggestionLocation(h.ws.project.draft, r, s.id)).toMatchObject({ start: 0, end: 0 });
    expect(suggestionLocation('다른 원고', r, s.id)).toBeNull();
    r.expected = '다른 원고'; expect(suggestionLocation('다른 원고', r, s.id)).toBeNull();
  });
});

describe('linked review interface', () => {
  it('highlights on hover without stealing editor focus, selection, or changing content, then clears on editing', async () => {
    vi.useFakeTimers(); const h = harness(); await h.ws.run('review', '검토', false); const { host } = mount(h);
    const editor = host.querySelector<HTMLTextAreaElement>('.ww-draft')!; editor.focus(); editor.setSelectionRange(2, 4);
    host.querySelector('.ww-suggestion')!.dispatchEvent(new Event('pointerenter')); vi.advanceTimersByTime(320);
    expect(host.querySelector('.ww-draft-highlight.is-active mark')?.textContent).toBe('효율이 좋아졌다.');
    expect(host.querySelector('.ww-suggestion-location')?.textContent).toBe('원고 1문단 · 1행');
    expect(document.activeElement).toBe(editor); expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 4]);
    expect(h.ws.project.draft).toBe(editor.value); expect(h.getDocument()).toBe(editor.value);
    editor.value = '직접 수정'; editor.dispatchEvent(new Event('input')); await settle();
    expect(host.querySelector('.ww-draft-highlight.is-active')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('.ww-suggestion-location')?.disabled).toBe(true);
  });
  it('keeps the clicked suggestion linked through acceptance, rejection, and undo without resetting scroll', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.ws.run('review', '검토', false); const { host, click } = mount(h);
    // Chromium emits focusout as focused controls are removed during redraw.
    const replace = host.replaceChildren.bind(host);
    vi.spyOn(host, 'replaceChildren').mockImplementation((...nodes) => {
      const focused = document.activeElement;
      if (focused && host.contains(focused)) focused.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
      replace(...nodes);
    });
    host.querySelector<HTMLElement>('.ww-suggestion')!.focus();
    host.querySelector<HTMLElement>('.ww-side')!.scrollTop = 700;
    click('수락'); await settle(); vi.advanceTimersByTime(300);
    expect(host.querySelector('.ww-draft-highlight.is-active mark')?.textContent).toBe('반복 작업 시간이 줄었다.');
    expect(host.querySelector('.ww-side')?.scrollTop).toBe(700);
    click('수락 취소'); await settle(); vi.advanceTimersByTime(300); expect(host.querySelector('.ww-draft-highlight.is-active mark')?.textContent).toBe('효율이 좋아졌다.');
    click('거절'); await settle(); vi.advanceTimersByTime(300); expect(host.querySelector('.ww-draft-highlight.is-active mark')?.textContent).toBe('효율이 좋아졌다.');
  });
  it('supports preview and keyboard focus, and clears when leaving the review tab', async () => {
    const h = harness(); await h.ws.run('review', '검토', false); const { host, click } = mount(h);
    click('미리보기'); host.querySelector<HTMLElement>('.ww-suggestion')!.focus();
    expect(host.querySelector('.ww-linkedin-body mark')?.textContent).toBe('효율이 좋아졌다.');
    expect(host.querySelector('.ww-linkedin-body')?.textContent).toBe(h.ws.project.draft);
    host.querySelector('.ww-suggestion')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.querySelector('.ww-linkedin-body mark')?.textContent).toBe('');
    click('이력'); expect(host.querySelector('.ww-linkedin-body mark')?.textContent).toBe('');
  });
  it('does not flash when quickly crossing a card and clears pending timers when closed', async () => {
    vi.useFakeTimers(); const h = harness(); await h.ws.run('review', '검토', false); const { host, ui } = mount(h);
    const card = host.querySelector('.ww-suggestion')!;
    card.dispatchEvent(new Event('pointerenter')); card.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(150);
    expect(host.querySelector('.ww-draft-highlight.is-active')).toBeNull();
    card.dispatchEvent(new Event('pointerenter')); ui.destroy(); vi.advanceTimersByTime(150);
    expect(host.children).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('native editor highlight scrolling', () => {
  it('scrolls only the editor to an offscreen match and respects reduced motion', () => {
    const frame = document.createElement('div'), editor = document.createElement('textarea'); frame.append(editor); document.body.append(frame);
    editor.value = '앞 문장\n대상 문장'; editor.scrollTo = vi.fn();
    Object.defineProperties(editor, { clientHeight: { value: 300 }, clientWidth: { value: 360 }, scrollHeight: { value: 1500 } });
    const highlight = new EditorHighlight(editor, frame);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) { return this.tagName === 'MARK' ? { top: 900, bottom: 930, height: 30 } as DOMRect : { top: 100, bottom: 400, height: 300 } as DOMRect; });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) });
    highlight.show({ start: 5, end: 10, paragraph: 1, line: 2 }, true);
    expect(editor.scrollTo).toHaveBeenCalledWith({ top: 665, behavior: 'smooth' });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true })) });
    highlight.show({ start: 5, end: 10, paragraph: 1, line: 2 }, true);
    expect(editor.scrollTo).toHaveBeenLastCalledWith({ top: 665, behavior: 'auto' });
    highlight.destroy();
  });
});

describe('structured outline', () => {
  it('structures older single-line numbered outlines without splitting decimal figures or changing the source', () => {
    const source = '1. 도입: 반복 업무 2. 전환: 2.5배라는 수치 확인 3. 결론: 다음 질문';
    const dom = outline(source);
    expect([...dom.querySelectorAll('.ww-outline-title')].map(n => n.textContent?.trim())).toEqual(['도입', '전환', '결론']);
    expect(dom.textContent).toContain('2.5배라는 수치 확인');
    expect(outline('예산 1.5배, 업무 2.5배').querySelector('.ww-outline-list')).toBeNull();
  });
  it('separates titles and descriptions and preserves nested supporting points and emphasis', () => {
    const dom = outline('1. **도입**: 직접 겪은 장면\n   - 먼저 **문제**를 제시\n   - 바뀐 질문\n2. 전개: 경험에서 찾은 이유\n3. **마무리**\n   - 독자에게 질문');
    expect([...dom.querySelectorAll('.ww-outline-title')].map(n => n.textContent?.trim())).toEqual(['도입', '전개', '마무리']);
    expect(dom.querySelector('.ww-outline-detail')?.textContent?.trim()).toBe('직접 겪은 장면');
    expect(dom.querySelector('.ww-outline-step ul strong')?.textContent).toBe('문제');
    expect(dom.querySelectorAll('.ww-outline-step > ul')).toHaveLength(2);
  });
  it('handles separate title lines, plain prose, and headings without injecting HTML or breaking links', () => {
    const dom = outline('1. 도입\n   설명입니다.\n2. [자료](https://example.com): 출처 내용\n\n<script>alert(1)</script>');
    expect(dom.querySelectorAll('.ww-outline-title')).toHaveLength(2);
    expect(dom.textContent).toContain('설명입니다.'); expect(dom.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(dom.querySelector('script')).toBeNull();
    expect(outline('## 도입\n\n내용\n\n### 근거\n\n- 하나').querySelectorAll('h2,h3')).toHaveLength(2);
    expect(outline('아직 한 문장인 개요').textContent?.trim()).toBe('아직 한 문장인 개요');
  });
  it('keeps the original outline text intact when opening double-click editing', () => {
    const h = harness(); const text = '1. **도입**: 경험\n2. 전개: 이유'; h.ws.project.memo.find(m => m.key === '개요')!.text = text;
    const { host } = mount(h); host.querySelector('.ww-outline')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="개요 편집"]')?.value).toBe(text);
    expect(h.ws.project.memo.find(m => m.key === '개요')?.text).toBe(text);
  });
});
