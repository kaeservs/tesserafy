/**
 * Reading a document for the knowledge base: text and Markdown as they are,
 * a NUL byte (some PDFs carry one) removed, and a file with nothing to read
 * or of a kind it cannot read refused with a reason a person can act on.
 * PDF and Word are read by unpdf and mammoth; they are exercised end to end.
 */
import { describe, expect, it } from 'vitest';
import { documentText, UnreadableDocument } from '../lib/knowledge';

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe('reading a document', () => {
  it('reads text and Markdown as they are, without NUL bytes', async () => {
    expect(await documentText('pricing.md', bytes('# Pricing\n\nPro is $32 a seat a month.'))).toBe('# Pricing\n\nPro is $32 a seat a month.');
    expect(await documentText('notes.TXT', bytes(`Rollout${String.fromCharCode(0)} takes three weeks for most teams.`))).toBe(
      'Rollout takes three weeks for most teams.',
    );
  });

  it('refuses a kind of file it cannot read, and one with nothing in it, saying why', async () => {
    await expect(documentText('deck.pptx', bytes('whatever is in here'))).rejects.toThrow(UnreadableDocument);
    await expect(documentText('empty.txt', bytes('   \n  '))).rejects.toThrow(/no text/);
  });
});
