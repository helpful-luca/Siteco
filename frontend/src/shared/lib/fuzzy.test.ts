import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches every character in order, ignoring case and accents', () => {
    expect(fuzzyMatch('bib', 'Bibliothek öffnen')?.indices).toEqual([0, 1, 2]);
    expect(fuzzyMatch('offn', 'Bibliothek öffnen')).not.toBeNull();
    expect(fuzzyMatch('xyz', 'Bibliothek')).toBeNull();
    expect(fuzzyMatch('kb', 'Bibliothek')).toBeNull(); // order matters
  });

  it('matches everything with an empty query, without highlights', () => {
    expect(fuzzyMatch('  ', 'Mira')).toEqual({ score: 0, indices: [] });
  });

  it('ranks a prefix above word starts above scattered letters', () => {
    const prefix = fuzzyMatch('mir', 'Mira Datenblatt')!.score;
    const word = fuzzyMatch('mir', 'Datenblatt Mira')!.score;
    const scattered = fuzzyMatch('mir', 'Montage im Raum')!.score;
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(scattered);
  });

  it('prefers the contiguous match over the first scattered one', () => {
    expect(fuzzyMatch('ip66', 'Inhalt der IP66 Leuchte')?.indices).toEqual([11, 12, 13, 14]);
  });
});

describe('fuzzyMatch with emoji and other astral characters', () => {
  it('finds a title with an emoji and counts indices per character, like the highlight', () => {
    expect(fuzzyMatch('plan', 'Plan 🚀 Q3')?.indices).toEqual([0, 1, 2, 3]);
    expect(fuzzyMatch('plan', '🚀 Plan')?.indices).toEqual([2, 3, 4, 5]);
    expect(fuzzyMatch('q3', 'Plan 🚀 Q3')?.indices).toEqual([7, 8]);
  });
});
