// Test-side tools for the #1941 acceptance tests: `deep-show` built with the `full` feature set and driven by JSON
// lines (#393's `deep-show run`, its `deep_show` with a `patch`, `render_back` and `read`; #96's stored documents and
// writers; #403's claims, requirements, `verdict` and `answer`; #387's `planted`); the loop fixtures the criteria name,
// generated here so every test judges the same documents; reading a requirement's row off a verdict; and a failure's
// fix as patch ops, sent back as a patch. Nothing here stands in for a check: every value a test compares comes from
// the binary, every expected value from the issue's text and the design. Parts are copied from #1938's and #1936's
// helpers, since suites don't import each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1941 is three levels down). */
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
    dir = mkdtempSync(join(tmpdir(), 'deep-1941-bin-'));
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
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1941-')); made.push(d); return d; };
}

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** The bytes the evidence store keeps under `sha`, or null. */
export function readEvidence(root: string, sha: string): Buffer | null {
  const path = join(root, sha.slice(0, 2), sha.slice(2));
  return existsSync(path) ? readFileSync(path) : null;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
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
// The world a scenario holds: the working agent alpha, you, the process table, one panel, and stored documents.

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: the fix loop', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
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
export const docId = (n: number): string => ulid('01JB1941D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB1941C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB1941Q', n)}`;
export const patchId = (n: number): string => ulid('01JB1941P', n);

/** Who a call writes as: alpha's MCP session, or `deep show` you ran from your own process tree (#96). */
export type Who = JsonObject;
export const AS_ALPHA: Who = { call: 'deep_show', session: ALPHA.id };
export const AS_YOU: Who = { call: 'deep show', peer: { pid: 3002, start: 3_000 } };
/** The writers as a conflict names them (Writer layer: `{kind, id}`). */
export const WRITER = { alpha: { kind: 'agent', id: ALPHA.thread }, you: { kind: 'you', id: 'you' } } as const;
export const writerKey = (w: JsonValue | undefined): string => (isObject(w) ? `${String(w['kind'])}:${String(w['id'])}` : String(w));

/** Alpha's claim on one deliverable, its locked definition the requirements `[ID, check input]`. */
export const claimOf = (doc: string, requirements: readonly (readonly [string, JsonObject])[]): JsonObject =>
  ({ session: ALPHA.id, deliverables: [doc], requirements: requirements.map(([id, check]) => ({ id, check })) });

/** What a scenario may add: a planted program by name (#387). */
export interface Extra { planted?: string }

/** The scenario: each stored document opened as revision 0 on the panel, the claims, the calls, and the extras. */
export function scenarioOf(evidence: string, docs: Record<string, JsonObject>, claims: JsonObject, calls: JsonObject[], extra: Extra = {}): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS,
    docs: Object.fromEntries(Object.entries(docs).map(([d, document]) => [d, { panel: 'main', document }])),
    claims,
    ...(extra.planted ? { planted: extra.planted } : {}),
    calls,
  };
}

// The calls.
export const verdict = (claim: string): JsonObject => ({ call: 'verdict', claim });
/** A patch through `deep_show` (Patch: `{patch, doc, base, reason, ops}`), written as `who`. */
export const patch = (who: Who, doc: string, id: string, base: number, ops: readonly JsonObject[], reason = 'the fix the loop check names'): JsonObject =>
  ({ ...who, doc, patch: { patch: id, doc, base, reason, ops: [...ops] } });
/** The current revision as the hub shows it: `{rev, hash, document, …}`. */
export const read = (doc: string): JsonObject => ({ call: 'read', doc });
/** Render-back of revision `rev`, for alpha's session (Render-back: `{doc, rev, t, size}`). */
export const renderBack = (doc: string, rev: number, t?: number): JsonObject => ({ call: 'render_back', session: ALPHA.id, doc, rev, ...(t === undefined ? {} : { t }) });
/** Your answer to the ask open on a claim's requirement (#403's `answer`), from your own shell. */
export const answer = (claim: string, requirement: string, yes: boolean): JsonObject =>
  ({ call: 'answer', peer: AS_YOU['peer']!, claim, requirement, answer: yes ? 'yes' : 'no' });

// ---------------------------------------------------------------------------------------------------
// Replies

/** A patch's outcome: `applied`, `superseded`, `conflict` or `refused`. */
export const outcome = (reply: JsonObject): string => String(reply['outcome']);
/** Why a patch reply isn't applied; empty when it is. */
export function appliedFailures(reply: JsonObject, what: string): string[] {
  return outcome(reply) === 'applied' ? [] : [`${what} is ${outcome(reply)}, not applied: ${brief(reply, 1200)}`];
}

/** One issue on a requirement's row; `ids` with any sub-address `<id>#<part>` read as `<id>`, sorted. */
export interface Issue { code: string; check: string; severity: string; ids: string[]; raw: JsonObject }
export interface Row { id: string; result: string; issues: Issue[]; blocked: JsonObject[]; raw: JsonObject }

function idsOf(issue: JsonObject): string[] {
  const v = issue['ids'];
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return [...new Set(list.map((s) => s.split('#')[0]!))].sort();
}
/** Every row of a verdict, in order. */
function rowsOf(v: JsonObject, what: string): Row[] {
  return arr(v['requirements'], `${what}: the verdict's requirements`).map((x, k) => {
    const raw = obj(x, `${what}: requirements[${k}]`);
    const issues = (Array.isArray(raw['issues']) ? raw['issues'] : []).map((y, i) => {
      const o = obj(y, `${what}: requirements[${k}].issues[${i}]`);
      return { code: typeof o['code'] === 'string' ? o['code'] : '', check: typeof o['check'] === 'string' ? o['check'] : '', severity: String(o['severity']), ids: idsOf(o), raw: o };
    });
    const blocked = Array.isArray(raw['blocked']) ? raw['blocked'].filter(isObject) : [];
    return { id: String(raw['id']), result: String(raw['result']), issues, blocked, raw };
  });
}
/** The row of requirement `req` in a verdict. */
export function rowOf(v: JsonObject, req: string, what: string): Row {
  const row = rowsOf(v, what).find((r) => r.id === req);
  expect(row, `${what}: the verdict has a row for ${req}: ${brief(v)}`).toBeDefined();
  return row!;
}
/** The issues that count against a check: errors and warnings. */
export const raised = (row: Row): Issue[] => row.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
/** An issue as the design matches one across revisions: by its check, its code and its item IDs (Revision). */
export const keyOf = (i: Issue): string => `${i.check || '(no check)'} ${i.code || '(no code)'} [${i.ids.join(', ')}]`;
const reported = (issues: readonly Issue[]): string => issues.map(keyOf).join('; ') || 'nothing';
/** The revision a verdict judged `doc` at, from its key (#403: `key.revisions[{doc, rev, hash}]`). */
export function judgedRev(v: JsonObject, doc: string): number | null {
  const key = isObject(v['key']) ? v['key'] : {};
  const list = Array.isArray(key['revisions']) ? key['revisions'].filter(isObject) : [];
  const r = list.find((x) => x['doc'] === doc)?.['rev'];
  return typeof r === 'number' ? r : null;
}
/** One ask, listed again: the same `id` where both carry one, else the same JSON. */
export const sameAsk = (a: JsonObject, b: JsonObject): boolean =>
  typeof a['id'] === 'string' && typeof b['id'] === 'string' ? a['id'] === b['id'] : same(a, b);
/** Every distinct ask in `lists` (README: The ask). */
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

/** A 3D row this machine couldn't draw for (no GPU): the test can't decide here, so it fails INCONCLUSIVE, never passes. */
export function gpuGate(row: Row, what: string): void {
  const codes = row.blocked.map((b) => String(b['code']));
  const gpu = codes.find((c) => c === 'gpu_unavailable' || c === 'unsupported_platform' || c === 'software_adapter');
  if (row.result !== 'PASS' && row.result !== 'FAIL' && gpu) inconclusive(`${what} is ${row.result} with ${gpu}: this machine has no GPU to draw on`);
}

// ---------------------------------------------------------------------------------------------------
// A fix as patch ops

/** A failure's fix as patch ops: `fix_ops` when it is a list, else `fix` as a list or as `{ops}`; null when it is text, empty or absent. */
function fixOps(issue: Issue): JsonObject[] | null {
  const pick = (v: JsonValue | undefined): JsonValue[] | null => (Array.isArray(v) ? v : isObject(v) && Array.isArray(v['ops']) ? v['ops'] : null);
  const list = pick(issue.raw['fix_ops']) ?? pick(issue.raw['fix']);
  return list !== null && list.length > 0 && list.every(isObject) ? list : null;
}
/** The base revision a fix names, where it names one (`fix: {base, ops}`); else the revision its verdict judged. */
export function fixBase(issue: Issue, judged: number): number {
  const fix = issue.raw['fix'];
  return isObject(fix) && typeof fix['base'] === 'number' ? fix['base'] : judged;
}
/** The IDs a fix's ops target, sorted. */
export const opTargets = (ops: readonly JsonObject[]): string[] =>
  [...new Set(ops.flatMap((o) => [o['id'], isObject(o['item']) ? o['item']['id'] : undefined]).filter((x): x is string => typeof x === 'string'))].sort();

/** One planted fault as its check reports it: the check kind, the items its failure names, and its code where the design or the base names one. */
export interface Fault { kind: string; ids: readonly string[]; code?: string }
/** The issues of a row that are `fault`: by its check kind, with a code (its own when it has one), naming every one of its items. */
function matching(row: Row, fault: Fault): Issue[] {
  return raised(row).filter((i) => i.check === fault.kind && i.code !== '' && (!fault.code || i.code === fault.code) && fault.ids.every((id) => i.ids.includes(id)));
}
/** The fault's first issue on a FAIL `row` that names a fix as patch ops, or why there is none. */
export function fixOf(row: Row, fault: Fault, what: string): { issue: Issue; ops: JsonObject[] } | string {
  if (row.result !== 'FAIL') return `${what} is ${row.result}, not FAIL: ${brief(row.raw, 1500)}`;
  const found = matching(row, fault).find((i) => fixOps(i) !== null);
  if (!found) return `${what} raises no ${fault.code ?? 'issue with a code'} by ${fault.kind} naming ${fault.ids.join(', ') || 'its items'} with a fix as patch ops; it raises: ${reported(raised(row))}: ${brief(row.raw, 1500)}`;
  return { issue: found, ops: fixOps(found)! };
}
/** The same, failing the test, saying what the row raised, when there is none. */
export function namedFix(row: Row, fault: Fault, what: string): { issue: Issue; ops: JsonObject[] } {
  const found = fixOf(row, fault, what);
  if (typeof found === 'string') return expect.fail(found);
  return found;
}
/** Why `row` isn't passing: PASS, nothing raised. */
export function passFailures(row: Row, what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what} is ${row.result}, not PASS: ${brief(row.raw, 1500)}`);
  for (const i of raised(row)) failures.push(`${what} raises ${keyOf(i)} (${i.severity}): ${brief(i.raw, 600)}`);
  return failures;
}
/**
 * Why `after` regressed from `before` (criterion 1's "no other loop check regresses"): a row that passed before and
 * doesn't now, or an error or warning, by check, code and items, that it didn't raise before.
 */
export function regressions(before: Row, after: Row, what: string): string[] {
  const failures: string[] = [];
  if (before.result === 'PASS' && after.result !== 'PASS') failures.push(`${what} was PASS and is now ${after.result}: ${brief(after.raw, 1200)}`);
  const was = new Set(raised(before).map(keyOf));
  for (const i of raised(after)) if (!was.has(keyOf(i))) failures.push(`${what} now raises ${keyOf(i)}, which it didn't before: ${brief(i.raw, 600)}`);
  return failures;
}

/** Where `id` is after `ops`, from `start`, when every op sets its `at.pos` or a component of it; else why not. */
export function placed(ops: readonly JsonObject[], id: string, start: readonly number[]): { at: number[]; failures: string[] } {
  const at = [...start];
  const failures: string[] = [];
  for (const op of ops) {
    const [path, value] = [op['path'], op['value'] as JsonValue];
    if (op['op'] !== 'set' || op['id'] !== id) { failures.push(`${brief(op, 400)} isn't a set on ${id}`); continue; }
    if (path === `items/${id}/at/pos` && Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number')) at.splice(0, 3, ...(value as number[]));
    else if (typeof path === 'string' && /^items\/[^/]+\/at\/pos\/[012]$/.test(path) && typeof value === 'number') at[Number(path.slice(-1))] = value;
    else failures.push(`${brief(op, 400)} doesn't set ${id}'s at.pos`);
  }
  return { at, failures };
}

/** A `read` reply's revision: its number, its hash and the document as the hub holds it. */
export interface Shown { rev: number; hash: string; document: JsonObject }
export function shown(reply: JsonObject, what: string): Shown {
  expect(typeof reply['rev'], `${what}: rev`).toBe('number');
  expect(typeof reply['hash'], `${what}: hash`).toBe('string');
  return { rev: reply['rev'] as number, hash: reply['hash'] as string, document: obj(reply['document'], `${what}: document`) };
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
    format: 1, profile, title, description: `${title}: a fix loop fixture.`,
    layers: { [LAYER]: { writer: `agent:${ALPHA.thread}`, title: ALPHA.name, order: 'a0' } },
    ...extra, items: out,
  };
}

/** The frame every 3D fixture is drawn at. */
const SCENE_SIZE: [number, number] = [320, 240];
/** A perspective camera@1 at `position` looking at `target`, 40° across the wider side, near 0.1 m, far 200 m. */
const camera = (position: V3, target: V3): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov: 40, near: 0.1, far: 200 } });
/** The camera most fixtures use: 4 m out and 1.3 m up, looking down at the middle of a metre-high subject. */
const NEAR_CAM = camera([0, 1.3, 4], [0, 0.5, 0]);
/** The same, 6 m out, for the two crates side by side. */
const FAR_CAM = camera([0, 1.8, 6], [0, 0.5, 0]);
/** A sun of π lx from the front left and above, which shows a surface of reflectance 0.18 facing it at middle grey, casting shadows. */
const SUN: JsonObject = { kind: 'light.sun@1', params: { illuminance: Math.PI, shadow: true }, at: { rot: [-45, 20, 0] } };
/** A pale sky with a little ambient light. */
const SKY: JsonObject = { kind: 'sky@1', params: { top: [0.55, 0.62, 0.72, 1], low: [0.85, 0.85, 0.82, 1], ambient_top: [0.1, 0.1, 0.1], ambient_low: [0.05, 0.05, 0.05] } };
/** A rough, non-metal material of linear `color` (each fixture's subjects have a luminance near 0.25), with `params` added. */
const matte = (color: V3, params: JsonObject = {}): JsonObject => ({ kind: 'material@1', params: { base_color: [...color, 1], roughness: 1, metallic: 0, ...params } });
const box = (size: V3, pos: V3, material: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material });
/** The ground every 3D fixture stands on: a box whose top is at y = 0. The scene audit declares it floating. */
const floorOf = (size: [number, number] = [6, 6], centre: [number, number] = [0, 0]): JsonObject => box([size[0], 0.2, size[1]], [centre[0], -0.1, centre[1]], 'floor-mat');
const FLOOR_MAT = matte([0.35, 0.33, 0.3]);
/** A lit scene: its camera, sun, sky and floor material, and `items`, with `hero` the collection of `keep`. */
function scene(title: string, keep: readonly string[], items: Record<string, JsonObject>, extra: JsonObject = {}, modules: JsonObject = { scene3d: '^1' }, cam: JsonObject = NEAR_CAM): JsonObject {
  return stored('scene', title, { cam, sun: SUN, sky: SKY, 'floor-mat': FLOOR_MAT, ...items }, {
    size: SCENE_SIZE, camera: 'cam', requires: { modules }, collections: { [HERO]: { members: [...keep] } }, budget: { class: 'figure' }, ...extra,
  });
}
/** The collection each fixture names its kept subject by (render.exposure's `subject`). */
export const HERO = 'hero';

/** 2D boards are drawn in the shipped clean look: the frame filled with its `ground` role, and `items` over it. A board keeps no subject. */
function board(title: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  return stored('board', title, { back: { kind: 'rect@1', params: { box: [0, 0, size[0], size[1]], paint: { fill: { role: 'ground' } } } }, ...items }, { seed: 1941, size, ...extra });
}

/** The scene audit's check input on every 3D fixture: the floor may float. */
export const AUDIT: JsonObject = { kind: 'geometry.audit', scope: 'scene', support: { floating: ['floor'] } };

/**
 * The loop checks every fixture is judged by (criterion 1's "no other loop check regresses"), in this order: each
 * kind of Check input: loop kinds that #1938 builds and the two extended kinds, with the fixture's kept items as
 * framing's `keep`. The fault's own check is the one among them of its kind.
 */
export function loopChecks(keep: readonly string[]): JsonObject[] {
  return [
    { kind: 'scene.scale' },
    { kind: 'camera.framing', keep: [...keep] },
    { kind: 'render.exposure', subject: HERO },
    { kind: 'render.contrast' },
    { kind: 'render.noise', flat_variance_max: 0.001 },
    { kind: 'geometry.shading' },
    AUDIT,
    { kind: 'document.validate', assets: { missing: 0, maps: 'present', licenses: 'present' } },
    { kind: 'document.budget' },
  ];
}

/** One of the nine planted faults: its document, the fault as its check reports it, and the kept items. */
export interface Planted {
  /** A file-name stem, also used in test names. */
  slug: string;
  /** The planted fault in the issue's words. */
  name: string;
  doc: () => JsonObject;
  fault: Fault;
  keep: readonly string[];
  /** A 3D scene: render-back and the pixel checks draw it on the GPU. */
  gpu: boolean;
}

// ---- A subject cut by the frame: camera.framing

export const SUBJECT = 'subject';
const SUBJECT_MAT = matte([0.18, 0.26, 0.36]);
/** A 1 m cube on the floor 1.5 m right of the camera's line of sight: its near face runs from about 125 to 250 px right of the frame's centre, past its edge at 160 px. */
function cutSubject(): JsonObject {
  return scene('A subject cut by the frame', [SUBJECT], { 'subject-mat': SUBJECT_MAT, floor: floorOf(), [SUBJECT]: box([1, 1, 1], [1.5, 0.5, 0], 'subject-mat') });
}

// ---- Clipped highlights: render.exposure

/** The same cube in view, its material also emitting white at strength 4, so it draws far past white. */
function clippedSubject(): JsonObject {
  return scene('Clipped highlights', [SUBJECT], {
    'subject-mat': matte([0.18, 0.26, 0.36], { emission: [1, 1, 1], emission_strength: 4 }),
    floor: floorOf(), [SUBJECT]: box([1, 1, 1], [0, 0.5, 0], 'subject-mat'),
  });
}

// ---- Text under 4.5:1: render.contrast

const CAPTION = 'caption';
/** A line of text in the body font in look role `role`, at `y`. */
const line = (words: string, role: string, size: number, y: number): JsonObject =>
  ({ kind: 'text@1', params: { text: words, font: 'body', size, box: { w: 420, h: Math.round(size * 1.4) }, paint: { fill: { role } } }, at: { pos: [30, y, 0] } });
/** A board with a title in ink and, under it, a caption in the look's `muted` role (3.24:1 on the ground). No number or number word shows. */
function mutedCaption(): JsonObject {
  return board('A caption under its ground', [480, 240], { title: line('Reading room', 'ink', 40, 40), [CAPTION]: line('Quiet hours begin at dusk', 'muted', 22, 130) });
}

// ---- Two items passing into each other, an item floating 0.2 m above the floor: the scene audit

const CRATES = ['crate-a', 'crate-b'] as const;
const CRATE_MAT = matte([0.4, 0.22, 0.1]);
/** Two 1 m crates on the floor, one wood and one green, `crate-b` 0.2 m into `crate-a` along x and 1 m along y and z. */
function crossedCrates(): JsonObject {
  return scene('Two crates passing into each other', CRATES, {
    'crate-mat': CRATE_MAT, 'green-mat': matte([0.2, 0.28, 0.2]), floor: floorOf(),
    [CRATES[0]]: box([1, 1, 1], [-0.5, 0.5, 0], 'crate-mat'), [CRATES[1]]: box([1, 1, 1], [0.3, 0.5, 0], 'green-mat'),
  }, {}, { scene3d: '^1' }, FAR_CAM);
}
export const VASE = 'vase';
/** The vase's size and its centre with its base 0.2 m above the floor's top (planted) and on it. */
const VASE_SIZE: V3 = [0.3, 0.6, 0.3];
export const VASE_AT = { planted: [0, 0.5, 0] as V3, standing: [0, 0.3, 0] as V3 };
/** A 0.3 × 0.6 × 0.3 m vase over the floor, held by nothing. */
function floatingVase(size: V3 = VASE_SIZE): JsonObject {
  return scene('A vase floating above the floor', [VASE], { 'vase-mat': matte([0.45, 0.2, 0.12]), floor: floorOf(), [VASE]: box(size, VASE_AT.planted, 'vase-mat') });
}

// ---- A 20 m door: scene.scale

export const DOOR = 'door';
const WALL = 'wall';
/** The camera that frames a 4 × 2.7 m wall from 12 m out. */
const WALL_CAM = camera([0, 1.6, 12], [0, 1.2, 0]);
/** A 4 × 2.7 m wall standing on the floor with a 0.9 m wide door in it (the building module's `arch.opening@1`, `type: door`) `height` m tall. */
function doorIn(height: number, cam: JsonObject = WALL_CAM, keep: readonly string[] = [WALL]): JsonObject {
  return scene(height > 3 ? 'A 20 m door' : 'A door', keep, {
    floor: floorOf(),
    [WALL]: { kind: 'arch.wall@1', params: { a: [-2, 0], b: [2, 0], thickness: 0.2, height: 2.7, justify: 'center', outside: 'left', cut_height: 1.2 } },
    [DOOR]: { kind: 'arch.opening@1', parent: WALL, params: { wall: WALL, type: 'door', at_along: 1.5, width: 0.9, height, sill: 0 } },
  }, {}, { scene3d: '^1', building: '^1' }, cam);
}

// ---- A missing texture: document.validate's assets

/** The crate's base colour map: a 4 × 4 PNG checker, licensed in the document's `assets`; the evidence store never holds it. */
export const texture = (): Uint8Array => encodePng(4, 4, (x, y) => ((x + y) % 2 === 0 ? [200, 120, 60, 255] : [60, 40, 20, 255]));
const CRATE = 'crate';
function untexturedCrate(): JsonObject {
  const sha = sha256(texture());
  return scene('A crate whose texture is missing', [CRATE], {
    'crate-mat': matte([0.4, 0.22, 0.1], { maps: { base_color: sha } }), floor: floorOf(), [CRATE]: box([1, 1, 1], [0, 0.5, 0], 'crate-mat'),
  }, { assets: { 'crate-texture': { sha256: sha, license: { id: 'cc0', terms: 'CC0 1.0', shareable: true, credit: 'a #1941 test fixture' } } } });
}

// ---- A fill that reseeds each frame: render.noise

const GRAIN = 'grain';
/** One frame at the document's 60 fps, in flicks (705,600,000 a second). */
export const FRAME = 705_600_000 / 60;
/** A 240 × 160 px rect with a value-noise fill (stops `ink` to `ground`, scale 6 px, seed 7) on a 1 s board, its seed held at a new whole number every frame by the channel `reseed`. */
function reseededFill(): JsonObject {
  const grain: JsonObject = { kind: 'rect@1', params: { box: [40, 40, 240, 160], paint: { fill: { noise: { kind: 'value', scale: 6, stops: [{ at: 0, role: 'ink' }, { at: 1, role: 'ground' }], seed: 7 } } } } };
  const keys = Object.fromEntries(Array.from({ length: 60 }, (_, k) => [`k${String(k).padStart(2, '0')}`, { t: k * FRAME, value: k + 1, interp: 'hold' }]));
  return board('A fill that reseeds each frame', [320, 240], { [GRAIN]: grain }, {
    transport: { span: '1s' }, channels: { reseed: { target: `items/${GRAIN}/params/paint/fill/noise/seed`, type: 'f32', keys } },
  });
}

// ---- A scene over its class: document.budget

/** `n` × `n` 0.1 m spheres resting on the ground 20 to 60 m away, `n` across 40 m. */
function specks(n: number): Record<string, JsonObject> {
  const out: Record<string, JsonObject> = {};
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    out[`speck-${String(i).padStart(2, '0')}-${String(j).padStart(2, '0')}`] = { kind: 'mark.sphere@1', params: { size: [0.1, 0.1, 0.1] }, at: { pos: [-20 + (40 * (i + 0.5)) / n, 0.05, -20 - (40 * (j + 0.5)) / n] }, material: 'speck-mat' };
  }
  return out;
}
/** A figure-class scene (2 ms of GPU a frame) of the subject and 1,600 specks on a floor that runs under them all: about three times its class by the cost model. */
function overClass(): JsonObject {
  return scene('A scene over its class', [SUBJECT], {
    'subject-mat': SUBJECT_MAT, 'speck-mat': matte([0.3, 0.3, 0.3]), floor: floorOf([44, 66], [0, -29]),
    [SUBJECT]: box([1, 1, 1], [0, 0.5, 0], 'subject-mat'), ...specks(40),
  });
}

/** The nine planted faults (issue #1938's list, which #1941's Proof names), in its order. */
export const NINE: readonly Planted[] = [
  { slug: 'framing-cut', name: 'a subject cut by the frame', doc: cutSubject, fault: { kind: 'camera.framing', ids: [SUBJECT] }, keep: [SUBJECT], gpu: true },
  { slug: 'exposure-clipped', name: 'clipped highlights', doc: clippedSubject, fault: { kind: 'render.exposure', ids: [SUBJECT] }, keep: [SUBJECT], gpu: true },
  { slug: 'contrast-muted', name: 'text under 4.5:1', doc: mutedCaption, fault: { kind: 'render.contrast', ids: [CAPTION] }, keep: [], gpu: false },
  { slug: 'overlap-crates', name: 'two items passing into each other', doc: crossedCrates, fault: { kind: 'geometry.audit', ids: [...CRATES], code: 'geometry.overlap' }, keep: CRATES, gpu: true },
  { slug: 'floating-vase', name: 'an item floating 0.2 m above the floor', doc: () => floatingVase(), fault: { kind: 'geometry.audit', ids: [VASE], code: 'geometry.floating' }, keep: [VASE], gpu: true },
  { slug: 'scale-door', name: 'a 20 m door', doc: () => doorIn(20), fault: { kind: 'scene.scale', ids: [DOOR] }, keep: [WALL], gpu: true },
  { slug: 'texture-missing', name: 'a missing texture', doc: untexturedCrate, fault: { kind: 'document.validate', ids: [], code: 'asset_missing' }, keep: [CRATE], gpu: true },
  { slug: 'noise-reseeds', name: 'a fill that reseeds each frame', doc: reseededFill, fault: { kind: 'render.noise', ids: [GRAIN] }, keep: [], gpu: false },
  { slug: 'budget-over-class', name: 'a scene over its class', doc: overClass, fault: { kind: 'document.budget', ids: [], code: 'over_budget' }, keep: [SUBJECT], gpu: true },
];
/** A planted fault's own check: the first of `loopChecks` of its kind, by index. */
export const ownCheck = (p: Planted): number => loopChecks(p.keep).findIndex((c) => c['kind'] === p.fault.kind);
/** The floating vase, criterion 2's fixture. */
export const FLOATING = NINE[4]!;

// ---- Criterion 3's fixtures

/** Framing's check input with `fill` tightened to [0.3, 0.9] (a brief may only tighten it). */
export const FRAMING_TIGHT = (keep: readonly string[]): JsonObject => ({ kind: 'camera.framing', keep: [...keep], fill: [0.3, 0.9] });
/** The cube cut by the frame and emitting white at strength 4: framing's fix and exposure's each set the camera. */
export function cutAndClipped(): JsonObject {
  return scene('A clipped subject cut by the frame', [SUBJECT], {
    'subject-mat': matte([0.18, 0.26, 0.36], { emission: [1, 1, 1], emission_strength: 4 }),
    floor: floorOf(), [SUBJECT]: box([1, 1, 1], [1.5, 0.5, 0], 'subject-mat'),
  });
}
/** The 20 m door, kept by a camera 12 m out: framing's fix pulls the camera back to take it all in, and scale's fix then leaves the door too small in the frame. */
export const keptDoor = (): JsonObject => doorIn(20, WALL_CAM, [DOOR]);

// ---- Criterion 4's other planted-fault scenes: #1936's and #1937's

/** The camera every #1936 room is seen through: 6.5 m out in front of its open side. */
const ROOM_CAM = camera([0.5, 1.8, 6.5], [0, 0.9, -1]);
const WALL_MAT = matte([0.3, 0.25, 0.2]);
/** #1936's wall that one patch added twice: two 4 × 2 × 0.2 m walls under two IDs in one place. */
function wallTwice(): JsonObject {
  const wall = box([4, 2, 0.2], [0, 1, -2], 'wall-mat');
  return scene('A wall added twice', ['wall'], { 'wall-mat': WALL_MAT, floor: floorOf(), wall, 'wall-again': { ...wall } }, {}, { scene3d: '^1' }, ROOM_CAM);
}
/** #1936's kit room: three one-sided 4 × 2 m sheets standing on the floor, open at the front, `wall-right` at x = `rightX`. */
function kitRoom(rightX: number): JsonObject {
  const sheet = (pos: V3, rot: V3): JsonObject => ({ kind: 'plate@1', params: { grid: [1, 1], size: [4, 2] }, at: { pos, rot }, material: 'wall-mat' });
  return scene(rightX === 2 ? 'A kit room' : 'A kit room with one wall moved', ['wall-back'], {
    'wall-mat': WALL_MAT, floor: floorOf(),
    'wall-back': sheet([0, 1, -2], [90, 0, 0]), 'wall-left': sheet([-2, 1, 0], [90, 90, 0]), 'wall-right': sheet([rightX, 1, 0], [90, -90, 0]),
  }, { collections: { [HERO]: { members: ['wall-back'] }, kit: { members: ['wall-back', 'wall-left', 'wall-right'] } } }, { scene3d: '^1' }, ROOM_CAM);
}
/** #1937's over-class scene: a showpiece (10 ms of GPU a frame) lit by a sun that casts shadows, a subject, and 3,600 specks, about 14 ms by the cost model. */
export function showpiece(): JsonObject {
  return scene('A showpiece over its class', [SUBJECT], {
    'subject-mat': SUBJECT_MAT, 'speck-mat': matte([0.3, 0.3, 0.3]), floor: floorOf([44, 66], [0, -29]),
    [SUBJECT]: box([1, 1, 1], [0, 0.5, 0], 'subject-mat'), ...specks(60),
  }, { budget: { class: 'showpiece' } });
}

/** One scene criterion 4 photographs: its file stem, the issue its fault is from, its document, the check that names its fix, and that fix's fault. */
interface Shot { slug: string; from: string; doc: () => JsonObject; check: JsonObject; fault: Fault; gpu: boolean }
/** Each planted-fault scene of #1936, #1937 and #1938, photographed before and after its named fix. */
export const SHOTS: readonly Shot[] = [
  ...NINE.map((p): Shot => ({ slug: p.slug, from: '#1938', doc: p.doc, check: loopChecks(p.keep)[ownCheck(p)]!, fault: p.fault, gpu: p.gpu })),
  { slug: 'coincident-walls', from: '#1936', doc: wallTwice, check: AUDIT, fault: { kind: 'geometry.audit', ids: ['wall', 'wall-again'], code: 'geometry.coincident' }, gpu: true },
  { slug: 'grid-off', from: '#1936', doc: () => kitRoom(2.05), check: { ...AUDIT, grid: { unit: 1, sub: 0.5, items: 'kit' } }, fault: { kind: 'geometry.audit', ids: ['wall-right'], code: 'geometry.off_grid' }, gpu: true },
  { slug: 'seam-moved', from: '#1936', doc: () => kitRoom(2.002), check: { ...AUDIT, seams: { pairs: [['kit', 'kit']] } }, fault: { kind: 'geometry.audit', ids: ['wall-back', 'wall-right'], code: 'geometry.seam' }, gpu: true },
  { slug: 'budget-showpiece', from: '#1937', doc: showpiece, check: { kind: 'document.budget' }, fault: { kind: 'document.budget', ids: [], code: 'over_budget' }, gpu: true },
];

// ---------------------------------------------------------------------------------------------------
// A PNG encoder (8-bit RGBA, one IDAT), and the size a PNG's header gives

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function encodePng(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Uint8Array {
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
/** A PNG's width and height from its header, or null when the bytes aren't a PNG. */
export function pngSize(bytes: Uint8Array): [number, number] | null {
  const b = Buffer.from(bytes);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (b.length < 24 || !b.subarray(0, 8).equals(signature) || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** Prints what the issue's Proof line asks to see ("with the issues as data"), so a passing run shows it. */
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #1941 ${label}: ${JSON.stringify(value)}`);
}
