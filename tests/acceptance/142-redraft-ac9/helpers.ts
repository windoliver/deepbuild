// Test-side tools for the blind redraft of #142's criterion 9: `deep-show` built once per file and driven by JSON
// lines (#393's `deep-show run`: `deep show`, `eval` with `texts`, the scenario's `packs` and `planted`); the
// explain.dark_math fixture films; the reader for a film recipe's expansion rows and their cue markers. Nothing here
// stands in for a recipe or the evaluation: every value a test compares comes from the binary, and every expected
// value from the issue or the design. Parts are copied from the first draft's helpers (tests/acceptance/142), since
// suites don't import each other.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/142-redraft-ac9 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** The criterion's ID: `#142.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC9 = 'AC9 #142.30bc3e5b';

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

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): replies carry times as integer flicks or as the time grammar's "<decimal>s".

export const FLICKS = 705_600_000;
/** One frame of the fixture films, which run at the default 60 frames a second. */
export const FRAME = FLICKS / 60;
export const showTime = (f: number): string => `${(f / FLICKS).toFixed(4)} s (${f} flicks)`;
/** A time as a reply writes it, in exact flicks: an integer is flicks, `"<decimal>s"` is seconds; else null. */
export function flicksOf(v: JsonValue | undefined): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?s$/.exec(v.trim());
  if (!m) return null;
  const frac = m[3] ?? '';
  const scaled = BigInt(`${m[2]!}${frac}`) * BigInt(FLICKS);
  const den = 10n ** BigInt(frac.length);
  if (scaled % den !== 0n) return null;
  const out = Number(scaled / den);
  return m[1] === '-' ? -out : out;
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` with the `full` set, debug, once per file.

const SHOW = 'deep-show';
const SHOW_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];

function buildShow(dir: string): { bin: string; error: string } {
  const r = spawnSync('cargo', SHOW_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return { bin: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { bin: '', error: `cargo ${SHOW_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const out = join(dir, `${SHOW}-full`);
  copyFileSync(join(TARGET, 'debug', SHOW), out);
  return { bin: out, error: '' };
}

/** `cargo build --locked --bin deep-show --no-default-features --features full`, once per file, in beforeAll. */
export function useShow(): () => string {
  let dir = '';
  let built = { bin: '', error: 'not built' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-142-ac9-bin-'));
    built = buildShow(dir);
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(built.error, `the binary builds: cargo ${SHOW_ARGS.join(' ')}`).toBe(''); return built.bin; };
}
/** Fresh folders for a test (evidence stores), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-142-ac9-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
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

/** A pack folder offered to the scenario's store (#306). */
interface Pack { id: string; version: string; dir: string }
/** The first-party pack of film recipes (the first draft's README: The pack). */
const EXPLAIN: Pack = { id: 'deepbuild/explain', version: '1.0.0', dir: join(REPO, 'packs', 'explain-1.0.0') };
/** The first-party verbs (#222), whose `fade_in` the fixtures' cues play. */
const VERBS: Pack = { id: 'deepbuild/verbs', version: '1.0.0', dir: join(REPO, 'packs', 'verbs-1.0.0') };

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: film recipes', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB142D', n);

/** A scenario: your shell's process tree, alpha's session, one panel, every document a call names, the explain pack and
 * the verbs offered before the first call, and the scenario's planted program when one is named. */
export function scenario(evidence: string, calls: JsonObject[], planted?: string): JsonObject {
  const docs: JsonObject = {};
  for (const c of calls) if (typeof c['doc'] === 'string') docs[c['doc']] = { panel: 'main' };
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1920, 1080] } },
    docs,
    packs: [EXPLAIN, VERBS].map((p) => ({ id: p.id, dir: p.dir })),
    ...(planted ? { planted } : {}),
    calls,
  };
}

/** `deep show` of a whole document from your shell. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
/** The reply's error issues. */
export const errors = (reply: JsonObject): JsonObject[] => (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
/** #387's `eval` at `t` flicks with `texts`: each drawn text's shown string, by item, for every text drawn at an
 * opacity above 0. */
export const textsAt = (doc: string, t: number): JsonObject => ({ call: 'eval', doc, t, texts: true });
/** Whether an `eval` reply with `texts` shows `word` as some drawn text's whole string. */
export function shows(reply: JsonObject, word: string, what: string): boolean {
  expect(reply['outcome'], `${what} is evaluated: ${brief(reply, 800)}`).toBe('evaluated');
  return Object.values(obj(reply['texts'], `${what}: texts`)).some((t) => t === word);
}

// ---------------------------------------------------------------------------------------------------
// A film recipe's expansion, off the `deep show` reply's `expansions` (the first draft's README: The expansion): the
// rows of the instance and of every instance it derives (`<instance>.…`, such as a `cues@1` list it writes), whose
// `markers` hold each cue's `cues.<id>` marker `{t, span}` with every time resolved.

export interface Marker { t: number; span: number }
export function markersOf(reply: JsonObject, instance: string, what: string): Record<string, Marker> {
  const all = arr(reply['expansions'], `${what}: the deep show reply's expansions`).filter(isObject);
  const rows = all.filter((e) => e['instance'] === instance || (typeof e['instance'] === 'string' && e['instance'].startsWith(`${instance}.`)));
  expect(rows.some((e) => e['instance'] === instance), `${what}: the reply's expansions hold a row for ${instance}; instances: ${brief(all.map((e) => e['instance'] ?? null))}`).toBe(true);
  const out: Record<string, Marker> = {};
  for (const r of rows) {
    if (!isObject(r['markers'])) continue;
    for (const [name, m] of Object.entries(r['markers'])) {
      const mo = obj(m, `${what}: markers.${name}`);
      const t = flicksOf(mo['t']); const span = flicksOf(mo['span'] ?? 0);
      expect(t !== null && span !== null, `${what}: markers.${name} has t and span in whole flicks, got ${brief(mo)}`).toBe(true);
      out[name] = { t: t!, span: span! };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The fixture films: 640 × 360 u, 7 s, 120 BPM in 4/4 from 0 s (a beat every 0.5 s), one instance `film` of
// explain.dark_math@1 on the 2D stage. Each names the explain pack and the verbs whose `fade_in` its cues play.

export const INSTANCE = 'film';
const TEMPO_120: JsonObject = { segments: [{ at: '0s', bpm: 120, meter: [4, 4], span: 64 }] };
/** A dark-math film whose instance's params are `cues` and the 2D stage. */
export function darkMath(title: string, cues: JsonObject[]): JsonObject {
  return {
    format: 1, profile: 'film', title, description: `${title}: a fixture film of the film recipes acceptance suite.`, size: [640, 360],
    transport: { span: '7s' }, tempo_map: TEMPO_120, packs: [`${EXPLAIN.id}@${EXPLAIN.version}`, `${VERBS.id}@${VERBS.version}`],
    items: { [INSTANCE]: { id: INSTANCE, kind: 'explain.dark_math@1', name: 'Film', order: 'a0', params: { cues, stage: '2d' } } },
  };
}
/** A cue entering one word over 0.5 s by the first-party `fade_in` (an entrance), with `more` fields. */
export const enter = (id: string, text: string, more: JsonObject = {}): JsonObject => ({ id, kind: 'fade_in', text, span: '0.5s', ...more });
