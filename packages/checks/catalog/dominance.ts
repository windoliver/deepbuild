// catalog.dominance (#832; canvas primitives: Check input: catalog kinds, As built (#832)): for each row of a table,
// pairs of runs of the named playtest's first bot on one seed, the with-run on the catalog as it is and the without-run
// on the catalog with that row's `offers` cell set to 0, which the replica writes and plays in the catalog's place
// (`off`). Each pair is checked before it counts: the two runs agree until the with-run first offers the row, the
// without-run never offers or takes it, it played the copy this plug-in writes, and both runs replay from their tracks;
// a pair that breaks one fails catalog.unpaired. The paired goal outcomes give the difference in share, d = (b − c)/n,
// whose 95% interval comes from the exact binomial interval of the b discordant pairs the row wins among the m = b + c
// that differ: above the limit fails catalog.dominant, below passes, holding it reads INCONCLUSIVE with the pairs it
// would need, never PASS. It imports only node: built-ins and this plug-in's own files.
import { createHash } from 'node:crypto';
import type { Failure } from '@deepbuild/conformance';
import { columnOf, failure, isResult, lacks, opened, refused, type Carried, type CatalogResult, type Found } from './check.ts';
import { fnv1a } from './layout.ts';

const KIND = 'catalog.dominance';
/** Runs played at once: replicas are leased two at a time. */
const AT_ONCE = 2;
/** The most pairs a u16 holds, past which no count of pairs is named. */
const MOST = 65_535;

export interface DominanceInput { playtest: string; catalog: string; table: string; offered: string; taken: string; goal: string; limit: number; pairs?: number; by?: 'agent' }
/** What this kind reads of the named playtest's input (Check input: playtest). */
type Name = string | { name: string };
interface Iface { values?: Record<string, Name>; rewards?: Record<string, Name>; turn?: Name; accepted?: Name; refused?: Name; units?: { hp?: Name; side?: Name; alive?: Name; self?: number }; [k: string]: unknown }
export interface PlayedInput { piece: string; bots: Record<string, unknown>[]; seed: number; span?: number | { steps: number }; piece_seed?: 'own' | 'run'; goals?: { name: string; when: string }[]; play?: Iface; [k: string]: unknown }
/** What `deep.canvas.play` answers, as this kind reads it. */
interface Answer { steps: number; track: string; entries: unknown[]; values: Record<string, unknown[]>; checkpoints: { step: number; hash: string }[]; final: string; off?: { sha256: string } | null }
export type PlayFn = (piece: string, run: Record<string, unknown>) => Promise<Answer>;
export type Planted = 'dominance_straddle_passes' | 'dominance_unpaired_seeds';
export interface RowShown { row: string; with: number; without: number; difference: number; interval: [number, number]; b: number; c: number; taken: number; verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; needs?: number | string }
export type DominanceResult = CatalogResult & { dominance?: { goal: string; limit: number; pairs: number; rows: RowShown[] } };

// ---- the interval

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lnGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  const x = z - 1;
  let s = LANCZOS[0]!;
  for (let i = 1; i < LANCZOS.length; i++) s += LANCZOS[i]! / (x + i);
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(s);
}
/** The regularized incomplete beta's continued fraction, by Lentz's method. */
function fraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m <= 100_000; m++) {
    for (const aa of [(m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m)), (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))]) {
      d = 1 + aa * d;
      d = 1 / (Math.abs(d) < tiny ? tiny : d);
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      h *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-16) break;
  }
  return h;
}
/** I_x(a, b), the regularized incomplete beta function. */
function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  return x < (a + 1) / (a + b + 2) ? (front * fraction(a, b, x)) / a : 1 - (front * fraction(b, a, 1 - x)) / b;
}
/** The x at which I_x(a, b) = p, by bisection to the last bit. */
function betaQuantile(p: number, a: number, b: number): number {
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 1100 && hi - lo > 0; i++) {
    const mid = (lo + hi) / 2;
    if (mid <= lo || mid >= hi) break;
    if (ibeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The exact (Clopper–Pearson) two-sided binomial interval of k successes in n trials; real counts are taken as given. */
export function binomialInterval(k: number, n: number, confidence = 0.95): [number, number] {
  if (!(n > 0 && k >= 0 && k <= n && confidence > 0 && confidence < 1)) throw RangeError(`binomialInterval takes 0 ≤ k ≤ n, n > 0 and a confidence in (0, 1), not k ${k}, n ${n}, ${confidence}`);
  const alpha = 1 - confidence;
  return [k === 0 ? 0 : betaQuantile(alpha / 2, k, n - k + 1), k === n ? 1 : betaQuantile(1 - alpha / 2, k + 1, n - k)];
}

/** The 95% interval of d = (b − c)/n over n pairs: the exact interval of b in m = b + c, as (m/n)(2p − 1); 0 to 0 when none differ. */
export function differenceInterval(b: number, c: number, n: number): [number, number] {
  const m = b + c;
  if (m <= 0) return [0, 0];
  const [lo, hi] = binomialInterval(b, m);
  return [(m / n) * (2 * lo - 1), (m / n) * (2 * hi - 1)];
}
const clear = ([lo, hi]: [number, number], limit: number): boolean => lo > limit || hi < limit;
/** The least count of pairs, up to 65,535, at which the interval with b/n and c/n held lies clear of the limit. */
export function pairsNeeded(b: number, c: number, n: number, limit: number): number | undefined {
  const at = (k: number): boolean => clear(differenceInterval((b * k) / n, (c * k) / n, k), limit);
  if (!at(MOST)) return undefined;
  let [lo, hi] = [n, MOST];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

// ---- the runs

/** Run i's seed: hash(the check's seed, i), as the playtest's run i (the first 8 bytes of SHA-256(seed LE u64, i LE u32), shifted right 11 bits). */
function runSeed(seed: number, i: number): number {
  const b = Buffer.alloc(12);
  b.writeBigUInt64LE(BigInt(seed));
  b.writeUInt32LE(i, 8);
  return Number(createHash('sha256').update(b).digest().readBigUInt64BE(0) >> 11n);
}
const pathOf = (n: Name): string => (typeof n === 'string' ? n : n.name);
/** A name the interface declares, or a logic array path, as the path and row a read takes. */
function where(iface: Iface | undefined, id: string): { path: string; row: number } | undefined {
  const named = iface?.values?.[id] ?? iface?.rewards?.[id] ?? (id === 'turn' || id === 'accepted' || id === 'refused' ? iface?.[id] as Name | undefined : undefined);
  if (named !== undefined) return { path: pathOf(named), row: 0 };
  const unit = id === 'hp' || id === 'side' || id === 'alive' ? iface?.units?.[id] : undefined;
  if (unit !== undefined) return { path: pathOf(unit), row: iface?.units?.self ?? 0 };
  return id.includes('.') ? { path: id, row: 0 } : undefined;
}
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** A number as the finding holds it, as written (#194's rule for messages). */
const fmt = (x: number): string => String(x);
/** The first step at which the run's full-state hash differs from its replay's, or none. */
function differs(a: Answer, b: Answer): number | undefined {
  const theirs = new Map(b.checkpoints.map((c) => [c.step, c.hash]));
  for (const c of a.checkpoints) if (theirs.get(c.step) !== c.hash) return c.step;
  return a.final === b.final && a.checkpoints.length === b.checkpoints.length ? undefined : a.steps;
}

export async function runDominance(input: DominanceInput, play: PlayedInput | undefined, carried: Carried, playFn: PlayFn, planted?: Planted): Promise<DominanceResult> {
  const t0 = performance.now();
  const cat = opened(KIND, input.catalog, carried, t0);
  if (isResult(cat)) return cat;
  const no = (why: string): DominanceResult => refused(KIND, input.catalog, t0, `refused before any run: ${why}`);
  if (!play) return refused(KIND, input.catalog, t0, `BLOCKED: the playtest ${input.playtest} it names is unrun: its spec gives no playtest input in play`, 'missing');
  const table = cat.tables.get(input.table);
  if (!table) return no(lacks(`the table ${input.table}`));
  const offers = columnOf(cat, input.table, 'offers', ['i32', 'bool']);
  if (typeof offers === 'string') return no(offers);
  const n = input.pairs ?? 200;
  if (!Number.isInteger(n) || n < 1 || n > MOST) return no(`pairs is a count from 1 to ${MOST}, not ${n}`);
  if (!Number.isFinite(input.limit)) return no(`limit is a share, not ${input.limit}`);
  const iface = play.play;
  const offered = where(iface, input.offered)?.path;
  const taken = where(iface, input.taken)?.path;
  for (const [field, at] of [['offered', offered], ['taken', taken]] as const) if (!at) return no(`${field} names ${input[field]}, neither a value the play interface declares nor a logic array path`);
  const goal = play.goals?.find((g) => g.name === input.goal);
  if (!goal) return no(`the playtest ${input.playtest} names no goal ${input.goal}`);
  const reach = where(iface, goal.when.trim());
  if (!reach) return no(`the goal ${goal.name}'s when, ${goal.when}, is neither one name the interface declares nor one logic array path`);
  const raw = play.bots[0];
  if (!raw) return no(`the playtest ${input.playtest} names no bot`);
  if ('model' in raw) return no('the playtest\'s first bot is a model bot, whose runs count only through replay');
  const { by: _by, share: _share, expect: _expect, ...bot } = raw;

  // The copy each row's without-run must play: the catalog's bytes with that row's offers cell 0.
  const bytes = Buffer.from(carried![input.catalog]!.bytes, 'base64');
  const record = carried![input.catalog]!.record.tables.find((t) => t.name === input.table)!;
  const at = record.columns.find((c) => c.name === 'offers')!.at;
  const width = offers.type === 'i32' ? 4 : 1;
  const copies = table.ids.map((_, r) => {
    const copy = Buffer.from(bytes);
    copy.fill(0, at + width * r, at + width * (r + 1));
    return createHash('sha256').update(copy).digest('hex');
  });

  const paths = [...new Set([offered!, taken!, reach.path])];
  const common = { span: play.span ?? 120, values: paths, frames: [], ...(play.piece_seed ? { piece_seed: play.piece_seed } : {}), ...(iface ? { play: iface } : {}) };
  const seeds = Array.from({ length: n }, (_, i) => runSeed(play.seed, i));
  const reached = (a: Answer): boolean => (a.values[reach.path] ?? []).some((v) => Number(list(v)[reach.row] ?? 0) !== 0);
  const tracks: string[] = [];
  // A run and its replay without its bot; the replay's first differing step, if any.
  const played = async (run: Record<string, unknown>): Promise<{ a: Answer; replays: number | undefined }> => {
    const a = await playFn(play.piece, { ...common, ...run, bot });
    const again = await playFn(play.piece, { ...common, ...run, values: [], track: a.entries });
    tracks.push(a.track, again.track);
    return { a, replays: differs(a, again) };
  };
  const pool = async <T>(jobs: (() => Promise<T>)[]): Promise<T[]> => {
    const out: T[] = new Array(jobs.length);
    let next = 0;
    await Promise.all(Array.from({ length: AT_ONCE }, async () => {
      for (let j = next++; j < jobs.length; j = next++) out[j] = await jobs[j]!();
    }));
    return out;
  };

  let withRuns: { a: Answer; replays: number | undefined }[];
  try {
    withRuns = await pool(seeds.map((seed) => () => played({ seed })));
  } catch (e) {
    return refused(KIND, input.catalog, t0, `refused: ${String((e as Error)?.message ?? e)}`);
  }
  const findings: { found: Found; test: string; message: string }[] = [];
  const more: Failure[] = [];
  const rows: RowShown[] = [];
  for (const [r, id] of table.ids.entries()) {
    const hash = fnv1a(id);
    const holds = (v: unknown): boolean => list(v).some((x) => Number(x) >>> 0 === hash);
    const name = `${input.table}.${id}`;
    let pairs: { a: Answer; replays: number | undefined }[];
    try {
      pairs = await pool(seeds.map((_, i) => () => played({ seed: seeds[planted === 'dominance_unpaired_seeds' ? (i + 1) % n : i], off: { catalog: input.catalog, table: input.table, row: r } })));
    } catch (e) {
      return refused(KIND, input.catalog, t0, `refused: ${name}'s without-runs: ${String((e as Error)?.message ?? e)}`);
    }
    let [b, c, w, o, took, unpaired] = [0, 0, 0, 0, 0, 0];
    for (const [i, { a: O, replays }] of pairs.entries()) {
      const { a: W, replays: wReplays } = withRuns[i]!;
      const why = ((): [string, string | number] | undefined => {
        if (wReplays !== undefined) return [`its with-run's track, played again without its bot, first differs in the full-state hash at step ${wReplays}`, 'with'];
        if (replays !== undefined) return [`its without-run's track, played again without its bot, first differs in the full-state hash at step ${replays}`, 'without'];
        if (O.off?.sha256 !== copies[r]) return [`its without-run played a catalog that hashes to ${O.off?.sha256 ?? 'nothing'}, not the copy with the row's offers off, ${copies[r]}`, 'without'];
        if (O.steps !== W.steps) return [`its runs played ${W.steps} and ${O.steps} steps`, 'without'];
        const first = (W.values[offered!] ?? []).findIndex(holds);
        for (let k = 0; k < (first < 0 ? W.steps : first); k++) {
          for (const p of paths) if (!same(W.values[p]?.[k], O.values[p]?.[k])) return [`its runs' ${p} differ at step ${k}, before the with-run first offers the row`, k];
        }
        if (first >= 0) {
          const [ws, os] = [list(W.values[offered!]![first]), list(O.values[offered!]?.[first])];
          const slot = ws.findIndex((x, j) => !holds(x) && !same(x, os[j]));
          if (slot >= 0) return [`its runs' ${offered} differ at step ${first} in slot ${slot}, which doesn't hold the row`, first];
        }
        for (let k = 0; k < O.steps; k++) {
          if (holds(O.values[offered!]?.[k])) return [`its without-run offers the row at step ${k}`, k];
          if (holds(O.values[taken!]?.[k])) return [`its without-run takes the row at step ${k}`, k];
        }
        return undefined;
      })();
      if (why) {
        unpaired++;
        const [text, at] = why;
        const place = typeof at === 'number' ? { step: at } : { run: at };
        findings.push({ found: { code: 'catalog.unpaired', table: input.table, row: id, pair: i, seed: seeds[i], ...place, why: text }, test: name, message: `catalog.unpaired: pair ${i} of ${name} (seed ${seeds[i]}): ${text}` });
        continue;
      }
      const [wr, or] = [reached(W), reached(O)];
      if (wr) w++;
      if (or) o++;
      if (wr && !or) b++;
      if (!wr && or) c++;
      if ((W.values[taken!] ?? []).some(holds)) took++;
    }
    const d = (b - c) / n;
    const interval = differenceInterval(b, c, n);
    const shown: RowShown = { row: id, with: w / n, without: o / n, difference: d, interval, b, c, taken: took, verdict: 'PASS' };
    rows.push(shown);
    const shares = `from ${fmt(o / n)} without it to ${fmt(w / n)} with it (${o} and ${w} of ${n} pairs), by ${fmt(d)}, its 95% interval ${fmt(interval[0])} to ${fmt(interval[1])}`;
    if (unpaired) shown.verdict = 'FAIL';
    else if (interval[0] > input.limit) {
      shown.verdict = 'FAIL';
      findings.push({
        found: { code: 'catalog.dominant', table: input.table, row: id, with: w / n, without: o / n, difference: d, interval, limit: input.limit, pairs: n }, test: name,
        message: `catalog.dominant: ${name} raises ${goal.name}'s share ${shares}, clear above the limit ${input.limit}`,
      });
    } else if (!clear(interval, input.limit) && planted !== 'dominance_straddle_passes') {
      const needs = pairsNeeded(b, c, n, input.limit);
      shown.verdict = 'INCONCLUSIVE';
      shown.needs = needs ?? `more than ${MOST}`;
      more.push(failure(name, `INCONCLUSIVE: ${name} moves ${goal.name}'s share ${shares}, which holds the limit ${input.limit}: it would need ${needs ?? `more than ${MOST}`} pairs, past the ${n} played`, false));
    }
  }
  const failures = [...findings.map((f) => failure(f.test, f.message)), ...more];
  return {
    outcome: findings.length ? 'failed' : more.length ? 'uncounted' : 'passed', testsRun: table.ids.length * n, failures, evidence: [input.catalog, ...copies, ...tracks], read: [], mask: null,
    catalog: { kind: KIND, ms: performance.now() - t0, found: findings.map((f) => f.found) }, dominance: { goal: goal.name, limit: input.limit, pairs: n, rows },
  };
}
