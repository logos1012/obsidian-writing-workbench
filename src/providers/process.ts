import { spawn } from 'node:child_process';

export interface ProcessRequest {
  executable: string; args: string[]; cwd: string; input: string;
  signal: AbortSignal; timeoutMs: number; env?: NodeJS.ProcessEnv;
}
export interface ProcessResult { stdout: string; stderr: string }
export function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (request.signal.aborted) { reject(new Error('요청을 중지했습니다.')); return; }
    let stdout = '', stderr = '', bytes = 0;
    let failure: Error | undefined;
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(request.executable, request.args, {
      cwd: request.cwd, env: request.env ?? process.env, shell: false,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* The process may already have exited. */ }
    };
    const stop = (message: string) => {
      if (failure) return;
      failure = new Error(message); kill('SIGTERM');
      hardKill = setTimeout(() => kill('SIGKILL'), 1500);
    };
    const abort = () => stop('요청을 중지했습니다. 원고는 변경되지 않았습니다.');
    const timeout = setTimeout(() => stop('AI 응답 시간이 초과됐습니다. 설정에서 제한 시간을 조정하거나 다시 요청해 주세요.'), request.timeoutMs);
    request.signal.addEventListener('abort', abort, { once: true });
    const cleanup = () => {
      clearTimeout(timeout); if (hardKill) clearTimeout(hardKill);
      request.signal.removeEventListener('abort', abort);
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 8 * 1024 * 1024) stop('AI 응답이 허용 크기를 넘었습니다. 범위를 줄여 다시 요청해 주세요.');
      else stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8000); });
    child.stdin.on('error', () => { /* EPIPE is reported via exit status. */ });
    child.once('error', error => { cleanup(); reject(new Error('CLI 실행에 실패했습니다. 설정의 실행 파일 경로와 설치 상태를 확인해 주세요.', { cause: error })); });
    child.once('close', code => {
      if (failure) kill('SIGKILL');
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`CLI가 종료 코드 ${code ?? 'unknown'}로 끝났습니다. 터미널에서 로그인과 실행 여부를 확인해 주세요.\n${redact(stderr).slice(-1600)}`));
      else resolve({ stdout, stderr });
    });
    child.stdin.end(request.input);
    if (request.signal.aborted) abort();
  });
}
function redact(value: string): string {
  return value.replace(/(?:sk-|sk-ant-)[A-Za-z0-9_-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}
