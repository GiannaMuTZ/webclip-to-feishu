import katex from 'katex';
import type { Inline } from './model.js';

// $5 and $10 are prices. A single-dollar formula must have no boundary whitespace.
const delimiters = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\\w])\$(?!\s|\d+(?:[.,]\d+)?(?:\s|$))([^$\n]*?[^\s$])(?<!\\)\$(?!\d)/g;
export function splitMath(text: string): Inline[] {
  const out: Inline[] = []; let last = 0;
  for (const match of text.matchAll(delimiters)) {
    if (match.index! > last) out.push({ kind: 'text', text: text.slice(last, match.index) });
    out.push({ kind: 'math', latex: (match[1] ?? match[2] ?? match[3] ?? match[4]).trim() });
    last = match.index! + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
export function validateMath(latex: string): string | undefined {
  if (latex.length > 8000) return '公式超过 8000 字符，已保留为源码';
  try { katex.renderToString(latex, { throwOnError: true, strict: 'ignore', trust: false, maxExpand: 200, maxSize: 20 }); }
  catch { return '公式包含不受支持的 KaTeX 语法，已保留为源码'; }
}

// Only translate MathML constructs whose meaning we can preserve. Unknown constructs are reported.
export function mathmlToLatex(node: Element): string {
  const children = [...node.children];
  const at = (i: number) => { if (!children[i]) throw new Error('不完整的 MathML'); return mathmlToLatex(children[i]); };
  const all = () => children.map(mathmlToLatex).join(' ');
  switch (node.localName.toLowerCase()) {
    case 'math': case 'mrow': case 'semantics': case 'mstyle': case 'mpadded': return children.filter(c => !c.localName.startsWith('annotation')).map(mathmlToLatex).join(' ');
    case 'mi': case 'mn': case 'mo': return (node.textContent ?? '').replace(/[{}%#$&]/g, '\\$&').replace(/−/g, '-').replace(/×/g, '\\times ').replace(/∑/g, '\\sum ').replace(/∫/g, '\\int ').replace(/∞/g, '\\infty ');
    case 'mtext': return `\\text{${(node.textContent ?? '').replace(/[{}%#$&_]/g, '\\$&')}}`;
    case 'msup': return `{${at(0)}}^{${at(1)}}`;
    case 'msub': return `{${at(0)}}_{${at(1)}}`;
    case 'msubsup': return `{${at(0)}}_{${at(1)}}^{${at(2)}}`;
    case 'mfrac': return `\\frac{${at(0)}}{${at(1)}}`;
    case 'msqrt': return `\\sqrt{${all()}}`;
    case 'mroot': return `\\sqrt[${at(1)}]{${at(0)}}`;
    case 'munder': return `\\underset{${at(1)}}{${at(0)}}`;
    case 'mover': return `\\overset{${at(1)}}{${at(0)}}`;
    case 'munderover': return `\\overset{${at(2)}}{\\underset{${at(1)}}{${at(0)}}}`;
    case 'mtable': return `\\begin{matrix}${children.map(mathmlToLatex).join(' \\\\ ')}\\end{matrix}`;
    case 'mtr': return children.map(mathmlToLatex).join(' & ');
    case 'mtd': return all();
    case 'mspace': return '\\, ';
    default: throw new Error(`暂不支持 MathML ${node.localName}`);
  }
}
