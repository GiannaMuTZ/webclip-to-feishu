import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Article } from './model.js';
import type { Progress } from './feishu.js';
export type Job = { id: string; fingerprint: string; status: 'queued' | 'running' | 'done' | 'failed'; completed: number; total: number; createdAt: string; documentId?: string; documentUrl?: string; error?: string };
export class JobStore {
  private jobs = new Map<string, Job>();
  private queue = Promise.resolve();
  private writing = Promise.resolve();
  constructor(private dir: string, private docBase = 'https://feishu.cn') {}
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      const stored = JSON.parse(await readFile(path.join(this.dir, 'jobs.json'), 'utf8')) as Job[];
      for (const job of stored.slice(-500)) {
        if (['running', 'queued'].includes(job.status)) { job.status = 'failed'; job.error = '服务重启中断了任务。请先检查已创建文档，再重新提取导入。'; }
        this.jobs.set(job.id, job);
      }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('任务记录损坏，请备份 .data/jobs.json 后修复或移走该文件'); }
    await this.persist();
  }
  get(id: string) { return this.jobs.get(id); }
  private persist() {
    const payload = JSON.stringify([...this.jobs.values()]);
    this.writing = this.writing.then(async () => {
      const temporary = path.join(this.dir, `jobs.${randomUUID()}.tmp`);
      await writeFile(temporary, payload, { mode: 0o600 }); await rename(temporary, path.join(this.dir, 'jobs.json'));
    });
    return this.writing;
  }
  async submit(id: string, article: Article, run: (article: Article, progress: Progress) => Promise<string>): Promise<Job> {
    const fingerprint = createHash('sha256').update(JSON.stringify(article)).digest('hex');
    const existing = this.jobs.get(id);
    if (existing) { if (existing.fingerprint !== fingerprint) throw new Error('同一任务编号对应了不同内容，请重新提取'); return existing; }
    if ([...this.jobs.values()].filter(j => j.status === 'queued' || j.status === 'running').length >= 10) throw new Error('任务队列已满，请等待现有任务完成');
    if (this.jobs.size >= 500) {
      const oldest = [...this.jobs.values()].find(j => ['done', 'failed'].includes(j.status)); if (oldest) this.jobs.delete(oldest.id);
    }
    const job: Job = { id, fingerprint, status: 'queued', completed: 0, total: article.blocks.length, createdAt: new Date().toISOString() };
    this.jobs.set(id, job); await this.persist();
    this.queue = this.queue.then(async () => {
      try {
        job.status = 'running'; await this.persist();
        const documentId = await run(article, async update => {
          Object.assign(job, update);
          if (job.documentId) job.documentUrl = `${this.docBase}/docx/${encodeURIComponent(job.documentId)}`;
          await this.persist();
        });
        job.documentId = documentId; job.documentUrl = `${this.docBase}/docx/${encodeURIComponent(documentId)}`; job.status = 'done';
      } catch (e) { job.status = 'failed'; job.error = (e as Error).name === 'TimeoutError' || (e as Error).message === 'fetch failed' ? '网络请求中断，写入状态可能不确定。请先检查部分文档，再重新导入。' : (e as Error).message; }
      await this.persist();
    }).catch(e => { console.error('任务状态无法持久化：', (e as Error).message); });
    return job;
  }
  async settled() { await this.queue; }
}
