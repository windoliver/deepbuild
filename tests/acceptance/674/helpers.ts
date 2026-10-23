// Test-side tools for the #674 acceptance tests: the `deep-canvas-render` binary (GPUI's `render` and
// `session`, Vello CPU's `raster`, the document `check`) and `deep-show` (render-back) driven by JSON lines,
// the content-addressed store images are read from, and the PNGs they write read back. Nothing here stands
// in for a renderer, a sampler, the document check or a cache; the pure data is in scene.ts.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { LOOK, decodePng, sha256, type Image, type JsonObject, type JsonValue } from './scene.ts';

export * from './scene.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/674 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);
export const RENDER_NAME = 'deep-canvas-render';
export const SHOW_NAME = 'deep-show';
export const RENDER_BIN = exe(RENDER_NAME);
export const SHOW_BIN = exe(SHOW_NAME);

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
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------------------------------
// The binaries: built once per file, one request per stdin line, one JSON line out per line in.

/** Builds one binary by name across the workspace; returns '' or the build's error text. */
export function buildBinary(name: string): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${name} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds the named binaries once per file and fails every test of the file when one can't be built. */
export function useBinaries(...names: string[]): void {
  let error = '';
  beforeAll(() => { error = names.map(buildBinary).filter((e) => e !== '').join('\n'); }, 900_000);
  beforeEach(() => { expect(error, `the binaries build: ${names.join(', ')}`).toBe(''); });
}

/** Pipes every input line into one run (one process) of `<bin> <subcommand>`. */
export function batch(bin: string, subcommand: string, inputs: (JsonValue | string)[]): JsonValue[] {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const run = spawnSync(bin, [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 280_000, killSignal: 'SIGKILL' });
  const name = `${bin.split('/').at(-1)} ${subcommand}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines.map((line) => JSON.parse(line) as JsonValue);
}

export function one(bin: string, subcommand: string, input: JsonValue): JsonObject {
  return obj(batch(bin, subcommand, [input])[0], `${bin.split('/').at(-1)} ${subcommand}: the answer`);
}

/** Fails with an INCONCLUSIVE message off macOS: GPUI's offscreen Metal renderer draws `render` and `session`. */
function requireMacos(): void {
  expect(process.platform, 'INCONCLUSIVE: the view is drawn with GPUI\'s offscreen Metal renderer, macOS only; this is not a pass').toBe('darwin');
}

/** One line through a GPUI subcommand (`render`, `session`), INCONCLUSIVE on `unsupported_platform`; the answer, accepted or refused. */
function gpuiAnswer(subcommand: 'render' | 'session', input: JsonValue): JsonObject {
  requireMacos();
  const out = one(RENDER_BIN, subcommand, input);
  if (out['ok'] !== true && out['code'] === 'unsupported_platform') {
    expect.fail(`INCONCLUSIVE: ${RENDER_NAME} ${subcommand} reports unsupported_platform; this is not a pass`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The store: a flat folder whose files are named by their sha256, as `deep-canvas-render`'s `store` reads.

/** Scratch folders, deleted after the file's tests. */
export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-674-${prefix}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Writes `bytes` into the store under its sha256 and returns the hash. */
export function put(dir: string, bytes: Uint8Array): string {
  const hash = sha256(bytes);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, hash), bytes);
  return hash;
}

// ---------------------------------------------------------------------------------------------------
// The three ways one document reaches pixels.

export type View = { zoom?: number; theme?: string };
let counter = 0;
const nextOut = (dir: string): string => join(dir, `out${(counter += 1)}.png`);

function readDrawn(out: JsonObject, file: string, what: string): Image {
  expect(out['ok'], `${what} refused: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const image = decodePng(readFileSync(file));
  expect([out['width'], out['height']], `${what}: the answer reports the PNG's size`).toEqual([image.width, image.height]);
  return image;
}

/** GPUI's `render`: the view at scale `zoom`, drawn by the offscreen Metal renderer and read back. The store is `dir`. */
export function gpuiAnswerOf(dir: string, doc: JsonObject, view: View = {}): { out: JsonObject; file: string } {
  const file = nextOut(dir);
  return { out: gpuiAnswer('render', { out: file, doc, look: LOOK, view, store: dir }), file };
}
export function gpui(dir: string, doc: JsonObject, view: View = {}, what = 'GPUI render'): Image {
  const { out, file } = gpuiAnswerOf(dir, doc, view);
  return readDrawn(out, file, what);
}

/** Vello CPU's `raster` of the same document and view, read back. */
export function rasterAnswerOf(dir: string, doc: JsonObject, view: View = {}): { out: JsonObject; file: string } {
  const file = nextOut(dir);
  return { out: one(RENDER_BIN, 'raster', { out: file, doc, look: LOOK, view, store: dir }), file };
}
export function vello(dir: string, doc: JsonObject, view: View = {}, what = 'Vello CPU raster'): Image {
  const { out, file } = rasterAnswerOf(dir, doc, view);
  return readDrawn(out, file, what);
}

// Render-back: deep_show through `deep-show run`, the snapshot read from the evidence store by its hash.

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: sampling', process: { pid: 4100, start: 1_000 } };
const DOC_ID = '01JB7D00000000000000000001';

/** Puts a PNG into an evidence store at `root` as you would drop one in; returns its hash (the asset's sha256). */
async function putEvidence(root: string, png: Buffer): Promise<string> {
  const store = await openEvidenceStore({ root });
  const stored = await store.connect({ role: 'you', via: 'drop' }).put({
    bytes: png, declares: 'png', kind: 'image', source: 'tests/acceptance/674', redaction: 'complete', license: { name: 'CC0-1.0', allows: ['export', 'report', 'post'] },
  });
  if (stored.status !== 'stored') throw Error(`the evidence store refused the test's PNG: ${stored.reason}`);
  return stored.evidence.sha256;
}

/**
 * Render-back: `deep_show` of the document's payload at t = 0 with a snapshot of `size` px asked for, the asset in
 * the evidence store. `make` builds the payload from the asset's hash. Returns the snapshot, decoded.
 */
export async function back(dir: string, png: Buffer, make: (asset: string) => JsonObject, size: [number, number], what = 'render-back'): Promise<Image> {
  const root = mkdtempSync(join(dir, 'evidence-'));
  const asset = await putEvidence(root, png);
  const scenario: JsonObject = {
    evidence: root,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC_ID]: { panel: 'main' } },
    calls: [{ call: 'deep_show', session: ALPHA.id, doc: DOC_ID, document: make(asset), t: '0s', size, include: ['issues', 'pixels'] }],
  };
  const answer = one(SHOW_BIN, 'run', scenario);
  expect(answer['ok'], `${what}: deep-show run refused the scenario: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  const reply = obj(arr(answer['replies'], `${what}: replies`)[0], `${what}: the reply`);
  expect(reply['outcome'], `${what}: the document is presented: ${JSON.stringify(reply).slice(0, 2000)}`).toBe('presented');
  const shots = arr(reply['snapshots'], `${what}: snapshots`);
  expect(shots.length, `${what}: one snapshot`).toBe(1);
  const shot = obj(shots[0], `${what}: snapshots[0]`);
  const store = await openEvidenceStore({ root });
  const image = decodePng(Buffer.from(await store.read(String(shot['sha256']))));
  expect([shot['w'], shot['h'], image.width, image.height], `${what}: the snapshot is ${size.join(' × ')} px`).toEqual([size[0], size[1], size[0], size[1]]);
  return image;
}

// ---------------------------------------------------------------------------------------------------
// The check, and the GPUI session.

export interface Issue { code: string; severity: string; path: string; ids: string[] }

/** `check` over a document with the look: whether it passes, and its issues. */
export function check(doc: JsonObject): { ok: boolean; issues: Issue[]; raw: JsonObject } {
  const out = one(RENDER_BIN, 'check', { doc, look: LOOK });
  expect(typeof out['ok'], `check answers ok: ${JSON.stringify(out).slice(0, 2000)}`).toBe('boolean');
  const issues = arr(out['issues'], 'check: issues').map((v, i) => {
    const o = obj(v, `check: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), path: String(o['path']), ids: arr(o['ids'] ?? [], `check: issues[${i}].ids`).map(String) };
  });
  return { ok: out['ok'] === true, issues, raw: out };
}

export type Step = { doc?: JsonObject; t: number; view?: View; frames?: number };
export interface CacheEntry { item: string; key: string; len: number; sha256: string }

/** One GPUI session over `steps`, the store `dir`; the answer's per-step reports, the answer must be accepted. */
export function session(dir: string, steps: Step[], what = 'GPUI session'): JsonObject[] {
  const out = gpuiAnswer('session', { look: LOOK, steps, store: dir });
  expect(out['ok'], `${what} refused: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const reports = arr(out['steps'], `${what}: steps`).map((s, i) => obj(s, `${what}: steps[${i}]`));
  expect(reports.length, `${what}: one report per step`).toBe(steps.length);
  return reports;
}

/** The session's resample count of one step (`steps[i].resamples`): the copies the step built, none served from the cache. */
export function resamples(report: JsonObject, i: number): number {
  const n = report['resamples'];
  expect(typeof n === 'number' && Number.isInteger(n) && n >= 0, `steps[${i}].resamples is a count of resamples, got ${JSON.stringify(n)}`).toBe(true);
  return n as number;
}

/** The images the step's last frame drew from (`steps[i].caches.images`), by item. */
export function imageCaches(report: JsonObject, i: number): Map<string, CacheEntry> {
  const caches = obj(report['caches'], `steps[${i}].caches`);
  const map = new Map<string, CacheEntry>();
  arr(caches['images'], `steps[${i}].caches.images`).forEach((raw, k) => {
    const e = obj(raw, `steps[${i}].caches.images[${k}]`);
    const key = e['key'];
    expect(typeof key === 'string' && /^[0-9a-f]{32}$/.test(key), `steps[${i}].caches.images[${k}].key is a 128-bit content key in hex, got ${JSON.stringify(key)}`).toBe(true);
    map.set(String(e['item']), { item: String(e['item']), key: key as string, len: num(e['len'], 'len'), sha256: String(e['sha256']) });
  });
  return map;
}
