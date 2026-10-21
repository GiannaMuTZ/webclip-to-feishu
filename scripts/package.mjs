import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await mkdir('release', { recursive: true });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const filename = `webclip-extension-${version}.zip`;
if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path dist/extension/* -DestinationPath release/${filename} -Force`], { stdio: 'inherit' });
else execFileSync('zip', ['-qr', `../../release/${filename}`, '.'], { cwd: 'dist/extension', stdio: 'inherit' });
console.log(`已打包 release/${filename}（仅包含扩展，不含 .env 和服务凭据）。`);
