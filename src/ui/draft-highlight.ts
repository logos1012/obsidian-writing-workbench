import type { TextLocation } from './suggestion-location';

export interface DraftHighlight {
  show(location: TextLocation, reveal: boolean): void;
  clear(): void;
  destroy(): void;
}
function behavior(node: HTMLElement): ScrollBehavior {
  return node.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
function scroll(node: HTMLElement, top: number): void {
  const value = Math.max(0, Math.min(top, node.scrollHeight - node.clientHeight));
  if (node.scrollTo) node.scrollTo({ top: value, behavior: behavior(node) });
  else node.scrollTop = value;
}
function markedText(container: HTMLElement, text: string, location: TextLocation): HTMLElement {
  const doc = container.ownerDocument;
  const mark = doc.createElement('mark'); mark.className = 'ww-draft-match';
  mark.textContent = text.slice(location.start, location.end);
  if (location.start === location.end) { mark.classList.add('is-deletion'); mark.textContent = '\u200b'; }
  container.replaceChildren(doc.createTextNode(text.slice(0, location.start)), mark, doc.createTextNode(text.slice(location.end)));
  return mark;
}

// A mirror behind the native textarea paints only the background. The native
// editor keeps its focus, caret, selection, undo stack, and IME composition.
export class EditorHighlight implements DraftHighlight {
  readonly layer: HTMLDivElement;
  private content: HTMLDivElement;
  private observer?: ResizeObserver;
  private mark?: HTMLElement;
  private size?: { width: number; height: number };
  private sync = () => { this.content.style.transform = `translate(${-this.editor.scrollLeft}px, ${-this.editor.scrollTop}px)`; };
  constructor(private editor: HTMLTextAreaElement, frame: HTMLElement) {
    this.layer = editor.ownerDocument.createElement('div'); this.layer.className = 'ww-draft-highlight'; this.layer.setAttribute('aria-hidden', 'true');
    this.content = editor.ownerDocument.createElement('div'); this.content.className = 'ww-draft-mirror'; this.layer.append(this.content); frame.prepend(this.layer);
    editor.addEventListener('scroll', this.sync, { passive: true });
    const Observer = editor.ownerDocument.defaultView?.ResizeObserver;
    if (Observer) {
      this.observer = new Observer(() => {
        const resized = this.size && (this.size.width !== editor.clientWidth || this.size.height !== editor.clientHeight);
        this.measure();
        if (resized && this.layer.classList.contains('is-active')) this.reveal();
      });
      this.observer.observe(editor);
    }
  }
  private measure(): void {
    const style = this.editor.ownerDocument.defaultView!.getComputedStyle(this.editor);
    for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'line-height', 'letter-spacing', 'word-spacing', 'text-indent', 'text-transform', 'text-align', 'direction', 'tab-size', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'word-break', 'overflow-wrap']) {
      this.content.style.setProperty(property, style.getPropertyValue(property));
    }
    this.layer.style.width = `${this.editor.clientWidth}px`;
    this.size = { width: this.editor.clientWidth, height: this.editor.clientHeight };
    this.sync();
  }
  show(location: TextLocation, reveal: boolean): void {
    this.mark = markedText(this.content, this.editor.value, location);
    // Match a textarea's final empty line without introducing visible text.
    this.content.append(this.editor.ownerDocument.createTextNode('\n'));
    this.measure(); this.layer.classList.add('is-active');
    if (reveal) this.reveal();
  }
  private reveal(): void {
    if (!this.mark) return;
    const rect = this.mark.getBoundingClientRect(), viewport = this.editor.getBoundingClientRect();
    if (rect.top < viewport.top + 16 || rect.bottom > viewport.bottom - 16) {
      scroll(this.editor, this.editor.scrollTop + rect.top - viewport.top - Math.max(20, (this.editor.clientHeight - Math.min(rect.height, this.editor.clientHeight)) / 2));
    }
  }
  clear(): void {
    if (this.layer.classList.contains('is-active')) this.editor.scrollTo?.({ top: this.editor.scrollTop, behavior: 'auto' });
    this.layer.classList.remove('is-active');
  }
  destroy(): void { this.observer?.disconnect(); this.editor.removeEventListener('scroll', this.sync); this.layer.remove(); }
}

export class PreviewHighlight implements DraftHighlight {
  private original: string;
  constructor(private body: HTMLElement, private panel: HTMLElement) { this.original = body.textContent ?? ''; }
  show(location: TextLocation, reveal: boolean): void {
    const mark = markedText(this.body, this.original, location);
    if (!reveal) return;
    const rect = mark.getBoundingClientRect(), viewport = this.panel.getBoundingClientRect();
    if (rect.top < viewport.top + 20 || rect.bottom > viewport.bottom - 20) scroll(this.panel, this.panel.scrollTop + rect.top - viewport.top - Math.max(20, (this.panel.clientHeight - Math.min(rect.height, this.panel.clientHeight)) / 2));
  }
  clear(): void { this.body.textContent = this.original; }
  destroy(): void { this.clear(); }
}
