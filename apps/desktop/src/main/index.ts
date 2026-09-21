/**
 * The overlay window, and spike S1's apparatus.
 *
 * S1 asks one question the whole HUD rests on: does
 * `setContentProtection(true)` actually keep this window out of a shared
 * screen — on Zoom, on Meet in Chrome, on Teams, and for a window share as
 * well as a full-screen share?
 *
 * If it does not, the product is different: an overlay that appears in the
 * customer's view of the call is worse than no overlay, so the answer decides
 * whether P7 is a transparent always-on-top window at all.
 *
 * Nothing here is assumed. The window starts protected, the renderer can
 * toggle it, and the label is deliberately loud so a screenshot of the share
 * settles the question without anyone squinting.
 */
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';

let overlay: BrowserWindow | null = null;

function createOverlay(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 380;
  const height = 460;

  const window = new BrowserWindow({
    width,
    height,
    // Top right, clear of the meeting controls most tools put at the bottom.
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    // 'screen-saver' keeps it above full-screen meeting windows; the default
    // 'normal' level does not.
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // The claim under test. Starts on: a spike that starts unprotected risks
  // leaking a real overlay into a real call while someone is fiddling.
  window.setContentProtection(true);

  void window.loadFile(join(__dirname, '../renderer/index.html'));
  return window;
}

app.whenReady().then(() => {
  overlay = createOverlay();

  ipcMain.handle('overlay:set-protection', (_event, enabled: boolean) => {
    overlay?.setContentProtection(Boolean(enabled));
    return Boolean(enabled);
  });

  // Click-through: the meeting underneath must stay usable, which is the other
  // half of "the meeting stays visible and clickable" in the P7 gate.
  ipcMain.handle('overlay:set-click-through', (_event, enabled: boolean) => {
    overlay?.setIgnoreMouseEvents(Boolean(enabled), { forward: true });
    return Boolean(enabled);
  });

  ipcMain.handle('overlay:platform', () => ({
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }));

  // Where to reach the product, and as whom. The token lives in the main
  // process rather than in the page: a renderer is a browser, and a browser is
  // where a token gets read by something you did not write. Sign-in inside the
  // overlay is P7 work proper; an operator-supplied token is enough to prove
  // the loop.
  ipcMain.handle('overlay:config', () => ({
    baseUrl: process.env['TESSERAFY_URL'] ?? 'http://localhost:3000',
    token: process.env['TESSERAFY_TOKEN'] ?? null,
    engagementType: process.env['TESSERAFY_ENGAGEMENT'] ?? 'discovery',
  }));

  // The renderer never sees the token: it asks the main process to make the
  // call, and gets back only what the endpoint returned.
  ipcMain.handle('overlay:detect', async (_event, body: unknown) => {
    const baseUrl = process.env['TESSERAFY_URL'] ?? 'http://localhost:3000';
    const token = process.env['TESSERAFY_TOKEN'];
    if (!token) return { error: 'TESSERAFY_TOKEN is not set' };

    const response = await fetch(new URL('/api/detect', baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { error: `detect failed: ${response.status} ${await response.text()}` };
    }
    return response.json();
  });

  // T2, kept separate from detection in the main process as well as on the
  // server: a suggestion must never be able to delay a score, and the easiest
  // way to guarantee that is for them never to share a call.
  ipcMain.handle('overlay:suggest', async (_event, body: unknown) => {
    const baseUrl = process.env['TESSERAFY_URL'] ?? 'http://localhost:3000';
    const token = process.env['TESSERAFY_TOKEN'];
    if (!token) return { error: 'TESSERAFY_TOKEN is not set' };

    const response = await fetch(new URL('/api/suggest', baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { error: `suggest failed: ${response.status}` };
    }
    return response.json();
  });

  ipcMain.handle('overlay:criteria', async () => {
    const baseUrl = process.env['TESSERAFY_URL'] ?? 'http://localhost:3000';
    const token = process.env['TESSERAFY_TOKEN'];
    const engagement = process.env['TESSERAFY_ENGAGEMENT'] ?? 'discovery';
    if (!token) return { error: 'TESSERAFY_TOKEN is not set' };

    const url = new URL('/api/criteria', baseUrl);
    url.searchParams.set('engagement_type', engagement);
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) {
      return { error: `criteria failed: ${response.status} ${await response.text()}` };
    }
    return response.json();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) overlay = createOverlay();
  });
});

// The overlay is the app. Closing it should not leave a process behind on
// Windows, where there is no dock to return to.
app.on('window-all-closed', () => {
  app.quit();
});
