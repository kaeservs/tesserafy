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
import type { Appearance, AppearanceChange } from '../main/appearance';

interface UpdateState {
  current: string;
  available: string | null;
  /** Only after a check someone asked for: it found nothing newer, or failed. */
  note: 'latest' | 'failed' | null;
}

contextBridge.exposeInMainWorld('overlay', {
  appearance: (): Promise<Appearance> => ipcRenderer.invoke('overlay:appearance'),
  setAppearance: (change: AppearanceChange): Promise<Appearance> =>
    ipcRenderer.invoke('overlay:set-appearance', change),
  resetAppearance: (): Promise<Appearance> => ipcRenderer.invoke('overlay:reset-appearance'),
  quit: (): Promise<void> => ipcRenderer.invoke('overlay:quit'),
  fit: (height: number): Promise<void> => ipcRenderer.invoke('overlay:fit', height),
  // A newer overlay, if one is published. The page is told the version, never
  // an address: opening the release page is the main process's to do.
  update: (): Promise<UpdateState> => ipcRenderer.invoke('overlay:update'),
  openUpdate: (): Promise<void> => ipcRenderer.invoke('overlay:open-update'),
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
  scorecards: (): Promise<{
    sets?: { engagementType: string; version: number; own: boolean; label: string }[];
    chosen?: string | null;
    error?: string;
  }> => ipcRenderer.invoke('overlay:scorecards'),
  setScorecard: (engagementType: string): Promise<string | null> =>
    ipcRenderer.invoke('overlay:set-scorecard', engagementType),
  accounts: (): Promise<{ accounts?: { id: string; name: string }[]; error?: string }> =>
    ipcRenderer.invoke('overlay:accounts'),
  brief: (
    id: string,
  ): Promise<{
    name?: string;
    calls?: number;
    outcome?: string | null;
    last?: { title: string; date: string; score: number | null } | null;
    said?: { kind: string; summary: string; quote: string | null }[];
    notes?: string[];
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
