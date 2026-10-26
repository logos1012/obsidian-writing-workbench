import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { runProcess } from '../src/providers/process';
import { buildArgs, resolveExecutable } from '../src/providers/cli';
import { defaultSettings, safeSourceUrl } from '../src/domain/model';

describe('CLI execution boundaries', () => {
  it('passes untrusted prompt text through stdin without shell interpretation', async () => {
    const input = '`echo hacked` $(touch /tmp/unwanted) ; 한글';
    const result = await runProcess({ executable: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'], cwd: tmpdir(), input, timeoutMs: 2000, signal: new AbortController().signal });
    expect(result.stdout).toBe(input);
  });
  it('kills a long-running process on timeout', async () => {
    await expect(runProcess({ executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: tmpdir(), input: '', timeoutMs: 50, signal: new AbortController().signal })).rejects.toThrow('초과');
  });
  it('supports cancellation and reports spawn failures', async () => {
    const controller = new AbortController();
    const promise = runProcess({ executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: tmpdir(), input: '', timeoutMs: 2000, signal: controller.signal });
    controller.abort(); await expect(promise).rejects.toThrow('중지');
    await expect(runProcess({ executable: '/nonexistent/ww-cli', args: [], cwd: tmpdir(), input: '', timeoutMs: 2000, signal: new AbortController().signal })).rejects.toThrow('CLI 실행');
  });
  it('rejects output beyond the memory budget', async () => {
    await expect(runProcess({ executable: process.execPath, args: ['-e', 'process.stdout.write("a".repeat(9*1024*1024))'], cwd: tmpdir(), input: '', timeoutMs: 2000, signal: new AbortController().signal })).rejects.toThrow('허용 크기');
  });
  it('restricts tools, external search and inherited config for normal requests', () => {
    const claude = buildArgs('claude', defaultSettings, false, '/tmp/ww');
    expect(claude[claude.indexOf('--tools') + 1]).toBe(''); expect(claude).toContain('--strict-mcp-config');
    expect(claude).not.toContain('--dangerously-skip-permissions');
    const codex = buildArgs('codex', defaultSettings, false, '/tmp/ww');
    expect(codex).toContain('read-only'); expect(codex).toContain('web_search="disabled"'); expect(codex).toContain('--ignore-user-config');
    expect(buildArgs('codex', defaultSettings, true, '/tmp/ww')).toContain('web_search="live"');
    expect(buildArgs('claude', defaultSettings, true, '/tmp/ww')).toContain('WebSearch,WebFetch');
  });
  it('does not interpret configured executable paths as commands', async () => {
    await expect(resolveExecutable('claude', 'claude; echo hacked')).rejects.toThrow('절대 경로');
  });
  it('allows http(s) citations only', () => {
    expect(safeSourceUrl('javascript:alert(1)')).toBeNull(); expect(safeSourceUrl('file:///etc/passwd')).toBeNull();
    expect(safeSourceUrl('https://example.com/report')).toBe('https://example.com/report');
  });
});
