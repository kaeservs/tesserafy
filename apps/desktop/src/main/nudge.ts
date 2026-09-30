import type { MoveDirection } from './shortcuts';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How far one press moves the overlay, in screen pixels. */
export const NUDGE_STEP = 40;

const DIRECTION: Record<MoveDirection, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * Where one press of a move shortcut puts the overlay: a step that way, kept
 * whole on the display it is on. A step that would push it off an edge stops
 * at the edge, so it can never be moved somewhere it cannot be seen or reached.
 */
export function nudged(bounds: Rect, area: Rect, direction: MoveDirection, step = NUDGE_STEP): Rect {
  const [dx, dy] = DIRECTION[direction];
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
  return {
    ...bounds,
    x: clamp(bounds.x + dx * step, area.x, area.x + area.width - bounds.width),
    y: clamp(bounds.y + dy * step, area.y, area.y + area.height - bounds.height),
  };
}
