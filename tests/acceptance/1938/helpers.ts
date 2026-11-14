// Test-side tools for the #1938 acceptance tests: `deep-show` built with the `full` feature set and driven by JSON
// lines (#393's `deep-show run`, #403's claims, requirements and `verdict`, #96's stored documents, #138's scenario
// `environment`); the loop fixtures the criteria name, generated here so every test judges the same documents (each
// planted fault and its clean twin); reading a requirement's row off a verdict; and telling a fix as patch ops from a
// fix as text. Nothing here stands in for a check: every value a test compares comes from the binary, every expected
// value from the issue's text and the design. Parts are copied from #1936's, #453's and #1401's helpers, since suites
// don't import each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1938 is three levels down). */
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
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
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
/** Whether `value` holds `wanted` (equal by `same`) itself or anywhere inside it. */
export function holds(value: JsonValue | undefined, wanted: JsonValue): boolean {
  if (same(value, wanted)) return true;
  if (Array.isArray(value)) return value.some((v) => holds(v, wanted));
  if (isObject(value)) return Object.values(value).some((v) => holds(v, wanted));
  return false;
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with `full`, copied out of target/.

/** Builds once, before the file's tests. A test whose build failed fails with cargo's error; without cargo it can't decide. */
export function useBuild(): () => string {
  let dir = '';
  let made: { bin: string; error: string; ran: boolean } | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1938-bin-'));
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
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1938-')); made.push(d); return d; };
}

/** Keeps `bytes` in the evidence store at `<first 2 hex>/<other 62 hex>` (deep-show's layout); its SHA-256. */
export function putEvidence(root: string, bytes: Uint8Array): string {
  const sha = sha256(bytes);
  mkdirSync(join(root, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((v, i) => obj(v, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(arr(scenario['calls'], 'the calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The world a scenario holds: the working agent alpha, the process table, one panel, and stored documents.

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: the loop', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB1938D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB1938C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB1938Q', n)}`;

/** Alpha's claim on one deliverable, its locked definition one requirement holding `check`. */
export const claimOf = (doc: string, req: string, check: JsonObject): JsonObject =>
  ({ session: ALPHA.id, deliverables: [doc], requirements: [{ id: req, check }] });

/** What a scenario may add: a planted program by name (#387) and the machine it reports (#138's `environment`). */
export interface Extra { planted?: string; environment?: { os: string; driver: string } }

/** The scenario: each stored document opened as revision 0 on the panel, the claims, the calls, and the extras. */
export function scenarioOf(evidence: string, docs: Record<string, JsonObject>, claims: JsonObject, calls: JsonObject[], extra: Extra = {}): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS,
    docs: Object.fromEntries(Object.entries(docs).map(([d, document]) => [d, { panel: 'main', document }])),
    claims,
    ...(extra.planted ? { planted: extra.planted } : {}),
    ...(extra.environment ? { environment: extra.environment } : {}),
    calls,
  };
}

/** `{"call": "verdict", "claim"}`; with `against`, the verdict another run made on the claim (README: Another machine). */
export const verdict = (claim: string, against?: JsonObject): JsonObject => ({ call: 'verdict', claim, ...(against ? { against } : {}) });

// ---------------------------------------------------------------------------------------------------
// The verdict's row (README: The verdict's row)

/** One issue on a requirement's row; `ids` with any sub-address `<id>#<part>` read as `<id>`, sorted. */
export interface Issue { code: string; check: string; severity: string; ids: string[]; raw: JsonObject }
export interface Row { result: string; machines: string; issues: Issue[]; blocked: JsonObject[]; raw: JsonObject }

function idsOf(issue: JsonObject): string[] {
  const v = issue['ids'];
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return [...new Set(list.map((s) => s.split('#')[0]!))].sort();
}
/** The row of requirement `req` in a verdict. */
export function rowOf(v: JsonObject, req: string, what: string): Row {
  const rows = Array.isArray(v['requirements']) ? v['requirements'].filter(isObject) : [];
  const raw = rows.find((r) => r['id'] === req);
  expect(raw, `${what}: the verdict has a row for its requirement: ${brief(v)}`).toBeDefined();
  const issues = (Array.isArray(raw!['issues']) ? raw!['issues'] : []).map((x, i) => {
    const o = obj(x, `${what}: issues[${i}]`);
    return { code: typeof o['code'] === 'string' ? o['code'] : '', check: typeof o['check'] === 'string' ? o['check'] : '', severity: String(o['severity']), ids: idsOf(o), raw: o };
  });
  const blocked = (Array.isArray(raw!['blocked']) ? raw!['blocked'] : []).filter(isObject);
  return { result: String(raw!['result']), machines: String(raw!['machines']), issues, blocked, raw: raw! };
}
/** The issues that count against a check: errors and warnings. */
export const raised = (row: Row): Issue[] => row.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
const shown = (i: Issue): string => `${i.code || '(no code)'} by ${i.check || '(no check)'} [${i.ids.join(', ')}]`;
const reported = (issues: readonly Issue[]): string => issues.map(shown).join('; ') || 'nothing';

/** A row this machine couldn't draw for (no GPU): the test can't decide here, so it fails INCONCLUSIVE, never passes. */
export function gpuGate(row: Row, what: string): void {
  const codes = row.blocked.map((b) => String(b['code']));
  const gpu = codes.find((c) => c === 'gpu_unavailable' || c === 'unsupported_platform');
  if (row.result === 'BLOCKED' && gpu) inconclusive(`${what} is BLOCKED with ${gpu}: this machine has no GPU to draw on`);
}

// ---------------------------------------------------------------------------------------------------
// A fix as patch ops (README: A fix as patch ops)

/** A failure's fix as patch ops: `fix_ops` when it is a list, else `fix` as a list or as `{ops}`; null when it is text, empty or absent. */
export function fixOps(issue: Issue): JsonObject[] | null {
  const pick = (v: JsonValue | undefined): JsonValue[] | null => (Array.isArray(v) ? v : isObject(v) && Array.isArray(v['ops']) ? v['ops'] : null);
  const list = pick(issue.raw['fix_ops']) ?? pick(issue.raw['fix']);
  return list !== null && list.length > 0 && list.every(isObject) ? list : null;
}

/** Patch's ops (canvas primitives: Patch), and those that name an item by `id`. */
const OPS = ['create', 'set', 'unset', 'delete', 'move', 'reorder', 'rows', 'break_out'];
const BY_ID = ['set', 'unset', 'delete', 'move', 'reorder', 'rows'];
/** Why `ops` aren't patch ops on `doc`: each a Patch op; an op by `id` names an item the document holds; a `set` or `unset` writes under that item. */
export function opFailures(ops: readonly JsonObject[], doc: JsonObject, what: string): string[] {
  const items = isObject(doc['items']) ? doc['items'] : {};
  const failures: string[] = [];
  for (const op of ops) {
    const name = op['op'];
    if (typeof name !== 'string' || !OPS.includes(name)) { failures.push(`${what}: ${brief(op, 400)} isn't one of Patch's ops (${OPS.join(', ')})`); continue; }
    if (name === 'create' && !isObject(op['item'])) failures.push(`${what}: ${brief(op, 400)} creates no item`);
    if (!BY_ID.includes(name)) continue;
    const id = op['id'];
    if (typeof id !== 'string' || !(id in items)) { failures.push(`${what}: ${brief(op, 400)} names no item the document holds`); continue; }
    if (name === 'set' || name === 'unset') {
      const path = op['path'];
      if (typeof path !== 'string' || !(path === `items/${id}` || path.startsWith(`items/${id}/`))) failures.push(`${what}: ${brief(op, 400)} writes outside items/${id}/`);
      if (name === 'set' && !('value' in op)) failures.push(`${what}: ${brief(op, 400)} sets no value`);
    }
  }
  return failures;
}

/** One planted fault as a check must report it: its kind, the items its failure names, and its code where the design or the base names one. */
export interface Fault { kind: string; ids: readonly string[]; code?: string }

/** The issues of a row that are `fault`: by its check kind, with a code (its own when it has one), naming every one of its items. */
export function matching(row: Row, fault: Fault): Issue[] {
  return raised(row).filter((i) => i.check === fault.kind && i.code !== '' && (!fault.code || i.code === fault.code) && fault.ids.every((id) => i.ids.includes(id)));
}

/**
 * Why `row` isn't `fault` caught (criterion 1): the row FAILs, and an error or warning names its check kind, carries a
 * code (the fault's own when it has one), names the fault's items, and carries a fix as patch ops on the document.
 */
export function caughtFailures(row: Row, fault: Fault, doc: JsonObject, what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what} is ${row.result}, not FAIL: ${brief(row.raw)}`);
  const found = matching(row, fault);
  if (found.length === 0) {
    const naming = fault.ids.length > 0 ? ` naming ${fault.ids.join(', ')}` : '';
    failures.push(`${what} raises no ${fault.code ?? 'issue with a code'} by ${fault.kind}${naming}; it raises: ${reported(raised(row))}`);
    return failures;
  }
  const withOps = found.filter((i) => fixOps(i) !== null);
  if (withOps.length === 0) {
    failures.push(`${what}: ${found.map(shown).join('; ')} names its fix as text, not patch ops: ${found.map((i) => brief(i.raw['fix_ops'] ?? i.raw['fix'], 400)).join('; ')}`);
    return failures;
  }
  const errs = withOps.map((i) => opFailures(fixOps(i)!, doc, `${what}: ${shown(i)}'s fix`));
  if (errs.every((e) => e.length > 0)) failures.push(...errs.flat());
  return failures;
}
/** Why `row` isn't a clean twin passing: PASS, nothing raised. */
export function passFailures(row: Row, what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what} is ${row.result}, not PASS: ${brief(row.raw)}`);
  for (const i of raised(row)) failures.push(`${what} raises ${shown(i)} (${i.severity}): ${brief(i.raw, 600)}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The loop fixtures (README: Fixtures). Metres, +Y up; 2D documents in px at design size, y down.

type V3 = [number, number, number];
const LAYER = 'alpha-main';
/** A document as the hub stores it (#96): alpha's writer layer, and each item given its ID, name, draw order and layer. */
function stored(profile: string, title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const out: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, layer: LAYER, ...item };
  return {
    format: 1, profile, title, description: `${title}: a #1938 loop fixture.`,
    layers: { [LAYER]: { writer: `agent:${ALPHA.thread}`, title: ALPHA.name, order: 'a0' } },
    ...extra, items: out,
  };
}
const SCENE_SIZE: [number, number] = [320, 240];
/** A 3D scene viewed through `cam`: 320 × 240 px. */
const scene = (title: string, items: Record<string, JsonObject>, extra: JsonObject = {}, modules: JsonObject = { scene3d: '^1' }): JsonObject =>
  stored('scene', title, items, { size: SCENE_SIZE, camera: 'cam', requires: { modules }, ...extra });

/** `cam`: a perspective camera@1 at (0, 1, 6) looking level at (0, 1, 0), 40° across the wider side, near 0.1 m, far 200 m. */
export const CAM: JsonObject = { kind: 'camera@1', params: { projection: 'perspective', position: [0, 1, 6], target: [0, 1, 0], fov: 40, near: 0.1, far: 200 } };
/** A black sky with no ambient light. */
const SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
const box = (size: V3, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, ...extra });
/** An unlit, double-sided, opaque material of linear `color`, with `params` added. */
const unlit = (color: V3, params: JsonObject = {}): JsonObject =>
  ({ kind: 'material@1', params: { base_color: [...color, 1], unlit: true, alpha_mode: 'opaque', alpha: 1, double_sided: true, ...params } });
/** The ground the audit's scenes stand on: a 6 × 0.2 × 6 m box whose top is at y = 0. Each check declares it floating. */
const FLOOR = box([6, 0.2, 6], [0, -0.1, 0]);

/** One loop check's planted fault and its clean twin: their documents, the requirement's check input, and the fault. */
export interface Pair {
  planted: JsonObject;
  twin: JsonObject;
  check: JsonObject;
  fault: Fault;
  /** Bytes the evidence store holds for both documents, and for the twin alone. */
  both?: Uint8Array[];
  twinOnly?: Uint8Array[];
  /** The pair's pixels are drawn on the GPU. */
  gpu?: boolean;
}

// ---- A subject cut by the frame: camera.framing

/** The subject: a 1 m cube at height 1 m. */
export const SUBJECT = 'subject';
/**
 * The cube at x = 0: its bounds span 80 of the frame's 240 px rows (fill 0.33), centred, with the camera level. At
 * x = 1.8 its front face runs from 104 to 184 px right of the centre, past the frame's edge at 160 px: cut.
 */
export function framingPair(): Pair {
  const doc = (x: number): JsonObject => scene(x === 0 ? 'A framed subject' : 'A subject cut by the frame', { cam: CAM, sky: SKY, [SUBJECT]: box([1, 1, 1], [x, 1, 0]) });
  return { planted: doc(1.8), twin: doc(0), check: { kind: 'camera.framing', keep: [SUBJECT] }, fault: { kind: 'camera.framing', ids: [SUBJECT] } };
}

// ---- Clipped highlights: render.exposure

/** The collection that is the exposure check's subject. */
const HERO = 'hero';
/**
 * A 1.2 m cube in an unlit material of linear grey 0.18 (middle grey) before a backdrop of the same grey that fills the
 * frame. The planted cube's material also emits linear white at strength 4, so it draws at 4.18: every pixel clipped.
 */
export function exposurePair(): Pair {
  const doc = (clipped: boolean): JsonObject => scene(clipped ? 'Clipped highlights' : 'A subject at middle grey', {
    cam: CAM, sky: SKY,
    'hero-mat': unlit([0.18, 0.18, 0.18], clipped ? { emission: [1, 1, 1], emission_strength: 4 } : {}),
    'wall-mat': unlit([0.18, 0.18, 0.18]),
    [SUBJECT]: box([1.2, 1.2, 1.2], [0, 1, 0], { material: 'hero-mat' }),
    backdrop: box([12, 8, 0.1], [0, 1, -3], { material: 'wall-mat' }),
  }, { collections: { [HERO]: { members: [SUBJECT] } } });
  return { planted: doc(true), twin: doc(false), check: { kind: 'render.exposure', subject: HERO }, fault: { kind: 'render.exposure', ids: [SUBJECT] }, gpu: true };
}

// ---- Text under 4.5:1: render.contrast

/** A 2D board: the frame filled with the look's `ground` role, and `items` over it. */
const board = (title: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject =>
  stored('board', title, { back: { kind: 'rect@1', params: { box: [0, 0, size[0], size[1]], paint: { fill: { role: 'ground' } } } }, ...items }, { seed: 1938, size, ...extra });
/** The caption, and the look roles it is drawn in: `muted` (planted) and `ink` (twin), on the `ground` role. */
export const CAPTION = 'caption';
export const ROLES = { planted: 'muted', twin: 'ink', ground: 'ground' } as const;
/** A 48 px caption in the body font on the ground: in `muted` (planted), in `ink` (twin). */
export function contrastPair(): Pair {
  const doc = (role: string): JsonObject => board(role === ROLES.planted ? 'A caption under 4.5:1' : 'A caption over 4.5:1', [480, 240], {
    [CAPTION]: { kind: 'text@1', params: { text: 'Seventy percent', font: 'body', size: 48, box: { w: 440, h: 72 }, paint: { fill: { role } } }, at: { pos: [20, 80, 0] } },
  });
  return { planted: doc(ROLES.planted), twin: doc(ROLES.twin), check: { kind: 'render.contrast' }, fault: { kind: 'render.contrast', ids: [CAPTION] } };
}

// ---- Two items passing into each other, and an item floating 0.2 m above the floor: the scene audit

/** The scene audit's check input on every audit fixture: the floor may float. */
const AUDIT: JsonObject = { kind: 'geometry.audit', scope: 'scene', support: { floating: ['floor'] } };
export const CRATES = ['crate-a', 'crate-b'] as const;
/** Two 1 m crates on the floor, `crate-b` at x = 0.8 (0.2 m into `crate-a` along x, 1 m along y and z) or at x = 1.2 (0.2 m apart). */
export function overlapPair(): Pair {
  const doc = (x: number): JsonObject => scene(x < 1 ? 'Two crates passing into each other' : 'Two crates side by side', {
    floor: FLOOR, [CRATES[0]]: box([1, 1, 1], [0, 0.5, 0]), [CRATES[1]]: box([1, 1, 1], [x, 0.5, 0]),
  });
  return { planted: doc(0.8), twin: doc(1.2), check: AUDIT, fault: { kind: 'geometry.audit', ids: [...CRATES], code: 'geometry.overlap' } };
}
export const VASE = 'vase';
/** A 0.3 × 0.6 × 0.3 m vase centred at y = 0.5, its base 0.2 m above the floor's top; the twin's at y = 0.3, standing on it. */
export const VASE_AT = { planted: [0, 0.5, 0] as V3, twin: [0, 0.3, 0] as V3 };
export function floatingPair(): Pair {
  const doc = (pos: V3): JsonObject => scene(pos === VASE_AT.planted ? 'A vase floating 0.2 m above the floor' : 'A vase on the floor', { floor: FLOOR, [VASE]: box([0.3, 0.6, 0.3], pos) });
  return { planted: doc(VASE_AT.planted), twin: doc(VASE_AT.twin), check: AUDIT, fault: { kind: 'geometry.audit', ids: [VASE], code: 'geometry.floating' } };
}

// ---- A 20 m door: scene.scale

export const DOOR = 'door';
/** A 4 × 2.7 m wall with a 0.9 m wide door in it (the building module's `arch.opening@1`, `type: door`), 20 m tall or 2.1 m. */
export function scalePair(): Pair {
  const doc = (height: number): JsonObject => scene(height > 3 ? 'A 20 m door' : 'A 2.1 m door', {
    cam: CAM, sky: SKY,
    wall: { kind: 'arch.wall@1', params: { a: [-2, 0], b: [2, 0], thickness: 0.2, height: 2.7, justify: 'center', outside: 'left', cut_height: 1.2 } },
    [DOOR]: { kind: 'arch.opening@1', parent: 'wall', params: { wall: 'wall', type: 'door', at_along: 1.5, width: 0.9, height, sill: 0 } },
  }, {}, { scene3d: '^1', building: '^1' });
  return { planted: doc(20), twin: doc(2.1), check: { kind: 'scene.scale' }, fault: { kind: 'scene.scale', ids: [DOOR] } };
}

// ---- A missing texture: document.validate's assets

/** The crate's base colour map: a 4 × 4 PNG checker, licensed in the document's `assets`. */
export const texture = (): Uint8Array => encodePng(4, 4, (x, y) => ((x + y) % 2 === 0 ? [200, 120, 60, 255] : [60, 40, 20, 255]));
/** A 1 m crate whose unlit material's `maps.base_color` names the PNG by hash; the PNG is in the evidence store for the twin only. */
export function texturePair(): Pair {
  const png = texture();
  const sha = sha256(png);
  const doc = scene('A crate with a base colour map', {
    cam: CAM, sky: SKY,
    'crate-mat': unlit([1, 1, 1], { maps: { base_color: sha } }),
    crate: box([1, 1, 1], [0, 0.5, 0], { material: 'crate-mat' }),
  }, { assets: { 'crate-texture': { sha256: sha, license: { id: 'cc0', terms: 'CC0 1.0', shareable: true, credit: 'a #1938 test fixture' } } } });
  return {
    planted: doc, twin: doc, twinOnly: [png],
    check: { kind: 'document.validate', assets: { missing: 0, maps: 'present', licenses: 'present' } },
    fault: { kind: 'document.validate', ids: [], code: 'asset_missing' },
  };
}

// ---- A fill that reseeds each frame: render.noise

export const GRAIN = 'grain';
/** One frame at the document's 60 fps, in flicks (705,600,000 a second). */
const FRAME = 705_600_000 / 60;
/**
 * A 240 × 160 px rect with a value-noise fill (stops `ink` to `ground`, scale 6 px, seed 7) on a 1 s board. The
 * planted board's channel `reseed` holds the fill's seed at a new whole number every frame (1, 2, …, 60); the twin's
 * seed stays 7.
 */
export function noisePair(): Pair {
  const grain: JsonObject = { kind: 'rect@1', params: { box: [40, 40, 240, 160], paint: { fill: { noise: { kind: 'value', scale: 6, stops: [{ at: 0, role: 'ink' }, { at: 1, role: 'ground' }], seed: 7 } } } } };
  const keys = Object.fromEntries(Array.from({ length: 60 }, (_, k) => [`k${String(k).padStart(2, '0')}`, { t: k * FRAME, value: k + 1, interp: 'hold' }]));
  const doc = (reseeds: boolean): JsonObject => board(reseeds ? 'A fill that reseeds each frame' : 'A fill seeded once', [320, 240], { [GRAIN]: grain }, {
    transport: { span: '1s' },
    ...(reseeds ? { channels: { reseed: { target: `items/${GRAIN}/params/paint/fill/noise/seed`, type: 'f32', keys } } } : {}),
  });
  return { planted: doc(true), twin: doc(false), check: { kind: 'render.noise', flat_variance_max: 0.001 }, fault: { kind: 'render.noise', ids: [GRAIN] } };
}

// ---- A scene over its class: document.budget

/** 0.1 m spheres on the ground 20 to 60 m away, `n` × `n` of them, beside a 1 m subject 1 m up. */
function specks(n: number): Record<string, JsonObject> {
  const out: Record<string, JsonObject> = {};
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    out[`speck-${String(i).padStart(2, '0')}-${String(j).padStart(2, '0')}`] = { kind: 'mark.sphere@1', params: { size: [0.1, 0.1, 0.1] }, at: { pos: [-20 + (40 * (i + 0.5)) / n, 0.05, -20 - (40 * (j + 0.5)) / n] } };
  }
  return out;
}
/**
 * A figure-class scene (2 ms of GPU a frame): the subject and 1,600 specks, which the base's cost model puts at about
 * 6.2 ms of GPU (256 vertices a sphere at 15.04 ns each), three times its class; the twin holds 16 specks, about 0.06 ms.
 */
export function overClassPair(): Pair {
  const doc = (n: number): JsonObject => scene(n > 4 ? 'A scene over its class' : 'A scene within its class', { cam: CAM, sky: SKY, [SUBJECT]: box([1, 1, 1], [0, 1, 0]), ...specks(n) }, { budget: { class: 'figure' } });
  return { planted: doc(40), twin: doc(4), check: { kind: 'document.budget' }, fault: { kind: 'document.budget', ids: [], code: 'over_budget' } };
}

// ---- Criterion 2's shading fault: geometry.shading

/** A unit cube, 8 shared corners, every triangle wound in and every normal in: signed volume −1 m³ (#453's inward cube). */
export function inwardCube(): Uint8Array {
  const corners: V3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  // Outward winding (counter-clockwise seen from outside), then reversed.
  const out = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]];
  const indices = out.flatMap(([a, b, c]) => [a!, c!, b!]);
  const normals = corners.map((p) => { const d: V3 = [p[0] - 0.5, p[1] - 0.5, p[2] - 0.5]; const l = Math.hypot(...d); return d.map((x) => -x / l) as V3; });
  return glb(corners, normals, indices);
}
export function shadingDoc(sha: string): JsonObject {
  return scene('An inward cube', { cam: CAM, sky: SKY, shell: { kind: 'mesh.asset@1', params: { sha256: sha, node: 0 } } });
}

// ---------------------------------------------------------------------------------------------------
// Encoders: a PNG (8-bit RGBA, one IDAT) and a GLB (glTF 2.0: one mesh, one triangle primitive)

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function encodePng(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const raw = Buffer.alloc(h * (1 + 4 * w));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(px(x, y), y * (1 + 4 * w) + 1 + 4 * x);
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function glb(positions: V3[], normals: V3[], indices: number[]): Uint8Array {
  const f = (rows: V3[]): Buffer => { const b = Buffer.alloc(rows.length * 12); rows.flat().forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };
  const pos = f(positions), nor = f(normals), ind = Buffer.alloc(indices.length * 4);
  indices.forEach((v, i) => ind.writeUInt32LE(v, i * 4));
  const bin = Buffer.concat([pos, nor, ind]);
  const lo = [0, 1, 2].map((k) => Math.min(...positions.map((p) => p[k]!))), hi = [0, 1, 2].map((k) => Math.max(...positions.map((p) => p[k]!)));
  const json = {
    asset: { version: '2.0', generator: 'deepbuild tests/acceptance/1938' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'mesh', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5126, count: normals.length, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length },
      { buffer: 0, byteOffset: pos.length, byteLength: nor.length },
      { buffer: 0, byteOffset: pos.length + nor.length, byteLength: ind.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
  const chunk = (body: Buffer, kind: number): Buffer => { const h = Buffer.alloc(8); h.writeUInt32LE(body.length, 0); h.writeUInt32LE(kind, 4); return Buffer.concat([h, body]); };
  return Buffer.concat([header, chunk(text, 0x4e4f534a), chunk(bin, 0x004e4942)]);
}

// ---------------------------------------------------------------------------------------------------
// One pair judged: the planted document and its twin, each the one deliverable of its own claim, in one run.

export interface Judged { planted: Row; twin: Row; replies: JsonObject[] }
/** The pair's two claims judged by `verdict` in one run, with the pair's assets in a fresh evidence store. */
export function judgePair(bin: string, evidence: string, pair: Pair, extra: Extra = {}): Judged {
  for (const b of pair.both ?? []) putEvidence(evidence, b);
  // A twin-only asset goes in the store only when the planted document isn't judged beside it: here both are, so the
  // planted document runs in a store of its own (README: Fixtures, the missing texture).
  if (pair.twinOnly) {
    const plantedStore = join(evidence, 'planted');
    const twinStore = join(evidence, 'twin');
    mkdirSync(plantedStore, { recursive: true });
    for (const b of pair.twinOnly) putEvidence(twinStore, b);
    for (const b of pair.both ?? []) { putEvidence(plantedStore, b); putEvidence(twinStore, b); }
    const [p] = run(bin, scenarioOf(plantedStore, { [docId(1)]: pair.planted }, { [claimId(1)]: claimOf(docId(1), reqId(1), pair.check) }, [verdict(claimId(1))], extra));
    const [t] = run(bin, scenarioOf(twinStore, { [docId(2)]: pair.twin }, { [claimId(2)]: claimOf(docId(2), reqId(2), pair.check) }, [verdict(claimId(2))], extra));
    return { planted: rowOf(p!, reqId(1), 'the planted fault'), twin: rowOf(t!, reqId(2), 'the clean twin'), replies: [p!, t!] };
  }
  const docs = { [docId(1)]: pair.planted, [docId(2)]: pair.twin };
  const claims = { [claimId(1)]: claimOf(docId(1), reqId(1), pair.check), [claimId(2)]: claimOf(docId(2), reqId(2), pair.check) };
  const replies = run(bin, scenarioOf(evidence, docs, claims, [verdict(claimId(1)), verdict(claimId(2))], extra));
  return { planted: rowOf(replies[0]!, reqId(1), 'the planted fault'), twin: rowOf(replies[1]!, reqId(2), 'the clean twin'), replies };
}

/** Prints what the issue's Proof line asks to see ("with the issues as data"), so a passing run shows it. */
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #1938 ${label}: ${JSON.stringify(value)}`);
}
