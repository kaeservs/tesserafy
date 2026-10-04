/**
 * The newest overlay release, so the console can say who is behind it. Read
 * from the repository's public release list (no token) and cached for an
 * hour; null when GitHub cannot be reached, and the console then shows
 * versions without judging them.
 */
export async function newestOverlayVersion(): Promise<string | null> {
  try {
    const response = await fetch('https://api.github.com/repos/kaeservs/tesserafy/releases?per_page=10', {
      headers: { accept: 'application/vnd.github+json' },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const releases = (await response.json()) as { tag_name: string; draft: boolean }[];
    const newest = releases.find((release) => !release.draft && release.tag_name.startsWith('overlay-v'));
    return newest ? newest.tag_name.slice('overlay-v'.length) : null;
  } catch {
    return null;
  }
}

/** Whether `version` is older than `newest`. Unparseable is never "behind". */
export function behind(version: string, newest: string | null): boolean {
  if (!newest) return false;
  const a = version.split('.').map(Number);
  const b = newest.split('.').map(Number);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

export const PLATFORM: Record<string, string> = { win32: 'Windows', darwin: 'Mac', linux: 'Linux' };
