function el(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
function icon(name: 'like' | 'comment' | 'repost' | 'send' | 'globe' | 'home' | 'search' | 'users' | 'plus' | 'bell' | 'briefcase'): SVGSVGElement {
  const paths = {
    like: 'M7 10v11H3V10h4Zm0 0 5-7c2 0 3 1 2 4l-1 3h6c2 0 2 1 2 3l-2 7H7',
    comment: 'M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z',
    repost: 'm4 8 4-4 4 4M8 4v12h12m0 0-4 4-4-4m4 4V8H4',
    send: 'm22 2-7 20-4-9-9-4 20-7ZM11 13 22 2',
    globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18',
    home: 'm3 10 9-7 9 7v11h-6v-7H9v7H3V10Z',
    search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6',
    users: 'M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM1 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3M16 3a4 4 0 0 1 0 8m2 2a5 5 0 0 1 5 5v3',
    plus: 'M4 4h16v16H4V4Zm8 4v8m-4-4h8',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM9 21h6',
    briefcase: 'M8 6V3h8v3M3 6h18v15H3V6Zm0 6c5 4 13 4 18 0m-9 0v4',
  };
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24'); node.setAttribute('fill', 'none'); node.setAttribute('stroke', 'currentColor'); node.setAttribute('stroke-width', '1.7'); node.setAttribute('stroke-linecap', 'round'); node.setAttribute('stroke-linejoin', 'round'); node.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(node.namespaceURI, 'path'); path.setAttribute('d', paths[name]); node.append(path); return node;
}

export function linkedinPreview(text: string, mobile: boolean): HTMLElement {
  const screen = el('div', `ww-linkedin-screen ${mobile ? 'is-mobile' : 'is-desktop'}`);
  screen.setAttribute('aria-label', mobile ? 'LinkedIn 모바일 예상 화면' : 'LinkedIn 데스크톱 예상 화면');
  const nav = el('div', 'ww-linkedin-nav'); nav.setAttribute('aria-hidden', 'true');
  const brand = el('span', 'ww-linkedin-brand', 'in');
  const search = el('span', 'ww-linkedin-search'); search.append(icon('search'), document.createTextNode('검색'));
  nav.append(brand, search, icon('home')); screen.append(nav);
  const feed = el('div', 'ww-linkedin-feed');
  const article = el('article', 'ww-linkedin-post');
  const header = el('div', 'ww-linkedin-author');
  const avatar = el('div', 'ww-linkedin-avatar', '나');
  const identity = el('div', 'ww-linkedin-identity');
  identity.append(el('strong', '', '내 프로필'), el('span', 'ww-linkedin-headline', 'LinkedIn에 공유할 나의 이야기'));
  const visibility = el('span', 'ww-linkedin-visibility', '지금 · '); visibility.append(icon('globe')); visibility.setAttribute('aria-label', '지금 · 전체 공개'); identity.append(visibility);
  const menu = el('span', 'ww-linkedin-menu', '···'); menu.setAttribute('aria-hidden', 'true');
  header.append(avatar, identity, menu);
  const body = el('div', 'ww-linkedin-body', text || '원고를 작성하면 이 피드에 표시됩니다.');
  const actions = el('div', 'ww-linkedin-actions'); actions.setAttribute('aria-hidden', 'true');
  for (const [name, label] of [['like', '추천'], ['comment', '댓글'], ['repost', '퍼가기'], ['send', '보내기']] as const) {
    const action = el('span', 'ww-linkedin-action'); action.append(icon(name), document.createTextNode(label)); actions.append(action);
  }
  article.append(header, body, actions); feed.append(article); screen.append(feed);
  if (mobile) {
    const bottom = el('div', 'ww-linkedin-mobile-nav'); bottom.setAttribute('aria-hidden', 'true');
    for (const [name, label] of [['home', '홈'], ['users', '인맥'], ['plus', '게시'], ['bell', '알림'], ['briefcase', '채용']] as const) {
      const item = el('span', ''); item.append(icon(name), document.createTextNode(label)); bottom.append(item);
    }
    screen.append(bottom);
  }
  return screen;
}
