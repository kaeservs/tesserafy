/**
 * Keeping a live call without slowing it down.
 *
 * The subtle part is the id mapping. A detector event names the segment by
 * the id the detection window used — a local one, because the utterance was
 * still in flight when detection began — and the database knows it by the id
 * it assigned. Getting that wrong does not throw; it silently files evidence
 * against the wrong sentence, or against nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSession, type LiveEvent } from '@/lib/live-session';

interface Call {
  url: string;
  body: Record<string, unknown>;
}

let calls: Call[];
let segmentIds: (string | null)[];
let startFails: boolean;

function json(payload: unknown, ok = true) {
  return { ok, json: async () => payload } as Response;
}

beforeEach(() => {
  calls = [];
  segmentIds = [];
  startFails = false;

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, body });

    if (url === '/api/live/sessions') {
      return startFails ? json({ error: 'nope' }, false) : json({ conversationId: 'conv1' });
    }
    if (url.endsWith('/segments')) {
      const next = segmentIds.shift();
      return next === null ? json({ error: 'nope' }, false) : json({ segmentId: next ?? 'seg-x' });
    }
    const sent = (body['events'] ?? []) as unknown[];
    return json({ recorded: sent.length, rejected: 0 });
  });
});

function event(segmentId: string, quote = 'it takes all Friday'): LiveEvent {
  return {
    criterionKey: 'pain_quantified',
    kind: 'evidence',
    confidence: 0.9,
    segmentId,
    quote,
    detector: 't1-detect@test',
    model: 'claude-haiku-4-5',
  };
}

describe('LiveSession', () => {
  it('translates local segment ids into the ones the database assigned', async () => {
    segmentIds = ['server-1'];
    const session = new LiveSession();
    await session.start('Live call', 'discovery', 1);

    session.appendSegment('u0', { speaker: 'customer', startMs: 0, endMs: 1000, text: 'hello' });
    await session.saveEvents([event('u0')]);

    const posted = calls.find((call) => call.url.endsWith('/events'));
    const events = posted?.body['events'] as { segmentId: string }[];
    expect(events[0]?.segmentId).toBe('server-1');
  });

  it('drops an event whose segment never reached the server', async () => {
    // Evidence pointing at nothing is worse than evidence that is missing:
    // only one of the two is visibly absent.
    segmentIds = [null];
    const session = new LiveSession();
    await session.start('Live call', 'discovery', 1);

    session.appendSegment('u0', { speaker: 'customer', startMs: 0, endMs: 1000, text: 'hello' });
    await session.saveEvents([event('u0')]);

    expect(calls.some((call) => call.url.endsWith('/events'))).toBe(false);
    expect(session.current().lost).toBe(1);
  });

  it('waits for a segment still in flight rather than guessing', async () => {
    // saveEvents is called right after the score renders, which is often
    // before the segment write has come back.
    let release: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (url === '/api/live/sessions') return json({ conversationId: 'conv1' });
      if (url.endsWith('/segments')) {
        await gate;
        return json({ segmentId: 'server-late' });
      }
      return json({ recorded: 1, rejected: 0 });
    });

    const session = new LiveSession();
    await session.start('Live call', 'discovery', 1);
    session.appendSegment('u0', { speaker: 'customer', startMs: 0, endMs: 1000, text: 'hello' });

    const saving = session.saveEvents([event('u0')]);
    expect(calls.some((call) => call.url.endsWith('/events'))).toBe(false);

    release(null);
    await saving;

    const posted = calls.find((call) => call.url.endsWith('/events'));
    expect((posted?.body['events'] as { segmentId: string }[])[0]?.segmentId).toBe('server-late');
  });

  it('does nothing at all when the call is not being kept', async () => {
    // A session that could not be created must not stop the meeting being
    // run; it just stops being recorded.
    startFails = true;
    const session = new LiveSession();
    const id = await session.start('Live call', 'discovery', 1);

    expect(id).toBeNull();
    calls = [];
    session.appendSegment('u0', { speaker: 'customer', startMs: 0, endMs: 1, text: 'hello' });
    await session.saveEvents([event('u0')]);

    expect(calls).toEqual([]);
  });

  it('counts what the server accepted, and does not count a refusal as a loss', async () => {
    // A rejected claim is the quote rule working, not a dropped write. Only
    // the second belongs in the number the page shows as a failure.
    segmentIds = ['server-1'];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (url === '/api/live/sessions') return json({ conversationId: 'conv1' });
      if (url.endsWith('/segments')) return json({ segmentId: 'server-1' });
      return json({ recorded: 1, rejected: 2 });
    });

    const session = new LiveSession();
    await session.start('Live call', 'discovery', 1);
    session.appendSegment('u0', { speaker: 'customer', startMs: 0, endMs: 1, text: 'hello' });
    await session.saveEvents([event('u0'), event('u0', 'paraphrased')]);

    expect(session.current().recorded).toBe(1);
    expect(session.current().lost).toBe(0);
  });
});
