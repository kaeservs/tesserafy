/**
 * Both sides of the call as text (ADR 0022): two Deepgram streams, one for the
 * seller's microphone ("me") and one for the computer's sound output, which is
 * what the meeting app plays ("them"). Held here, in the main process: the
 * page sends audio, never opens a connection, and never sees a token.
 *
 * Each stream opens with a token the web app minted for a minute; the stream
 * stays open after it expires. Deepgram closes a stream that hears nothing for
 * ten seconds, so a keep-alive goes every eight. Its results arrive as pieces
 * — interim guesses, then final words, then "the speaker stopped" — and the
 * Assembler turns them into one utterance a pause.
 */

export type Channel = 'me' | 'them';
export const CHANNELS: readonly Channel[] = ['me', 'them'];

export function isChannel(value: unknown): value is Channel {
  return value === 'me' || value === 'them';
}

interface DeepgramResults {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: { transcript?: string }[] };
}

export type Heard = { readonly kind: 'interim'; readonly text: string } | { readonly kind: 'utterance'; readonly text: string };

/** Deepgram's pieces, in order, into what to show while they talk and the utterance when they stop. */
export class Assembler {
  private finals: string[] = [];

  feed(message: DeepgramResults): Heard | null {
    if (message.type === 'UtteranceEnd') return this.flush();
    if (message.type !== 'Results') return null;
    const text = (message.channel?.alternatives?.[0]?.transcript ?? '').trim();
    if (message.is_final) {
      if (text) this.finals.push(text);
      return message.speech_final ? this.flush() : this.finals.length > 0 ? { kind: 'interim', text: this.finals.join(' ') } : null;
    }
    return text ? { kind: 'interim', text: [...this.finals, text].join(' ') } : null;
  }

  /** What was heard and not yet said as an utterance: on a pause, or when the call stops. */
  flush(): Heard | null {
    if (this.finals.length === 0) return null;
    const text = this.finals.join(' ');
    this.finals = [];
    return { kind: 'utterance', text };
  }
}

/** The smallest socket the streams need; the global WebSocket in Node and Electron, or a fake in tests. */
export interface SocketLike {
  readyState: number;
  binaryType?: string;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
}

export type OpenSocket = (url: string, protocols: string[]) => SocketLike;

const OPEN = 1;
const KEEP_ALIVE_MS = 8_000;
/** One chunk of compressed audio is a quarter of a second; anything far larger is not ours. */
export const MAX_CHUNK_BYTES = 256 * 1024;

export class Streams {
  private sockets = new Map<Channel, SocketLike>();
  private assemblers = new Map<Channel, Assembler>();
  private queued = new Map<Channel, ArrayBuffer[]>();
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly open: OpenSocket,
    private readonly onHeard: (channel: Channel, heard: Heard) => void,
    private readonly onTrouble: (channel: Channel, message: string) => void,
  ) {}

  start(url: string, token: string): void {
    this.stop();
    for (const channel of CHANNELS) {
      // Deepgram takes a short-lived token as the socket's subprotocol.
      const socket = this.open(url, ['bearer', token]);
      socket.binaryType = 'arraybuffer';
      this.assemblers.set(channel, new Assembler());
      this.queued.set(channel, []);
      socket.onopen = () => {
        for (const chunk of this.queued.get(channel) ?? []) socket.send(chunk);
        this.queued.set(channel, []);
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let message: DeepgramResults;
        try {
          message = JSON.parse(event.data) as DeepgramResults;
        } catch {
          return;
        }
        const heard = this.assemblers.get(channel)?.feed(message);
        if (heard) this.onHeard(channel, heard);
      };
      socket.onerror = () => this.onTrouble(channel, 'The transcription stream had an error.');
      socket.onclose = (event) => {
        if (this.sockets.get(channel) !== socket) return;
        if (event.code !== 1000) this.onTrouble(channel, `The transcription stream closed (${event.code ?? 'no code'}).`);
      };
      this.sockets.set(channel, socket);
    }
    this.keepAlive = setInterval(() => {
      for (const socket of this.sockets.values()) {
        if (socket.readyState === OPEN) socket.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, KEEP_ALIVE_MS);
  }

  /** A quarter-second of compressed audio from one side; held until its stream is open. */
  send(channel: Channel, chunk: ArrayBuffer): void {
    if (chunk.byteLength === 0 || chunk.byteLength > MAX_CHUNK_BYTES) return;
    const socket = this.sockets.get(channel);
    if (!socket) return;
    if (socket.readyState === OPEN) socket.send(chunk);
    else {
      const queue = this.queued.get(channel) ?? [];
      // Twenty seconds of audio at most while connecting; older goes first.
      if (queue.length >= 80) queue.shift();
      queue.push(chunk);
      this.queued.set(channel, queue);
    }
  }

  get active(): boolean {
    return this.sockets.size > 0;
  }

  /** The call ended: say what was heard last, ask Deepgram to finish, and close. */
  stop(): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    for (const [channel, socket] of this.sockets) {
      const last = this.assemblers.get(channel)?.flush();
      if (last) this.onHeard(channel, last);
      try {
        if (socket.readyState === OPEN) socket.send(JSON.stringify({ type: 'CloseStream' }));
        socket.close(1000);
      } catch {
        // Already gone.
      }
    }
    this.sockets.clear();
    this.assemblers.clear();
    this.queued.clear();
  }
}
