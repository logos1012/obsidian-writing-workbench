interface ScrollPosition { top: number; left: number }
interface Anchor { key: string; container: string; offset: number }

// Keep viewport state outside DOM nodes, which are replaced after a workspace action.
export class ViewState {
  private positions = new Map<string, ScrollPosition>();
  private openDetails = new Map<string, boolean>();
  private inputs = new Map<string, string>();
  private anchor?: Anchor;
  private focus?: { key: string; start?: number; end?: number };
  capture(host: HTMLElement, preferredAnchor?: string): void {
    const containers = [host, ...host.querySelectorAll<HTMLElement>('[data-ww-scroll]')];
    for (const node of containers) {
      if (node.dataset.wwScroll) this.positions.set(node.dataset.wwScroll, { top: node.scrollTop, left: node.scrollLeft });
    }
    for (const details of host.querySelectorAll<HTMLDetailsElement>('details[data-ww-detail]')) this.openDetails.set(details.dataset.wwDetail!, details.open);
    for (const input of host.querySelectorAll<HTMLTextAreaElement>('[data-ww-unsaved]')) this.inputs.set(input.dataset.wwUnsaved!, input.value);
    const focused = host.ownerDocument.activeElement as HTMLTextAreaElement | null;
    if (focused && host.contains(focused) && focused.dataset.wwFocus) {
      this.focus = { key: focused.dataset.wwFocus };
      if (focused.tagName === 'TEXTAREA') { this.focus.start = focused.selectionStart; this.focus.end = focused.selectionEnd; }
    } else if (focused && host.contains(focused)) this.focus = undefined;
    this.anchor = undefined;
    if (preferredAnchor) {
      const node = [...host.querySelectorAll<HTMLElement>('[data-ww-anchor]')].find(n => n.dataset.wwAnchor === preferredAnchor);
      // In the narrow layout the host scrolls; in the desktop layout the panel scrolls.
      const container = node?.closest<HTMLElement>('[data-ww-scroll]');
      const scroller = container && container.scrollHeight > container.clientHeight ? container : host;
      if (node && scroller.dataset.wwScroll) this.anchor = { key: preferredAnchor, container: scroller.dataset.wwScroll, offset: node.getBoundingClientRect().top - scroller.getBoundingClientRect().top };
    }
  }
  restore(host: HTMLElement): void {
    for (const details of host.querySelectorAll<HTMLDetailsElement>('details[data-ww-detail]')) details.open = this.openDetails.get(details.dataset.wwDetail!) ?? false;
    for (const input of host.querySelectorAll<HTMLTextAreaElement>('[data-ww-unsaved]')) {
      const value = this.inputs.get(input.dataset.wwUnsaved!); if (value !== undefined) input.value = value;
    }
    const focus = this.focus;
    if (focus) {
      const target = [...host.querySelectorAll<HTMLElement>('[data-ww-focus]')].find(n => n.dataset.wwFocus === focus.key);
      if (target && !target.matches(':disabled')) {
        target.focus({ preventScroll: true });
        if (target.tagName === 'TEXTAREA' && focus.start !== undefined) (target as HTMLTextAreaElement).setSelectionRange(focus.start, focus.end ?? focus.start);
      }
    }
    // Restore scroll last: focusing a textarea/selection can scroll it in Chromium.
    for (const node of [host, ...host.querySelectorAll<HTMLElement>('[data-ww-scroll]')]) {
      const position = this.positions.get(node.dataset.wwScroll ?? '');
      if (position) { node.scrollTop = position.top; node.scrollLeft = position.left; }
    }
    if (this.anchor) {
      const anchor = this.anchor;
      const node = [...host.querySelectorAll<HTMLElement>('[data-ww-anchor]')].find(n => n.dataset.wwAnchor === anchor.key);
      const container = [host, ...host.querySelectorAll<HTMLElement>('[data-ww-scroll]')].find(n => n.dataset.wwScroll === anchor.container);
      if (node && container) container.scrollTop += node.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.offset;
    }
  }
}
