import { build } from 'esbuild';
import { spawn } from 'node:child_process';
await build({ entryPoints: ['scripts/smoke.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-artifacts/smoke.mjs' });
const child = spawn(process.execPath, ['.test-artifacts/smoke.mjs', ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('close', code => { process.exitCode = code ?? 1; });
