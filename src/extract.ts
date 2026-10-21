import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { mathmlToLatex, splitMath, validateMath } from './math.js';
import { captureSchema, plain, type Article, type Block, type Inline, type Style, type Table } from './model.js';

function safeUrl(value: string | null, base: string): string | undefined {
  if (!value) return;
  try { const url = new URL(value, base); if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return url.href; } catch { /* invalid link */ }
}

export function extract(input: unknown): Article {
  const capture = captureSchema.parse(input);
  // jsdom's defaults deliberately do not run scripts or load external resources.
  const dom = new JSDOM(capture.html, { url: capture.url });
  try {
    const doc = dom.window.document;
    const warnings: string[] = [];
    const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
    const equation = (latex: string): Inline => {
      const issue = validateMath(latex);
      if (issue) { warn(issue); return { kind: 'text', text: ` [LaTeX: ${latex}] `, style: { inline_code: true } }; }
      return { kind: 'math', latex };
    };
    // Normalize rendered math before Readability; otherwise hidden TeX annotations may disappear.
    const selectors = '.katex-display, .katex, mjx-container, .MathJax, math, script[type^="math/tex"], [data-latex], [data-tex]';
    for (const el of [...doc.querySelectorAll(selectors)]) {
      if (!el.isConnected) continue;
      // MathJax v2 keeps its source script beside the rendered frame. Prefer it once.
      if (el.matches('.MathJax') && el.id.endsWith('-Frame')) {
        const source = doc.getElementById(el.id.slice(0, -6));
        if (source?.matches('script[type^="math/tex"]')) { el.remove(); continue; }
      }
      let latex = el.getAttribute('data-latex') ?? el.getAttribute('data-tex') ?? el.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"]')?.textContent;
      if (!latex && el.matches('script')) latex = el.textContent;
      if (!latex) {
        const math = el.matches('math') ? el : el.querySelector('math');
        if (math) { try { latex = mathmlToLatex(math); } catch (e) { warn((e as Error).message + '，保留可读取文字'); } }
      }
      const replacement = doc.createElement('span');
      if (latex?.trim()) {
        replacement.setAttribute('data-webclip-math', latex.trim());
        if (el.matches('.katex-display, [display="block"], [display="true"]') || /mode=display/.test(el.getAttribute('type') ?? '')) replacement.setAttribute('data-webclip-display', 'true');
        replacement.textContent = latex.trim();
      } else { replacement.textContent = el.textContent; warn('有公式缺少可恢复的 LaTeX/MathML，已保留可读取文字；纯 SVG/图片公式暂不识别'); }
      el.replaceWith(replacement);
    }
    doc.querySelectorAll('script, style, noscript, iframe, object, embed, form, button, input, select, textarea, .MathJax_Preview, [hidden], [aria-hidden="true"], [data-webclip-hidden]').forEach(e => e.remove());
    let root: Element = doc.body;
    if (capture.mode === 'article') {
      root = doc.querySelector('main, [role="main"]') ?? doc.querySelector('article') ?? doc.body;
      if (root === doc.body) {
        const parsed = new Readability(doc.cloneNode(true) as Document, { charThreshold: 0, keepClasses: true }).parse();
        if (parsed?.content) { const wrapper = doc.createElement('div'); wrapper.innerHTML = parsed.content; root = wrapper; }
        else warn('未识别到文章容器，已使用页面主体；可改用选区提取');
      }
      root.querySelectorAll('nav, footer, aside, [role="navigation"]').forEach(e => e.remove());
    }
    const inline = (node: Node, style: Style = {}, math = true): Inline[] => {
      if (node.nodeType === 3) {
        const text = (node.textContent ?? '').replace(/[\t\r\n ]+/g, ' ');
        return (math ? splitMath(text) : [{ kind: 'text' as const, text }]).map(e => e.kind === 'math' ? equation(e.latex) : { ...e, style });
      }
      if (node.nodeType !== 1) return [];
      const el = node as Element; const tag = el.tagName.toLowerCase();
      if (el.hasAttribute('data-webclip-math')) return [equation(el.getAttribute('data-webclip-math')!)];
      if (tag === 'br') return [{ kind: 'text', text: '\n', style }];
      if (tag === 'img') {
        const src = safeUrl(el.getAttribute('src') ?? el.getAttribute('data-src'), capture.url);
        warn('图片以来源链接保留，暂不上传图片二进制');
        return [{ kind: 'text', text: `[图片：${el.getAttribute('alt') || '查看原图'}]`, style: { ...style, ...(src ? { link: { url: src } } : {}) } }];
      }
      const next = { ...style };
      if (['b', 'strong', 'th'].includes(tag)) next.bold = true;
      if (['em', 'i'].includes(tag)) next.italic = true;
      if (['del', 's'].includes(tag)) next.strikethrough = true;
      if (tag === 'u') next.underline = true;
      if (tag === 'code') next.inline_code = true;
      if (tag === 'a') { const url = safeUrl(el.getAttribute('href'), capture.url); if (url) next.link = { url }; }
      const parts: Inline[] = [];
      for (const child of el.childNodes) {
        if (parts.length && child.nodeType === 1 && /^(P|DIV|LI|TR)$/.test((child as Element).tagName)) parts.push({ kind: 'text', text: '\n', style: next });
        parts.push(...inline(child, next, math && tag !== 'code'));
      }
      return parts;
    };
    const compact = (els: Inline[]): Inline[] => {
      const result: Inline[] = [];
      for (const el of els) {
        const prev = result.at(-1);
        if (el.kind === 'text' && !el.text) continue;
        if (prev?.kind === 'text' && el.kind === 'text' && JSON.stringify(prev.style) === JSON.stringify(el.style)) prev.text += el.text;
        else result.push(el);
      }
      if (result[0]?.kind === 'text') result[0].text = result[0].text.trimStart();
      if (result.at(-1)?.kind === 'text') (result.at(-1) as { text: string }).text = (result.at(-1) as { text: string }).text.trimEnd();
      return result.filter(e => e.kind === 'math' || !!e.text);
    };
    const table = (el: Element): Table => {
      const rows = [...el.querySelectorAll('tr')].filter(r => r.closest('table') === el);
      const occupied = new Set<string>(); const cells: Table['cells'] = []; let cols = 0;
      rows.forEach((row, r) => {
        let c = 0;
        for (const cell of [...row.children].filter(e => ['TH', 'TD'].includes(e.tagName))) {
          while (occupied.has(`${r},${c}`)) c++;
          const rowspanAttr = cell.getAttribute('rowspan');
          const rowspan = rowspanAttr === '0' ? rows.length - r : Math.min(Math.max(1, Math.floor(Number(rowspanAttr)) || 1), rows.length - r);
          const colspan = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
          if (!Number.isInteger(colspan) || colspan > 100 || rows.length * Math.max(cols, c + colspan) > 5000 || rows.length > 5000) throw new Error('表格过大或跨度无效：最多 5000 个单元格、100 列');
          for (let rr = r; rr < r + rowspan; rr++) for (let cc = c; cc < c + colspan; cc++) {
            if (occupied.has(`${rr},${cc}`)) throw new Error('网页表格合并区域重叠，请使用选区提取有效表格');
            occupied.add(`${rr},${cc}`);
          }
          if (cell.querySelector('table')) warn('嵌套表格已展开为单元格文字');
          const pieces: Inline[] = [];
          for (const child of cell.childNodes) {
            if (pieces.length && child.nodeType === 1 && /^(P|DIV|UL|OL|TABLE)$/.test((child as Element).tagName)) pieces.push({ kind: 'text', text: '\n' });
            pieces.push(...inline(child));
          }
          cells.push({ row: r, col: c, rowspan, colspan, header: cell.tagName === 'TH', elements: compact(pieces) });
          c += colspan; cols = Math.max(cols, c);
        }
      });
      if (rows.length > 100 || cols > 9) warn('大表格将按 100 行 × 9 列分片导入；跨分片合并区域会在各分片中重复内容');
      return { kind: 'table', rows: rows.length, cols, cells };
    };
    const blocks: Block[] = [];
    const pushText = (elements: Inline[], type: Extract<Block, { kind: 'paragraph' }>['type'] = 'text', displayMath = false) => {
      const els = compact(elements); if (els.length) blocks.push({ kind: 'paragraph', type, elements: els, ...(displayMath ? { displayMath } : {}) });
    };
    const blockTags = /^(P|DIV|SECTION|ARTICLE|MAIN|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|HR|FIGURE|FIGCAPTION|DL|DT|DD|HEADER)$/;
    const walk = (el: Element) => {
      const tag = el.tagName;
      if (tag === 'TABLE') { const t = table(el); if (t.rows && t.cols) blocks.push(t); return; }
      if (tag === 'PRE') { blocks.push({ kind: 'code', text: el.textContent ?? '' }); return; }
      if (tag === 'HR') { blocks.push({ kind: 'divider' }); return; }
      if (/^H[1-6]$/.test(tag)) { pushText(inline(el), `heading${tag[1]}` as 'heading1'); return; }
      if (tag === 'LI') {
        const own = el.cloneNode(true) as Element; own.querySelectorAll('ul, ol, table').forEach(e => e.remove());
        pushText(inline(own), el.parentElement?.tagName === 'OL' ? 'ordered' : 'bullet');
        for (const nested of el.querySelectorAll('ul, ol, table')) if (nested.parentElement?.closest('li') === el) walk(nested);
        return;
      }
      if (tag === 'BLOCKQUOTE' && !el.querySelector('table, pre')) { pushText(inline(el), 'quote'); return; }
      let pending: Inline[] = [];
      const flush = () => { pushText(pending); pending = []; };
      for (const child of el.childNodes) {
        if (child.nodeType === 1) {
          const element = child as Element;
          if (element.hasAttribute('data-webclip-display')) { flush(); pushText(inline(element), 'text', true); continue; }
          if (blockTags.test(element.tagName) || element.querySelector('table, pre, p, div, h1, h2, ul, ol')) { flush(); walk(element); continue; }
        }
        pending.push(...inline(child));
      }
      flush();
    };
    walk(root);
    if (!blocks.length) throw new Error('没有提取到正文，请等待页面加载完成或选择内容后重试');
    if (blocks.length > 3000) throw new Error('页面超过 3000 个内容块，请缩小选区');
    const elements = blocks.flatMap(b => b.kind === 'paragraph' ? b.elements : b.kind === 'table' ? b.cells.flatMap(c => c.elements) : []);
    return {
      title: capture.title.trim().slice(0, 300) || doc.title || '未命名网页', url: capture.url, blocks, warnings,
      stats: { blocks: blocks.length, formulas: elements.filter(e => e.kind === 'math').length, tables: blocks.filter(b => b.kind === 'table').length, characters: elements.reduce((s, e) => s + plain([e]).length, 0) },
    };
  } finally { dom.window.close(); }
}
