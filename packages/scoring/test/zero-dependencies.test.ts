/**
 * Invariant 5: packages/scoring has zero runtime dependencies. It runs in the
 * web app and the Electron overlay, and must test without a network.
 */
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };

describe('packages/scoring', () => {
  it('declares no runtime dependencies', () => {
    const manifest = pkg as Record<string, unknown>;
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies ?? {}).toEqual({});
    expect(manifest.optionalDependencies ?? {}).toEqual({});
  });
});
