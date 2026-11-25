// Test-side tools for the #3236 acceptance tests (README: The surface under test). They build `deep-show` (once per
// file, as #539's suite does), drive `deep-show run` (one JSON scenario on stdin, one answer line) on the scope's
// virtual clock, and read its replies: `see`'s tree and announcements, the scope's focus, an input's `appended`, the
// `track` call. They judge a mark set's node value and its reading walk. Nothing here stands in for the check, the
// tree, the focus, the announcements or the input track: every value read here is deep-show's own, and every expected
// value comes from the issue's text, the design and this suite's fixtures.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import type { JsonObject, JsonValue } from './fixtures.ts';
import { SCATTER, UNITS, XS, YS } from './fixtures.ts';

export type { JsonObject, JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/3236 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
export const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;

/** The build's timeout (a first build of deep-show takes many minutes on a loaded machine); each test passes its own. */
export const BUILD_TIMEOUT = 3_600_000;
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #3236.184c874e',
  2: 'AC2 #3236.00cad6c6',
  3: 'AC3 #3236.b282e6d3',
  4: 'AC4 #3236.385f709f',
  5: 'AC5 #3236.9b62337c',
  6: 'AC6 #3236.310067e5',
  7: 'AC7 #3236.09a204cf',
  8: 'AC8 #3236.b9b04201',
  9: 'AC9 #3236.b81a558a',
} as const;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);

// ---------------------------------------------------------------------------------------------------
// Time: 705,600,000 flicks a second.

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000;
/** The scope's virtual clock (#383's, as #539's suite runs it): 120 Hz, the latch 2 ms before vsync, 0.5 ms of the checker. */
const CLOCK: JsonObject = { refresh_hz: 120, lead: 2 * MS, check: MS / 2 };
const DISPLAY: [number, number] = [1600, 900];

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A planted program's run: this suite's own judgement must fail it, and some failure must match every one of `named`. */
export function failsNaming(failures: readonly string[], named: RegExp[], what: string): void {
  expect(failures.length, `${what}: the criterion's check fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.every((n) => n.test(f))), `${what}: a failure names ${named.join(' and ')}; the failures:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
}
/** The integers a text says, in order ("x 3 seconds, y 30 metres" says [3, 30]). */
export const intsOf = (text: string): number[] => (text.match(/-?\d+/g) ?? []).map(Number);
const escaped = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Where `word` first stands as a whole word in `text` at or after `from`, or -1. */
export function wordAt(text: string, word: string, from = 0): number {
  const m = new RegExp(`(^|[^A-Za-z0-9_])(${escaped(word)})(?=[^A-Za-z0-9_]|$)`).exec(text.slice(from));
  return m ? from + m.index + m[1]!.length : -1;
}
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();
export const sameText = (a: string, b: string): boolean => collapse(a) === collapse(b);

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show` (the default `full` set), once per file, copied out of the target.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
/** One cargo run in `cwd` with the suite's build environment: '' when it built, else cargo's error. */
export function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^warning|^\s*(\||=|-->)|^\s*\d+ \|/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
let binsDir = '';
let built: { bin: string; error: string } | null = null;
function build(): { bin: string; error: string } {
  if (built) return built;
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-3236-bins-'));
  const bin = join(binsDir, exe('deep-show'));
  const error = cargo(['build', '--locked', '--bin', 'deep-show'], REPO);
  if (error === '') copyFileSync(join(TARGET, 'debug', exe('deep-show')), bin);
  built = { bin, error };
  return built;
}
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(): void {
  beforeAll(() => { build(); }, BUILD_TIMEOUT);
}
/** The built binary; a test that uses a build that failed fails, naming cargo's error. */
export function binOf(): string {
  const out = build();
  if (/cargo could not run/.test(out.error)) blocked(`${out.error}: this machine lacks the Rust toolchain`);
  expect(out.error, 'deep-show builds on this host: cargo build --locked --bin deep-show').toBe('');
  return out.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built = null; });

/** A fresh folder per call, deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-3236-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line on stdin, one answer `{ok, replies}`.

/** The scenario's `planted` values this suite adds (README: Planted twins). */
export type Planted = 'tree_keeps_old_value' | 'reading_walk_writes_entry' | 'reading_walk_row_order' | 'reading_walk_every_row';
export const SESSION = 'sess-3236';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-3236', name: 'Claude Code: chart reading', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
/** Each fixture's panel: 800 × 600 px, 2 px a unit of its 400 × 300 page. */
export const RECT = [0, 0, 800, 600];

/**
 * A scenario: the agent's session, the process table, each document in a visible panel of its own, the scope's virtual
 * clock and a display, `planted` when given, and the calls.
 */
export function scenario(evidence: string, docs: string[], calls: JsonObject[], planted?: Planted): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: [...RECT] }; docMap[d] = { panel: `p${i + 1}` }; });
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: docMap, clock: CLOCK, display: DISPLAY, ...(planted ? { planted } : {}), calls };
}
/** `deep-show run` on one scenario: exit 0, one answer line, ok, one reply per call, in call order. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const tag = typeof sc['planted'] === 'string' ? `${what} (planted ${sc['planted']})` : what;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${tag}: deep-show run did not finish within its timeout`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${tag}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${tag}: one answer line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!; }
  const out = obj(parsed, `${tag}: the answer`);
  expect(out['ok'], `${tag}: deep-show run answers the scenario ok${typeof sc['planted'] === 'string' ? ` (it takes the planted ${sc['planted']})` : ''}; got ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${tag}: replies`).map((x, i) => obj(x, `${tag}: replies[${i}]`));
  expect(list.length, `${tag}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}

/** The agent's `deep_show` of a whole document (#393), with its issues (and its timing when asked). */
export const showCall = (doc: string, document: JsonObject, timing = false): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, include: timing ? ['issues', 'timing'] : ['issues'] });
export function issuesOf(reply: JsonObject): JsonObject[] {
  const list = reply['issues'];
  return Array.isArray(list) ? list.filter(isObject) : [];
}
/** A `deep_show` reply that presented its document, with no error; the message lists the issues when it didn't. */
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply['issues'] ?? reply, 2500)}`).toBe('presented');
  expect(issuesOf(reply).filter((i) => i['severity'] === 'error'), `${what} is presented with no error`).toEqual([]);
}
/** The issue names item `id`: its `ids` hold it, or its `path` is `items/<id>` or under it. */
export function namesItem(issue: JsonObject, id: string): boolean {
  const ids = Array.isArray(issue['ids']) ? issue['ids'].map(String) : [];
  const path = typeof issue['path'] === 'string' ? issue['path'] : '';
  return ids.includes(id) || path === `items/${id}` || path.startsWith(`items/${id}/`);
}

/**
 * The calls of one run on the scope's virtual clock, each at its own `at`, in order; each method gives the index of its
 * call, so a test reads that call's reply.
 */
export class Script {
  readonly calls: JsonObject[] = [];
  private t = 0;
  readonly panel: string;
  constructor(panel = 'p1') { this.panel = panel; }
  private add(c: JsonObject, gapMs: number): number {
    this.t += Math.round(gapMs * MS);
    this.calls.push({ ...c, at: this.t });
    return this.calls.length - 1;
  }
  present(doc: string, document: JsonObject, timing = false): number { return this.add(showCall(doc, document, timing), this.calls.length ? 200 : 0.001); }
  scope(): number { return this.add({ call: 'scope', panel: this.panel }, 160); }
  key(key: string, gapMs = 100): number { return this.add({ call: 'input', panel: this.panel, event: { type: 'key', key } }, gapMs); }
  see(): number { return this.add({ call: 'see', panel: this.panel }, 50); }
  /** #1164's `track` call: the document's input track as the hub holds it. */
  track(doc: string): number { return this.add({ call: 'track', doc }, 50); }
  /** `eval` at `t` flicks (#387), no pixels: the document's own frame, with its `frame_ms`. */
  eval(doc: string, t: number): number { return this.add({ call: 'eval', doc, t }, 50); }
  /** The web export (#172): the document's bundle in `out`. */
  webExport(doc: string, out: string): number { return this.add({ call: 'export', doc, out, video: { codec: 'web' } }, 50); }
}

/** A reply's scope state (#383's `state`). */
export function stateOf(reply: JsonObject, what: string): JsonObject {
  return obj(reply['state'], `${what}: state (${show(reply, 600)})`);
}
/** The focus (README: `state.focus`): a row or a stop as `<set>#<key>`, a set or a control as its own ID, or null. */
export const focusOf = (reply: JsonObject, what: string): string | null => {
  const f = stateOf(reply, what)['focus'];
  return f === null || f === undefined ? null : str(f, `${what}: state.focus`);
};
/** The entries an input appended to the document's input track (`input`'s `appended`, #504). */
export function appendedOf(reply: JsonObject, what: string): JsonObject[] {
  return arr(reply['appended'], `${what}: appended (${show(reply, 600)})`).map((e, i) => obj(e, `${what}: appended[${i}]`));
}
/** The `track` call's entries. */
export function trackOf(reply: JsonObject, what: string): JsonObject[] {
  return arr(reply['track'], `${what}: track (${show(reply, 600)})`).map((e, i) => obj(e, `${what}: track[${i}]`));
}
/** An entry's brief form, for messages: it names the entry. */
export const entryText = (e: JsonObject): string => show({ control: e['control'] ?? null, value: e['value'] ?? null, t: e['t'] ?? null, writer: e['writer'] ?? null }, 400);

/** `see` (#376): the panel's accessibility tree and every announcement made so far. */
export interface Announcement { t: number | null; id: string; text: string }
export interface Seen { tree: JsonObject[]; announcements: Announcement[] }
export function seenOf(reply: JsonObject, what: string): Seen {
  const tree = arr(reply['tree'], `${what}: see.tree (${show(reply, 600)})`).map((n, i) => obj(n, `${what}: tree[${i}]`));
  const announcements = arr(reply['announcements'], `${what}: see.announcements`).map((a, i) => {
    const o = obj(a, `${what}: announcements[${i}]`);
    return { t: typeof o['t'] === 'number' ? o['t'] : null, id: String(o['id'] ?? ''), text: String(o['text'] ?? '') };
  });
  return { tree, announcements };
}
/** The tree's node of item `id`, or null. */
export const nodeOf = (seen: Seen, id: string): JsonObject | null => seen.tree.find((n) => n['id'] === id) ?? null;
/** The announcements of a set's rows or stops (`<set>#…`), in order. */
export const rowAnnouncements = (seen: Seen, set: string): Announcement[] => seen.announcements.filter((a) => a.id.startsWith(`${set}#`));

// ---------------------------------------------------------------------------------------------------
// The node's value (README: The node's value): the text the core computes at check for a mark set's node, as an
// assistive client reads it. Judged by its parts, never by its exact words: the drawn count first; then each encoded
// column by its name, as a whole word, in the encodings' order, with its unit and its least and greatest drawn value
// and, after them, its count of missing rows where it has any; a column of categories as each category's name with its
// count of rows after it, in the scale's order.

/** The value's text: the head before the first column's name, then each column's part up to the next one's name. */
function parts(value: string, columns: readonly string[]): { head: string; of: Record<string, string> } | null {
  const at: number[] = [];
  let from = 0;
  for (const c of columns) {
    const i = wordAt(value, c, from);
    if (i < 0) return null;
    at.push(i);
    from = i + c.length;
  }
  const of: Record<string, string> = {};
  columns.forEach((c, k) => { of[c] = value.slice(at[k]!, k + 1 < at.length ? at[k + 1]! : value.length); });
  return { head: value.slice(0, at[0]!), of };
}

/**
 * The fixture scatter's node against the issue's value: "11 rows drawn, x seconds 0 to 11, y metres <lo> to <hi>, 1
 * missing". Each failure about a column starts `column <name>:`.
 */
export function scatterValueFailures(node: JsonObject | null, y: [number, number], where: string): string[] {
  if (!node) return [`${where}: the tree has no node ${SCATTER}`];
  const value = node['value'];
  if (typeof value !== 'string' || value.trim() === '') return [`${where}: the node ${SCATTER} carries no value (the node: ${show(node, 600)})`];
  const p = parts(value, ['x', 'y']);
  if (!p) return [`${where}: the value ${JSON.stringify(value)} doesn't name the columns x and then y`];
  const f: string[] = [];
  const drawn = XS.length - YS.filter((v) => Number.isNaN(v)).length;
  if (show(intsOf(p.head)) !== show([drawn])) f.push(`${where}: the value says ${show(intsOf(p.head))} before its columns, not ${drawn} rows drawn: ${JSON.stringify(value)}`);
  const want: Record<'x' | 'y', number[]> = { x: [0, 11], y: [y[0], y[1], 1] };
  for (const c of ['x', 'y'] as const) {
    const part = p.of[c]!;
    if (wordAt(part, UNITS[c]) < 0) f.push(`column ${c}: ${where}: the value gives ${c} without its unit ${UNITS[c]}: ${JSON.stringify(part)}`);
    if (show(intsOf(part)) !== show(want[c])) {
      const says = c === 'x' ? `${want.x[0]} to ${want.x[1]}` : `${y[0]} to ${y[1]}, 1 missing`;
      f.push(`column ${c}: ${where}: the value gives ${c} as ${JSON.stringify(part.trim())} (numbers ${show(intsOf(part))}), not ${says}`);
    }
  }
  return f;
}

/** A value's categories: each name, in order, as a whole word, with the first integer after it its count of rows. */
export function categoryFailures(node: JsonObject | null, set: string, names: readonly string[], rows: number, where: string): string[] {
  if (!node) return [`${where}: the tree has no node ${set}`];
  const value = node['value'];
  if (typeof value !== 'string' || value.trim() === '') return [`${where}: the node ${set} carries no value (the node: ${show(node, 600)})`];
  const f: string[] = [];
  let from = 0;
  const at: number[] = [];
  for (const name of names) {
    const i = wordAt(value, name, from);
    if (i < 0) { f.push(`${where}: the value doesn't list the category ${name}${at.length ? ` after ${names[at.length - 1]}` : ''}: ${JSON.stringify(value)}`); return f; }
    at.push(i);
    from = i + name.length;
  }
  names.forEach((name, k) => {
    const part = value.slice(at[k]! + name.length, k + 1 < at.length ? at[k + 1]! : value.length);
    const n = intsOf(part)[0];
    if (n !== rows) f.push(`${where}: the value gives the category ${name} ${n === undefined ? 'no count' : `${n} rows`}, not ${rows}: ${JSON.stringify(value)}`);
  });
  return f;
}

// ---------------------------------------------------------------------------------------------------
// The reading walk (README: The reading focus): where each key left `state.focus`, and the landings on a set's rows.

/** The focus after each of the calls at `at`. */
export const fociOf = (r: JsonObject[], at: readonly number[], what: string): (string | null)[] => at.map((i, k) => focusOf(r[i]!, `${what}: key ${k + 1}`));
/** Each landing on a row or stop of `set` (`<set>#…`), in order: a key after which the focus is there and differs from before. */
export function landingsOf(foci: readonly (string | null)[], set: string): string[] {
  const out: string[] = [];
  let before: string | null = null;
  for (const f of foci) {
    if (f !== null && f.startsWith(`${set}#`) && f !== before) out.push(f);
    before = f;
  }
  return out;
}
/** Every entry the keys at `at` appended, and the track's: each one a failure naming it. */
export function entryFailures(r: JsonObject[], at: readonly number[], track: number, what: string): string[] {
  const f: string[] = [];
  at.forEach((i, k) => { for (const e of appendedOf(r[i]!, `${what}: key ${k + 1}`)) f.push(`${what}: key ${k + 1} wrote entry ${entryText(e)} to the document's input track`); });
  for (const e of trackOf(r[track]!, `${what}: the track`)) f.push(`${what}: the document's input track holds entry ${entryText(e)}; the walk wrote entry ${entryText(e)}`);
  return f;
}
