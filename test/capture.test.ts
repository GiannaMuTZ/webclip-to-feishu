import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';
import { capturePage } from '../extension/capture.js';
import { extract } from '../src/extract.js';
function fixture(html: string) { return new JSDOM(html, { url: 'https://example.org/page', runScripts: 'outside-only' }); }
function capture(dom: JSDOM, mode: string) { return new Script(`(${capturePage.toString()})(${JSON.stringify(mode)})`).runInContext(dom.getInternalVMContext()); }

test('捕获函数序列化后不依赖扩展闭包，移除表单、保留公式', () => {
  const dom = fixture('<title>测试</title><main><p>可见正文</p><div style="display:none">隐藏</div><input value="secret"><textarea>secret</textarea><span data-latex="x^2"></span></main>');
  try {
    const result = capture(dom, 'article'); assert.equal(result.title, '测试'); assert.doesNotMatch(result.html, /value="secret"|<textarea/);
    const article = extract(result); assert.equal(article.stats.formulas, 1); assert.doesNotMatch(JSON.stringify(article), /隐藏/);
  } finally { dom.window.close(); }
});
test('MathJax SVG 的 MathItem 公式源码被补充，提取后保留', () => {
  const dom = fixture('<main><mjx-container id="math1"><svg><text>视觉内容</text></svg></mjx-container></main>');
  try {
    (dom.window as any).MathJax = { startup: { document: { math: [{ math: 'x^2', display: true, typesetRoot: dom.window.document.getElementById('math1') }] } } };
    const result = capture(dom, 'article'); assert.match(result.html, /data-latex="x\^2"/);
    const article = extract(result); assert.equal(article.stats.formulas, 1); assert.doesNotMatch(JSON.stringify(article), /视觉内容/);
  } finally { dom.window.close(); }
});
test('选择表格中的部分单元格后，HTML 表格结构仍可解析', () => {
  const dom = fixture('<main><p>选区外</p><table><tr><td>第一个</td><td>第二个</td></tr></table></main>');
  try {
    const row = dom.window.document.querySelector('tr')!; const range = dom.window.document.createRange(); range.selectNodeContents(row);
    dom.window.getSelection()!.addRange(range);
    const result = capture(dom, 'selection'); const article = extract(result);
    assert.equal(article.stats.tables, 1); assert.doesNotMatch(JSON.stringify(article), /选区外/);
    const table = article.blocks[0]; assert.equal(table.kind, 'table'); if (table.kind === 'table') assert.equal(table.cols, 2);
  } finally { dom.window.close(); }
});
test('选区为空时不静默保存整个页面', () => {
  const dom = fixture('<main><p>正文</p></main>');
  try { assert.throws(() => capture(dom, 'selection'), /先在页面中选中/); } finally { dom.window.close(); }
});
