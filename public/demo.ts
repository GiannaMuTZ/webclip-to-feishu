import katex from 'katex';
document.querySelectorAll('[data-latex]').forEach(el => katex.render(el.getAttribute('data-latex')!, el as HTMLElement, { displayMode: el.getAttribute('display') === 'block', throwOnError: false, trust: false }));
