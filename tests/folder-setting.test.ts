// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderFolderSetting } from '../src/ui/folder-setting';

function mount(save = vi.fn(async (path: string) => path.trim())) {
  const host = document.createElement('div'); let pick!: (path: string) => void;
  renderFolderSetting(host, { value: 'Writing Workbench', save, choose: select => { pick = select; } });
  const input = host.querySelector('input')!;
  const click = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click();
  return { host, input, click, save, select: (path: string) => pick(path) };
}
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

describe('folder settings interface', () => {
  it('saves only on explicit save and displays the normalized saved destination', async () => {
    const h = mount(); h.input.value = ' 나의 글/LinkedIn '; h.input.dispatchEvent(new Event('input'));
    expect(h.save).not.toHaveBeenCalled(); h.click('저장'); expect(h.input.disabled).toBe(true); await settle();
    expect(h.save).toHaveBeenCalledWith(' 나의 글/LinkedIn '); expect(h.input.value).toBe('나의 글/LinkedIn');
    expect(h.host.textContent).toContain('현재 저장 위치: 나의 글/LinkedIn · 저장했습니다.'); expect(h.input.disabled).toBe(false);
  });
  it('allows choosing the vault root and saving it with Enter, ignoring IME composition', async () => {
    const h = mount(); h.click('폴더 선택'); h.select('');
    expect(h.save).not.toHaveBeenCalled();
    h.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true })); expect(h.save).not.toHaveBeenCalled();
    h.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await settle();
    expect(h.save).toHaveBeenCalledWith(''); expect(h.host.querySelector('[role="status"]')?.textContent).toContain('볼트 최상위');
  });
  it('leaves invalid input visible for correction and allows retry after a failed save', async () => {
    const save = vi.fn(async (path: string) => path).mockRejectedValueOnce(new Error('폴더 경로 오류'));
    const h = mount(save); h.input.value = '../밖'; h.click('저장'); await settle();
    expect(h.input.value).toBe('../밖'); expect(h.input.disabled).toBe(false); expect(h.input.getAttribute('aria-invalid')).toBe('true');
    expect(h.host.querySelector('[role="status"]')?.textContent).toBe('폴더 경로 오류');
    h.input.value = '글'; h.input.dispatchEvent(new Event('input')); h.click('저장'); await settle();
    expect(h.input.hasAttribute('aria-invalid')).toBe(false); expect(h.host.textContent).toContain('저장했습니다.');
  });
});
