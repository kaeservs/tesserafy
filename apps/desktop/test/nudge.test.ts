import { describe, expect, it } from 'vitest';
import { nudged, NUDGE_STEP } from '../src/main/nudge';
import { MOVE_SHORTCUTS, SHORTCUTS } from '../src/main/shortcuts';

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const card = { x: 100, y: 100, width: 380, height: 300 };

describe('moving the overlay from the keyboard', () => {
  it('moves one step each way', () => {
    expect(nudged(card, area, 'right')).toMatchObject({ x: 100 + NUDGE_STEP, y: 100 });
    expect(nudged(card, area, 'left')).toMatchObject({ x: 100 - NUDGE_STEP, y: 100 });
    expect(nudged(card, area, 'up')).toMatchObject({ x: 100, y: 100 - NUDGE_STEP });
    expect(nudged(card, area, 'down')).toMatchObject({ x: 100, y: 100 + NUDGE_STEP });
  });

  it('stops at the edge of the display, whole and reachable', () => {
    expect(nudged({ ...card, x: 10 }, area, 'left')).toMatchObject({ x: 0 });
    expect(nudged({ ...card, x: 1920 - 380 - 5 }, area, 'right')).toMatchObject({ x: 1920 - 380 });
    expect(nudged({ ...card, y: 1040 - 300 }, area, 'down')).toMatchObject({ y: 1040 - 300 });
  });

  it('keeps to the display it is on, a second screen included', () => {
    const second = { x: 1920, y: 0, width: 1280, height: 1000 };
    expect(nudged({ ...card, x: 1925 }, second, 'left')).toMatchObject({ x: 1920 });
  });

  it('uses keys no other overlay shortcut uses', () => {
    const all = [...Object.values(SHORTCUTS), ...Object.values(MOVE_SHORTCUTS)];
    expect(new Set(all).size).toBe(all.length);
  });
});
