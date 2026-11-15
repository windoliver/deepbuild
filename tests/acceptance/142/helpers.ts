// Test-side tools for the #142 acceptance tests: `deep-show` built once per file and driven by JSON lines (#393's
// `deep-show run`: `deep show`, `eval`, `path`, `registries`, `registry`, `install_pack`, `packs`, the scenario's
// `packs` and `planted`); `deep-gpu run`'s `frame_budget` (#1899) for the budgets; the ten example documents the
// explain@1 pack ships, read from the checkout; the fixture films the criteria describe, written here; the test pack
// acme/acme with its recipe acme.slides, written at test time; readers for a film recipe's expansion, a frame's
// values and pictures; and the rules the criteria judge by. Nothing here stands in for a recipe, a rule or the
// evaluation: every value a test compares comes from a binary, and every expected value from the issue or the design.
// Parts are copied from #222's, #223's, #493's and #239's helpers, since suites don't import each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/142 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID: `#142.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #142.44730151',
  2: 'AC2 #142.77ca866d',
  3: 'AC3 #142.083a5161',
  4: 'AC4 #142.648b2324',
  5: 'AC5 #142.ee5f5cff',
  6: 'AC6 #142.3a4bcf6d',
  7: 'AC7 #142.58304480',
  8: 'AC8 #142.0b0a5201',
  9: 'AC9 #142.30bc3e5b',
  10: 'AC10 #142.d708e2b3',
  11: 'AC11 #142.53adec01',
  12: 'AC12 #142.0815c532',
} as const;

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
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v === 'string', `${what} is a string, got ${brief(v)}`).toBe(true);
  return v as string;
}
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether a value's JSON text holds `word` as a whole name (a cue's ID, a rule's code, a recipe's name). */
export const names = (v: JsonValue | undefined, word: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9_.])${escape(word)}(?![A-Za-z0-9_])`).test(JSON.stringify(v) ?? '');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A check the binary answered BLOCKED: never a pass. */
export function blocked(reason: string): never {
  expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** Two values equal number by number within `tol`, everything else exactly. */
export function same(a: JsonValue | undefined, b: JsonValue | undefined, tol = 1e-9): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i], tol));
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => same(a[k], b[k], tol));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): replies carry times as integer flicks or as the time grammar's "<decimal>s".

export const FLICKS = 705_600_000;
/** Seconds to whole flicks (exact for the decimal seconds the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
export const secs = (s: number): string => `${s}s`;
export const showTime = (f: number): string => `${(f / FLICKS).toFixed(4)} s (${f} flicks)`;
/** A time as a reply or a document writes it, in exact flicks: an integer is flicks, `"<decimal>s"` is seconds,
 * `"<n>f"` frames at `frame` flicks each; else null. */
export function flicksOf(v: JsonValue | undefined, frame = FLICKS / 60): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v !== 'string') return null;
  const f = /^(\d+)f$/.exec(v.trim());
  if (f) return Number(f[1]) * frame;
  const m = /^(-?)(\d+)(?:\.(\d+))?s$/.exec(v.trim());
  if (!m) return null;
  const frac = m[3] ?? '';
  const scaled = BigInt(`${m[2]!}${frac}`) * BigInt(FLICKS);
  const den = 10n ** BigInt(frac.length);
  if (scaled % den !== 0n) return null;
  const out = Number(scaled / den);
  return m[1] === '-' ? -out : out;
}
/** A document's frame, in whole flicks, from its `transport.frame_rate` ("p/q", 60/1 when unset). */
export function frameOf(doc: JsonObject): number {
  const t = isObject(doc['transport']) ? doc['transport'] : {};
  const m = typeof t['frame_rate'] === 'string' ? /^(\d+)\/(\d+)$/.exec(t['frame_rate']) : null;
  const [p, q] = m ? [Number(m[1]), Number(m[2])] : [typeof t['frame_rate'] === 'number' ? t['frame_rate'] : 60, 1];
  return Math.round((FLICKS * q) / p);
}
/** A document's span in flicks (`transport.span`). */
export function spanOf(doc: JsonObject, what: string): number {
  const t = isObject(doc['transport']) ? doc['transport'] : {};
  const s = flicksOf(t['span'], frameOf(doc));
  expect(s !== null && s > 0, `${what}: transport.span is a time above 0, got ${brief(t['span'] ?? null)}`).toBe(true);
  return s!;
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` with the `full` set, debug once per file (release only for a timing); `deep-gpu` for the
// frame budget, as #239's suite builds it.

const SHOW = 'deep-show';
const showArgs = (release: boolean): string[] => ['build', '--locked', ...(release ? ['--release'] : []), '--bin', SHOW, '--no-default-features', '--features', 'full'];
const gpuArgs = ['build', '--locked', '--bin', 'deep-gpu'];

function cargo(args: string[], bin: string, profile: string, dir: string, name: string): { bin: string; error: string } {
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return { bin: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { bin: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const out = join(dir, name);
  copyFileSync(join(TARGET, profile, bin), out);
  return { bin: out, error: '' };
}
/** Builds `deep-show` (`full`) and copies it into `dir`: the binary, or cargo's error. */
export const buildShow = (release: boolean, dir: string): { bin: string; error: string } =>
  cargo(showArgs(release), SHOW, release ? 'release' : 'debug', dir, `${SHOW}-full${release ? '-release' : ''}`);
/** Builds `deep-gpu` (as #239's suite does) and copies it into `dir`. */
export const buildGpu = (dir: string): { bin: string; error: string } => cargo(gpuArgs, 'deep-gpu', 'debug', dir, 'deep-gpu');

/** `cargo build --locked --bin deep-show --no-default-features --features full`, once per file, in beforeAll. */
export function useShow(): () => string {
  let dir = '';
  let built = { bin: '', error: 'not built' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-142-bin-'));
    built = buildShow(false, dir);
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(built.error, `the binary builds: cargo ${showArgs(false).join(' ')}`).toBe(''); return built.bin; };
}
/** Fresh folders for a test (evidence stores, packs, binaries), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-142-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.error?.message ?? '', `${SHOW} run started`).toBe('');
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((x, i) => obj(x, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(arr(scenario['calls'], 'the calls').length);
  return replies;
}

/** A pack folder offered to the scenario's store (#306) and the version a document names. */
export interface Pack { id: string; version: string; dir: string }
export const packAt = (p: Pack): string => `${p.id}@${p.version}`;
/** The first-party pack of film recipes (README: The pack). */
export const EXPLAIN: Pack = { id: 'deepbuild/explain', version: '1.0.0', dir: join(REPO, 'packs', 'explain-1.0.0') };
/** The first-party verbs (#222), whose `fade_in`, `fade_out` and `rotate` the fixtures' cues play. */
export const VERBS: Pack = { id: 'deepbuild/verbs', version: '1.0.0', dir: join(REPO, 'packs', 'verbs-1.0.0') };
export const EXPLAIN_AT = packAt(EXPLAIN);
export const VERBS_AT = packAt(VERBS);
/** What every explain scenario offers its store. */
export const OFFERED: readonly Pack[] = [EXPLAIN, VERBS];

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: film recipes', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB142D', n);

export interface Extra { packs?: readonly Pack[]; planted?: string }
/** A scenario: your shell's process tree, alpha's session, one panel, every document a call names, the packs offered
 * before the first call (the explain pack and the verbs by default) and the scenario's planted program. */
export function scenario(evidence: string, calls: JsonObject[], extra: Extra = {}): JsonObject {
  const docs: JsonObject = {};
  for (const c of calls) if (typeof c['doc'] === 'string') docs[c['doc']] = { panel: 'main' };
  const packs = extra.packs ?? OFFERED;
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1920, 1080] } },
    docs,
    ...(packs.length ? { packs: packs.map((p) => ({ id: p.id, dir: p.dir })) } : {}),
    ...(extra.planted ? { planted: extra.planted } : {}),
    calls,
  };
}

/** `deep show` of a whole document from your shell, with the parts of the reply `include` names. */
export const present = (doc: string, document: JsonObject, include: string[] = ['issues']): JsonObject =>
  ({ call: 'deep show', peer: YOU_PEER, doc, document, include });
/** The reply's error issues. */
export const errors = (reply: JsonObject): JsonObject[] => (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
/** The document was presented, with no error issue. */
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${brief(reply)}`).toBe('presented');
  expect(errors(reply), `${what} raises no error`).toEqual([]);
}
/**
 * A refusal as the criteria read it (README: Rule codes and refusals): the document isn't presented, and an error
 * names the cue and the rule; with `innocent`, that error doesn't also name the cue that breaks nothing.
 */
export function refusalFailures(reply: JsonObject, cue: string, rule: string, what: string, innocent?: string): string[] {
  const out: string[] = [];
  if (reply['outcome'] === 'presented') out.push(`${what}: presented; a cue list that breaks ${rule} is refused`);
  const naming = errors(reply).filter((i) => names(i, cue) && names(i, rule) && !(innocent !== undefined && names(i, innocent)));
  if (!naming.length) out.push(`${what}: no error names the cue ${cue} and the rule ${rule}${innocent ? ` without naming ${innocent}, which breaks nothing` : ''}: ${brief(errors(reply), 2500)}`);
  return out;
}

/** #387's `eval` at `t` flicks: `paths` (#1918), `texts` (each drawn text's shown string), `film` (#493's block),
 * `pixels` (the canonical snapshot, at `size` px when given). */
export function evalAt(doc: string, t: number, o: { paths?: string[]; texts?: boolean; film?: boolean; pixels?: boolean; size?: [number, number] } = {}): JsonObject {
  return {
    call: 'eval', doc, t, ...(o.paths ? { paths: o.paths } : {}), ...(o.texts ? { texts: true } : {}), ...(o.film ? { film: true } : {}),
    ...(o.pixels ? { pixels: true } : {}), ...(o.size ? { size: o.size } : {}),
  };
}
export function evaluated(reply: JsonObject, what: string): JsonObject {
  expect(reply['outcome'], `${what} is evaluated: ${brief(reply, 800)}`).toBe('evaluated');
  return reply;
}
/** Each path's evaluated value in an `eval` reply. */
export const valuesOf = (reply: JsonObject, what: string): JsonObject => obj(evaluated(reply, what)['values'], `${what}: values`);
/** Each drawn text's shown string, by item ID, in an `eval` reply with `texts`. */
export const textsOf = (reply: JsonObject, what: string): JsonObject => obj(evaluated(reply, what)['texts'], `${what}: texts`);
/** #223's `path` at t: the item's outline as drawn, every sub-path's points. */
export const pathAt = (doc: string, item: string, t: number): JsonObject => ({ call: 'path', doc, item, t });
/** Every point of a `path` reply, or null when it answers no outline. */
export function pointsOf(reply: JsonObject): [number, number][] | null {
  if (!Array.isArray(reply['subpaths'])) return null;
  const out: [number, number][] = [];
  for (const s of reply['subpaths']) for (const p of Array.isArray(s) ? s : []) if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number') out.push([p[0], p[1]]);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// A film recipe's expansion (README: The expansion), off the `deep show` reply's `expansions`.

export interface Rows { rows: JsonObject[]; derived: Record<string, JsonObject>; markers: Record<string, { t: number; span: number }>; shots: Record<string, JsonObject>; transitions: Record<string, JsonObject> }
/** The rows of `instance` and of every instance it derives (`<instance>.…`), with their derived items, markers, shots
 * and transitions merged; times resolved to flicks. */
export function expansionOf(reply: JsonObject, instance: string, what: string): Rows {
  const all = arr(reply['expansions'], `${what}: the deep show reply's expansions`).filter(isObject);
  const rows = all.filter((e) => e['instance'] === instance || (typeof e['instance'] === 'string' && e['instance'].startsWith(`${instance}.`)));
  expect(rows.some((e) => e['instance'] === instance), `${what}: the reply's expansions hold a row for ${instance}; instances: ${brief(all.map((e) => e['instance'] ?? null))}`).toBe(true);
  const out: Rows = { rows, derived: {}, markers: {}, shots: {}, transitions: {} };
  for (const r of rows) {
    if (isObject(r['derived'])) for (const [id, item] of Object.entries(r['derived'])) if (isObject(item)) out.derived[id] = item;
    if (isObject(r['markers'])) {
      for (const [name, m] of Object.entries(r['markers'])) {
        const mo = obj(m, `${what}: markers.${name}`);
        const t = flicksOf(mo['t']); const span = flicksOf(mo['span'] ?? 0);
        expect(t !== null && span !== null, `${what}: markers.${name} has t and span in whole flicks, got ${brief(mo)}`).toBe(true);
        out.markers[name] = { t: t!, span: span! };
      }
    }
    for (const section of ['shots', 'transitions'] as const) if (isObject(r[section])) for (const [id, e] of Object.entries(r[section])) if (isObject(e)) out[section][id] = e;
  }
  return out;
}
/** A cue's window from its marker `cues.<id>`: start and end in flicks. */
export function cueWindow(e: Rows, cue: string, what: string): { start: number; end: number } {
  const m = e.markers[`cues.${cue}`];
  expect(m, `${what}: the expansion writes the marker cues.${cue}; it writes ${Object.keys(e.markers).join(', ') || 'none'}`).toBeDefined();
  return { start: m!.t, end: m!.t + m!.span };
}
/** The one derived item whose `params.text` is `text` (README: Derived items), or why there isn't one. */
export function itemDrawing(e: Rows, text: string): { id: string } | { why: string } {
  const ids = Object.entries(e.derived).filter(([, item]) => isObject(item['params']) && item['params']['text'] === text).map(([id]) => id);
  return ids.length === 1 ? { id: ids[0]! } : { why: `${ids.length} derived items draw ${JSON.stringify(text)}${ids.length ? `: ${ids.join(', ')}` : ''}, not one` };
}
/** Every word the expansion draws: each derived item's `params.text`, sorted. */
export const wordsOf = (e: Rows): string[] => Object.values(e.derived).flatMap((i) => (isObject(i['params']) && typeof i['params']['text'] === 'string' ? [i['params']['text']] : [])).sort();
/** Each `cue.kind@1` entry's class (`value.class`), by name, from a `registries` reply (#200, #222). */
export function classesOf(reply: JsonObject): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of arr(reply['registries'], 'registries: registries').filter(isObject)) {
    if (row['name'] !== 'cue.kind@1') continue;
    for (const e of (Array.isArray(row['entries']) ? row['entries'] : []).filter(isObject)) {
      if (typeof e['name'] === 'string' && isObject(e['value']) && typeof e['value']['class'] === 'string') out.set(e['name'], e['value']['class']);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The recipes and their examples (README: The pack; The examples).

export const RECIPES = ['dark_math', 'keynote_ui', 'chart_story', 'infographic', 'evidence_board', 'whiteboard', 'storytime', 'kinetic_type', 'presenter', 'linear_map'] as const;
export type Recipe = (typeof RECIPES)[number];
export const kindOf = (r: string): string => `explain.${r}@1`;
/** The recipes with a 3D stage: every one but explain.linear_map. */
export const STAGED_3D: readonly Recipe[] = RECIPES.filter((r) => r !== 'linear_map');
/** The six grammar rules' codes (README: Rule codes and refusals). */
export const RULES = {
  oneEntrance: 'explain.one_entrance',
  mainWord: 'explain.main_word_size',
  onBeat: 'explain.on_beat',
  still: 'explain.still_once_landed',
  exitFaster: 'explain.exit_faster',
  section: 'explain.section_length',
} as const;
/** The envelope fields an example may carry beside its one item: nothing hand-written (no channels, shots, markers,
 * transitions, drivers or other maps keyed by ID). */
export const ENVELOPE = ['format', 'profile', 'title', 'description', 'size', 'safe', 'aspect', 'transport', 'look', 'camera', 'locale', 'requires', 'packs', 'tempo_map', 'seed', 'assets', 'items'] as const;
export const examplePath = (r: string): string => join(EXPLAIN.dir, 'examples', `${r}.json`);
export interface Example { recipe: Recipe; doc: JsonObject; instance: string; item: JsonObject; cues: JsonObject[] }
/** An example as the pack ships it, or the reasons it can't be used. */
export function exampleOf(recipe: Recipe): Example | string[] {
  const path = examplePath(recipe);
  if (!existsSync(path)) return [`${recipe}: no example at ${relative(REPO, path)}`];
  let doc: JsonValue;
  try { doc = JSON.parse(readFileSync(path, 'utf8')) as JsonValue; } catch (e) { return [`${recipe}: the example is not JSON: ${(e as Error).message}`]; }
  if (!isObject(doc)) return [`${recipe}: the example is not an object`];
  const items = isObject(doc['items']) ? Object.entries(doc['items']) : [];
  if (items.length !== 1 || !isObject(items[0]![1])) return [`${recipe}: the example holds ${items.length} items, not one`];
  const [instance, item] = items[0]! as [string, JsonObject];
  const params = isObject(item['params']) ? item['params'] : {};
  const cues = Array.isArray(params['cues']) ? params['cues'].filter(isObject) : [];
  return { recipe, doc, instance, item, cues };
}
/** The example on a stage: only `params.stage` changes. */
export function onStage(doc: JsonObject, stage: '2d' | '3d'): JsonObject {
  const out = JSON.parse(JSON.stringify(doc)) as JsonObject;
  for (const item of Object.values(obj(out['items'], 'items'))) if (isObject(item) && isObject(item['params'])) item['params']['stage'] = stage;
  return out;
}
/** A JSON value's compact UTF-8 size in bytes. */
export const bytesOf = (v: JsonValue): number => Buffer.byteLength(JSON.stringify(v), 'utf8');

/** Rust sources under crates/ outside tests (a `tests` or `benches` folder, and everything from a file's first
 * `#[cfg(test)]` on) that hold any of `needles`: film-specific code (criterion 1), or a test pack's name in a canvas
 * module (criterion 10). */
export function rustNaming(needles: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (['target', 'node_modules', 'tests', 'benches'].includes(name)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.rs')) {
        const text = readFileSync(p, 'utf8').split('#[cfg(test)]')[0]!;
        for (const n of needles) if (text.includes(n)) found.push(`${relative(REPO, p)} names ${n}`);
      }
    }
  };
  walk(join(REPO, 'crates'));
  return found;
}
/** Every file under `dir`, relative to it. */
export function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p)); } };
  if (existsSync(dir)) walk(dir);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The tempo map (#491's `tempo_map`; Tempo map and cue alignment): beat and bar times in flicks.

/** Every bar line of `tempo_map` up to `until` flicks: segments chain; beat x of a segment lands at t0 + 60·x ÷ b0, or
 * with a ramp linear in beats at t0 + 60·N ÷ (b1 − b0) · ln(bpm(x) ÷ b0). Null when the map can't be read. */
export function barLines(map: JsonValue | undefined, until: number): number[] | null {
  if (!isObject(map) || !Array.isArray(map['segments']) || map['segments'].length === 0) return null;
  const out: number[] = [];
  let t0 = 0;
  for (const [i, s] of map['segments'].entries()) {
    if (!isObject(s) || typeof s['bpm'] !== 'number' || typeof s['span'] !== 'number' || !Array.isArray(s['meter']) || typeof s['meter'][0] !== 'number') return null;
    if (i === 0 && s['at'] !== undefined) { const at = flicksOf(s['at']); if (at === null) return null; t0 = at; }
    const b0 = s['bpm']; const n = s['span']; const perBar = s['meter'][0];
    const b1 = isObject(s['ramp']) && typeof s['ramp']['to_bpm'] === 'number' ? s['ramp']['to_bpm'] : b0;
    const at = (x: number): number => t0 + FLICKS * (b1 === b0 ? (60 * x) / b0 : ((60 * n) / (b1 - b0)) * Math.log((b0 + ((b1 - b0) * x) / n) / b0));
    for (let x = 0; x <= n + 1e-9; x += perBar) { const t = at(x); if (t > until) return out; out.push(t); }
    t0 = at(n);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Fixture films (README: Fixtures). Every one is 640 × 360 u, as your shell sends it (no id, no layers), names the
// explain pack and carries a tempo map of 120 BPM in 4/4 from 0 s: a beat every 0.5 s, a bar every 2 s.

export const TEMPO_120: JsonObject = { segments: [{ at: '0s', bpm: 120, meter: [4, 4], span: 64 }] };
export const INSTANCE = 'film';
/** A film holding one instance `film` of `explain.<recipe>@1` with `params`. */
export function explainFilm(title: string, recipe: Recipe, params: JsonObject, span: number): JsonObject {
  return {
    format: 1, profile: 'film', title, description: `${title}: a fixture film of the #142 acceptance suite.`, size: [640, 360],
    transport: { span: secs(span) }, tempo_map: TEMPO_120, packs: [EXPLAIN_AT],
    items: { [INSTANCE]: { id: INSTANCE, kind: kindOf(recipe), name: 'Film', order: 'a0', params } },
  };
}
/** A cue entering one word over `span` s, by the first-party `fade_in` (an entrance). */
export const enter = (id: string, text: string, span = 0.5, more: JsonObject = {}): JsonObject => ({ id, kind: 'fade_in', text, span: secs(span), ...more });
/** A kinetic-type film on the 2D stage from `cues`. */
export const kinetic = (title: string, cues: JsonObject[], span = 4): JsonObject => explainFilm(title, 'kinetic_type', { cues, stage: '2d' }, span);

// ---------------------------------------------------------------------------------------------------
// explain.linear_map (README: explain.linear_map): its fixture films, its derived items, and plane coordinates.

/** The derived items the tests read, by ID (README: explain.linear_map's derived items). */
export const LM = { moving: `${INSTANCE}.moving`, grid: `${INSTANCE}.grid`, i: `${INSTANCE}.i_hat`, j: `${INSTANCE}.j_hat`, area: `${INSTANCE}.area` } as const;
/** A cue applying `matrix` (by rows) over `span` s. */
export const apply = (id: string, matrix: [[number, number], [number, number]], span = 1): JsonObject => ({ id, kind: 'explain.apply', params: { matrix }, span: secs(span) });
/** A linear_map film: the plane x −4…4, y −3…3, the basis and the unit square on, with `more` inputs. */
export function linearFilm(title: string, cues: JsonObject[], more: JsonObject = {}, span = 3): JsonObject {
  return explainFilm(title, 'linear_map', { plane: { x: [-4, 4], y: [-3, 3] }, basis: true, square: true, ghosts: false, cues, stage: '2d', ...more }, span);
}
export interface Plane { ox: number; oy: number; unit: number; up: boolean }
/** The moving plane's mapping from plane coordinates to document u: its warp's `plane` (Frame and group: warp:
 * origin [0, 0], unit 100, y up by default), the group carrying no `at`. */
export function planeOf(e: Rows, what: string): Plane {
  const g = obj(e.derived[LM.moving], `${what}: the derived group ${LM.moving}`);
  const warp = obj(obj(g['params'], `${what}: ${LM.moving}.params`)['warp'], `${what}: ${LM.moving}'s warp`);
  const p = isObject(warp['plane']) ? warp['plane'] : {};
  const o = Array.isArray(p['origin']) && typeof p['origin'][0] === 'number' && typeof p['origin'][1] === 'number' ? [p['origin'][0], p['origin'][1]] : [0, 0];
  return { ox: o[0]!, oy: o[1]!, unit: typeof p['unit'] === 'number' ? p['unit'] : 100, up: p['y'] !== 'down' };
}
/** A point in document u, in the plane's coordinates. */
export const toPlane = (pl: Plane, [x, y]: [number, number]): [number, number] => [(x - pl.ox) / pl.unit, ((pl.up ? -1 : 1) * (y - pl.oy)) / pl.unit];
/** An arrow's tip: the drawn point farthest from the plane's origin, in plane coordinates. */
export function tipOf(pl: Plane, points: [number, number][]): [number, number] {
  let best: [number, number] = [NaN, NaN]; let far = -1;
  for (const p of points) { const q = toPlane(pl, p); const d = Math.hypot(q[0], q[1]); if (d > far) { far = d; best = q; } }
  return best;
}
/** The two-decimal numbers a readout's shown text holds, such as ["1.00"]. */
export const readings = (text: string): string[] => [...text.matchAll(/(?<![\d.\-−])\d+\.\d{2}(?!\d)/g)].map((m) => m[0]);

// ---------------------------------------------------------------------------------------------------
// The test pack acme/acme (README: The test pack), written at test time: the film recipe and pack kind acme.slides,
// its rule acme.one_entrance over its cue list, a clean example and the rule's planted twin, both by hash.

export const SLIDES = 'acme.slides';
export const ACME_RULE = 'acme.one_entrance';
/** A film holding one acme.slides@1 instance `deck` with `cues`. */
export function slidesFilm(title: string, cues: JsonObject[]): JsonObject {
  return {
    format: 1, profile: 'film', title, description: `${title}: a film of the #142 acceptance suite's test pack.`, size: [640, 360],
    transport: { span: '2s' }, packs: ['acme/acme@1.0.0', VERBS_AT],
    items: { deck: { id: 'deck', kind: `${SLIDES}@1`, name: 'Deck', order: 'a0', params: { cues } } },
  };
}
/** Two slides one after the other: the clean twin. */
export const SLIDES_CLEAN: JsonObject[] = [enter('slide_one', 'ONE'), enter('slide_two', 'TWO')];
/** Two slides entering together: the planted twin of acme.one_entrance, naming slide_two. */
export const SLIDES_OVERLAP: JsonObject[] = [enter('slide_one', 'ONE'), enter('slide_two', 'TWO', 0.5, { when: 'with' })];
export function writeSlides(root: string): Pack {
  const dir = join(root, 'acme-1.0.0');
  mkdirSync(join(dir, 'examples'), { recursive: true });
  const asset = (name: string, doc: JsonObject): { path: string; sha256: string; size: number; license: string } => {
    const bytes = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`);
    writeFileSync(join(dir, 'examples', name), bytes);
    return { path: `examples/${name}`, sha256: sha256(bytes), size: bytes.length, license: 'MIT' };
  };
  const clean = asset('clean.json', slidesFilm('Two slides in turn', SLIDES_CLEAN));
  const twin = asset('overlap.json', slidesFilm('Two slides at once', SLIDES_OVERLAP));
  const pack = {
    name: 'acme', version: '1.0.0', license: 'MIT',
    description: 'A test pack of the #142 acceptance suite, by an outside owner: the film recipe acme.slides, a pack kind whose grammar rule is one entrance at a time.',
    requires: { core: '>=0.0.0', modules: { motion: '>=0.0.0', marks2d: '>=0.0.0' }, packs: [VERBS_AT] },
    recipes: { [`${SLIDES}@1`]: `${SLIDES}@1.json` },
    kinds: {
      [`${SLIDES}@1`]: {
        minor: 0, recipe: `${SLIDES}@1`, children: [], capabilities: { pickable: false, snap: false },
        rules: [{
          code: ACME_RULE, over: 'cues', at: 'rest',
          expr: '!(cue.class == enter && other.class == enter && other.start < cue.end && cue.start < other.end)',
          fix: 'Start each entrance after the one before it has landed.',
        }],
        twins: [{ example: twin.sha256, expect: ACME_RULE }],
        migrate: {}, examples: [clean.sha256],
        cost: { class: 'figure', at_defaults: { cpu_ms: 0.5, gpu_ms: 0.2, items: 8 } },
      },
    },
    assets: [clean, twin],
  };
  const recipe = {
    id: SLIDES, version: '1.0', title: 'Slides', license: 'MIT', author: 'the #142 acceptance suite',
    description: 'A film recipe of a test pack: one title per cue of its cue list, drawn on the 2D stage.',
    inputs: {
      cues: { type: 'records', default: [], about: 'the cue list, a cues@1 list whose cues carry text' },
      stage: { type: 'choice', options: ['2d', '3d'], default: '2d', about: 'the stage the slides play on' },
    },
    steps: {
      title: { op: 'mark', kind: 'text@1', repeat: { over: 'cues', as: 'c' }, params: { text: 'c.text', font: 'body', size: 48 }, at: { pos: [64, 160, 0] } },
    },
  };
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
  writeFileSync(join(dir, `${SLIDES}@1.json`), `${JSON.stringify(recipe, null, 2)}\n`);
  return { id: 'acme/acme', version: '1.0.0', dir };
}

// ---------------------------------------------------------------------------------------------------
// Pictures: the snapshot of an `eval` reply, read back from the scenario's evidence store (#421's PNG reader).

export interface Image { width: number; height: number; rgba: Uint8Array }
/** The snapshot's SHA-256 in an `eval` reply with `pixels`. */
export function snapshotOf(reply: JsonObject, what: string): string {
  const list = arr(evaluated(reply, what)['snapshots'], `${what}: snapshots`);
  expect(list.length, `${what}: one snapshot`).toBe(1);
  return str(obj(list[0], `${what}: snapshots[0]`)['sha256'], `${what}: the snapshot's sha256`);
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let p = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (p < file.length) {
    const len = file.readUInt32BE(p); const type = file.toString('latin1', p + 4, p + 8); const body = file.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      line[i] = (filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) rgba[(y * width + x) * 4 + k] = line[x * channels + k]!;
      rgba[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
const stored = (evidence: string, sha: string): string => join(evidence, sha.slice(0, 2), sha.slice(2));
/** A snapshot's PNG bytes from the evidence store, checked against its name. */
export function pngOf(evidence: string, sha: string, what: string): Buffer {
  const path = stored(evidence, sha);
  expect(existsSync(path), `${what}: the snapshot ${sha} is in the evidence store`).toBe(true);
  const file = readFileSync(path);
  expect(sha256(file), `${what}: the stored file hashes to its name`).toBe(sha);
  return file;
}
export const pictureOf = (evidence: string, sha: string, what: string): Image => decodePng(pngOf(evidence, sha, what));
export const rgbAt = (img: Image, x: number, y: number): [number, number, number] => {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!];
};
/** The share of pixels that differ from the picture's most common color by more than 24 in some channel. */
export function drawnShare(img: Image): number {
  const counts = new Map<number, number>();
  for (let i = 0; i < img.width * img.height; i++) { const k = (img.rgba[i * 4]! << 16) | (img.rgba[i * 4 + 1]! << 8) | img.rgba[i * 4 + 2]!; counts.set(k, (counts.get(k) ?? 0) + 1); }
  let mode = 0; let most = -1;
  for (const [k, c] of counts) if (c > most) { most = c; mode = k; }
  const m = [(mode >> 16) & 255, (mode >> 8) & 255, mode & 255];
  let n = 0;
  for (let i = 0; i < img.width * img.height; i++) if ([0, 1, 2].some((c) => Math.abs(img.rgba[i * 4 + c]! - m[c]!) > 24)) n++;
  return n / (img.width * img.height);
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([head, typed, crc]);
}
const scanlines = (img: Image): Buffer => {
  const out = Buffer.alloc(img.height * (img.width * 4 + 1));
  for (let y = 0; y < img.height; y++) Buffer.from(img.rgba.subarray(y * img.width * 4, (y + 1) * img.width * 4)).copy(out, y * (img.width * 4 + 1) + 1);
  return out;
};
/** An animated PNG of `frames` (each the canvas's own frame, unchanged) at `fps`, played once. */
export function apng(frames: Image[], fps: number): Buffer {
  const first = frames[0]!;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(first.width, 0); ihdr.writeUInt32BE(first.height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(1, 4);
  const parts: Buffer[] = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(f.width, 4); fctl.writeUInt32BE(f.height, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const data = deflateSync(scanlines(f));
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
/** Where the taste call's files are kept: DEEPBUILD_EVIDENCE_DIR, else a folder under the temporary folder. */
export const evidenceDir = (): string => process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-142-taste');
/** A picture size `width` px wide in the document's own aspect. */
export function sizeFor(doc: JsonObject, width = 640): [number, number] {
  const s = Array.isArray(doc['size']) && typeof doc['size'][0] === 'number' && typeof doc['size'][1] === 'number' ? [doc['size'][0], doc['size'][1]] : [1920, 1080];
  return [width, Math.max(1, Math.round((width * s[1]!) / s[0]!))];
}

// ---------------------------------------------------------------------------------------------------
// Budgets: the perf lane's rule, scripts/benchmark.mjs's judgeLimit and fingerprint, imported, never copied; and
// `deep-gpu run` (#377's binary) for #1899's frame budget.

export const load = (): number => loadavg()[0]!;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
/** One `deep-gpu run` scenario `{out, calls}`: its replies, one per call. */
export function runGpu(bin: string, calls: JsonObject[], what: string): JsonObject[] {
  const out = mkdtempSync(join(tmpdir(), 'deep-142-gpu-'));
  try {
    const s = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
    expect(s.error?.message ?? '', `deep-gpu run (${what}) started and finished within its timeout`).toBe('');
    expect(s.status, `deep-gpu run (${what}) exited 0; stdout: ${(s.stdout ?? '').slice(0, 1500)}; stderr: ${(s.stderr ?? '').slice(-3000)}`).toBe(0);
    const lines = (s.stdout ?? '').split('\n').filter((l) => l !== '');
    const a = obj(JSON.parse(lines[0] ?? 'null') as JsonValue, `deep-gpu run (${what}): the answer`);
    expect(a['ok'], `deep-gpu run (${what}) accepted the scenario: ${brief(a, 2000)}`).toBe(true);
    return arr(a['replies'], `deep-gpu run (${what}): replies`).map((r, i) => obj(r, `deep-gpu run (${what}): replies[${i}]`));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
/** The look definition a frame-budget run draws an example under: the shipped look its recipe names in
 * `params.look` (README: The recipes' inputs), read where the base keeps shipped looks; `clean` when it names none. */
export function lookOf(ex: Example): JsonObject {
  const id = typeof ex.item['params'] === 'object' && isObject(ex.item['params']) && typeof ex.item['params']['look'] === 'string' ? ex.item['params']['look'] : 'clean';
  const path = join(REPO, 'crates', 'deep-canvas-marks', 'looks', `${id}.json`);
  expect(existsSync(path), `${ex.recipe}: its look ${id} is a shipped look (${relative(REPO, path)})`).toBe(true);
  return obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, `the look ${id}`);
}
