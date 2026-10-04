/**
 * The only bridge between the overlay UI and Electron.
 *
 * Context isolation is on and node integration is off, so the renderer gets
 * exactly these calls and nothing else — an overlay that renders customer
 * conversation is not a place to hand out a Node runtime.
 *
 * Note what is missing: the session token. Detection and criteria are fetched
 * by the main process, so the page never holds a credential it could leak.
 * Signing in sends a password to the main process once; what comes back is
 * who is signed in, never a token.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { Appearance } from '../main/appearance';

interface UpdateState {
  current: string;
  available: string | null;
  /** Only after a check someone asked for: it found nothing newer, or failed. */
  note: 'latest' | 'failed' | null;
}

contextBridge.exposeInMainWorld('overlay', {
  appearance: (): Promise<Appearance> => ipcRenderer.invoke('overlay:appearance'),
  // What the next call starts with, set in the dashboard; the main process
  // applies the look it names before answering.
  setup: (): Promise<{
    engagementType?: string;
    account?: { id: string; name: string } | null;
    prep?: { id: string; person: string; callAt: string | null; chosen: boolean } | null;
    live?: boolean;
    screen?: boolean;
    detectCalls?: boolean;
    // 'deepgram' when both sides of the call can be transcribed (ADR 0022).
    transcription?: 'deepgram' | null;
    appearance?: Appearance;
    error?: string;
  }> => ipcRenderer.invoke('overlay:setup'),
  hide: (): Promise<void> => ipcRenderer.invoke('overlay:hide'),
  // withScreen: the main process takes one screenshot and sends it with this
  // question; the page never sees it.
  assist: (body: unknown, withScreen = false, seq = 0): Promise<{
    mode?: string;
    points?: { text: string; quote: string | null; segmentId: string | null; document: string | null; fromScreen: boolean }[];
    error?: string;
  }> => ipcRenderer.invoke('overlay:assist', body, withScreen === true, Number(seq) || 0),
  // Before a call: past calls and documents answer (/api/ask), with the next
  // call's customer when there is one.
  askCalls: (question: string, accountId: string | null, seq = 0): Promise<{
    points?: {
      text: string;
      quote: string;
      href: string | null;
      call: { title: string; occurredAt: string | null; startMs: number; speaker: string | null } | null;
      document: string | null;
    }[];
    note?: string;
    dropped?: number;
    error?: string;
  }> => ipcRenderer.invoke('overlay:ask-calls', question, accountId, Number(seq) || 0),
  onAskStep: (listener: (step: { seq: number; text: string }) => void): void => {
    ipcRenderer.on('overlay:ask-step', (_event, step: { seq?: unknown; text?: unknown }) => {
      if (typeof step.text === 'string') listener({ seq: Number(step.seq) || 0, text: step.text });
    });
  },
  openCall: (href: string): Promise<void> => ipcRenderer.invoke('overlay:open-call', href),
  // One point of an answer still being written, as soon as it is checked.
  onAssistPart: (
    listener: (part: { seq: number; point: { text: string; quote: string | null; segmentId: string | null; document: string | null; fromScreen: boolean } }) => void,
  ): void => {
    ipcRenderer.on('overlay:assist-part', (_event, part: { seq?: unknown; point?: unknown }) => {
      const point = part.point as Record<string, unknown> | null;
      if (!point || typeof point['text'] !== 'string') return;
      listener({
        seq: Number(part.seq) || 0,
        point: {
          text: point['text'],
          quote: typeof point['quote'] === 'string' ? point['quote'] : null,
          segmentId: typeof point['segmentId'] === 'string' ? point['segmentId'] : null,
          document: typeof point['document'] === 'string' ? point['document'] : null,
          fromScreen: point['fromScreen'] === true,
        },
      });
    });
  },
  // A meeting app started (or stopped) using the microphone (main/calls).
  onCall: (listener: (call: { active: boolean; app: string | null }) => void): void => {
    ipcRenderer.on('overlay:call', (_event, call: { active?: unknown; app?: unknown }) =>
      listener({ active: call.active === true, app: typeof call.app === 'string' ? call.app : null }),
    );
  },
  // The Assist shortcut was pressed, whichever window is in front.
  onAssistKey: (listener: () => void): void => {
    ipcRenderer.on('overlay:assist-key', () => listener());
  },
  quit: (): Promise<void> => ipcRenderer.invoke('overlay:quit'),
  fit: (height: number): Promise<void> => ipcRenderer.invoke('overlay:fit', height),
  // A newer overlay, if one is published. The page is told the version, never
  // an address: opening the release page is the main process's to do.
  update: (): Promise<UpdateState> => ipcRenderer.invoke('overlay:update'),
  openUpdate: (): Promise<void> => ipcRenderer.invoke('overlay:open-update'),
  openTerms: (): Promise<void> => ipcRenderer.invoke('overlay:open-terms'),
  agree: (): Promise<{ agreedAt?: string; termsVersion?: string; error?: string }> => ipcRenderer.invoke('overlay:agree'),
  // Both sides of the call as text (ADR 0022): the main process holds the
  // streams; the page sends audio and is told what was heard.
  transcribeStart: (): Promise<{ ok?: boolean; error?: string }> => ipcRenderer.invoke('overlay:transcribe-start'),
  transcribeStop: (): Promise<void> => ipcRenderer.invoke('overlay:transcribe-stop'),
  sendAudio: (channel: 'me' | 'them', chunk: ArrayBuffer): void => ipcRenderer.send('overlay:audio', channel, chunk),
  onTranscript: (listener: (heard: { channel: 'me' | 'them'; kind: 'interim' | 'utterance'; text: string }) => void): void => {
    ipcRenderer.on('overlay:transcript', (_event, heard: { channel?: unknown; kind?: unknown; text?: unknown }) => {
      if ((heard.channel === 'me' || heard.channel === 'them') && (heard.kind === 'interim' || heard.kind === 'utterance') && typeof heard.text === 'string') {
        listener({ channel: heard.channel, kind: heard.kind, text: heard.text });
      }
    });
  },
  onTranscriptTrouble: (listener: (trouble: { channel: string; message: string }) => void): void => {
    ipcRenderer.on('overlay:transcript-trouble', (_event, trouble: { channel?: unknown; message?: unknown }) => {
      if (typeof trouble.message === 'string') listener({ channel: String(trouble.channel), message: trouble.message });
    });
  },
  openFollowUp: (conversationId: string): Promise<void> => ipcRenderer.invoke('overlay:open-follow-up', conversationId),
  onUpdate: (listener: (state: UpdateState) => void): void => {
    ipcRenderer.on('overlay:update', (_event, state: UpdateState) =>
      listener({
        current: String(state.current),
        available: typeof state.available === 'string' ? state.available : null,
        note: state.note === 'latest' || state.note === 'failed' ? state.note : null,
      }),
    );
  },
  // The switches changed, possibly from the tray. Only the two booleans cross;
  // the page is never handed the event or ipcRenderer itself.
  onState: (listener: (state: { protection: boolean; clickThrough: boolean }) => void): void => {
    ipcRenderer.on('overlay:state', (_event, state: { protection: boolean; clickThrough: boolean }) =>
      listener({ protection: Boolean(state.protection), clickThrough: Boolean(state.clickThrough) }),
    );
  },
  setProtection: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('overlay:set-protection', enabled),
  setClickThrough: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('overlay:set-click-through', enabled),
  platform: (): Promise<{ platform: string; electron: string; chrome: string }> =>
    ipcRenderer.invoke('overlay:platform'),
  config: (): Promise<{
    baseUrl: string;
    engagementType: string;
    shortcuts: {
      visible: { keys: string; available: boolean };
      clickThrough: { keys: string; available: boolean };
      assist: { keys: string; available: boolean };
      move: { keys: string; available: boolean };
    };
  }> => ipcRenderer.invoke('overlay:config'),
  session: (): Promise<{ email: string | null; remembers: boolean }> =>
    ipcRenderer.invoke('overlay:session'),
  signIn: (
    identifier: string,
    password: string,
  ): Promise<{ ok: true; email: string } | { ok: false; message: string }> =>
    ipcRenderer.invoke('overlay:sign-in', identifier, password),
  signOut: (): Promise<{ email: null }> => ipcRenderer.invoke('overlay:sign-out'),
  criteria: (engagementType?: string): Promise<{ criteria?: unknown[]; error?: string }> =>
    ipcRenderer.invoke('overlay:criteria', engagementType),
  brief: (
    id: string,
  ): Promise<{
    name?: string;
    calls?: number;
    outcome?: string | null;
    last?: { title: string; date: string; score: number | null } | null;
    said?: { kind: string; summary: string; quote: string | null }[];
    notes?: string[];
    /** The prep for the call about to happen, when someone wrote one. */
    prep?: {
      person: string;
      callAt: string | null;
      openWith: string | null;
      questions: { key: string; label: string; ask: string }[];
    } | null;
    error?: string;
  }> => ipcRenderer.invoke('overlay:brief', id),
  detect: (body: unknown): Promise<{ events?: unknown[]; error?: string }> =>
    ipcRenderer.invoke('overlay:detect', body),
  suggest: (
    body: unknown,
  ): Promise<{ suggestion?: { ask: string; because: string } | null; error?: string }> =>
    ipcRenderer.invoke('overlay:suggest', body),
  liveStart: (body: unknown): Promise<{ conversationId?: string; error?: string }> =>
    ipcRenderer.invoke('overlay:live-start', body),
  liveSegment: (
    conversationId: string,
    body: unknown,
  ): Promise<{ segmentId?: string; error?: string }> =>
    ipcRenderer.invoke('overlay:live-segment', conversationId, body),
  liveEvents: (
    conversationId: string,
    body: unknown,
  ): Promise<{ recorded?: number; rejected?: number; error?: string }> =>
    ipcRenderer.invoke('overlay:live-events', conversationId, body),
});
