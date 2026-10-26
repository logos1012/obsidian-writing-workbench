interface FolderSettingActions {
  value: string;
  choose(select: (path: string) => void): void;
  save(path: string): Promise<string>;
}

export function renderFolderSetting(container: HTMLElement, actions: FolderSettingActions): void {
  const section = document.createElement('section'); section.className = 'ww-folder-setting';
  const label = document.createElement('label'); label.textContent = '새 글 저장 폴더'; label.className = 'setting-item-name';
  const input = document.createElement('input'); input.type = 'text'; input.value = actions.value;
  input.placeholder = '예: 글쓰기/LinkedIn'; input.setAttribute('aria-label', '새 글 저장 폴더');
  const description = document.createElement('p'); description.className = 'setting-item-description';
  description.textContent = '볼트 안의 경로를 입력하거나 폴더를 선택하세요. 비워 두면 볼트 최상위에 저장합니다. 없는 폴더는 새 글을 만들 때 생성하며, 기존 글은 이동하지 않습니다.';
  const controls = document.createElement('div'); controls.className = 'ww-folder-controls';
  const choose = document.createElement('button'); choose.type = 'button'; choose.textContent = '폴더 선택';
  const save = document.createElement('button'); save.type = 'button'; save.textContent = '저장'; save.className = 'mod-cta';
  const status = document.createElement('p'); status.className = 'ww-folder-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const savedText = (path: string) => `현재 저장 위치: ${path || '볼트 최상위'}`;
  status.textContent = savedText(actions.value);
  const changed = () => { status.classList.remove('is-error'); input.removeAttribute('aria-invalid'); status.textContent = '변경한 위치를 적용하려면 저장을 누르세요.'; };
  input.addEventListener('input', changed);
  choose.addEventListener('click', () => actions.choose(path => { input.value = path; changed(); input.focus(); }));
  save.addEventListener('click', () => {
    input.disabled = true; choose.disabled = true; save.disabled = true;
    status.classList.remove('is-error'); status.textContent = '저장 중…';
    void actions.save(input.value).then(path => {
      input.value = path; input.removeAttribute('aria-invalid'); status.textContent = `${savedText(path)} · 저장했습니다.`;
    }).catch(error => {
      status.classList.add('is-error'); input.setAttribute('aria-invalid', 'true');
      status.textContent = error instanceof Error ? error.message : '폴더 설정을 저장하지 못했습니다.';
    }).finally(() => { input.disabled = false; choose.disabled = false; save.disabled = false; });
  });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); save.click(); } });
  label.append(input); controls.append(choose, save); section.append(label, description, controls, status); container.append(section);
}
