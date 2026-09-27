/**
 * Is there a newer overlay than this one?
 *
 * A notice, not an updater. Installing an update in place needs the app to be
 * code-signed — Squirrel on macOS refuses an unsigned app — and this one is
 * not yet. So the overlay asks GitHub which releases exist, and if one is
 * newer than itself it says so, with a link to the release page: that page
 * has the installer for each system and says what to click past while the
 * installers are unsigned. A pilot who installed once still hears about the
 * fix that came after.
 *
 * Only `overlay-v*` releases count (the repository may publish other things),
 * never a draft or a prerelease, and only a page in this repository's
 * releases is ever opened: the address comes from GitHub's answer, and is
 * checked before it is kept.
 *
 * Everything but the request is pure, so it can be tested without a network.
 */

export const RELEASES_API = 'https://api.github.com/repos/kaeservs/tesserafy/releases?per_page=30';
const RELEASE_PAGE = 'https://github.com/kaeservs/tesserafy/releases/tag/overlay-v';

export interface Release {
  version: string;
  url: string;
}

/** "0.1.2" → [0, 1, 2]; anything else, null. */
export function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Whether `candidate` is a later version than `current`. Unparseable is never newer. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

/** The newest published overlay release in GitHub's answer, or null. */
export function latestOverlayRelease(body: unknown): Release | null {
  if (!Array.isArray(body)) return null;
  let best: Release | null = null;
  for (const item of body as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const release = item as Record<string, unknown>;
    const tag = release['tag_name'];
    const url = release['html_url'];
    if (release['draft'] === true || release['prerelease'] === true) continue;
    if (typeof tag !== 'string' || !tag.startsWith('overlay-v')) continue;
    const version = tag.slice('overlay-v'.length);
    if (!parseVersion(version)) continue;
    // Only ever this repository's own release page for this very tag.
    if (typeof url !== 'string' || url !== `${RELEASE_PAGE}${version}`) continue;
    if (!best || isNewer(version, best.version)) best = { version, url };
  }
  return best;
}
