import { setTimeout as delay } from 'node:timers/promises';
import type { Article, Block, Inline, Table } from './model.js';

export type Json = Record<string, any>;
export type Transport = (method: string, path: string, body?: Json) => Promise<Json>;
export type Progress = (state: { documentId?: string; completed?: number; total?: number }) => Promise<void>;
const types = { text: 2, heading1: 3, heading2: 4, heading3: 5, heading4: 6, heading5: 7, heading6: 8, bullet: 12, ordered: 13, quote: 15 };

export function elements(input: Inline[]): Json[] {
  const out = input.flatMap(e => {
    if (e.kind === 'math') return [{ equation: { content: e.latex } }];
    const style = e.style ? { ...e.style, ...(e.style.link ? { link: { url: encodeURIComponent(e.style.link.url) } } : {}) } : {};
    // Respect the per-text-run limit without cutting surrogate pairs.
    const chars = Array.from(e.text); const runs: Json[] = [];
    for (let i = 0; i < chars.length; i += 1000) runs.push({ text_run: { content: chars.slice(i, i + 1000).join(''), text_element_style: style } });
    return runs;
  });
  return out.length ? out : [{ text_run: { content: ' ' } }];
}

function splitElements(input: Json[], limit = 1500): Json[][] {
  const chunks: Json[][] = []; let current: Json[] = []; let length = 0;
  for (const el of input) {
    const size = (el.text_run?.content ?? el.equation?.content ?? '').length;
    if (current.length && (length + size > limit || current.length >= 50)) { chunks.push(current); current = []; length = 0; }
    current.push(el); length += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
export function blocksFor(block: Exclude<Block, Table>): Json[] {
  if (block.kind === 'divider') return [{ block_type: 22, divider: {} }];
  if (block.kind === 'code') return splitElements(elements([{ kind: 'text', text: block.text }])).map(els => ({ block_type: 14, code: { elements: els, style: { language: 1, wrap: true } } }));
  return splitElements(elements(block.elements)).map(els => ({ block_type: types[block.type], [block.type]: { elements: els, ...(block.displayMath ? { style: { align: 2 } } : {}) } }));
}

export function splitTable(table: Table): Table[] {
  const result: Table[] = [];
  for (let r = 0; r < table.rows; r += 100) for (let c = 0; c < table.cols; c += 9) {
    const rows = Math.min(100, table.rows - r); const cols = Math.min(9, table.cols - c);
    const cells = table.cells.filter(x => x.row < r + rows && x.row + x.rowspan > r && x.col < c + cols && x.col + x.colspan > c).map(x => ({
      ...x, row: Math.max(x.row, r) - r, col: Math.max(x.col, c) - c,
      rowspan: Math.min(x.row + x.rowspan, r + rows) - Math.max(x.row, r),
      colspan: Math.min(x.col + x.colspan, c + cols) - Math.max(x.col, c),
    }));
    result.push({ kind: 'table', rows, cols, cells });
  }
  return result;
}

export class FeishuClient {
  private token = ''; private expires = 0; private lastRequest = 0;
  constructor(private config: { appId: string; appSecret: string }, private fetcher: typeof fetch = fetch, private sleep: typeof delay = delay, private interval = 400) {}
  private async authenticate() {
    if (this.token && Date.now() < this.expires) return this.token;
    const res = await this.fetcher('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }), signal: AbortSignal.timeout(20000),
    });
    const data = await res.json() as Json;
    if (!res.ok || data.code !== 0 || !data.tenant_access_token) throw new Error(`飞书认证失败 (${data.code ?? res.status})：请检查 App ID、App Secret 和应用发布状态`);
    this.token = data.tenant_access_token; this.expires = Date.now() + Math.max(0, (data.expire ?? 7200) - 120) * 1000;
    return this.token;
  }
  request: Transport = async (method, path, body) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const token = await this.authenticate();
      await this.sleep(Math.max(0, this.lastRequest + this.interval - Date.now())); this.lastRequest = Date.now();
      // Mutations are never blindly retried after network failures / ambiguous 5xx.
      const res = await this.fetcher(`https://open.feishu.cn/open-apis/${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
      });
      const data = await res.json() as Json;
      if (data.code === 99991663 && attempt < 3) { this.token = ''; continue; }
      if ((res.status === 429 || [99991400, 99991403].includes(data.code)) && attempt < 3) {
        const retry = Number(res.headers.get('retry-after'));
        await this.sleep(Math.min(30000, Math.max(retry * 1000 || 0, 1000 * 2 ** attempt))); continue;
      }
      if (!res.ok || data.code !== 0) {
        const hint = [99991672, 99991679, 1770032].includes(data.code) || res.status === 403 ? '；请检查应用权限、版本发布状态和目标文件夹的机器人编辑权限' : '';
        throw new Error(`飞书接口错误 (${data.code ?? res.status})${hint}；操作：${method} ${path.split('?')[0]}`);
      }
      return data.data ?? {};
    }
    throw new Error('飞书接口持续限流，请稍后重试');
  };
}

export async function writeArticle(article: Article, folderToken: string, request: Transport, progress: Progress = async () => {}): Promise<string> {
  const data = await request('POST', 'docx/v1/documents', { title: article.title, folder_token: folderToken });
  const id = data.document?.document_id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('飞书未返回有效 document_id');
  await progress({ documentId: id, completed: 0, total: article.blocks.length });
  const base = `docx/v1/documents/${id}/blocks`;
  const append = async (parent: string, children: Json[]) => {
    const created: Json[] = [];
    for (let i = 0; i < children.length; i += 30) {
      const result = await request('POST', `${base}/${parent}/children?document_revision_id=-1`, { children: children.slice(i, i + 30) });
      if (!Array.isArray(result.children) || result.children.length !== Math.min(30, children.length - i)) throw new Error('飞书返回的内容块数量不完整');
      created.push(...result.children);
    }
    return created;
  };
  await append(id, [{ block_type: 2, text: { elements: elements([{ kind: 'text', text: '来源：' }, { kind: 'text', text: article.url, style: { link: { url: article.url } } }]) } }, { block_type: 22, divider: {} }]);
  let pending: Json[] = []; let completed = 0;
  const flush = async () => { if (pending.length) { await append(id, pending); pending = []; await progress({ completed }); } };
  for (const block of article.blocks) {
    if (block.kind !== 'table') { pending.push(...blocksFor(block)); completed++; if (pending.length >= 30) await flush(); continue; }
    await flush();
    for (const t of splitTable(block)) {
      const [created] = await append(id, [{ block_type: 31, table: { property: { row_size: t.rows, column_size: t.cols } } }]);
      const cellIds: string[] = created.table?.cells;
      if (!Array.isArray(cellIds) || cellIds.length !== t.rows * t.cols) throw new Error('飞书未返回完整表格单元格，已停止写入');
      for (const cell of t.cells) {
        const value = cell.elements.map(e => cell.header && e.kind === 'text' ? { ...e, style: { ...e.style, bold: true } } : e);
        if (value.length) await append(cellIds[cell.row * t.cols + cell.col], blocksFor({ kind: 'paragraph', type: 'text', elements: value }));
      }
      // Merge only after writing the anchor cells; covered cells remain empty.
      const merges = t.cells.filter(c => c.rowspan > 1 || c.colspan > 1).map(c => ({ block_id: created.block_id, merge_table_cells: {
        row_start_index: c.row, row_end_index: c.row + c.rowspan, column_start_index: c.col, column_end_index: c.col + c.colspan,
      } }));
      for (let i = 0; i < merges.length; i += 20) await request('PATCH', `${base}/batch_update?document_revision_id=-1`, { requests: merges.slice(i, i + 20) });
    }
    completed++; await progress({ completed });
  }
  await flush(); await progress({ completed }); return id;
}
