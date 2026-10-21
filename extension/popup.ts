import { capturePage } from './capture.js';
import type { Capture } from '../src/model.js';
import type { Job } from '../src/jobs.js';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (message: string, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
let config = { port: 17321, token: '' }; let capture: Capture | undefined; let taskId = crypto.randomUUID(); let polling = false; let busy = false;
async function api(path: string, body?: unknown) {
  let res: Response;
  try { res = await fetch(`http://127.0.0.1:${config.port}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${config.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) }); }
  catch { throw new Error('无法连接本地服务，请运行 npm start 并检查端口。若提交结果不确定，可再次点击保存查询同一任务。'); }
  const result = await res.json(); if (!res.ok) throw new Error(result.error ?? `请求失败 ${res.status}`); return result;
}
function showJob(job: Job) {
  const link = $<HTMLAnchorElement>('document');
  link.hidden = !job.documentUrl;
  if (job.documentUrl && /^https:\/\/([a-z0-9-]+\.)*feishu\.cn\/docx\/[A-Za-z0-9_-]+$/.test(job.documentUrl)) { link.href = job.documentUrl; link.textContent = job.status === 'done' ? '打开飞书文档 ↗' : '查看已创建的部分文档 ↗'; }
  else link.hidden = true;
  const progress = $<HTMLProgressElement>('progress'); progress.hidden = ['done', 'failed'].includes(job.status); progress.max = Math.max(1, job.total); progress.value = job.completed;
  const messages = { queued: '已加入队列，关闭窗口后仍会继续。', running: `正在保存 ${job.completed}/${job.total} 个内容块，关闭窗口后仍会继续。`, done: '已保存到飞书，公式和表格均可在文档中编辑。', failed: `保存中断：${job.error ?? '未知错误'}${job.documentId ? '\n请先查看部分文档；重新提取会创建新文档。' : ''}` };
  status(messages[job.status], job.status === 'failed');
}
async function poll(id: string) {
  if (polling) return; polling = true; busy = true; $<HTMLButtonElement>('export').disabled = true; $<HTMLButtonElement>('capture').disabled = true;
  try {
    while (true) {
      const job = await api(`/api/jobs/${id}`) as Job; showJob(job);
      if (job.status === 'done' || job.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
  } catch (e) { status((e as Error).message, true); }
  finally { polling = false; busy = false; $<HTMLButtonElement>('capture').disabled = false; }
}
$('save').addEventListener('click', async () => {
  if (busy) return;
  try {
    const port = Number($<HTMLInputElement>('port').value); const token = $<HTMLInputElement>('token').value.trim();
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || token.length < 32) throw new Error('请填写有效端口和至少 32 字符的配对码');
    config = { port, token }; await chrome.storage.local.set({ config });
    const result = await api('/api/status'); $('connection').textContent = result.ready ? '服务已连接' : '待配置飞书'; status(result.message); $<HTMLDetailsElement>('settings').open = !result.ready;
  } catch (e) { status((e as Error).message, true); }
});
$('capture').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('capture'); button.disabled = true; status('正在提取当前页面…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab.id) throw new Error('未找到当前网页');
    const mode = $<HTMLSelectElement>('mode').value as Capture['mode'];
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: capturePage, args: [mode] });
    if (!result.result) throw new Error('无法读取网页，请确认页面加载完成；浏览器内置页暂不支持');
    capture = result.result;
    const preview = await api('/api/preview', capture);
    taskId = crypto.randomUUID(); $('result').hidden = false; $<HTMLInputElement>('title').value = preview.article.title;
    // Only our local renderer's escaped, normalized output is inserted, never captured page HTML.
    $('preview').innerHTML = preview.html;
    $('stats').replaceChildren(...[['内容块', preview.article.stats.blocks], ['公式', preview.article.stats.formulas], ['表格', preview.article.stats.tables]].map(([label, n]) => { const span = document.createElement('span'); span.textContent = `${n} ${label}`; return span; }));
    $('warnings').hidden = !preview.article.warnings.length; $('warnings').textContent = preview.article.warnings.join('\n');
    $<HTMLButtonElement>('export').disabled = false; $('document').hidden = true; status('预览已生成，确认内容后保存到飞书。');
  } catch (e) { capture = undefined; $('result').hidden = true; status((e as Error).message, true); }
  finally { button.disabled = false; }
});
$('export').addEventListener('click', async () => {
  if (!capture || busy) return;
  const button = $<HTMLButtonElement>('export'); button.disabled = true;
  try {
    capture.title = $<HTMLInputElement>('title').value.trim() || capture.title;
    await chrome.storage.local.set({ lastJob: taskId });
    const job = await api('/api/jobs', { id: taskId, capture }); showJob(job); await poll(job.id);
  } catch (e) { status((e as Error).message, true); button.disabled = false; }
});
async function init() {
  const saved = await chrome.storage.local.get(['config', 'lastJob']);
  if (saved.config) config = saved.config;
  $<HTMLInputElement>('port').value = String(config.port); $<HTMLInputElement>('token').value = config.token;
  if (!config.token) { $<HTMLDetailsElement>('settings').open = true; return; }
  try { const s = await api('/api/status'); $('connection').textContent = s.ready ? '服务已连接' : '待配置飞书'; status(s.message); if (saved.lastJob) await poll(saved.lastJob); }
  catch (e) { status((e as Error).message, true); }
}
void init();
