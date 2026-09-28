/**
 * CSV cells: the row must survive commas, quotes and line breaks, and a
 * user-typed value must never reach a spreadsheet as a formula.
 */
import { describe, expect, it } from 'vitest';
import { csvCell, csvFilename, toCsv } from '@/lib/csv';

describe('csvCell', () => {
  it('quotes what would break the row, and doubles its quotes', () => {
    expect(csvCell('Acme, Inc.')).toBe('"Acme, Inc."');
    expect(csvCell('She said "Friday"')).toBe('"She said ""Friday"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('plain')).toBe('plain');
  });

  it('never lets a typed value become a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil.test","click")')).toBe('"\'=HYPERLINK(""http://evil.test"",""click"")"');
    expect(csvCell('+1 555 0100')).toBe("'+1 555 0100");
    expect(csvCell('-Q3 renewal')).toBe("'-Q3 renewal");
    expect(csvCell('@mention')).toBe("'@mention");
  });

  it('writes numbers as numbers, negatives included, and nothing for no value', () => {
    expect(csvCell(72)).toBe('72');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
  });
});

describe('toCsv', () => {
  it('writes a header and rows with CRLF endings', () => {
    expect(toCsv(['title', 'score'], [['A', 1], ['B, C', null]])).toBe('title,score\r\nA,1\r\n"B, C",\r\n');
  });
});

describe('csvFilename', () => {
  it('names the company, the table and the day', () => {
    expect(csvFilename('Acme Robotics', 'meetings', new Date('2026-09-28T10:00:00Z'))).toBe(
      'acme-robotics-meetings-2026-09-28.csv',
    );
    expect(csvFilename('///', 'weeks', new Date('2026-09-28T10:00:00Z'))).toBe('company-weeks-2026-09-28.csv');
  });
});
