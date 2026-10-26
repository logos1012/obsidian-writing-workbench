// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchUI, type Actions } from '../src/ui/workbench';
import { markdown } from '../src/ui/markdown';
import { ColumnResizer, defaultWidths, LayoutSchema, resizePair, type ColumnWidths } from '../src/ui/layout';
import { ViewState } from '../src/ui/view-state';
import { harness, reply } from './helpers';
import type { AgentRequest } from '../src/providers/cli';

const actions: Actions = { newProject() {}, openProject() {}, addMaterial() {}, settings() {} };
const alive: WorkbenchUI[] = [];
function mount(h = harness(), overrides: Partial<Actions> = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const ui = new WorkbenchUI(host, h.ws, { ...actions, ...overrides }); alive.push(ui);
  return { ...h, host, ui };
}
function click(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  button.click();
}
async function settled() { for (let index = 0; index < 25; index++) await Promise.resolve(); }
afterEach(() => { alive.splice(0).forEach(ui => ui.destroy()); vi.useRealTimers(); document.body.replaceChildren(); });

describe('reading position', () => {
  it.each(['수락', '거절'])('keeps all panel and editor positions after %s', async decision => {
    const h = harness(); await h.ws.run('review', '검토', false);
    const { host } = mount(h); click(host, '검토');
    const side = host.querySelector<HTMLElement>('.ww-side')!, memo = host.querySelector<HTMLElement>('.ww-memo')!, editor = host.querySelector<HTMLTextAreaElement>('.ww-draft')!;
    side.scrollTop = 920; memo.scrollTop = 260; editor.scrollTop = 170;
    click(host, decision); await settled();
    expect(h.ws.busy).toBe(false);
    expect(h.ws.project.reviews[0]?.suggestions[0]?.status).toBe(decision === '수락' ? 'accepted' : 'rejected');
    expect(host.querySelector('.ww-side')?.scrollTop).toBe(920);
    expect(host.querySelector('.ww-memo')?.scrollTop).toBe(260);
    expect(host.querySelector('.ww-draft')?.scrollTop).toBe(170);
  });
  it('keeps the clicked card in place when content above it grows', () => {
    const host = document.createElement('div'); host.dataset.wwScroll = 'root'; document.body.append(host);
    const panel = document.createElement('section'); panel.dataset.wwScroll = 'review'; host.append(panel);
    const card = document.createElement('article'); card.dataset.wwAnchor = 'proposal'; panel.append(card);
    panel.scrollTop = 600;
    Object.defineProperties(panel, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } });
    panel.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    let documentTop = 760;
    card.getBoundingClientRect = () => ({ top: 100 + documentTop - panel.scrollTop } as DOMRect);
    const state = new ViewState(); state.capture(host, 'proposal');
    documentTop += 65; panel.scrollTop = 0; state.restore(host);
    expect(panel.scrollTop).toBe(665);
    expect(card.getBoundingClientRect().top).toBe(260);
  });
  it('remembers separate tab positions and expanded history/materials', async () => {
    const { host, ws } = mount();
    host.querySelector<HTMLElement>('.ww-side')!.scrollTop = 120;
    const material = host.querySelector<HTMLDetailsElement>('.ww-materials')!; material.open = true;
    click(host, '이력'); host.querySelector<HTMLElement>('.ww-side')!.scrollTop = 360;
    host.querySelector<HTMLDetailsElement>('.ww-revision')!.open = true;
    await ws.chooseProvider('codex');
    expect(host.querySelector<HTMLDetailsElement>('.ww-revision')?.open).toBe(true);
    expect(host.querySelector<HTMLDetailsElement>('.ww-materials')?.open).toBe(true);
    click(host, '인터뷰'); expect(host.querySelector('.ww-side')?.scrollTop).toBe(120);
    click(host, '이력'); expect(host.querySelector('.ww-side')?.scrollTop).toBe(360);
  });
});

describe('formatted prose and explicit editing', () => {
  it('renders headings, emphasis, bullets, code, quotes and tables', () => {
    const dom = markdown('## 핵심\n\n**굵게**와 `코드`\n\n- 근거\n- 반론\n\n> 인용\n\n| 주장 | 근거 |\n| --- | --- |\n| A | B |');
    expect(dom.querySelector('h2')?.textContent).toBe('핵심');
    expect(dom.querySelector('strong')?.textContent).toBe('굵게');
    expect(dom.querySelectorAll('li')).toHaveLength(2);
    expect(dom.querySelector('blockquote')).not.toBeNull(); expect(dom.querySelector('table')).not.toBeNull(); expect(dom.querySelector('code')).not.toBeNull();
  });
  it('does not execute HTML, load images, or link dangerous protocols', () => {
    const dom = markdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![tracking](https://example.com/pixel)\n\n[bad](javascript:alert(1)) [file](file:///etc/passwd) [app](obsidian://open)\n\n[good](https://example.com/report)');
    expect(dom.querySelectorAll('script,img,iframe')).toHaveLength(0);
    expect([...dom.querySelectorAll('a')].map(a => a.href)).toEqual(['https://example.com/pixel', 'https://example.com/report']);
    expect(dom.querySelector('a')?.rel).toContain('noopener');
  });
  it('formats interview, review, and history while keeping exact diff text', async () => {
    const h = harness(); h.agent.run = async () => ({ ...reply, message: '**요점**\n\n- 하나\n- 둘', suggestions: [{ ...reply.suggestions[0]!, reason: '**근거 보강**이 필요합니다.' }] });
    await h.ws.run('review', '검토', false);
    const { host } = mount(h);
    expect(host.querySelector('.ww-message strong')?.textContent).toBe('요점');
    click(host, '검토'); expect(host.querySelector('.ww-review-summary strong')?.textContent).toBe('요점');
    expect(host.querySelector('.ww-reason strong')?.textContent).toBe('근거 보강');
    expect(host.querySelector('.ww-before')?.textContent).toBe('효율이 좋아졌다.');
    click(host, '거절'); await settled(); click(host, '이력');
    expect(host.querySelector('.ww-revision .ww-markdown strong')?.textContent).toBe('근거 보강');
  });
  it('shows readable memo by default, saves only on explicit save, and supports cancel', async () => {
    const h = harness(); h.ws.project.memo[0]!.text = '**나의 관점**입니다.';
    const { host } = mount(h);
    expect(host.querySelector('.ww-memo-content strong')?.textContent).toBe('나의 관점');
    expect(host.querySelector('.ww-memo-input')).toBeNull();
    host.querySelector<HTMLButtonElement>('[aria-label="관점 수정"]')!.click();
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="관점 편집"]')!;
    input.value = '바꾼 관점'; input.dispatchEvent(new Event('input'));
    expect(h.ws.project.memo[0]?.text).toBe('**나의 관점**입니다.');
    click(host, '취소'); expect(host.querySelector('.ww-memo-content strong')?.textContent).toBe('나의 관점');
    host.querySelector<HTMLButtonElement>('[aria-label="관점 수정"]')!.click();
    const next = host.querySelector<HTMLTextAreaElement>('[aria-label="관점 편집"]')!; next.value = '저장할 관점'; next.dispatchEvent(new Event('input'));
    click(host, '저장'); await settled();
    expect(h.projectStore.value?.memo[0]?.text).toBe('저장할 관점'); expect(host.querySelector('.ww-memo-input')).toBeNull();
  });
});

describe('column widths', () => {
  it('changes only adjacent columns and clamps at readable minimum sizes', () => {
    const source: ColumnWidths = [300, 480, 420];
    const resized = resizePair(source, 0, 100);
    expect(resized[0]).toBeCloseTo(100 * 400 / 1200); expect(resized[2]).toBe(35);
    const clamped = resizePair(source, 1, 5000);
    expect(clamped[2]).toBeCloseTo(100 * 280 / 1200);
    expect(clamped.reduce((sum, n) => sum + n, 0)).toBeCloseTo(100);
    expect(LayoutSchema.safeParse({ version: 1, widths: [100, -5, 5] }).success).toBe(false);
  });
  it('supports keyboard resizing, remembers the layout after rerender, and resets', async () => {
    const save = vi.fn(async (_: ColumnWidths) => undefined);
    const { host, ws } = mount(harness(), { saveColumnWidths: save });
    const divider = host.querySelector<HTMLElement>('[role="separator"]')!;
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const width = host.querySelector<HTMLElement>('.ww-columns')!.style.getPropertyValue('--ww-memo-width');
    expect(width).not.toBe('24fr'); expect(save).toHaveBeenCalledTimes(1);
    await ws.chooseProvider('codex');
    expect(host.querySelector<HTMLElement>('.ww-columns')!.style.getPropertyValue('--ww-memo-width')).toBe(width);
    host.querySelector<HTMLElement>('[role="separator"]')!.dispatchEvent(new MouseEvent('dblclick'));
    expect(save).toHaveBeenLastCalledWith(defaultWidths);
  });
  it('persists drag width only when dragging finishes and removes pointer listeners', () => {
    const grid = document.createElement('div'); document.body.append(grid);
    const changed = vi.fn(); const resize = new ColumnResizer(grid, [...defaultWidths], changed);
    const left = document.createElement('section'), middle = document.createElement('section'), right = document.createElement('section');
    [left, middle, right].forEach(panel => panel.className = 'ww-panel');
    const separator = resize.separator(0); grid.append(left, separator, middle, resize.separator(1), right);
    function pointer(type: string, x: number) { const event = new MouseEvent(type, { clientX: x, button: 0, bubbles: true }); Object.defineProperty(event, 'pointerId', { value: 1 }); return event; }
    separator.dispatchEvent(pointer('pointerdown', 100)); document.dispatchEvent(pointer('pointermove', 140));
    expect(changed).toHaveBeenLastCalledWith(expect.any(Array), false);
    document.dispatchEvent(pointer('pointerup', 140)); expect(changed).toHaveBeenLastCalledWith(expect.any(Array), true);
    const count = changed.mock.calls.length; document.dispatchEvent(pointer('pointermove', 200)); expect(changed).toHaveBeenCalledTimes(count);
    resize.destroy();
  });
});

describe('visible AI activity', () => {
  it('shows startup immediately, real process progress, elapsed time, and clears on completion', async () => {
    vi.useFakeTimers();
    const h = harness(); let request: AgentRequest | undefined, done!: (value: typeof reply) => void;
    h.agent.run = async value => { request = value; return new Promise(resolve => { done = resolve; }); };
    const { host } = mount(h);
    const running = h.ws.run('review', '검토', false);
    expect(host.querySelector('.ww-activity')?.textContent).toContain('연결을 준비');
    expect(host.querySelector('.ww-activity')?.textContent).toContain('Claude Code');
    await settled(); request!.onProgress?.('running');
    expect(host.querySelector('.ww-activity')?.textContent).toContain('실행 중');
    vi.advanceTimersByTime(12000); expect(host.querySelector('.ww-activity-elapsed')?.textContent).toBe('0:12 경과');
    request!.onProgress?.('processing'); expect(host.querySelector('.ww-activity')?.textContent).toContain('받은 결과');
    done(structuredClone(reply)); await running;
    expect(host.querySelector('.ww-activity')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels during startup without launching the CLI', async () => {
    const h = harness(); const execute = vi.spyOn(h.agent, 'run'); const { host } = mount(h);
    const work = h.ws.run('review', '검토', false);
    click(host, '요청 중지');
    expect(host.querySelector('.ww-activity')?.textContent).toContain('중지하고');
    await expect(work).rejects.toThrow('중지'); expect(execute).not.toHaveBeenCalled();
    expect(host.querySelector('.ww-activity')).toBeNull();
  });
  it('cleans the activity banner and timer when a provider fails', async () => {
    vi.useFakeTimers(); const h = harness(); h.agent.run = async () => { throw new Error('연결 실패'); };
    const { host } = mount(h); await expect(h.ws.run('review', '검토', false)).rejects.toThrow('연결 실패');
    expect(host.querySelector('.ww-activity')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    expect(host.querySelector('.ww-error')?.textContent).toBe('연결 실패');
  });
});
