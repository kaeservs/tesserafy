/**
 * Reading a document for the knowledge base: text and Markdown as they are,
 * a NUL byte (some PDFs carry one) removed, and a file with nothing to read
 * or of a kind it cannot read refused with a reason a person can act on.
 * Word is read by mammoth, exercised end to end; a PDF is read by unpdf here,
 * from PDFs built below, because what is checked before it reads one is
 * only worth anything if pdf.js then reads what it was given.
 */
import { deflateRawSync, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { docxFitsIn, documentText, PDF_MAX_PAGES, pdfForText, UnreadableDocument } from '../lib/knowledge';

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

/** A PDF of these objects, numbered from 1 with the catalog first, and a cross-reference table pdf.js can read. */
function pdfOf(objects: (string | Buffer)[]): ArrayBuffer {
  const parts = [Buffer.from('%PDF-1.7\n')];
  const offsets: number[] = [];
  let at = parts[0]!.length;
  objects.forEach((body, index) => {
    offsets.push(at);
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(body), Buffer.from('\nendobj\n')]);
    parts.push(object);
    at += object.length;
  });
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`,
    ),
  );
  const file = Buffer.concat(parts);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

/** A stream object: its dictionary's entries and its data. */
function streamOf(entries: string, data: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`<< ${entries} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')]);
}

/** Pages in Helvetica, each with the content stream given, and any objects after them (from 4 + 2 × pages). */
function pdfOfPages(contents: Buffer[], extra: (string | Buffer)[] = []): ArrayBuffer {
  return pdfOf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${contents.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${contents.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...contents.flatMap((content, i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 ${4 + 2 * contents.length} 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
      content,
    ]),
    ...extra,
  ]);
}

/** A page's content showing one line, compressed as most producers compress it. */
const page = (line: string) => streamOf('/Filter /FlateDecode', deflateSync(`BT /F1 12 Tf 72 720 Td (${line}) Tj ET`));

/** ASCII85, as ReportLab encodes every page it writes. */
function ascii85(data: Buffer): Buffer {
  let out = '';
  for (let at = 0; at < data.length; at += 4) {
    const chunk = data.subarray(at, at + 4);
    let value = 0;
    for (let i = 0; i < 4; i++) value = value * 256 + (chunk[i] ?? 0);
    if (chunk.length === 4 && value === 0) {
      out += 'z';
      continue;
    }
    let digits = '';
    for (let i = 0; i < 5; i++, value = Math.floor(value / 85)) digits = String.fromCharCode(0x21 + (value % 85)) + digits;
    out += digits.slice(0, chunk.length + 1);
  }
  return Buffer.from(`${out}~>`);
}

/** Zeros, compressed: a few kilobytes that pdf.js would inflate to `megabytes` and hold whole. */
const zeros = (megabytes: number) => deflateSync(Buffer.alloc(megabytes * 1024 * 1024), { level: 9 });

describe('a PDF', () => {
  it('is read page by page, joined as unpdf joins them', async () => {
    const pdf = pdfOfPages([page('Rollout takes three weeks.'), page('Pro is per seat.'), page('Security review comes first.')]);
    const { extractText, getDocumentProxy } = await import('unpdf');
    const unpdf = (await extractText(await getDocumentProxy(new Uint8Array(pdf.slice(0))), { mergePages: true })).text.trim();

    const text = await documentText('pricing.pdf', pdf.slice(0));

    expect(text).toBe(unpdf);
    expect(text).toContain('Rollout takes three weeks.');
    expect(text).toContain('Security review comes first.');
  });

  it('is read when its pages are ASCII85 over Flate, as ReportLab writes every page', async () => {
    const content = 'BT /F1 12 Tf 72 720 Td (Pro is per seat, billed monthly.) Tj ET';
    const reportlab = streamOf('/Filter [/ASCII85Decode /FlateDecode]', ascii85(deflateSync(content)));
    expect(await documentText('report.pdf', pdfOfPages([reportlab]))).toBe('Pro is per seat, billed monthly.');
  });

  it('is refused when a stream inflates past the budget, however its filter is spelled', () => {
    const data = zeros(8);
    for (const [entries, body] of [
      ['/Filter /FlateDecode', data],
      ['/F /Fl', data],
      ['/Filter /Fl#61teDecode', data],
      ['', data],
      ['/Filter [/A85 /Fl]', ascii85(data)],
    ] as const) {
      const pdf = pdfOfPages([streamOf(entries, body)]);
      expect(pdf.byteLength, entries).toBeLessThan(64 * 1024);
      expect(pdfForText(new Uint8Array(pdf), 1024 * 1024), entries).toBeNull();
    }
  });

  it('is refused when it would inflate past the default budget, before pdf.js sees it', async () => {
    const pdf = pdfOfPages([streamOf('/Filter /FlateDecode', zeros(65))]);
    await expect(documentText('bomb.pdf', pdf)).rejects.toThrow(/could not be read safely/);
  });

  it('is refused when zlib data runs past its endstream, whatever its length says', () => {
    const data = zeros(1);
    const early = Buffer.concat([data.subarray(0, 64), Buffer.from('endstream'), data.subarray(64)]);
    expect(pdfForText(new Uint8Array(pdfOfPages([streamOf('/Filter /FlateDecode', early)])))).toBeNull();
  });

  it('is refused when a stream hidden inside an object stream inflates past the budget', () => {
    const inner = Buffer.concat([Buffer.from('7 0 << /Filter /FlateDecode >>\nstream\n'), zeros(8), Buffer.from('\nendstream')]);
    const pdf = pdfOfPages([page('Rollout takes three weeks.')], [streamOf('/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode', deflateSync(inner))]);
    expect(pdfForText(new Uint8Array(pdf), 1024 * 1024)).toBeNull();
  });

  it('leaves an image out of the count and out of what pdf.js reads, and still reads the page', async () => {
    const screenshot = deflateSync(Buffer.alloc(8 * 1024 * 1024, 0xf6));
    const image = streamOf('/Type /XObject /Subtype /Image /Width 2048 /Height 4096 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode', screenshot);
    const deck = pdfOfPages([page('Rollout takes three weeks.')], [image]);

    const readable = pdfForText(new Uint8Array(deck), 1024 * 1024);

    expect(readable).not.toBeNull();
    expect(Buffer.from(readable!).includes(screenshot.subarray(0, 64))).toBe(false);
    expect(readable!.length).toBe(deck.byteLength);
    expect(await documentText('deck.pdf', deck)).toBe('Rollout takes three weeks.');
  });

  it('blanks a stream marked an image even where it is used as a page, so pdf.js never inflates it', async () => {
    const disguised = streamOf('/Subtype /Image /Width 1024 /Height 8192 /BitsPerComponent 8 /Filter /FlateDecode', zeros(8));
    const pdf = pdfOfPages([disguised]);

    expect(Buffer.from(pdfForText(new Uint8Array(pdf))!).includes(zeros(8).subarray(2, 66))).toBe(false);
    await expect(documentText('disguised.pdf', pdf)).rejects.toThrow(/no text/);
  });

  it('blanks a stream whose filter is not measured here, rather than letting pdf.js decode it', () => {
    const lzw = Buffer.from('\x80\x0b\x60\x50\x22\x0c\x0c\x85\x01');
    const pdf = pdfOfPages([streamOf('/Filter /LZWDecode', lzw)]);
    expect(Buffer.from(pdfForText(new Uint8Array(pdf))!).includes(lzw)).toBe(false);
  });

  it('is refused when encrypted, since its streams cannot be measured, however /Encrypt is spelled', async () => {
    // The trailer is the only place the test's own PDFs say /Root 1 0 R.
    const withTrailer = (entry: string): ArrayBuffer => {
      const text = Buffer.from(pdfOfPages([page('Rollout takes three weeks.')])).toString('latin1');
      return new Uint8Array(Buffer.from(text.replace('/Root 1 0 R', `/Root 1 0 R ${entry}`), 'latin1')).buffer;
    };
    expect(pdfForText(new Uint8Array(withTrailer('/Encrypt 9 0 R')))).toBeNull();
    expect(pdfForText(new Uint8Array(withTrailer('/Encr#79pt 9 0 R')))).toBeNull();
    await expect(documentText('protected.pdf', withTrailer('/Encrypt 9 0 R'))).rejects.toThrow(/without a password/);
  });

  it('is refused when it has more pages than are read, before a page is read', async () => {
    const pdf = pdfOfPages(Array.from({ length: PDF_MAX_PAGES + 1 }, () => page('Rollout takes three weeks.')));
    await expect(documentText('manual.pdf', pdf)).rejects.toThrow(`That PDF has 1,001 pages`);
  });
});
