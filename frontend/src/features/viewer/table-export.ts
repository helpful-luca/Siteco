import type { Root, Table } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit, EXIT } from 'unist-util-visit';
import { stripSentinels } from '@/features/citations';

const FORMULA = /^[=+\-@\t\r]/;
const NUMBER = /^-?\d+([.,]\d+)?$/;

function cell(value: string, separator: string): string {
  // Spreadsheets run cells starting with = + - @ as formulas (annex 10, M9).
  let text = FORMULA.test(value) && !NUMBER.test(value) ? `'${value}` : value;
  if (text.includes(separator) || /["\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * The first table of a markdown snippet as CSV, built from the syntax tree (annex 11, 8.4), so
 * emphasis, links and citation markers become plain text. A BOM lets spreadsheets detect UTF-8.
 */
export function tableToCsv(markdown: string, separator: ',' | ';'): string {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(stripSentinels(markdown)) as Root;
  let table: Table | null = null;
  visit(tree, 'table', (node: Table) => {
    table = node;
    return EXIT;
  });
  if (!table) return '';
  const rows = (table as Table).children.map((row) =>
    row.children.map((c) => cell(toString(c).trim(), separator)).join(separator),
  );
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
