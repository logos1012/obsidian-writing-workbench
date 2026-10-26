import { FileSystemAdapter, FuzzySuggestModal, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { JsonStore } from './storage/json-store';
import { ProjectSchema, PreferencesSchema, SettingsSchema, defaultSettings, createProject, type Project, type Preferences, type Settings } from './domain/model';
import { Workspace, type DocumentPort } from './domain/workspace';
import { ConflictError } from './domain/review';
import { CliAgent, resolveExecutable } from './providers/cli';
import { WorkbenchUI, element } from './ui/workbench';
import { LayoutSchema, defaultWidths, type ColumnWidths } from './ui/layout';

const VIEW = 'writing-workbench';
export default class WritingWorkbenchPlugin extends Plugin {
  settings: Settings = defaultSettings;
  workspace?: Workspace;
  private stateRoot = '';
  private preferenceStore!: JsonStore<Preferences>;
  private opening = false;
  columnWidths: ColumnWidths = [...defaultWidths];
  private layoutStore!: JsonStore<{ version: 1; widths: ColumnWidths }>;

  async onload(): Promise<void> {
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) { new Notice('Writing Workbench는 데스크톱 로컬 볼트에서 사용할 수 있습니다.'); return; }
    this.stateRoot = join(this.app.vault.adapter.getBasePath(), this.app.vault.configDir, 'plugins', this.manifest.id, 'state');
    const stored = await this.loadData();
    const parsed = SettingsSchema.safeParse(stored ?? {});
    this.settings = parsed.success ? parsed.data : { ...defaultSettings };
    if (!parsed.success) new Notice('Writing Workbench 설정 형식이 달라 기본 설정으로 시작합니다. 저장된 작업은 유지됩니다.');
    this.preferenceStore = new JsonStore(join(this.stateRoot, 'preferences.json'), PreferencesSchema);
    this.layoutStore = new JsonStore(join(this.stateRoot, 'layout.json'), LayoutSchema);
    try { this.columnWidths = (await this.layoutStore.load())?.widths ?? [...defaultWidths]; }
    catch { new Notice('저장한 화면 너비를 읽지 못해 기본 너비로 시작합니다. 원고와 대화는 유지됩니다.'); }
    this.registerView(VIEW, leaf => new WorkbenchView(leaf, this));
    this.addRibbonIcon('pen-line', '글쓰기 작업실', () => { void this.activate().catch(error => this.notice(error)); });
    this.addCommand({ id: 'open-workbench', name: '글쓰기 작업실 열기', callback: () => { void this.activate().catch(error => this.notice(error)); } });
    this.addCommand({ id: 'review-current-note', name: '현재 노트를 글쓰기 작업실에 연결', callback: () => {
      const file = this.app.workspace.getActiveFile();
      if (file?.extension === 'md') void this.openFile(file).catch(error => this.notice(error));
      else this.pickFile();
    } });
    this.addSettingTab(new WorkbenchSettings(this));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (this.workspace?.project.path === oldPath) void this.workspace.rename(file.path).catch(error => this.notice(error));
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      if (this.workspace?.project.path === file.path) {
        this.workspace.error = '연결된 원고 파일이 삭제됐습니다. 작업 사본과 이력은 보존되어 있습니다.'; this.workspace.onChange();
      }
    }));
  }
  onunload(): void { this.workspace?.cancel(); void this.workspace?.flush().catch(error => this.notice(error)); }
  private notice(error: unknown): void { new Notice(error instanceof Error ? error.message : '작업에 실패했습니다.', 8000); }
  async updateSettings(): Promise<void> { await this.saveData(SettingsSchema.parse(this.settings)); }
  async saveColumnWidths(widths: ColumnWidths): Promise<void> {
    const value = LayoutSchema.parse({ version: 1, widths });
    this.columnWidths = value.widths; await this.layoutStore.save(value);
  }
  openSettings(): void {
    const modal = new Modal(this.app);
    modal.titleEl.setText('Writing Workbench 설정');
    const settings = new WorkbenchSettings(this);
    settings.renderInto(modal.contentEl);
    modal.open();
  }
  private documentPort(): DocumentPort {
    const fileAt = (path: string): TFile => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('연결된 Markdown 파일을 찾지 못했습니다. 작업 사본을 복사해 보존해 주세요.');
      return file;
    };
    return {
      read: path => this.app.vault.read(fileAt(path)),
      compareAndSwap: async (path, expected, next) => {
        await this.app.vault.process(fileAt(path), current => {
          if (current !== expected) throw new ConflictError('다른 창이나 앱에서 원고가 바뀌었습니다. 덮어쓰지 않았습니다. 파일에서 다시 불러오면 현재 작업 사본은 이력에 남습니다.');
          return next;
        });
      },
    };
  }
  async openFile(file: TFile): Promise<void> {
    if (this.opening) return;
    if (this.workspace?.busy) throw new Error('진행 중인 요청을 중지한 후 다른 글을 열어 주세요.');
    this.opening = true;
    try {
      await this.workspace?.flush();
      const states = await this.projectFiles();
      let project: Project | null = null, store: JsonStore<Project> | undefined;
      for (const stateFile of states) {
        const candidate = new JsonStore(join(this.stateRoot, 'projects', stateFile), ProjectSchema);
        const data = await candidate.load();
        if (candidate.recovered) new Notice('손상된 기록 대신 백업을 불러왔습니다. 손상된 원본도 보존했습니다.', 8000);
        if (data?.path === file.path) { project = data; store = candidate; break; }
      }
      if (!project) {
        project = createProject(file.path, await this.app.vault.read(file));
        store = new JsonStore(join(this.stateRoot, 'projects', `${project.id}.json`), ProjectSchema);
        await store.save(project);
      }
      await this.bindProject(project, store!);
    } finally { this.opening = false; }
  }
  private async bindProject(project: Project, store: JsonStore<Project>): Promise<void> {
    const preferences = await this.preferenceStore.load() ?? { version: 1 as const, items: [] };
    if (this.preferenceStore.recovered) new Notice('문체 원칙을 이전 백업에서 복구했습니다. 손상된 파일은 보존했습니다.', 8000);
    this.workspace = new Workspace(project, preferences, store, this.preferenceStore, this.documentPort(), new CliAgent(), () => this.settings);
    if (project.pendingWrite) {
      try { await this.workspace.recoverWrite(); } catch (error) { this.workspace.error = error instanceof Error ? error.message : '저장 복구 확인이 필요합니다.'; }
    }
    if (!(this.app.vault.getAbstractFileByPath(project.path) instanceof TFile)) this.workspace.error = '연결된 원고 파일이 없습니다. 작업 사본은 복원했습니다. 원고를 복사해서 새 노트에 보존할 수 있습니다.';
    await new JsonStore(join(this.stateRoot, 'last-project.json'), ProjectSchema.pick({ id: true })).save({ id: project.id });
    await this.activate(false);
  }
  async openSavedProject(projectId: string): Promise<void> {
    if (this.opening) return;
    if (!/^[a-f0-9-]{36}$/.test(projectId)) throw new Error('잘못된 작업 ID입니다.');
    if (this.workspace?.busy) throw new Error('현재 요청을 중지한 뒤 작업을 바꿔 주세요.');
    this.opening = true;
    try {
      await this.workspace?.flush();
      const store = new JsonStore(join(this.stateRoot, 'projects', `${projectId}.json`), ProjectSchema);
      const project = await store.load();
      if (!project) throw new Error('작업 기록을 찾지 못했습니다.');
      if (store.recovered) new Notice('작업 기록을 이전 백업에서 복구했습니다. 손상된 파일도 보존했습니다.', 8000);
      await this.bindProject(project, store);
    } finally { this.opening = false; }
  }
  async pickSavedProject(): Promise<void> {
    const projects: Project[] = [];
    for (const name of await this.projectFiles()) {
      try { const project = await new JsonStore(join(this.stateRoot, 'projects', name), ProjectSchema).load(); if (project) projects.push(project); }
      catch (error) { this.notice(error); }
    }
    new SavedProjectPicker(this, projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))).open();
  }
  private async projectFiles(): Promise<string[]> {
    try { return (await fs.readdir(join(this.stateRoot, 'projects'))).filter(path => path.endsWith('.json')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async activate(restore = true): Promise<void> {
    if (!this.workspace && restore) {
      const last = await new JsonStore(join(this.stateRoot, 'last-project.json'), ProjectSchema.pick({ id: true })).load();
      if (last && /^[a-f0-9-]{36}$/.test(last.id)) {
        await this.openSavedProject(last.id); return;
      }
    }
    const leaf = this.app.workspace.getLeavesOfType(VIEW)[0] ?? this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof WorkbenchView) leaf.view.refresh();
  }
  async newProject(): Promise<void> {
    if (this.workspace?.busy || this.opening) throw new Error('진행 중인 작업을 마친 뒤 새 글을 시작해 주세요.');
    const folder = 'Writing Workbench';
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const stamp = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-');
    let path = normalizePath(`${folder}/새 글 ${stamp}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${folder}/새 글 ${stamp}-${createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 6)}.md`);
    await this.openFile(await this.app.vault.create(path, ''));
  }
  pickFile(material = false): void {
    new NotePicker(this, file => {
      void (async () => {
        if (material && this.workspace) {
          const content = await this.app.vault.read(file);
          if (content.length > 80000) throw new Error('참고 노트가 너무 큽니다. 필요한 부분만 참고 자료에 붙여 넣어 주세요.');
          await this.workspace.edit({ materials: `${this.workspace.project.materials}\n\n--- 참고 노트: ${file.path} ---\n${content}`.trim() });
          this.workspace.onChange();
        } else await this.openFile(file);
      })().catch(error => this.notice(error));
    }).open();
  }
}
class SavedProjectPicker extends FuzzySuggestModal<Project> {
  constructor(private plugin: WritingWorkbenchPlugin, private projects: Project[]) { super(plugin.app); this.setPlaceholder('이전에 작업한 글을 찾아 복원하세요'); }
  getItems(): Project[] { return this.projects; }
  getItemText(project: Project): string { return `${project.path} (${new Date(project.updatedAt).toLocaleDateString('ko-KR')})`; }
  onChooseItem(project: Project): void { void this.plugin.openSavedProject(project.id).catch(error => new Notice(String(error), 8000)); }
}
class NotePicker extends FuzzySuggestModal<TFile> {
  constructor(private plugin: WritingWorkbenchPlugin, private select: (file: TFile) => void) { super(plugin.app); this.setPlaceholder('Markdown 노트를 선택하세요'); }
  getItems(): TFile[] { return this.plugin.app.vault.getMarkdownFiles(); }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { this.select(file); }
}
class WorkbenchView extends ItemView {
  private ui?: WorkbenchUI;
  constructor(leaf: WorkspaceLeaf, private plugin: WritingWorkbenchPlugin) { super(leaf); }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return '글쓰기 작업실'; }
  getIcon(): string { return 'pen-line'; }
  async onOpen(): Promise<void> { this.refresh(); }
  async onClose(): Promise<void> { this.ui?.destroy(); await this.plugin.workspace?.flush(); }
  refresh(): void {
    this.ui?.destroy();
    const host = this.contentEl; host.replaceChildren();
    if (this.plugin.workspace) {
      this.ui = new WorkbenchUI(host, this.plugin.workspace, {
        newProject: () => { void this.plugin.newProject().catch(error => new Notice(String(error))); },
        openProject: () => this.plugin.pickFile(), addMaterial: () => this.plugin.pickFile(true), settings: () => this.plugin.openSettings(),
        recoverProject: () => { void this.plugin.pickSavedProject().catch(error => new Notice(String(error))); },
        columnWidths: this.plugin.columnWidths, saveColumnWidths: widths => this.plugin.saveColumnWidths(widths),
      });
    } else {
      const empty = element('div', 'ww-welcome'); empty.append(element('h2', '', '내 생각으로 쓰는 글'), element('p', '', '대화로 글감을 찾고, 직접 쓴 원고를 AI와 함께 다듬으세요.'));
      const create = element('button', 'mod-cta', '새 글 시작'); create.addEventListener('click', () => { void this.plugin.newProject().catch(error => new Notice(String(error))); });
      const open = element('button', '', '기존 원고 열기'); open.addEventListener('click', () => this.plugin.pickFile());
      const recover = element('button', '', '작업 기록 열기'); recover.addEventListener('click', () => { void this.plugin.pickSavedProject().catch(error => new Notice(String(error))); });
      empty.append(create, open, recover, element('p', 'ww-hint', 'Claude Code 또는 Codex의 설치와 로그인이 필요합니다. 설정에서 CLI 연결을 확인할 수 있어요.')); host.append(empty);
    }
  }
}
class WorkbenchSettings extends PluginSettingTab {
  constructor(private plugin: WritingWorkbenchPlugin) { super(plugin.app, plugin); }
  display(): void {
    this.renderInto(this.containerEl);
  }
  renderInto(container: HTMLElement): void {
    container.replaceChildren(); container.append(element('h2', '', 'Writing Workbench'));
    container.append(element('p', '', '맥에 설치하고 로그인한 CLI를 사용합니다. 선택한 원고·대화·참고 자료는 해당 AI 제공자에게 전달됩니다.'));
    for (const provider of ['claude', 'codex'] as const) {
      const pathKey = `${provider}Path` as const, modelKey = `${provider}Model` as const;
      new Setting(container).setName(`${provider === 'claude' ? 'Claude Code' : 'Codex'} 실행 파일`).setDesc('비워두면 자동 탐색합니다. 직접 입력할 때는 절대 경로를 사용하세요.').addText(text => text.setValue(this.plugin.settings[pathKey]).onChange(async value => { this.plugin.settings[pathKey] = value.trim(); await this.plugin.updateSettings(); }));
      new Setting(container).setName(`${provider === 'claude' ? 'Claude Code' : 'Codex'} 모델`).setDesc('비워두면 CLI의 기본 모델을 사용합니다.').addText(text => text.setValue(this.plugin.settings[modelKey]).onChange(async value => { this.plugin.settings[modelKey] = value.trim(); await this.plugin.updateSettings(); }));
      new Setting(container).setName('실행 파일 확인').setDesc('AI 요청 없이 실행 파일의 위치만 확인합니다.').addButton(button => button.setButtonText(`${provider} 확인`).onClick(async () => {
        try { new Notice(await resolveExecutable(provider, this.plugin.settings[pathKey]), 8000); } catch (error) { new Notice(String(error), 8000); }
      }));
    }
    new Setting(container).setName('응답 제한 시간').setDesc('30~1,800초. 기본 300초.').addText(text => text.setValue(String(this.plugin.settings.timeoutSeconds)).onChange(async value => {
      const seconds = Number(value); if (Number.isInteger(seconds) && seconds >= 30 && seconds <= 1800) { this.plugin.settings.timeoutSeconds = seconds; await this.plugin.updateSettings(); }
    }));
  }
}
