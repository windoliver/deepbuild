// Shared helpers for #1963's acceptance tests (README: the surface, the documents and every stated choice). Copied and
// trimmed from #406's suite, which tested the same check. Node built-ins and vitest only. Every expected value is
// written here or in the tests from the issue and the design, never read from an implementation.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1963 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** A build's timeout: a first cargo build on a loaded Mac takes a while. */
export const BUILD_TIMEOUT = 3_600_000;
/** A test's timeout: the binary is built before the tests, so a test only spawns it. */
export const TIMEOUT = 300_000;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Lines `a` to `b` (1-based, inclusive) of `text`, each with its LF. */
export function linesOf(text: string, [a, b]: [number, number]): string {
  return text.split(/(?<=\n)/).slice(a - 1, b).join('');
}

// ---------------------------------------------------------------------------------------------------
// The build: each file builds `deep-canvas-render` once, before its tests, and copies the binary out of target/debug;
// a test whose build failed fails with cargo's error.

const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');

function cargoBuild(bin: string): string {
  const args = ['build', '--locked', '--bin', bin];
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status === 0) return '';
  const kept = run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating/.test(l));
  return `cargo ${args.join(' ')} failed:\n${kept.join('\n').slice(0, 4000)}`;
}

/** The checker binary, built once per file. */
export function useRender(): () => string {
  const bin = 'deep-canvas-render';
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1963-bins-'));
    error = cargoBuild(bin);
    if (error === '') copyFileSync(join(targetDir(), 'debug', bin), join(dir, bin));
  }, BUILD_TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, `the binary builds: ${bin}`).toBe('');
    return join(dir, bin);
  };
}

/** Per test: a fresh asset store and evidence store under one temporary folder, deleted after it. */
export interface Folders { store: string; evidence: string }
export function useFolders(prefix: string): () => Folders {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), `deep-1963-${prefix}-`)); mkdirSync(join(dir, 'store')); mkdirSync(join(dir, 'evidence')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => ({ store: join(dir, 'store'), evidence: join(dir, 'evidence') });
}

/** Puts bytes in the asset store (a folder whose files are named by the sha256 of their bytes) and answers the hash. */
export function put(f: Folders, bytes: Buffer): string {
  const sha = sha256(bytes);
  writeFileSync(join(f.store, sha), bytes);
  return sha;
}

/**
 * Keeps bytes as an evidence file and answers its handle, `ev:<sha256>` (technical design: handles). The request
 * carries them where a check may look an evidence file up by its sha256 (README: How evidence reaches the check): in
 * the asset store under the hash, and in the evidence store under `<first 2 hex>/<other 62 hex>`.
 */
export function keep(f: Folders, bytes: Buffer): string {
  const sha = put(f, bytes);
  mkdirSync(join(f.evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(f.evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return `ev:${sha}`;
}

/** One run of `bin args`, the inputs as JSON lines on stdin: one JSON line out per line in, exit 0. */
export function lines(bin: string, args: string[], inputs: JsonValue[]): JsonValue[] {
  const run = spawnSync(bin, args, { cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const name = `${bin.split('/').pop()} ${args.join(' ')}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  expect(run.status, `${name} exits 0: ${run.stderr.slice(-2000)}`).toBe(0);
  const out = run.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${name}: one output line per input line`).toBe(inputs.length);
  return out.map((l) => JSON.parse(l) as JsonValue);
}

// ---------------------------------------------------------------------------------------------------
// The check: `deep-canvas-render check {doc, look, store, evidence}` answers `{ok, issues, numbers, notices}`.

export interface Issue { code: string; severity: string; ids: string[]; raw: JsonObject }
export interface Checked { ok: boolean; issues: Issue[]; errors: Issue[]; raw: JsonObject }

/** The check's request line for `doc`, carrying both stores. */
export const request = (doc: JsonObject, f: Folders): JsonObject => ({ doc, look: 'clean', store: f.store, evidence: f.evidence });

/** Each document checked in turn by one run of the check, in one process. */
export function checkAll(render: string, docs: JsonObject[], f: Folders): Checked[] {
  return lines(render, ['check'], docs.map((d) => request(d, f))).map((out, i) => checkedOf(out, `check #${i + 1}`));
}
export const check = (render: string, doc: JsonObject, f: Folders): Checked => checkAll(render, [doc], f)[0] as Checked;

export function checkedOf(value: JsonValue | undefined, what: string): Checked {
  const raw = obj(value, what);
  expect(typeof raw['ok'], `${what} answers ok: ${JSON.stringify(raw).slice(0, 2000)}`).toBe('boolean');
  const issues = arr(raw['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], raw: o };
  });
  return { ok: raw['ok'] === true, issues, errors: issues.filter((i) => i.severity === 'error'), raw };
}

export const shownErrors = (c: { errors: Issue[] }): string => JSON.stringify(c.errors.map((e) => ({ code: e.code, ids: e.ids, path: e.raw['path'], actual: e.raw['actual'], what: e.raw['what'] }))).slice(0, 3000);
/** The errors with `code` that name `id`. */
export const naming = (c: Checked, code: string, id: string): Issue[] => c.errors.filter((e) => e.code === code && e.ids.includes(id));

/**
 * Whether an issue names line `n` (README: Where a line is named): outside its `fix`, some member whose key holds
 * `line` has the value `n`, or its `what` or `path` says `line n` (`line 11`, `line:11`, `#line:11`).
 */
export function namesLine(issue: Issue, n: number): boolean {
  const { fix: _fix, ...rest } = issue.raw;
  const byKey = (v: JsonValue | undefined): boolean => {
    if (Array.isArray(v)) return v.some(byKey);
    if (!isObject(v)) return false;
    return Object.entries(v).some(([k, x]) => (/line/i.test(k) && x === n) || byKey(x));
  };
  const said = new RegExp(`\\bline[\\s:#]*${n}(?!\\d)`, 'i');
  return byKey(rest) || [rest['what'], rest['path']].some((s) => typeof s === 'string' && said.test(s));
}

// ---------------------------------------------------------------------------------------------------
// Where a listing is read (#406's reading, kept). The design fixes the word (quotation) but no JSON path, so a number
// counts as listed when some object in the report, outside `issues`, holds the number's text as one of its own
// members and, in itself, its ancestors' own members or the keys on its path, the item's ID and the listing's word.

export function listing(c: Checked): JsonObject {
  const rest = clone(c.raw);
  delete rest['issues'];
  return rest;
}
export const shownListing = (c: Checked): string => JSON.stringify(listing(c)).slice(0, 3000);

interface Found { value: JsonObject; words: string[] }

function deepWords(v: JsonValue, out: string[]): void {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => deepWords(x, out));
  else if (isObject(v)) for (const [k, x] of Object.entries(v)) { out.push(k); deepWords(x, out); }
}
const ownWords = (o: JsonObject): string[] => Object.values(o).filter((x): x is string => typeof x === 'string');

function objects(v: JsonValue, context: string[], out: Found[]): void {
  if (Array.isArray(v)) { v.forEach((x) => objects(x, context, out)); return; }
  if (!isObject(v)) return;
  const inner: string[] = [];
  deepWords(v, inner);
  out.push({ value: v, words: [...context, ...inner] });
  const next = [...context, ...ownWords(v)];
  for (const [k, x] of Object.entries(v)) objects(x, [...next, k], out);
}

export function listed(c: Checked, item: string, text: string, word: RegExp): JsonObject[] {
  const found: Found[] = [];
  objects(listing(c), [], found);
  return found
    .filter((f) => Object.values(f.value).some((x) => x === text || (typeof x === 'number' && String(x) === text)))
    .filter((f) => f.words.some((w) => w === item || w.startsWith(`${item}#`)))
    .filter((f) => f.words.some((w) => word.test(w)))
    .map((f) => f.value);
}

// ---------------------------------------------------------------------------------------------------
// Documents: the design's envelope as #406's suite writes it.

/** A CC0 license for the fixtures' assets: they are written for this suite. */
export const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture.' };

export function envelope(id: string, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `Issue 1963 ${id}`, description: `Issue #1963 acceptance fixture ${id}.`, size: [960, 540],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
