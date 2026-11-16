// Test-side tools for the #456 acceptance tests: `deep-show` built with the `full` feature set and driven by JSON
// lines (#393's `deep-show run`, its `deep_show` with a `patch`, `render_back` with probes, `read`, `ask` and
// `messages`; #96's stored documents and writers; #403's claims, requirements, `verdict` and `answer`; #387's
// `planted`), plus the one scenario field this suite adds, `review_model`, the stub model render.review calls (README:
// Surfaces this suite assumes). The fixtures the criteria name are generated here so every test judges the same
// documents. Nothing here stands in for a check: every value a test compares comes from the binary, every expected
// value from the issue's text and the design. Parts are copied from #1941's helpers, since suites don't import each
// other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/456 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const CARGO_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A planted wrong program must be caught: the same judgement lists at least one failure under it. */
export function caught(failures: readonly string[], planted: string, what: string): void {
  expect(failures.length, `under the planted ${planted}, ${what} must fail, and nothing failed`).toBeGreaterThan(0);
  console.log(`caught ${planted}: ${failures[0]}`);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A 3D revision is drawn, and its pixels read, on macOS's Metal device; deep-show has no software 3D rasteriser. */
export function requireMetal(what: string): void {
  if (process.platform !== 'darwin') inconclusive(`${what} draws a 3D revision on macOS's Metal device; this is ${process.platform}`);
}

/** Two JSON values equal, object keys in any order. */
export function same(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  }
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return false;
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
  }
  return a === b;
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with `full`, copied out of target/.

/** Builds once, before the file's tests. A test whose build failed fails with cargo's error; without cargo it can't decide. */
export function useBuild(): () => string {
  let dir = '';
  let made: { bin: string; error: string; ran: boolean } | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-456-bin-'));
    const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) { made = { bin: '', error: `cargo could not run: ${r.error.message}`, ran: false }; return; }
    if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
      made = { bin: '', error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`, ran: true };
      return;
    }
    const bin = join(dir, SHOW);
    copyFileSync(join(TARGET, 'debug', SHOW), bin);
    made = { bin, error: '', ran: true };
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    if (!made) throw Error('the build never ran');
    if (!made.ran) inconclusive(made.error);
    expect(made.error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return made.bin;
  };
}

/** Fresh folders for a test (evidence stores), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-456-')); made.push(d); return d; };
}

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** The bytes the evidence store keeps under `sha`, or null. */
export function readEvidence(root: string, sha: string): Buffer | null {
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  const path = join(root, sha.slice(0, 2), sha.slice(2));
  return existsSync(path) ? readFileSync(path) : null;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const label = `${SHOW} run${scenario['planted'] ? ` (planted ${String(scenario['planted'])})` : ''}`;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${label}: ${r.error.message}`);
  expect(timedOut, `${label} finished within its timeout`).toBe(false);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${label}: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${label}: the answer`);
  expect(out['ok'], `${label} refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${label}: replies`).map((v, i) => obj(v, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(arr(scenario['calls'], 'the calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The world a scenario holds: the working agent alpha, you, the process table, one panel, and stored documents.

export const ALPHA = 'sess-alpha';
const ALPHA_THREAD = 'thread-alpha';
/** The OS process table the peer check reads: alpha, and `deep show` that you ran from your own shell. */
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 }, // your terminal
  { pid: 3001, ppid: 3000, start: 110 }, // your shell
  { pid: 3002, ppid: 3001, start: 3_000 }, // `deep show` you ran
  { pid: 4100, ppid: 3001, start: 1_000 }, // agent alpha
];
const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB0456D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB0456C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB0456Q', n)}`;
export const patchId = (n: number): string => ulid('01JB0456P', n);
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };

/** The brief every claim here carries (#407's `brief: {goal}`): what render.review judges the look against. */
export const GOAL = 'A quiet still of keepsakes hung in a grid in front of a pale sky, the lantern kept in the shot behind its wall.';

/** Alpha's claim on one deliverable: its locked definition's requirements `[ID, check input]`, and the brief. */
export const claimOf = (doc: string, requirements: readonly (readonly [string, JsonObject])[]): JsonObject =>
  ({ session: ALPHA, deliverables: [doc], requirements: requirements.map(([id, check]) => ({ id, check })), brief: { goal: GOAL } });

/** One reply of the stub model, as the model answers (README: The stub model). */
export type Reply = JsonObject;
/** What a scenario may add: a planted program by name (#387), the stub model render.review calls, alpha's session's name. */
export interface Extra { planted?: string; replies?: readonly Reply[]; sessionName?: string }
/** The stub model's name, which the reading records as the model that made it. */
export const MODEL = 'stub:456';

/** The scenario: each stored document opened as revision 0 on the panel, the claims, the calls, and the extras. */
export function scenarioOf(evidence: string, docs: Record<string, JsonObject>, claims: JsonObject, calls: JsonObject[], extra: Extra = {}): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA]: { thread: ALPHA_THREAD, name: extra.sessionName ?? 'Claude Code: the review', process: { pid: 4100, start: 1_000 } } },
    processes: PROCESSES, panels: PANELS,
    docs: Object.fromEntries(Object.entries(docs).map(([d, document]) => [d, { panel: 'main', document }])),
    claims,
    ...(extra.planted ? { planted: extra.planted } : {}),
    ...(extra.replies ? { review_model: { name: MODEL, replies: [...extra.replies] } } : {}),
    calls,
  };
}

// The calls.
export const verdict = (claim: string): JsonObject => ({ call: 'verdict', claim });
/** Alpha's patch through `deep_show` (Patch: `{patch, doc, base, reason, ops}`). */
export const patch = (doc: string, id: string, base: number, ops: readonly JsonObject[], reason: string): JsonObject =>
  ({ call: 'deep_show', session: ALPHA, doc, patch: { patch: id, doc, base, reason, ops: [...ops] } });
/** A set of an item's place (`at.pos`), as a patch op. */
export const moveTo = (id: string, pos: readonly number[]): JsonObject => ({ op: 'set', id, path: `items/${id}/at/pos`, value: [...pos] });
/** The current revision as the hub shows it: `{rev, hash, document, …}`. */
export const read = (doc: string): JsonObject => ({ call: 'read', doc });
/** Render-back of revision `rev` for alpha's session at t = 0 and the document's size, with pixel probes when given. */
export const renderBack = (doc: string, rev: number, probes?: readonly (readonly [number, number])[]): JsonObject =>
  ({ call: 'render_back', session: ALPHA, doc, rev, t: 0, size: [...SIZE], ...(probes ? { probes: probes.map((p) => [...p]) } : {}) });
/** Your answer to the ask open on a claim's requirement (#403's `answer`), from your own shell. */
export const answer = (claim: string, requirement: string, yes: boolean): JsonObject =>
  ({ call: 'answer', peer: YOU_PEER, claim, requirement, answer: yes ? 'yes' : 'no' });
/** Your words to alpha's session about the panel, pointing at it (#393's point-and-ask), and alpha's messages. */
export const askAlpha = (words: string): JsonObject => ({ call: 'ask', panel: 'main', session: ALPHA, words, pointer: [640, 360] });
export const messages = (): JsonObject => ({ call: 'messages', session: ALPHA });

// ---------------------------------------------------------------------------------------------------
// render.review: its check input, its row, and its reading (README: Surfaces this suite assumes)

/** render.review's closed observe list (Check input: loop kinds: ID view and observations). */
export const OBSERVE = ['exposure_tone', 'color_cast', 'crushed_shadows', 'clipped_highlights', 'missing_item', 'extra_item', 'wrong_material', 'framing', 'other'] as const;
/** render.review's check input: the three asks the design lists, its kept items (README: `keep`), and `grounding` when given (its default is `ids`). */
export const review = (grounding?: 'ids' | 'none', keep: readonly string[] = KEPT): JsonObject =>
  ({ kind: 'render.review', asks: ['matches_brief', 'reads_as_modeled', 'mood'], keep: [...keep], ...(grounding ? { grounding } : {}) });

/** A stub reply that finds nothing: every ask answered yes. */
export const QUIET: Reply = { answers: { matches_brief: 'yes', reads_as_modeled: 'yes', mood: 'yes' }, observations: [], findings: [] };
/** A stub reply that tries to pass: every ask answered yes, nothing found, and a claimed PASS nothing may read. */
export const TRIES_TO_PASS: Reply = { result: 'PASS', pass: true, answers: { matches_brief: 'yes', reads_as_modeled: 'yes', mood: 'yes' }, observations: [], findings: [] };
/** A stub reply that doubts the brief, with `observations` as given. */
export const doubts = (observations: JsonObject[] = []): Reply =>
  ({ answers: { matches_brief: 'no', reads_as_modeled: 'yes', mood: 'unsure' }, observations, findings: [] });

/** One requirement's row in a verdict. */
export interface Row { id: string; result: string; blocked: JsonObject[]; asks: JsonObject[]; raw: JsonObject }
export function rowOf(v: JsonObject, req: string, what: string): Row {
  const rows = arr(v['requirements'], `${what}: the verdict's requirements`).filter(isObject);
  const raw = rows.find((r) => r['id'] === req);
  expect(raw, `${what}: the verdict has a row for ${req}: ${brief(v)}`).toBeDefined();
  const r = raw!;
  return {
    id: req, result: String(r['result']), raw: r,
    blocked: Array.isArray(r['blocked']) ? r['blocked'].filter(isObject) : [],
    asks: Array.isArray(r['asks']) ? r['asks'].filter(isObject) : [],
  };
}
/** A 3D row this machine couldn't draw for (no GPU): the test can't decide here, so it fails INCONCLUSIVE, never passes. */
export function gpuGate(row: Row, what: string): void {
  const gpu = row.blocked.map((b) => String(b['code'])).find((c) => c === 'gpu_unavailable' || c === 'unsupported_platform' || c === 'software_adapter');
  if (row.result !== 'PASS' && row.result !== 'FAIL' && gpu) inconclusive(`${what} is ${row.result} with ${gpu}: this machine has no GPU to draw on`);
}

/** A row's reading (`row.reading`), or why there is none. */
export function readingOf(row: Row, what: string): JsonObject {
  gpuGate(row, what);
  const r = row.raw['reading'];
  expect(isObject(r), `${what}: the render.review row carries its reading as \`reading\`; the row is ${brief(row.raw, 2000)}`).toBe(true);
  return r as JsonObject;
}
/** A list field of a reading, its entries objects. */
export function listOf(reading: JsonObject, field: string, what: string): JsonObject[] {
  return arr(reading[field], `${what}: reading.${field}`).map((x, i) => obj(x, `${what}: reading.${field}[${i}]`));
}

/** One number of an ID view: `{n, id, kind, material, at: [x, y] | null}`. */
export interface IdNumber { n: number; id: string; kind: string; material: string; at: [number, number] | null }
/** The ID view beside snapshot `k`: its PNG's hash and size, and its numbers. */
export interface IdView { sha256: string; w: number; h: number; numbers: IdNumber[] }
export function idViewOf(reading: JsonObject, what: string, k = 0): IdView {
  const views = listOf(reading, 'id_views', what);
  expect(views.length, `${what}: an ID view beside each snapshot`).toBe(listOf(reading, 'snapshots', what).length);
  const v = views[k]!;
  const numbers = arr(v['numbers'], `${what}: id_views[${k}].numbers`).map((x, i) => {
    const o = obj(x, `${what}: id_views[${k}].numbers[${i}]`);
    const at = o['at'];
    const mark = Array.isArray(at) && at.length === 2 && at.every((c) => typeof c === 'number') ? [at[0] as number, at[1] as number] as [number, number] : null;
    expect(at === null || mark !== null, `${what}: id_views[${k}].numbers[${i}].at is [x, y] or null: ${brief(o)}`).toBe(true);
    return { n: Number(o['n']), id: String(o['id']), kind: String(o['kind']), material: String(o['material']), at: mark };
  });
  return { sha256: String(v['sha256']), w: Number(v['w']), h: Number(v['h']), numbers };
}

/** The number the ID view gives item `id`, failing the test when it lists none. */
export function numberOf(view: IdView, id: string, what: string): number {
  const found = view.numbers.find((x) => x.id === id);
  expect(found, `${what}: the ID view numbers ${id}: ${brief(view.numbers as unknown as JsonValue)}`).toBeDefined();
  return found!.n;
}

/** An ask, listed again: the same `id` where both carry one, else the same JSON. */
export const sameAsk = (a: JsonObject, b: JsonObject): boolean =>
  typeof a['id'] === 'string' && typeof b['id'] === 'string' ? a['id'] === b['id'] : same(a, b);
export function distinctAsks(...lists: JsonObject[][]): JsonObject[] {
  const out: JsonObject[] = [];
  for (const a of lists.flat()) if (!out.some((b) => sameAsk(a, b))) out.push(a);
  return out;
}
/** Every ask a verdict carries: its own list and its rows'. */
export function asksOf(v: JsonObject): JsonObject[] {
  const own = Array.isArray(v['asks']) ? v['asks'].filter(isObject) : [];
  const rows = Array.isArray(v['requirements']) ? v['requirements'].filter(isObject) : [];
  return distinctAsks(own, rows.flatMap((r) => (Array.isArray(r['asks']) ? r['asks'].filter(isObject) : [])));
}
/** The taste asks a verdict carries: `kind: taste`. */
export const tasteAsks = (v: JsonObject): JsonObject[] => asksOf(v).filter((a) => a['kind'] === 'taste');

/** A `read` reply's revision: its number and hash. */
export function shown(reply: JsonObject, what: string): { rev: number; hash: string } {
  expect(typeof reply['rev'], `${what}: rev`).toBe('number');
  expect(typeof reply['hash'], `${what}: hash`).toBe('string');
  return { rev: reply['rev'] as number, hash: reply['hash'] as string };
}

// ---------------------------------------------------------------------------------------------------
// Fixtures (README: Fixtures). Metres, +Y up; px y down.

type V3 = [number, number, number];
const LAYER = 'alpha-main';
/** The frame every fixture is drawn at, px. */
export const SIZE: [number, number] = [320, 240];
/** A document as the hub stores it (#96): alpha's writer layer, each item given its ID, name, draw order and layer. */
function stored(title: string, items: Record<string, JsonObject>): JsonObject {
  const out: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, layer: LAYER, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a render.review fixture.`,
    layers: { [LAYER]: { writer: `agent:${ALPHA_THREAD}`, title: 'Claude Code: the review', order: 'a0' } },
    size: [...SIZE], camera: 'cam', requires: { modules: { scene3d: '^1' } }, items: out,
  };
}
/** A perspective camera@1 at `position` looking at `target`, 40° across the wider side. */
const camera = (position: V3, target: V3): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov: 40, near: 0.1, far: 200 } });
/** A sun of π lx from the front left and above, and a pale sky with a little ambient light. */
const SUN: JsonObject = { kind: 'light.sun@1', params: { illuminance: Math.PI, shadow: true }, at: { rot: [-45, 20, 0] } };
const SKY: JsonObject = { kind: 'sky@1', params: { top: [0.55, 0.62, 0.72, 1], low: [0.85, 0.85, 0.82, 1], ambient_top: [0.1, 0.1, 0.1], ambient_low: [0.05, 0.05, 0.05] } };
/** A rough, non-metal material of linear `color`. */
const matte = (color: V3): JsonObject => ({ kind: 'material@1', params: { base_color: [...color, 1], roughness: 1, metallic: 0 } });
const box = (size: V3, pos: V3, material: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material });
const ball = (d: number, pos: V3, material: string): JsonObject => ({ kind: 'mark.sphere@1', params: { size: [d, d, d] }, at: { pos }, material });

// ---- The review room: twelve items, one of them a kept lantern hidden behind a wall (criteria 1 to 5 and 7)

/** The kept item no pixel shows: a 0.5 m sphere 1.2 m behind the wall. */
export const HIDDEN = 'lantern';
export const WALL = 'wall';
/** One item of the review room as the ID view must resolve its number: its ID, kind and material. */
export interface Thing { id: string; kind: string; material: string }
const COLUMNS = [-1.95, -0.65, 0.65, 1.95];
const ROWS = [1.3, 0, -1.3];
/** The eleven items that show, row by row, left to right, each 0.9 m across in a cell of a 4 × 3 grid 1.3 m apart; the last cell holds the wall. */
const SHOWING: readonly (readonly [string, 'box' | 'ball', V3])[] = [
  ['crate', 'box', [0.45, 0.22, 0.12]], ['globe', 'ball', [0.15, 0.3, 0.45]], ['chest', 'box', [0.5, 0.35, 0.1]], ['melon', 'ball', [0.2, 0.4, 0.15]],
  ['stool', 'box', [0.35, 0.3, 0.28]], ['pearl', 'ball', [0.42, 0.4, 0.38]], ['block', 'box', [0.3, 0.18, 0.4]], ['orb', 'ball', [0.45, 0.15, 0.2]],
  ['brick', 'box', [0.5, 0.2, 0.15]], ['bead', 'ball', [0.25, 0.25, 0.45]],
];
/** The twelve items the ID view numbers: the ten above, the wall and the hidden lantern. */
export const ROOM: readonly Thing[] = [
  ...SHOWING.map(([id, shape]) => ({ id, kind: shape === 'box' ? 'mark.box@1' : 'mark.sphere@1', material: `${id}-mat` })),
  { id: WALL, kind: 'mark.box@1', material: 'wall-mat' },
  { id: HIDDEN, kind: 'mark.sphere@1', material: 'lantern-mat' },
];
/** The items render.review keeps (its `keep`): the globe, which shows, and the lantern, which doesn't. */
export const KEPT = ['globe', HIDDEN] as const;
/** The review room: a camera 8 m out on the grid's axis, the ten items, a 1.25 m wall 0.6 m in front of the last cell and the lantern 0.6 m behind it. */
export function reviewRoom(): JsonObject {
  const items: Record<string, JsonObject> = { cam: camera([0, 0, 8], [0, 0, 0]), sun: SUN, sky: SKY };
  SHOWING.forEach(([id, shape, color], k) => {
    const pos: V3 = [COLUMNS[k % 4]!, ROWS[Math.floor(k / 4)]!, 0];
    items[`${id}-mat`] = matte(color);
    items[id] = shape === 'box' ? box([0.9, 0.9, 0.9], pos, `${id}-mat`) : ball(0.9, pos, `${id}-mat`);
  });
  const last: [number, number] = [COLUMNS[3]!, ROWS[2]!];
  items['wall-mat'] = matte([0.35, 0.33, 0.3]);
  items[WALL] = box([1.25, 1.25, 0.2], [last[0], last[1], 0.6], 'wall-mat');
  items['lantern-mat'] = matte([0.6, 0.45, 0.15]);
  items[HIDDEN] = ball(0.5, [last[0], last[1], -0.6], 'lantern-mat');
  return stored('Keepsakes in a grid', items);
}

/** The review room's document, claim and render.review requirement in every test that reviews it. */
export const [ROOM_DOC, ROOM_CLAIM, ROOM_REVIEW] = [docId(1), claimId(1), reqId(1)];
/** A claim of alpha's on the review room whose one requirement is render.review (`grounding` when given). */
export const roomClaim = (grounding?: 'ids' | 'none'): JsonObject => ({ [ROOM_CLAIM]: claimOf(ROOM_DOC, [[ROOM_REVIEW, review(grounding)]]) });
/** The review room's ID view at revision 0, from a run whose model finds nothing: the numbers a later stub reply names items by. */
export function roomView(bin: string, evidence: string): IdView {
  const [v] = run(bin, scenarioOf(evidence, { [ROOM_DOC]: reviewRoom() }, roomClaim(), [verdict(ROOM_CLAIM)], { replies: [QUIET] }));
  return idViewOf(readingOf(rowOf(v!, ROOM_REVIEW, 'render.review of the review room'), 'render.review of the review room'), 'render.review of the review room');
}

// ---- Five crates, each cut by the frame at revision 0 (criterion 6)

export const CRATES = ['crate-a', 'crate-b', 'crate-c', 'crate-d', 'crate-e'] as const;
/** Where each crate is at revision 0, every one partly outside the frame, and where a fix puts one whole in it. */
export const CRATE_AT: Record<(typeof CRATES)[number], { cut: V3; whole: V3 }> = {
  'crate-a': { cut: [-2.3, 0.6, 0], whole: [-0.9, 0.3, 0] },
  'crate-b': { cut: [2.3, 0.6, 0], whole: [0.9, 0.3, 0] },
  'crate-c': { cut: [0, 1.85, 0], whole: [0.6, -0.4, 0] },
  'crate-d': { cut: [-2.3, -1.0, 0], whole: [-0.6, -0.4, 0] },
  'crate-e': { cut: [2.3, -1.0, 0], whole: [0.9, -0.4, 0] },
};
/** Five 1 m crates seen by a level camera 6 m out, each cut by an edge of the frame. */
export function fiveCrates(): JsonObject {
  const items: Record<string, JsonObject> = { cam: camera([0, 0, 6], [0, 0, 0]), sun: SUN, sky: SKY, 'crate-mat': matte([0.45, 0.25, 0.12]) };
  for (const c of CRATES) items[c] = box([1, 1, 1], CRATE_AT[c].cut, 'crate-mat');
  return stored('Five crates', items);
}
/** The check that measures whether a crate is whole in the frame: camera.framing keeping it. */
export const framingOf = (crate: string): JsonObject => ({ kind: 'camera.framing', keep: [crate] });

// ---------------------------------------------------------------------------------------------------
// PNG: a decoder for the 8-bit, non-interlaced PNGs render-back writes (RGBA or RGB), to compare pixels

export interface Pixels { w: number; h: number; rgba: Buffer }
/** A PNG's pixels as 8-bit RGBA, or why it can't be decoded. */
export function decodePng(bytes: Uint8Array): Pixels | string {
  const b = Buffer.from(bytes);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (b.length < 33 || !b.subarray(0, 8).equals(signature)) return 'not a PNG';
  let at = 8;
  let w = 0, h = 0, depth = 0, color = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (at + 8 <= b.length) {
    const len = b.readUInt32BE(at);
    const type = b.toString('ascii', at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]!; color = data[9]!; interlace = data[12]!; }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || (color !== 6 && color !== 2) || interlace !== 0) return `an unsupported PNG (depth ${depth}, colour type ${color}, interlace ${interlace})`;
  const channels = color === 6 ? 4 : 3;
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(idat)); } catch (e) { return `its pixel data doesn't inflate: ${(e as Error).message}`; }
  const stride = w * channels;
  if (raw.length !== h * (stride + 1)) return `its pixel data is ${raw.length} bytes, not ${h * (stride + 1)}`;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0, up = prev[i]!, c = i >= channels ? prev[i - channels]! : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const add = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? up : filter === 3 ? (a + up) >> 1 : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? up : c) : -1;
      if (add < 0) return `row ${y} has filter ${filter}`;
      line[i] = (line[i]! + add) & 0xff;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = k < channels ? line[x * channels + k]! : 255;
    prev = line;
  }
  return { w, h, rgba: out };
}
/** The PNG kept under `sha` in the evidence store, decoded, or why not. */
export function evidencePng(evidence: string, sha: string): Pixels | string {
  const bytes = readEvidence(evidence, sha);
  if (!bytes) return `the evidence store holds no bytes under ${sha}`;
  if (sha256(bytes) !== sha) return `the bytes under ${sha} hash to ${sha256(bytes)}`;
  return decodePng(bytes);
}
/** The hash of a picture's pixels (its RGBA bytes with its size), whatever its PNG encoding. */
export const pixelHash = (p: Pixels): string => sha256(Buffer.concat([Buffer.from(`${p.w}x${p.h}:`), p.rgba]));

/** Prints what the issue's Proof line asks to see, so a passing run shows it. */
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #456 ${label}: ${JSON.stringify(value)}`);
}
