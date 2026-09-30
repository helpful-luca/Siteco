import { describe, expect, it } from 'vitest';
import { closeOpenBlocks } from './close-open-blocks';

describe('closeOpenBlocks', () => {
  it('leaves finished markdown alone', () => {
    const text = 'Text\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
    expect(closeOpenBlocks(text)).toBe(text);
  });

  it('closes an open code fence', () => {
    expect(closeOpenBlocks('Look:\n\n```ts\nconst a')).toBe('Look:\n\n```ts\nconst a\n```');
  });

  it('closes an open tilde fence with the same marker and length', () => {
    expect(closeOpenBlocks('~~~~\ncode')).toBe('~~~~\ncode\n~~~~');
  });

  it('closes a fence that has only its opening line', () => {
    expect(closeOpenBlocks('Intro\n```')).toBe('Intro\n```\n```');
  });

  it('does not treat a fence inside a longer fence as closing', () => {
    const text = '````md\n```\ninner\n```\n';
    expect(closeOpenBlocks(text)).toBe(`${text}\`\`\`\``);
  });

  it('holds back a table header until its separator row is complete', () => {
    expect(closeOpenBlocks('Werte:\n\n| Größe | Wert |')).toBe('Werte:\n\n');
    expect(closeOpenBlocks('Werte:\n\n| Größe | Wert |\n| --- | -')).toBe('Werte:\n\n');
  });

  it('shows the table once the separator row is complete', () => {
    const text = 'Werte:\n\n| Größe | Wert |\n| --- | --- |\n';
    expect(closeOpenBlocks(text)).toBe(text);
  });

  it('drops a half written table row', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |\n';
    expect(closeOpenBlocks(`${table}| 3 | 4`)).toBe(table);
  });

  it('keeps a finished last row without a trailing newline', () => {
    const text = '| a | b |\n| - | - |\n| 1 | 2 |';
    expect(closeOpenBlocks(text)).toBe(text);
  });

  it('never touches pipes inside a code block', () => {
    expect(closeOpenBlocks('```\n| a | b |')).toBe('```\n| a | b |\n```');
  });

  it('shows the text of a half written link', () => {
    expect(closeOpenBlocks('Siehe [Norm EN 13201](https://exa')).toBe('Siehe Norm EN 13201');
  });
});
