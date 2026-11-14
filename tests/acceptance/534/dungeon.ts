// The dungeon of criteria 1, 2, 3 and 8 (programs.ts: dungeon): one item `dungeon` at 60 Hz that reads the `move`
// control and saves slot 1 at steps 1,200 and 1,800, built against the layout `check` gives it, and its recorded
// input track.

import { layoutFor, piece, seeded, yours, type Entry, type JsonObject, type Saves } from './helpers.ts';
import { DUNGEON_WRITES, dungeon, layoutProbe, migration } from './programs.ts';

export const DUNGEON = 'dungeon';
export const SEED = 534_01;
/** The piece's saves: one slot, `request` its request array, and the migrations given. */
const saves = (migrate?: Saves['migrate']): Saves => ({ slots: 1, request: 'request', ...(migrate ? { migrate } : {}) });
/** The dungeon's piece: its program as first written, or changed (`nop`), with the migrations given. */
export function dungeonPiece(variant: 'same' | 'nop' = 'same', migrate?: Saves['migrate']): JsonObject {
  const l = layoutFor(layoutProbe(), ['move'], DUNGEON_WRITES);
  return piece({
    seed: SEED, controls: ['move'],
    items: { [DUNGEON]: { program: dungeon(l, variant), reads: ['move'], writes: DUNGEON_WRITES, saves: saves(migrate) } },
    ...(migrate ? { assets: [migration().bytes] } : {}),
  });
}
/** The migration's asset ID (its sha256). */
export const migrationId = (): string => migration().sha;

/** The step whose 40 moves arrive at once: at most 16 a control a step, so 8 still wait when step 1,799 ends. */
export const BURST_STEP = 1798;
export const BURST = 40;
/**
 * The recorded input: moves of yours at seeded steps below `steps` (about one in 30, values 0 to 7), and a burst of
 * BURST moves at BURST_STEP, so the save at step 1,800 holds an input position with entries still unread.
 */
export function dungeonTrack(steps = 2400): Entry[] {
  const r = seeded(534_11);
  const out: Entry[] = [];
  for (let k = 1; k < steps; k++) {
    if (k === BURST_STEP) for (let j = 0; j < BURST; j++) out.push(yours('move', k, j % 8, j));
    else if (r() < 1 / 30) out.push(yours('move', k, Math.floor(r() * 8)));
  }
  return out;
}
