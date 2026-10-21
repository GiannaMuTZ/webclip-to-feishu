import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import { JSDOM } from 'jsdom';
import { extract } from '../src/extract.js';
import { splitMath } from '../src/math.js';
import { plain, type Block } from '../src/model.js';
import { render } from '../src/render.js';
const article = (html: string, mode: 'article' | 'page' | 'selection' = 'article') => extract({ title: '测试', url: 'https://example.org/article', html, mode });
const text = (blocks: Block[]) => blocks.map(b => b.kind === 'paragraph' ? plain(b.elements) : b.kind === 'code' ? b.text : '').join('\n');

test('正文保留标题、格式、来源链接并去除导航', () => {
  const a = article('<nav>外部导航</nav><main><nav>内部导航</nav><h1>标题</h1><p>你好 <strong>世界</strong> <a href="/next">下一页</a></p></main>');
  assert.equal(a.blocks[0].kind, 'paragraph'); assert.match(text(a.blocks), /标题/); assert.doesNotMatch(text(a.blocks), /导航/);
  const p = a.blocks[1]; assert.equal(p.kind, 'paragraph'); if (p.kind !== 'paragraph') return;
  assert.ok(p.elements.some(e => e.kind === 'text' && e.style?.bold));
  assert.ok(p.elements.some(e => e.kind === 'text' && e.style?.link?.url === 'https://example.org/next'));
});
test('KaTeX 双层表示只提取一次源码', () => {
  const a = article(`<main><p>公式 ${katex.renderToString('E=mc^2')}</p>${katex.renderToString('\\frac{1}{2}', { displayMode: true })}</main>`);
  assert.equal(a.stats.formulas, 2); assert.equal(a.blocks.length, 2);
  assert.doesNotMatch(text(a.blocks), /E=mc2/);
});
test('MathJax TeX 脚本和 data-latex 可恢复原生公式', () => {
  const a = article('<main><p><script type="math/tex">x^2</script></p><mjx-container data-latex="y^2"><svg>绘制内容</svg></mjx-container></main>');
  assert.equal(a.stats.formulas, 2); assert.doesNotMatch(text(a.blocks), /绘制内容/);
});
test('MathJax assistive MathML 在 aria-hidden 清理前被恢复', () => {
  const a = article('<main><mjx-container><svg></svg><mjx-assistive-mml aria-hidden="true"><math><mfrac><mi>a</mi><mi>b</mi></mfrac></math></mjx-assistive-mml></mjx-container></main>');
  assert.equal(a.stats.formulas, 1); assert.match(text(a.blocks), /\\frac/);
});
test('MathJax v2 渲染帧和源脚本只保留一次公式', () => {
  const a = article('<main><span class="MathJax_Preview">x2</span><span class="MathJax" id="MathJax-Element-1-Frame">视觉内容x2</span><script id="MathJax-Element-1" type="math/tex">x^2</script></main>');
  assert.equal(a.stats.formulas, 1); assert.doesNotMatch(text(a.blocks), /视觉内容|x2/);
});
test('引用中的多个段落不粘连', () => {
  const a = article('<main><blockquote><p>第一段</p><p>第二段</p></blockquote></main>');
  assert.equal(text(a.blocks), '第一段\n第二段');
});
test('LaTeX 四种分隔符和价格不混淆', () => {
  assert.equal(splitMath('单行 $x^2$，\\(y^2\\)，$$z^2$$，\\[a^2\\]').filter(e => e.kind === 'math').length, 4);
  assert.equal(splitMath('价格 $5 和 $10，变量 \\$var').filter(e => e.kind === 'math').length, 0);
});
test('代码中的美元符号原样保留', () => {
  const a = article('<main><p><code>$x$</code></p><pre>const x = "$y$";\n  line2</pre></main>');
  assert.equal(a.stats.formulas, 0); assert.match(text(a.blocks), /\n  line2/);
});
test('未知 LaTeX 命令显式回退源码', () => {
  const a = article('<main><span data-latex="\\unknowncommand{x}"></span></main>');
  assert.equal(a.stats.formulas, 0); assert.ok(a.warnings.length); assert.match(text(a.blocks), /LaTeX/);
});
test('MathML 分数上下标可以恢复', () => {
  const a = article('<main><math><mfrac><msub><mi>a</mi><mn>1</mn></msub><msup><mi>b</mi><mn>2</mn></msup></mfrac></math></main>');
  assert.equal(a.stats.formulas, 1); assert.match(text(a.blocks), /\\frac/);
});
test('不支持的 MathML 不静默丢弃', () => {
  const a = article('<main><math><maction><mi>x</mi></maction></math></main>');
  assert.ok(a.warnings.some(w => w.includes('maction'))); assert.match(text(a.blocks), /x/);
});
test('二维表格位置、rowspan、colspan、单元格公式保留', () => {
  const a = article('<main><table><tr><th rowspan="2">模型</th><th colspan="2">结果</th></tr><tr><td>$x$</td><td>0.1</td></tr></table></main>');
  assert.equal(a.stats.tables, 1); assert.equal(a.stats.formulas, 1);
  const t = a.blocks[0]; assert.equal(t.kind, 'table'); if (t.kind !== 'table') return;
  assert.equal(t.rows, 2); assert.equal(t.cols, 3); assert.equal(t.cells[2].col, 1); assert.equal(t.cells[0].rowspan, 2);
});
test('恶意超大表格在分配完整网格前拒绝', () => {
  assert.throws(() => article('<main><table><tr><td colspan="1000000000">x</td></tr></table></main>'), /表格过大/);
});
test('列表不重复嵌套条目', () => {
  const a = article('<main><ul><li>父条目<ul><li>子条目</li></ul></li></ul></main>');
  assert.equal(a.blocks.length, 2); assert.equal(text(a.blocks).match(/子条目/g)?.length, 1);
});
test('所有正文段落保持顺序', () => {
  const a = article('<main>前<div><p>中</p><table><tr><td>表</td></tr></table></div>后</main>');
  assert.deepEqual(a.blocks.map(b => b.kind), ['paragraph', 'paragraph', 'table', 'paragraph']);
});
test('网页代码不会执行，预览不允许脚本链接或注入 HTML', () => {
  const a = article('<main><script>throw new Error("EXECUTED")</script><p>&lt;script&gt;alert(1)&lt;/script&gt; <a href="javascript:alert(1)">链接</a><img src="x" onerror="alert(2)"></p></main>');
  const html = render(a); const preview = new JSDOM(html).window.document;
  assert.equal(preview.querySelectorAll('script,[onerror],a[href^="javascript:"]').length, 0);
  assert.match(html, /&lt;script&gt;/);
});
test('隐藏内容、表单字段不会被保留', () => {
  const a = article('<main><p>正文</p><p hidden>隐藏</p><p data-webclip-hidden>不可见</p><input value="secret"><textarea>secret</textarea></main>');
  assert.equal(text(a.blocks), '正文');
});
test('selection 模式不重新选择正文容器', () => {
  const a = article('<div><p>选区前</p><article><p>内部</p></article><p>选区后</p></div>', 'selection');
  assert.equal(a.blocks.length, 3);
});
test('空网页和无效协议有明确错误', () => {
  assert.throws(() => article('<main></main>'), /没有提取到正文/);
  assert.throws(() => extract({ url: 'file:///etc/passwd', html: '<p>x</p>' }), /HTTP/);
});
