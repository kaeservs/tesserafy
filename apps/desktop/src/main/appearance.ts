/**
 * How the overlay looks and where it sits.
 *
 * This computer's choice, not the account's: kept in a file beside the
 * encrypted sign-in, never sent anywhere. Where the overlay belongs depends
 * on the screen in front of the seller — a laptop and a desk monitor want
 * different corners and sizes — so a setting that followed the account to
 * another machine would be wrong there more often than right.
 *
 * What can be changed is chosen so the overlay stays legible over anything:
 *   - the background fades, the text never does, and never below
 *     MIN_OPACITY, where a busy slide behind it starts to win;
 *   - themes and accents are a short list rather than a colour picker, each
 *     checked for contrast;
 *   - the criterion states keep their colours in every theme. Green, amber
 *     and red mean something on this card, and an accent is not allowed to.
 *
 * Everything here is pure, so what arrives from the page — which is not
 * trusted to send only what it should — is normalised before it is used or
 * saved, and placement can be tested without a screen.
 */

export const THEMES = ['dark', 'midnight', 'light'] as const;
export const ACCENTS = ['indigo', 'sky', 'violet', 'stone'] as const;
export const SIZES = ['small', 'normal', 'large'] as const;
export const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];
export type Size = (typeof SIZES)[number];
export type Corner = (typeof CORNERS)[number];

export interface Appearance {
  theme: Theme;
  accent: Accent;
  /** Background opacity, in percent. The text is always fully opaque. */
  opacity: number;
  size: Size;
  /**
   * Pinned to a corner of whichever display holds (x, y), or — with no
   * corner — exactly where it was last dragged. x and y are null until the
   * window has been placed once.
   */
  position: { corner: Corner | null; x: number | null; y: number | null };
}

/** What the page may ask to change. Anything else it sends is ignored. */
export interface AppearanceChange {
  theme?: Theme;
  accent?: Accent;
  opacity?: number;
  size?: Size;
  corner?: Corner;
}

export const MIN_OPACITY = 35;

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'dark',
  accent: 'indigo',
  opacity: 88,
  size: 'normal',
  position: { corner: 'top-right', x: null, y: null },
};

/** The page is zoomed by this and the window grows with it. */
export const SCALE: Record<Size, number> = { small: 0.85, normal: 1, large: 1.2 };
const BASE = { width: 380, height: 460 };
/** Clear of the screen edge, and of the meeting controls at the bottom. */
const MARGIN = 24;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function oneOf<T extends string>(options: readonly T[], value: unknown): T | undefined {
  return options.find((option) => option === value);
}

function coordinate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function opacityOf(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(MIN_OPACITY, Math.round(value)));
}

/** Whatever was read from disk, as a valid appearance: bad fields become defaults. */
export function normalize(input: unknown): Appearance {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const position = (typeof raw['position'] === 'object' && raw['position'] !== null
    ? raw['position']
    : {}) as Record<string, unknown>;
  const x = coordinate(position['x']);
  const y = coordinate(position['y']);
  const corner = oneOf(CORNERS, position['corner']) ?? null;
  return {
    theme: oneOf(THEMES, raw['theme']) ?? DEFAULT_APPEARANCE.theme,
    accent: oneOf(ACCENTS, raw['accent']) ?? DEFAULT_APPEARANCE.accent,
    opacity: opacityOf(raw['opacity']) ?? DEFAULT_APPEARANCE.opacity,
    size: oneOf(SIZES, raw['size']) ?? DEFAULT_APPEARANCE.size,
    // Half a position is no position: a corner alone still places the window.
    position:
      x === null || y === null
        ? { corner: corner ?? DEFAULT_APPEARANCE.position.corner, x: null, y: null }
        : { corner, x, y },
  };
}

/** `current` with the page's change applied, where the change is valid. */
export function withChange(current: Appearance, change: unknown): Appearance {
  const raw = (typeof change === 'object' && change !== null ? change : {}) as Record<string, unknown>;
  const corner = oneOf(CORNERS, raw['corner']);
  return {
    theme: oneOf(THEMES, raw['theme']) ?? current.theme,
    accent: oneOf(ACCENTS, raw['accent']) ?? current.accent,
    opacity: opacityOf(raw['opacity']) ?? current.opacity,
    size: oneOf(SIZES, raw['size']) ?? current.size,
    position: corner ? { ...current.position, corner } : current.position,
  };
}

export function sizeOf(size: Size): { width: number; height: number } {
  return {
    width: Math.round(BASE.width * SCALE[size]),
    height: Math.round(BASE.height * SCALE[size]),
  };
}

function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** The display showing most of the window, or none if it is on none of them. */
function displayOf(rect: Rect, areas: Rect[]): Rect | undefined {
  let best: Rect | undefined;
  let most = 0;
  for (const area of areas) {
    const shared = overlap(rect, area);
    if (shared > most) {
      best = area;
      most = shared;
    }
  }
  return best;
}

function atCorner(corner: Corner, area: Rect, width: number, height: number): Rect {
  const left = area.x + MARGIN;
  const right = area.x + area.width - width - MARGIN;
  const top = area.y + MARGIN;
  const bottom = area.y + area.height - height - MARGIN;
  return {
    x: corner.endsWith('left') ? left : right,
    y: corner.startsWith('top') ? top : bottom,
    width,
    height,
  };
}

function clampInto(rect: Rect, area: Rect): Rect {
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, area.x), area.x + area.width - rect.width),
    y: Math.min(Math.max(rect.y, area.y), area.y + area.height - rect.height),
  };
}

/**
 * Where the window goes, given the work areas of the displays attached now.
 *
 * The display is the one showing most of the window, and a window dragged
 * part-way off it is pulled back whole. A position on a monitor that has
 * since been unplugged falls back to the primary display rather than opening
 * the overlay somewhere nobody can see it — and a window nobody can see
 * cannot be dragged back.
 */
export function placement(appearance: Appearance, areas: Rect[], primary: Rect): Rect {
  const { width, height } = sizeOf(appearance.size);
  const { corner, x, y } = appearance.position;
  const area = x === null || y === null ? undefined : displayOf({ x, y, width, height }, areas);

  if (corner) return atCorner(corner, area ?? primary, width, height);
  if (!area || x === null || y === null) {
    return atCorner(DEFAULT_APPEARANCE.position.corner ?? 'top-right', primary, width, height);
  }
  return clampInto({ x, y, width, height }, area);
}
