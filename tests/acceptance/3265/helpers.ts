// Test-side tools for the #3265 acceptance tests (README: The surface), over #556's: its pool of `deep-drive` replicas,
// its hub (an extension host with the playtest plug-in installed and loaded), `runCheck` and the plug-in's kit. What is
// new here: this suite's own count of the floors a run generates, from its own plays of each run's seed, and the readers
// of what a `grid.same` message names. Every play, floor, count and message judged is the implementation's own; nothing
// stands in for the replica, the host or the plug-in.
import { expect } from 'vitest';
import {
  DOC, Pool, failuresOf, lockPlay, macOnly, openHub, ownPlay, putPiece, runSeed, scalar, sha256, shown, valuesOf, word,
  type Hub, type Obj, type Result,
} from '../556/helpers.ts';
import { CELLS, DEPTH, RUNS, SPAN, generator, genPlay, piece, type Twin } from './programs.ts';

export { TIMEOUT, failuresOf, ranNoStep, reachOf, reachSpec, runCheck, word, type Hub, type Obj, type Pool, type Result } from '../556/helpers.ts';

/** Each criterion's tag (scripts/proof-change.mjs: `#3265.` and the first 8 hex of SHA-256 of its text, white space collapsed). */
export const AC = { 1: '#3265.757907b5', 2: '#3265.e9560b44', 3: '#3265.5fc6d08d', 4: '#3265.db483311' } as const;
/** The share of a depth's floors that must be distinct, as every criterion gives it. */
export const DIFFER = 0.9;

/** The hub's documents #556's helper grants the plug-in, one a generator. */
const AT: Record<Twin, string> = { clean: DOC.crawler, blind: DOC.walled, lowbit: DOC.vault, stairs: DOC.noturn, mixed: DOC.flow };
export interface Bench { pool: Pool; hub: Hub; play: Obj }
let opened: Promise<Bench> | undefined;
/** Two debug replicas, a hub over them and the generators' interface as locked, once a file. Off macOS: INCONCLUSIVE. */
export function bench(): Promise<Bench> {
  macOnly();
  return (opened ??= (async () => {
    const pool = await Pool.open(2);
    return { pool, hub: await openHub(pool), play: await lockPlay(genPlay()) };
  })());
}
/** A generator kept in the hub; its `<doc>@<rev>`. */
export const keep = (v: Twin): string => putPiece(AT[v], piece(generator(v)));

// ---------------------------------------------------------------------------------------------------
// This suite's own count, the oracle for `distinct`.

/** Run i's floors, from this suite's own play of its seed: the depth and grid (by this suite's own hash) at step 0 and at each step the depth changes. */
export async function floorsOf(pool: Pool, at: string, seed: number, i: number): Promise<{ depth: number; grid: string }[]> {
  const a = await ownPlay(pool, at, { seed: runSeed(seed, i), piece_seed: 'run', span: { steps: SPAN }, values: [CELLS, DEPTH], frames: [] });
  const depth = valuesOf(a, DEPTH).map(scalar);
  const cells = valuesOf(a, CELLS) as number[][];
  expect([depth.length, cells.length], 'the play answers the depth and the grid at every step').toEqual([SPAN, SPAN]);
  return depth.flatMap((d, k) => (k === 0 || d !== depth[k - 1] ? [{ depth: d, grid: sha256(JSON.stringify(cells[k])) }] : []));
}
/** At each depth, the runs that generated it and the distinct grids among their floors, over the check seed's 20 runs. */
export async function counted(pool: Pool, at: string, seed: number): Promise<Record<string, { runs: number; floors: number }>> {
  const runs = await Promise.all(Array.from({ length: RUNS }, (_, i) => floorsOf(pool, at, seed, i)));
  const depths = [...new Set(runs.flat().map((f) => String(f.depth)))].sort();
  return Object.fromEntries(depths.map((d) => [d, {
    runs: runs.filter((fs) => fs.some((f) => String(f.depth) === d)).length,
    floors: new Set(runs.flat().filter((f) => String(f.depth) === d).map((f) => f.grid)).size,
  }]));
}

// ---------------------------------------------------------------------------------------------------
// What a result says.

/** A result as a message shows it: its outcome, runs and failures, and grid.reach's own counts. */
export const told = (r: Result): string => `${shown(r)}; coverage ${JSON.stringify(r.reach?.coverage)}, distinct ${JSON.stringify(r.reach?.distinct)}`;
/** Whether a message names `n` of a thing: `20 runs`, `1 distinct floor`, `distinct: 1`. */
export const says = (message: string, n: number, thing: string): boolean =>
  new RegExp(`(?:^|[^0-9.])${n} (?:[a-z]+ )?${thing}\\b|\\b${thing}:? ${n}(?![0-9.])`).test(message);
/** What is wrong with `grid.same` in a result for a depth that must fail it, naming the depth, the runs and the distinct floors; nothing when it's right. */
export function sameWrong(r: Result, depth: number, runs: number, floors: number): string[] {
  const found = failuresOf(r, 'grid.same').filter((f) => word(`depth ${depth}`).test(f.message));
  if (r.outcome !== 'failed') return [`the outcome is ${r.outcome}, not failed: ${told(r)}`];
  if (found.length !== 1) return [`${found.length} failures start grid.same and name depth ${depth}, not 1: ${told(r)}`];
  const m = found[0]!.message;
  return [
    ...(says(m, runs, 'runs?') ? [] : [`it doesn't name its ${runs} runs: ${m}`]),
    ...(says(m, floors, 'floors?') || says(m, floors, 'distinct') ? [] : [`it doesn't name its ${floors} distinct floors: ${m}`]),
  ];
}
