// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { WorkbenchUI } from '../src/ui/workbench';
import { harness, reply } from './helpers';

const alive: WorkbenchUI[] = [];
function mount(h = harness()) {
  const host = document.createElement('div'); document.body.append(host);
  alive.push(new WorkbenchUI(host, h.ws, { newProject() {}, openProject() {}, addMaterial() {}, settings() {} }));
  return { ...h, host };
}
function click(host: HTMLElement, text: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  button.click();
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
afterEach(() => { alive.splice(0).forEach(ui => ui.destroy()); document.body.replaceChildren(); });

describe('follow-up interface feedback', () => {
  it('undoes acceptance from its card, keeps the scroll position, and displays both decisions in history', async () => {
    const h = harness(); await h.ws.run('review', '검토', false); const { host } = mount(h);
    click(host, '검토'); click(host, '수락'); await settle();
    host.querySelector<HTMLElement>('.ww-side')!.scrollTop = 830;
    click(host, '수락 취소'); await settle();
    expect(host.querySelector('.ww-side')?.scrollTop).toBe(830);
    expect(host.querySelector<HTMLTextAreaElement>('.ww-draft')?.value).toBe('효율이 좋아졌다. 내 경험이다.');
    expect([...host.querySelectorAll('button')].some(b => b.textContent === '수락')).toBe(true);
    click(host, '이력');
    const summaries = [...host.querySelectorAll('[data-ww-detail^="decision-"] summary')].map(s => s.textContent);
    expect(summaries).toEqual(['수락 · Claude Code', '수락 취소 · Claude Code']);
  });
  it('shows the undo conflict without changing a manually edited draft', async () => {
    const h = harness(); await h.ws.run('review', '검토', false); const { host } = mount(h);
    click(host, '검토'); click(host, '수락'); await settle();
    await h.ws.edit({ draft: '직접 수정한 원고' });
    click(host, '수락 취소'); await settle();
    expect(host.querySelector('.ww-error')?.textContent).toContain('따로 수정');
    expect(h.ws.project.draft).toBe('직접 수정한 원고');
  });
  it('edits memo on double click or Enter without repeated edit buttons, and supports cancel/save keys', async () => {
    const { host, ws } = mount();
    expect([...host.querySelectorAll('button')].some(b => b.textContent === '수정')).toBe(false);
    const reader = () => host.querySelector<HTMLElement>('.ww-memo-reader')!;
    reader().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    let input = host.querySelector<HTMLTextAreaElement>('.ww-memo-input')!;
    expect(document.activeElement).toBe(input);
    input.value = '취소할 내용'; input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }));
    expect(host.querySelector('.ww-memo-input')).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.querySelector('.ww-memo-input')).toBeNull(); expect(ws.project.memo[0]?.text).toBe('');
    reader().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    input = host.querySelector<HTMLTextAreaElement>('.ww-memo-input')!;
    input.value = '새 관점'; input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true })); await settle();
    expect(ws.project.memo[0]?.text).toBe('새 관점'); expect(host.querySelector('.ww-memo-input')).toBeNull();
  });
  it('separates the latest question from the AI summary and folds earlier exchanges without losing them', async () => {
    const h = harness(); h.agent.run = async () => ({ ...reply, message: '**내 경험의 요점**\n\n- 변화\n- 근거', question: '무엇이 달라졌나요?\n', suggestions: [] });
    await h.ws.run('interview', '첫 경험', false); await h.ws.run('interview', '두 번째 답변', false);
    const { host } = mount(h);
    expect(host.querySelector('.ww-interview-guide')?.textContent).toContain('한 번에 하나씩');
    expect(host.querySelector('.ww-conversation .ww-message-body strong')?.textContent).toBe('내 경험의 요점');
    expect(host.querySelector('.ww-conversation .ww-message-body')?.textContent).not.toContain('무엇이 달라졌나요?');
    expect(host.querySelector('.ww-conversation .ww-message-question')?.textContent?.trim()).toBe('이번 질문무엇이 달라졌나요?');
    expect(host.querySelectorAll('.ww-conversation .ww-message')).toHaveLength(2);
    const earlier = host.querySelector<HTMLDetailsElement>('.ww-earlier-conversation')!;
    expect(earlier.open).toBe(false); expect(earlier.textContent).toContain('첫 경험'); earlier.open = true;
    await h.ws.chooseProvider('codex');
    expect(host.querySelector<HTMLDetailsElement>('.ww-earlier-conversation')?.open).toBe(true);
  });
  it('keeps legacy conversation visible but places new review replies only in review', async () => {
    const h = harness(); h.ws.project.messages.push({ id: 'old', role: 'assistant', text: '이전 대화', provider: 'claude', createdAt: '2026-10-26T00:00:00Z' });
    await h.ws.run('review', '검토', false); const { host } = mount(h);
    expect(host.querySelector('.ww-conversation')?.textContent).toContain('이전 대화');
    expect(host.querySelector('.ww-conversation')?.textContent).not.toContain(reply.message);
    click(host, '검토'); expect(host.querySelector('.ww-review-summary')?.textContent?.trim()).toBe(reply.message);
  });
  it('switches between LinkedIn desktop and mobile frames while preserving literal draft content', () => {
    const draft = '<script>alert(1)</script>\n\n직접 쓴 **표현**과 줄바꿈';
    const { host, ws } = mount(harness(draft)); click(host, '미리보기');
    expect(host.querySelector('.ww-linkedin-screen.is-desktop')).not.toBeNull();
    expect(host.querySelector('.ww-linkedin-body')?.textContent).toBe(draft);
    expect(host.querySelector('.ww-linkedin-screen script')).toBeNull();
    expect(host.querySelector('.ww-linkedin-screen button')).toBeNull();
    click(host, '모바일'); expect(host.querySelector('.ww-linkedin-screen.is-mobile')).not.toBeNull();
    expect(host.querySelector('.ww-linkedin-mobile-nav')).not.toBeNull();
    click(host, '데스크톱'); expect(host.querySelector('.ww-linkedin-mobile-nav')).toBeNull();
    expect(ws.project.draft).toBe(draft);
  });
});
