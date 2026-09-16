/**
 * The ingest contract. T0 in the tier table: no model, no network, no clock.
 *
 * Every transcript format the product will ever accept — WebVTT today, a Gong
 * or Zoom export later — is parsed into Turns. Nothing downstream knows which
 * format the words arrived in, so a new export format is one parser, not a
 * change to chunking, embedding or extraction.
 */

/** A stretch of speech attributed to one speaker, as the source recorded it. */
export interface Turn {
  /** Null when the source does not attribute the line to anyone. */
  readonly speaker: string | null;
  /** Milliseconds from the start of the recording. */
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface ParsedTranscript {
  /** From the source when it carries one; the caller names it otherwise. */
  readonly title: string | null;
  readonly turns: readonly Turn[];
}

/**
 * A segment as it will be written to the database: the unit of evidence.
 * Ordered, so the caller can insert and index without re-sorting.
 */
export interface SegmentDraft {
  readonly index: number;
  readonly speaker: string | null;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

/** A transcript that cannot be parsed, with where in the source it failed. */
export class TranscriptParseError extends Error {
  override readonly name = 'TranscriptParseError';
  /** 1-based line number in the source, when it can be attributed to one. */
  readonly line: number | null;

  constructor(message: string, line: number | null = null) {
    super(line === null ? message : `${message} (line ${line})`);
    this.line = line;
  }
}
