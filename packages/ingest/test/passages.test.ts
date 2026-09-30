import { describe, expect, it } from 'vitest';
import { PASSAGE_MAX, toPassages } from '../src/chunk/passages';

describe('a document split into passages', () => {
  it('keeps short paragraphs together, up to the target', () => {
    const passages = toPassages('Pricing.\n\nPro is $20 a seat.\n\nRollout takes two weeks.', 1_000);
    expect(passages).toEqual(['Pricing.\n\nPro is $20 a seat.\n\nRollout takes two weeks.']);
  });

  it('starts a new passage when the next paragraph would pass the target', () => {
    const a = 'A'.repeat(600);
    const b = 'B'.repeat(600);
    expect(toPassages(`${a}\n\n${b}`, 1_000)).toEqual([a, b]);
  });

  it('splits a long paragraph at sentence ends, never past the limit, dropping nothing', () => {
    const sentence = 'Our onboarding team sets up every integration with you in the first week. ';
    const paragraph = sentence.repeat(60).trim();
    const passages = toPassages(paragraph);
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.every((passage) => passage.length <= PASSAGE_MAX)).toBe(true);
    expect(passages.join(' ').replace(/\s+/g, ' ')).toBe(paragraph.replace(/\s+/g, ' '));
  });

  it('cuts a sentence with no end at a word', () => {
    const passages = toPassages('word '.repeat(1_000).trim());
    expect(passages.every((passage) => passage.length <= PASSAGE_MAX && !passage.startsWith(' '))).toBe(true);
  });

  it('has nothing to say about an empty document', () => {
    expect(toPassages('  \n\n  ')).toEqual([]);
  });
});
