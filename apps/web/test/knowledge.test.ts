/**
 * Reading a document for the knowledge base: text and Markdown as they are,
 * a NUL byte (some PDFs carry one) removed, and a file with nothing to read
 * or of a kind it cannot read refused with a reason a person can act on.
 * PDF and Word are read by unpdf and mammoth; they are exercised end to end.
 */
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { docxFitsIn, documentText, UnreadableDocument } from '../lib/knowledge';

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

/** A one-part zip, deflated, as a Word file would carry its document.xml. */
function zipOf(name: string, content: Buffer): Uint8Array {
  const packed = deflateRawSync(content);
  const file = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(file.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(packed.length, 20);
  // The size a hostile file would claim: small, whatever it really unpacks to.
  central.writeUInt32LE(1024, 24);
  central.writeUInt16LE(file.length, 28);
  central.writeUInt32LE(0, 42);
  const directoryAt = local.length + file.length + packed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + file.length, 12);
  end.writeUInt32LE(directoryAt, 16);
  return new Uint8Array(Buffer.concat([local, file, packed, central, file, end]));
}

describe('a Word file that unpacks too far', () => {
  it('passes a small one, by what it actually inflates to', () => {
    expect(docxFitsIn(zipOf('word/document.xml', Buffer.from('<w:document>Rollout takes three weeks.</w:document>')))).toBe(true);
  });
  it('refuses a zip bomb whatever size its directory claims, without inflating it whole', () => {
    const bomb = zipOf('word/document.xml', Buffer.alloc(8 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(docxFitsIn(bomb, 1024 * 1024)).toBe(false);
  });
  it('refuses what is not a zip at all', () => {
    expect(docxFitsIn(new TextEncoder().encode('not a zip, just words'))).toBe(false);
  });
});
