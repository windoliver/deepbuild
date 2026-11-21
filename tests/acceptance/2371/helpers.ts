// Test-side tools for the #2371 acceptance tests (README: The surface under test). They drive the physics runner
// `deep-physics` (JSON lines in, one reply per line) as #522's suite does: the binary #2009's helper builds, once per
// file, reached through ../1918/helpers.ts (imported read only, as #522's helpers import it). They add only this
// issue's worlds, its one planted name and its judges. Nothing here stands in for the world reader, the input track,
// the backend or the checkpoint ring: every refusal, step hash, body state and seek read here is the program's own;
// every expected value is the issue's or follows from the step the test's own track or channel names.
//
// No function here asserts. What a program answers and what a judge finds wrong with it both come back as text, so
// each test's failing assertion is in its own file. Only a process that can't be run at all throws, `BLOCKED:` or
// `INCONCLUSIVE:` first, as the base's suites do: nothing unrun passes.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, TIMEOUT, isObject, physicsBin, show, type JsonObject, type JsonValue } from '../1918/helpers.ts';

export { TIMEOUT, prebuild, show, type JsonObject, type JsonValue } from '../1918/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const AC = { 1: '#2371.7fae183d', 2: '#2371.825e2c1b', 3: '#2371.aabc7fe9' } as const;

/** This suite's planted name (`deep-physics --planted <name>`): criterion 1's wrong program (README: The planted wrong program). */
export type Planted = 'set_applies_both';
export const SET_APPLIES_BOTH: Planted = 'set_applies_both';

// ---------------------------------------------------------------------------------------------------
// The runner: this checkout's `deep-physics` (#2009's build, `cargo build --locked --bin deep-physics`).

/**
 * What one process answered: `problem` is '' and `replies` holds one object per call, or `problem` says what the
 * program did instead (a planted name it doesn't know exits 2 with `bad_input`).
 */
export interface Asked { what: string; problem: string; replies: JsonObject[] }

const SPAWN_MS = TIMEOUT - 300_000;
/** Runs `calls` through one `deep-physics [--planted p]` process. A name the build doesn't know comes back as `problem`, never a throw. */
export function ask(calls: JsonObject[], planted?: Planted): Asked {
  const args = planted ? ['--planted', planted] : [];
  const what = `deep-physics ${args.join(' ')}`.trim();
  const run = spawnSync(physicsBin(), args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: SPAWN_MS, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  const no = (problem: string): Asked => ({ what, problem, replies: [] });
  if (code === 'ETIMEDOUT') throw Error(`INCONCLUSIVE: ${what} didn't finish within ${SPAWN_MS / 60_000} minutes`);
  if (run.error && code !== 'EPIPE') throw Error(`BLOCKED: ${what} couldn't be run: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  if (run.status !== 0) return no(`${what} exits ${String(run.status)}, not 0; stdout: ${stdout.trim().slice(0, 600)}; stderr: ${(run.stderr ?? '').trim().slice(-600)}`);
  const lines = stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== calls.length) return no(`${what} wrote ${lines.length} replies to ${calls.length} calls; stdout: ${stdout.slice(0, 600)}`);
  const replies: JsonObject[] = [];
  for (const [i, line] of lines.entries()) {
    let v: JsonValue;
    try { v = JSON.parse(line) as JsonValue; } catch { return no(`${what}: reply ${i} isn't JSON: ${line.slice(0, 300)}`); }
    if (!isObject(v)) return no(`${what}: reply ${i} isn't an object: ${line.slice(0, 300)}`);
    replies.push(v);
  }
  return { what, problem: '', replies };
}

/** A fresh folder for a bake's store, and its removal. With no folder nothing is baked into one: `BLOCKED:`. */
export function scratch(): string {
  try { return mkdtempSync(join(tmpdir(), 'deep-2371-store-')); } catch (e) { throw Error(`BLOCKED: no temporary folder for a bake's store: ${(e as Error).message}`); }
}
export const drop = (dir: string): void => rmSync(dir, { recursive: true, force: true });

// ---------------------------------------------------------------------------------------------------
// Steps and entries. The base's conventions (#522's README: Step convention; #1918's: "step k's time is k ÷ 120 s"):
// `step_hashes[k]` and `bodies.<ID>[k]` are the state after k steps, index 0 the world as built. An entry stamped
// `step: k` applies at the start of the step from that state to the next, so the state after k + 1 steps is the first
// it can change. The step that ends in the state after k steps reads its channels at k ÷ 120 s, so a key at that time
// can first change the state after k steps.

export const RATE = 120;
/** Every world here takes a checkpoint each 60 steps and is played 240 steps. */
export const EVERY = 60;
export const STEPS = 240;
/** A seek to step `to`, and the checkpoint it restores: the nearest at or before it (Checkpoint ring). */
export interface Sought { to: number; from: number }
/** To step 65 from the checkpoint at step 60, and to step 130 from the one at step 120. */
export const SEEK_EARLY: Sought = { to: 65, from: 60 };
export const SEEK_LATE: Sought = { to: 130, from: 120 };

export type V3 = [number, number, number];
/** An input track entry (Input track entries: `{step, kind, target, data}`). */
export const entry = (step: number, kind: string, target: string, data?: JsonObject): JsonObject => ({ step, kind, target, ...(data ? { data } : {}) });
/** An entry as text, for messages. */
export const entryText = (e: JsonObject): string => `${String(e['kind'])} of ${String(e['target'])}${isObject(e['data']) ? ` ${JSON.stringify(e['data'])}` : ''} stamped step ${String(e['step'])}`;
const stepOf = (e: JsonObject): number => (typeof e['step'] === 'number' ? e['step'] : -1);

// ---------------------------------------------------------------------------------------------------
// Worlds (README: The worlds). `physics.world@1` as the base's reader takes it: maps by ID, shape uses on bodies.
// No two bodies of any world here ever touch, and none meets a floor: each is moved by gravity, by one force or by
// one input alone.

const world = (parts: JsonObject): JsonObject => ({
  kind: 'physics.world@1', dimensions: 3, step_rate: RATE, substeps: 4, gravity: [0, -9.81, 0], seed: 2371, mode: 'dynamic',
  capacity: { bodies: 8, shapes: 8, joints: 0, contacts: 16, particles: 0 },
  backend: { name: 'rapier3d', version: '=0.36.1' },
  contact_materials: { m: { friction: 0.5, restitution: 0, density: 1000 } },
  checkpoint: { every: EVERY },
  ...parts,
});
const sphere = (radius: number): JsonObject => ({ kind: 'sphere', radius });
/** A dynamic body of 1 kg with one shape use. */
const body = (shape: string, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'dynamic', shapes: [{ shape, contact_material: 'm' }], pose: { pos }, mass: 1, ...extra });
/** A body gravity doesn't pull and sleep doesn't take: it stays exactly as built until a force or an input moves it. */
const FLOATS: JsonObject = { gravity_scale: 0, sleep: false };

/** The force an input sets: a uniform 2 m/s² along +x on the puck, its `strength` the `set` input `throttle`. */
const PUSH: JsonObject = { kind: { uniform: { accel: [2, 0, 0] } }, applies_to: ['puck'], strength: 'throttle' };
/** The `set` input that sets it (Input track entries: `set {path, value}`): its target the force, its path the force's `strength`. */
const THROTTLE: JsonObject = { kind: 'set', targets: ['push'], path: 'strength', value: 0 };
/** A `set` of the force's strength to `value`, stamped `step`. */
export const setAt = (step: number, value: number): JsonObject => entry(step, 'set', 'push', { value });

/**
 * Criterion 1's world, one input of each kind. `sleeper` is built inactive and an `activate` lets it fall; `faller`
 * falls from the start and a `deactivate` stops it; `puck` floats at rest under the force `push`, whose strength a
 * `set` sets; `chip` floats at rest 0.9 m from where a `blast` of radius 1 m goes off.
 */
export function yard(): JsonObject {
  return world({
    shapes: { ball: sphere(0.25), bead: sphere(0.05) },
    bodies: {
      sleeper: body('ball', [-4, 0, 0], { active: false }),
      faller: body('ball', [-2, 0, 0]),
      puck: body('ball', [0, 0, 0], FLOATS),
      chip: body('bead', [0.9, 0, 4], FLOATS),
    },
    forces: { push: PUSH },
    inputs: {
      throttle: THROTTLE,
      wake: { kind: 'activate', targets: ['sleeper'] },
      halt: { kind: 'deactivate', targets: ['faller'] },
      boom: { kind: 'blast', targets: ['chip'], at: [0, 0, 4], radius: 1, impulse_per_length: 1 },
    },
  });
}
/**
 * The yard's track: one entry of each kind, all four between the checkpoints at steps 60 and 120, so a seek from the
 * first applies each of them after its restore and a seek from the second restores what each of them did.
 */
export const WAKE = entry(70, 'activate', 'sleeper');
export const SET = setAt(80, 3);
export const HALT = entry(90, 'deactivate', 'faller');
export const BOOM = entry(100, 'blast', 'chip');
export const YARD_TRACK: JsonObject[] = [WAKE, SET, HALT, BOOM];

/** Criterion 2's poked body: a 0.5 m crate floating at rest at the origin, unturned, with the anchor `rim` at the middle of its +x face. */
export const RIM: V3 = [0.25, 0, 0];
export const IMPULSE: V3 = [0, 1, 0];
export function pokeWorld(): JsonObject {
  return world({
    shapes: { crate: { kind: 'box', half: [0.25, 0.25, 0.25] } },
    bodies: { crate: body('crate', [0, 0, 0], { ...FLOATS, anchors: { rim: RIM } }) },
    inputs: { poke: { kind: 'poke', targets: ['crate'] } },
  });
}
export const POKE_STEP = 10;
/** The same impulse at step 10: by `address`, at the anchor's point, and at the body's centre. */
export const POKE_BY_ADDRESS = entry(POKE_STEP, 'poke', 'crate', { address: 'crate#rim', impulse: IMPULSE });
export const POKE_AT_POINT = entry(POKE_STEP, 'poke', 'crate', { point: RIM, impulse: IMPULSE });
export const POKE_AT_CENTRE = entry(POKE_STEP, 'poke', 'crate', { impulse: IMPULSE });

/**
 * Criterion 2's blast: two beads of radius 0.05 m floating at rest, `near` with its centre 0.9 m from the origin
 * and `far` 1.1 m from it along another axis, and a blast at the origin of radius `radius` m. Whether a body's
 * distance is read to its centre or to its nearest point, `near` is inside 1 m (0.9 m, 0.85 m) and `far` outside
 * it (1.1 m, 1.05 m).
 */
export function blastWorld(radius: number): JsonObject {
  return world({
    shapes: { bead: sphere(0.05) },
    bodies: { near: body('bead', [0.9, 0, 0], FLOATS), far: body('bead', [0, 0, 1.1], FLOATS) },
    inputs: { boom: { kind: 'blast', targets: ['far', 'near'], at: [0, 0, 0], radius, impulse_per_length: 1 } },
  });
}
export const BLAST_STEP = 10;
/** One blast entry for each bead, on one step. */
export const BLAST_TRACK: JsonObject[] = [entry(BLAST_STEP, 'blast', 'near'), entry(BLAST_STEP, 'blast', 'far')];

// ---------------------------------------------------------------------------------------------------
// Criterion 3's scene (README: The worlds). A scene whose world `field` holds three floating bodies, each under one
// force: `leaf` in a drag whose medium reads items/wind/at/pos, `bob` on a spring whose point reads
// items/anchor/at/pos, `puck` under the force whose strength the input `throttle` sets. Each channel holds its value
// from one key to the next, and each key sits on a step's time between two 60 fps frames.

export const FIELD = 'field';
const WIND = 'items/wind/at/pos';
const ANCHOR = 'items/anchor/at/pos';
interface Key { id: string; t: string; value: V3 }
/** The medium's velocity, m/s: still, then 3 m/s along +x from step 33 (0.275 s), then 2 m/s along −z from step 153 (1.275 s). */
const WIND_KEYS: Key[] = [{ id: 'k0', t: '0s', value: [0, 0, 0] }, { id: 'k1', t: '0.275s', value: [3, 0, 0] }, { id: 'k2', t: '1.275s', value: [0, 0, -2] }];
/** The spring's point, m: where `bob` is built, then 0.5 m along +x from step 45 (0.375 s), then 0.5 m up from step 165 (1.375 s). */
const BOB_AT: V3 = [0, 2, 3];
const ANCHOR_KEYS: Key[] = [{ id: 'k0', t: '0s', value: BOB_AT }, { id: 'k1', t: '0.375s', value: [0.5, 2, 3] }, { id: 'k2', t: '1.375s', value: [0.5, 2.5, 3] }];
const channel = (target: string, keys: Key[], without?: string): JsonObject => ({
  target, type: 'vec3', keys: Object.fromEntries(keys.filter((k) => k.id !== without).map((k) => [k.id, { t: k.t, value: k.value, interp: 'hold' }])),
});
const marker = (id: string, order: string, pos: V3): JsonObject => ({ id, kind: 'mark.box@1', name: id, order, params: { size: [0.1, 0.1, 0.1] }, at: { pos } });

/** A key left out of one of the scene's two channels. */
export interface Without { wind?: string; anchor?: string }
export function forceScene(without: Without = {}): JsonObject {
  return {
    format: 1, profile: 'scene', title: 'Forces a channel or an input sets',
    description: 'Issue #2371 criterion 3: a drag whose medium reads a channel, a spring whose point reads a channel and a force whose strength an input sets.',
    size: [640, 360], camera: 'cam', transport: { span: '2s', frame_rate: [60, 1] }, requires: { modules: { scene3d: '^1' } },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'cam', order: 'a0', params: { projection: 'perspective', position: [0, 4, 12], target: [0, 1, 0], fov: 40 } },
      wind: marker('wind', 'a1', [0, 0, 0]),
      anchor: marker('anchor', 'a2', BOB_AT),
    },
    channels: { wind: channel(WIND, WIND_KEYS, without.wind), anchor: channel(ANCHOR, ANCHOR_KEYS, without.anchor) },
    worlds: {
      [FIELD]: world({
        shapes: { ball: sphere(0.25) },
        bodies: { leaf: body('ball', [0, 0, 0], FLOATS), bob: body('ball', BOB_AT, FLOATS), puck: body('ball', [0, 0, -3], FLOATS) },
        forces: {
          breeze: { kind: { drag: { linear: 2, medium: WIND } }, applies_to: ['leaf'] },
          tether: { kind: { spring_to_point: { point: ANCHOR, hz: 1, damping_ratio: 1 } }, applies_to: ['bob'] },
          push: PUSH,
        },
        inputs: { throttle: THROTTLE },
      }),
    },
  };
}
/** The field's track: the strength set to 3 at step 40 and to 1 at step 190. */
export const FIELD_TRACK: JsonObject[] = [setAt(40, 3), setAt(190, 1)];

/** One thing a channel or an input says, and the run without it. */
export interface Says { name: string; body: string; first: number; scene: JsonObject; track: JsonObject[] }
/**
 * Each key and each entry of the field, with the first state it can change (a key at step K's time: the state after
 * K steps; an entry stamped k: the state after k + 1) and the field without it. Three come before the checkpoint a
 * seek to step 130 restores, three after it.
 */
export const SAYS: Says[] = [
  { name: 'the drag breeze\'s medium, keyed to 3 m/s along +x at 0.275 s (step 33)', body: 'leaf', first: 33, scene: forceScene({ wind: 'k1' }), track: FIELD_TRACK },
  { name: 'the spring tether\'s point, keyed 0.5 m along +x at 0.375 s (step 45)', body: 'bob', first: 45, scene: forceScene({ anchor: 'k1' }), track: FIELD_TRACK },
  { name: 'the force push\'s strength, set to 3 by the entry stamped step 40', body: 'puck', first: 41, scene: forceScene(), track: [setAt(190, 1)] },
  { name: 'the drag breeze\'s medium, keyed to 2 m/s along −z at 1.275 s (step 153)', body: 'leaf', first: 153, scene: forceScene({ wind: 'k2' }), track: FIELD_TRACK },
  { name: 'the spring tether\'s point, keyed 0.5 m up at 1.375 s (step 165)', body: 'bob', first: 165, scene: forceScene({ anchor: 'k2' }), track: FIELD_TRACK },
  { name: 'the force push\'s strength, set to 1 by the entry stamped step 190', body: 'puck', first: 191, scene: forceScene(), track: [setAt(40, 3)] },
];

// ---------------------------------------------------------------------------------------------------
// Calls (all the base's: #2009's `bake`, #522's `track` and `seek`, #1918's `scene` with `world` an ID).

export const bake = (w: JsonObject, track: JsonObject[], steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'bake', world: w, track, steps, ...extra });
export const seek = (w: JsonObject, track: JsonObject[], steps: number, store: string, to: number): JsonObject =>
  ({ call: 'seek', world: w, track, steps, store, to, play: steps - to, read: [] });
export const sceneBake = (scene: JsonObject, id: string, track: JsonObject[], steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'bake', scene, world: id, track, steps, ...extra });
export const sceneSeek = (scene: JsonObject, id: string, track: JsonObject[], steps: number, store: string, to: number): JsonObject =>
  ({ call: 'seek', scene, world: id, track, steps, store, to, play: steps - to, read: [] });
/** A bake that answers its step hashes and no body's states. */
export const HASHES_ONLY: JsonObject = { read: [] };

// ---------------------------------------------------------------------------------------------------
// Reading a bake (the base's reply: `step_hashes[k]` and `bodies.<ID>[k]`, the state after k steps).

/** Why a reply isn't a bake or a seek, in its own words: the first issue at each path, its code and its sentence's first 160 characters. */
export function refusal(reply: JsonObject | undefined): string {
  const issues = reply && Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  const first = issues.filter((i, k) => issues.findIndex((j) => j['path'] === i['path']) === k);
  return first.length ? first.map((i) => `${String(i['code'])} at ${String(i['path'])}: ${String(i['what']).slice(0, 160)}`).join('; ') : show(reply);
}
/** An accepted bake's step hashes, the built state's and one for each of `steps` steps; or, as text, why there are none. */
export function hashesOf(reply: JsonObject | undefined, steps: number, what: string): string[] | string {
  if (reply?.['ok'] !== true) return `${what} isn't baked: ${refusal(reply)}`;
  const h = reply['step_hashes'];
  if (!Array.isArray(h) || !h.every((x): x is string => typeof x === 'string' && x !== '')) return `${what}: step_hashes isn't a list of hashes: ${show(h)}`;
  return h.length === steps + 1 ? h : `${what} holds ${h.length} step hashes, not the built state's and one for each of ${steps} steps`;
}

export interface State { pos: V3; rot: number[]; linear: V3; angular: V3 }
const numbers = (v: JsonValue | undefined, n: number): number[] | null =>
  (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null);
/** An accepted bake's states of body `id`, the built one and one for each of `steps` steps; or, as text, why they can't be read. */
export function statesOf(reply: JsonObject | undefined, id: string, steps: number, what: string): State[] | string {
  if (reply?.['ok'] !== true) return `${what} isn't baked: ${refusal(reply)}`;
  const series = isObject(reply['bodies']) ? reply['bodies'][id] : undefined;
  if (!Array.isArray(series)) return `${what}: the bake lists no states of body ${id}: ${show(reply['bodies'])}`;
  if (series.length !== steps + 1) return `${what}: ${id} has ${series.length} states, not the built one and one for each of ${steps} steps`;
  const out: State[] = [];
  for (const [k, v] of series.entries()) {
    const s = isObject(v) ? v : {};
    const [pos, rot, linear, angular] = [numbers(s['pos'], 3), numbers(s['rot'], 4), numbers(s['linear'], 3), numbers(s['angular'], 3)];
    if (!pos || !rot || !linear || !angular) return `${what}: bodies.${id}[${k}] isn't {pos, rot, linear, angular}: ${show(v)}`;
    out.push({ pos: pos as V3, rot, linear: linear as V3, angular: angular as V3 });
  }
  return out;
}
const sameNumbers = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const sameState = (a: State, b: State): boolean => sameNumbers(a.pos, b.pos) && sameNumbers(a.rot, b.rot) && sameNumbers(a.linear, b.linear) && sameNumbers(a.angular, b.angular);
const still = (s: State): boolean => [...s.linear, ...s.angular].every((x) => x === 0);

// ---------------------------------------------------------------------------------------------------
// Judges. Each returns everything it finds wrong, as text; none asserts.

/** The first step at which two runs' step hashes differ (by position), or null when they are the same lists. */
export function firstDifference(a: readonly string[], b: readonly string[]): number | null {
  for (let k = 0; k < Math.max(a.length, b.length); k += 1) if (a[k] !== b[k]) return k;
  return null;
}
/** Everything that differs between two runs' step hashes of one world and track; the failure names the first step. */
export function sameFailures(a: readonly string[], b: readonly string[], what: string, other: string): string[] {
  const k = firstDifference(a, b);
  return k === null ? [] : [`${what}: the step hash at step ${k} is ${String(a[k])} and ${String(b[k])} ${other}`];
}

/**
 * Everything wrong with "this entry changes the world": the track without it must give the same step hashes through
 * the entry's step, the last state it leaves alone, and another after it.
 */
export function entryFailures(straight: readonly string[], without: readonly string[], e: JsonObject): string[] {
  const k = firstDifference(straight, without);
  if (k === null) return [`the ${entryText(e)} changes nothing: the track without it gives the same ${straight.length} step hashes, so a replay or a seek that ignored it would pass`];
  return k > stepOf(e) ? [] : [`the track without the ${entryText(e)} differs already at step ${k}: an entry applies at the start of its step, so the state after ${stepOf(e)} steps is the last it leaves alone`];
}

/**
 * Everything wrong with a seek to step `to` played on to the straight run's last step, against that run's hashes: it
 * didn't restore the checkpoint at step `from`, or its hash at some step isn't the straight run's; the failure names
 * the first such step.
 */
export function seekFailures(straight: readonly string[], sought: JsonObject | undefined, at: Sought, what: string): string[] {
  const hashes = sought?.['ok'] === true && Array.isArray(sought['step_hashes']) ? sought['step_hashes'] : null;
  const from = sought?.['from'];
  const last = straight.length - 1;
  if (!hashes || typeof from !== 'number' || !Number.isInteger(from)) return [`${what} didn't answer {ok: true, from, step_hashes}: ${refusal(sought)}`];
  const out: string[] = [];
  if (from !== at.from) out.push(`${what} started from step ${from}, not the checkpoint at step ${at.from}, the nearest at or before step ${at.to} with one every ${EVERY} steps`);
  if (hashes.length !== last - from + 1) out.push(`${what} holds ${hashes.length} step hashes, not one for each step from ${from} to ${last}`);
  const k = hashes.findIndex((h, i) => h !== straight[from + i]);
  if (k >= 0) out.push(`${what}: the step hash at step ${from + k} is ${String(hashes[k])} after the seek and ${String(straight[from + k])} in the straight run`);
  return out;
}

/**
 * Everything wrong with "the second `set` on one step replaces the first": the run whose track holds `first` and then
 * `second`, both stamped one step, must give the step hashes of the run whose track holds `second` alone. The failure
 * names the entries' step and the first step whose hash differs.
 */
export function replacedFailures(both: readonly string[], secondAlone: readonly string[], first: JsonObject, second: JsonObject): string[] {
  const k = firstDifference(both, secondAlone);
  if (k === null) return [];
  return [`the two sets stamped step ${stepOf(first)} (${JSON.stringify(first['data'])} written first, then ${JSON.stringify(second['data'])}): the second doesn't replace the first, the step hash at step ${k} is ${String(both[k])} and ${String(secondAlone[k])} with the second alone`];
}

/**
 * Everything wrong with "it changes the world at the step the channel or the input says": against the run without
 * that key or entry, the step hashes are the same before state `first` and differ at it, and at it the body its
 * force applies to is the one whose state differs.
 */
export function saysFailures(straight: JsonObject | undefined, without: JsonObject | undefined, s: Says, steps: number): string[] {
  const [a, b] = [hashesOf(straight, steps, 'the field'), hashesOf(without, steps, `the field without ${s.name}`)];
  if (typeof a === 'string' || typeof b === 'string') return [a, b].filter((x): x is string => typeof x === 'string');
  const k = firstDifference(a, b);
  if (k === null) return [`${s.name} changes nothing: the field without it gives the same ${a.length} step hashes`];
  if (k !== s.first) return [`${s.name} first changes the world at step ${k}, not at step ${s.first}, the step it says`];
  const [mine, theirs] = [statesOf(straight, s.body, steps, 'the field'), statesOf(without, s.body, steps, `the field without ${s.name}`)];
  if (typeof mine === 'string' || typeof theirs === 'string') return [mine, theirs].filter((x): x is string => typeof x === 'string');
  return sameState(mine[k]!, theirs[k]!) ? [`${s.name} changes the world at step ${k}, but ${s.body}, the body its force applies to, is the same there with and without it`] : [];
}

/** Everything wrong with "the blast moves this body": at rest as built through the blast's step, and somewhere else at the end. */
export function movedFailures(reply: JsonObject | undefined, id: string, step: number, steps: number, what: string): string[] {
  const states = statesOf(reply, id, steps, what);
  if (typeof states === 'string') return [states];
  const [built, last] = [states[0]!, states[steps]!];
  const early = states.findIndex((s, k) => k <= step && !(sameNumbers(s.pos, built.pos) && still(s)));
  if (early >= 0) return [`${what}: ${id} isn't at rest where it was built at step ${early}, before the blast stamped step ${step} applies`];
  return sameNumbers(last.pos, built.pos) ? [`${what}: ${id} isn't moved: after ${steps} steps it is still at ${JSON.stringify(built.pos)}, moving at ${JSON.stringify(last.linear)} m/s`] : [];
}
/** Everything wrong with "the blast leaves this body at rest": every state is its built pose with zero velocities. */
export function restFailures(reply: JsonObject | undefined, id: string, steps: number, what: string): string[] {
  const states = statesOf(reply, id, steps, what);
  if (typeof states === 'string') return [states];
  const built = states[0]!;
  const k = states.findIndex((s) => !(sameNumbers(s.pos, built.pos) && sameNumbers(s.rot, built.rot) && still(s)));
  return k < 0 ? [] : [`${what}: ${id} isn't left at rest: at step ${k} it is at ${JSON.stringify(states[k]!.pos)} moving at ${JSON.stringify(states[k]!.linear)} m/s, built at ${JSON.stringify(built.pos)}`];
}
