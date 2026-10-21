import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
let content;
try { content = await readFile('.env', 'utf8'); }
catch (e) { if (e.code !== 'ENOENT') throw e; content = await readFile('.env.example', 'utf8'); }
if (!/^BRIDGE_TOKEN=.{32,}$/m.test(content)) content = content.replace(/^BRIDGE_TOKEN=.*$/m, `BRIDGE_TOKEN=${randomBytes(32).toString('hex')}`);
await writeFile('.env', content, { mode: 0o600 }); await chmod('.env', 0o600);
console.log('本地配置已准备好。打开 .env 填写飞书配置；将 BRIDGE_TOKEN 复制到扩展连接设置。现有非空配置已保留。');
