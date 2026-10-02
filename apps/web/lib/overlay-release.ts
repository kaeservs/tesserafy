/**
 * The newest overlay release, for the dashboard's "Get the overlay" page.
 *
 * Releases are built and published by the Overlay installer workflow when a
 * tag `overlay-vX.Y.Z` is pushed; this reads the repository's public release
 * list (no token: the repository is public) and caches it for an hour, so a
 * new release appears without a deploy and a slow GitHub never slows a page.
 */

const RELEASES = 'https://api.github.com/repos/kaeservs/tesserafy/releases?per_page=10';
export const RELEASES_PAGE = 'https://github.com/kaeservs/tesserafy/releases';

export interface OverlayRelease {
  readonly version: string;
  readonly publishedAt: string;
  readonly page: string;
  readonly downloads: readonly { readonly label: string; readonly url: string; readonly sizeMb: number }[];
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  html_url: string;
  draft: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
}

const LABELS: readonly [RegExp, string][] = [
  [/Setup-.*\.exe$/i, 'Windows'],
  [/mac-arm64\.dmg$/i, 'Mac with Apple chip (M1 and later)'],
  [/mac-x64\.dmg$/i, 'Mac with Intel'],
];

/** The newest published overlay release's installers, from GitHub's own list. */
export function newestOverlay(releases: readonly GitHubRelease[]): OverlayRelease | null {
  const release = releases.find((candidate) => !candidate.draft && candidate.tag_name.startsWith('overlay-v'));
  if (!release) return null;
  return {
    version: release.tag_name.replace(/^overlay-v/, ''),
    publishedAt: release.published_at,
    page: release.html_url,
    downloads: LABELS.flatMap(([pattern, label]) => {
      const asset = release.assets.find((candidate) => pattern.test(candidate.name));
      return asset ? [{ label, url: asset.browser_download_url, sizeMb: Math.round(asset.size / 1e6) }] : [];
    }),
  };
}

export async function latestOverlay(): Promise<OverlayRelease | null> {
  try {
    const response = await fetch(RELEASES, {
      headers: { accept: 'application/vnd.github+json' },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    return newestOverlay((await response.json()) as GitHubRelease[]);
  } catch {
    return null;
  }
}
