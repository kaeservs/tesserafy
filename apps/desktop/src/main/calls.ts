/**
 * Is a call on? Which meeting app is using the microphone right now.
 *
 * Windows records, per app, when it last started and stopped using the
 * microphone — the record behind the microphone icon in the taskbar
 * (HKCU\…\CapabilityAccessManager\ConsentStore\microphone). An app whose stop
 * time is zero is using it now. That covers Zoom and Teams and, just as well,
 * Meet or Teams in a browser, which no process list could tell apart from a
 * browser doing anything else.
 *
 * Only meeting apps count — games and voice tools use the microphone too —
 * and never this app itself, which uses it while listening. Pure: the main
 * process runs `reg query` and hands its output here.
 *
 * macOS keeps the same fact in Core Audio rather than anywhere a command can
 * read it, so a small native helper (native/mac/mic-users.swift) prints it
 * and macMeetingMicrophoneUsers reads that. macOS 14.2 and later.
 */

export const MICROPHONE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

/** A meeting app, by its executable or packaged-app name, and what to call it. */
const MEETING_APPS: readonly { test: RegExp; label: string }[] = [
  { test: /(^|#)zoom\.exe$/i, label: 'Zoom' },
  { test: /(^|#)(ms-teams|teams)\.exe$|^MSTeams_/i, label: 'Teams' },
  { test: /(^|#)(ciscocollabhost|webexmta|webex)\.exe$/i, label: 'Webex' },
  { test: /(^|#)slack\.exe$/i, label: 'Slack' },
  { test: /(^|#)(chrome|msedge|firefox|brave|opera|vivaldi|arc)\.exe$/i, label: 'your browser' },
];

export interface MicrophoneUser {
  /** The app's key in the record: a path with # for \, or a packaged-app name. */
  readonly key: string;
  /** How the overlay names it: Zoom, Teams, your browser. */
  readonly label: string;
}

/**
 * The meeting apps using the microphone now, from `reg query MICROPHONE_KEY /s`.
 * `self` is this app's own executable path, left out.
 */
export function meetingMicrophoneUsers(output: string, self: string): MicrophoneUser[] {
  const own = self.replace(/\\/g, '#').toLowerCase();
  const users: MicrophoneUser[] = [];
  let key: string | null = null;
  let started = false;
  let stopped: boolean | null = null;

  const finish = () => {
    if (key && started && stopped === false && key.toLowerCase() !== own) {
      const app = MEETING_APPS.find((candidate) => candidate.test.test(key!));
      if (app) users.push({ key, label: app.label });
    }
  };

  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('HKEY_')) {
      finish();
      const name = line.slice(MICROPHONE_KEY.replace(/^HKCU/, 'HKEY_CURRENT_USER').length + 1);
      key = name.startsWith('NonPackaged\\') ? name.slice('NonPackaged\\'.length) : name;
      started = false;
      stopped = null;
      continue;
    }
    const value = /^LastUsedTime(Start|Stop)\s+REG_QWORD\s+0x([0-9a-f]+)$/i.exec(line);
    if (!value) continue;
    const zero = /^0+$/.test(value[2]!);
    if (value[1] === 'Start') started = !zero;
    else stopped = !zero;
  }
  finish();
  return users;
}

/** How a change reads: who started using the microphone, and whether anyone still is. */
export function callChange(before: readonly MicrophoneUser[], now: readonly MicrophoneUser[]): { started: string | null; ended: boolean } {
  const had = new Set(before.map((user) => user.key));
  const fresh = now.find((user) => !had.has(user.key));
  return { started: fresh?.label ?? null, ended: before.length > 0 && now.length === 0 };
}

/** The helper's name, beside the app's own executable in Contents/MacOS. */
export const MAC_HELPER = 'mic-users';

/** This app on a Mac, and its helper processes (com.tesserafy.overlay.helper), which capture while listening. */
export const MAC_BUNDLE_ID = 'com.tesserafy.overlay';

/**
 * A meeting app on a Mac, by bundle id. A prefix, because audio is often taken
 * by a helper process: Chrome's is com.google.Chrome.helper, Zoom's
 * us.zoom.CptHost. Safari captures in WebKit's shared GPU process.
 */
const MAC_MEETING_APPS: readonly { test: RegExp; label: string }[] = [
  { test: /^us\.zoom\./i, label: 'Zoom' },
  { test: /^com\.microsoft\.teams/i, label: 'Teams' },
  { test: /^(com\.cisco\.webex|cisco-systems\.spark)/i, label: 'Webex' },
  { test: /^com\.tinyspeck\.slackmacgap/i, label: 'Slack' },
  {
    test: /^(com\.google\.chrome|com\.microsoft\.edgemac|org\.mozilla\.|com\.brave\.browser|com\.operasoftware\.opera|com\.vivaldi\.vivaldi|company\.thebrowser\.browser|com\.apple\.safari|com\.apple\.webkit\.gpu)/i,
    label: 'your browser',
  },
];

/**
 * The meeting apps using the microphone now, from the Mac helper's output.
 * One entry per app, however many of its processes are capturing; never this
 * app. 'unsupported' on a macOS without the record (before 14.2), so the
 * caller can stop asking; null when the output is not the helper's.
 */
export function macMeetingMicrophoneUsers(output: string, self: string): MicrophoneUser[] | 'unsupported' | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { supported, users } = parsed as { supported?: unknown; users?: unknown };
  if (supported === false) return 'unsupported';
  if (supported !== true || !Array.isArray(users)) return null;
  const own = self.toLowerCase();
  const found: MicrophoneUser[] = [];
  for (const user of users as unknown[]) {
    const bundle = typeof user === 'object' && user !== null ? (user as { bundle?: unknown }).bundle : null;
    if (typeof bundle !== 'string' || bundle === '' || bundle.toLowerCase().startsWith(own)) continue;
    const app = MAC_MEETING_APPS.find((candidate) => candidate.test.test(bundle));
    if (app && !found.some((already) => already.label === app.label)) found.push({ key: app.label, label: app.label });
  }
  return found;
}
