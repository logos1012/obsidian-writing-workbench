import { z } from 'zod';

export const defaultWidths: [number, number, number] = [24, 40, 36];
export const LayoutSchema = z.object({
  version: z.literal(1),
  widths: z.tuple([z.number().finite().min(1).max(98), z.number().finite().min(1).max(98), z.number().finite().min(1).max(98)])
    .refine(widths => Math.abs(widths.reduce((sum, n) => sum + n, 0) - 100) < 0.01),
}).strict();
export type ColumnWidths = z.infer<typeof LayoutSchema>['widths'];
const minimums: ColumnWidths = [200, 280, 280];

export function resizePair(pixels: ColumnWidths, boundary: 0 | 1, delta: number): ColumnWidths {
  const next: ColumnWidths = [...pixels];
  const total = pixels[boundary] + pixels[boundary + 1]!;
  const left = Math.max(minimums[boundary], Math.min(total - minimums[boundary + 1]!, pixels[boundary] + delta));
  next[boundary] = left; next[boundary + 1] = total - left;
  const sum = next.reduce((a, b) => a + b, 0);
  return next.map(value => value / sum * 100) as ColumnWidths;
}

export class ColumnResizer {
  private dragCleanup?: () => void;
  constructor(private grid: HTMLElement, private widths: ColumnWidths, private change: (value: ColumnWidths, save: boolean) => void) { this.apply(widths); }
  apply(widths: ColumnWidths): void {
    this.widths = [...widths];
    this.grid.style.setProperty('--ww-memo-width', `${widths[0]}fr`);
    this.grid.style.setProperty('--ww-draft-width', `${widths[1]}fr`);
    this.grid.style.setProperty('--ww-ai-width', `${widths[2]}fr`);
    for (const [index, handle] of [...this.grid.querySelectorAll<HTMLElement>('.ww-divider')].entries()) {
      handle.setAttribute('aria-valuenow', String(Math.round(widths[index] ?? 0)));
      handle.setAttribute('aria-valuetext', `왼쪽 영역 ${Math.round(widths[index] ?? 0)}%`);
    }
  }
  private pixels(): ColumnWidths {
    return [...this.grid.querySelectorAll<HTMLElement>(':scope > .ww-panel')].map((panel, index) => panel.getBoundingClientRect().width || this.widths[index]! * 12) as ColumnWidths;
  }
  separator(boundary: 0 | 1): HTMLElement {
    const handle = document.createElement('div'); handle.className = 'ww-divider'; handle.tabIndex = 0;
    handle.dataset.wwFocus = `divider-${boundary}`;
    handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', boundary === 0 ? '글의 방향과 원고 사이 너비 조절' : '원고와 AI 작업 사이 너비 조절');
    handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', '100');
    handle.setAttribute('aria-valuenow', String(Math.round(this.widths[boundary])));
    handle.title = '드래그 또는 방향키로 폭 조절 · 두 번 클릭하면 기본 폭';
    const update = (widths: ColumnWidths, save: boolean) => { this.apply(widths); this.change(widths, save); };
    handle.addEventListener('keydown', event => {
      if (event.key === 'Home') { event.preventDefault(); update([...defaultWidths], true); return; }
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); update(resizePair(this.pixels(), boundary, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 48 : 16)), true);
    });
    handle.addEventListener('dblclick', () => update([...defaultWidths], true));
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); this.dragCleanup?.();
      const start = this.pixels(), x = event.clientX;
      const doc = this.grid.ownerDocument;
      this.grid.classList.add('is-resizing'); handle.focus({ preventScroll: true });
      handle.setPointerCapture?.(event.pointerId);
      const move = (moveEvent: PointerEvent) => { if (moveEvent.pointerId === event.pointerId) update(resizePair(start, boundary, moveEvent.clientX - x), false); };
      const finish = (endEvent?: PointerEvent) => {
        if (endEvent && endEvent.pointerId !== event.pointerId) return;
        doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', finish); doc.removeEventListener('pointercancel', finish);
        handle.removeEventListener('lostpointercapture', finish);
        this.grid.classList.remove('is-resizing'); this.dragCleanup = undefined;
        if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        this.change(this.widths, true);
      };
      doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', finish); doc.addEventListener('pointercancel', finish);
      handle.addEventListener('lostpointercapture', finish); this.dragCleanup = () => finish();
    });
    return handle;
  }
  destroy(): void { this.dragCleanup?.(); }
}
