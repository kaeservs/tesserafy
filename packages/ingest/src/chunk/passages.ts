/**
 * A document split into passages for the knowledge base: each short enough
 * to embed whole (gte-small reads about 512 tokens, ~2000 characters) and to
 * quote in the overlay, each long enough to stand on its own.
 *
 * Paragraphs are kept together and joined until a passage reaches its target;
 * a paragraph longer than the limit is split at sentence ends, and a sentence
 * longer still at a word. Nothing is dropped or reworded — a passage is the
 * document's own words, because the overlay quotes it.
 */

/** A passage aims for this many characters, and never exceeds PASSAGE_MAX. */
export const PASSAGE_TARGET = 1_000;
export const PASSAGE_MAX = 1_800;

/** What is read from one document at most: about 150 pages of text. */
export const DOCUMENT_MAX_CHARS = 250_000;

function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (current.trim()) pieces.push(current.trim());
      // One enormous sentence: cut at the last space before the limit.
      let rest = sentence;
      while (rest.length > max) {
        const cut = rest.lastIndexOf(' ', max);
        const at = cut > max / 2 ? cut : max;
        pieces.push(rest.slice(0, at).trim());
        rest = rest.slice(at);
      }
      current = rest;
      continue;
    }
    if ((current + sentence).length > max) {
      if (current.trim()) pieces.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

export function toPassages(text: string, target = PASSAGE_TARGET, max = PASSAGE_MAX): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLong(paragraph, max));

  const passages: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
    } else if (current.length + 2 + paragraph.length <= target) {
      current = `${current}\n\n${paragraph}`;
    } else {
      passages.push(current);
      current = paragraph;
    }
  }
  if (current) passages.push(current);
  return passages;
}
