/** The overlay names itself on each request; only what it would say is recorded. */
import { describe, expect, it } from 'vitest';
import { overlayClient } from '@/lib/overlay-client';

describe('overlayClient', () => {
  it('reads a version and platform', () => {
    expect(overlayClient('0.1.15 win32')).toEqual({ version: '0.1.15', platform: 'win32' });
    expect(overlayClient(' 1.0.0 darwin ')).toEqual({ version: '1.0.0', platform: 'darwin' });
  });

  it('ignores anything else', () => {
    for (const value of [null, '', '0.1.15', 'latest win32', '0.1.15 windows', '0.1.15 win32; drop']) {
      expect(overlayClient(value)).toBeNull();
    }
  });
});
