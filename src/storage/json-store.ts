import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';

export class JsonStore<T> {
  private queue: Promise<void> = Promise.resolve();
  recovered = false;
  constructor(readonly path: string, private schema: z.ZodType<T>) {}
  async load(): Promise<T | null> {
    try { return this.schema.parse(JSON.parse(await fs.readFile(this.path, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      try {
        const backup = this.schema.parse(JSON.parse(await fs.readFile(this.path + '.bak', 'utf8')));
        await fs.copyFile(this.path, this.path + `.corrupt-${Date.now()}`);
        // Preserve the known-good backup before a future save rotates it.
        await fs.copyFile(this.path + '.bak', this.path);
        this.recovered = true;
        return backup;
      } catch { throw new Error('작업 기록을 읽지 못했습니다. 원본은 보존했습니다. 플러그인 저장 폴더의 JSON과 .bak 파일을 확인해 주세요.', { cause: error }); }
    }
  }
  save(value: T): Promise<void> {
    const serialized = JSON.stringify(this.schema.parse(value), null, 2);
    const write = async () => {
      await fs.mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = this.path + `.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(serialized, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        try { await fs.copyFile(this.path, this.path + '.bak'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await fs.rename(temporary, this.path);
        const directory = await fs.open(dirname(this.path), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } finally { await fs.rm(temporary, { force: true }).catch(() => undefined); }
    };
    const result = this.queue.then(write);
    this.queue = result.catch(() => undefined);
    return result;
  }
  async flush(): Promise<void> { await this.queue; }
}
