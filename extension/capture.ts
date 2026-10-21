// This function is serialized by Chrome: every dependency must be inside its body.
export function capturePage(mode: 'article' | 'selection' | 'page') {
  if (!['http:', 'https:'].includes(location.protocol)) throw new Error('请在普通网页使用扩展，浏览器设置页和 PDF 查看器暂不支持');
  let clone: Element;
  if (mode === 'selection') {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) throw new Error('请先在页面中选中要保存的内容');
    const wrapper = document.createElement('main');
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i); const fragment = range.cloneContents();
      const common = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
      const table = common?.closest('table');
      if (table && common) {
        let part: Node = fragment;
        for (let el: Element | null = common; el && el !== table.parentElement; el = el.parentElement) {
          const shell = el.cloneNode(false); shell.appendChild(part); part = shell;
        }
        wrapper.append(part);
      } else wrapper.append(fragment);
    }
    clone = wrapper;
  } else clone = document.documentElement.cloneNode(true) as Element;
  // Recover MathJax v3/v4 TeX from the page's public MathItem list, including SVG output.
  const mathJax = (window as any).MathJax;
  try {
    const items = mathJax?.startup?.document?.math;
    if (items && Symbol.iterator in Object(items)) {
      const roots = [...clone.querySelectorAll('mjx-container')];
      const originals = [...document.querySelectorAll('mjx-container')];
      for (const item of items) {
        const original = item.typesetRoot as Element | undefined;
        if (!original || typeof item.math !== 'string') continue;
        const target = mode === 'selection' ? roots.find(e => original.id ? e.id === original.id : e.outerHTML === original.outerHTML) : roots[originals.indexOf(original)];
        if (target) { target.setAttribute('data-latex', item.math); if (item.display) target.setAttribute('display', 'block'); }
      }
    }
  } catch { /* MathML and script annotations remain available to the extractor. */ }
  if (mode !== 'selection') {
    const originalNodes = document.querySelectorAll('body *'); const copyNodes = clone.querySelectorAll('body *');
    for (let i = 0; i < Math.min(originalNodes.length, 40000); i++) {
      const el = originalNodes[i];
      if (el.closest('.katex, .katex-display, mjx-container, .MathJax, math, script[type^="math/tex"]')) continue;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') copyNodes[i]?.setAttribute('data-webclip-hidden', 'true');
    }
  }
  clone.querySelectorAll('input, textarea, select').forEach(el => el.remove());
  const html = clone.outerHTML;
  if (html.length > 5_000_000) throw new Error('页面超过 5 MB，请选中所需内容后使用选区模式');
  return { url: location.href, title: document.title, html, mode };
}
