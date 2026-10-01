import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE as D,
  normalize,
  placement,
  withChange,
  type Appearance,
} from '../src/main/appearance';

// A 1920×1040 primary (taskbar below) and a 2560×1400 monitor to its right.
const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 2560, height: 1400 };
const areas = [primary, second];

const at = (position: Appearance['position'], rest: Partial<Appearance> = {}): Appearance => ({
  ...D,
  ...rest,
  position,
});

describe('normalize', () => {
  it('turns anything unreadable into the default look', () => {
    expect(normalize('nope')).toEqual(D);
    expect(normalize({ theme: 'hot-pink', opacity: 'x', size: 7, position: 3 })).toEqual(D);
  });

  it('survives a round trip through the file', () => {
    const look = withChange(withChange(D, { theme: 'midnight', accent: 'sky', size: 'small' }), {
      corner: 'top-left',
    });
    expect(normalize(JSON.parse(JSON.stringify(look)))).toEqual(look);
  });
});

describe('withChange', () => {
  it('clamps the background to 35–100% and rounds it', () => {
    expect(withChange(D, { opacity: 5 }).opacity).toBe(35);
    expect(withChange(D, { opacity: 150 }).opacity).toBe(100);
    expect(withChange(D, { opacity: 62.4 }).opacity).toBe(62);
  });

  it('lets the page choose a corner but never place the window itself', () => {
    const next = withChange(D, { position: { corner: null, x: -9999, y: -9999 }, theme: 'light', evil: 1 });
    expect(next.position).toEqual(D.position);
    expect(next.theme).toBe('light');
    expect(next).not.toHaveProperty('evil');
  });
});

describe('placement', () => {
  it('opens in the top-right corner of the primary display, 24 px in', () => {
    expect(placement(D, areas, primary)).toEqual({ x: 1920 - 520 - 24, y: 24, width: 520, height: 400 });
  });

  it('keeps a corner on the display the window is on', () => {
    expect(placement(at({ corner: 'bottom-left', x: 2000, y: 100 }), areas, primary)).toEqual({
      x: 1920 + 24,
      y: 1400 - 400 - 24,
      width: 520,
      height: 400,
    });
  });

  it('grows the window with Large and keeps a bottom corner on screen', () => {
    const r = placement(at({ corner: 'bottom-right', x: null, y: null }, { size: 'large' }), areas, primary);
    expect([r.width, r.height]).toEqual([624, 480]);
    expect(r.y + r.height).toBe(1040 - 24);
  });

  it('keeps a dragged position exactly', () => {
    expect(placement(at({ corner: null, x: 700, y: 300 }), areas, primary)).toEqual({
      x: 700,
      y: 300,
      width: 520,
      height: 400,
    });
  });

  it('pulls a window dragged part-way off the edge back on', () => {
    const r = placement(at({ corner: null, x: 1700, y: 900 }), [primary], primary);
    expect([r.x, r.y]).toEqual([1920 - 520, 1040 - 400]);
  });

  it('falls back to the primary display when the monitor has been unplugged', () => {
    expect(placement(at({ corner: null, x: 3000, y: 200 }), [primary], primary)).toEqual(
      placement(D, [primary], primary),
    );
    expect(placement(at({ corner: 'top-left', x: 3000, y: 200 }), [primary], primary)).toEqual({
      x: 24,
      y: 24,
      width: 520,
      height: 400,
    });
  });

  it('puts a window straddling two monitors on the one showing more of it', () => {
    // 120 px on the primary, 400 px on the second.
    expect(placement(at({ corner: null, x: 1800, y: 100 }), areas, primary).x).toBe(1920);
  });
});

describe('placement with the card measured', () => {
  it('takes the card\'s height, rounded up', () => {
    expect(placement(D, areas, primary, 301.4)).toEqual({ x: 1920 - 520 - 24, y: 24, width: 520, height: 302 });
  });

  it('grows upwards from a bottom corner, its bottom edge fixed', () => {
    const bottom = at({ corner: 'bottom-right', x: null, y: null });
    const short = placement(bottom, areas, primary, 300);
    const tall = placement(bottom, areas, primary, 420);
    expect(short.y + short.height).toBe(1040 - 24);
    expect(tall.y + tall.height).toBe(1040 - 24);
    expect(tall.y).toBeLessThan(short.y);
  });

  it('is never taller than the display, never shorter than 80, and ignores a non-number', () => {
    expect(placement(D, areas, primary, 5000).height).toBe(1040 - 48);
    expect(placement(D, areas, primary, 10).height).toBe(80);
    expect(placement(D, areas, primary, Number.NaN).height).toBe(400);
  });

  it('grows a dragged window downwards, pulling it up at the bottom edge', () => {
    const dragged = at({ corner: null, x: 700, y: 300 });
    expect(placement(dragged, areas, primary, 500)).toEqual({ x: 700, y: 300, width: 520, height: 500 });
    expect(placement(dragged, areas, primary, 900).y).toBe(1040 - 900);
  });
});
