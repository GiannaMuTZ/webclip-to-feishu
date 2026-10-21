import katex from 'katex';
import type { Article, Inline } from './model.js';
export const escape = (v: string): string => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function inline(els: Inline[]): string {
  return els.map(e => {
    if (e.kind === 'math') return katex.renderToString(e.latex, { throwOnError: false, trust: false, strict: 'ignore', maxExpand: 200, maxSize: 20 });
    let text = escape(e.text).replace(/\n/g, '<br>');
    if (e.style?.bold) text = `<strong>${text}</strong>`;
    if (e.style?.italic) text = `<em>${text}</em>`;
    if (e.style?.strikethrough) text = `<s>${text}</s>`;
    if (e.style?.underline) text = `<u>${text}</u>`;
    if (e.style?.inline_code) text = `<code>${text}</code>`;
    if (e.style?.link && /^(https?:|mailto:)/.test(e.style.link.url)) text = `<a href="${escape(e.style.link.url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    return text;
  }).join('');
}
export function render(article: Article): string {
  return article.blocks.map(b => {
    if (b.kind === 'divider') return '<hr>';
    if (b.kind === 'code') return `<pre><code>${escape(b.text)}</code></pre>`;
    if (b.kind === 'table') return `<div class="table-scroll"><table>${Array.from({ length: b.rows }, (_, r) => `<tr>${b.cells.filter(c => c.row === r).map(c => `<${c.header ? 'th' : 'td'} rowspan="${c.rowspan}" colspan="${c.colspan}">${inline(c.elements)}</${c.header ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table></div>`;
    const tag = b.type.startsWith('heading') ? `h${b.type.slice(-1)}` : b.type === 'quote' ? 'blockquote' : 'p';
    const prefix = b.type === 'bullet' ? '• ' : b.type === 'ordered' ? '1. ' : '';
    return `<${tag}${b.displayMath ? ' class="display-math"' : ''}>${prefix}${inline(b.elements)}</${tag}>`;
  }).join('\n');
}
