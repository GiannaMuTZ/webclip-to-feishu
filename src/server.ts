import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { z, ZodError } from 'zod';
import { extract } from './extract.js';
import { render } from './render.js';
import { captureSchema, type Article } from './model.js';
import { JobStore } from './jobs.js';
import type { Progress } from './feishu.js';
export type ServerConfig = { token: string; port: number; ready: boolean; staticDir: string; jobs: JobStore; write: (a: Article, progress: Progress) => Promise<string> };
export function createApp(config: ServerConfig) {
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (![ `127.0.0.1:${config.port}`, `localhost:${config.port}` ].includes(req.headers.host ?? '')) { res.status(403).json({ error: '无效 Host' }); return; }
    const origin = req.headers.origin;
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) && ![`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`].includes(origin)) { res.status(403).json({ error: '不允许此来源' }); return; }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  app.get('/health', (_req, res) => res.json({ service: 'webclip-to-feishu', version: '0.1.0' }));
  app.use('/api', (req, res, next) => {
    const received = Buffer.from(req.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${config.token}`);
    if (!config.token || received.length !== expected.length || !timingSafeEqual(received, expected)) { res.status(401).json({ error: '配对码不正确，请在扩展设置中填写 .env 的 BRIDGE_TOKEN' }); return; }
    next();
  });
  app.use('/api', express.json({ limit: '6mb' }));
  app.get('/api/status', (_req, res) => res.json({ ready: config.ready, message: config.ready ? '本地配置已填写；实际飞书权限将在导入时验证' : '请按配置教程填写 FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_FOLDER_TOKEN 并重启服务' }));
  app.post('/api/preview', (req, res) => { const article = extract(req.body); res.json({ article, html: render(article) }); });
  app.post('/api/jobs', async (req, res) => {
    if (!config.ready) { res.status(503).json({ error: '尚未配置飞书应用，请参阅 docs/FEISHU_SETUP.md' }); return; }
    const input = z.object({ id: z.string().uuid(), capture: captureSchema }).parse(req.body);
    const job = await config.jobs.submit(input.id, extract(input.capture), config.write);
    res.status(202).json(job);
  });
  app.get('/api/jobs/:id', (req, res) => {
    const job = config.jobs.get(req.params.id); if (!job) { res.status(404).json({ error: '任务不存在或历史记录已过期' }); return; } res.json(job);
  });
  app.use(express.static(path.resolve(config.staticDir), { index: 'index.html', dotfiles: 'deny' }));
  app.use((_req, res) => res.status(404).json({ error: '未找到此接口' }));
  app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError) { res.status(400).json({ error: err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；') }); return; }
    res.status(err.status === 413 ? 413 : 400).json({ error: err.status === 413 ? '页面内容超过 6 MB，请缩小选区' : err.message });
  });
  return app;
}
