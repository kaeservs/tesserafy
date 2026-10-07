/**
 * How the overlay can look, as the dashboard offers it. The same short lists
 * as the overlay itself (apps/desktop/src/main/appearance.ts) and the database
 * (set_overlay_look): each checked for contrast there, so there is no free
 * colour to pick here either.
 */
export const OVERLAY_THEMES = [
  { value: 'glass', label: 'Glass' },
  { value: 'dark', label: 'Dark' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'light', label: 'Light' },
] as const;

export const OVERLAY_ACCENTS = [
  { value: 'indigo', label: 'Indigo' },
  { value: 'sky', label: 'Sky' },
  { value: 'violet', label: 'Violet' },
  { value: 'stone', label: 'Neutral' },
] as const;

export const OVERLAY_SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
] as const;

/** The background fades down to this, never further: text over a busy slide must stay readable. */
export const OVERLAY_MIN_OPACITY = 35;

export interface OverlayLook {
  theme: string;
  accent: string;
  opacity: number;
  size: string;
}

export const DEFAULT_LOOK: OverlayLook = { theme: 'glass', accent: 'indigo', opacity: 88, size: 'normal' };

/** A stored look, with the defaults for anything not set or not recognised. */
export function readLook(value: unknown): OverlayLook {
  const look = value && typeof value === 'object' ? (value as Partial<Record<keyof OverlayLook, unknown>>) : {};
  const pick = <T extends readonly { value: string }[]>(options: T, wanted: unknown, fallback: string) =>
    options.some((option) => option.value === wanted) ? (wanted as string) : fallback;
  const opacity = typeof look.opacity === 'number' ? Math.round(look.opacity) : DEFAULT_LOOK.opacity;
  return {
    theme: pick(OVERLAY_THEMES, look.theme, DEFAULT_LOOK.theme),
    accent: pick(OVERLAY_ACCENTS, look.accent, DEFAULT_LOOK.accent),
    opacity: Math.min(100, Math.max(OVERLAY_MIN_OPACITY, opacity)),
    size: pick(OVERLAY_SIZES, look.size, DEFAULT_LOOK.size),
  };
}
