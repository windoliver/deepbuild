// Test-side tools for the #832 acceptance tests (README: The surface). They pack this suite's catalogs with
// `deep-catalog pack` (#194's helpers), run a pool of `deep-drive` replicas as the hub's replica (#184's process, as
// #555's pool does), install the catalog plug-in (packages/checks/catalog) in an extension host and run
// catalog.dominance through `runCheck`, call the plug-in's own `runDominance` with its planted runners, read every run
// and replay the replicas played, and judge the result against those plays. The interval and the pairs a row would
// need are this suite's own exact binomial arithmetic, checked first against the upstream rows the oracle page gives.
// Nothing stands in for the replica, the probe, the host or the plug-in; every play, track, hash, share and verdict
// read here is theirs. Processes are #184's helpers' children, stopped by PID; folders are deleted after each file.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect } from 'vitest';
import { Replica, REPO, blocked, canon, driveBin, runSeed, sha256, show, tempDir, word, type Obj } from '../184/helpers.ts';
import { packAll, packCall, scratch } from '../194/helpers.ts';
import type { Tables } from '../194/fixtures.ts';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';
import { GOAL, PATH, SCHEMA, SEED, TABLE } from './duel.ts';

export { canon, macOnly, runSeed, word } from '../184/helpers.ts';

/** Each criterion's tag (the trace lane's criterionId: `#832.` and the first 8 hex of SHA-256 of its text, white space collapsed). */
export const AC = { 1: '#832.d6fbcd45', 2: '#832.c07dc2c3', 3: '#832.d550c82e' } as const;

/** Every test passes this timeout: a cold build of the replica takes many minutes on a loaded machine. */
export const TIMEOUT = 5_400_000;
/** The deadline a check run gets in `runCheck`. */
const DEADLINE = 3_600_000;
const KIND = 'catalog.dominance';
/** The design's default `pairs`, and the most a row's `needs` may name. */
export const PAIRS = 200;
const MOST = 65_535;

// ---------------------------------------------------------------------------------------------------
// Catalogs: packed by `deep-catalog pack`, and a row's copy with its offers off (As built (#832): the catalog's bytes with
// that row's `offers` cell set to 0, every other byte as it was).

export interface Catalog { sha256: string; bytes: Buffer; record: Obj; ids: string[] }
/** Each of `tables` packed under this suite's schema, in one `deep-catalog pack` process. */
export function packCards(tables: Tables[], what: string): Catalog[] {
  const dir = scratch('cards');
  return packAll(tables.map((t) => packCall(dir, t, SCHEMA)), what).map((p) => {
    const t = (p.record['tables'] as Obj[]).find((x) => x['name'] === TABLE);
    expect(t, `${what}: the record holds the table ${TABLE}`).toBeDefined();
    return { sha256: p.sha256, bytes: p.bytes, record: p.record, ids: t!['ids'] as string[] };
  });
}
export interface Copy { id: string; row: number; bytes: Buffer; sha256: string }
/** The catalog without row `id`: its bytes with that row's i32 `offers` cell (the record's column `at`, row by its index in `ids`) set to 0. */
function offCopy(c: Catalog, id: string): Copy {
  const t = (c.record['tables'] as Obj[]).find((x) => x['name'] === TABLE)!;
  const col = (t['columns'] as Obj[]).find((x) => x['name'] === 'offers');
  expect(col?.['type'], 'the record\'s cards.offers is an i32 column').toBe('i32');
  const row = c.ids.indexOf(id);
  expect(row, `the record's ids hold ${id}`).toBeGreaterThanOrEqual(0);
  const bytes = Buffer.from(c.bytes);
  bytes.writeInt32LE(0, Number(col!['at']) + 4 * row);
  return { id, row, bytes, sha256: sha256(bytes) };
}
/** A row's ID as the duel publishes it: the i32 its ID column holds, the u32 FNV-1a hash's bits. */
const idHash = (c: Catalog, id: string): number => {
  const t = (c.record['tables'] as Obj[]).find((x) => x['name'] === TABLE)!;
  const col = (t['columns'] as Obj[]).find((x) => x['id'] === true)!;
  return c.bytes.readInt32LE(Number(col['at']) + 4 * c.ids.indexOf(id));
};

// ---------------------------------------------------------------------------------------------------
// The hub's pieces and a pool of replicas.

const ulid = (n: number): string => `01JB832P${String(n).padStart(18, '0')}`;
export const DOC = { planted: ulid(1), normal: ulid(2), edge: ulid(3) } as const;
const PIECES = new Map<string, Obj>();
/** Keeps `piece` as revision 1 of `doc`; its `<doc>@<rev>`. */
export function putPiece(doc: string, piece: Obj): string {
  PIECES.set(`${doc}@1`, piece);
  return `${doc}@1`;
}

/** The arrays a logged reply keeps: what a pair's agreement and its goal are read from. */
const KEPT = new Set<string>([PATH.offered, PATH.taken, PATH.won]);
const cut = (o: unknown): unknown => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o as Obj).filter(([p]) => KEPT.has(p))) : o);
/** One play as a replica got it and answered it: the piece's `<doc>@<rev>`, the call's fields (its piece and assets left out) and the reply. */
export interface Played { n: number; piece: string; call: Obj; reply: Obj }
/** Replica processes (#184's `deep-drive`, debug, with env-plants), each playing one call at a time; every play is logged. */
export class Pool {
  readonly log: Played[] = [];
  private readonly free: number[];
  private readonly queue: ((i: number) => void)[] = [];
  private constructor(readonly replicas: Replica[]) { this.free = replicas.map((_, i) => i); }
  static async open(n: number): Promise<Pool> {
    const bin = driveBin('debug');
    return new Pool(await Promise.all(Array.from({ length: n }, () => Replica.start(bin))));
  }
  private take(): Promise<number> {
    const i = this.free.shift();
    return i !== undefined ? Promise.resolve(i) : new Promise((done) => this.queue.push(done));
  }
  private give(i: number): void {
    const next = this.queue.shift();
    if (next) next(i);
    else this.free.push(i);
  }
  /** The hub's replica (README: The surface): a play call naming its piece by `<doc>@<rev>`, played on a free replica. */
  readonly hub = async (c: Obj): Promise<Obj> => {
    const { call: _call, piece, ...run } = c;
    const body = PIECES.get(String(piece));
    if (!body) return { ok: false, error: { code: 'refused', message: `no piece ${String(piece)} in this test's hub` } };
    const i = await this.take();
    try {
      const reply = await this.replicas[i]!.call({ call: 'play', ...run, piece: body });
      const { assets: _assets, ...call } = run;
      this.log.push({ n: this.log.length, piece: String(piece), call, reply: { ...reply, values: cut(reply['values']), changes: cut(reply['changes']) } });
      return reply;
    } finally {
      this.give(i);
    }
  };
  /** A play as `deep.canvas.play` gives it to a check runner, for `runDominance` called outside the host: the reply, or an Error when it isn't ok. */
  readonly play = async (piece: string, run: Obj): Promise<Obj> => {
    const reply = await this.hub({ ...run, piece });
    if (reply['ok'] !== true) throw Error(`deep.canvas.play: ${show(reply['error'] ?? reply, 600)}`);
    return reply;
  };
}

// ---------------------------------------------------------------------------------------------------
// The hub: an extension host with the catalog plug-in (packages/checks/catalog), loaded under a grant of every DOC.

const CATALOG_DIR = join(REPO, 'packages', 'checks', 'catalog');
const CATALOG_ID = 'deepbuild/catalog';
export interface Hub { host: Obj }
const closers: (() => Promise<void>)[] = [];
afterAll(async () => { for (const close of closers.splice(0)) await close().catch(() => undefined); }, 120_000);
/** A fresh extension host whose replica is `pool`'s, with the catalog plug-in installed from its folder under a grant of every DOC, checked and loaded in the hub. */
export async function openHub(pool: Pool): Promise<Hub> {
  const hostEntry = await import('../../../packages/extension-host/src/index.ts');
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openAsks } = await import('../../../packages/asks/src/index.ts');
  const { openSupervisor } = await import('../../../packages/supervisor/src/index.ts');
  expect(existsSync(join(CATALOG_DIR, 'deepbuild.json')), 'the catalog plug-in is a first-party package at packages/checks/catalog').toBe(true);
  const m = JSON.parse(readFileSync(join(CATALOG_DIR, 'deepbuild.json'), 'utf8')) as Obj;
  expect(m['checks'], `the catalog plug-in's manifest lists catalog.dominance beside its six kinds, so the hub routes it there: ${show(m['checks'])}`).toContain(KIND);
  const dir = tempDir('hub832');
  const home = join(dir, 'deepbuild');
  mkdirSync(home, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await hostEntry.openTrust({ record, now: Date.now });
  const release = [{ id: CATALOG_ID, version: String(m['version']), digest: hostEntry.packageDigest(CATALOG_DIR) }];
  const host = await hostEntry.openExtensionHost({
    record, asks, supervisor: sup, trust, home, release, now: Date.now, replica: pool.hub,
  } as unknown as Parameters<typeof hostEntry.openExtensionHost>[0]) as unknown as Obj;
  closers.push(async () => { await host['close']().catch(() => undefined); await sup.close().catch(() => undefined); await record.close().catch(() => undefined); });
  await host['ready']();
  const installed = await host['install']({ from: CATALOG_DIR, builtBy: null, grant: { docs: Object.values(DOC) } });
  const conformance = await host['check'](installed);
  expect(conformance.passed, `${CATALOG_ID} passes conformance: ${show(conformance)}`).toBe(true);
  const load = await host['load'](installed);
  expect(load.status === 'loaded' && load.place, `${CATALOG_ID} loads in the hub: ${show(load)}`).toBe('hub');
  return { host };
}

/** catalog.dominance's spec (As built (#832)): its input in `dominance`, the catalog in `catalogs`, the playtest's input in `play`. */
export function dominanceSpec(input: Obj, catalog: Catalog, play: Obj): Obj {
  return {
    kind: KIND, runner: CATALOG_ID, inputs: [], depth: 'journey', oracle: 'code', contract: null,
    dominance: input, catalogs: { [catalog.sha256]: { bytes: catalog.bytes.toString('base64'), record: catalog.record } }, play,
  };
}
export interface Found { code: string; [key: string]: unknown }
export interface RowReport { row: string; with: number; without: number; difference: number; interval: [number, number]; b: number; c: number; taken: number; verdict: string; needs?: number | string }
export type Result = CheckResult & { catalog?: { kind: string; ms: number; found: Found[] }; dominance?: { goal: string; limit: number; pairs: number; rows: RowReport[] } };
/** A run of the check through the hub, and the plays it made. */
export async function runChecked(hub: Hub, pool: Pool, spec: Obj): Promise<{ result: Result; plays: Played[] }> {
  const from = pool.log.length;
  const result = (await hub.host['runCheck'](KIND, spec, { checkout: tempDir('checkout832'), deadline: DEADLINE })) as Result;
  return { result, plays: pool.log.slice(from) };
}
/** The plug-in's dominance module, by the path the design names (packages/checks/catalog/dominance.ts); a path, so the suite type-checks at the base. */
const dominanceModule = async (): Promise<Obj> => (await import(join(CATALOG_DIR, 'dominance.ts'))) as Obj;
/** The plug-in's `runDominance(input, play, carried, playFn, planted?)` with a planted runner, outside the host (planted runners are never reached from a spec), and the plays it made. */
export async function runPlanted(pool: Pool, spec: Obj, planted: string): Promise<{ result: Result; plays: Played[] }> {
  const m = await dominanceModule();
  expect(typeof m['runDominance'], 'dominance.ts exports runDominance(input, play, carried, playFn, planted?)').toBe('function');
  const from = pool.log.length;
  const result = (await m['runDominance'](spec['dominance'], spec['play'], spec['catalogs'], pool.play, planted)) as Result;
  return { result, plays: pool.log.slice(from) };
}
export const shown = (r: Result): string =>
  `${r.outcome}, testsRun ${r.testsRun}; failures: ${r.failures.map((f) => `[${f.test}] ${f.message}`).join(' | ').slice(0, 2500) || '(none)'}; rows: ${show(r.dominance?.rows ?? null, 1500)}`;

// ---------------------------------------------------------------------------------------------------
// The runs, as the replicas played them.

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const offOf = (p: Played): Obj | null => (isObj(p.call['off']) ? p.call['off'] : null);
const full = (p: Played): boolean => p.reply['ok'] === true && Number(p.reply['steps']) > 0;
/** A path's value at each step of a play: its `values` list, or its `changes` (#556) filled forward over the play's steps. */
function series(reply: Obj, path: string): unknown[] {
  const v = (reply['values'] as Obj | undefined)?.[path];
  if (Array.isArray(v)) return v;
  const ch = (reply['changes'] as Obj | undefined)?.[path];
  if (!Array.isArray(ch)) return [];
  const out: unknown[] = [];
  let at = 0;
  let now: unknown = null;
  for (let k = 0; k < Number(reply['steps']); k++) {
    while (at < ch.length && Number((ch[at] as Obj)['step']) <= k) now = (ch[at++] as Obj)['value'];
    out.push(now);
  }
  return out;
}
const ints = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : [Number(v)]);
/** Whether a play reaches the goal: its value nonzero at some step. */
const reaches = (reply: Obj): boolean => series(reply, PATH.won).some((v) => ints(v).some((x) => x !== 0));

export interface Run { play: Played; replays: Played[] }
export interface Pair { i: number; seed: number; with: Run; without: Run }
export interface RowRead { id: string; hash: number; copy: Copy; pairs: Pair[]; b: number; c: number; with: number; without: number; difference: number; taken: number }
/** A run's replays: plays of its recorded entries at its seed, with no bot and the same `off`; by their key. */
const replayKey = (seed: unknown, off: Obj | null, track: unknown): string => `${String(seed)}|${canon(off)}|${canon(track)}`;
function replayIndex(plays: Played[]): (run: Played) => Played[] {
  const by = new Map<string, Played[]>();
  for (const p of plays) {
    if (p.call['bot'] !== undefined || !Array.isArray(p.call['track'])) continue;
    const key = replayKey(p.call['seed'], offOf(p), p.call['track']);
    by.set(key, [...(by.get(key) ?? []), p]);
  }
  return (run) => by.get(replayKey(run.call['seed'], offOf(run), run.reply['entries'])) ?? [];
}
/**
 * Every row's pairs as the plays show them (As built (#832)): pair i's with-run, a play of the bot at hash(the
 * playtest's seed, i) with no `off`, and its without-run, a play of the bot at that seed with `off` naming the catalog,
 * the table and the row's index; each with its replays. A pair lacking either run is a problem naming it. Each row's
 * b, c, shares, difference and taken count, from the runs' goal and taken values.
 */
export function readRuns(plays: Played[], piece: string, catalog: Catalog, pairs: number): { rows: RowRead[]; problems: string[] } {
  const mine = plays.filter((p) => p.piece === piece && full(p));
  const replaysOf = replayIndex(mine);
  const bySeed = new Map<unknown, Played[]>();
  for (const p of mine) if (p.call['bot'] !== undefined) bySeed.set(p.call['seed'], [...(bySeed.get(p.call['seed']) ?? []), p]);
  const problems: string[] = [];
  const seeds = Array.from({ length: pairs }, (_, i) => runSeed(SEED, i));
  const withs = seeds.map((s, i) => {
    const play = (bySeed.get(s) ?? []).find((p) => offOf(p) === null);
    if (!play) problems.push(`pair ${i}'s with-run (seed ${s}) was never played: no play of the bot at that seed without off`);
    return play;
  });
  const rows = catalog.ids.map((id) => {
    const copy = offCopy(catalog, id);
    const hash = idHash(catalog, id);
    const list: Pair[] = [];
    seeds.forEach((s, i) => {
      const without = (bySeed.get(s) ?? []).find((p) => offOf(p)?.['row'] === copy.row);
      if (!without) { problems.push(`${id}: pair ${i}'s without-run (seed ${s}) was never played: no play of the bot at that seed with off.row ${copy.row}`); return; }
      const off = offOf(without)!;
      if (off['catalog'] !== catalog.sha256 || off['table'] !== TABLE) problems.push(`${id}: pair ${i}'s without-run's off ${show(off)} doesn't name the catalog ${catalog.sha256} and the table ${TABLE}`);
      const played = (without.reply['off'] as Obj | undefined)?.['sha256'];
      if (played !== copy.sha256) problems.push(`${id}: pair ${i}'s without-run played a catalog whose SHA-256 is ${show(played)}, not ${copy.sha256}, the catalog with ${id}'s offers off`);
      if (!withs[i]) return;
      list.push({ i, seed: s, with: { play: withs[i]!, replays: replaysOf(withs[i]!) }, without: { play: without, replays: replaysOf(without) } });
    });
    const n = list.length;
    const b = list.filter((p) => reaches(p.with.play.reply) && !reaches(p.without.play.reply)).length;
    const c = list.filter((p) => !reaches(p.with.play.reply) && reaches(p.without.play.reply)).length;
    const w = list.filter((p) => reaches(p.with.play.reply)).length;
    const wo = list.filter((p) => reaches(p.without.play.reply)).length;
    const taken = list.filter((p) => series(p.with.play.reply, PATH.taken).some((v) => ints(v).includes(hash))).length;
    return { id, hash, copy, pairs: list, b, c, with: w / n, without: wo / n, difference: (b - c) / n, taken };
  });
  return { rows, problems };
}

/**
 * Where a pair breaks the pairing (As built (#832)): the first step before the with-run first offers the row at which
 * their offered, taken or goal values differ; at that step, a slot of offered not holding the row that differs; or a
 * step at which the without-run offers or takes the row. Null when it holds.
 */
export function breaks(p: Pair, hash: number): { step: number; why: string } | null {
  const paths = [PATH.offered, PATH.taken, PATH.won];
  const [a, z] = [p.with.play.reply, p.without.play.reply].map((r) => Object.fromEntries(paths.map((path) => [path, series(r, path)]))) as [Record<string, unknown[]>, Record<string, unknown[]>];
  const F = a[PATH.offered]!.findIndex((v) => ints(v).includes(hash));
  const bad: { step: number; why: string }[] = [];
  const steps = Math.min(a[PATH.offered]!.length, z[PATH.offered]!.length);
  for (let k = 0; k < (F < 0 ? steps : Math.min(F, steps)); k++) {
    const which = paths.find((path) => canon(a[path]![k]) !== canon(z[path]![k]));
    if (which) { bad.push({ step: k, why: `${which} differs` }); break; }
  }
  if (F >= 0 && F < steps) {
    const wa = ints(a[PATH.offered]![F]);
    const wz = ints(z[PATH.offered]![F]);
    if (wa.some((x, s) => x !== hash && x !== wz[s])) bad.push({ step: F, why: 'a slot of offered not holding the row differs where the with-run first offers it' });
  }
  for (const path of [PATH.offered, PATH.taken]) {
    const k = z[path]!.findIndex((v) => ints(v).includes(hash));
    if (k >= 0) bad.push({ step: k, why: `the without-run's ${path} holds the row` });
  }
  return bad.sort((x, y) => x.step - y.step)[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------
// The exact (Clopper–Pearson) interval, this suite's own, for real counts; the interval of a row's difference; the
// verdict it gives against a limit; and the pairs a straddling row would need (As built (#832)).

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  const y = x - 1;
  let a = LANCZOS[0]!;
  const t = y + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i]! / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}
/** The continued fraction of the incomplete beta function (modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 100_000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}
/** The regularized incomplete beta function I_x(a, b). */
function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  return x < (a + 1) / (a + b + 2) ? (front * betacf(a, b, x)) / a : 1 - (front * betacf(b, a, 1 - x)) / b;
}
/** The p quantile of Beta(a, b), by bisection to the last bit. */
function betaInv(p: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200 && hi - lo > 0; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (betaInc(mid, a, b) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
/** The exact two-sided interval of k successes in n trials (real counts allowed): 0 below when k = 0, 1 above when k = n. */
function exact(k: number, n: number, confidence = 0.95): [number, number] {
  const alpha = 1 - confidence;
  return [k <= 0 ? 0 : betaInv(alpha / 2, k, n - k + 1), k >= n ? 1 : betaInv(1 - alpha / 2, k + 1, n - k)];
}
/** The upstream rows the oracle page gives (two-sided, exact), each [k, n, confidence, low, high, relative tolerance]. */
const UPSTREAM: [number, number, number, number, number, number][] = [
  [20, 100, 0.95, 0.1266555521019559, 0.2918426890886281, 1e-12],
  [3, 50, 0.99, 0.006872485, 0.202706269, 1e-6],
  [0, 10, 0.95, 0, 0.3084971, 1e-6],
  [10, 10, 0.95, 0.6915029, 1, 1e-6],
];
let checked = false;
/** This suite's own interval must meet the upstream rows before any expected value is drawn from it; otherwise BLOCKED. */
function ownIntervalHolds(): void {
  if (checked) return;
  for (const [k, n, conf, lo, hi, tol] of UPSTREAM) {
    const [a, b] = exact(k, n, conf);
    const near = (x: number, y: number): boolean => (y === 0 ? x === 0 : Math.abs(x - y) <= tol * Math.abs(y));
    if (!near(a, lo) || !near(b, hi)) blocked(`this suite's own exact interval of ${k} in ${n} at ${conf} is [${a}, ${b}], not the upstream [${lo}, ${hi}]`);
  }
  checked = true;
}
/** The 95% interval of a row's difference: (m/n)(2·lo − 1) to (m/n)(2·hi − 1), m = b + c, [lo, hi] the exact interval of b in m; 0 to 0 when m = 0. */
function differenceInterval(b: number, c: number, n: number): [number, number] {
  ownIntervalHolds();
  const m = b + c;
  if (m === 0) return [0, 0];
  const [lo, hi] = exact(b, m);
  return [(m / n) * (2 * lo - 1), (m / n) * (2 * hi - 1)];
}
export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
/** Wholly above the limit: FAIL; wholly below: PASS; holding it (either end on it counts): INCONCLUSIVE. */
const verdictOf = ([lo, hi]: [number, number], limit: number): Verdict => (lo > limit ? 'FAIL' : hi < limit ? 'PASS' : 'INCONCLUSIVE');
/** How far the interval at `count` pairs lies clear of the limit (b/n and c/n held, b and m scaled): positive when clear. */
function margin(b: number, c: number, n: number, limit: number, count: number): number {
  const [lo, hi] = b + c === 0 ? [0, 0] : (() => {
    const [l, h] = exact((b * count) / n, ((b + c) * count) / n);
    return [((b + c) / n) * (2 * l - 1), ((b + c) / n) * (2 * h - 1)];
  })();
  return Math.max(lo - limit, limit - hi);
}

// ---------------------------------------------------------------------------------------------------
// The judge: a result against the rows read from its own plays.

/** Numbers as the design's arithmetic gives them, within float noise. */
const close = (x: unknown, y: number, tol = 1e-9): boolean => typeof x === 'number' && Math.abs(x - y) <= tol;
/**
 * How near the limit a scaled interval's end may lie and still count either way when the named count is checked: near
 * a count of thousands one more pair moves an end by about 1e-7, so two sound quantile routines may differ by a pair
 * or a few there; 1e-6 lets them, and still refuses any count off by more than that.
 */
const NEEDS_TOL = 1e-6;
/**
 * Every way `r` differs from what its plays and the design give (As built (#832)), given each row's expected verdict:
 * the rows' b, c, shares, difference, taken count and interval; each verdict; a FAIL row's catalog.dominant finding and
 * failure (test `cards.<row>`, its message starting catalog.dominant and naming the row and both shares); an
 * INCONCLUSIVE row's failure (its message starting `INCONCLUSIVE:`) naming the pairs it would need, the least count
 * whose interval lies clear of the limit, or "more than 65535"; the outcome; testsRun counting rows × pairs; the
 * catalog's asset ID among the evidence. An empty list: the result is right.
 */
export function judge(r: Result, read: RowRead[], limit: number, pairs: number, catalog: Catalog, expected: Record<string, Verdict>): string[] {
  const out: string[] = [];
  const d = r.dominance;
  if (!d || !Array.isArray(d.rows)) return [`the result carries no dominance: {goal, limit, pairs, rows}: ${shown(r)}`];
  if (d.goal !== GOAL || d.limit !== limit || d.pairs !== pairs) out.push(`dominance names goal ${show(d.goal)}, limit ${show(d.limit)}, pairs ${show(d.pairs)}, not ${GOAL}, ${limit}, ${pairs}`);
  const found = r.catalog?.found ?? [];
  for (const row of read) {
    const rep = d.rows.find((x) => x.row === row.id);
    if (!rep) { out.push(`${row.id}: no row of dominance.rows names it`); continue; }
    const n = row.pairs.length;
    const want = differenceInterval(row.b, row.c, n);
    const verdict = expected[row.id]!;
    for (const [k, v] of Object.entries({ b: row.b, c: row.c, with: row.with, without: row.without, difference: row.difference, taken: row.taken })) {
      if (!close((rep as unknown as Obj)[k], v)) out.push(`${row.id}: ${k} ${show((rep as unknown as Obj)[k])}, not ${v} (from its ${n} pairs' plays)`);
    }
    if (!Array.isArray(rep.interval) || !close(rep.interval[0], want[0]) || !close(rep.interval[1], want[1])) out.push(`${row.id}: interval ${show(rep.interval)}, not [${want[0]}, ${want[1]}] (b ${row.b}, c ${row.c}, ${n} pairs)`);
    if (rep.verdict !== verdict) out.push(`${row.id} reads ${show(rep.verdict)}, not ${verdict}: its interval [${want[0]}, ${want[1]}] against the limit ${limit}`);
    const test = `${TABLE}.${row.id}`;
    const dominant = found.filter((f) => f.code === 'catalog.dominant' && f['row'] === row.id);
    const failed = r.failures.filter((f) => f.test === test && f.message.startsWith('catalog.dominant'));
    const unsure = r.failures.filter((f) => f.test === test && f.message.startsWith('INCONCLUSIVE:'));
    if (verdict === 'FAIL') {
      const f = dominant[0];
      if (!f) out.push(`${row.id}: no catalog.dominant finding names it`);
      else {
        if (f['table'] !== TABLE || !close(f['with'], row.with) || !close(f['without'], row.without) || !close(f['difference'], row.difference) || f['limit'] !== limit || f['pairs'] !== n) {
          out.push(`${row.id}: its finding ${show(f, 600)} doesn't name table ${TABLE}, with ${row.with}, without ${row.without}, difference ${row.difference}, limit ${limit}, pairs ${n}`);
        }
        if (!Array.isArray(f['interval']) || !close((f['interval'] as number[])[0], want[0]) || !close((f['interval'] as number[])[1], want[1])) out.push(`${row.id}: its finding's interval ${show(f['interval'])}, not [${want[0]}, ${want[1]}]`);
      }
      const m = failed[0]?.message ?? '';
      if (!failed.length) out.push(`${row.id}: no failure ${test} whose message starts catalog.dominant`);
      else for (const w of [row.id, String(row.with), String(row.without)]) if (!word(w).test(m.slice('catalog.dominant'.length))) out.push(`${row.id}: its failure doesn't name ${w}: ${m}`);
    } else if (dominant.length || failed.length) out.push(`${row.id} reads ${verdict}, yet a catalog.dominant finding or failure names it`);
    if (verdict === 'INCONCLUSIVE') {
      const m = unsure[0]?.message ?? '';
      if (!unsure.length) out.push(`${row.id}: no failure ${test} whose message starts INCONCLUSIVE:`);
      const needs = rep.needs;
      if (needs === 'more than 65535') {
        const at = margin(row.b, row.c, n, limit, MOST);
        if (at > NEEDS_TOL) out.push(`${row.id}: needs "more than 65535", yet at ${MOST} pairs its interval lies ${at} clear of the limit`);
      } else if (typeof needs !== 'number' || !Number.isInteger(needs) || needs < 1 || needs > MOST) out.push(`${row.id}: needs ${show(needs)}, neither a count up to ${MOST} nor "more than 65535"`);
      else {
        const at = margin(row.b, row.c, n, limit, needs);
        const before = margin(row.b, row.c, n, limit, needs - 1);
        if (at < -NEEDS_TOL) out.push(`${row.id}: needs ${needs}, yet at ${needs} pairs its interval still holds the limit (${at})`);
        if (before > NEEDS_TOL) out.push(`${row.id}: needs ${needs}, yet ${needs - 1} pairs already lie clear of the limit (${before})`);
      }
      if (unsure.length && !word(String(needs)).test(m.slice('INCONCLUSIVE:'.length))) out.push(`${row.id}: its INCONCLUSIVE failure doesn't name the pairs it would need (${show(needs)}): ${m}`);
    } else if (unsure.length) out.push(`${row.id} reads ${verdict}, yet a failure starting INCONCLUSIVE: names it`);
  }
  const verdicts = Object.values(expected);
  const outcome = verdicts.includes('FAIL') ? 'failed' : verdicts.includes('INCONCLUSIVE') ? 'uncounted' : 'passed';
  if (r.outcome !== outcome) out.push(`the outcome is ${r.outcome}, not ${outcome}`);
  if (r.testsRun !== read.length * pairs) out.push(`testsRun ${r.testsRun}, not ${read.length} rows × ${pairs} pairs`);
  if (!r.evidence.includes(catalog.sha256)) out.push('the catalog\'s asset ID isn\'t among the evidence');
  return out;
}
/** Each row's verdict from its own plays: this suite's interval against the limit. */
export const verdictsOf = (read: RowRead[], limit: number): Record<string, Verdict> =>
  Object.fromEntries(read.map((row) => [row.id, verdictOf(differenceInterval(row.b, row.c, row.pairs.length), limit)]));
export function none(problems: readonly string[], what: string): void {
  expect(problems, `${what}:\n  ${problems.slice(0, 40).join('\n  ')}`).toEqual([]);
}
