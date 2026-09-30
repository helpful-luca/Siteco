import { describe, expect, it } from 'vitest';
import { tableToCsv } from './table-export';

describe('tableToCsv', () => {
  it('exports header and rows with plain text cells', () => {
    const md = '| Größe | Wert |\n| --- | --- |\n| **Schutzart** | IP66⟦c:1⟧ |\n| Link | [Norm](https://x.y) |';
    expect(tableToCsv(md, ',')).toBe('\uFEFFGröße,Wert\r\nSchutzart,IP66\r\nLink,Norm\r\n');
  });

  it('quotes separators, quotes and line breaks', () => {
    const md = '| a | b |\n| - | - |\n| 1,5 | sagt "hallo" |';
    expect(tableToCsv(md, ',')).toBe('\uFEFFa,b\r\n"1,5","sagt ""hallo"""\r\n');
  });

  it('uses the semicolon for German spreadsheets', () => {
    expect(tableToCsv('| a | b |\n| - | - |\n| 1,5 | 2 |', ';')).toBe('\uFEFFa;b\r\n1,5;2\r\n');
  });

  it('defuses formulas but keeps negative numbers', () => {
    const md = '| a | b | c | d |\n| - | - | - | - |\n| =SUM(A1) | +1+1 | @cmd | -30 |';
    expect(tableToCsv(md, ',')).toBe("\uFEFFa,b,c,d\r\n'=SUM(A1),'+1+1,'@cmd,-30\r\n");
  });

  it('restores brackets that were neutralized against forged citations', () => {
    expect(tableToCsv('| a |\n| - |\n| ⟦\u2060c:1⟧ |', ',')).toBe('\uFEFFa\r\n⟦c:1⟧\r\n');
  });

  it('returns an empty string when there is no table', () => {
    expect(tableToCsv('Kein Tisch', ',')).toBe('');
  });
});
