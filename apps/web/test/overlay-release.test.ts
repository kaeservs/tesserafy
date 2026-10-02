/** The "Get the overlay" page picks the newest published overlay release and names its installers. */
import { describe, expect, it } from 'vitest';
import { newestOverlay } from '@/lib/overlay-release';

const asset = (name: string, size = 100e6) => ({ name, browser_download_url: `https://example.test/${name}`, size });

describe('newestOverlay', () => {
  it('takes the first published overlay release, and labels each installer by platform', () => {
    const release = newestOverlay([
      { tag_name: 'overlay-v0.2.0', published_at: '2026-10-03', html_url: 'h0', draft: true, assets: [] },
      { tag_name: 'web-v9', published_at: '2026-10-02', html_url: 'h1', draft: false, assets: [] },
      {
        tag_name: 'overlay-v0.1.14',
        published_at: '2026-10-02',
        html_url: 'h2',
        draft: false,
        assets: [asset('Tesserafy-0.1.14-mac-x64.dmg'), asset('Tesserafy-Setup-0.1.14.exe', 93.6e6), asset('Tesserafy-0.1.14-mac-arm64.dmg')],
      },
    ]);
    expect(release?.version).toBe('0.1.14');
    expect(release?.downloads.map((d) => d.label)).toEqual(['Windows', 'Mac with Apple chip (M1 and later)', 'Mac with Intel']);
    expect(release?.downloads[0]?.sizeMb).toBe(94);
  });

  it('says none when there is none', () => {
    expect(newestOverlay([])).toBeNull();
  });
});
