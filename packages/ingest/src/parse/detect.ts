/**
 * One door for every format: the upload route and the operator scripts hand
 * over a file's name and contents and get turns back, so a new format is added
 * here once rather than in each caller.
 *
 * JSON goes by its extension, because it is ours and deliberate. The rest goes
 * by what the file contains: a transcript saved as .txt that is really WebVTT
 * is still WebVTT.
 */
import { withoutBom, type ParsedTranscript } from '../types';
import { parseText } from './text';
import { parseTurns } from './turns';
import { parseSrt, parseVtt } from './vtt';

export type TranscriptFormat = 'json' | 'vtt' | 'srt' | 'text';

/** The extensions the upload page offers. */
export const TRANSCRIPT_EXTENSIONS = ['.vtt', '.srt', '.txt', '.json'] as const;

export function transcriptFormat(filename: string, source: string): TranscriptFormat {
  if (filename.toLowerCase().endsWith('.json')) return 'json';
  const lines = withoutBom(source)
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines[0]?.startsWith('WEBVTT')) return 'vtt';
  if (/^\d+$/.test(lines[0] ?? '') && (lines[1] ?? '').includes('-->')) return 'srt';
  return 'text';
}

export function parseTranscript(filename: string, source: string): ParsedTranscript {
  switch (transcriptFormat(filename, source)) {
    case 'json':
      return parseTurns(JSON.parse(source));
    case 'vtt':
      return parseVtt(source);
    case 'srt':
      return parseSrt(source);
    case 'text':
      return parseText(source);
  }
}
