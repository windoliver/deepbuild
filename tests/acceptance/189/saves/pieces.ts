// The pieces of this suite (README: Programs): the dungeon in each of its programs, the scribe and the roguelike, each
// one logic item at 60 Hz built against the region map `check` gives it, and the dungeon's recorded input track.

import { checkCall, one, piece, readOffsets, seeded, writeOffsets, yours, type Entry, type JsonObject, type Migration, type Program, type Writes } from './helpers.ts';
import {
  DUNGEON, DUNGEON_WRITES, ROGUE, ROGUE_WRITES, SCRIBE, SCRIBE_PAGES, SCRIBE_WRITES, VARIANTS, dungeon, layoutProbe, roguelike, scribe, type Regions, type Variant,
} from './programs.ts';

/** The region map `check` gives an item with these reads and writes (through the layout probe). */
const maps = new Map<string, { reads: Record<string, number>; writes: Record<string, number> }>();
export function regions(reads: string[], writes: Writes): { reads: Record<string, number>; writes: Record<string, number> } {
  const key = JSON.stringify([reads, writes]);
  const known = maps.get(key);
  if (known) return known;
  const reply = one(checkCall(piece({ seed: 189, controls: reads, items: { probe: { program: layoutProbe(), reads, writes } } })));
  if (reply['ok'] !== true) throw Error(`check of the layout probe refused it: ${JSON.stringify(reply).slice(0, 600)}`);
  const got = { reads: readOffsets(reply, 'probe'), writes: writeOffsets(reply, 'probe') };
  maps.set(key, got);
  return got;
}

export const SEED = 189_01;
export type VariantName = keyof typeof VARIANTS;
/** A dungeon program by its variant's name. */
export function dungeonProgram(name: VariantName): Program {
  const r = regions(['move'], DUNGEON_WRITES);
  const v: Variant = VARIANTS[name];
  return dungeon(v, { move: r.reads['move']!, writes: r.writes } satisfies Regions);
}
export interface DungeonOptions { saves?: boolean; migrate?: Migration[]; assets?: Buffer[] }
/**
 * The dungeon's piece under one of its programs: one item `dungeon` that reads `move`, with its memory budget and the
 * most fuel a step may have (10,000,000), and `saves: {slots: 1, request}` unless `saves` is false.
 */
export function dungeonPiece(name: VariantName, o: DungeonOptions = {}): JsonObject {
  const v: Variant = VARIANTS[name];
  return piece({
    seed: SEED, controls: ['move'],
    items: {
      [DUNGEON]: {
        program: dungeonProgram(name), reads: ['move'], writes: DUNGEON_WRITES, budget: { memory: v.pages / 16, fuel: 10_000_000 },
        ...(o.saves === false ? {} : { saves: { slots: 1, request: 'request', ...(o.migrate ? { migrate: o.migrate } : {}) } }),
      },
    },
    ...(o.assets ? { assets: o.assets } : {}),
  });
}
/** The dungeon's recorded input: moves of yours at seeded steps (about one in 30, values 0 to 7). */
export function dungeonTrack(steps = 1900): Entry[] {
  const r = seeded(189_11);
  const out: Entry[] = [];
  for (let k = 1; k < steps; k++) if (r() < 1 / 30) out.push(yours('move', k, Math.floor(r() * 8)));
  return out;
}

/** The scribe's piece (criteria 5 and 11), with a same-machine counter beside it: the other module's carried state. */
export const COUNTER = 'counter';
export const ADAPTER = 'adapter-189';
export function scribePiece(): JsonObject {
  const r = regions(['save'], SCRIBE_WRITES);
  return piece({
    seed: 189_05, controls: ['save'],
    items: { [SCRIBE]: { program: scribe({ save: r.reads['save']!, writes: r.writes }), reads: ['save'], writes: SCRIBE_WRITES, budget: { memory: SCRIBE_PAGES / 16 }, saves: { slots: 1, request: 'request' } } },
    others: { [COUNTER]: { kind: 'same_machine.counter@1', params: {} } },
  });
}
/** A `save` entry at step k: the scribe asks for slot 1 at that step's end. */
export const saveAt = (k: number): Entry => yours('save', k, 1);

/** The roguelike's piece (criterion 6): slot 1, `request` and `ends`, a checkpoint every 300 steps. */
export function roguePiece(): JsonObject {
  const r = regions([], ROGUE_WRITES);
  return piece({
    seed: 189_06,
    items: { [ROGUE]: { program: roguelike({ writes: r.writes }), writes: ROGUE_WRITES, budget: { memory: 64 }, checkpoint: { every: 300 }, saves: { slots: 1, request: 'request', ends: 'ends' } } },
  });
}
