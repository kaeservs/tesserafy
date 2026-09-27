import { describe, expect, it } from 'vitest';
import { isNewer, latestOverlayRelease, parseVersion } from '../src/main/updates';

const page = (version: string) => `https://github.com/kaeservs/tesserafy/releases/tag/overlay-v${version}`;
const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: page(tag.replace('overlay-v', '')),
  draft: false,
  prerelease: false,
  ...extra,
});

describe('isNewer', () => {
  it('compares versions by number, not by text', () => {
    expect(isNewer('0.1.10', '0.1.9')).toBe(true);
    expect(isNewer('0.2.0', '0.1.99')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('0.1.1', '0.1.1')).toBe(false);
    expect(isNewer('0.1.0', '0.1.1')).toBe(false);
  });

  it('never calls anything unparseable newer', () => {
    expect(parseVersion('0.1')).toBeNull();
    expect(isNewer('garbage', '0.1.0')).toBe(false);
    // An unpackaged run reports Electron's own version, which is not ours.
    expect(isNewer('0.2.0', '39.2.6-beta')).toBe(false);
  });
});

describe('latestOverlayRelease', () => {
  it('finds the newest overlay release, whatever the order', () => {
    expect(
      latestOverlayRelease([release('overlay-v0.1.0'), release('overlay-v0.1.2'), release('overlay-v0.1.1')]),
    ).toEqual({ version: '0.1.2', url: page('0.1.2') });
  });

  it('ignores drafts, prereleases and anything that is not an overlay release', () => {
    expect(
      latestOverlayRelease([
        release('overlay-v0.1.0'),
        release('overlay-v0.9.0', { draft: true }),
        release('overlay-v0.8.0', { prerelease: true }),
        {
          tag_name: 'v2.0.0',
          html_url: 'https://github.com/kaeservs/tesserafy/releases/tag/v2.0.0',
          draft: false,
          prerelease: false,
        },
        release('overlay-vnext'),
      ]),
    ).toEqual({ version: '0.1.0', url: page('0.1.0') });
  });

  it('never keeps a page anywhere but this repository\'s page for that release', () => {
    expect(latestOverlayRelease([release('overlay-v0.2.0', { html_url: 'https://evil.example/overlay-v0.2.0' })])).toBeNull();
    expect(latestOverlayRelease([release('overlay-v0.2.0', { html_url: page('0.3.0') })])).toBeNull();
  });

  it('treats an answer that is not a list, such as a rate limit, as nothing', () => {
    expect(latestOverlayRelease({ message: 'API rate limit exceeded' })).toBeNull();
    expect(latestOverlayRelease(null)).toBeNull();
    expect(latestOverlayRelease([])).toBeNull();
  });
});
