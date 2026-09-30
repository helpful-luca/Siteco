import { describe, expect, it } from 'vitest';
import { downloadName } from './file-name';

describe('downloadName', () => {
  it('removes path and reserved characters', () => {
    expect(downloadName('../Mira: IP66/IK08?', 'Antwort', 'md')).toBe('Mira IP66 IK08.md');
  });

  it('caps the name at 80 characters', () => {
    expect(downloadName('a'.repeat(200), 'Antwort', 'csv')).toBe(`${'a'.repeat(80)}.csv`);
  });

  it('avoids names Windows reserves and trailing dots or spaces', () => {
    expect(downloadName('CON', 'Antwort', 'md')).toBe('CON_.md');
    expect(downloadName('lpt1', 'Antwort', 'csv')).toBe('lpt1_.csv');
    expect(downloadName('Nul.txt', 'Antwort', 'md')).toBe('Nul_.txt.md');
    expect(downloadName('Vergleich. . ', 'Antwort', 'md')).toBe('Vergleich.md');
  });

  it('falls back when nothing is left', () => {
    expect(downloadName('  //  ', 'Antwort', 'md')).toBe('Antwort.md');
    expect(downloadName(null, 'Answer', 'md')).toBe('Answer.md');
  });
});
