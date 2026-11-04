// Shared helpers for #406's acceptance tests (README: the surfaces, the documents and every stated choice).
// Node built-ins and vitest only. Every expected value is written here or in the tests from the issue and the
// design, never read from an implementation.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/406 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** A build's timeout: a first cargo build of deep-gpu on a loaded Mac takes a while. */
export const BUILD_TIMEOUT = 3_600_000;
/** A test's timeout: the binaries are built before the tests, so a test only spawns them. */
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
export const fixtureBytes = (name: string): Buffer => readFileSync(join(HERE, 'fixtures', name));

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it uses once, before its tests, and copies the binary out of target/debug; a test
// that uses a build that failed fails with cargo's error.

export type Bin = 'deep-canvas-render' | 'deep-gpu';
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');

function cargoBuild(bin: Bin): string {
  const args = ['build', '--locked', '--bin', bin];
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status === 0) return '';
  const kept = run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating/.test(l));
  return `cargo ${args.join(' ')} failed:\n${kept.join('\n').slice(0, 4000)}`;
}

export function useBuilds(bins: Bin[]): (bin: Bin) => string {
  const made = new Map<Bin, { path: string; error: string }>();
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-406-bins-'));
    for (const bin of bins) {
      const error = cargoBuild(bin);
      const path = join(dir, bin);
      if (error === '') copyFileSync(join(targetDir(), 'debug', bin), path);
      made.set(bin, { path, error });
    }
  }, BUILD_TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return (bin) => {
    const entry = made.get(bin);
    if (!entry) throw Error(`the file didn't list the build ${bin}`);
    expect(entry.error, `the binary builds: ${bin}`).toBe('');
    return entry.path;
  };
}

/** A fresh temporary folder per test, deleted after it. */
export function useTemp(prefix: string): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), `deep-406-${prefix}-`)); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** Puts bytes in a store (a folder whose files are named by the sha256 of their bytes) and answers the hash. */
export function put(store: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  writeFileSync(join(store, sha), bytes);
  return sha;
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
// The check: `deep-canvas-render check {doc, look, store?}` answers `{ok, issues, numbers, notices}`.

export interface Issue { code: string; severity: string; ids: string[]; raw: JsonObject }
export interface Checked { ok: boolean; issues: Issue[]; errors: Issue[]; raw: JsonObject }

export function check(render: string, doc: JsonObject, store?: string): Checked {
  const [out] = lines(render, ['check'], [{ doc, look: 'clean', ...(store ? { store } : {}) }]);
  return checkedOf(out, 'check');
}

export function checkedOf(value: JsonValue | undefined, what: string): Checked {
  const raw = obj(value, what);
  expect(typeof raw['ok'], `${what} answers ok: ${JSON.stringify(raw).slice(0, 2000)}`).toBe('boolean');
  const issues = arr(raw['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], raw: o };
  });
  return { ok: raw['ok'] === true, issues, errors: issues.filter((i) => i.severity === 'error'), raw };
}

export const shownErrors = (c: { errors: Issue[] }): string => JSON.stringify(c.errors.map((e) => ({ code: e.code, ids: e.ids, path: e.raw['path'], actual: e.raw['actual'] }))).slice(0, 3000);
/** The report without its issues: what the check lists (README: Where a listing is read). */
export function listing(c: Checked): JsonObject {
  const rest = clone(c.raw);
  delete rest['issues'];
  return rest;
}
export const shownListing = (c: Checked): string => JSON.stringify(listing(c)).slice(0, 3000);
/** The errors with `code` that name `id`. */
export const naming = (c: Checked, code: string, id: string): Issue[] => c.errors.filter((e) => e.code === code && e.ids.includes(id));

// ---------------------------------------------------------------------------------------------------
// Where a listing is read (README). The design fixes the words (a story number, quotation, notation) but no JSON
// path, so a number counts as listed when some object in the report, outside `issues`, holds the number's text as
// one of its own members and, in itself, its ancestors' own members or the keys on its path, the item's ID and the
// listing's word; and, when asked, the byte range as `[start, end]` (or an object of exactly those two numbers).

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

function holdsRange(v: JsonValue, [s, e]: [number, number]): boolean {
  if (Array.isArray(v)) return (v.length === 2 && v[0] === s && v[1] === e) || v.some((x) => holdsRange(x, [s, e]));
  if (!isObject(v)) return false;
  const nums = Object.values(v).filter((x) => typeof x === 'number');
  if (nums.length === 2 && Object.values(v).length === 2 && nums[0] === s && nums[1] === e) return true;
  return Object.values(v).some((x) => holdsRange(x, [s, e]));
}

export function listed(c: Checked, item: string, text: string, word: RegExp, bytes?: [number, number]): JsonObject[] {
  const found: Found[] = [];
  objects(listing(c), [], found);
  return found
    .filter((f) => Object.values(f.value).some((x) => x === text || (typeof x === 'number' && String(x) === text)))
    .filter((f) => f.words.some((w) => w === item || w.startsWith(`${item}#`)))
    .filter((f) => f.words.some((w) => word.test(w)))
    .filter((f) => !bytes || holdsRange(f.value, bytes))
    .map((f) => f.value);
}

// ---------------------------------------------------------------------------------------------------
// Documents: the design's envelope as #381's and #397's suites write it.

export function envelope(id: string, profile: string, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile, title: `Issue 406 ${id}`, description: `Issue #406 acceptance fixture ${id}.`, size: [480, 270],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}

export function textItem(id: string, order: string, params: JsonObject): JsonObject {
  return { id, kind: 'text@1', layer: 'main', name: id, order, at: { pos: [24, 40 + 40 * Number(order.slice(1)), 0] }, params: { font: 'body', size: 20, ...params } };
}

/** The document with a status mark bound to a verdict (#381's and #397's form). */
export function withStatus(doc: JsonObject): JsonObject {
  const d = clone(doc);
  obj(d['items'], 'doc.items')['gate'] = { id: 'gate', kind: 'rect@1', layer: 'main', name: 'Status of the release', order: 'z0', params: { box: [400, 8, 64, 20] } };
  d['status_bindings'] = { 'gate-state': { target: 'items/gate/params/paint/fill', source: 'verdict:01JB4060000000000000000001' } };
  return d;
}

/** The document with a reading bound into a text of its own (Bound value; the core's rules test's form). */
export function withReading(doc: JsonObject): JsonObject {
  const d = clone(doc);
  obj(d['items'], 'doc.items')['reading'] = textItem('reading', 'a8', { text: '' });
  d['bound_values'] = { 'reading-value': { target: 'items/reading/params/text', source: 'reading:01JB4060000000000000000002' } };
  return d;
}

// ---------------------------------------------------------------------------------------------------
// The return card: `deep-gpu run`'s `host` call with kind `return_card` (#382's surface), in a look with a status
// map. The look is #382's fixture look (its helpers' `look3`) with no data roles of its own.

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
export const CARD_LOOK: JsonObject = {
  id: 'card-406', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #406 return card look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', paper: '#f4f1ea' }, roles: { ground: 'night', ink: 'graphite', muted: 'slate', body: 'paper' },
  themes: { light: {}, dark: {} }, status: STATUS, status_treatment: { core_min_px: 4, glyph: GLYPHS }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
};

/** The document shown on a return card: the `host` call's reply. */
export function onReturnCard(gpu: string, out: string, doc: JsonObject): JsonObject {
  const path = join(out, `${String(doc['id'])}.json`);
  writeFileSync(path, JSON.stringify(doc));
  const [answer] = lines(gpu, ['run'], [{ out, calls: [{ call: 'host', kind: 'return_card', look: CARD_LOOK, size: doc['size'] ?? [480, 270], doc: path, frames: 1 }] }]);
  const a = obj(answer, 'deep-gpu run');
  expect(a['ok'], `deep-gpu run takes the scenario: ${JSON.stringify(a).slice(0, 2000)}`).toBe(true);
  const replies = arr(a['replies'], 'deep-gpu run: replies');
  expect(replies.length, 'one reply for the one call').toBe(1);
  return obj(replies[0], 'the host reply');
}
