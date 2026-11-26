// The #231 acceptance tests' judges: pure functions over what an export answered and what the suite measured from
// outside, each returning its failures as sentences that name what the criterion says a failure names (the frame,
// `wall`, prepare, the city and the guard, the readback count). Nothing here starts a process or reads a file, so a
// plain `node` script can run every judge; `proveJudges` shows each one failing a planted set and passing its clean
// twin, and helpers.ts runs it before any binary is asked for. README: Criteria to tests.

export type Purpose = 'draft' | 'delivery';
export type Fixture = 'explainer' | 'orbit' | 'city';

/** The export's work counters (README: the reply's `work`). */
export interface Work {
  draws: number; hashes: number; fidelity: { draws: number; hashes: number };
  frames_read_back: number; digests_read_back: number; digest_bytes_read_back: number;
}
/** The receipt's `timing`, in seconds. */
export interface Timing { prepare: number; evaluate: number; draw: number; hash: number; convert: number; handoff: number; encode: number; guards: number; wall: number }
export const PHASES = ['prepare', 'evaluate', 'draw', 'hash', 'convert', 'handoff', 'encode', 'guards'] as const;
/** What the compile thread and the decode worker report of an export's preparing (README: the reply's `reports`). */
export interface Reports { compiles: { pipeline: string; seconds: number }[]; decodes: { asset: string; seconds: number }[] }

const s = (x: number): string => `${x.toFixed(3)} s`;
const n = (x: number): string => x.toLocaleString('en-US');

// ---------------------------------------------------------------------------------------------------
// Counts (criteria 1, 6 and 10): they hold on any machine.

export interface Counted { frames: number; hashes: string[]; reused: number; work: Work }
/**
 * An export of `frames` frames that draws `draws` of them: one hash a frame in the receipt, each drawn frame hashed
 * once, every other frame reused, and in a delivery each distinct frame drawn and hashed once more for
 * export.fidelity's reference (none of either in a draft).
 */
export function countFailures(what: string, got: Counted, want: { frames: number; draws: number; purpose: Purpose }): string[] {
  const f: string[] = [];
  if (got.frames !== want.frames) f.push(`${what}: the receipt counts ${n(got.frames)} frames, not ${n(want.frames)}`);
  if (got.hashes.length !== want.frames) f.push(`${what}: the receipt holds ${n(got.hashes.length)} frame hashes, not one for each of the ${n(want.frames)} frames`);
  if (got.work.draws !== want.draws) f.push(`${what}: work.draws is ${n(got.work.draws)}, not ${n(want.draws)}`);
  if (got.work.hashes !== want.draws) f.push(`${what}: work.hashes is ${n(got.work.hashes)}, not ${n(want.draws)}: a frame is hashed once when it is drawn and never again`);
  if (got.reused !== want.frames - want.draws) f.push(`${what}: reused_frames is ${n(got.reused)}, not ${n(want.frames - want.draws)}: each of the ${n(want.frames)} frames is drawn or reused`);
  const again = want.purpose === 'delivery' ? want.draws : 0;
  if (got.work.fidelity.draws !== again) f.push(`${what}: work.fidelity.draws is ${n(got.work.fidelity.draws)}, not ${n(again)}: ${want.purpose === 'delivery' ? 'a delivery draws each distinct frame once more for export.fidelity' : 'a draft runs no delivery decode'}`);
  if (got.work.fidelity.hashes !== again) f.push(`${what}: work.fidelity.hashes is ${n(got.work.fidelity.hashes)}, not ${n(again)}`);
  return f;
}

const flat = (w: Work): [string, number][] => [
  ['draws', w.draws], ['hashes', w.hashes], ['fidelity.draws', w.fidelity.draws], ['fidelity.hashes', w.fidelity.hashes],
  ['frames_read_back', w.frames_read_back], ['digests_read_back', w.digests_read_back], ['digest_bytes_read_back', w.digest_bytes_read_back],
];
/** Two exports cost the same work, counter for counter (criterion 1: a 30 s hold costs what a 1 s hold does). */
export function sameWorkFailures(whatA: string, a: Work, whatB: string, b: Work): string[] {
  const other = new Map(flat(b));
  return flat(a).filter(([k, v]) => other.get(k) !== v).map(([k, v]) => `work.${k} is ${n(v)} for ${whatA} and ${n(other.get(k) ?? NaN)} for ${whatB}`);
}

/** Frames handed over as GPU surfaces: no frame read back, and one 32-byte digest read back for each frame hashed. */
export function readbackFailures(what: string, w: Work, frames: number): string[] {
  const f: string[] = [];
  if (w.frames_read_back !== 0) f.push(`${what}: work.frames_read_back is ${n(w.frames_read_back)}, not 0: a frame handed over as a GPU surface is never read back`);
  if (w.digests_read_back !== frames) f.push(`${what}: work.digests_read_back is ${n(w.digests_read_back)}, not ${n(frames)}, one for each frame hashed`);
  if (w.digest_bytes_read_back !== 32 * frames) f.push(`${what}: work.digest_bytes_read_back is ${n(w.digest_bytes_read_back)}, not ${n(32 * frames)}, 32 bytes a digest`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// Frames (criteria 2, 6 and 8): an export's frame against a seek render at its time, by the hash of its pixels.

/** How many frames carry their predecessor's hash: the frames of a hold after its first. */
export const repeats = (hashes: readonly string[]): number => hashes.reduce((c, h, k) => c + (k > 0 && h === hashes[k - 1] ? 1 : 0), 0);

/** Each sampled frame's export hash against its seek render's, in frame order: the first failure names the first
 * frame that differs. */
export function seekFailures(what: string, exported: readonly string[], seeks: readonly { frame: number; hash: string }[]): string[] {
  const f: string[] = [];
  if (seeks.length === 0) f.push(`${what}: no seek render to compare with`);
  for (const { frame, hash } of [...seeks].sort((a, b) => a.frame - b.frame)) {
    const got = exported[frame];
    if (got === undefined) f.push(`${what}: frame ${frame} isn't in the export's ${n(exported.length)} frame hashes`);
    else if (got !== hash) f.push(`${what}: frame ${frame}: the export's hash ${got.slice(0, 16)}… isn't its seek render's ${hash.slice(0, 16)}…`);
  }
  return f;
}

/** A seeded generator in [0, 1) (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** `count` frames of `frames`, in order: the `fixed` ones, then seeded draws (seed 231) until there are `count`. */
export function sampleFrames(frames: number, count: number, fixed: readonly number[]): number[] {
  const out = new Set(fixed);
  const next = seeded(231);
  while (out.size < count) out.add(Math.floor(next() * frames));
  return [...out].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------
// Times (criteria 3 and 5).

/** No phase's busy time is above `wall` (a relation inside one receipt: any machine). */
export function phaseFailures(what: string, t: Timing): string[] {
  return PHASES.filter((p) => t[p] > t.wall).map((p) => `${what}: timing.${p} reads ${s(t[p])}, above the receipt's wall of ${s(t.wall)}`);
}
/** `wall` within 5% of the time from the command to the file, measured outside the export. */
export function wallFailures(what: string, wall: number, measured: number): string[] {
  if (Math.abs(wall - measured) <= 0.05 * measured) return [];
  return [`${what}: the receipt's \`wall\` reads ${s(wall)}, ${wall > measured ? 'above' : 'below'} the ${s(measured)} measured from the command to the file by more than 5%`];
}

export const reported = (r: Reports): number => [...r.compiles, ...r.decodes].reduce((sum, x) => sum + x.seconds, 0);
/** A cold start: `start` reads cold, something was compiled or decoded, and prepare holds all of it within 5%. */
export function coldFailures(what: string, start: string, t: Timing, r: Reports): string[] {
  const f: string[] = [];
  if (start !== 'cold') f.push(`${what}: start reads ${JSON.stringify(start)}, not "cold"`);
  const total = reported(r);
  if (r.compiles.length + r.decodes.length === 0 || !(total > 0)) f.push(`${what}: the compile thread and the decode worker report no pipeline compile and no asset decode for a cold start, so its prepare has nothing to hold`);
  else if (Math.abs(t.prepare - total) > 0.05 * total) f.push(`${what}: timing.prepare reads ${s(t.prepare)}, not within 5% of the ${s(total)} the compile thread (${r.compiles.length} compiles) and the decode worker (${r.decodes.length} decodes) report`);
  return f;
}
/** A warm start: `start` reads warm with nothing under prepare, and nothing compiled or decoded. */
export function warmFailures(what: string, start: string, t: Timing, r: Reports): string[] {
  const f: string[] = [];
  if (start !== 'warm') f.push(`${what}: start reads ${JSON.stringify(start)}, not "warm"`);
  if (t.prepare !== 0) f.push(`${what}: timing.prepare reads ${s(t.prepare)} on a warm start, not 0`);
  if (r.compiles.length + r.decodes.length !== 0) f.push(`${what}: a warm start compiled or decoded (${r.compiles.length} compiles, ${r.decodes.length} decodes), so it isn't warm`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// Speeds (criteria 5, 7 and 9): each fixture on its own, the mean of 3 cold runs, from the command to the file.

/** Each fixture's length and its limits in seconds: a draft at 4x real time, a delivery at 2x. */
export const SPEED: Record<Fixture, { seconds: number; draft: number; delivery: number }> = {
  explainer: { seconds: 36, draft: 9, delivery: 18 },
  orbit: { seconds: 10, draft: 2.5, delivery: 5 },
  city: { seconds: 60, draft: 15, delivery: 30 },
};
export const FIXTURES: readonly Fixture[] = ['explainer', 'orbit', 'city'];
/** One run timed from outside: its seconds from the command to the file, its receipt's `start`, and its phases. */
export interface Run { seconds: number; start: string; timing?: Timing }
export const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * One fixture, one purpose: exactly three runs, each cold (a warm run is never averaged in), their mean within the
 * fixture's own limit. A miss names the fixture and each phase whose mean busy time alone is over the limit.
 */
export function speedFailures(fixture: Fixture, purpose: Purpose, runs: readonly Run[]): string[] {
  const what = `the ${fixture}'s ${purpose}`;
  const f: string[] = [];
  if (runs.length !== 3) return [`${what}: ${runs.length} runs, not the 3 cold runs its speed is the mean of`];
  runs.forEach((r, i) => { if (r.start !== 'cold') f.push(`${what}: run ${i + 1} reads start ${JSON.stringify(r.start)}: a warm run is never averaged in`); });
  if (f.length) return f;
  const limit = SPEED[fixture][purpose];
  const m = mean(runs.map((r) => r.seconds));
  if (m <= limit) return [];
  const timed = runs.flatMap((r) => (r.timing ? [r.timing] : []));
  const over = timed.length === runs.length ? PHASES.filter((p) => mean(timed.map((t) => t[p])) > limit).map((p) => `${p} alone took ${s(mean(timed.map((t) => t[p])))}`) : [];
  return [`${what}: ${s(m)} as the mean of 3 cold runs (${runs.map((r) => s(r.seconds)).join(', ')}), over its ${limit} s${over.length ? `; ${over.join(', ')}` : ''}`];
}

export type Readings = Record<Fixture, Record<Purpose, readonly Run[]>>;
/** Every fixture on its own, as a draft and as a delivery. */
export function setFailures(readings: Readings): string[] {
  return FIXTURES.flatMap((x) => (['draft', 'delivery'] as const).flatMap((p) => speedFailures(x, p, readings[x][p])));
}
/**
 * The planted judge of criterion 9, `judge_times_set_as_whole`: it adds the three fixtures' means and holds the sum
 * to the sum of their limits, so a slow city hides behind a fast explainer and orbit.
 */
export function setAsWholeFailures(readings: Readings): string[] {
  return (['draft', 'delivery'] as const).flatMap((p) => {
    const total = FIXTURES.reduce((sum, x) => sum + mean(readings[x][p].map((r) => r.seconds)), 0);
    const limit = FIXTURES.reduce((sum, x) => sum + SPEED[x][p], 0);
    return total <= limit ? [] : [`the set's ${p}: ${s(total)} against the set's ${limit} s`];
  });
}
/** Three cold runs of one length each: the criterion's stated readings, as a judge takes them. */
export const cold3 = (seconds: number): Run[] => [1, 2, 3].map(() => ({ seconds, start: 'cold' }));
/** Criterion 9's own numbers: a 34 s city delivery beside a 14 s explainer and a 4 s orbit; each draft at its limit. */
export const CRITERION_9: Readings = {
  explainer: { draft: cold3(9), delivery: cold3(14) },
  orbit: { draft: cold3(2.5), delivery: cold3(4) },
  city: { draft: cold3(15), delivery: cold3(34) },
};

// ---------------------------------------------------------------------------------------------------
// Each judge shown failing a planted set and passing its clean twin, before it judges anything.

export function proveJudges(): void {
  const must = (ok: boolean, what: string): void => { if (!ok) throw Error(`the #231 suite's own judge is wrong: ${what}`); };
  const names = (f: string[], re: RegExp): boolean => f.length > 0 && f.some((x) => re.test(x));
  const work = (o: Partial<Work> = {}): Work => ({ draws: 1, hashes: 1, fidelity: { draws: 1, hashes: 1 }, frames_read_back: 0, digests_read_back: 2, digest_bytes_read_back: 64, ...o });
  const held = (frames: number): string[] => Array.from({ length: frames }, () => 'a'.repeat(64));
  // Counts: a 1,800-frame hold drawn once, against one drawn every frame (the merge base's shape).
  const hold = { frames: 1800, hashes: held(1800), reused: 1799, work: work() };
  must(countFailures('hold', hold, { frames: 1800, draws: 1, purpose: 'delivery' }).length === 0, 'countFailures fails a hold drawn once');
  must(names(countFailures('hold', { ...hold, reused: 0, work: work({ draws: 1800, hashes: 1800 }) }, { frames: 1800, draws: 1, purpose: 'delivery' }), /work\.draws is 1,800, not 1/), 'countFailures passes a hold drawn 1,800 times');
  must(names(countFailures('hold', { ...hold, work: work({ fidelity: { draws: 0, hashes: 0 } }) }, { frames: 1800, draws: 1, purpose: 'delivery' }), /fidelity\.draws/), 'countFailures passes a delivery with no fidelity redraw');
  must(names(countFailures('grain', hold, { frames: 1800, draws: 720, purpose: 'draft' }), /work\.draws is 1, not 720/), 'countFailures passes frozen grain');
  must(sameWorkFailures('30 s', work(), '1 s', work()).length === 0 && names(sameWorkFailures('30 s', work({ hashes: 30 }), '1 s', work()), /work\.hashes is 30 .* and 1 /), 'sameWorkFailures');
  // Readbacks: 3,600 frames by GPU surface, against each frame read back and hashed on the CPU.
  must(readbackFailures('city', work({ digests_read_back: 3600, digest_bytes_read_back: 115_200 }), 3600).length === 0, 'readbackFailures fails 3,600 digests of 32 bytes');
  must(names(readbackFailures('city', work({ frames_read_back: 3600, digests_read_back: 0, digest_bytes_read_back: 0 }), 3600), /frames_read_back is 3,600, not 0/), 'readbackFailures passes 3,600 frames read back');
  // Frames: a reuse across a change at frame 40 keeps frame 39's hash there.
  const a = 'a'.repeat(64); const b = 'b'.repeat(64);
  const right = Array.from({ length: 120 }, (_, k) => (k < 40 ? a : b));
  const seeks = [0, 39, 40, 41, 119].map((frame) => ({ frame, hash: right[frame]! }));
  must(seekFailures('film', right, seeks).length === 0, 'seekFailures fails equal frames');
  must(/frame 40:/.test(seekFailures('film', held(120), seeks)[0] ?? ''), 'seekFailures does not name frame 40 first');
  must(seekFailures('film', right, []).length === 1, 'seekFailures passes with nothing compared');
  must(repeats(right) === 118 && repeats(held(3)) === 2 && repeats([a, b, a]) === 0, 'repeats');
  must(sampleFrames(1800, 10, [0, 2, 3, 1799]).length === 10 && sampleFrames(1800, 10, [0, 2, 3, 1799]).join() === sampleFrames(1800, 10, [0, 2, 3, 1799]).join(), 'sampleFrames');
  // Times: phases that overlap, a wall that is their sum, compiles booked under draw, a warm run averaged in.
  const t: Timing = { prepare: 1, evaluate: 4, draw: 9, hash: 3, convert: 1, handoff: 0.2, encode: 11, guards: 2, wall: 14 };
  const sum = PHASES.reduce((x, p) => x + t[p], 0);
  must(phaseFailures('city', t).length === 0 && names(phaseFailures('city', { ...t, encode: 15 }), /timing\.encode/), 'phaseFailures');
  must(wallFailures('city', 14, 14.5).length === 0 && names(wallFailures('city', sum, 14.5), /`wall` reads 31\.200 s, above/), 'wallFailures passes a wall taken as the sum of the phases');
  const r: Reports = { compiles: [{ pipeline: 'p', seconds: 0.7 }], decodes: [{ asset: 'x', seconds: 0.3 }] };
  must(coldFailures('orbit', 'cold', t, r).length === 0, 'coldFailures fails a prepare that holds its compiles and decodes');
  must(names(coldFailures('orbit', 'cold', { ...t, prepare: 0.3, draw: 9.7 }, r), /timing\.prepare/), 'coldFailures passes compiles booked under draw');
  must(names(coldFailures('orbit', 'cold', t, { compiles: [], decodes: [] }), /report no pipeline compile/), 'coldFailures passes a cold start that reports nothing');
  must(warmFailures('orbit', 'warm', { ...t, prepare: 0 }, { compiles: [], decodes: [] }).length === 0 && names(warmFailures('orbit', 'cold', t, r), /timing\.prepare/), 'warmFailures');
  must(names(speedFailures('city', 'draft', [{ seconds: 14, start: 'cold' }, { seconds: 14, start: 'cold' }, { seconds: 3, start: 'warm' }]), /run 3 reads start "warm": a warm run is never averaged in/), 'speedFailures averages a warm run in');
  must(speedFailures('city', 'draft', cold3(15)).length === 0 && speedFailures('city', 'draft', cold3(15).slice(1)).length === 1, 'speedFailures');
  // A guard that waits 8.4 ms a frame: 3,600 frames, 30.24 s of guards alone.
  const waited = cold3(31).map((x) => ({ ...x, timing: { ...t, guards: 30.24, wall: 31 } }));
  must(names(speedFailures('city', 'delivery', waited), /the city's delivery: .*guards alone took 30\.240 s/), 'speedFailures does not name the city and the guards');
  // Criterion 9's numbers: 52 s against the set's 53 s.
  must(setAsWholeFailures(CRITERION_9).length === 0, 'the planted judge no longer passes 34 s, 14 s and 4 s as a set');
  const own = setFailures(CRITERION_9);
  must(own.length === 1 && /the city's delivery: 34\.000 s/.test(own[0]!), 'setFailures does not fail the city alone');
}
