/**
 * Makes half streamed markdown render calmly: an open code fence is closed, a table
 * appears only once its separator row is complete, a half written row or link waits for the rest.
 * Pure and cheap, it runs on every rendered frame of a streaming answer.
 */

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})([^`]*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const TABLE_LINE = /^ {0,3}\|/;
const SEPARATOR = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const HALF_LINK = /\[([^\]\n]*)\]\([^)\s]*$/;

type Fence = { char: string; length: number };

/** The fence still open at the end of the text, if any. */
function openFence(lines: string[]): Fence | null {
  let fence: Fence | null = null;
  for (const line of lines) {
    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { char: open[1][0], length: open[1].length };
    }
  }
  return fence;
}

function cells(line: string): number {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;
}

function trimTable(text: string): string {
  const lines = text.split('\n');
  const complete = text.endsWith('\n');
  // Lines of the trailing table, without the empty string after a final newline.
  const end = complete ? lines.length - 1 : lines.length;
  let start = end;
  while (start > 0 && TABLE_LINE.test(lines[start - 1])) start -= 1;
  if (start === end) return text;

  const keepBefore = () => (start > 0 ? `${lines.slice(0, start).join('\n')}\n` : '');
  const separatorIndex = start + 1;
  if (separatorIndex >= end) return keepBefore(); // header only
  const separator = lines[separatorIndex];
  const separatorIsLast = separatorIndex === end - 1 && !complete;
  const separatorDone =
    SEPARATOR.test(separator) &&
    (!separatorIsLast || (separator.trim().endsWith('|') && cells(separator) >= cells(lines[start])));
  if (!separatorDone) return keepBefore();

  const last = lines[end - 1];
  if (!complete && end - 1 > separatorIndex && !last.trim().endsWith('|')) {
    return `${lines.slice(0, end - 1).join('\n')}\n`;
  }
  return text;
}

export function closeOpenBlocks(text: string): string {
  const lines = text.split('\n');
  const fence = openFence(lines);
  if (fence) {
    return `${text}${text.endsWith('\n') ? '' : '\n'}${fence.char.repeat(fence.length)}`;
  }
  return trimTable(text).replace(HALF_LINK, '$1');
}
