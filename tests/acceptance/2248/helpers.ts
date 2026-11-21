// Test-side tools for the #2248 acceptance tests (README: The surface under test). They drive what the base's physics
// suites drive and add only this issue's worlds, its scene and its judges: the physics runner `deep-physics` (JSON
// lines in, one reply per line) through #191's release build, as #2239's suite does, and `deep-show run` through
// #1918's build, scenario and calls. Nothing here stands in for the physics module, the world reader or the scene's
// evaluation: every row, value, issue and text read here is the program's own, and every expected value is the
// issue's, copied or worked here from the closed form it gives. A judge returns what is wrong as sentences and asserts
// nothing, so each test fails at an assertion in its own file.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { isObject, physics as run, show, type JsonObject, type JsonValue } from '../191/helpers.ts';
import { camera } from '../1918/helpers.ts';

export { TIMEOUT, bake, prebuild, show, statesOf } from '../191/helpers.ts';
export { evalCall, prebuildShow, runShow, scenario, showBin, showCall } from '../1918/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#2248.a0a41ad7',
  2: '#2248.7a7a91ac',
  3: '#2248.ac6cea78',
} as const;

/** Each failure on a line of its own, for a message. */
export const list = (failures: readonly string[]): string => `\n  ${failures.slice(0, 40).join('\n  ')}`;

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick) and the fall. 705,600,000 flicks a second: a 120 Hz step is 5,880,000 of them and a
// 60 fps frame 11,760,000, so frame f sits on step 2f and no frame here is between two steps.

export const G = 9.81;
const RATE = 120;
const FLICKS = 705_600_000;
const STEP = FLICKS / RATE;
export const FPS = 60;
/** A second of steps, and of frames. */
export const SECOND = RATE;
/**
 * The mean of the dropped ball's vertical velocity over the `n` steps that end at step `k`, m/s: after step j the
 * ball falls at −9.81 × j ÷ 120, so the mean over j = k − n + 1 … k is −9.81 × (k − (n − 1) ÷ 2) ÷ 120. With k = 120
 * and n = 12 this is the issue's −9.81 × 114.5 ÷ 120.
 */
export const meanFall = (k: number, n: number): number => (-G * (k - (n - 1) / 2)) / RATE;

// ---------------------------------------------------------------------------------------------------
// The runner: this checkout's release build of deep-physics (#191's `release`), through #191's own runner.

/** Runs `calls` through one `deep-physics` process: exit 0, one JSON reply per call, in order. A refused world is a reply, read by the test. */
export const physics = (calls: JsonObject[]): JsonObject[] => run(calls, { build: 'release' });

export const check = (w: JsonObject): JsonObject => ({ call: 'check', world: w });
/** A bake of the scene's world `rig`, its outputs sampled at the scene's 60 frames a second. */
export const sceneBake = (scene: JsonObject, steps: number): JsonObject => ({ call: 'bake', scene, world: RIG, steps, frame_rate: `${FPS}/1` });
/** A bake whose per-frame series has a value after every step: frame k is step k. */
export const PER_STEP = `${RATE}/1`;

/** An issue as the check words it, for a message. */
const told = (i: JsonObject): string => `${String(i['code'])} at ${String(i['path'])}: ${String(i['what'])}`;
const issuesIn = (v: JsonValue | undefined): JsonObject[] => (Array.isArray(v) ? v.filter(isObject) : []);
/** Why a bake's reply holds no run: the issues that refuse its world, or the reply itself; '' when it was baked. */
function refusalOf(reply: JsonObject | undefined): string {
  if (reply?.['ok'] === true) return '';
  const issues = issuesIn(reply?.['issues']);
  return issues.length ? issues.map(told).join('; ') : show(reply);
}

// ---------------------------------------------------------------------------------------------------
// The dropped ball (criteria 1 and 2; README: The worlds): a 1 kg sphere of radius 0.1 m released from rest 10 m up,
// with nothing under it, at 120 Hz and 4 substeps under gravity (0, −9.81, 0).

type V3 = [number, number, number];
const MATERIALS: JsonObject = { rubber: { friction: 0.5, restitution: 0, density: 1000 } };
const use = (shape: string): JsonObject => ({ shape, contact_material: 'rubber' });
function world(parts: JsonObject): JsonObject {
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: RATE, substeps: 4, gravity: [0, -G, 0], seed: 2248, mode: 'dynamic',
    capacity: { bodies: 8, shapes: 8, joints: 4, contacts: 32, particles: 0 },
    backend: { name: 'rapier3d', version: '=0.36.1' },
    contact_materials: MATERIALS,
    ...parts,
  };
}
export const BALL = 'ball';
export const MASS = 1;
const ball = (pos: V3): JsonObject => ({ kind: 'dynamic', shapes: [use('ball')], pose: { pos }, mass: MASS });
/** The dropped ball's world with `outputs`. */
export const dropWorld = (outputs: JsonObject): JsonObject =>
  world({ shapes: { ball: { kind: 'sphere', radius: 0.1 } }, bodies: { [BALL]: ball([0, 10, 0]) }, outputs });

/** Criterion 1's output, as the issue writes it, under the ID `fall`; `keep` adds the issue's `keep: 0.5 s`. */
export const FALL = 'fall';
export const SAMPLE = 12;
export const fallOutput = (keep?: string): JsonObject => ({ from: BALL, read: 'velocity', sample: SAMPLE, average: SAMPLE, ...(keep === undefined ? {} : { keep }) });
export const KEEP = '0.5s';
/** `keep`'s half second, in steps. */
const KEEP_STEPS = RATE / 2;

/** Criterion 2's output, under the ID `ke`: the issue's `expr` over the reads `v`, the ball's speed, and `m`, its mass, with `unit: J`. */
export const KE = 'ke';
export const EXPR = '0.5 * m * v * v';
export const keOutput = (): JsonObject => ({ expr: EXPR, reads: { v: { from: BALL, read: 'speed' }, m: { from: BALL, read: 'mass' } }, unit: 'J' });
/** The same `expr` and `unit` on an output that declares no read, so the `expr` names none. */
export const keOutputWithoutReads = (): JsonObject => ({ expr: EXPR, unit: 'J' });

// ---------------------------------------------------------------------------------------------------
// A bake's `outputs.series` (README: Series)

/** Output `id`'s series in a bake's reply, as the reply holds it. */
const seriesIn = (reply: JsonObject | undefined, id: string): JsonValue | undefined => {
  const outputs = reply?.['outputs'];
  const series = isObject(outputs) ? outputs['series'] : undefined;
  return isObject(series) ? series[id] : undefined;
};
const finite = (x: JsonValue | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/** A row of a sampled output's series: the time its sample ends at, in flicks, and the read's value there. */
export interface Row { t: number; v: number[] }
/** The rows of output `id`'s series in a bake, each `{t, v: [x, y, z]}`, with everything that keeps them from being read. */
export function rowsOf(reply: JsonObject | undefined, id: string, what: string): { rows: Row[]; problems: string[] } {
  const refused = refusalOf(reply);
  if (refused !== '') return { rows: [], problems: [`${what} is refused, not baked: ${refused}`] };
  const series = seriesIn(reply, id);
  if (!Array.isArray(series)) return { rows: [], problems: [`${what}: outputs.series.${id} is ${show(series)}, not a list of rows`] };
  const rows: Row[] = [];
  const problems: string[] = [];
  series.forEach((r, i) => {
    const [t, v] = isObject(r) ? [r['t'], r['v']] : [undefined, undefined];
    if (Number.isSafeInteger(t) && Array.isArray(v) && v.length === 3 && v.every(finite)) rows.push({ t: t as number, v: v as number[] });
    else problems.push(`${what}: outputs.series.${id}[${i}] is ${show(r)}, not a row {t: flicks, v: [x, y, z]}`);
  });
  return { rows, problems };
}
/** The step each row's sample ends at: its time over a step's 5,880,000 flicks. */
export const stepsOf = (rows: readonly Row[]): number[] => rows.map((r) => r.t / STEP);
/** Every `n`th step from `from` to `to`, both included. */
export const everyNth = (n: number, from: number, to: number): number[] => Array.from({ length: Math.floor((to - from) / n) + 1 }, (_, i) => from + i * n);
/** How a row reads, for a message. */
export const rowText = (r: Row): string => `${(r.t / FLICKS).toFixed(3)} s: ${r.v[1]!.toFixed(4)} m/s`;

/**
 * Everything wrong with "each the mean of the ball's vertical velocity over the 12 steps that end at it": a row that
 * isn't at a whole step in time order, or whose vertical part isn't the closed form's mean within 0.1%.
 */
export function meanFailures(rows: readonly Row[], what: string): string[] {
  const out: string[] = [];
  rows.forEach((r, i) => {
    const k = r.t / STEP;
    if (!Number.isInteger(k) || k < 1) { out.push(`${what}: row ${i} is at ${r.t} flicks, not at the end of a step`); return; }
    if (i > 0 && r.t <= rows[i - 1]!.t) out.push(`${what}: row ${i} (${rowText(r)}) is not after row ${i - 1} (${rowText(rows[i - 1]!)})`);
    const want = meanFall(k, SAMPLE);
    if (Math.abs(r.v[1]! - want) > 0.001 * Math.abs(want)) out.push(`${what}: the row at ${(r.t / FLICKS).toFixed(1)} s reads ${r.v[1]} m/s, not the mean over the ${SAMPLE} steps that end at step ${k}, ${want.toFixed(4)} m/s within 0.1%`);
  });
  return out;
}
/**
 * Everything wrong with "holds only the samples of the last 0.5 s" of a series read at step `end`: a sample of the
 * last half second it lacks, or a row that is none of them. The sample exactly half a second back sits on the edge,
 * and is neither required nor refused (README: Readings).
 */
export function keptFailures(rows: readonly Row[], end: number, what: string): string[] {
  const steps = stepsOf(rows);
  const edge = end - KEEP_STEPS;
  const within = everyNth(SAMPLE, edge + SAMPLE, end);
  const out: string[] = [];
  for (const k of within) if (!steps.includes(k)) out.push(`${what}: the sample at ${(k / RATE).toFixed(1)} s, within the last 0.5 s, is missing`);
  for (const k of steps) if (k !== edge && !within.includes(k)) out.push(`${what}: it holds a row at ${(k / RATE).toFixed(3)} s, no sample of the last 0.5 s (${(edge / RATE).toFixed(1)} s to ${(end / RATE).toFixed(1)} s)`);
  return out;
}

/** The numbers of output `id`'s per-frame series in a bake, with everything that keeps them from being read. */
export function numbersOf(reply: JsonObject | undefined, id: string, what: string): { values: number[]; problems: string[] } {
  const refused = refusalOf(reply);
  if (refused !== '') return { values: [], problems: [`${what} is refused, not baked: ${refused}`] };
  const series = seriesIn(reply, id);
  if (!Array.isArray(series)) return { values: [], problems: [`${what}: outputs.series.${id} is ${show(series)}, not a list of one number a frame`] };
  const bad = series.findIndex((x) => !finite(x));
  if (bad >= 0) return { values: [], problems: [`${what}: outputs.series.${id}[${bad}] is ${show(series[bad])}, not a number`] };
  return { values: series as number[], problems: [] };
}

// ---------------------------------------------------------------------------------------------------
// A check's issues (canvas primitives: What holds a document to its rules)

/** A check's error issues; a reply that lists none was never checked, which is no pass. */
export function errorsOf(reply: JsonObject | undefined, what: string): { errors: JsonObject[]; unread: string[] } {
  if (reply?.['ok'] !== true || !Array.isArray(reply['issues'])) return { errors: [], unread: [`INCONCLUSIVE: ${what}: the check's reply lists no issues, so the world wasn't checked: ${show(reply)}`] };
  return { errors: issuesIn(reply['issues']).filter((i) => i['severity'] === 'error'), unread: [] };
}
export const tolds = (issues: readonly JsonObject[]): string[] => issues.map(told);
/** Whether an issue names output `id`: its `path` is the output's (`outputs/<id>`) or a field of it, or its `ids` hold it. */
export function namesOutput(i: JsonObject, id: string): boolean {
  const path = typeof i['path'] === 'string' ? i['path'].split('/').filter((s) => s !== '') : [];
  return (path[0] === 'outputs' && path[1] === id) || (Array.isArray(i['ids']) && i['ids'].includes(id));
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3's scene (README: The scene): a 1 s scene at 60 frames a second listing the world `rig`.

const RIG = 'rig';
const HINGE = 'hinge';
export const TURN = 'turn';
export const DIAL_AT = 'items/dial/at/rot/2';
const READOUT = 'vy';
/** The readout's template: one slot, the vertical part (index 1 of `[x, y, z]`) of the value the output writes to it (README: The readout). */
const READOUT_TEMPLATE = '{value/1}';
/** What the readout shows at a frame, as `eval`'s `paths` read it (README: The readout). */
export const READOUT_TEXT = `items/${READOUT}/params/text`;
/** The motor's target, deg/s. */
const MOTOR_RATE = 90;

const painted = (size: V3, at: JsonObject): JsonObject => ({ kind: 'mark.box@1', params: { size, paint: { fill: { role: 'accent' } } }, at });
/**
 * The scene. Its world `rig` holds `wheel`, a 1 kg plate with no gravity on the hinge `hinge` to the world about +z,
 * whose velocity motor turns it at 90°/s, and `ball`, the 1 kg ball dropped from rest. `written` picks the outputs
 * the world writes: `turn`, the criterion's `{from: hinge, read: joint_coordinate, to: items/dial/at/rot/2}`, and
 * `fall`, the ball's velocity to the readout `vy`. Its items: the dial, a box whose rotation about z `turn` writes,
 * and with `fall` the readout, whose template shows the vertical part of the value written to it.
 */
export function rigScene(written: readonly ('turn' | 'fall')[]): JsonObject {
  const outputs: JsonObject = {
    ...(written.includes('turn') ? { [TURN]: { from: HINGE, read: 'joint_coordinate', to: DIAL_AT } } : {}),
    ...(written.includes('fall') ? { [FALL]: { from: BALL, read: 'velocity', to: READOUT } } : {}),
  };
  const rig = world({
    shapes: { ball: { kind: 'sphere', radius: 0.1 }, plate: { kind: 'box', half: [0.3, 0.3, 0.05] } },
    bodies: {
      wheel: { kind: 'dynamic', shapes: [use('plate')], pose: { pos: [0, 3, 0] }, mass: 1, gravity_scale: 0, sleep: false },
      [BALL]: ball([3, 8, 0]),
    },
    joints: {
      [HINGE]: {
        kind: 'hinge', a: 'world', b: 'wheel', frame_a: { anchor: [0, 3, 0], axis: [0, 0, 1] }, frame_b: { anchor: [0, 0, 0], axis: [0, 0, 1] },
        motor: { mode: 'velocity', target: MOTOR_RATE, max_torque: 1000, hz: 60, damping_ratio: 1 },
      },
    },
    outputs,
  });
  const items: Record<string, JsonObject> = {
    cam: camera([0, 4, 14], [0, 4, 0]),
    dial: painted([0.6, 0.1, 0.1], { pos: [-2, 3, 0], rot: [0, 0, 0] }),
    ...(written.includes('fall') ? { [READOUT]: { kind: 'overlay.text@1', params: { anchor: 'corner', role: 'readout', template: READOUT_TEMPLATE } } } : {}),
  };
  const withIds: JsonObject = {};
  Object.entries(items).forEach(([id, item], i) => { withIds[id] = { id, name: id, order: `a${String(i).padStart(3, '0')}`, ...item }; });
  return {
    format: 1, profile: 'scene', title: 'A dial and a readout', description: 'A hinge motor turns a dial and a falling ball fills a readout: a #2248 acceptance fixture.',
    size: [640, 360], camera: 'cam', transport: { span: '1s', frame_rate: [FPS, 1] }, requires: { modules: { scene3d: '^1' } },
    worlds: { [RIG]: rig }, items: withIds,
  };
}

/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB2248D0${String(n).padStart(16, '0')}`;
/** A fresh folder per call (an evidence store), deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2248-')); made.push(d); return d; };
}

/** Why a `deep_show` reply didn't present its document: its issues, each code at its path with what it holds; '' when it did. */
export function unpresented(reply: JsonObject | undefined): string {
  if (reply?.['outcome'] === 'presented') return '';
  const issues = issuesIn(reply?.['issues']);
  return issues.length ? issues.map((i) => `${String(i['code'])} at ${String(i['path'])}: ${show(i['actual'] ?? i['what'] ?? null)}`).join('; ') : show(reply);
}
/** The value `eval` read at `path` in one frame's reply; undefined when the frame wasn't evaluated or holds no such value. */
export function valueAt(reply: JsonObject | undefined, path: string): JsonValue | undefined {
  if (reply?.['outcome'] !== 'evaluated' || !isObject(reply['values'])) return undefined;
  return reply['values'][path];
}
/** The number a readout's text shows: the one number in it; null when the text holds none or more than one, or a slot left unfilled. */
export function shownNumber(text: JsonValue | undefined): number | null {
  if (typeof text !== 'string' || /[{}]/.test(text)) return null;
  const found = text.replace(/\u2212/g, '-').match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? [];
  return found.length === 1 ? Number(found[0]) : null;
}
