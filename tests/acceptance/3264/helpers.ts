import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  DOC, PLAYTEST_DIR, Pool, kitModule, lockPlay, macOnly, openHub, ownPlay, playtestEntry, playtestSpec, putPiece, runCheck, runSeed, scalar, show, shown, valuesOf,
  type CheckResult, type Hub, type Obj,
} from '../556/helpers.ts';
import { firstBelow, orderBreak, type Break } from './judges.ts';
import { PATH, RUNS, SEED, SPAN, crawlerPiece, crawlerPlay, type Twin } from './programs.ts';

export { bench as benchmark, judge, load } from '../184/helpers.ts';
export { inconclusive, lockPlay, playtestSpec, ranNoStep, type Hub, type Obj, type Pool } from '../556/helpers.ts';

export const AC = { 1: '#3264.03648b56', 2: '#3264.4ae0accd', 3: '#3264.b18bc0a2', 4: '#3264.941ee22d', 5: '#3264.aa75cf53', 6: '#3264.bb05cf1b' } as const;
export const LIMIT = 1_800_000;

export type Result = CheckResult & { runs?: Obj[] };
export type Replica = (call: Obj) => Promise<Obj>;
export type Play = (piece: string, run: Obj) => Promise<Obj>;
export type Ask = (name: string, request: Obj) => Promise<{ status: number | null; body: string }>;
export type Check = (spec: Obj) => Promise<Result>;

export const told = (r: CheckResult): string => shown(r);

const DOC_OF: Record<Twin, string> = { clean: DOC.crawler, spikes: DOC.walled, timer: DOC.vault, blip: DOC.noturn };
export const keep = (v: Twin): string => putPiece(DOC_OF[v], crawlerPiece(v));

export const hubOver = (replica: Replica): Promise<Hub> => openHub({ hub: replica } as unknown as Pool);

export interface Stage { pool: Pool; hub: Hub; play: Obj }
let staged: Promise<Stage> | undefined;
export function stage(): Promise<Stage> {
  macOnly();
  return (staged ??= (async () => {
    const pool = await Pool.open(2, { keep: [PATH.hp, PATH.key, PATH.door, PATH.won] });
    return { pool, hub: await hubOver(pool.hub), play: await lockPlay(crawlerPlay()) };
  })());
}

export const runPlaytest = (hub: Hub, input: Obj): Promise<Result> => runCheck(hub, playtestSpec(input));

export interface Reading { test: string; seed: number; entries: Obj[]; hp: number[]; key: number[]; door: number[]; won: number[] }
export async function readRuns(pool: Pool, at: string, play: Obj, o: { bot: Obj; b?: number; runs?: number; span?: number }): Promise<Reading[]> {
  const span = o.span ?? SPAN;
  return Promise.all(Array.from({ length: o.runs ?? RUNS }, async (_, i) => {
    const seed = runSeed(SEED, i);
    const reply = await ownPlay(pool, at, { seed, piece_seed: 'run', span: { steps: span }, bot: o.bot, play, values: [PATH.hp, PATH.key, PATH.door, PATH.won], frames: [] });
    const series = (path: string): number[] => valuesOf(reply, path).map(scalar);
    const read: Reading = { test: `bot ${o.b ?? 0} run ${i}`, seed, entries: reply['entries'] as Obj[], hp: series(PATH.hp), key: series(PATH.key), door: series(PATH.door), won: series(PATH.won) };
    expect([read.hp.length, read.key.length, read.door.length, read.won.length], `this suite's own play of ${read.test} answers each name at every step`).toEqual([span, span, span, span]);
    return read;
  }));
}
export async function replayed(pool: Pool, at: string, run: Reading, span: number = SPAN): Promise<{ hp: number[]; key: number[]; door: number[] }> {
  const reply = await ownPlay(pool, at, { seed: run.seed, piece_seed: 'run', span: { steps: span }, track: run.entries, values: [PATH.hp, PATH.key, PATH.door], frames: [] });
  const series = (path: string): number[] => valuesOf(reply, path).map(scalar);
  return { hp: series(PATH.hp), key: series(PATH.key), door: series(PATH.door) };
}

export const hpBreaks = (runs: readonly Reading[]): Map<string, Break> =>
  new Map(runs.flatMap((r) => {
    const b = firstBelow(r.hp, 0);
    return b ? [[r.test, { step: b.step, values: { hp: b.value } }] as const] : [];
  }));
export function orderBreaks(runs: readonly Reading[]): { breaks: Map<string, number>; together: string[] } {
  const judged = runs.map((r) => [r.test, orderBreak(r.key, r.door)] as const);
  return {
    breaks: new Map(judged.flatMap(([test, b]) => (b !== undefined && b !== 'together' ? [[test, b.step] as const] : []))),
    together: judged.filter(([, b]) => b === 'together').map(([test]) => test),
  };
}

export const replaysNeverBelow = (pool: Pool, path: string, floor: number): Replica => async (call) => {
  const reply = await pool.hub(call);
  if (reply['ok'] !== true || call['bot'] !== undefined || !Array.isArray(call['track'])) return reply;
  const held = (v: unknown): number[] => [Math.max(floor, scalar(v))];
  const values: Obj = { ...(reply['values'] as Obj | undefined) };
  if (Array.isArray(values[path])) values[path] = (values[path] as unknown[]).map(held);
  const changes: Obj = { ...(reply['changes'] as Obj | undefined) };
  if (Array.isArray(changes[path])) changes[path] = (changes[path] as Obj[]).map((c) => ({ ...c, value: held(c['value']) }));
  return { ...reply, values, changes };
};

export interface KitFills { clean: Obj; planted(name: string): Obj }
export async function kitFills(pool: Pool): Promise<KitFills> {
  const m = await kitModule();
  expect(typeof m['playtestKit'], 'the plug-in\'s kit.ts exports playtestKit(replica), check.kind@1\'s kit for kind playtest').toBe('function');
  const kit = m['playtestKit'](() => pool.direct) as Obj;
  const cleans = kit['clean']() as Obj[];
  expect(cleans.length, 'the kit has a reference fill').toBeGreaterThan(0);
  return {
    clean: cleans[0]!,
    planted: (name) => {
      const found = (kit['planted'] as Obj[]).find((p) => p['name'] === name);
      expect(found, `the kit plants a playtest runner named ${name}: ${show((kit['planted'] as Obj[]).map((p) => p['name']))}`).toBeDefined();
      return found!['fill'] as Obj;
    },
  };
}
export const playFill = async (fill: Obj, input: Obj): Promise<Result> => (await fill['play']({ maze: 'maze', play: input, plant: null })) as Result;

export async function entryCheck(o: { play: Play; ask?: Ask }): Promise<Check> {
  const entry = await playtestEntry();
  expect(typeof entry['default'], 'the plug-in\'s index.ts exports its register(deep) by default').toBe('function');
  const kinds = new Map<string, Check>();
  entry['default']({
    registerCheck: (type: string, runner: Check) => { kinds.set(type, runner); },
    canvas: { play: o.play },
    source: { ask: o.ask ?? (async () => ({ status: null, body: '' })) },
  });
  const check = kinds.get('playtest');
  expect(check, `the plug-in registers the kind playtest: ${show([...kinds.keys()])}`).toBeDefined();
  return check!;
}

export const manifestCodes = (): string[] => (JSON.parse(readFileSync(join(PLAYTEST_DIR, 'deepbuild.json'), 'utf8')) as { codes: string[] }).codes;
