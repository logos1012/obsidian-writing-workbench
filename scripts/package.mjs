import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const manifest = JSON.parse(await fs.readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Package and manifest versions differ');
const destination = join('dist', manifest.id);
await fs.mkdir(destination, { recursive: true });
const files = ['main.js', 'manifest.json', 'styles.css', 'README.md'];
const checksums = [];
for (const file of files) {
  const content = await fs.readFile(file);
  await fs.writeFile(join(destination, file), content);
  checksums.push(`${createHash('sha256').update(content).digest('hex')}  ${file}`);
}
await fs.writeFile(join(destination, 'SHA256SUMS'), checksums.join('\n') + '\n');
await fs.cp('docs', join(destination, 'docs'), { recursive: true });
console.log(`Installable plugin: ${destination}`);
