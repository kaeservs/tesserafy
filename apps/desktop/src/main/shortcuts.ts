/**
 * Keyboard shortcuts that work whatever has focus — the meeting, usually.
 *
 * Global, so they take their keys away from every other app while the overlay
 * runs. That is why they are three modifiers and a letter rather than
 * anything shorter: Ctrl+Shift+Space, say, is a non-breaking space in Word,
 * and a seller should not lose it to us. T for Tesserafy, C for click-through
 * — which is the one that matters most, since with click-through on nothing
 * on the overlay can be clicked, including the button that turns it off.
 *
 * Another app may already own a combination; registering it then fails, and
 * the overlay and the tray say it is unavailable rather than failing quietly.
 */

export const SHORTCUTS = {
  visible: 'CommandOrControl+Alt+Shift+T',
  clickThrough: 'CommandOrControl+Alt+Shift+C',
} as const;

export type ShortcutName = keyof typeof SHORTCUTS;

/** How the keys read on this system: ⌘⌥⇧T on a Mac, Ctrl+Alt+Shift+T elsewhere. */
export function shortcutLabel(accelerator: string, platform: string): string {
  const keys = accelerator.split('+');
  if (platform === 'darwin') {
    const mac: Record<string, string> = { CommandOrControl: '⌘', Alt: '⌥', Shift: '⇧' };
    return keys.map((key) => mac[key] ?? key).join('');
  }
  return keys.map((key) => (key === 'CommandOrControl' ? 'Ctrl' : key)).join('+');
}

/**
 * Moving the overlay without the mouse, as Cluely's arrow keys do: nothing is
 * dragged across a screen that is being shared, and it can be put out of the
 * way mid-sentence. The same three modifiers as the others, and the arrows.
 */
export const MOVE_SHORTCUTS = {
  up: 'CommandOrControl+Alt+Shift+Up',
  down: 'CommandOrControl+Alt+Shift+Down',
  left: 'CommandOrControl+Alt+Shift+Left',
  right: 'CommandOrControl+Alt+Shift+Right',
} as const;

export type MoveDirection = keyof typeof MOVE_SHORTCUTS;
