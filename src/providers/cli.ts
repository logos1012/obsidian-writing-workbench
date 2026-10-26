import { promises as fs, constants } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { AgentReplySchema, replyJsonSchema, type AgentReply, type Provider, type Settings } from '../domain/model';
import { runProcess } from './process';

export interface AgentRequest {
  provider: Provider; prompt: string; research: boolean; signal: AbortSignal; settings: Settings;
  onProgress?: (phase: 'running' | 'processing') => void;
}
export interface Agent { run(request: AgentRequest): Promise<AgentReply> }
export async function resolveExecutable(provider: Provider, configured: string): Promise<string> {
  const name = provider === 'claude' ? 'claude' : 'codex';
  if (configured && !isAbsolute(configured)) throw new Error('CLI 경로는 실행 파일의 절대 경로로 입력해 주세요.');
  const dirs = [...(process.env.PATH ?? '').split(':'), join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  const candidates = configured ? [configured] : dirs.filter(Boolean).map(dir => join(dir, name));
  for (const path of candidates) {
    try { await fs.access(path, constants.X_OK); if ((await fs.stat(path)).isFile()) return path; } catch { /* Try next candidate. */ }
  }
  throw new Error(`${name} 실행 파일을 찾지 못했습니다. 설정에 터미널의 command -v ${name} 결과를 입력해 주세요.`);
}
export function buildArgs(provider: Provider, settings: Settings, research: boolean, directory: string): string[] {
  if (provider === 'claude') {
    return ['--print', '--output-format', 'json', '--json-schema', JSON.stringify(replyJsonSchema),
      '--no-session-persistence', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--disable-slash-commands', '--no-chrome',
      '--permission-mode', 'dontAsk', '--tools', research ? 'WebSearch,WebFetch' : '',
      ...(research ? ['--allowedTools', 'WebSearch,WebFetch'] : []),
      ...(settings.claudeModel ? ['--model', settings.claudeModel] : []),
    ];
  }
  return ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '--color', 'never', '--json',
    '--disable', 'shell_tool', '--disable', 'multi_agent', '--disable', 'hooks',
    '-c', 'approval_policy="never"', '-c', `web_search="${research ? 'live' : 'disabled'}"`,
    '-c', 'project_doc_max_bytes=0',
    '--output-schema', join(directory, 'schema.json'), '--output-last-message', join(directory, 'response.json'),
    ...(settings.codexModel ? ['--model', settings.codexModel] : []), '-'];
}
export class CliAgent implements Agent {
  async run(request: AgentRequest): Promise<AgentReply> {
    const { provider, settings, signal, research } = request;
    const executable = await resolveExecutable(provider, provider === 'claude' ? settings.claudePath : settings.codexPath);
    const directory = await fs.mkdtemp(join(tmpdir(), 'writing-workbench-'));
    await fs.chmod(directory, 0o700);
    try {
      await fs.writeFile(join(directory, 'schema.json'), JSON.stringify(replyJsonSchema), { mode: 0o600 });
      const env = { ...process.env };
      // A task-local invocation must not inherit the host agent's nested-session marker.
      delete env.CLAUDECODE;
      env.PATH = [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', env.PATH ?? ''].join(':');
      const result = await runProcess({ executable, args: buildArgs(provider, settings, research, directory), cwd: directory,
        input: request.prompt, timeoutMs: settings.timeoutSeconds * 1000, signal, env, onStart: () => request.onProgress?.('running') });
      if (signal.aborted) throw new Error('요청을 중지했습니다.');
      request.onProgress?.('processing');
      let data: unknown;
      if (provider === 'claude') {
        let envelope: Record<string, unknown>;
        try { envelope = JSON.parse(result.stdout) as Record<string, unknown>; }
        catch { throw new Error('Claude Code의 JSON 응답을 읽지 못했습니다. CLI 버전을 확인해 주세요.'); }
        if (envelope.is_error || (typeof envelope.subtype === 'string' && envelope.subtype !== 'success')) {
          throw new Error('Claude Code가 요청을 완료하지 못했습니다. 터미널에서 로그인·사용 한도를 확인한 뒤 다시 시도해 주세요.');
        }
        if (research && Array.isArray(envelope.permission_denials) && envelope.permission_denials.length) {
          throw new Error('Claude Code의 자료 검색 도구가 허용되지 않았습니다. CLI의 관리 정책과 웹 도구 설정을 확인해 주세요.');
        }
        data = envelope.structured_output;
        if (!data && typeof envelope.result === 'string') {
          try { data = JSON.parse(envelope.result); } catch { /* Schema error below. */ }
        }
      } else {
        const file = join(directory, 'response.json');
        if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw new Error('AI 최종 응답이 너무 큽니다.');
        try { data = JSON.parse(await fs.readFile(file, 'utf8')); }
        catch { throw new Error('Codex의 구조화 응답을 읽지 못했습니다. 다시 요청해 주세요.'); }
      }
      const parsed = AgentReplySchema.safeParse(data);
      if (!parsed.success) throw new Error('AI 응답 형식이 올바르지 않습니다. 원고를 변경하지 않았습니다. 다시 요청해 주세요.');
      return parsed.data;
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
}
