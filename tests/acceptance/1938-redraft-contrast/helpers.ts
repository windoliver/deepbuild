// Test-side tools for the blind redraft of #1938's text-under-4.5:1 test and its oracle port: `deep-show` built with
// the `full` feature set and driven by JSON lines (#393's `deep-show run`, #403's claims, requirements and `verdict`,
// #96's stored documents and patches); the boards the tests judge, generated here so both files judge the same kind of
// document; reading render.contrast's row off a verdict; and a failure's fix as patch ops, sent back as a patch.
// Nothing here stands in for the check: every value a test compares comes from the binary, and every expected value
// from the issue, the design and the shipped clean look's colors. Parts are copied from #1936's helpers, since suites
// don't import each other.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1938-redraft-contrast is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const CARGO_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

function isObject(v: JsonValue | undefined): v is JsonObject {
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
function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with `full`, copied out of target/.

/** Builds once, before the file's tests. A test whose build failed fails with cargo's error; without cargo it can't decide. */
export function useBuild(): () => string {
  let dir = '';
  let made: { bin: string; error: string; ran: boolean } | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1938c-bin-'));
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
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1938c-')); made.push(d); return d; };
}

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

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: captions', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB1938D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB1938C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB1938Q', n)}`;

/** The check under test, as a claim's requirement names it: render.contrast with every field at its default. */
const CONTRAST_KIND = 'render.contrast';
const CONTRAST: JsonObject = { kind: CONTRAST_KIND };

/** Alpha's claim on one deliverable, its locked definition one requirement holding render.contrast. */
export const claimOf = (doc: string, req: string): JsonObject =>
  ({ session: ALPHA.id, deliverables: [doc], requirements: [{ id: req, check: CONTRAST }] });

/** The scenario: each stored document opened as revision 0 on the panel, the claims, the calls, and a planted program. */
export function scenarioOf(evidence: string, docs: Record<string, JsonObject>, claims: JsonObject, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS,
    docs: Object.fromEntries(Object.entries(docs).map(([d, document]) => [d, { panel: 'main', document }])),
    claims, ...(planted ? { planted } : {}), calls,
  };
}

export const verdict = (claim: string): JsonObject => ({ call: 'verdict', claim });
/** The working agent's patch of a stored document's revision 0 (Patch: `{patch, doc, base, reason, ops}`), as #96's `deep_show` carries one. */
export const patch = (doc: string, ops: JsonObject[]): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc, patch: { patch: ulid('01JB1938P', 1), doc, base: 0, reason: 'the fix render.contrast names', ops } });

/** The planted wrong program (README: Planted program): render.contrast held to 3:1 in place of `min`. */
export const MIN_3 = 'contrast_min_3';

// ---------------------------------------------------------------------------------------------------
// The verdict's row (README: The verdict's row)

/** One issue on a requirement's row; `ids` with any sub-address `<id>#<part>` read as `<id>`, sorted. */
interface Issue { code: string; severity: string; check: string; ids: string[]; raw: JsonObject }
interface Row { result: string; issues: Issue[]; raw: JsonObject }

const text = (v: JsonValue | undefined): string => (typeof v === 'string' ? v : '');
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
    return { code: text(o['code']), severity: text(o['severity']), check: text(o['check']), ids: idsOf(o), raw: o };
  });
  return { result: String(raw!['result']), issues, raw: raw! };
}
/** A row the check couldn't decide on the machine that drew it can't be judged here: INCONCLUSIVE, never a pass. */
export function decided(row: Row, what: string): void {
  if (row.result === 'INCONCLUSIVE') inconclusive(`${what} is INCONCLUSIVE on the machine that drew it: ${brief(row.raw)}`);
}
/** The issues that count against a check: errors and warnings. */
export const raised = (row: Row): Issue[] => row.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
const shown = (i: Issue): string => `${i.code || '(no code)'} from ${i.check || '(no check)'} [${i.ids.join(', ')}]`;

/**
 * Why the row isn't render.contrast failing exactly `item`: it FAILs, raises at least one issue, and every error or
 * warning it raises is an error of render.contrast (its `check`) with a non-empty `code`, naming exactly `item`.
 */
export function faultFailures(row: Row, item: string, what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what} is ${row.result}, not FAIL: ${brief(row.raw)}`);
  const all = raised(row);
  if (all.length === 0) failures.push(`${what} raises nothing`);
  for (const i of all) {
    const at = `${what} raises ${shown(i)}`;
    if (i.severity !== 'error') failures.push(`${at}, a ${i.severity}, not an error`);
    if (i.code === '') failures.push(`${at} with no code: ${brief(i.raw, 600)}`);
    if (i.check !== CONTRAST_KIND) failures.push(`${at}, which isn't ${CONTRAST_KIND}'s: ${brief(i.raw, 600)}`);
    if (i.ids.join(',') !== item) failures.push(`${at}, which names other than exactly ${item}: ${brief(i.raw, 600)}`);
  }
  return failures;
}
/** Why the row isn't a PASS with nothing raised against it. */
export function passFailures(row: Row, what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what} is ${row.result}, not PASS: ${brief(row.raw)}`);
  for (const i of raised(row)) failures.push(`${what} raises ${shown(i)} (${i.severity}): ${brief(i.raw, 600)}`);
  return failures;
}

/** The contrast ratio an issue reports: `actual` itself, or `actual.ratio`, or the issue's own `ratio`; null when none is a number. */
export function ratioOf(issue: Issue): number | null {
  const actual = issue.raw['actual'];
  const v = typeof actual === 'number' ? actual : isObject(actual) && typeof actual['ratio'] === 'number' ? actual['ratio'] : issue.raw['ratio'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------------------------------
// A fix as patch ops (README: A fix as patch ops)

/**
 * A failure's fix as patch ops: its `fix_ops` when that is a list, else `fix` when it is a list, else `fix.ops`; null
 * when that is empty or absent, or holds anything but op objects (`{op, …}`). A sentence alone is not patch ops.
 */
export function fixOps(issue: Issue): JsonObject[] | null {
  const { fix_ops: ops, fix } = issue.raw;
  const list = Array.isArray(ops) ? ops : Array.isArray(fix) ? fix : isObject(fix) && Array.isArray(fix['ops']) ? fix['ops'] : null;
  const isOp = (op: JsonValue): boolean => isObject(op) && typeof op['op'] === 'string';
  return list !== null && list.length > 0 && list.every(isOp) ? (list as JsonObject[]) : null;
}
/** The patch was applied (Patch: result `outcome`). */
export function applied(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is applied: ${brief(reply, 3000)}`).toBe('applied');
}

// ---------------------------------------------------------------------------------------------------
// Boards (README: Fixtures). 640 × 360 u, no look named, so the shipped clean look draws them.

/**
 * The shipped clean look's light theme, as sRGB, for each role these tests paint with (its palette and roles at the
 * base, crates/deep-canvas-marks/looks/clean.json). The hub draws the light theme; README: Fixtures says what the
 * dark one would do.
 */
export const CLEAN_LIGHT: Readonly<Record<string, string>> = {
  ground: '#ffffff', ink: '#1b1d22', muted: '#8b8f97', accent: '#1aa3c8', session_readout: '#b0207f', term_bright_magenta: '#d610d8',
};

const LAYER = 'alpha-main';
/** A board as the hub stores it (#96): alpha's writer layer, and each item given its ID, name, draw order and layer. */
function stored(title: string, items: Record<string, JsonObject>): JsonObject {
  const out: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, layer: LAYER, ...item };
  return {
    format: 1, profile: 'board', title, description: `${title}: a #1938 acceptance fixture.`, size: [640, 360],
    layers: { [LAYER]: { writer: `agent:${ALPHA.thread}`, title: ALPHA.name, order: 'a0' } },
    items: out,
  };
}
/**
 * One line of text in the look's body face at 20 u, regular weight (normal text by WCAG's measure, under 18 pt and not
 * bold), its fill the look role `role`, its 400 × 28 u box's top left at (40, y).
 */
const line = (words: string, role: string, y: number): JsonObject =>
  ({ kind: 'text@1', params: { text: words, font: 'body', size: 20, box: { w: 400, h: 28 }, paint: { fill: { role } } }, at: { pos: [40, y, 0] } });
/** A rect in the look role `role` under the line at y: 432 × 60 u from (24, y − 16), past every side of the line's box. */
const backdrop = (role: string, y: number): JsonObject => ({ kind: 'rect@1', params: { box: [24, y - 16, 432, 60], paint: { fill: { role } } } });

// ---- The planted fault and its clean twin (contrast.test.ts)

/** The title, in ink on the ground: 16.86:1 in the clean look's light theme. */
const TITLE = 'title';
/** The caption, the planted fault's text. */
export const CAPTION = 'caption';
/** The caption's role in the planted fault: muted on the ground, 3.24:1, under 4.5:1 and over 3:1. */
export const UNDER = 'muted';
/** The caption's role in the clean twin, and the one change between the two: ink on the ground, 16.86:1. */
export const CLEAR = 'ink';
/** A board with a title in ink and, under it, a caption in `role`, each on the look's ground. */
export function captionBoard(role: string): JsonObject {
  return stored(`A caption in ${role}`, { [TITLE]: line('Weekly checks', 'ink', 40), [CAPTION]: line('Updated every hour', role, 120) });
}

// ---- The oracle port's boards (oracle-contrast.test.ts)

/** The one line of each oracle board. */
export const WORDS = 'words';
/** The rect under it, when the board has one. */
export const PLATE = 'plate';
/** A board holding one line in `role`, on the look's ground, or on a rect in `under` when given (drawn first, so under the line). */
export function lineBoard(role: string, under?: string): JsonObject {
  const y = 120;
  return stored(`A line in ${role}${under ? ` on ${under}` : ''}`, { ...(under ? { [PLATE]: backdrop(under, y) } : {}), [WORDS]: line('Contrast, measured', role, y) });
}
