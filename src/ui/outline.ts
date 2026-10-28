import { markdown } from './markdown';

// Presentation only: the original Markdown remains untouched for double-click
// editing and AI context. Keep inline formatting and nested lists intact.
export function outline(text: string): HTMLDivElement {
  let display = text;
  // Older responses sometimes put all numbered steps on one line. Split only
  // an unambiguous 1, 2, 3... sequence; leave prose, dates, and decimals alone.
  if (!text.trim().includes('\n') && /^1[.)]\s/.test(text.trim())) {
    const matches = [...text.trim().matchAll(/(?:^|\s)(\d+)[.)]\s+/g)];
    if (matches.length > 1 && matches.every((match, index) => Number(match[1]) === index + 1)) display = text.trim().replace(/^1[.)]\s+/, '1. ').replace(/\s+(\d+)[.)]\s+/g, '\n$1. ');
  }
  const root = markdown(display, 'ww-memo-content ww-outline');
  for (const list of root.querySelectorAll<HTMLOListElement>(':scope > ol, :scope > ul')) {
    list.classList.add('ww-outline-list');
    for (const item of Array.from(list.children)) {
      if (!(item instanceof HTMLElement) || item.tagName !== 'LI') continue;
      item.classList.add('ww-outline-step');
      const lead = document.createElement('div'); lead.className = 'ww-outline-title';
      const paragraph = item.firstElementChild?.tagName === 'P' ? item.firstElementChild : null;
      const source = paragraph ?? item;
      while (source.firstChild) {
        const node = source.firstChild;
        if (node instanceof HTMLElement && /^(UL|OL|P|BLOCKQUOTE|PRE|HR)$/.test(node.tagName)) break;
        if (node instanceof HTMLElement && node.tagName === 'BR') { node.remove(); break; }
        lead.append(node);
      }
      if (!lead.textContent?.trim()) { source.prepend(...Array.from(lead.childNodes)); continue; }
      // "도입: 경험의 장면" becomes a heading plus explanation. Avoid URL
      // colons and keep longer prose unchanged rather than guessing a heading.
      const separator = lead.textContent.match(/^(.{1,60}?)[：:]\s+/u);
      if (separator) {
        const titleLength = separator[1]!.length;
        const detail = document.createElement('div'); detail.className = 'ww-outline-detail';
        const walker = document.createTreeWalker(lead, NodeFilter.SHOW_TEXT);
        let offset = 0, node: Node | null;
        while ((node = walker.nextNode())) {
          const length = node.textContent?.length ?? 0;
          if (offset + length >= titleLength) {
            const range = document.createRange(); range.setStart(node, titleLength - offset); range.setEnd(lead, lead.childNodes.length);
            detail.append(range.extractContents());
            // Remove the separator from text nodes while retaining emphasis/links.
            const remaining = document.createTreeWalker(detail, NodeFilter.SHOW_TEXT);
            let remove = separator[0].length - titleLength, next: Node | null;
            while (remove && (next = remaining.nextNode())) { const value = next.textContent ?? ''; next.textContent = value.slice(remove); remove = Math.max(0, remove - value.length); }
            item.insertBefore(detail, paragraph ?? item.firstChild); break;
          }
          offset += length;
        }
      }
      item.prepend(lead);
      if (paragraph && !paragraph.textContent?.trim() && !paragraph.querySelector('img,br')) paragraph.remove();
    }
  }
  return root;
}
