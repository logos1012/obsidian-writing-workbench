import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { JsonStore } from '../src/storage/json-store';

const directories: string[] = [];
async function fixture() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'ww-store-test-')); directories.push(directory);
  return { directory, path: join(directory, 'record.json'), schema: z.object({ value: z.number() }).strict() };
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => fs.rm(path, { recursive: true, force: true }))); });
describe('durable state', () => {
  it('serializes rapid saves and retains a previous valid backup', async () => {
    const f = await fixture(); const store = new JsonStore(f.path, f.schema);
    await Promise.all(Array.from({ length: 20 }, (_, value) => store.save({ value })));
    expect(await store.load()).toEqual({ value: 19 });
    expect(JSON.parse(await fs.readFile(f.path + '.bak', 'utf8'))).toEqual({ value: 18 });
    expect((await fs.readdir(f.directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });
  it('recovers corruption without deleting the corrupt original or damaging the backup', async () => {
    const f = await fixture(); const store = new JsonStore(f.path, f.schema);
    await store.save({ value: 1 }); await store.save({ value: 2 }); await fs.writeFile(f.path, '{broken');
    expect(await store.load()).toEqual({ value: 1 }); expect(store.recovered).toBe(true);
    expect((await fs.readdir(f.directory)).some(name => name.includes('.corrupt-'))).toBe(true);
    await store.save({ value: 3 }); expect(JSON.parse(await fs.readFile(f.path + '.bak', 'utf8'))).toEqual({ value: 1 });
  });
  it('fails closed when neither current state nor backup is valid', async () => {
    const f = await fixture(); await fs.writeFile(f.path, '{broken');
    await expect(new JsonStore(f.path, f.schema).load()).rejects.toThrow('원본은 보존');
    expect(await fs.readFile(f.path, 'utf8')).toBe('{broken');
  });
  it('does not treat a future schema as an empty new project', async () => {
    const f = await fixture(); await fs.writeFile(f.path, '{"value":"unsupported"}');
    await expect(new JsonStore(f.path, f.schema).load()).rejects.toThrow();
  });
});
