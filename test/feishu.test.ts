import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { extract } from '../src/extract.js';
import { FeishuClient, elements, splitTable, writeArticle, type Json, type Transport } from '../src/feishu.js';
const sample = (html: string) => extract({ title: '测试', url: 'https://example.org', html, mode: 'page' });
const response = (data: Json, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('按创建文档→表格骨架→单元格→合并顺序写入，使用原生 equation', async () => {
  const calls: { method: string; path: string; body?: Json }[] = []; let n = 0;
  const request: Transport = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === 'docx/v1/documents') return { document: { document_id: 'doc_123' } };
    if (body?.children) return { children: body.children.map((b: Json) => b.block_type === 31 ? { ...b, block_id: 'table_1', table: { ...b.table, cells: ['c1', 'c2', 'c3', 'c4'] } } : { ...b, block_id: `b${n++}` }) };
    return {};
  };
  let knownId = '';
  await writeArticle(sample('<p>$x^2$</p><table><tr><th colspan="2">标题</th></tr><tr><td>$a$</td><td>b</td></tr></table>'), 'folder', request, async u => { if (u.documentId) knownId = u.documentId; });
  assert.equal(knownId, 'doc_123');
  assert.ok(calls.some(c => JSON.stringify(c.body).includes('"equation":{"content":"x^2"}')));
  const skeleton = calls.findIndex(c => c.body?.children?.[0]?.block_type === 31); const merge = calls.findIndex(c => c.method === 'PATCH');
  assert.ok(skeleton > 0 && merge > skeleton); assert.ok(calls.slice(skeleton + 1, merge).some(c => c.path.includes('/c3/children')));
  assert.equal(calls[merge].body?.requests[0].merge_table_cells.column_end_index, 2);
});
test('长文本分批且不破坏 emoji 的 UTF-16 配对', async () => {
  const article = sample(`<p>${'😀'.repeat(5000)}</p>`); const sizes: number[] = [];
  await writeArticle(article, 'folder', async (_m, path, body) => {
    if (path === 'docx/v1/documents') return { document: { document_id: 'doc' } };
    if (body?.children) { sizes.push(body.children.length); return { children: body.children.map((b: Json) => ({ ...b, block_id: 'id' })) }; }
    return {};
  });
  assert.ok(sizes.every(n => n <= 30));
  const runs = elements([{ kind: 'text', text: '😀'.repeat(3000) }]);
  assert.equal(runs.map(r => r.text_run.content).join(''), '😀'.repeat(3000));
});
test('链接按飞书 schema URL 编码', () => {
  assert.equal(elements([{ kind: 'text', text: '链接', style: { link: { url: 'https://example.org/中文?a=1&b=2' } } }])[0].text_run.text_element_style.link.url, encodeURIComponent('https://example.org/中文?a=1&b=2'));
});
test('大表格分片，跨分片合并内容仍保留', () => {
  const parts = splitTable({ kind: 'table', rows: 101, cols: 10, cells: [{ row: 99, col: 8, rowspan: 2, colspan: 2, header: false, elements: [{ kind: 'text', text: '跨界' }] }] });
  assert.equal(parts.length, 4); assert.ok(parts.every(p => p.rows <= 100 && p.cols <= 9));
  assert.equal(parts.reduce((n, p) => n + p.cells.length, 0), 4);
});
test('部分写入失败前先记录 document_id', async () => {
  let id: string | undefined;
  await assert.rejects(writeArticle(sample('<p>x</p>'), 'f', async (_m, path) => { if (path === 'docx/v1/documents') return { document: { document_id: 'partial_doc' } }; throw new Error('offline'); }, async u => { id = u.documentId; }), /offline/);
  assert.equal(id, 'partial_doc');
});
test('表格 API 返回不完整时停止，不写入错误单元格', async () => {
  await assert.rejects(writeArticle(sample('<table><tr><td>x</td></tr></table>'), 'f', async (_m, path, body) => path === 'docx/v1/documents' ? { document: { document_id: 'd' } } : { children: body?.children.map((b: Json) => ({ ...b, block_id: 'x', ...(b.block_type === 31 ? { table: { cells: [] } } : {}) })) }), /完整表格/);
});
test('飞书 token 缓存，429 被拒绝的请求按退避重试', async () => {
  let auth = 0; let calls = 0;
  const client = new FeishuClient({ appId: 'app', appSecret: 'secret' }, (async (url: string) => {
    if (url.includes('/auth/')) { auth++; return response({ code: 0, tenant_access_token: 'token', expire: 7200 }); }
    calls++; return calls === 1 ? response({ code: 99991400 }, 429) : response({ code: 0, data: { ok: true } });
  }) as typeof fetch, (async () => {}) as typeof delay, 0);
  await client.request('POST', 'docx/v1/documents', {}); await client.request('GET', 'docx/v1/documents/id');
  assert.equal(auth, 1); assert.equal(calls, 3);
});
test('认证被明确拒绝后只刷新 token，不复制已成功的写入', async () => {
  let auth = 0; let calls = 0;
  const client = new FeishuClient({ appId: 'a', appSecret: 'b' }, (async (url: string) => {
    if (url.includes('/auth/')) { auth++; return response({ code: 0, tenant_access_token: 'token', expire: 7200 }); }
    calls++; return response(calls === 1 ? { code: 99991663 } : { code: 0, data: {} });
  }) as typeof fetch, (async () => {}) as typeof delay, 0);
  await client.request('POST', 'docx/v1/documents', {}); assert.equal(auth, 2); assert.equal(calls, 2);
});
test('不对网络失败和 500 写入盲目重试，避免重复文档', async () => {
  for (const failure of ['network', 'server']) {
    let calls = 0;
    const client = new FeishuClient({ appId: 'a', appSecret: 'b' }, (async (url: string) => {
      if (url.includes('/auth/')) return response({ code: 0, tenant_access_token: 'token', expire: 7200 });
      calls++; if (failure === 'network') throw new Error('fetch failed'); return response({ code: 500 }, 500);
    }) as typeof fetch, (async () => {}) as typeof delay, 0);
    await assert.rejects(client.request('POST', 'docx/v1/documents', {})); assert.equal(calls, 1);
  }
});
