import { describe, expect, it } from 'vitest';
import { SHORTCUTS, shortcutLabel } from '../src/main/shortcuts';

describe('shortcutLabel', () => {
  it('reads as a Mac user expects on macOS', () => {
    expect(shortcutLabel(SHORTCUTS.visible, 'darwin')).toBe('⌘⌥⇧T');
    expect(shortcutLabel(SHORTCUTS.clickThrough, 'darwin')).toBe('⌘⌥⇧C');
  });

  it('spells the keys out elsewhere', () => {
    expect(shortcutLabel(SHORTCUTS.visible, 'win32')).toBe('Ctrl+Alt+Shift+T');
    expect(shortcutLabel(SHORTCUTS.clickThrough, 'linux')).toBe('Ctrl+Alt+Shift+C');
  });
});

describe('SHORTCUTS', () => {
  it('uses three modifiers, so they do not take keys other apps rely on', () => {
    for (const accelerator of Object.values(SHORTCUTS)) {
      expect(accelerator.split('+').slice(0, -1).sort()).toEqual(['Alt', 'CommandOrControl', 'Shift']);
    }
  });
});
