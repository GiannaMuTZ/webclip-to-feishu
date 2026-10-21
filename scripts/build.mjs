import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/extension', { recursive: true });
await mkdir('dist/public', { recursive: true });
await build({ entryPoints: ['src/main.ts'], bundle: true, platform: 'node', packages: 'external', format: 'esm', target: 'node22', outdir: 'dist/server', sourcemap: true });
await build({ entryPoints: ['extension/popup.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'chrome120', outdir: 'dist/extension' });
await build({ entryPoints: ['public/demo.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'chrome120', outdir: 'dist/public' });
for (const name of ['manifest.json', 'popup.html', 'popup.css']) await cp(`extension/${name}`, `dist/extension/${name}`);
for (const name of ['index.html', 'demo.html', 'style.css']) await cp(`public/${name}`, `dist/public/${name}`);
for (const dir of ['dist/extension/katex', 'dist/public/katex']) {
  await mkdir(dir, { recursive: true });
  await cp('node_modules/katex/dist/katex.min.css', `${dir}/katex.min.css`);
  await cp('node_modules/katex/LICENSE', `${dir}/LICENSE`);
  await cp('node_modules/katex/dist/fonts', `${dir}/fonts`, { recursive: true });
}
console.log('已构建本地服务、演示页和 dist/extension 浏览器扩展。');
