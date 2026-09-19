/**
 * The only bridge between the overlay UI and Electron.
 *
 * Context isolation is on and node integration is off, so the renderer gets
 * exactly these three calls and nothing else — an overlay that renders
 * customer conversation is not a place to hand out a Node runtime.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('overlay', {
  setProtection: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('overlay:set-protection', enabled),
  setClickThrough: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('overlay:set-click-through', enabled),
  platform: (): Promise<{ platform: string; electron: string; chrome: string }> =>
    ipcRenderer.invoke('overlay:platform'),
});
