// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { WorkbenchUI } from '../src/ui/workbench';
import { harness, reply } from './helpers';

afterEach(() => document.body.replaceChildren());
describe('workbench UI', () => {
  it('renders author text and model text safely, without interpreting markup', async () => {
    const h = harness('<img src=x onerror=alert(1)>'); h.agent.run = async () => ({ ...reply, message: '<script>alert(1)</script>', suggestions: [] });
    await h.ws.run('review', '검토', false);
    const host = document.createElement('div'); document.body.append(host);
    new WorkbenchUI(host, h.ws, { newProject() {}, openProject() {}, addMaterial() {}, settings() {} });
    [...host.querySelectorAll('button')].find(b => b.textContent === '검토')!.click();
    expect(host.querySelectorAll('script,img')).toHaveLength(0);
    expect(host.textContent).toContain('<script>alert(1)</script>');
  });
  it('shows stale review state and prevents accepting from the UI', async () => {
    const h = harness(); await h.ws.run('review', '검토', false); await h.ws.edit({ draft: '새로운 원고' });
    const host = document.createElement('div'); document.body.append(host);
    new WorkbenchUI(host, h.ws, { newProject() {}, openProject() {}, addMaterial() {}, settings() {} });
    [...host.querySelectorAll('button')].find(b => b.textContent === '검토')!.click();
    expect(host.textContent).toContain('이전 원고 기준');
    expect([...host.querySelectorAll('button')].find(b => b.textContent === '수락')?.disabled).toBe(true);
  });
  it('persists typing without replacing the focused editor', async () => {
    const h = harness(); const host = document.createElement('div'); document.body.append(host);
    new WorkbenchUI(host, h.ws, { newProject() {}, openProject() {}, addMaterial() {}, settings() {} });
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="원고 작성"]')!;
    input.focus(); input.value = '직접 쓴 문장'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await h.ws.flush(); expect(h.projectStore.value?.draft).toBe('직접 쓴 문장'); expect(document.activeElement).toBe(input);
  });
  it('restores an unsent interview answer after reopening the workbench', async () => {
    const h = harness(); const host = document.createElement('div'); document.body.append(host);
    const actions = { newProject() {}, openProject() {}, addMaterial() {}, settings() {} };
    const ui = new WorkbenchUI(host, h.ws, actions);
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="글감 찾기 답변"]')!;
    input.value = '아직 보내지 않은 경험 이야기'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await h.ws.flush(); ui.destroy(); new WorkbenchUI(host, h.ws, actions);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="글감 찾기 답변"]')!.value).toBe('아직 보내지 않은 경험 이야기');
    expect(h.projectStore.value?.composer).toBe('아직 보내지 않은 경험 이야기');
  });
});
