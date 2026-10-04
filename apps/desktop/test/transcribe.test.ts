/**
 * Both sides of the call as text, without Deepgram: its pieces become one
 * utterance a pause, each side on its own stream, audio held until a stream
 * opens, and the last words said when the call stops.
 */
import { describe, expect, it, vi } from 'vitest';
import { Assembler, Streams, type SocketLike } from '../src/main/transcribe';

const results = (transcript: string, isFinal: boolean, speechFinal = false) => ({
  type: 'Results',
  is_final: isFinal,
  speech_final: speechFinal,
  channel: { alternatives: [{ transcript }] },
});

describe('Assembler', () => {
  it('shows the words as they come, and says the utterance when the speaker stops', () => {
    const assembler = new Assembler();
    expect(assembler.feed(results('month end', false))).toEqual({ kind: 'interim', text: 'month end' });
    expect(assembler.feed(results('Month-end reporting takes', true))).toEqual({ kind: 'interim', text: 'Month-end reporting takes' });
    expect(assembler.feed(results('two days', false))).toEqual({ kind: 'interim', text: 'Month-end reporting takes two days' });
    expect(assembler.feed(results('two full days.', true, true))).toEqual({ kind: 'utterance', text: 'Month-end reporting takes two full days.' });
    expect(assembler.flush()).toBeNull();
  });

  it('ends an utterance on Deepgram’s UtteranceEnd too, and ignores what is not a result', () => {
    const assembler = new Assembler();
    assembler.feed(results('Who else decides?', true));
    expect(assembler.feed({ type: 'Metadata' })).toBeNull();
    expect(assembler.feed({ type: 'UtteranceEnd' })).toEqual({ kind: 'utterance', text: 'Who else decides?' });
    expect(assembler.feed({ type: 'UtteranceEnd' })).toBeNull();
  });
});

function fakeSockets() {
  const made: (SocketLike & { sent: unknown[]; url: string; protocols: string[] })[] = [];
  const open = (url: string, protocols: string[]) => {
    const socket = {
      url,
      protocols,
      readyState: 0,
      sent: [] as unknown[],
      send(data: unknown) {
        this.sent.push(data);
      },
      close: vi.fn(),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    } as SocketLike & { sent: unknown[]; url: string; protocols: string[] };
    made.push(socket);
    return socket;
  };
  return { made, open };
}

describe('Streams', () => {
  it('opens one stream a side with the token as its subprotocol, and holds audio until it opens', () => {
    const { made, open } = fakeSockets();
    const heard = vi.fn();
    const streams = new Streams(open, heard, vi.fn());
    streams.start('wss://api.deepgram.com/v1/listen', 'short-token');
    expect(made.map((socket) => socket.protocols)).toEqual([
      ['bearer', 'short-token'],
      ['bearer', 'short-token'],
    ]);
    const chunk = new Uint8Array([1, 2, 3]).buffer;
    streams.send('them', chunk);
    expect(made[1]!.sent).toEqual([]);
    made[1]!.readyState = 1;
    made[1]!.onopen?.({});
    expect(made[1]!.sent).toEqual([chunk]);
    expect(made[0]!.sent).toEqual([]);

    made[1]!.onmessage?.({ data: JSON.stringify(results('We need it by December.', true, true)) });
    expect(heard).toHaveBeenCalledWith('them', { kind: 'utterance', text: 'We need it by December.' });
    streams.stop();
  });

  it('refuses audio that is not a quarter-second chunk', () => {
    const { made, open } = fakeSockets();
    const streams = new Streams(open, vi.fn(), vi.fn());
    streams.start('wss://x', 't');
    made[0]!.readyState = 1;
    streams.send('me', new ArrayBuffer(0));
    streams.send('me', new ArrayBuffer(300 * 1024));
    expect(made[0]!.sent).toEqual([]);
    streams.stop();
  });

  it('on stop, says the last words heard, asks Deepgram to finish, and closes', () => {
    const { made, open } = fakeSockets();
    const heard = vi.fn();
    const streams = new Streams(open, heard, vi.fn());
    streams.start('wss://x', 't');
    made[0]!.readyState = 1;
    made[0]!.onmessage?.({ data: JSON.stringify(results('Let me check with finance', true)) });
    streams.stop();
    expect(heard).toHaveBeenCalledWith('me', { kind: 'utterance', text: 'Let me check with finance' });
    expect(made[0]!.sent).toContain(JSON.stringify({ type: 'CloseStream' }));
    expect(made[0]!.close).toHaveBeenCalledWith(1000);
    expect(streams.active).toBe(false);
  });
});
