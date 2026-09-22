/**
 * The only bridge between the overlay UI and Electron.
 *
 * Context isolation is on and node integration is off, so the renderer gets
 * exactly these calls and nothing else — an overlay that renders customer
 * conversation is not a place to hand out a Node runtime.
 *
 * Note what is missing: the session token. Detection and criteria are fetched
 * by the main process, so the page never holds a credential it could leak.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('overlay', {
  setProtection: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('overlay:set-protection', enabled),
  setClickThrough: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('overlay:set-click-through', enabled),
  platform: (): Promise<{ platform: string; electron: string; chrome: string }> =>
    ipcRenderer.invoke('overlay:platform'),
  config: (): Promise<{ baseUrl: string; hasToken: boolean; engagementType: string }> =>
    ipcRenderer.invoke('overlay:config'),
  criteria: (): Promise<{ criteria?: unknown[]; error?: string }> =>
    ipcRenderer.invoke('overlay:criteria'),
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
