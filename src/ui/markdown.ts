import MarkdownIt from 'markdown-it';

// Render prose, not executable HTML or remote embeds. Draft/diff text stays literal.
const parser = new MarkdownIt({ html: false, linkify: true, breaks: true }).disable('image');
parser.validateLink = url => /^https?:\/\//i.test(url) || /^#[^\s]*$/.test(url);

export function markdown(text: string, className = ''): HTMLDivElement {
  const container = document.createElement('div');
  container.className = `ww-markdown ${className}`.trim();
  container.innerHTML = parser.render(text);
  for (const link of container.querySelectorAll('a')) {
    link.rel = 'noopener noreferrer';
    if (!link.getAttribute('href')?.startsWith('#')) link.target = '_blank';
  }
  return container;
}
