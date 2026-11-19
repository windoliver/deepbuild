// Test-side tools for the #2239 acceptance tests (README: The surface under test). They drive the physics runner
// `deep-physics` (JSON lines in, one reply per line) as #191's and #2309's suites do, through #191's release build, and
// add only this issue's worlds, its planted names and its judges. Nothing here stands in for the lint, the check, the
// kit or the backend: every issue, refusal, body state and assumption row read here is the implementation's own, and
// every expected value is the issue's, copied or worked here from the closed form it gives. A judge returns what is
// wrong as sentences and asserts nothing, so each test fails at an assertion in its own file.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  REFERENCE, REPO, TIMEOUT, box, isObject, obj, physicsBin, show, sphere, statesOf, use, world,
  type JsonObject, type JsonValue, type Vec3,
} from '../191/helpers.ts';

export { REFERENCE, TIMEOUT, fastBallWorld, prebuild, show, statesOf, type JsonObject } from '../191/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#2239.56aa2cc8', 2: '#2239.242f65d6', 3: '#2239.42a90e17', 4: '#2239.fdc08cd1', 5: '#2239.89f47a10', 6: '#2239.4166d996',
} as const;

/** This suite's planted names (`deep-physics --planted <name>`), each one criterion's wrong program (README). */
export type Planted =
  | 'lint_kinematic_as_dynamic' | 'wrapper_drops_body_ccd' | 'lint_reads_move_only' | 'lint_one_body_at_a_time'
  | 'lint_pair_held_by_one_ccd' | 'kit_turns_ccd_on_kinematic';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIB = 1024 * 1024;
const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------------------------------
// The runner: this checkout's release build (#191's `release`), as shipped or with one planted program.

interface Ran { status: number | null; lines: string[]; stdout: string; stderr: string }
function ran(args: string[], calls: JsonObject[], what: string): Ran {
  const run = spawnSync(physicsBin('release'), args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  return { status: run.status, lines: stdout.split('\n').filter((l) => l !== ''), stdout, stderr: run.stderr ?? '' };
}
const parsed = (r: Ran, calls: JsonObject[], what: string): JsonObject[] =>
  r.lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 120)})`));

/** Runs `calls` through one `deep-physics` process of this checkout: exit 0, one JSON reply per call, in order. */
export function physics(calls: JsonObject[]): JsonObject[] {
  const what = 'deep-physics';
  const r = ran([], calls, what);
  expect(r.status, `${what} exits 0; stdout: ${r.stdout.slice(0, 1000)}; stderr: ${r.stderr.slice(-1500)}`).toBe(0);
  expect(r.lines.length, `${what}: one reply per call; stdout: ${r.stdout.slice(0, 1000)}`).toBe(calls.length);
  return parsed(r, calls, what);
}

/** A planted program's answers: `refused` says why it gave none (a build without the name exits 2), else ''. */
export interface Twin { name: Planted; refused: string; replies: JsonObject[] }
/** Runs `calls` through one `deep-physics --planted <name>` process; asserts nothing, so the test says what it needs. */
export function planted(name: Planted, calls: JsonObject[]): Twin {
  const what = `deep-physics --planted ${name}`;
  const r = ran(['--planted', name], calls, what);
  if (r.status !== 0 || r.lines.length !== calls.length) {
    return { name, refused: `${what} exits ${r.status} with ${r.lines.length} of ${calls.length} replies; stdout: ${r.stdout.slice(0, 300) || '(none)'}; stderr: ${r.stderr.slice(-300) || '(none)'}`, replies: [] };
  }
  return { name, refused: '', replies: parsed(r, calls, what) };
}

// ---------------------------------------------------------------------------------------------------
// The worlds (README: The worlds). Every one at 120 Hz unless a test says 480, every dynamic body with gravity_scale 0.

export const RATE = 120;
export const BALL_RADIUS = 0.05;
/** The ten starts a tenth of a step apart: start j begins j tenths of one step's move farther back. */
export const STARTS = Array.from({ length: 10 }, (_, j) => j);

/** Criterion 1's fixture: a scene whose world `court` holds the kinematic `bat` on the channel `bat` and the `ball`. */
export const FIXTURE = 'parity/physics/fast-bat.scene';
export const COURT = 'court';
export const BAT = 'bat';
export const BALL = 'ball';
/** The bat: 0.02 m thick along x, 30 m/s along +x, its leading face starting 0.90 m before the ball's centre at x = 0. */
export const BAT_HALF = 0.01;
export const BAT_SPEED = 30;
export const BAT_START = -0.9 - BAT_HALF;
/** The field a `ccd` on the bat is written at, as the check's refusals name fields. */
export const BAT_CCD = `bodies/${BAT}/ccd`;

export const courtOf = (scene: JsonObject): JsonObject => obj(obj(scene['worlds'], 'the fixture\'s worlds')[COURT], `the fixture's world ${COURT}`);
const bodyOf = (w: JsonObject, id: string): JsonObject => obj(obj(w['bodies'], 'bodies')[id], `bodies.${id}`);
/** The fixture as its file holds it; with `ball` or `bat`, that body's `ccd` written. */
export function batScene(ccd: { ball?: boolean; bat?: boolean } = {}): JsonObject {
  const scene = obj(JSON.parse(readFileSync(join(HERE, 'fixtures', FIXTURE), 'utf8')) as JsonValue, FIXTURE);
  if (ccd.ball !== undefined) bodyOf(courtOf(scene), BALL)['ccd'] = ccd.ball;
  if (ccd.bat !== undefined) bodyOf(courtOf(scene), BAT)['ccd'] = ccd.bat;
  return scene;
}
/** The fixture with `w` in its world's place: a kit's expanded world put back in its scene. */
export function withCourt(scene: JsonObject, w: JsonObject): JsonObject {
  const out = clone(scene);
  obj(out['worlds'], 'the fixture\'s worlds')[COURT] = w;
  return out;
}

/** Criterion 2: the same bat as a dynamic body of 10 kg at 30 m/s with `ccd: true`, the ball 0.1 kg with `ccd` off, both of restitution 1 under `max`. */
export const BAT_MASS = 10;
export const BALL_MASS = 0.1;
/** 2 × 10 ÷ 10.1 × 30 = 59.41 m/s. */
export const LEAVE_SPEED = ((2 * BAT_MASS) / (BAT_MASS + BALL_MASS)) * BAT_SPEED;
export function dynamicBatWorld(): JsonObject {
  const w = clone(courtOf(batScene()));
  const bodies = obj(w['bodies'], 'bodies');
  const bat = bodyOf(w, BAT);
  bodies[BAT] = { kind: 'dynamic', shapes: bat['shapes'] ?? [], pose: bat['pose'] ?? {}, velocity: { linear: [BAT_SPEED, 0, 0] }, mass: BAT_MASS, gravity_scale: 0, ccd: true };
  bodies[BALL] = { ...bodyOf(w, BALL), mass: BALL_MASS, ccd: false };
  for (const material of Object.values(obj(w['contact_materials'], 'contact_materials'))) obj(material, 'a contact material')['restitution'] = 1;
  w['combine'] = { restitution: 'max' };
  return w;
}

/** Criterion 3: a dynamic bar 2 m long and 0.02 m thick turning at 720°/s about its centre, about z, with no linear velocity. */
export const BAR = 'bar';
export const BAR_HALF: Vec3 = [1, 0.01, 0.01];
export const BAR_TURN = 720;
/** Its fastest point's move in a step: its turn in the step, 6° in radians, times its farthest extent from its centre. */
export const BAR_MOVE = (BAR_TURN / RATE) * (Math.PI / 180) * Math.hypot(...BAR_HALF);
export function barWorld(ccd: boolean | undefined): JsonObject {
  const bar: JsonObject = { kind: 'dynamic', shapes: [use('bar')], pose: { pos: [0, 0, 0] }, velocity: { angular: [0, 0, BAR_TURN] }, gravity_scale: 0 };
  if (ccd !== undefined) bar['ccd'] = ccd;
  return world({ shapes: { bar: box(BAR_HALF) }, bodies: { bar } });
}

const ball = (x: number, speed: number, ccd: boolean): JsonObject =>
  ({ kind: 'dynamic', shapes: [use('ball')], pose: { pos: [x, 0, 0] }, velocity: { linear: [speed, 0, 0] }, gravity_scale: 0, ccd });

/** Criterion 4: the ball `moving` at 100 m/s along +x with `ccd: true` toward the ball `resting` at x = 0, both of radius 0.05 m. */
export const MOVING = 'moving';
export const RESTING = 'resting';
export const SHOT_SPEED = 100;
/** Start 0 is three steps and one radius before the resting ball's centre (2.55 m); each later start a tenth of a step (0.0833 m) farther back. */
export const shotStart = (j: number): number => -(3 * (SHOT_SPEED / RATE) + BALL_RADIUS + j * (SHOT_SPEED / RATE / 10));
export function shotWorld(j: number, restingCcd: boolean): JsonObject {
  return world({ shapes: { ball: sphere(BALL_RADIUS) }, bodies: { [MOVING]: ball(shotStart(j), SHOT_SPEED, true), [RESTING]: ball(0, 0, restingCcd) } });
}

/** Criterion 5: `left` at +20 m/s with `ccd: true` and `right` at −20 m/s with `ccd` off, head on, 2 m apart in start 0. */
export const LEFT = 'left';
export const RIGHT = 'right';
export const HEAD_ON_SPEED = 20;
export const HEAD_ON_GAP = 2;
export function headOnWorld(rate: number, j: number): JsonObject {
  const back = j * (HEAD_ON_SPEED / rate / 10);
  return world({
    step_rate: rate,
    shapes: { ball: sphere(BALL_RADIUS) },
    bodies: { [LEFT]: ball(-HEAD_ON_GAP / 2 - back, HEAD_ON_SPEED, true), [RIGHT]: ball(HEAD_ON_GAP / 2, -HEAD_ON_SPEED, false) },
  });
}

// ---------------------------------------------------------------------------------------------------
// The calls (the base's): `bake` and `check` of a world document or of a scene's world, and #191's `expand`, which
// this suite also asks of a scene's world (README: The surface under test).

export const bake = (w: JsonObject, steps: number): JsonObject => ({ call: 'bake', world: w, steps });
export const sceneBake = (scene: JsonObject, steps: number): JsonObject => ({ call: 'bake', scene, world: COURT, steps });
export const sceneCheck = (scene: JsonObject): JsonObject => ({ call: 'check', scene, world: COURT });
export const expand = (w: JsonObject): JsonObject => ({ call: 'expand', world: w });
export const sceneExpand = (scene: JsonObject): JsonObject => ({ call: 'expand', scene, world: COURT });

// ---------------------------------------------------------------------------------------------------
// The lint: `physics.fast_body` among the issues a bake's reply lists (#191: a playtest run bakes, and reads it there).

export const FAST_BODY = 'physics.fast_body';
export const BACKEND_CAP = 'physics.backend_cap';
const issuesIn = (v: JsonValue | undefined): JsonObject[] => (Array.isArray(v) ? v.filter(isObject) : []);
const names = (i: JsonObject, id: string): boolean => Array.isArray(i['ids']) && i['ids'].includes(id);
/** An issue's fix as text: its sentence, or its patch ops as JSON; '' when it has none. */
export function fixOf(i: JsonObject): string {
  const fix = i['fix'];
  if (typeof fix === 'string') return fix.trim();
  return fix === undefined || fix === null ? '' : JSON.stringify(fix);
}
const NAMES_CCD = /ccd/i;
/** What one issue says, for a message. */
export const told = (i: JsonObject): string =>
  show({ kind: i['kind'] ?? null, ids: i['ids'] ?? null, step: i['step'] ?? null, move: i['move'] ?? null, half_extent: i['half_extent'] ?? null, severity: i['severity'] ?? null, fix: i['fix'] ?? null });
/** What each of a bake's issues says, for a message. */
export const tolds = (issues: readonly JsonObject[]): string => `[${issues.map(told).join(', ')}]`;

/** The `physics.fast_body` issues a bake raised; a reply with no issue list was never read by the lint, which is no pass. */
export function lintOf(reply: JsonObject, what: string): { raised: JsonObject[]; unread: string[] } {
  if (reply['ok'] !== true || !Array.isArray(reply['issues'])) return { raised: [], unread: [`INCONCLUSIVE: ${what}: the bake's reply lists no issues, so the lint wasn't read: ${show(reply)}`] };
  return { raised: issuesIn(reply['issues']).filter((i) => i['code'] === FAST_BODY), unread: [] };
}
/** Everything wrong with "the lint raises nothing": each `physics.fast_body` issue the bake holds. */
export function raisedFailures(reply: JsonObject, what: string): string[] {
  const { raised, unread } = lintOf(reply, what);
  return [...unread, ...raised.map((i) => `${what}: ${FAST_BODY} raises ${told(i)}, where nothing is expected`)];
}

/** What a flagged body's issue names: the body, the step (null where the criterion names none), its fastest point's move and its half extent, in metres. */
export interface Fast { body: string; step: number | null; move: number; half: number }
export const BAT_FAST: Fast = { body: BAT, step: 1, move: BAT_SPEED / RATE, half: BAT_HALF };
export const BAR_FAST: Fast = { body: BAR, step: null, move: BAR_MOVE, half: BAR_HALF[1] };
/** The move within 1% (#191's bound on a move) and the half extent within a micron. */
function namedFailures(i: JsonObject, want: Fast, what: string): string[] {
  const out: string[] = [];
  if (!names(i, want.body)) out.push(`${want.body}: ${what}: the issue names ${show(i['ids'])}, not ${want.body}`);
  if (want.step !== null && i['step'] !== want.step) out.push(`${want.body}: ${what}: the issue names step ${show(i['step'])}, not ${want.step}`);
  const move = i['move'];
  if (typeof move !== 'number' || Math.abs(move - want.move) > 0.01 * want.move) out.push(`${want.body}: ${what}: the issue names a move of ${show(move)} m, not ${want.move.toFixed(3)} m within 1%`);
  const half = i['half_extent'];
  if (typeof half !== 'number' || Math.abs(half - want.half) > 1e-6) out.push(`${want.body}: ${what}: the issue names a half extent of ${show(half)} m, not ${want.half} m`);
  return out;
}
/** Everything wrong with "one issue of kind kinematic, naming the body, the step, its move and its half extent, with a fix that names no ccd". */
export function kinematicFailures(reply: JsonObject, want: Fast, what: string): string[] {
  const { raised, unread } = lintOf(reply, what);
  if (unread.length) return unread;
  if (raised.length !== 1) return [`${want.body}: ${what}: ${FAST_BODY} raises ${raised.length} issues, one of kind kinematic expected: ${tolds(raised)}`];
  const i = raised[0]!;
  const out: string[] = [];
  if (i['kind'] !== 'kinematic') out.push(`${want.body}: ${what}: the issue's kind is ${show(i['kind'])}, not "kinematic"`);
  out.push(...namedFailures(i, want, what));
  const fix = fixOf(i);
  if (fix === '') out.push(`${want.body}: ${what}: the issue has no fix`);
  if (NAMES_CCD.test(fix)) out.push(`${want.body}: ${what}: the issue's fix names ccd, which the backend never sweeps a kinematic body by: ${JSON.stringify(fix)}`);
  else if (fix !== '' && !fix.includes('dynamic')) out.push(`${want.body}: ${what}: the issue's fix doesn't say to make the body dynamic: ${JSON.stringify(fix)}`);
  return out;
}
/** Everything wrong with "raises physics.fast_body naming the body, its fastest point's move and its half extent": one issue, of one dynamic body. */
export function fastFailures(reply: JsonObject, want: Fast, what: string): string[] {
  const { raised, unread } = lintOf(reply, what);
  if (unread.length) return unread;
  if (raised.length !== 1) return [`${want.body}: ${what}: ${FAST_BODY} raises ${raised.length} issues, one naming ${want.body} expected: ${tolds(raised)}`];
  const i = raised[0]!;
  const out = namedFailures(i, want, what);
  if (i['kind'] === 'kinematic' || i['kind'] === 'pair') out.push(`${want.body}: ${what}: the issue's kind is ${show(i['kind'])}, for one dynamic body`);
  return out;
}

/** What a pair's fix says: to turn `ccd` off on the body `ccdOff` names, or to raise `step_rate` and never `ccd`. */
export type PairFix = { ccdOff: string } | 'step_rate';
/** Everything wrong with "one issue of kind pair naming both", a step of the run, and its fix. */
export function pairFailures(reply: JsonObject, a: string, b: string, fix: PairFix, steps: number, what: string): string[] {
  const { raised, unread } = lintOf(reply, what);
  if (unread.length) return unread;
  if (raised.length !== 1) return [`${what}: ${FAST_BODY} raises ${raised.length} issues, one of kind pair naming ${a} and ${b} expected: ${tolds(raised)}`];
  const i = raised[0]!;
  const out: string[] = [];
  if (i['kind'] !== 'pair') out.push(`${what}: the issue's kind is ${show(i['kind'])}, not "pair"`);
  if (!names(i, a) || !names(i, b)) out.push(`${what}: the issue names ${show(i['ids'])}, not both ${a} and ${b}`);
  const step = i['step'];
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 1 || step > steps) out.push(`${what}: the issue names step ${show(step)}, not a step of the run (1 to ${steps})`);
  const text = fixOf(i);
  if (text === '') out.push(`${what}: the issue has no fix`);
  else if (fix === 'step_rate') {
    if (!text.includes('step_rate')) out.push(`${what}: the issue's fix doesn't name step_rate: ${JSON.stringify(text)}`);
    if (NAMES_CCD.test(text)) out.push(`${what}: the issue's fix names ccd, which can't settle two fast bodies: ${JSON.stringify(text)}`);
  } else if (!NAMES_CCD.test(text) || !text.includes(fix.ccdOff) || !/\boff\b|\bfalse\b/i.test(text)) {
    out.push(`${what}: the issue's fix doesn't say to turn ccd off on ${fix.ccdOff} (it names ccd, ${fix.ccdOff} and off, or false): ${JSON.stringify(text)}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Motion, read from a bake's body states: index k is the state after step k, index 0 the world as built.

const m = (x: number): string => `${x.toFixed(4)} m`;
/** Each body's x after each step, for a message. */
export const xs = (reply: JsonObject, id: string, what: string): string => statesOf(reply, id, what).map((s) => s.pos[0].toFixed(3)).join(' ');

/**
 * Criterion 1: everything wrong with "the ball is still at rest after the box has passed it": the box off its channel
 * (after step k its centre is 0.25 k m along), its trailing face not beyond the ball's far side at the end, or the
 * ball anywhere but where it was built, or moving, at any step.
 */
export function passedAtRestFailures(reply: JsonObject, what: string): string[] {
  const [bat, target] = [statesOf(reply, BAT, what), statesOf(reply, BALL, what)];
  const out: string[] = [];
  const off = bat.findIndex((s, k) => Math.abs(s.pos[0] - (BAT_START + (k * BAT_SPEED) / RATE)) > 1e-4);
  if (off >= 0) out.push(`${BAT}: ${what}: after step ${off} its centre is at x = ${m(bat[off]!.pos[0])}, not on its channel at ${m(BAT_START + (off * BAT_SPEED) / RATE)}`);
  const trailing = bat.at(-1)!.pos[0] - BAT_HALF;
  if (!(trailing > BALL_RADIUS)) out.push(`${BAT}: ${what}: its trailing face ends at x = ${m(trailing)}, not past the ball's far side at ${m(BALL_RADIUS)}, so it never passed the ball`);
  const moved = target.findIndex((s) => Math.hypot(...s.pos) > 1e-6 || Math.hypot(...s.linear) > 1e-6);
  if (moved >= 0) out.push(`${BALL}: ${what}: after step ${moved} it is at x = ${m(target[moved]!.pos[0])} moving ${Math.hypot(...target[moved]!.linear).toFixed(3)} m/s, not at rest where it was built`);
  return out;
}

/** Criterion 2: the first step at whose end the ball's centre is behind the bat's leading face; −1 when at none. */
export function behindStep(reply: JsonObject, what: string): number {
  const [bat, target] = [statesOf(reply, BAT, what), statesOf(reply, BALL, what)];
  return target.findIndex((s, k) => s.pos[0] < bat[k]!.pos[0] + BAT_HALF);
}
/** Everything wrong with "the ball is never behind the bat's leading face at the end of any step", naming the ball and the first such step. */
export function behindFailures(reply: JsonObject, what: string): string[] {
  const k = behindStep(reply, what);
  if (k < 0) return [];
  const [bat, target] = [statesOf(reply, BAT, what), statesOf(reply, BALL, what)];
  return [`${BALL}: ${what}: at the end of step ${k} its centre (x = ${m(target[k]!.pos[0])}) is behind the bat's leading face (x = ${m(bat[k]!.pos[0] + BAT_HALF)}), moving ${target[k]!.linear[0].toFixed(3)} m/s`];
}
/** Everything wrong with "it leaves at 59.41 m/s within 1%": the ball's speed along +x at the end of the run. */
export function leaveFailures(reply: JsonObject, what: string): string[] {
  const v = statesOf(reply, BALL, what).at(-1)!.linear[0];
  return Math.abs(v - LEAVE_SPEED) <= 0.01 * LEAVE_SPEED ? [] : [`${BALL}: ${what}: it leaves at ${v.toFixed(3)} m/s, not ${LEAVE_SPEED.toFixed(2)} m/s within 1%`];
}

/** The first step at whose end `a`, which starts behind `b` along x, has its centre past `b`'s; −1 when at none. */
export function passStep(reply: JsonObject, a: string, b: string, what: string): number {
  const [sa, sb] = [statesOf(reply, a, what), statesOf(reply, b, what)];
  return sa.findIndex((s, k) => s.pos[0] > sb[k]!.pos[0]);
}
/** One start's outcome, for a message: whether and when `a` passed `b`, and where and how fast each ends. */
export function outcome(reply: JsonObject, a: string, b: string, what: string): string {
  const k = passStep(reply, a, b, what);
  const [ea, eb] = [statesOf(reply, a, what).at(-1)!, statesOf(reply, b, what).at(-1)!];
  return `${what}: ${a} ${k < 0 ? 'never passes' : `is past ${b} at the end of step ${k}`}; ${a} ends at x = ${m(ea.pos[0])} at ${ea.linear[0].toFixed(2)} m/s, ${b} at x = ${m(eb.pos[0])} at ${eb.linear[0].toFixed(2)} m/s`;
}

// ---------------------------------------------------------------------------------------------------
// The check's refusal by the backend's caps, and the kit's run (#191's `expand`: its world and its assumption rows).

/** The path's field names, whatever its separator or prefix (as #2009's suite reads a refusal's field). */
const segments = (path: JsonValue | undefined): string[] => (typeof path === 'string' ? path.split(/[/.]/).filter((s) => s !== '') : []);
const at = (i: JsonObject, field: string): boolean => segments(i['path']).join('/').endsWith(field);
/**
 * Everything wrong with "refused at check, naming the field and the backend": no error issue of code
 * `physics.backend_cap` at the bat's `ccd`, or one whose `actual` isn't the refused `true` or whose sentence doesn't
 * name the backend. Each failure names the field.
 */
export function capRefusalFailures(issues: JsonObject[], what: string): string[] {
  const mine = issues.filter((i) => i['severity'] === 'error' && i['code'] === BACKEND_CAP && at(i, BAT_CCD));
  if (mine.length !== 1) return [`${BAT_CCD}: ${what}: ${mine.length} error issues of code ${BACKEND_CAP} name the field, one expected; its issues: ${show(issues)}`];
  const i = mine[0]!;
  const out: string[] = [];
  if (i['actual'] !== true) out.push(`${BAT_CCD}: ${what}: the refusal's actual is ${show(i['actual'])}, not the refused true`);
  if (typeof i['what'] !== 'string' || !i['what'].includes(REFERENCE)) out.push(`${BAT_CCD}: ${what}: the refusal's sentence doesn't name the backend ${REFERENCE}: ${show(i['what'])}`);
  return out;
}
/** A check's issues of severity error. */
export const errorsOf = (reply: JsonObject): JsonObject[] => issuesIn(reply['issues']).filter((i) => i['severity'] === 'error');
/** Every issue a reply lists. */
export const issuesOf = (reply: JsonObject): JsonObject[] => issuesIn(reply['issues']);

/** A kit run's reply: the world it wrote and its assumption rows, or null where the reply holds none. */
export interface KitRun { ok: boolean; world: JsonObject | null; rows: JsonObject[] | null }
export function kitRunOf(reply: JsonObject): KitRun {
  return { ok: reply['ok'] === true, world: isObject(reply['world']) ? reply['world'] : null, rows: Array.isArray(reply['assumptions']) ? issuesIn(reply['assumptions']) : null };
}
/**
 * Everything wrong with "a kit run over the first criterion's world writes no assumption row for the box": the run
 * refused (each refusal's field named), no world or no rows in its reply, a row naming the bat, or the bat's `ccd` on.
 */
export function kitFailures(reply: JsonObject, what: string): string[] {
  const run = kitRunOf(reply);
  if (!run.ok || !run.world || !run.rows) {
    const fields = issuesOf(reply).map((i) => (typeof i['path'] === 'string' && i['path'] !== '' ? i['path'] : '(no field)')).join(', ');
    return [`${what}: the kit's run (call expand, with the scene and its world's ID) gives no world and rows${fields ? `: it is refused at ${fields}` : ''}: ${show(reply)}`];
  }
  const out = run.rows.filter((r) => r['body'] === BAT).map((r) => `${BAT}: ${what}: the kit writes an assumption row for the box: ${show(r)}`);
  const ccd = isObject(run.world['bodies']) && isObject(run.world['bodies'][BAT]) ? run.world['bodies'][BAT]['ccd'] : undefined;
  if (ccd === true) out.push(`${BAT}: ${what}: the kit's world has ccd on for the kinematic box (${BAT_CCD})`);
  return out;
}
/**
 * Everything wrong with "its playtest fails, naming the box": the playtest run of the kit's world (its bake) holds no
 * `physics.fast_body` issue of kind kinematic and severity error that names the bat.
 */
export function playtestFailures(reply: JsonObject, what: string): string[] {
  const { raised, unread } = lintOf(reply, what);
  if (unread.length) return unread;
  const failing = raised.filter((i) => i['severity'] === 'error' && i['kind'] === 'kinematic' && names(i, BAT));
  return failing.length === 1 ? [] : [`${BAT}: ${what}: ${failing.length} ${FAST_BODY} issues of kind kinematic and severity error name the box, one expected, so the playtest doesn't fail naming it; the run holds: ${tolds(raised)}`];
}
/** Everything wrong with the default turning `ccd` on for `body`: its `ccd` on in the kit's world, and exactly one assumption row, naming it. */
export function rowFailures(reply: JsonObject, body: string, what: string): string[] {
  const run = kitRunOf(reply);
  if (!run.ok || !run.world || !run.rows) return [`${body}: ${what}: the kit's run (call expand) gives no world and rows: ${show(reply)}`];
  const out: string[] = [];
  const ccd = isObject(run.world['bodies']) && isObject(run.world['bodies'][body]) ? run.world['bodies'][body]['ccd'] : undefined;
  if (ccd !== true) out.push(`${body}: ${what}: the kit's world has ccd ${show(ccd)} on it, not true`);
  if (run.rows.length !== 1) out.push(`${body}: ${what}: ${run.rows.length} assumption rows, one expected: ${show(run.rows)}`);
  const row = run.rows[0];
  if (row && row['body'] !== body) out.push(`${body}: ${what}: the row names ${show(row['body'])}, not ${body}`);
  return out;
}
/** Whether a row gives the lint as its reason, as #191's rows do. */
export const reasoned = (row: JsonObject | undefined): boolean => typeof row?.['reason'] === 'string' && row['reason'].includes(FAST_BODY);
