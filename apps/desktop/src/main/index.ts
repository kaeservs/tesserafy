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
import { app, BrowserWindow, globalShortcut, ipcMain, net, safeStorage, screen, shell } from 'electron';
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
import { chooseScorecard, parseScorecards, scorecardName } from './scorecard';
import { Session, type Store } from './session';
import { SHORTCUTS, shortcutLabel } from './shortcuts';
import { createTray, type OverlayTray } from './tray';
import { isNewer, latestOverlayRelease, RELEASES_API, type Release } from './updates';

let overlay: BrowserWindow | null = null;
let tray: OverlayTray | null = null;

/*
 * Two switches the overlay's buttons and the tray menu both show, so they are
 * kept here, once, and every change is sent to both. Protection starts on: a
 * spike that starts unprotected risks leaking a real overlay into a real call
 * while someone is fiddling.
 */
let protection = true;
let clickThrough = false;
/** The first measured height shows the window; after that, only the user does. */
let shownOnce = false;

function announce(): void {
  overlay?.webContents.send('overlay:state', { protection, clickThrough });
  tray?.refresh();
}

function setProtection(enabled: boolean): void {
  protection = enabled;
  overlay?.setContentProtection(enabled);
  announce();
}

function setClickThrough(enabled: boolean): void {
  clickThrough = enabled;
  overlay?.setIgnoreMouseEvents(enabled, { forward: true });
  announce();
}

/*
 * A newer overlay, if GitHub has published one (see ./updates). Checked
 * shortly after launch and every six hours, and when asked from the tray. A
 * check that fails — offline, rate-limited — says nothing unless it was asked
 * for: an overlay that nags about the network mid-call is worse than one that
 * finds out about an update tomorrow.
 */
let available: Release | null = null;
const SIX_HOURS = 6 * 60 * 60 * 1000;

type UpdateNote = 'latest' | 'failed' | null;

function announceUpdate(note: UpdateNote): void {
  overlay?.webContents.send('overlay:update', {
    current: app.getVersion(),
    available: available?.version ?? null,
    note,
  });
  tray?.refresh();
}

async function checkForUpdates(asked: boolean): Promise<void> {
  try {
    // Electron's network stack, not Node's, so an office proxy applies.
    const response = await net.fetch(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const latest = latestOverlayRelease(await response.json());
    available = latest && isNewer(latest.version, app.getVersion()) ? latest : null;
    announceUpdate(asked && !available ? 'latest' : null);
  } catch {
    if (asked) announceUpdate('failed');
  }
}

function openUpdate(): void {
  // The address was checked when it was kept (latestOverlayRelease): only
  // this repository's page for that release. The page never supplies one.
  if (available) void shell.openExternal(available.url);
}

function showFirstTime(window: BrowserWindow): void {
  if (shownOnce || window.isDestroyed()) return;
  shownOnce = true;
  window.show();
  tray?.refresh();
}
let appearance: Appearance = DEFAULT_APPEARANCE;
/** Where this process last put the window, so its own moves are not taken for a drag. */
let placed: Rect | null = null;

/**
 * Where the product is. A development build may be pointed elsewhere; an
 * installed one never is — the password and every token go to this address,
 * and any program running as the same user can set an environment variable.
 */
const PRODUCTION_URL = 'https://web-beta-khaki-cxdkp6udxk.vercel.app';
const BASE_URL = (!app.isPackaged && process.env['TESSERAFY_URL']) || PRODUCTION_URL;
/** The scorecard to fall back on when none has been chosen (see ./scorecard). */
const ENGAGEMENT = process.env['TESSERAFY_ENGAGEMENT'] ?? 'discovery';
/** The scorecard chosen on this computer, by name; null until one is. */
let scorecard: string | null = null;
const scorecardFile = () => join(app.getPath('userData'), 'scorecard.json');
async function loadScorecard(): Promise<string | null> {
  try {
    return scorecardName((JSON.parse(await readFile(scorecardFile(), 'utf8')) as { name?: unknown }).name);
  } catch {
    return null;
  }
}

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

/**
 * The card's height in CSS pixels, as the page last measured it. Undefined
 * until it has, when the window opens at a guess and stays hidden.
 */
let cardHeight: number | undefined;

/** Size, zoom and position for the current appearance; the position is then saved as placed. */
function place(window: BrowserWindow): void {
  const zoom = SCALE[appearance.size];
  placed = placement(
    appearance,
    workAreas(),
    screen.getPrimaryDisplay().workArea,
    cardHeight === undefined ? undefined : cardHeight * zoom,
  );
  window.setBounds(placed);
  window.webContents.setZoomFactor(zoom);
  appearance = { ...appearance, position: { ...appearance.position, x: placed.x, y: placed.y } };
}

function createOverlay(): BrowserWindow {
  // A new window measures and shows afresh (macOS re-creates one on activate).
  shownOnce = false;
  cardHeight = undefined;
  placed = placement(appearance, workAreas(), screen.getPrimaryDisplay().workArea);

  const window = new BrowserWindow({
    ...placed,
    // Shown once the page has measured its card and the window has taken its
    // height; otherwise an overlay pinned to a bottom corner opens at the
    // guessed height and visibly drops into place.
    show: false,
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

  // The page is this app's own file and nothing else. It never navigates or
  // opens a window (a link or a file dropped on it would otherwise load in
  // its place, with the preload's API attached), and it may ask for the
  // microphone — live speech recognition — and no other permission.
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const own = (url: string) => url.startsWith('file://');
  window.webContents.session.setPermissionRequestHandler((contents, permission, allow) =>
    allow(contents === window.webContents && permission === 'media' && own(contents.getURL())),
  );
  window.webContents.session.setPermissionCheckHandler((contents, permission) =>
    contents === window.webContents && permission === 'media' && own(contents?.getURL() ?? ''),
  );

  // The claim under test, and whatever the switches say now.
  window.setContentProtection(protection);
  if (clickThrough) window.setIgnoreMouseEvents(true, { forward: true });

  // If the page never reports its card, the overlay still appears, at the
  // guessed height, rather than never at all.
  window.once('ready-to-show', () => {
    setTimeout(() => showFirstTime(window), 1000);
  });
  window.on('show', () => tray?.refresh());
  window.on('hide', () => tray?.refresh());

  void window.loadFile(join(__dirname, '../renderer/index.html'));
  return window;
}

// One overlay at a time. A second launch — the Start menu after a desktop
// shortcut, say — would be a second window and a second tray icon, both
// listening to the same keys; instead it quits and brings the first forward.
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.quit();
app.on('second-instance', () => overlay?.show());

// `void`: nothing can await this, it is the top of the process. Marked so
// that the next promise added here has to say what it does about failure.
void app.whenReady().then(async () => {
  if (!firstInstance) return;
  const session = new Session(BASE_URL, encryptedStore());
  // Before the window asks who is signed in, so a returning user is not shown
  // a sign-in form for the half-second a refresh takes.
  const resumed = session.resume().catch(() => false);

  // Before the window exists, so it opens where it was left rather than
  // appearing in the default corner and jumping.
  appearance = await loadAppearance();
  scorecard = await loadScorecard();
  overlay = createOverlay();

  // Global shortcuts (see ./shortcuts). Showing is inactive: the overlay
  // appears without taking focus from the meeting being typed into. Each is
  // registered once; one another app owns stays false, and says so.
  const shortcuts = {
    visible: globalShortcut.register(SHORTCUTS.visible, () => {
      if (!overlay) return;
      if (overlay.isVisible()) overlay.hide();
      else overlay.showInactive();
    }),
    clickThrough: globalShortcut.register(SHORTCUTS.clickThrough, () => setClickThrough(!clickThrough)),
  };
  app.on('will-quit', () => globalShortcut.unregisterAll());

  tray = createTray({
    visible: () => overlay?.isVisible() ?? false,
    setVisible: (visible) => {
      if (!overlay) return;
      if (visible) overlay.show();
      else overlay.hide();
    },
    shortcuts: () => ({
      visible: shortcuts.visible ? SHORTCUTS.visible : null,
      clickThrough: shortcuts.clickThrough ? SHORTCUTS.clickThrough : null,
    }),
    clickThrough: () => clickThrough,
    setClickThrough,
    protection: () => protection,
    setProtection,
    version: () => app.getVersion(),
    update: () => available?.version ?? null,
    openUpdate,
    checkForUpdates: () => void checkForUpdates(true),
    quit: () => app.quit(),
  });

  setTimeout(() => void checkForUpdates(false), 5000);
  setInterval(() => void checkForUpdates(false), SIX_HOURS);

  ipcMain.handle('overlay:update', () => ({
    current: app.getVersion(),
    available: available?.version ?? null,
    note: null,
  }));
  ipcMain.handle('overlay:open-update', () => openUpdate());

  ipcMain.handle('overlay:appearance', () => appearance);

  // The card changed height: the window follows, so it covers the meeting
  // only where the card does. Not saved — the next launch measures again.
  ipcMain.handle('overlay:fit', (_event, height: unknown) => {
    if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return;
    if (!overlay) return;
    const changed = cardHeight === undefined || Math.abs(cardHeight - height) >= 1;
    cardHeight = height;
    if (changed) place(overlay);
    // Shown the first time only: an overlay hidden from the tray must not
    // come back because a suggestion changed the card's height.
    showFirstTime(overlay);
  });

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
    setProtection(Boolean(enabled));
    return protection;
  });

  // Click-through: the meeting underneath must stay usable, which is the other
  // half of "the meeting stays visible and clickable" in the P7 gate. Turned
  // off again from the tray, since nothing on the overlay can be clicked.
  ipcMain.handle('overlay:set-click-through', (_event, enabled: boolean) => {
    setClickThrough(Boolean(enabled));
    return clickThrough;
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
    engagementType: scorecard ?? ENGAGEMENT,
    // As the keys read on this system, and whether they are ours: another app
    // may own them.
    shortcuts: {
      visible: { keys: shortcutLabel(SHORTCUTS.visible, process.platform), available: shortcuts.visible },
      clickThrough: {
        keys: shortcutLabel(SHORTCUTS.clickThrough, process.platform),
        available: shortcuts.clickThrough,
      },
    },
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

  // The id goes into a path, so it must be an id and nothing else: "../.."
  // in it would reach any other route with the seller's token.
  const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);

  ipcMain.handle('overlay:live-segment', async (_event, conversationId: unknown, body: unknown) =>
    isId(conversationId) ? post(`/api/live/sessions/${conversationId}/segments`, body) : { error: 'not a call' },
  );

  ipcMain.handle('overlay:live-events', async (_event, conversationId: unknown, body: unknown) =>
    isId(conversationId) ? post(`/api/live/sessions/${conversationId}/events`, body) : { error: 'not a call' },
  );

  // The scorecards this person may use, and which is chosen: the remembered
  // one if still offered, else the company's own, else the default.
  ipcMain.handle('overlay:scorecards', async () => {
    const response = await session.fetch('/api/criteria/sets');
    if (!response) return NOT_SIGNED_IN;
    const sets = response.ok ? parseScorecards(await response.json()) : [];
    return { sets, chosen: chooseScorecard(sets, scorecard, ENGAGEMENT) };
  });

  // Who the call is with: the company's accounts, and a brief on the one chosen.
  // Not remembered — every call is with somebody different.
  ipcMain.handle('overlay:accounts', async () => {
    const response = await session.fetch('/api/accounts');
    if (!response) return NOT_SIGNED_IN;
    return response.ok ? response.json() : { error: `accounts failed: ${response.status}` };
  });

  ipcMain.handle('overlay:brief', async (_event, id: unknown) => {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { error: 'not an account' };
    const response = await session.fetch(`/api/accounts/${id}/brief`);
    if (!response) return NOT_SIGNED_IN;
    return response.ok ? response.json() : { error: `brief failed: ${response.status}` };
  });

  ipcMain.handle('overlay:set-scorecard', (_event, name: unknown) => {
    const chosen = scorecardName(name);
    if (!chosen) return scorecard;
    scorecard = chosen;
    writeFile(scorecardFile(), JSON.stringify({ name: chosen })).catch(() => undefined);
    return scorecard;
  });

  // The newest version of the chosen scorecard; a call pins that version when
  // it starts, so publishing the next one mid-call changes nothing.
  ipcMain.handle('overlay:criteria', async (_event, name: unknown) => {
    const chosen = scorecardName(name) ?? scorecard ?? ENGAGEMENT;
    const response = await session.fetch(`/api/criteria?engagement_type=${encodeURIComponent(chosen)}`);
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
