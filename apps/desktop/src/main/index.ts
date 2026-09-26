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
import { app, BrowserWindow, ipcMain, safeStorage, screen } from 'electron';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_APPEARANCE,
  normalize,
  placement,
  SCALE,
  withChange,
  type Appearance,
  type Rect,
} from './appearance';
import { Session, type Store } from './session';

let overlay: BrowserWindow | null = null;
let appearance: Appearance = DEFAULT_APPEARANCE;
/** Where this process last put the window, so its own moves are not taken for a drag. */
let placed: Rect | null = null;

/** Where the product is. The production app unless told otherwise. */
const BASE_URL = process.env['TESSERAFY_URL'] ?? 'https://web-beta-khaki-cxdkp6udxk.vercel.app';
const ENGAGEMENT = process.env['TESSERAFY_ENGAGEMENT'] ?? 'discovery';

/**
 * The refresh token, encrypted by the operating system and nowhere else.
 *
 * safeStorage uses the Windows account's DPAPI and the macOS Keychain. Where
 * it is unavailable — some Linux desktops without a keyring — Electron would
 * fall back to a hard-coded key, which is encryption in name only; so then
 * nothing is saved and the overlay asks for a password each launch instead.
 */
function encryptedStore(): Store {
  const file = join(app.getPath('userData'), 'session.bin');
  const persistent = safeStorage.isEncryptionAvailable();
  return {
    persistent,
    async read() {
      if (!persistent) return null;
      try {
        return safeStorage.decryptString(await readFile(file));
      } catch {
        return null;
      }
    },
    async write(refreshToken) {
      if (!persistent) return;
      await writeFile(file, safeStorage.encryptString(refreshToken));
    },
    async clear() {
      await rm(file, { force: true });
    },
  };
}

/*
 * The overlay's look, kept on this computer (see ./appearance for why). Not
 * encrypted: it says which corner and which colour, nothing about anyone.
 * A file that is missing or unreadable is the default look, and a failed
 * save is only a look not remembered — neither is worth interrupting a call.
 */
const appearanceFile = () => join(app.getPath('userData'), 'appearance.json');

async function loadAppearance(): Promise<Appearance> {
  try {
    return normalize(JSON.parse(await readFile(appearanceFile(), 'utf8')));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function saveAppearance(): void {
  writeFile(appearanceFile(), JSON.stringify(appearance, null, 2)).catch(() => undefined);
}

function workAreas(): Rect[] {
  return screen.getAllDisplays().map((display) => display.workArea);
}

/** Size, zoom and position for the current appearance; the position is then saved as placed. */
function place(window: BrowserWindow): void {
  placed = placement(appearance, workAreas(), screen.getPrimaryDisplay().workArea);
  window.setBounds(placed);
  window.webContents.setZoomFactor(SCALE[appearance.size]);
  appearance = { ...appearance, position: { ...appearance.position, x: placed.x, y: placed.y } };
}

function createOverlay(): BrowserWindow {
  placed = placement(appearance, workAreas(), screen.getPrimaryDisplay().workArea);

  const window = new BrowserWindow({
    ...placed,
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
      zoomFactor: SCALE[appearance.size],
    },
  });

  // Dragged somewhere: it stays there, on that display, from now on. `moved`
  // fires once a drag ends; a move this process made itself is not a choice.
  window.on('moved', () => {
    const { x, y } = window.getBounds();
    if (placed && placed.x === x && placed.y === y) return;
    placed = window.getBounds();
    appearance = { ...appearance, position: { corner: null, x, y } };
    saveAppearance();
  });

  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // The claim under test. Starts on: a spike that starts unprotected risks
  // leaking a real overlay into a real call while someone is fiddling.
  window.setContentProtection(true);

  void window.loadFile(join(__dirname, '../renderer/index.html'));
  return window;
}

// `void`: nothing can await this, it is the top of the process. Marked so
// that the next promise added here has to say what it does about failure.
void app.whenReady().then(async () => {
  const session = new Session(BASE_URL, encryptedStore());
  // Before the window asks who is signed in, so a returning user is not shown
  // a sign-in form for the half-second a refresh takes.
  const resumed = session.resume().catch(() => false);

  // Before the window exists, so it opens where it was left rather than
  // appearing in the default corner and jumping.
  appearance = await loadAppearance();
  overlay = createOverlay();

  ipcMain.handle('overlay:appearance', () => appearance);

  // Whatever the page sends is checked field by field; a size or corner
  // change moves the window, the rest is the page's own CSS.
  ipcMain.handle('overlay:set-appearance', (_event, change: unknown) => {
    appearance = withChange(appearance, change);
    if (overlay) place(overlay);
    saveAppearance();
    return appearance;
  });

  ipcMain.handle('overlay:reset-appearance', () => {
    appearance = DEFAULT_APPEARANCE;
    if (overlay) place(overlay);
    saveAppearance();
    return appearance;
  });

  ipcMain.handle('overlay:session', async () => {
    await resumed;
    return { email: session.signedInAs, remembers: session.remembers };
  });

  // The password crosses from the page to here once, goes to Auth, and is
  // not kept. What the page gets back is who, never a token.
  ipcMain.handle('overlay:sign-in', async (_event, identifier: string, password: string) =>
    session.signIn(String(identifier), String(password)),
  );

  ipcMain.handle('overlay:sign-out', async () => {
    await session.signOut();
    return { email: null };
  });

  // The overlay's own way out. On macOS a window kept above full-screen
  // meetings makes the app a background agent — no Dock icon, no menu bar —
  // so without this there is nothing to quit it from but Activity Monitor.
  ipcMain.handle('overlay:quit', () => {
    app.quit();
  });

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

  // Where the product is, and which criteria to score against — not as whom.
  // Who is signed in is overlay:session; the token is never sent here.
  ipcMain.handle('overlay:config', () => ({
    baseUrl: BASE_URL,
    engagementType: ENGAGEMENT,
  }));

  const NOT_SIGNED_IN = { error: 'not signed in' };

  // The renderer never sees the token: it asks the main process to make the
  // call, and gets back only what the endpoint returned.
  ipcMain.handle('overlay:detect', async (_event, body: unknown) => {
    const response = await session.fetch('/api/detect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response) return NOT_SIGNED_IN;
    if (!response.ok) {
      return { error: `detect failed: ${response.status} ${await response.text()}` };
    }
    return response.json();
  });

  // T2, kept separate from detection in the main process as well as on the
  // server: a suggestion must never be able to delay a score, and the easiest
  // way to guarantee that is for them never to share a call.
  ipcMain.handle('overlay:suggest', async (_event, body: unknown) => {
    const response = await session.fetch('/api/suggest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response) return NOT_SIGNED_IN;
    if (!response.ok) {
      return { error: `suggest failed: ${response.status}` };
    }
    return response.json();
  });

  /*
   * Keeping the call.
   *
   * Three thin proxies, for the same reason detection is one: the session
   * lives here and never in the page. They add nothing of their own — every rule
   * about what may be written lives in the database, where a caller that
   * skipped this process would still meet it.
   *
   * None of them is awaited by anything on the critical path. A call worth
   * keeping is still not worth a millisecond of the score.
   */
  const post = async (path: string, body: unknown) => {
    const response = await session.fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response) return NOT_SIGNED_IN;
    if (!response.ok) {
      return { error: `${path} failed: ${response.status}` };
    }
    return response.json();
  };

  ipcMain.handle('overlay:live-start', async (_event, body: unknown) =>
    post('/api/live/sessions', body),
  );

  ipcMain.handle('overlay:live-segment', async (_event, conversationId: string, body: unknown) =>
    post(`/api/live/sessions/${conversationId}/segments`, body),
  );

  ipcMain.handle('overlay:live-events', async (_event, conversationId: string, body: unknown) =>
    post(`/api/live/sessions/${conversationId}/events`, body),
  );

  ipcMain.handle('overlay:criteria', async () => {
    const response = await session.fetch(
      `/api/criteria?engagement_type=${encodeURIComponent(ENGAGEMENT)}`,
    );
    if (!response) return NOT_SIGNED_IN;
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
