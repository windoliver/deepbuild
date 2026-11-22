// The plays a running check's `deep.canvas.play` may make (Check input: plug-in reads, #184): what its input gives,
// the plays it made, and (#832) what a catalog.dominance check's pairs take and what a pass of it must have played.
import { createHash } from 'node:crypto';
import type { CheckResult } from '@deepbuild/conformance';
import { isPlain } from './host-shared.js';

/**
 * What a check's input gives `deep.canvas.play` (Check input: plug-in reads, #184): the piece, the seed, the runs (20
 * by default), the bots and the recorded tracks it may play; a playtest's input holds more, which the host ignores.
 */
export interface PlayInput { piece?: unknown; seed?: unknown; runs?: unknown; bots?: unknown; tracks?: unknown; play?: unknown; off?: { catalog: unknown; table: unknown; rows: number } }
/** One play a running check made: its seed, its bot, its track's hash and whether it read values. */
export interface Played { seed: number; bot: unknown; track: string; values: boolean; off?: number }
/**
 * #832: what a catalog.dominance check's plays may take: the named playtest's input with its pairs' seeds in place of
 * its runs, its first bot alone, and an `off` on the input's catalog and table, a row of those its carried record names.
 */
export function playInput(spec: { play?: unknown; dominance?: unknown; catalogs?: unknown }): PlayInput | undefined {
  if (!isPlain(spec.play)) return undefined;
  const play = spec.play as PlayInput;
  if (!isPlain(spec.dominance)) return play;
  const d = spec.dominance as { catalog?: unknown; table?: unknown; pairs?: unknown };
  const carried = (isPlain(spec.catalogs) ? spec.catalogs : {}) as Record<string, { record?: { tables?: { name?: unknown; ids?: unknown }[] } }>;
  const ids = (typeof d.catalog === 'string' ? carried[d.catalog]?.record?.tables ?? [] : []).find((t) => t?.name === d.table)?.ids;
  return { ...play, runs: typeof d.pairs === 'number' ? d.pairs : 200, bots: Array.isArray(play.bots) ? play.bots.slice(0, 1) : [], off: { catalog: d.catalog, table: d.table, rows: Array.isArray(ids) ? ids.length : 0 } };
}
/** JSON with every object's keys sorted, so two values parsed apart compare. */
export const canonical = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (isPlain(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
/** Run i's seed: hash(the check's seed, i), the first 8 bytes of SHA-256(seed as u64 LE, i as u32 LE) big-endian, shifted right 11 bits to stay a JSON-safe integer. */
export function runSeed(seed: number, i: number): number {
  const b = Buffer.alloc(12);
  b.writeBigUInt64LE(BigInt(seed));
  b.writeUInt32LE(i, 8);
  return Number(createHash('sha256').update(b).digest().readBigUInt64BE(0) >> 11n);
}
/** A bot as a play runs it: without the authorship, bands and expectations a check's input adds (#184, #555). */
export const botOf = (bot: unknown): unknown => (isPlain(bot) ? Object.fromEntries(Object.entries(bot).filter(([k]) => k !== 'by' && k !== 'share' && k !== 'expect')) : bot);
/**
 * #832: what a passed catalog.dominance run lacks: each pair's with-run, at hash(seed, i) with the first bot, and each
 * row's without-run at that seed with the row's offers off, each played with values and its track among the evidence,
 * and testsRun counting rows × pairs.
 */
export function unpaired(played: Played[], input: PlayInput & { seed: number; off: { rows: number } }, pairs: number, result: CheckResult): string[] {
  const bot = Array.isArray(input.bots) && input.bots.length ? canonical(botOf(input.bots[0])) : undefined;
  const lacks: string[] = [];
  for (let i = 0; i < pairs; i++) {
    const seed = runSeed(input.seed, i);
    for (const row of [undefined, ...Array.from({ length: input.off.rows }, (_, r) => r)]) {
      const name = row === undefined ? `pair ${i}'s with-run (seed ${seed})` : `row ${row}'s pair ${i} without-run (seed ${seed})`;
      const p = played.find((x) => x.seed === seed && x.bot === bot && x.off === row);
      if (!p) lacks.push(`${name}: it was never played`);
      else if (!p.values) lacks.push(`${name}'s values: its play read none`);
      else if (!result.evidence.includes(p.track)) lacks.push(`${name}'s track among its evidence`);
    }
  }
  if (result.testsRun !== pairs * input.off.rows) lacks.push(`counting its ${pairs * input.off.rows} pairs: it counted ${result.testsRun}`);
  return lacks;
}
