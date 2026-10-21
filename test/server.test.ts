import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { createApp, type ServerConfig } from '../src/server.js';
import { JobStore } from '../src/jobs.js';
import { extract } from '../src/extract.js';
const capture = { title: '集成测试', url: 'https://example.org', html: '<main><p>正文 $x^2$</p><table><tr><td>a</td></tr></table></main>', mode: 'article' };
const token = 'test-bridge-token-'.repeat(3);

test('HTTP 预览、鉴权、来源限制与异步导出完整流程', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'webclip-server-')); const jobs = new JobStore(dir); await jobs.init();
  let writes = 0;
  const config: ServerConfig = { token, port: 0, ready: true, jobs, staticDir: 'public', write: async (article, progress) => { writes++; await progress({ documentId: 'test_doc' }); await progress({ completed: article.blocks.length }); return 'test_doc'; } };
  const server = createApp(config).listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  config.port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${config.port}`;
  const api = (url: string, data?: unknown, headers: Record<string, string> = {}) => fetch(base + url, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
  try {
    await t.test('未认证请求被拒绝，健康检查只返回非敏感信息', async () => {
      assert.equal((await fetch(base + '/api/status')).status, 401);
      assert.deepEqual(await (await fetch(base + '/health')).json(), { service: 'webclip-to-feishu', version: '0.1.0' });
    });
    await t.test('不接受任意网站来源、伪造 Host', async () => {
      assert.equal((await api('/api/status', undefined, { Origin: 'https://evil.example' })).status, 403);
      const code = await new Promise<number | undefined>((resolve, reject) => {
        const req = http.get(base + '/api/status', { headers: { Host: 'evil.example', Authorization: `Bearer ${token}` } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject);
      });
      assert.equal(code, 403);
    });
    await t.test('扩展来源可预检，预览中公式和表格真实渲染', async () => {
      const origin = 'chrome-extension://' + 'a'.repeat(32);
      const res = await api('/api/preview', capture, { Origin: origin }); assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), origin);
      const result = await res.json(); assert.match(result.html, /katex/); assert.match(result.html, /<table>/); assert.equal(result.article.stats.formulas, 1);
    });
    await t.test('输入错误在请求阶段被拒绝', async () => {
      assert.equal((await api('/api/preview', { ...capture, url: 'file:///secret' })).status, 400);
      assert.equal((await api('/api/jobs', { id: '../../secret', capture })).status, 400);
    });
    await t.test('相同任务重发仅写入一次，轮询返回成功链接', async () => {
      const id = randomUUID();
      const first = await api('/api/jobs', { id, capture }); assert.equal(first.status, 202);
      await jobs.settled();
      assert.equal((await api('/api/jobs', { id, capture })).status, 202); assert.equal(writes, 1);
      const result = await (await api('/api/jobs/' + id)).json(); assert.equal(result.status, 'done'); assert.equal(result.documentUrl, 'https://feishu.cn/docx/test_doc');
      assert.equal((await api('/api/jobs', { id, capture: { ...capture, title: '不同内容' } })).status, 400);
    });
    await t.test('配置缺失时阻止真实导出，仍允许预览', async () => {
      config.ready = false;
      assert.equal((await api('/api/jobs', { id: randomUUID(), capture })).status, 503);
      assert.equal((await api('/api/preview', capture)).status, 200); config.ready = true;
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});

test('任务失败保留部分文档链接；持久化不保存网页内容和飞书密钥', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'webclip-jobs-'));
  try {
    const jobs = new JobStore(dir); await jobs.init(); const id = randomUUID();
    await jobs.submit(id, extract(capture), async (_article, progress) => { await progress({ documentId: 'partial' }); throw new Error('模拟中断'); });
    await jobs.settled(); const job = jobs.get(id)!;
    assert.equal(job.status, 'failed'); assert.equal(job.documentUrl, 'https://feishu.cn/docx/partial');
    const persisted = await readFile(path.join(dir, 'jobs.json'), 'utf8'); assert.doesNotMatch(persisted, /<main>|app_secret|正文/);
    const restarted = new JobStore(dir); await restarted.init(); assert.equal(restarted.get(id)?.documentId, 'partial');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('重启后将中断任务标记为失败，不自动重复创建文档', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'webclip-restart-'));
  try {
    const id = randomUUID(); await writeFile(path.join(dir, 'jobs.json'), JSON.stringify([{ id, fingerprint: 'abc', status: 'running', documentId: 'old_doc' }]));
    const jobs = new JobStore(dir); await jobs.init(); assert.equal(jobs.get(id)?.status, 'failed'); assert.match(jobs.get(id)?.error ?? '', /服务重启/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
