import esbuild from 'esbuild';
const options = {
  entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs',
  target: 'es2022', external: ['obsidian', 'electron'], outfile: 'main.js',
  sourcemap: false, logLevel: 'info',
  banner: { js: '/* Writing Workbench — generated build */' },
};
if (process.argv.includes('--watch')) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
