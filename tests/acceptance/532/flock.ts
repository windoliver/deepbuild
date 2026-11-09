// The 100-boid flock of criteria 1, 2 and 5 (programs.ts: flock): one item `flock` at 60 Hz that reads the wind
// slider `wind` and writes 100 positions, built against the layout `check` gives it, in a piece of the figure class.

import { layoutFor, piece, seeded, yours, type Entry, type JsonObject } from './helpers.ts';
import { FLOCK_WRITES, flock, layoutProbe } from './programs.ts';

export const FLOCK = 'flock';
let built: JsonObject | undefined;
export function flockPiece(): JsonObject {
  if (built) return built;
  const l = layoutFor({ program: layoutProbe(), reads: ['wind'], writes: FLOCK_WRITES }, ['wind']);
  built = piece({ seed: 532_01, class: 'figure', controls: ['wind'], items: { [FLOCK]: { program: flock(l), reads: ['wind'], writes: FLOCK_WRITES } } });
  return built;
}
/** Wind-slider entries of yours at seeded steps (about one in 40) below `steps`, values in [-1, 1). */
export function windTrack(seed: number, steps: number): Entry[] {
  const r = seeded(seed);
  const out: Entry[] = [];
  for (let k = 1; k < steps; k++) if (r() < 0.025) out.push(yours('wind', k, Math.round((r() * 2 - 1) * 1000) / 1000));
  return out;
}
