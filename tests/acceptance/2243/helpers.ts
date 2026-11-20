// Test-side tools for the #2243 acceptance tests (README: The surface under test). They drive the physics runner
// `deep-physics` (JSON lines in, one reply a line) as #182's and #191's suites do: #191's builds (the release build for
// bakes and seeks, the `test-backends` build for the behavior kit and test backends), #182's world documents, states
// and rows, both imported read only. They add this issue's two walkers, its planted names, its test backend and its
// judges. Nothing here stands in for the character controller, the wrapper, the kit or a backend: every state, row,
// hash and kit row read here is the program's own, and every expected value is the issue's, copied or worked here from
// the closed form it gives. No function here asserts a criterion: each judge returns the failures it found, and the
// test file asserts on them.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import {
  CHARACTER_CAP, OFFSET, RADIUS, RATE, arr, between, characterStates, characterWorld, entry, heroBody, isObject, num, obj, rowsOf, show,
  slab, standing, statesOf, strs, type JsonObject, type JsonValue, type Row, type State, type Vec3,
} from '../182/helpers.ts';
import { REPO, TIMEOUT, physicsBin, type KitReport } from '../191/helpers.ts';

export { CHARACTER_CAP, OFFSET, RADIUS, RATE, show, statesOf, type JsonObject, type JsonValue, type State } from '../182/helpers.ts';
export { TIMEOUT, backendOf, kitReport, prebuild, type KitReport, type KitResult } from '../191/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const AC = { 1: '#2243.710b06f5', 2: '#2243.94c09b0c', 3: '#2243.369a5712', 4: '#2243.2a71ec4b' } as const;

// ---------------------------------------------------------------------------------------------------
// The runner (README: Planted wrong programs, The test backend)

/**
 * This suite's planted names (`deep-physics --planted <name>`), each one criterion's wrong wrapper.
 * `characters_against_last_step`: every character body moves against the last step's poses, the other character
 * bodies' included. `approach_moves_standing`: a walker's approach moves a character body that wants no move.
 */
export type Planted = 'characters_against_last_step' | 'approach_moves_standing';
/**
 * The test backends this suite runs (`deep-physics --backend <name>`, the `test-backends` build only).
 * `stale_character_poses` is this suite's: Rapier, each moved character's pose left stale until the backend step.
 * `no_character_controller` is #182's.
 */
export type TestBackend = 'stale_character_poses' | 'no_character_controller';
export interface Runner { planted?: Planted; backend?: TestBackend; build?: 'release' | 'test' }
/** What one process answered: `problem` is '' when it exited 0 with one reply a call, each `ok: true`. */
export interface Asked { problem: string; replies: JsonObject[] }

/**
 * Runs `calls` through one `deep-physics [--backend b] [--planted p]` process: the release build, or the
 * `test-backends` build for a test backend. It asserts nothing: a process that can't start is `BLOCKED:`, one that
 * doesn't finish `INCONCLUSIVE:`, and an exit code, a missing reply or a refusal is said in `problem`.
 */
export function ask(calls: JsonObject[], r: Runner = {}): Asked {
  const args = [...(r.backend ? ['--backend', r.backend] : []), ...(r.planted ? ['--planted', r.planted] : [])];
  const what = `deep-physics ${args.join(' ')}`.trim();
  const bin = physicsBin(r.build ?? (r.backend ? 'test' : 'release'));
  const run = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ETIMEDOUT') return { problem: `INCONCLUSIVE: ${what} did not finish within its timeout; this is not a pass`, replies: [] };
  if (run.error && code !== 'EPIPE') return { problem: `BLOCKED: ${what} could not run: ${run.error.message}; this is not a pass`, replies: [] };
  const stdout = run.stdout ?? '';
  if (run.status !== 0) return { problem: `${what} exits ${run.status}, not 0; stdout: ${stdout.slice(0, 600)}; stderr: ${(run.stderr ?? '').slice(-1200)}`, replies: [] };
  const lines = stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== calls.length) return { problem: `${what} answers ${lines.length} lines to ${calls.length} calls; stdout: ${stdout.slice(0, 600)}`, replies: [] };
  const replies: JsonObject[] = [];
  for (const [i, line] of lines.entries()) {
    let v: JsonValue;
    try { v = JSON.parse(line) as JsonValue; } catch { return { problem: `${what}: reply ${i} isn't JSON: ${line.slice(0, 300)}`, replies }; }
    if (!isObject(v)) return { problem: `${what}: reply ${i} isn't an object: ${line.slice(0, 300)}`, replies };
    if (v['ok'] !== true) return { problem: `${what}: reply ${i} (to ${show(calls[i], 100)}) isn't ok: ${show(v, 800)}`, replies };
    replies.push(v);
  }
  return { problem: '', replies };
}

/** A fresh folder per call (a bake's store), deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, TIMEOUT);
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2243-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// The issue's numbers and the world (README: The world)

export const GUARD = 'guard';
export const HERO = 'hero';
export const BODIES = [GUARD, HERO] as const;
export type Body = (typeof BODIES)[number];
export const other = (id: Body): Body => (id === GUARD ? HERO : GUARD);
/** Each walks at 2 m/s; their axes start 4 m apart along x. */
export const SPEED = 2;
export const APART = 4;
/** 0.3 + 0.3 + 0.01 = 0.61 m: the two radii and one offset, the distance between their axes at rest. */
export const REST = 2 * RADIUS + OFFSET;
/** Within 1 mm. */
export const WITHIN = 0.001;
/** The least distance between their axes at the end of any step, m. */
export const BOUND = 0.609;
/** The standing one's position never changes by more than this, m. */
export const STILL = 1e-6;
/** Every run is 3 s: 360 steps. Rest is read from 1 s, step 120, to its end. */
export const STEPS = 3 * RATE;
export const REST_FROM = RATE;
/** (4 − 0.61) ÷ 4 = 0.8475 s: when two walkers closing at 4 m/s are 0.61 m apart. */
export const MEET = (APART - REST) / (2 * SPEED);
/** Two steps' walk, 2 × 2 m/s ÷ 120 Hz = 0.0333 m. */
export const TWO_STEPS = (2 * SPEED) / RATE;

const START: Record<Body, number> = { [GUARD]: -APART / 2, [HERO]: APART / 2 };
/**
 * The head-on world: `guard` at x = −2 m and `hero` at x = +2 m, each #182's capsule (radius 0.3 m, half height 0.6 m)
 * with offset 0.01 m, standing on a flat static floor at 120 Hz. `guard` has priority 0 and `hero` 1, so `guard` is the
 * earlier in canonical (priority, ID) order; `swapped` gives `guard` 1 and `hero` 0.
 */
export function headOnWorld(swapped = false): JsonObject {
  const body = (id: Body, priority: number): JsonObject => heroBody([START[id], standing(0), 0], {}, { character: { offset: OFFSET }, priority });
  return characterWorld({
    statics: { floor: slab(-8, 8, -1, 0) },
    movers: { [GUARD]: body(GUARD, swapped ? 1 : 0), [HERO]: body(HERO, swapped ? 0 : 1) },
    inputs: { walk: { kind: 'move', targets: [GUARD, HERO] } },
  });
}
/** `id`'s move stamped at step 0: 2 m/s along x toward the other. */
export const walk = (id: Body): JsonObject => entry(0, 'move', { velocity: [id === GUARD ? SPEED : -SPEED, 0, 0] }, id);
/** Both walk toward each other. */
export const headOnTrack = (): JsonObject[] => BODIES.map(walk);

/** A bake of 3 s reading both bodies, a state a step. */
export const bakeCall = (w: JsonObject, track: JsonObject[], extra: JsonObject = {}): JsonObject =>
  ({ call: 'bake', world: w, steps: STEPS, track, read: [GUARD, HERO], ...extra });
/** A seek of the bake kept in `store` to step `to`, played on to the bake's end. */
export const seekCall = (w: JsonObject, track: JsonObject[], store: string, to: number): JsonObject =>
  ({ call: 'seek', world: w, track, steps: STEPS, store, to, play: STEPS - to, read: [GUARD, HERO] });

// ---------------------------------------------------------------------------------------------------
// Reading a bake: both bodies' states (index k the state after step k), the occurrence rows and the step hashes.

export interface Pair { guard: State[]; hero: State[]; rows: Row[]; hashes: string[] }
export const hashesOf = (reply: JsonObject, what: string): string[] => strs(reply['step_hashes'], `${what}: step_hashes`);
export function pairOf(reply: JsonObject, what: string): Pair {
  return { guard: statesOf(reply, GUARD, what), hero: statesOf(reply, HERO, what), rows: rowsOf(reply, what), hashes: hashesOf(reply, what) };
}
/** A number as a failure prints it: six decimals, or an exponent for one under a millimetre. */
export const fmt = (x: number): string => (x !== 0 && Math.abs(x) < 1e-3 ? x.toExponential(3) : String(+x.toFixed(6)));
const far = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** The distance between two capsules' axes: the axes stand along the world's up, +Y, so it is the distance along x and z. */
export const axes = (a: State, b: State): number => Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]);
/** The distance between the two bodies' axes at the end of step `k`. */
export const apart = (p: Pair, k: number): number => axes(p.guard[k]!, p.hero[k]!);
/** The first of `states`' steps from step 1 on that ends with the axes under `bound` apart (−1: none), and how many do. */
export function under(a: State[], b: State[], bound: number): { first: number; count: number } {
  let [first, count] = [-1, 0];
  for (let k = 1; k < Math.min(a.length, b.length); k++) if (axes(a[k]!, b[k]!) < bound) { count += 1; if (first < 0) first = k; }
  return { first, count };
}
/** A run that doesn't hold a state and a hash for the built world and each of its 360 steps can't be judged. */
export function missing(p: Pair, what: string): string[] {
  const out: string[] = [];
  for (const id of BODIES) if (p[id].length !== STEPS + 1) out.push(`INCONCLUSIVE: ${what} holds ${p[id].length} states of ${id}, not ${STEPS + 1}; this is not a pass`);
  if (p.hashes.length !== STEPS + 1) out.push(`INCONCLUSIVE: ${what} holds ${p.hashes.length} step hashes, not ${STEPS + 1}; this is not a pass`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The judges. Each returns everything wrong with a run; a failure starts with the step or the body it is about.

/** "From 1 s to 3 s neither moves more than 1 mm": each body, at every step from 120 to 360, within 1 mm of where it stood at step 120. */
export function restFailures(p: Pair, what: string): string[] {
  const gone = missing(p, what);
  if (gone.length) return gone;
  return BODIES.flatMap((id) => {
    const from = p[id][REST_FROM]!.pos;
    let [worst, step] = [0, REST_FROM];
    for (let k = REST_FROM; k <= STEPS; k++) { const m = far(p[id][k]!.pos, from); if (m > worst) [worst, step] = [m, k]; }
    return worst > WITHIN ? [`${id}: ${what} has it ${fmt(worst)} m from where it stood at 1 s by step ${step}, more than 1 mm, so it isn't at rest from 1 s to 3 s`] : [];
  });
}

/**
 * "Each writes `contact_begin` naming the other within four steps of 0.8475 s": for each body, the first step whose
 * state's `touching` names the other (the step its controller first touches it) lies within four steps of step 101.7,
 * and the occurrence list holds a `contact_begin` row of the pair at that step: two there when both first touch on one
 * step, since each writes its own.
 */
export function meetFailures(p: Pair, what: string): string[] {
  const first = (id: Body): number => characterStates(p[id], `${what}: ${id}`).findIndex((c, k) => k >= 1 && c.touching.includes(other(id)));
  const at: Record<Body, number> = { [GUARD]: first(GUARD), [HERO]: first(HERO) };
  const begins = between(p.rows, 'contact_begin', GUARD, HERO);
  const out: string[] = [];
  for (const id of BODIES) {
    const k = at[id];
    if (k < 0) { out.push(`${id}: its controller never touches ${other(id)} (no state's touching names it), so it writes no contact_begin naming it`); continue; }
    if (Math.abs(k - MEET * RATE) > 4) out.push(`${id}: its controller first touches ${other(id)} at step ${k}, not within four steps of (4 − 0.61) ÷ 4 = 0.8475 s (step ${fmt(MEET * RATE)})`);
    const need = at[other(id)] === k ? 2 : 1;
    const rows = begins.filter((r) => r.step === k).length;
    if (rows < need) out.push(`${id}: the occurrence list holds ${rows} contact_begin rows of ${GUARD} and ${HERO} at step ${k}, the first step its controller touches ${other(id)}; ${need} expected, one from each body that first touches the other there`);
  }
  return out;
}

/**
 * Criterion 1, over one bake of the head-on world: no step ends with the axes under 0.609 m apart; from 1 s to 3 s
 * they stand 0.61 m apart within 1 mm and neither moves more than 1 mm; each writes contact_begin naming the other
 * within four steps of 0.8475 s. The failure of the 0.609 m bound names the first step under it and both bodies.
 */
export function headOnFailures(p: Pair, what: string): string[] {
  const gone = missing(p, what);
  if (gone.length) return gone;
  const out: string[] = [];
  const close = under(p.guard, p.hero, BOUND);
  if (close.first >= 0) out.push(`step ${close.first}: ${GUARD} and ${HERO} end it with their axes ${fmt(apart(p, close.first))} m apart, under ${BOUND} m (${close.count} of ${STEPS} steps end under it)`);
  const off: number[] = [];
  for (let k = REST_FROM; k <= STEPS; k++) if (Math.abs(apart(p, k) - REST) > WITHIN) off.push(k);
  if (off.length) out.push(`step ${off[0]}: ${GUARD} and ${HERO} stand with their axes ${fmt(apart(p, off[0]!))} m apart, not 0.3 + 0.3 + 0.01 = ${fmt(REST)} m within 1 mm (${off.length} of the ${STEPS - REST_FROM + 1} steps from 1 s to 3 s are off)`);
  return [...out, ...restFailures(p, what), ...meetFailures(p, what)];
}

/**
 * Criterion 2, over one bake in which `walker` alone walks: the standing one is never more than 1e-6 m from where it
 * was built, and through the last second (steps 240 to 360) the axes are 0.61 m apart within 1 mm. Each failure starts
 * with the body it is about.
 */
export function standingFailures(p: Pair, walker: Body, what: string): string[] {
  const gone = missing(p, what);
  if (gone.length) return gone;
  const out: string[] = [];
  const stander = other(walker);
  const moved = movedBy(p, stander);
  if (moved.first >= 0) out.push(`${stander}: the standing body is ${fmt(far(p[stander][moved.first]!.pos, p[stander][0]!.pos))} m from where it stood at step ${moved.first}, more than 1e-6 m, as ${walker} walks into it (${fmt(moved.worst)} m at the most, at step ${moved.step})`);
  const off: number[] = [];
  for (let k = STEPS - RATE; k <= STEPS; k++) if (Math.abs(apart(p, k) - REST) > WITHIN) off.push(k);
  if (off.length) out.push(`${walker}: at step ${off[0]} its axis is ${fmt(apart(p, off[0]!))} m from ${stander}'s, not stopped ${fmt(REST)} m from it within 1 mm (${off.length} of the last second's ${RATE + 1} states are off)`);
  return out;
}
/** How far `id` is from where it was built: the first step it is more than 1e-6 m off (−1: never), and its farthest. */
export function movedBy(p: Pair, id: Body): { first: number; worst: number; step: number } {
  let [first, worst, step] = [-1, 0, 0];
  for (let k = 1; k < p[id].length; k++) {
    const m = far(p[id][k]!.pos, p[id][0]!.pos);
    if (m > STILL && first < 0) first = k;
    if (m > worst) [worst, step] = [m, k];
  }
  return { first, worst, step };
}

/** The point midway between the two axes after step `k`, along x and z. */
export const midway = (p: Pair, k: number): [number, number] => [(p.guard[k]!.pos[0] + p.hero[k]!.pos[0]) / 2, (p.guard[k]!.pos[2] + p.hero[k]!.pos[2]) / 2];

/** Where two lists of step hashes differ: nothing when equal, entry for entry; `from` is the step of index 0. */
export function hashFailures(a: string[], b: string[], from: number, what: string): string[] {
  if (a.length !== b.length) return [`${what}: ${a.length} step hashes against ${b.length}`];
  const differ = a.flatMap((h, j) => (h === b[j] ? [] : [j]));
  return differ.length ? [`step ${from + differ[0]!}: ${what}: step hash ${a[differ[0]!]} against ${b[differ[0]!]} (${differ.length} of ${a.length} differ)`] : [];
}
/**
 * A comparison of hashes proves nothing unless a hash follows the bodies: while both walk and neither can yet touch
 * (steps 1 to 90), every step's hash is a hash, and differs from the step before's.
 */
export function hollowHashes(hashes: string[], what: string): string[] {
  const out: string[] = [];
  for (let k = 1; k <= 90; k++) {
    if (!/^[0-9a-f]{8,}$/.test(hashes[k] ?? '')) { out.push(`INCONCLUSIVE: ${what}: step ${k}'s hash is ${JSON.stringify(hashes[k])}, no hash; this is not a pass`); break; }
    if (hashes[k] === hashes[k - 1]) { out.push(`INCONCLUSIVE: ${what}: the step hash doesn't change from step ${k - 1} to ${k} while both bodies walk, so equal hashes would prove nothing; this is not a pass`); break; }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The behavior kit (README: The fixtures in the behavior kit)

export const HEAD_ON = 'character/head_on';
export const INTO_STANDING = 'character/into_standing';
export const KIT_FIXTURES = [HEAD_ON, INTO_STANDING] as const;

export interface Fixture { name: string; world: JsonObject; steps: number; track: JsonObject[]; answer: number; tolerance: JsonValue; caps: string[] }
/** The fixtures named `name` in a `behavior_fixtures` reply. */
export function fixturesNamed(reply: JsonObject, name: string): Fixture[] {
  return arr(reply['fixtures'], 'behavior_fixtures: fixtures').filter((v): v is JsonObject => isObject(v) && v['name'] === name).map((o) => ({
    name, world: obj(o['world'], `${name}: world`), steps: num(o['steps'], `${name}: steps`),
    track: arr(o['track'] ?? [], `${name}: track`).map((e, i) => obj(e, `${name}: track[${i}]`)),
    answer: num(o['answer'], `${name}: answer`), tolerance: o['tolerance'] ?? null, caps: strs(o['caps'] ?? [], `${name}: caps`),
  }));
}
/** A fixture world's character bodies: where each is built along x and z, its capsule's radius and its offset (0.01 m when unwritten). */
export interface Walker { id: string; x: number; z: number; radius: number | null; offset: number | null }
export function walkersIn(w: JsonObject): Walker[] {
  const bodies = isObject(w['bodies']) ? w['bodies'] : {};
  const shapes = isObject(w['shapes']) ? w['shapes'] : {};
  const out: Walker[] = [];
  for (const [id, b] of Object.entries(bodies)) {
    if (!isObject(b) || b['kind'] !== 'character') continue;
    const pos = isObject(b['pose']) && Array.isArray(b['pose']['pos']) ? b['pose']['pos'] : [];
    const use = Array.isArray(b['shapes']) && b['shapes'].length === 1 && isObject(b['shapes'][0]) ? b['shapes'][0] : {};
    const named = shapes[String(use['shape'])];
    const shape = isObject(named) ? named : {};
    const offset = isObject(b['character']) ? b['character']['offset'] : undefined;
    out.push({
      id, x: typeof pos[0] === 'number' ? pos[0] : NaN, z: typeof pos[2] === 'number' ? pos[2] : NaN,
      radius: shape['kind'] === 'capsule' && typeof shape['radius'] === 'number' ? shape['radius'] : null,
      offset: offset === undefined ? OFFSET : typeof offset === 'number' ? offset : null,
    });
  }
  return out;
}
/** What `w` wants over the fixture's track: `walks` (moves at 2 m/s along x toward `o` from step 0), `stands` (no move, or none but zero), or its entries. */
function wants(f: Fixture, w: Walker, o: Walker): string {
  const mine = f.track.filter((e) => e['target'] === w.id);
  const moves = (v: number[]): boolean => mine.every((e) => {
    const got = isObject(e['data']) && Array.isArray(e['data']['velocity']) ? e['data']['velocity'] : [];
    return e['kind'] === 'move' && got.length === 3 && got.every((x, i) => x === v[i]);
  });
  if (moves([0, 0, 0])) return 'stands';
  if (mine[0]!['step'] === 0 && moves([Math.sign(o.x - w.x) * SPEED, 0, 0])) return 'walks';
  return `has the entries ${show(mine, 300)}`;
}
/**
 * Everything about the kit's data for `name` that isn't the issue's fixture: held once, naming `character_controller`,
 * its answer 0.61 m and its tolerance 1 mm, at 120 Hz, two character bodies of radius 0.3 m and offset 0.01 m built
 * with their axes 4 m apart along x; for the head-on fixture both walk toward each other at 2 m/s for 3 s at least,
 * for the other one walks into the other, which wants no move.
 */
export function fixtureFailures(reply: JsonObject, name: (typeof KIT_FIXTURES)[number]): string[] {
  const found = fixturesNamed(reply, name);
  if (found.length !== 1) {
    const held = arr(reply['fixtures'], 'behavior_fixtures: fixtures').map((v) => (isObject(v) ? String(v['name']) : '')).filter((n) => n.startsWith('character/'));
    return [`${name}: the kit's data holds it ${found.length} times, not once; its character fixtures: ${held.join(', ')}`];
  }
  const f = found[0]!;
  const out: string[] = [];
  if (!f.caps.includes(CHARACTER_CAP)) out.push(`${name}: its caps ${show(f.caps)} don't name ${CHARACTER_CAP}`);
  if (!(Math.abs(f.answer - REST) <= 1e-9)) out.push(`${name}: its answer ${f.answer} isn't 0.3 + 0.3 + 0.01 = ${fmt(REST)} (m)`);
  if (JSON.stringify(f.tolerance) !== JSON.stringify({ m: WITHIN })) out.push(`${name}: its tolerance ${show(f.tolerance)} isn't the issue's 1 mm, {"m": ${WITHIN}}`);
  if ((f.world['step_rate'] ?? RATE) !== RATE) out.push(`${name}: its world steps at ${show(f.world['step_rate'])} Hz, not ${RATE}`);
  const walkers = walkersIn(f.world);
  if (walkers.length !== 2) return [...out, `${name}: its world holds ${walkers.length} character bodies, not two`];
  const [p, q] = walkers as [Walker, Walker];
  for (const w of walkers) {
    if (w.radius !== RADIUS) out.push(`${name}: ${w.id} isn't one capsule of radius ${RADIUS} m (its radius: ${show(w.radius)})`);
    if (w.offset !== OFFSET) out.push(`${name}: ${w.id}'s offset is ${show(w.offset)}, not ${OFFSET} m`);
  }
  if (!(Math.abs(Math.abs(p.x - q.x) - APART) <= 1e-9 && Math.abs(p.z - q.z) <= 1e-9)) out.push(`${name}: ${p.id} and ${q.id} are built ${fmt(Math.abs(p.x - q.x))} m apart along x and ${fmt(Math.abs(p.z - q.z))} m along z, not ${APART} m apart along x`);
  const want = [wants(f, p, q), wants(f, q, p)].sort().join(' and ');
  const due = name === HEAD_ON ? 'walks and walks' : 'stands and walks';
  if (want !== due) out.push(`${name}: over its track ${p.id} ${wants(f, p, q)} and ${q.id} ${wants(f, q, p)}; ${name === HEAD_ON ? `both walk toward each other at ${SPEED} m/s along x from step 0` : `one walks at ${SPEED} m/s along x into the other from step 0 and the other wants no move`}`);
  if (name === HEAD_ON && !(f.steps >= STEPS)) out.push(`${name}: it runs ${f.steps} steps, short of the criterion's 3 s (${STEPS} steps)`);
  return out;
}

/** Everything wrong with the kit's row for `f` read as a pass: held once, `pass`, the interface's answer and tolerance, measured within 1 mm of 0.61 m. */
export function passFailures(report: KitReport, f: Fixture): string[] {
  const rows = report.results.filter((r) => r.fixture === f.name);
  if (rows.length !== 1) return [`${f.name}: the kit's report on ${report.backend} holds it ${rows.length} times, not once`];
  const r = rows[0]!;
  const out: string[] = [];
  if (r.result !== 'pass') out.push(`${f.name} reads ${r.result} on ${report.backend}, not pass: ${r.what}`);
  if (r.answer !== f.answer || JSON.stringify(r.tolerance) !== JSON.stringify(f.tolerance)) out.push(`${f.name}: the row's answer and tolerance ${show(r.answer)} ${show(r.tolerance ?? null)} aren't the interface's ${f.answer} ${show(f.tolerance)}`);
  if (r.measured === null || !(Math.abs(r.measured - REST) <= WITHIN + 1e-12)) out.push(`${f.name}: measured ${show(r.measured)} on ${report.backend}, outside ${fmt(REST)} m within 1 mm`);
  return out;
}

/** The numbers a sentence names, each without its sign. */
export const numbersIn = (text: string): number[] => [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
/** Whether `text` names a number within `within` of `value`. */
export const namesNumber = (text: string, value: number, within: number): boolean => numbersIn(text).some((n) => Math.abs(n - value) <= within);
