import { describe, expect, it } from 'vitest';
import { splitSettled } from './split-blocks';

describe('splitSettled', () => {
  it('keeps everything before the last blank line as settled blocks', () => {
    expect(splitSettled('Eins.\n\nZwei.\n\nDrei wird noch')).toEqual({
      settled: ['Eins.\n\n', 'Zwei.\n\n'],
      tail: 'Drei wird noch',
    });
  });

  it('never splits inside a code fence', () => {
    const text = 'Intro\n\n```\na\n\nb\n```\n\nDanach';
    expect(splitSettled(text)).toEqual({ settled: ['Intro\n\n', '```\na\n\nb\n```\n\n'], tail: 'Danach' });
  });

  it('keeps an open fence in the tail', () => {
    expect(splitSettled('Intro\n\n```\na\n\nb')).toEqual({ settled: ['Intro\n\n'], tail: '```\na\n\nb' });
  });

  it('joins back to the original text', () => {
    const text = '# Titel\n\n| a |\n| - |\n| 1 |\n\n- x\n- y\n\nEnde';
    const { settled, tail } = splitSettled(text);
    expect(settled.join('') + tail).toBe(text);
  });

  it('has no settled part without a blank line', () => {
    expect(splitSettled('Nur ein Absatz')).toEqual({ settled: [], tail: 'Nur ein Absatz' });
  });
});
