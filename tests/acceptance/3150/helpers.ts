// Test-side tools for the #3150 acceptance tests: cargo in the checkout (the full `deep-show`, built once per file, and
// deep-show's named unit test), `deep-show run` with one scenario of calls (deep_kinds, and the agent's deep_show of a
// document with its issues, as the hub's canvas core plays them), and the issue's expected forms. Nothing here stands in
// for deep_kinds, the document check or the unit test: every answer read here is the binary's or cargo's own.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/3150 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The kind, its two fields, and the forms the issue's fix says each is declared as (README: Readings). */
export const KIND = 'cut.words@1';
export const RECORDING_FORM = 'name';
export const KEEP_FORM = '[index | [first: index, last: index]]';
/** deep-show's unit test the issue names, as cargo test names it in the deep-show binary's tests. */
export const UNIT_TEST = 'kinds::tests::every_structured_field_prints_forms_that_take_its_own_values';

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);

// ---------------------------------------------------------------------------------------------------
// cargo, in the checkout's own target folder (CARGO_TARGET_DIR dropped), CARGO_INCREMENTAL=0 and no debug info unless set.

const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
export interface CargoRun { status: number | null; stdout: string; stderr: string; error?: string }
export function cargo(args: string[]): CargoRun {
  const env: NodeJS.ProcessEnv = { ...process.env, ...CARGO_ENV };
  delete env['CARGO_TARGET_DIR'];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ...(r.error ? { error: r.error.message } : {}) };
}
/** cargo's stderr without its progress lines, its last 4,000 characters. */
export const cargoErrors = (r: CargoRun): string =>
  (r.error ?? '') + r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking|Updating|Running/.test(l)).join('\n').slice(-4000);

/** Folders under /tmp/dh3150-*, each removed after its file. */
const made: string[] = [];
export function tempDir(tag: string): string {
  const d = realpathSync(mkdtempSync(join('/tmp', `dh3150-${tag}-`)));
  made.push(d);
  return d;
}

/**
 * Builds the full `deep-show` once for the file (`cargo build --locked --bin deep-show`, default features: full); the
 * getter fails a test, naming the build, when it didn't build, and gives target/debug/deep-show.
 */
export function useFullBuild(): () => string {
  let error = 'not built';
  beforeAll(() => {
    const r = cargo(['build', '--locked', '--bin', 'deep-show']);
    error = r.status === 0 ? '' : `cargo build --locked --bin deep-show failed:\n${cargoErrors(r)}`;
  }, 7_200_000);
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, 60_000);
  return () => {
    expect(error, 'the full build of deep-show compiles').toBe('');
    const bin = join(REPO, 'target', 'debug', 'deep-show');
    expect(existsSync(bin) && statSync(bin).isFile(), `${bin} is built`).toBe(true);
    return bin;
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario in, one JSON line out with a reply per call.

/** `deep-show run` with one scenario (`calls` and `world`, the scenario's other fields): one reply per call. */
export function run(bin: string, calls: JsonObject[], world: JsonObject = {}): JsonObject[] {
  const input = `${JSON.stringify({ evidence: tempDir('ev'), ...world, calls })}\n`;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const stdout = r.stdout ?? '';
  expect(r.error, `deep-show run started and finished within its timeout: ${String(r.error)}`).toBeUndefined();
  expect(r.status, `deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `deep-show run: one output line per input line: ${stdout.slice(0, 1500)}`).toBe(1);
  const out = JSON.parse(lines[0]!) as JsonValue;
  expect(isObject(out) && out['ok'] === true, `deep-show run took the scenario: ${show(out)}`).toBe(true);
  const replies = (out as JsonObject)['replies'];
  expect(Array.isArray(replies) && replies.length === calls.length, `deep-show run: one reply per call: ${show(replies, 600)}`).toBe(true);
  return (replies as JsonValue[]).map((x) => (isObject(x) ? x : { reply: x }));
}

// ---------------------------------------------------------------------------------------------------
// deep_kinds `op: field` (#1971): one line, the listing's row for the field, whose `forms` deep_kinds prints (#1973).

export const fieldCall = (path: string): JsonObject => ({ call: 'deep_kinds', op: 'field', path });

/** The one line of a one-field answer, or why there is none to read. */
export function lineOf(reply: JsonObject): JsonObject | string {
  const e = reply['error'];
  if (isObject(e)) return `refused: ${String(e['code'])} at ${String(e['path'])}: ${String(e['remediation'] ?? '')}`;
  const lines = reply['lines'];
  if (!Array.isArray(lines)) return `the answer holds no lines: ${show(reply, 600)}`;
  if (lines.length !== 1) return `the answer holds ${lines.length} lines, not one: ${show(lines, 600)}`;
  const l = lines[0];
  if (isObject(l)) return l;
  if (typeof l === 'string') { try { const v = JSON.parse(l) as JsonValue; if (isObject(v)) return v; } catch { /* below */ } }
  return `its line is not one JSON object: ${show(l, 300)}`;
}

// ---------------------------------------------------------------------------------------------------
// The document check: the agent's deep_show of a whole revision with its issues (#393), on `deep-show run`.

const SESSION = { id: 'sess-3150', thread: 'thread-3150', name: 'An agent cutting a recording by its words', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** A document ID the hub minted: a ULID. */
export const docId = (n: number): string => `01JD3150D${String(n).padStart(17, '0')}`;
/** The scenario's world for `docs`: the agent's session, its process tree, one panel per document. */
export function showWorld(docs: readonly string[]): JsonObject {
  const panels: JsonObject = {};
  const out: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] }; out[d] = { panel: `p${i + 1}` }; });
  return { sessions: { [SESSION.id]: { thread: SESSION.thread, name: SESSION.name, process: SESSION.process } }, processes: PROCESSES, panels, docs: out };
}
/** The agent's deep_show of `document` as a revision of `doc`, with its issues. */
export const showCall = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION.id, doc, document, include: ['issues'] });

/** The item holding the cut, and the path its keep is at. */
export const ITEM = 'cut';
export const KEEP_PATH = `items/${ITEM}/params/keep`;
/**
 * A sound-only film (#1518's suite's shape): one asset `rec` and one `cut.words@1` item `cut` with `recording: "rec"`
 * and `keep` set, its other params left at their defaults. The asset's bytes are in no store: the check's verdict on
 * `keep` comes before and apart from any read of the recording.
 */
export function cutFilm(keep: JsonValue): JsonObject {
  const sha256 = createHash('sha256').update('the #3150 acceptance tests\' recording, never stored').digest('hex');
  return {
    format: 1, id: 'cut3150', profile: 'film', title: 'A recording cut by its words', description: 'A recording cut by its words, for the #3150 acceptance tests.',
    size: [64, 64], requires: { modules: { media: '^1' } }, transport: { span: '2s', frame_rate: [24, 1], sample_rate: 48_000 },
    items: { [ITEM]: { id: ITEM, kind: KIND, name: 'Cut by words', order: 'a1', params: { recording: 'rec', keep } } },
    assets: { rec: { sha256, license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #3150 acceptance tests.' } } },
  };
}

export interface Issue { code: string; severity: string; path: string; raw: JsonObject }
export function issuesOf(reply: JsonObject): Issue[] {
  const list = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return list.map((o) => ({ code: String(o['code']), severity: String(o['severity']), path: typeof o['path'] === 'string' ? o['path'] : '', raw: o }));
}
/** The error issues at `keep` or inside it. */
export const keepErrors = (reply: JsonObject): Issue[] =>
  issuesOf(reply).filter((i) => i.severity === 'error' && (i.path === KEEP_PATH || i.path.startsWith(`${KEEP_PATH}/`)));
