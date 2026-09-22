/**
 * Where a conversation has got to.
 *
 * The distinction this protects is between "this call went badly" and "nobody
 * has run the pass yet". They are opposite facts and the product rendered
 * them identically until now, because an imported transcript arrives with
 * every stage already done and a live-captured one does not.
 */
import { describe, expect, it } from 'vitest';
import { nextCommand, stageOf, type PipelineState } from '@/lib/pipeline';

function state(partial: Partial<PipelineState>): PipelineState {
  return { segments: 0, embedded: 0, signals: 0, criterionRows: 0, extractionRuns: 0, ...partial };
}

describe('stageOf', () => {
  it('calls a conversation with no segments empty', () => {
    expect(stageOf(state({}))).toBe('empty');
    expect(stageOf(undefined)).toBe('empty');
  });

  it('calls a live capture with no detection captured', () => {
    // What the overlay leaves behind the moment a call ends.
    expect(stageOf(state({ segments: 12 }))).toBe('captured');
  });

  it('calls it scored once criteria have been detected over it', () => {
    expect(stageOf(state({ segments: 12, criterionRows: 8 }))).toBe('scored');
  });

  it('calls it processed only when it is both extracted and searchable', () => {
    expect(stageOf(state({ segments: 12, criterionRows: 8, signals: 3, embedded: 12 }))).toBe(
      'processed',
    );
  });

  it('does not call a half-embedded conversation processed', () => {
    // Extraction and embedding happen in the same pass, so signals without a
    // full set of vectors means an interrupted run. Calling that done would
    // hide a call that silently cannot be found by retrieval.
    expect(stageOf(state({ segments: 12, criterionRows: 8, signals: 3, embedded: 5 }))).toBe(
      'scored',
    );
  });

  it('treats an imported transcript as processed without ever being scored', () => {
    // Ingest embeds and extracts but does not detect criteria, so a perfectly
    // finished import has no criterion rows. It must not read as unfinished.
    expect(stageOf(state({ segments: 40, signals: 6, embedded: 40 }))).toBe('processed');
  });

  it('treats extraction that found nothing as finished', () => {
    // The bug this fixes. A check-in where the customer says everything is
    // fine has no signals and never will; flagging it forever also means
    // re-running Opus over it forever to reconfirm a zero.
    expect(
      stageOf(state({ segments: 5, criterionRows: 2, signals: 0, embedded: 5, extractionRuns: 1 })),
    ).toBe('processed');
  });

  it('still calls it unfinished when extraction has never run', () => {
    // The distinction the whole change rests on: no signals and no attempt is
    // a pending pass, no signals after an attempt is an answer.
    expect(
      stageOf(state({ segments: 5, criterionRows: 2, signals: 0, embedded: 5, extractionRuns: 0 })),
    ).toBe('scored');
  });

  it('does not call an unembedded conversation done just because extraction ran', () => {
    // An interrupted pass can leave a t3 usage row and no vectors. Such a
    // call cannot be found by retrieval, so it is not finished.
    expect(
      stageOf(state({ segments: 5, criterionRows: 2, signals: 0, embedded: 0, extractionRuns: 1 })),
    ).toBe('scored');
  });
});

describe('nextCommand', () => {
  it('names the command that would move a call on', () => {
    expect(nextCommand('captured', 'c1')).toBe('pnpm score --conversation c1');
    expect(nextCommand('scored', 'c1')).toBe('pnpm process --conversation c1');
  });

  it('says nothing when there is nothing to run', () => {
    // A finished call should not be told to do anything, and an empty one has
    // no transcript for either pass to work on.
    expect(nextCommand('processed', 'c1')).toBeNull();
    expect(nextCommand('empty', 'c1')).toBeNull();
  });
});
