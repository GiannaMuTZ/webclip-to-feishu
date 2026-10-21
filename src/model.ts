import { z } from 'zod';

export const captureSchema = z.object({
  title: z.string().max(1000).default('未命名网页'),
  url: z.string().url().refine(v => ['http:', 'https:'].includes(new URL(v).protocol), '仅支持 HTTP/HTTPS 网页'),
  html: z.string().min(1).max(5_000_000),
  mode: z.enum(['article', 'selection', 'page']).default('article'),
});
export type Capture = z.infer<typeof captureSchema>;
export type Style = { bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; inline_code?: boolean; link?: { url: string } };
export type Inline = { kind: 'text'; text: string; style?: Style } | { kind: 'math'; latex: string };
export type Paragraph = { kind: 'paragraph'; type: 'text' | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6' | 'bullet' | 'ordered' | 'quote'; elements: Inline[]; displayMath?: boolean };
export type Cell = { row: number; col: number; rowspan: number; colspan: number; header: boolean; elements: Inline[] };
export type Table = { kind: 'table'; rows: number; cols: number; cells: Cell[] };
export type Block = Paragraph | Table | { kind: 'code'; text: string } | { kind: 'divider' };
export type Article = { title: string; url: string; blocks: Block[]; warnings: string[]; stats: { blocks: number; formulas: number; tables: number; characters: number } };
export function plain(elements: Inline[]): string { return elements.map(e => e.kind === 'text' ? e.text : e.latex).join(''); }
