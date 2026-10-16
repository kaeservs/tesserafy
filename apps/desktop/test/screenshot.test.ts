import { describe, expect, it } from 'vitest';
import { maskRect, overlayInShot } from '../src/main/screenshot';

describe("the overlay's own rectangle in a screenshot", () => {
  it('is placed by the display it is on, scaled to the thumbnail', () => {
    // A 2560-wide display to the right of another, shot at 1600 wide.
    const display = { x: 1920, y: 0, width: 2560, height: 1440 };
    const overlay = { x: 1920 + 1280, y: 160, width: 640, height: 320 };
    expect(overlayInShot(overlay, display, { width: 1600, height: 900 })).toEqual({ x: 800, y: 100, width: 400, height: 200 });
  });

  it('is filled grey, and nothing outside it is touched', () => {
    const width = 4;
    const height = 3;
    const bitmap = Buffer.alloc(width * height * 4, 7);
    maskRect(bitmap, width, height, { x: 1, y: 1, width: 2, height: 1 });
    const pixel = (x: number, y: number) => [...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
    expect(pixel(1, 1)).toEqual([128, 128, 128, 255]);
    expect(pixel(2, 1)).toEqual([128, 128, 128, 255]);
    expect(pixel(0, 1)).toEqual([7, 7, 7, 7]);
    expect(pixel(3, 1)).toEqual([7, 7, 7, 7]);
    expect(pixel(1, 0)).toEqual([7, 7, 7, 7]);
  });

  it('is clipped to the picture when the overlay hangs off its display', () => {
    const bitmap = Buffer.alloc(2 * 2 * 4, 0);
    expect(() => maskRect(bitmap, 2, 2, { x: -5, y: 1, width: 100, height: 100 })).not.toThrow();
    expect([...bitmap.subarray(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...bitmap.subarray(8, 16)]).toEqual([128, 128, 128, 255, 128, 128, 128, 255]);
  });
});
