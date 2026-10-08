import type { CSSProperties } from 'react';

/**
 * A few birds in the hero's sky, flapping and gliding where they are. Each
 * wing turns on the body and each bird drifts a few pixels, all of it CSS
 * transforms the compositor runs without the page doing any work; they pause
 * while the hero is off screen (./hero-motion), and hold still for anyone who
 * asked for reduced motion. Decorative: nothing here is read out.
 *
 * Placed in % of the hero, in the open sky either side of the headline, the
 * farther ones smaller and fainter. The painting has a few distant birds of
 * its own, right of centre; these keep clear of them. On a phone the headline
 * fills the width, so four of them fly in the strip of sky above it, placed
 * apart in % of that strip; the rest stay home.
 */

interface Bird {
  /** Left and top, in % of the hero. */
  readonly x: number;
  readonly y: number;
  /** Size, 1 being a near bird. */
  readonly s: number;
  /** One flap-and-glide cycle, and how far into it this bird starts, in seconds. */
  readonly flap: number;
  readonly delay: number;
  /** One slow drift there and back, in seconds. */
  readonly drift: number;
  /** Where it flies on a phone, in % of the strip above the headline; none, and it is not shown there. */
  readonly phone?: { readonly x: number; readonly y: number };
}

const BIRDS: readonly Bird[] = [
  { x: 10.5, y: 25, s: 1.1, flap: 2.6, delay: -0.4, drift: 9, phone: { x: 8, y: 34 } },
  { x: 15.5, y: 20.5, s: 0.85, flap: 3.1, delay: -1.7, drift: 11, phone: { x: 24, y: 8 } },
  { x: 18.5, y: 28, s: 0.7, flap: 2.3, delay: -0.9, drift: 8 },
  { x: 84, y: 19, s: 1, flap: 2.9, delay: -2.2, drift: 10, phone: { x: 78, y: 18 } },
  { x: 89.5, y: 25.5, s: 0.75, flap: 2.4, delay: -1.1, drift: 12, phone: { x: 89, y: 58 } },
  { x: 7, y: 32, s: 0.6, flap: 3.4, delay: -2.8, drift: 9.5 },
  { x: 79.5, y: 27, s: 0.55, flap: 2.7, delay: -0.2, drift: 8.5 },
  { x: 21, y: 50, s: 0.45, flap: 3.2, delay: -1.4, drift: 13 },
  { x: 79, y: 47, s: 0.45, flap: 2.5, delay: -2.5, drift: 11.5 },
];

export function HeroBirds() {
  return (
    <div className="hero-birds" aria-hidden="true">
      {BIRDS.map((bird) => (
        <span
          key={`${bird.x}-${bird.y}`}
          className={bird.phone ? 'bird' : 'bird wide-only'}
          style={
            {
              '--x': `${bird.x}%`,
              '--y': `${bird.y}%`,
              ...(bird.phone ? { '--phone-x': `${bird.phone.x}%`, '--phone-y': `${bird.phone.y}%` } : {}),
              '--s': bird.s,
              '--flap': `${bird.flap}s`,
              '--delay': `${bird.delay}s`,
              '--drift': `${bird.drift}s`,
            } as CSSProperties
          }
        >
          <i />
          <i />
        </span>
      ))}
    </div>
  );
}
