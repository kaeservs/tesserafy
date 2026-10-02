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
import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, net, safeStorage, screen, shell } from 'electron';
import { execFile } from 'node:child_process';
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
import { scorecardName } from './scorecard';
import { Session, type Store } from './session';
import { callChange, meetingMicrophoneUsers, MICROPHONE_KEY, type MicrophoneUser } from './calls';
import { nudged } from './nudge';
import { ASSIST_SHORTCUT, MOVE_SHORTCUTS, SHORTCUTS, shortcutLabel, type MoveDirection } from './shortcuts';
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
/**
 * The scorecard to fall back on when the dashboard names none. Which one a
 * call uses is decided in the dashboard (/api/live/setup), not here.
 */
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

/**
 * The display the overlay is on, as a JPEG no wider than 1600 px: enough to
 * read a slide or a spreadsheet, small enough to send quickly. Null when the
 * system will not give one (macOS without screen-recording permission).
 */
async function captureScreen(): Promise<{ mediaType: 'image/jpeg'; data: string } | null> {
  const display = overlay ? screen.getDisplayMatching(overlay.getBounds()) : screen.getPrimaryDisplay();
  const scale = Math.min(1, 1600 / display.size.width);
  const thumbnailSize = { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) };
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
    const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) return null;
    return { mediaType: 'image/jpeg', data: source.thumbnail.toJPEG(75).toString('base64') };
  } catch {
    return null;
  }
}

/**
 * A call starting: on Windows, a meeting app taking the microphone (./calls).
 * Checked every few seconds; when one starts, the overlay comes up — without
 * taking focus from the meeting — and the page offers Start. It never starts
 * listening by itself: the person presses Start, under their recording
 * agreement (ADR 0020). Off when the
 * person switched it off in the dashboard (Account → Overlay).
 */
let detectCalls = true;
let micUsers: MicrophoneUser[] = [];
function watchForCalls(): void {
  if (process.platform !== 'win32') return;
  const check = () =>
    execFile('reg', ['query', MICROPHONE_KEY, '/s'], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) return;
      const now = meetingMicrophoneUsers(stdout, process.execPath);
      const change = callChange(micUsers, now);
      micUsers = now;
      if (!overlay || !detectCalls) return;
      if (change.started) {
        if (!overlay.isVisible()) overlay.showInactive();
        overlay.webContents.send('overlay:call', { active: true, app: change.started });
      } else if (change.ended) {
        overlay.webContents.send('overlay:call', { active: false, app: null });
      }
    });
  setInterval(check, 4_000);
  check();
}

/** One press of a move shortcut: a step that way, kept on its display, and kept there. */
function nudge(direction: MoveDirection): void {
  if (!overlay) return;
  const bounds = overlay.getBounds();
  placed = nudged(bounds, screen.getDisplayMatching(bounds).workArea, direction);
  overlay.setBounds(placed);
  appearance = { ...appearance, position: { corner: null, x: placed.x, y: placed.y } };
  saveAppearance();
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
    // Undetectable in the meeting, as Cluely is: never on a shared screen or
    // in a recording (setContentProtection, below), and nowhere a colleague
    // glancing at the screen would see an app running. On Windows a tool
    // window is left out of Alt-Tab as well as the taskbar; on a Mac it is
    // left out of Mission Control, and the app out of the Dock and Cmd-Tab
    // (app.dock.hide, and LSUIElement in electron-builder.yml). It is still
    // an app anyone can find and quit in Task Manager or Activity Monitor,
    // under its own name: invisible to the meeting, not to the computer.
    ...(process.platform === 'win32' ? { type: 'toolbar' } : {}),
    hiddenInMissionControl: true,
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
  // No Dock icon, so no Cmd-Tab entry either; the menu-bar icon is how it is
  // shown, hidden and quit (./tray). LSUIElement does the same from launch in
  // an installed build; this covers a development run.
  if (process.platform === 'darwin') app.dock?.hide();
  if (!firstInstance) return;
  const session = new Session(BASE_URL, encryptedStore());
  // Before the window asks who is signed in, so a returning user is not shown
  // a sign-in form for the half-second a refresh takes.
  const resumed = session.resume().catch(() => false);

  // Before the window exists, so it opens where it was left rather than
  // appearing in the default corner and jumping.
  appearance = await loadAppearance();
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
    // Assist without reaching for the overlay, as Cluely's Cmd+Enter; not
    // plain Ctrl+Enter, which sends the message in Teams, Slack and Outlook.
    assist: globalShortcut.register(ASSIST_SHORTCUT, () => overlay?.webContents.send('overlay:assist-key')),
    // All four or none: an arrow that moves one way only is worse than none.
    move: (Object.keys(MOVE_SHORTCUTS) as MoveDirection[])
      .map((direction) => globalShortcut.register(MOVE_SHORTCUTS[direction], () => nudge(direction)))
      .every(Boolean),
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

  watchForCalls();
  setTimeout(() => void checkForUpdates(false), 5000);
  setInterval(() => void checkForUpdates(false), SIX_HOURS);

  ipcMain.handle('overlay:update', () => ({
    current: app.getVersion(),
    available: available?.version ?? null,
    note: null,
  }));
  ipcMain.handle('overlay:open-update', () => openUpdate());

  // The Terms that say asking everyone on the call is the seller's to do. A
  // fixed address on the product's own site, so the page can open nothing else.
  ipcMain.handle('overlay:open-terms', () => shell.openExternal(new URL('/terms', PRODUCTION_URL).toString()));

  // When a call ends: its page in the dashboard, at the follow-up email. Only
  // a call's own page on the product's site, so the page can open nothing else.
  ipcMain.handle('overlay:open-follow-up', (_event, conversationId: unknown) =>
    isId(conversationId) ? shell.openExternal(new URL(`/conversations/${conversationId}#follow-up`, BASE_URL).toString()) : undefined,
  );

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

  // What the next call starts with, as set in the dashboard: the customer,
  // scorecard and prep, and how the overlay looks. The look is applied here;
  // where the overlay sits stays this computer's (drag, or the arrow keys),
  // so a corner from the server is never taken.
  ipcMain.handle('overlay:setup', async () => {
    const response = await session.fetch('/api/live/setup');
    if (!response) return NOT_SIGNED_IN;
    if (!response.ok) return { error: `setup failed: ${response.status}` };
    const setup = (await response.json()) as { look?: Record<string, unknown>; detectCalls?: unknown };
    detectCalls = setup.detectCalls !== false;
    const look = setup.look ?? {};
    // The dashboard is where the look is set, so what it leaves unset is the
    // default — not whatever the last person on this computer chose.
    appearance = withChange(appearance, {
      theme: look['theme'] ?? DEFAULT_APPEARANCE.theme,
      accent: look['accent'] ?? DEFAULT_APPEARANCE.accent,
      opacity: look['opacity'] ?? DEFAULT_APPEARANCE.opacity,
      size: look['size'] ?? DEFAULT_APPEARANCE.size,
    });
    if (overlay) place(overlay);
    saveAppearance();
    return { ...setup, appearance };
  });

  // The Hide button: the same as the shortcut and the tray.
  ipcMain.handle('overlay:hide', () => overlay?.hide());

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
    engagementType: ENGAGEMENT,
    // As the keys read on this system, and whether they are ours: another app
    // may own them.
    shortcuts: {
      visible: { keys: shortcutLabel(SHORTCUTS.visible, process.platform), available: shortcuts.visible },
      clickThrough: {
        keys: shortcutLabel(SHORTCUTS.clickThrough, process.platform),
        available: shortcuts.clickThrough,
      },
      assist: { keys: shortcutLabel(ASSIST_SHORTCUT, process.platform), available: shortcuts.assist },
      move: {
        keys: shortcutLabel(MOVE_SHORTCUTS.up, process.platform).replace(/Up$/, process.platform === 'darwin' ? ' arrows' : 'arrow keys'),
        available: shortcuts.move,
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

  // The overlay's buttons and ask box (/api/assist): Assist, What should I
  // say?, Follow-up questions, Recap, or a typed question.
  // With the screen: one screenshot, taken here when the seller pressed for
  // it, of the display the overlay is on, and sent with this question alone.
  // The page never holds it, it is never written to disk, and the overlay is
  // not in it (content protection keeps it out of every capture).
  //
  // Streamed: each point is passed to the page the moment the server has
  // checked it ('overlay:assist-part', with the page's own sequence number so
  // a later question's points are never mixed into an earlier one's), and the
  // finished answer is what this resolves with.
  ipcMain.handle('overlay:assist', async (event, body: unknown, withScreen: unknown, seq: unknown) => {
    if (!body || typeof body !== 'object') return { error: 'nothing to ask' };
    let payload = body as Record<string, unknown>;
    if (withScreen === true) {
      const shot = await captureScreen();
      if (!shot) return { error: 'The screen could not be captured. On a Mac, allow screen recording for Tesserafy.' };
      payload = { ...payload, screen: shot };
    }
    const response = await session.fetch('/api/assist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify(payload),
    });
    if (!response) return NOT_SIGNED_IN;
    if (!response.ok || !response.body) {
      const failed = (await response.json().catch(() => ({}))) as { error?: unknown };
      return { error: typeof failed.error === 'string' ? failed.error : `/api/assist failed: ${response.status}` };
    }
    const decoder = new TextDecoder();
    let buffer = '';
    let finished: unknown = { error: 'The answer was cut off.' };
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let part: { type?: unknown; point?: unknown; error?: unknown };
        try {
          part = JSON.parse(line) as typeof part;
        } catch {
          continue;
        }
        if (part.type === 'point') event.sender.send('overlay:assist-part', { seq, point: part.point });
        else if (part.type === 'done') finished = part;
        else if (part.type === 'error') finished = { error: typeof part.error === 'string' ? part.error : 'That did not work.' };
      }
    }
    return finished;
  });

  // Before a call: a question answered from past calls and the company's
  // documents ("Ask your calls", /api/ask, ADR 0018), narrowed to the next
  // call's customer when the prep names one. Slower than Assist (seconds,
  // not one), so it is offered before Start, when there is time; each step
  // the agent takes is sent as it happens ('overlay:ask-step').
  ipcMain.handle('overlay:ask-calls', async (event, question: unknown, accountId: unknown, seq: unknown) => {
    if (typeof question !== 'string' || question.trim().length < 3 || question.length > 500) {
      return { error: 'A question is 3 to 500 characters.' };
    }
    const response = await session.fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: question.trim(), ...(isId(accountId) ? { accountId } : {}) }),
    });
    if (!response) return NOT_SIGNED_IN;
    if (!response.ok || !response.body) {
      const failed = (await response.json().catch(() => ({}))) as { error?: unknown };
      return { error: typeof failed.error === 'string' ? failed.error : `/api/ask failed: ${response.status}` };
    }
    const decoder = new TextDecoder();
    let buffer = '';
    let finished: unknown = { error: 'The answer was cut off.' };
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let part: { type?: unknown; text?: unknown; error?: unknown };
        try {
          part = JSON.parse(line) as typeof part;
        } catch {
          continue;
        }
        if (part.type === 'step' && typeof part.text === 'string') event.sender.send('overlay:ask-step', { seq, text: part.text });
        else if (part.type === 'answer') finished = part;
        else if (part.type === 'error') finished = { error: typeof part.error === 'string' ? part.error : 'That did not work.' };
      }
    }
    return finished;
  });

  // A point's moment, in the dashboard. Only a call's page at one of its
  // lines, on the product's own site: the page can open nothing else.
  ipcMain.handle('overlay:open-call', (_event, href: unknown) =>
    typeof href === 'string' && /^\/conversations\/[0-9a-f-]{36}#segment-[0-9a-f-]{36}$/i.test(href)
      ? shell.openExternal(new URL(href, BASE_URL).toString())
      : undefined,
  );

  // The one-time recording agreement (ADR 0020): the server chooses the words
  // and the Terms version; the overlay only says it was agreed, and where.
  ipcMain.handle('overlay:agree', () => post('/api/live/agreement', { surface: 'overlay' }));

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
  ipcMain.handle('overlay:brief', async (_event, id: unknown) => {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { error: 'not an account' };
    const response = await session.fetch(`/api/accounts/${id}/brief`);
    if (!response) return NOT_SIGNED_IN;
    return response.ok ? response.json() : { error: `brief failed: ${response.status}` };
  });

  // The newest version of the chosen scorecard; a call pins that version when
  // it starts, so publishing the next one mid-call changes nothing.
  ipcMain.handle('overlay:criteria', async (_event, name: unknown) => {
    const chosen = scorecardName(name) ?? ENGAGEMENT;
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
