const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Splits streaming markdown into finished blocks and the growing tail. Blocks end at a blank line
 * outside code; text only grows at the end, so finished blocks never change and can be rendered
 * once (memoised), while only the tail is parsed again on every frame.
 */
export function splitSettled(text: string): { settled: string[]; tail: string } {
  const settled: string[] = [];
  let blockStart = 0;
  let position = 0;
  let fence: { char: string; length: number } | null = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i];
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { char: marker[0], length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length && line.trim() === marker) fence = null;
    }
    position += line.length + 1;
    // A blank line ends the block; consecutive blank lines stay with it.
    if (!fence && line.trim() === '' && lines[i + 1].trim() !== '' && position > blockStart) {
      if (text.slice(blockStart, position).trim() !== '') settled.push(text.slice(blockStart, position));
      else if (settled.length > 0) settled[settled.length - 1] += text.slice(blockStart, position);
      blockStart = position;
    }
  }
  return { settled, tail: text.slice(blockStart) };
}
