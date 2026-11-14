// Test-side tools for the #169 acceptance tests (README: The surface under test): `deep-show` built once per Cargo
// feature set and driven by #393's `deep-show run` scenarios; the documents the criteria describe, written here so every
// file judges the same pieces; the page export's call, receipt, manifest and stills; the app's own stills of a state
// (#501's png_seq export with #544's `track`), its accessibility tree (#376's `see`) and its carried-state list; a
// headless Google Chrome driven over its DevTools protocol with networking off, which records every request a page makes; an
// HTTP listener for #105's send; and BLAKE3, PNG and the reference-Mac gate from #501's helpers. Nothing here stands in
// for the export, the page, its player, the app or a check: every value a test compares comes from `deep-show`, from
// the files the export wrote or from the browser, and every expected value from the issue's text and the design.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { bgra, blake3, decodePng, putEvidence, referenceMacProblem, sha256 } from '../501/helpers.ts';

export { blake3, putEvidence, referenceMacProblem, sha256 };

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/169 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Light builds (no incremental cache, no debug info) unless the caller set them, as #504's and #507's suites build. */
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};
/** Every `it` passes this: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID: `#169.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #169.b1f34a83',
  2: 'AC2 #169.2418fae7',
  3: 'AC3 #169.3b8550af',
  4: 'AC4 #169.acd10c7d',
  5: 'AC5 #169.e6c2fc38',
  6: 'AC6 #169.a87c5184',
  7: 'AC7 #169.fa0fa9b6',
  8: 'AC8 #169.5ca52f96',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and the failure rules

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function int(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isSafeInteger(v), `${what} is a whole number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
export function hex64(v: JsonValue | undefined, what: string): string {
  const s = str(v, what);
  expect(/^[0-9a-f]{64}$/.test(s), `${what} is 32 bytes in lower-case hex, got ${s}`).toBe(true);
  return s;
}
/** Whether a value's JSON text holds `needle` (an ID, a hash). */
export const mentions = (v: JsonValue | undefined, needle: string): boolean => (JSON.stringify(v) ?? '').includes(needle);
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A wrong program's run: this suite's own check fails on it, and some failure names `named`. */
export function failsNaming(failures: readonly string[], named: string, what: string): void {
  expect(failures.length, `${what}: the check fails the wrong program`).toBeGreaterThan(0);
  expect(failures.some((f) => f.includes(named)), `${what}: a failure names ${named}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A platform need is missing here: never a pass. */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): 705,600,000 flicks a second

export const FLICKS = 705_600_000;
/** Decimal seconds to whole flicks (exact for the tenths the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
const at = (s: number): string => `${s}s`;
export type Rate = [number, number];
export type Size = [number, number];

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show --no-default-features --features <set>` once per set per file, copied
// out of the target folder; a test that uses a build that failed fails with cargo's error.

export const FULL = 'full';
/** Criterion 6's build: the full set without the logic and physics modules, with the test canvas module test.latch. */
export const NO_LOGIC_NO_PHYSICS = 'full,test-leave-out-logic,test-leave-out-physics,test-page-latch';

function build(features: string, to: string): string {
  const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', features];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l));
    return `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`;
  }
  copyFileSync(join(TARGET, 'debug', 'deep-show'), to);
  return '';
}
/** `deep-show` of each feature set, built once in the file's beforeAll. */
export function useShow(sets: readonly string[]): (set: string) => string {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-169-bins-'));
    for (const s of sets) if (!made.has(s)) { const bin = join(dir, `deep-show-${s.replace(/,/g, '+')}`); made.set(s, { bin, error: build(s, bin) }); }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (s: string): string => {
    const e = made.get(s);
    if (!e) throw Error(`the file didn't list the build ${s} in useShow`);
    expect(e.error, `the binary builds: deep-show with features ${s}`).toBe('');
    return e.bin;
  };
}
/** Fresh folders for a test (evidence stores, export outputs), all deleted after it. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-169-')); made.push(d); return d; };
}
/** A folder kept for the whole file (a page several tests read), deleted after it. */
export function useFileTemp(): () => string {
  const made: string[] = [];
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-169-file-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393)

export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  expect(r.error?.message ?? '', `${what}: deep-show run ran`).toBe('');
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: deep-show run writes one answer line`).toBe(1);
  let out: JsonValue;
  try { out = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${what}: the answer line is not JSON: ${lines[0]!.slice(0, 500)}`); }
  const answer = obj(out, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run takes the scenario${sc['planted'] ? ` (planted ${String(sc['planted'])})` : ''}: ${show(answer, 3000)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

const ulid = (k: number): string => `01JB169D${String(k).padStart(18, '0')}`;
/** The documents' IDs. */
export const DOC = {
  walk: ulid(1), quiz: ulid(2), latch: ulid(3), dial: ulid(4), grid: ulid(5), status: ulid(6), plain: ulid(7), bound: ulid(8), photo: ulid(9),
} as const;
/** The agent whose record holds the verdict and the reading the bound documents read (#162's and #1162's world). */
export const AGENT = { id: 'sess-169', thread: 'thread-169', name: 'Test agent: the playable page', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 }, { pid: 4101, ppid: 4100, start: 1_100 }, { pid: 4102, ppid: 4101, start: 1_200 },
];
/** `deep show` from your shell acts as you; from the agent's tree, as the agent. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const AGENT_PEER: JsonObject = { pid: 4102, start: 1_200 };
/** A verdict handle the status binding reads, and a reading handle the bound value reads, both in the agent's record. */
export const VERDICT = 'verdict:01JB169V000000000000000001';
export const READING = 'reading:01JB169R000000000000000001';
/** The reading's value and its as-of time (ms since the epoch: 2026-11-12T09:30:00Z). */
export const READING_VALUE = 42;
export const AS_OF = 1_794_475_800_000;
export const RECORD: JsonObject = {
  [VERDICT]: { session: AGENT.id, state: 'fail' },
  [READING]: { session: AGENT.id, value: READING_VALUE, as_of: AS_OF },
};

export interface World {
  evidence: string;
  /** The documents shown, each on a panel of its own, the first on `main`. */
  docs: string[];
  calls: JsonObject[];
  planted?: string;
  /** #383's virtual clock: with it, every call carries `at` (flicks). */
  clock?: boolean;
  /** The main panel's size (px). */
  panel?: Size;
}
export function scenarioOf(w: World): JsonObject {
  const panels: JsonObject = { main: { rect: [0, 0, ...(w.panel ?? [1280, 720])] } }; const docs: JsonObject = {};
  w.docs.forEach((d, k) => {
    const panel = k === 0 ? 'main' : `side-${k}`;
    docs[d] = { panel };
    panels[panel] = { rect: k === 0 ? [0, 0, ...(w.panel ?? [1280, 720])] : [0, 720, 640, 360] };
  });
  return {
    evidence: w.evidence, sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } }, processes: PROCESSES,
    panels, docs, record: RECORD, ...(w.clock ? { clock: { refresh_hz: 60, lead: 0, check: 0 } } : {}), ...(w.planted ? { planted: w.planted } : {}), calls: w.calls,
  };
}
/** `deep show` of a whole revision, from your shell or, with `agent`, from the agent's tree. */
export const present = (doc: string, document: JsonObject, o: { at?: number; agent?: boolean } = {}): JsonObject =>
  ({ call: 'deep show', peer: o.agent ? AGENT_PEER : YOU_PEER, doc, document: clone(document), include: ['issues'], ...(o.at === undefined ? {} : { at: o.at }) });
/** The revision is presented, with no item skipped as a kind the build doesn't know. */
export function presented(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, what);
  const notes = [...(Array.isArray(r['notices']) ? r['notices'] : []), ...(Array.isArray(r['issues']) ? r['issues'] : [])].filter(isObject);
  expect(notes.filter((n) => n['code'] === 'unknown_kind').map((n) => show(n)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(r['outcome'], `${what} is presented: ${show(r, 3000)}`).toBe('presented');
}
/** An input track entry (Input track; #504's form): `{t: flicks, seq, control, value, writer, player}`. */
export const entry = (seconds: number, control: string, value: JsonValue, seq = 0): JsonObject =>
  ({ t: fl(seconds), seq, control, value, writer: 'you', player: 1 });

// ---------------------------------------------------------------------------------------------------
// The page export (README: `export` with `video.codec: page`)

export interface PageAsk { size?: Size; rate?: Rate; page?: JsonObject }
export const pageExport = (doc: string, out: string, o: PageAsk = {}): JsonObject => ({
  call: 'export', doc, out, video: { codec: 'page', ...(o.page ? { page: o.page } : {}) },
  ...(o.size ? { size: o.size } : {}), ...(o.rate ? { frame_rate: o.rate } : {}),
});
export interface PageReceipt { states: number; edges: number; bytes: number; warnings: JsonValue[]; raw: JsonObject }
/** A delivered page's receipt; any other outcome fails, naming it. */
export function pageReceiptOf(reply: JsonObject | undefined, what: string): PageReceipt {
  const r = obj(reply, what);
  expect(r['outcome'], `${what} is exported: ${show(r, 2000)}`).toBe('exported');
  const receipt = obj(r['receipt'], `${what}: receipt`);
  return {
    states: int(receipt['states'], `${what}: receipt.states`), edges: int(receipt['edges'], `${what}: receipt.edges`),
    bytes: int(receipt['bytes'], `${what}: receipt.bytes`), warnings: arr(receipt['warnings'], `${what}: receipt.warnings`), raw: receipt,
  };
}
/** Every file under `dir`: relative path → bytes. */
export function filesUnder(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (!existsSync(dir)) return out;
  const walk = (d: string): void => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p); else out.set(relative(dir, p).split(sep).join('/'), readFileSync(p));
    }
  };
  walk(dir);
  return out;
}
/** A refused export: `refused`, and nothing at `out` or anywhere in its fresh folder (all or nothing). */
export function refusedUnwritten(reply: JsonObject | undefined, out: string, what: string): JsonObject {
  const r = obj(reply, what);
  expect(r['outcome'], `${what} is refused: ${show(r, 2000)}`).toBe('refused');
  expect([...filesUnder(dirname(out)).keys()], `${what}: nothing is written in out's folder`).toEqual([]);
  return r;
}

/** One state of the manifest (README: The manifest). */
export interface PageState { id: string; controls: JsonObject; marker: string | null; still: string }
export interface PageEdge { from: string; to: string; control: string; value: JsonValue }
export interface Manifest { start: string; states: PageState[]; byId: Map<string, PageState>; edges: PageEdge[] }
/** `manifest.json` in the page's folder, read strictly. */
export function manifestOf(out: string, what: string): Manifest {
  const path = join(out, 'manifest.json');
  expect(existsSync(path), `${what}: the page's folder holds manifest.json`).toBe(true);
  let raw: JsonValue;
  try { raw = JSON.parse(readFileSync(path, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`${what}: manifest.json is not JSON: ${(e as Error).message}`); }
  const m = obj(raw, `${what}: manifest`);
  const states = arr(m['states'], `${what}: manifest.states`).map((v, i): PageState => {
    const s = obj(v, `${what}: manifest.states[${i}]`);
    const marker = s['marker'];
    expect(marker === null || marker === undefined || typeof marker === 'string', `${what}: manifest.states[${i}].marker is a marker ID or null`).toBe(true);
    return { id: str(s['id'], `${what}: manifest.states[${i}].id`), controls: obj(s['controls'], `${what}: manifest.states[${i}].controls`), marker: typeof marker === 'string' ? marker : null, still: str(s['still'], `${what}: manifest.states[${i}].still`) };
  });
  const byId = new Map(states.map((s) => [s.id, s]));
  expect(byId.size, `${what}: each state's id is its own`).toBe(states.length);
  const start = str(m['start'], `${what}: manifest.start`);
  expect(byId.has(start), `${what}: manifest.start names a state`).toBe(true);
  const edges = arr(m['edges'], `${what}: manifest.edges`).map((v, i): PageEdge => {
    const e = obj(v, `${what}: manifest.edges[${i}]`);
    const edge = { from: str(e['from'], `${what}: manifest.edges[${i}].from`), to: str(e['to'], `${what}: manifest.edges[${i}].to`), control: str(e['control'], `${what}: manifest.edges[${i}].control`), value: e['value'] ?? null };
    expect(byId.has(edge.from) && byId.has(edge.to), `${what}: manifest.edges[${i}] joins two of its states: ${show(e)}`).toBe(true);
    return edge;
  });
  return { start, states, byId, edges };
}
/** The state an edge from `from` that sets `control` to `value` reaches, or null when the manifest has none. */
export function follow(m: Manifest, from: string, control: string, value: JsonValue): string | null {
  const e = m.edges.find((x) => x.from === from && x.control === control && same(x.value, value));
  return e ? e.to : null;
}
/** A state's still, decoded, as the BLAKE3 of its canonical raw buffer (BGRA8 rows top-down: Export's hash). */
export function stillHash(out: string, still: string, what: string): string {
  const path = resolve(out, still);
  expect(path.startsWith(resolve(out) + sep), `${what}: the still ${still} is a file inside the page's folder`).toBe(true);
  expect(existsSync(path), `${what}: the page holds its still ${still}`).toBe(true);
  return blake3(bgra(decodePng(readFileSync(path))));
}

// ---------------------------------------------------------------------------------------------------
// The app's own stills: #501's png_seq still export, on #544's input track, whose receipt records the raw frame hash.

export interface Path { name: string; track: JsonObject[]; range: JsonValue }
/** The receipt's one raw frame hash of a still export. */
export function frameHashOf(reply: JsonObject | undefined, what: string): string {
  const r = obj(reply, what);
  expect(r['outcome'], `${what} is exported: ${show(r, 1500)}`).toBe('exported');
  const hashes = arr(obj(r['receipt'], `${what}: receipt`)['frame_hashes'], `${what}: receipt.frame_hashes`);
  expect(hashes.length, `${what}: one frame`).toBe(1);
  return hex64(hashes[0], `${what}: receipt.frame_hashes[0]`);
}
/** One `deep-show run`: the document shown, then a still export per path into `dir`; each path's raw frame hash. */
export function appStills(bin: string, w: { evidence: string; doc: string; document: JsonObject; agent?: boolean }, paths: readonly Path[], o: { size: Size; rate: Rate }, dir: string, what: string): Map<string, string> {
  const calls: JsonObject[] = [present(w.doc, w.document, { agent: w.agent ?? false })];
  paths.forEach((p, i) => calls.push({ call: 'export', doc: w.doc, out: join(dir, `app-${i}`), video: { codec: 'png_seq' }, size: o.size, frame_rate: o.rate, track: p.track, range: p.range }));
  const r = runShow(bin, scenarioOf({ evidence: w.evidence, docs: [w.doc], calls }), `${what}: the app's stills`);
  presented(r[0], `${what}: the document`);
  return new Map(paths.map((p, i) => [p.name, frameHashOf(r[i + 1], `${what}: the app's still at the end of ${p.name}`)]));
}

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope as you send it: no layers). 2D: u = px, y down. 3D: metres, +Y up.

export const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #169 acceptance tests at test time.' };
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
const rect2d = (id: string, name: string, box: [number, number, number, number], role: string, k: number, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name, order: order(k), params: { box, paint: { fill: { role } } }, at: { pos: [0, 0, 0] }, ...extra });
const text2d = (id: string, name: string, words: string, k: number, pos: [number, number], size = 14): JsonObject =>
  ({ id, kind: 'text@1', name, order: order(k), params: { text: words, font: 'body', size, box: { w: 280, h: 28 }, align: 'start' }, at: { pos: [pos[0], pos[1], 0] } });
/** A 2D document: a camera over the page, the ground and an ink band over its lower third under its own items. The
 * band keeps every frame off export's film.blank guard (98% of a frame's pixels in one 3-code-value luma window). */
function doc2d(id: string, title: string, profile: string, size: Size, items: JsonObject[], extra: JsonObject): JsonObject {
  const [w, h] = size;
  const base = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000cam', params: { projection: 'orthographic', target: [w / 2, h / 2, 0], view_width: w } },
    rect2d('back', 'Backdrop', [0, 0, w, h], 'ground', 1, { role: 'decoration' }),
    rect2d('band', 'Band', [0, (2 * h) / 3, w, h / 3], 'ink', 2, { role: 'decoration' }),
  ];
  return {
    format: 1, id, profile, title, description: `${title}: a piece the #169 acceptance tests export as a playable page.`, size, camera: 'cam',
    items: Object.fromEntries([...base, ...items].map((i) => [String(i['id']), i])), ...extra,
  };
}
/** Shown only over [from, to): opacity held at 0, 1 from `from`, 0 again from `to` (null: to the end). */
const shownOver = (id: string, from: number, to: number | null): JsonObject => ({
  target: `items/${id}/adjust/opacity`, type: 'f32',
  keys: { k0: { t: '0s', value: 0, interp: 'hold' }, k1: { t: at(from), value: 1, interp: 'hold' }, ...(to === null ? {} : { k2: { t: at(to), value: 0, interp: 'hold' } }) },
});
const choice = (label: string, options: string[], def?: string, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'choice', class: 'document', label, role: 'radiogroup', options, ...(def === undefined ? {} : { default: def }), ...extra });

// The walkthrough (criteria 1, 5, 7 and 8): a 3D product in metres, as #504's box figure and room are written. Four
// assemblies taken apart by the explode toggle (a follow of the toggle, staggered: about 1 s); a stages control `tour`
// with four stages, each a stage shot of an orthographic camera (a glide of 0.8 s), targeting its part; a choice
// `finish` on the three-option variant set `finish`, recolouring the shell, targeting three swatches. Every part and
// swatch stays in view in every stage, apart or together. With `loop` (criterion 5's walkthrough), a fan turns once
// every 3 s and the transport wraps at 3 s, so each state is a 3 s loop.

export const STAGES = ['plate', 'shell', 'cover', 'cap'] as const;
export const FINISHES = ['lagoon', 'orchid', 'graphite'] as const;
export const STAGE_KEYS: Record<(typeof STAGES)[number], string> = { plate: 'p', shell: 's', cover: 'c', cap: 'a' };
export const FINISH_KEYS: Record<(typeof FINISHES)[number], string> = { lagoon: 'l', orchid: 'o', graphite: 'g' };
export const EXPLODE_KEY = 'e';
const STAGE_LABELS: Record<string, string> = { plate: 'Plate', shell: 'Shell', cover: 'Cover', cap: 'Cap' };
const FINISH_LABELS: Record<string, string> = { lagoon: 'Lagoon', orchid: 'Orchid', graphite: 'Graphite' };
const FINISH_ROLES: Record<string, string> = { lagoon: 'accent', orchid: 'session_readout', graphite: 'ink' };
/** Each stage's shot: the orthographic camera's target and view width (all from azimuth 25°, elevation 20°). */
const SHOTS: Record<string, { target: [number, number, number]; view_width: number }> = {
  plate: { target: [0, 0.3, 0], view_width: 3.0 }, shell: { target: [0.1, 0.32, 0], view_width: 2.8 },
  cover: { target: [-0.1, 0.34, 0], view_width: 3.2 }, cap: { target: [0, 0.36, 0], view_width: 2.6 },
};
const ORBIT: JsonObject = { azimuth: 25, elevation: 20, distance: 10 };
/** The walkthrough's targets: each stage's part, and each finish's swatch, as `<control>/<option>`. */
export const TARGETS: string[] = [...STAGES.map((s) => `tour/${s}`), ...FINISHES.map((f) => `finish/${f}`)];
export const WALK_SIZE: Size = [640, 360];
export const WALK_RATE: Rate = [30, 1];

const box3 = (id: string, name: string, pos: [number, number, number], size: [number, number, number], role: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'mark.box@1', name, role: 'part', params: { size, paint: { fill: { role } } }, at: { pos }, ...extra });
export function walkthrough(o: { loop?: boolean } = {}): JsonObject {
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', params: { projection: 'orthographic', ...SHOTS['plate']!, orbit: ORBIT } },
    box3('floor', 'Floor', [0, -0.05, 0], [4, 0.1, 3], 'muted', { role: 'decoration' }),
    box3('plate', 'Plate', [0, 0.025, 0], [0.6, 0.05, 0.4], 'raised', { parent: 'base' }),
    box3('shell', 'Shell', [0, 0.15, 0], [0.4, 0.2, 0.3], 'accent', { parent: 'body' }),
    box3('cover', 'Cover', [0, 0.27, 0], [0.42, 0.04, 0.32], 'ink', { parent: 'lid' }),
    box3('cap', 'Cap', [0, 0.31, 0], [0.06, 0.04, 0.06], 'session_readout', { parent: 'knob' }),
    ...FINISHES.map((f, k) => box3(`sw_${f}`, `${FINISH_LABELS[f]!} swatch`, [-0.3 + 0.3 * k, 0.03, 0.5], [0.12, 0.06, 0.12], FINISH_ROLES[f]!)),
    ...(o.loop ? [box3('fan', 'Fan', [0.45, 0.1, -0.2], [0.24, 0.02, 0.04], 'ink', { role: 'decoration' })] : []),
  ];
  const stages: JsonObject = {}; const shots: JsonObject = {}; const tourTargets: JsonObject = {}; const tourKeys: JsonObject = {};
  for (const s of STAGES) {
    stages[s] = { label: STAGE_LABELS[s]!, shot: `shot_${s}` };
    shots[`shot_${s}`] = { camera: 'cam', move: 'hold', ...SHOTS[s]!, orbit: ORBIT };
    tourTargets[s] = s;
    tourKeys[STAGE_KEYS[s]] = s;
  }
  const finishTargets: JsonObject = {}; const finishKeys: JsonObject = {};
  for (const f of FINISHES) { finishTargets[f] = `sw_${f}`; finishKeys[FINISH_KEYS[f]] = f; }
  const assemblies: JsonObject = {
    base: { parent: null, at: { pos: [0, 0, 0] }, apart: [0, 0, 0], order: 0, value: 0 },
    body: { parent: 'base', at: { pos: [0, 0, 0] }, apart: [0, 0.3, 0], order: 1, value: 0 },
    lid: { parent: 'body', at: { pos: [0, 0, 0] }, apart: [0, 0.3, 0], order: 2, value: 0 },
    knob: { parent: 'lid', at: { pos: [0, 0, 0] }, apart: [0.25, 0, 0], order: 3, value: 0 },
  };
  return {
    format: 1, id: DOC.walk, profile: 'figure', title: 'A product walkthrough', size: WALK_SIZE, camera: 'cam',
    description: 'A product of four parts shown in four stages, which comes apart on a toggle and takes one of three finishes.',
    items: Object.fromEntries(items.map((i, k) => [String(i['id']), { order: order(k), ...i }])),
    requires: { modules: { scene3d: '^1', motion: '^1', input: '^1' } },
    transport: o.loop ? { span: '3s', frame_rate: WALK_RATE, loop: 'wrap' } : { span: '4s', frame_rate: WALK_RATE },
    assemblies, shots,
    variants: { finish: { default: 'lagoon', options: FINISHES.map((f) => ({ name: f, label: FINISH_LABELS[f]!, patch: [{ op: 'set', id: 'shell', path: 'items/shell/params/paint/fill', value: { role: FINISH_ROLES[f]! } }] })) } },
    controls: {
      tour: { kind: 'stages', class: 'document', label: 'Tour', role: 'tablist', default: 'plate', stages, targets: tourTargets, keys: tourKeys },
      explode: { kind: 'toggle', class: 'document', label: 'Explode', role: 'switch', default: false, keys: { [EXPLODE_KEY]: 'toggle' } },
      finish: choice('Finish', [...FINISHES], 'lagoon', { variant: 'finish', targets: finishTargets, keys: finishKeys }),
    },
    channels: {
      take: {
        target: 'assemblies/apart', type: 'f32', mode: 'follow',
        follow: { source: 'controls/explode/value', model: { transition: { span: '0.5s', interp: 'linear' } }, stagger: { targets: ['body', 'lid', 'knob'], lag: '0.25s', order: 'index' } },
      },
    },
    ...(o.loop ? { drivers: { spin: { target: 'items/fan/at/rot/1', expr: '120 * t', vars: { t: 'time' } } } } : {}),
  };
}
/** One walkthrough state by its controls. */
export interface Combo { tour: string; explode: boolean; finish: string }
export const COMBOS: Combo[] = STAGES.flatMap((tour) => [false, true].flatMap((explode) => FINISHES.map((finish) => ({ tour, explode, finish }))));
export const comboKey = (c: Combo): string => `${c.tour}|${c.explode ? 'apart' : 'together'}|${c.finish}`;
export const DEFAULTS: Combo = { tour: 'plate', explode: false, finish: 'lagoon' };
/** A manifest state's combo, or null when its controls aren't exactly the walkthrough's three. */
export function comboOf(s: PageState): Combo | null {
  const c = s.controls;
  const keys = Object.keys(c).sort();
  if (keys.join(',') !== 'explode,finish,tour' || typeof c['tour'] !== 'string' || typeof c['explode'] !== 'boolean' || typeof c['finish'] !== 'string') return null;
  return { tour: c['tour'], explode: c['explode'], finish: c['finish'] };
}
/** The input track that puts the walkthrough in a state: each control's entry at 0.5 s (settled by 2 s). */
export const comboTrack = (c: Combo): JsonObject[] => [entry(0.5, 'tour', c.tour, 0), entry(0.5, 'explode', c.explode, 1), entry(0.5, 'finish', c.finish, 2)];

// The quiz (criterion 3): a 2D film, 320 × 180 at 10 fps, of three questions with three options each, each a stage
// marker that waits for its choice, and a stage marker `end` on the film's last frame, where a counter of right answers
// shows (#507's quiz: a driver sums the right answers into a story constant the counter reads). No text shows a digit
// or a number word (text@1's number_unsourced).

export const QUIZ = { size: [320, 180] as Size, rate: [10, 1] as Rate, questions: ['q1', 'q2', 'q3'], options: ['a', 'b', 'c'], right: { q1: 'b', q2: 'c', q3: 'a' } as Record<string, string> };
export function quiz(): JsonObject {
  return doc2d(DOC.quiz, 'A quiz of three questions', 'film', QUIZ.size, [
    text2d('t1', 'First question', 'Pick the warm color', 3, [16, 16]),
    text2d('t2', 'Second question', 'Pick the cool color', 4, [16, 16]),
    text2d('t3', 'Last question', 'Pick the dark color', 5, [16, 16]),
    { id: 'score', kind: 'text@1', name: 'Score', order: order(6), params: { text: { counter: { source: 'right', tabular: true, format: { group: 'none' } } }, font: 'body', size: 40, box: { w: 120, h: 56 }, widest: '8' }, at: { pos: [24, 40, 0] } },
  ], {
    transport: { span: '4.1s', frame_rate: QUIZ.rate, sample_rate: 48_000 },
    controls: { q1: choice('First question', QUIZ.options), q2: choice('Second question', QUIZ.options), q3: choice('Last question', QUIZ.options) },
    markers: {
      ask1: { kind: 'stage', name: 'First question', t: '1s', waits_for: 'q1' },
      ask2: { kind: 'stage', name: 'Second question', t: '2s', waits_for: 'q2' },
      ask3: { kind: 'stage', name: 'Last question', t: '3s', waits_for: 'q3' },
      end: { kind: 'stage', name: 'The score', t: '4s' },
    },
    data: { right: { value: 0, source: 'quiz' } },
    drivers: { right: { target: 'data/right', expr: '(q1 == 1 ? 1 : 0) + (q2 == 2 ? 1 : 0) + (q3 == 0 ? 1 : 0)', vars: { q1: 'controls/q1/value', q2: 'controls/q2/value', q3: 'controls/q3/value' } } },
    channels: { show_t1: shownOver('t1', 1, 2), show_t2: shownOver('t2', 2, 3), show_t3: shownOver('t3', 3, 4), show_score: shownOver('score', 3.5, null) },
  });
}
/** The answers' input track: each question answered 0.5 s after the timeline reaches it (on the clock: 1.5, 3.0, 4.5 s). */
export const answersTrack = (a: string[]): JsonObject[] => [entry(1.5, 'q1', a[0]!), entry(3.0, 'q2', a[1]!), entry(4.5, 'q3', a[2]!)];

// The latch figure (criterion 6): 2D, 320 × 180, in a build without the logic and physics modules. Two two-option
// choices: `knob` puts a lamp in view when on, `reveal` puts the latch in view when on (each by a driver on the item's
// x: in view at 40 u, out of the frame at 440 u). The latch, test.latch@1, watches `knob`: its checkpoint holds whether
// knob ever left its default, and it moves the latch 120 u right once it has. So the start and the path knob on, knob
// off end on the same picture and the same controls with different carried state, and revealing the latch tells them
// apart.

export const LATCH = { size: [320, 180] as Size, rate: [30, 1] as Rate, module: 'test.latch' };
export function latchDoc(): JsonObject {
  const off = (c: string): JsonObject => ({ expr: `40 + 400 * (1 - ${c})`, vars: { [c]: `controls/${c === 'k' ? 'knob' : 'reveal'}/value` } });
  return doc2d(DOC.latch, 'A latch that remembers', 'figure', LATCH.size, [
    rect2d('lamp', 'Lamp', [0, 16, 40, 40], 'accent', 3, { role: 'part' }),
    { id: 'latch', kind: 'test.latch@1', name: 'Latch', role: 'part', order: order(4), params: { box: [0, 64, 40, 40], watch: 'knob' }, at: { pos: [0, 0, 0] } },
  ], {
    requires: { modules: { [LATCH.module]: '^1' } },
    transport: { span: '3s', frame_rate: LATCH.rate },
    controls: { knob: choice('Knob', ['off', 'on'], 'off'), reveal: choice('Reveal', ['off', 'on'], 'off') },
    drivers: { lamp_x: { target: 'items/lamp/at/pos/0', ...off('k') }, latch_x: { target: 'items/latch/at/pos/0', ...off('r') } },
  });
}

// Criterion 2's pieces, 2D, 320 × 180: a slider that moves a dot; two choices of 5 and 13 options that move a block
// (65 states); a plate whose fill a status binding reads from the agent's verdict, and the same plate unbound.

export const SMALL: Size = [320, 180];
export function dialDoc(): JsonObject {
  return doc2d(DOC.dial, 'A dial', 'figure', SMALL, [rect2d('dot', 'Dot', [0, 40, 20, 20], 'accent', 3, { role: 'part' })], {
    transport: { span: '2s', frame_rate: [30, 1] },
    controls: { dial: { kind: 'slider', class: 'document', label: 'Dial', role: 'slider', range: [0, 100], default: 0, increment: 1 } },
    drivers: { dot_x: { target: 'items/dot/at/pos/0', expr: '20 + 2 * d', vars: { d: 'controls/dial/value' } } },
  });
}
export const GRID = { rows: 'ctl_rows', cols: 'ctl_cols' } as const;
export function gridDoc(): JsonObject {
  const letters = 'abcdefghijklm'.split('');
  return doc2d(DOC.grid, 'A grid of places', 'figure', SMALL, [rect2d('block', 'Block', [0, 0, 16, 16], 'accent', 3, { role: 'part' })], {
    transport: { span: '2s', frame_rate: [30, 1] },
    controls: { [GRID.rows]: choice('Row', letters.slice(0, 5), 'a'), [GRID.cols]: choice('Column', letters, 'a') },
    drivers: {
      block_x: { target: 'items/block/at/pos/0', expr: '16 + 20 * c', vars: { c: `controls/${GRID.cols}/value` } },
      block_y: { target: 'items/block/at/pos/1', expr: '8 + 20 * r', vars: { r: `controls/${GRID.rows}/value` } },
    },
  });
}
export const BINDING = 'lamp_status';
export function statusDoc(bind: boolean): JsonObject {
  return doc2d(bind ? DOC.status : DOC.plain, bind ? 'A plate bound to a verdict' : 'A plate', 'figure', SMALL, [rect2d('plate', 'Plate', [20, 20, 120, 40], 'accent', 3, { role: 'part' })], {
    transport: { span: '2s', frame_rate: [30, 1] },
    ...(bind ? { status_bindings: { [BINDING]: { target: 'items/plate/params/paint/fill', source: VERDICT } } } : {}),
  });
}

// Criterion 4's pieces, 2D, 320 × 180: a text whose words a bound value fills from the agent's reading; and a picture
// whose asset's redaction is incomplete.

export const BOUND = 'price_now';
export function boundDoc(): JsonObject {
  return doc2d(DOC.bound, 'A bound reading', 'figure', SMALL, [
    { id: 'price', kind: 'text@1', name: 'Price', role: 'data', order: order(3), params: { text: '', font: 'body', size: 24, box: { w: 200, h: 32 }, align: 'start' }, at: { pos: [24, 40, 0] } },
  ], { transport: { span: '2s', frame_rate: [30, 1] }, bound_values: { [BOUND]: { target: 'items/price/params/text', source: READING } } });
}
export function photoDoc(asset: string): JsonObject {
  return doc2d(DOC.photo, 'A photo not yet redacted', 'figure', SMALL, [
    { id: 'photo', kind: 'image@1', name: 'Photo', role: 'part', order: order(3), params: { asset, box: [16, 16, 96, 64], fit: 'fill', alt: 'A test photo' } },
  ], { transport: { span: '2s', frame_rate: [30, 1] }, assets: { photo: { sha256: asset, license: LICENSE, redaction: 'incomplete' } } });
}
/** A PNG of one RGB color, 8-bit, not interlaced. */
export function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------------------------------
// A local HTTP listener: what #105's send delivers, and the canary that proves the browser's networking is off.

export interface Got { method: string; path: string; sha: string; length: number }
export class Listener {
  private server: Server | null = null;
  private got: Got[] = [];
  async start(): Promise<number> {
    this.server = createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on('data', (c: Buffer) => parts.push(c));
      req.on('end', () => { const body = Buffer.concat(parts); this.got.push({ method: req.method ?? '', path: req.url ?? '', sha: sha256(body), length: body.length }); res.writeHead(200); res.end('ok'); });
    });
    await new Promise<void>((done) => this.server!.listen(0, '127.0.0.1', () => done()));
    return (this.server.address() as AddressInfo).port;
  }
  requests(): Got[] { return [...this.got]; }
  clear(): void { this.got = []; }
  async stop(): Promise<void> { const s = this.server; this.server = null; if (s) await new Promise<void>((done) => s.close(() => done())); }
}

// ---------------------------------------------------------------------------------------------------
// The scripted browser (README: The browser): Google Chrome, headless, driven over its DevTools protocol by this file
// alone (as #238's suite drives it, with no library), with networking off three ways (each page offline, every host
// name resolving nowhere, every request sent to a closed proxy port, loopback included), proven before each use by a
// canary request that must fail and must not reach this test's own listener. Every request a page starts is recorded
// from the protocol's Network domain. Chrome runs in its own process group, stopped by its PID.

export const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ARGS = [
  '--headless=new', '--remote-debugging-port=0', '--window-size=1280,720', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--use-mock-keychain', '--password-store=basic', '--disable-background-networking', '--disable-component-update',
  '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
];

/** A node of an accessibility tree, as data: `{id, role, name}`. */
export interface TreeNode { id: string; role: string; name: string }
export const treeOf = (reply: JsonObject | undefined, what: string): TreeNode[] =>
  arr(obj(reply, what)['tree'], `${what}: tree`).map((v, i) => { const n = obj(v, `${what}: tree[${i}]`); return { id: str(n['id'], `${what}: tree[${i}].id`), role: str(n['role'], `${what}: tree[${i}].role`), name: str(n['name'], `${what}: tree[${i}].name`) }; });
/** How a page's tree differs from the app's: missing and extra nodes, then nodes whose role or name differs, then order. */
export function treeFailures(where: string, app: readonly TreeNode[], page: readonly TreeNode[]): string[] {
  const f: string[] = [];
  const pageById = new Map(page.map((n) => [n.id, n]));
  const appIds = new Set(app.map((n) => n.id));
  for (const n of app) {
    const p = pageById.get(n.id);
    if (!p) f.push(`${where}: the page's accessibility tree has no node ${n.id} (${n.role} "${n.name}")`);
    else if (p.role !== n.role || p.name !== n.name) f.push(`${where}: node ${n.id} is ${p.role} "${p.name}" on the page, ${n.role} "${n.name}" in the app`);
  }
  for (const p of page) if (!appIds.has(p.id)) f.push(`${where}: the page's accessibility tree has a node ${p.id} (${p.role} "${p.name}") the app's hasn't`);
  if (!f.length && page.map((n) => n.id).join('\n') !== app.map((n) => n.id).join('\n')) f.push(`${where}: the page's nodes are in the order ${page.map((n) => n.id).join(', ')}, the app's ${app.map((n) => n.id).join(', ')}`);
  return f;
}

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string }; sessionId?: string };
/** The DevTools protocol over the browser's WebSocket, in flat sessions: commands answered by id, events by session. */
class Protocol {
  private n = 0;
  private readonly pending = new Map<number, { done: (r: Record<string, unknown>) => void; fail: (e: Error) => void }>();
  private readonly listeners: { session: string; method: string; on: (p: Record<string, unknown>) => void }[] = [];
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as Message;
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p?.fail(Error(m.error.message)); else p?.done(m.result ?? {});
      } else if (m.method) for (const l of this.listeners) if (l.session === (m.sessionId ?? '') && l.method === m.method) l.on(m.params ?? {});
    });
  }
  static async connect(url: string): Promise<Protocol> {
    const ws = new WebSocket(url);
    await new Promise<void>((done, fail) => { ws.addEventListener('open', () => done()); ws.addEventListener('error', () => fail(Error(`no DevTools connection at ${url}`))); });
    return new Protocol(ws);
  }
  send(method: string, params: Record<string, unknown> = {}, session = '', timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const id = ++this.n;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); fail(Error(`${method}: no answer within ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(id, { done: (r) => { clearTimeout(timer); done(r); }, fail: (e) => { clearTimeout(timer); fail(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
  on(session: string, method: string, on: (p: Record<string, unknown>) => void): void { this.listeners.push({ session, method, on }); }
  close(): void { this.ws.close(); }
}

const KEYS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
};
const keyOf = (k: string): { key: string; code: string; vk: number; text?: string } => {
  const named = KEYS[k];
  if (named) return named;
  if (/^[a-z]$/.test(k)) return { key: k, code: `Key${k.toUpperCase()}`, vk: k.toUpperCase().charCodeAt(0), text: k };
  throw Error(`harness: no key ${k}`);
};
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** One page open in the browser (a target in a flat session), with the requests it started. */
export class WebPage {
  readonly requests: string[] = [];
  constructor(private readonly cdp: Protocol, private readonly session: string, readonly target: string, readonly folder: string) {}
  /** A script's value in the page (its own JavaScript, as text). */
  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, this.session);
    const thrown = r['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined;
    if (thrown) throw Error(`a script in the page threw: ${thrown.text ?? ''} ${thrown.exception?.description ?? ''}`);
    return (r['result'] as { value?: T } | undefined)?.value as T;
  }
  pause(ms: number): Promise<void> { return sleep(ms); }
  async navigate(url: string): Promise<void> { await this.cdp.send('Page.navigate', { url }, this.session).catch(() => undefined); }
  /** Every request the page started that isn't one of its own files (a file:// URL inside its folder, or data:, blob:, about:). */
  outside(): string[] {
    return this.requests.filter((u) => {
      if (/^(data|blob|about):/.test(u)) return false;
      if (!u.startsWith('file:')) return true;
      try { const p = resolve(fileURLToPath(u)); return !(p === this.folder || p.startsWith(this.folder + sep)); } catch { return true; }
    });
  }
  /** The state the page shows, whether an edge is playing, and how many edges have started since it opened. */
  now(): Promise<{ state: string | null; edge: boolean; edges: number }> {
    return this.evaluate(`(() => { const h = document.documentElement; return { state: h.getAttribute('data-deep-state'), edge: h.hasAttribute('data-deep-edge'), edges: window.__deep169 ? window.__deep169.edges : -1 }; })()`);
  }
  /** Counts each time an edge starts playing (`data-deep-edge` added to <html>, a mutation whose old value is null). */
  async watchEdges(): Promise<void> {
    await this.evaluate(`(() => { if (window.__deep169) return; const seen = { edges: 0 }; window.__deep169 = seen;
      new MutationObserver((records) => { for (const r of records) if (r.oldValue === null) seen.edges++; })
        .observe(document.documentElement, { attributes: true, attributeOldValue: true, attributeFilter: ['data-deep-edge'] }); })()`);
  }
  /** After an action: null when the page lands in `expected` (having played an edge when `changing`, none when not). */
  async land(expected: string, changing: boolean, edgesBefore: number): Promise<string | null> {
    if (!changing) {
      await sleep(300);
      const s = await this.now();
      return s.state === expected && !s.edge && s.edges === edgesBefore ? null : `shows ${String(s.state)} (edge playing: ${s.edge}, edges started: ${s.edges - edgesBefore}), not ${expected} with no edge`;
    }
    const until = Date.now() + 20_000;
    let s = await this.now();
    while (Date.now() < until) {
      if (!s.edge && s.state === expected && s.edges > edgesBefore) return null;
      await sleep(50);
      s = await this.now();
    }
    return `shows ${String(s.state)} after 20 s (edge playing: ${s.edge}, edges started: ${s.edges - edgesBefore}), not ${expected} after playing an edge`;
  }
  /** The targets the page shows now (`[data-deep-target]`), by `<control>/<option>`. */
  targets(): Promise<string[]> {
    return this.evaluate(`[...document.querySelectorAll('[data-deep-target]')].map((e) => e.getAttribute('data-deep-target') || '')`);
  }
  /** A left click at the centre of the target's element, as a pointer would: null, or why it couldn't be clicked. */
  async click(target: string): Promise<string | null> {
    const box = await this.evaluate<{ x: number; y: number; w: number; h: number; hit: boolean } | null>(`(() => {
      const e = document.querySelector('[data-deep-target=' + ${JSON.stringify(JSON.stringify(target))} + ']'); if (!e) return null;
      e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y); return { x, y, w: r.width, h: r.height, hit: !!top && (top === e || e.contains(top)) }; })()`);
    if (!box) return `the page shows no target ${target}`;
    if (box.w <= 0 || box.h <= 0) return `the target ${target} has no size`;
    if (!box.hit) return `the target ${target} is covered at its centre`;
    const mouse = (type: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> => this.cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, ...extra }, this.session);
    await mouse('mouseMoved');
    await mouse('mousePressed', { button: 'left', buttons: 1, clickCount: 1 });
    await mouse('mouseReleased', { button: 'left', buttons: 0, clickCount: 1 });
    return null;
  }
  /** A key pressed and released, as a keyboard would: Tab, Enter or a letter. */
  async press(k: string): Promise<void> {
    const { key, code, vk, text } = keyOf(k);
    const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await this.cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text, unmodifiedText: text } : {}) }, this.session);
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, this.session);
  }
  /** The target holding keyboard focus, or null. */
  focused(): Promise<string | null> {
    return this.evaluate(`(document.activeElement && document.activeElement.getAttribute('data-deep-target')) || null`);
  }
  /** Tab until `target` has focus, at most `max` presses; null when it does, else the targets Tab reached. */
  async tabTo(target: string, max = 80): Promise<string[] | null> {
    const reached: string[] = [];
    for (let k = 0; k < max; k++) {
      if ((await this.focused()) === target) return null;
      await this.press('Tab');
      const f = await this.focused();
      if (f !== null) reached.push(f);
    }
    return (await this.focused()) === target ? null : reached;
  }
  /** Every target Tab reaches, pressing Tab until a target comes round again or `max` presses. */
  async tabSweep(max = 80): Promise<string[]> {
    const seen: string[] = [];
    for (let k = 0; k < max; k++) {
      await this.press('Tab');
      const f = await this.focused();
      if (f === null) continue;
      if (seen.includes(f)) break;
      seen.push(f);
    }
    return seen;
  }
  /** The page's accessibility tree as data: each element marked `data-deep-id` that the browser's own accessibility
   * tree doesn't ignore, in document order, with the browser's computed name, and as its role its
   * `aria-roledescription`, else its `role` attribute, else the browser's computed role. */
  async tree(): Promise<TreeNode[]> {
    await this.cdp.send('DOM.enable', {}, this.session);
    await this.cdp.send('Accessibility.enable', {}, this.session);
    const { root } = await this.cdp.send('DOM.getDocument', { depth: -1 }, this.session) as { root: { nodeId: number } };
    const { nodeIds } = await this.cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-deep-id]' }, this.session) as { nodeIds: number[] };
    type Ax = { ignored?: boolean; backendDOMNodeId?: number; role?: { value?: unknown }; name?: { value?: unknown } };
    const { nodes } = await this.cdp.send('Accessibility.getFullAXTree', {}, this.session) as { nodes: Ax[] };
    const ax = new Map(nodes.filter((n) => n.backendDOMNodeId !== undefined).map((n) => [n.backendDOMNodeId!, n]));
    const out: TreeNode[] = [];
    for (const nodeId of nodeIds) {
      const { node } = await this.cdp.send('DOM.describeNode', { nodeId }, this.session) as { node: { backendNodeId: number; attributes?: string[] } };
      const list = node.attributes ?? [];
      const attrs = new Map<string, string>();
      for (let i = 0; i + 1 < list.length; i += 2) attrs.set(list[i]!, list[i + 1]!);
      const a = ax.get(node.backendNodeId);
      if (!a || a.ignored) continue;
      const role = attrs.get('aria-roledescription') ?? attrs.get('role') ?? String(a.role?.value ?? '');
      out.push({ id: attrs.get('data-deep-id') ?? '', role, name: String(a.name?.value ?? '') });
    }
    return out;
  }
  /** A bound value as the page shows it (`[data-deep-bound]`): its text, its `<time datetime>` values, whether it shows. */
  bound(id: string): Promise<{ text: string; times: { datetime: string; text: string }[]; visible: boolean } | null> {
    return this.evaluate(`(() => {
      const el = document.querySelector('[data-deep-bound=' + ${JSON.stringify(JSON.stringify(id))} + ']'); if (!el) return null;
      const times = [...(el.matches('time[datetime]') ? [el] : []), ...el.querySelectorAll('time[datetime]')].map((t) => ({ datetime: t.getAttribute('datetime') || '', text: (t.textContent || '').trim() }));
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return { text: el.textContent || '', times, visible: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }; })()`);
  }
  async close(): Promise<void> { await this.cdp.send('Target.closeTarget', { targetId: this.target }).catch(() => undefined); }
}

/** One browser for a test, its networking off and proven off. Close it in a `finally`. */
export class Headless {
  private constructor(private readonly chrome: ChildProcess, private readonly cdp: Protocol, private readonly profile: string) {}
  static async open(): Promise<Headless> {
    if (!existsSync(CHROME)) blocked(`no Google Chrome at ${CHROME} (set CHROME_BIN); the page is played in a scripted browser`);
    const profile = mkdtempSync(join(tmpdir(), 'deep-169-chrome-'));
    const chrome = spawn(CHROME, [...CHROME_ARGS, `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    const until = Date.now() + 60_000;
    while (!existsSync(portFile) || readFileSync(portFile, 'utf8').split('\n').length < 2) {
      if (Date.now() > until || chrome.exitCode !== null) { stop(chrome, profile); blocked(`${CHROME} opened no DevTools port within 60 s (exit ${String(chrome.exitCode)})`); }
      await sleep(100);
    }
    const [port, path] = readFileSync(portFile, 'utf8').split('\n');
    let cdp: Protocol;
    try { cdp = await Protocol.connect(`ws://127.0.0.1:${port!.trim()}${path!.trim()}`); } catch (e) { stop(chrome, profile); blocked(`${(e as Error).message}`); }
    const h = new Headless(chrome, cdp, profile);
    try { await h.canary(); } catch (e) { await h.close(); throw e; }
    return h;
  }
  /** A new page: a target attached in a flat session, offline, 1280 × 720, its requests recorded from the first. */
  private async page(folder: string): Promise<WebPage> {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string };
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
    const web = new WebPage(this.cdp, sessionId, targetId, folder);
    this.cdp.on(sessionId, 'Network.requestWillBeSent', (p) => web.requests.push(String((p['request'] as { url?: string } | undefined)?.url ?? '')));
    this.cdp.on(sessionId, 'Network.webSocketCreated', (p) => web.requests.push(String(p['url'] ?? '')));
    await this.cdp.send('Network.enable', {}, sessionId);
    await this.cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId);
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
    await this.cdp.send('Page.enable', {}, sessionId);
    await this.cdp.send('Runtime.enable', {}, sessionId);
    return web;
  }
  /** A request from a blank page to this test's own listener: it must fail, reach nothing, and be in the request log. */
  private async canary(): Promise<void> {
    const listener = new Listener();
    const url = `http://127.0.0.1:${await listener.start()}/canary`;
    try {
      const page = await this.page(tmpdir());
      const result = await page.evaluate<string>(`fetch(${JSON.stringify(url)}, { mode: 'no-cors' }).then(() => 'reached', (e) => String(e))`);
      await sleep(500);
      await page.close();
      if (result === 'reached' || listener.requests().length) blocked(`networking is not off in the browser: a fetch of ${url} ${result === 'reached' ? 'succeeded' : 'failed'} and the listener got ${listener.requests().length} requests`);
      if (!page.requests.includes(url)) blocked(`the browser's request log missed the canary request ${url}, so a page's requests can't be counted`);
    } finally { await listener.stop(); }
  }
  /** Opens the page's index.html from disk (file://, no server); with `strict`, waits until it shows a state
   * (`data-deep-state` on <html>), failing after 60 s. */
  async load(folder: string, what: string, strict = true): Promise<WebPage> {
    const root = realpathSync(folder);
    const web = await this.page(root);
    const url = pathToFileURL(join(root, 'index.html')).href;
    await web.navigate(url);
    const until = Date.now() + 60_000;
    let ok = false;
    while (!ok && Date.now() < until) {
      ok = await web.evaluate<boolean>(`location.href === ${JSON.stringify(url)} && document.documentElement.hasAttribute('data-deep-state')`).catch(() => false);
      if (!ok) await sleep(100);
    }
    if (strict) expect(ok, `${what}: the page opened from ${url} shows a state (data-deep-state on <html>) within 60 s`).toBe(true);
    if (ok) await web.watchEdges();
    else await sleep(1_000);
    return web;
  }
  async close(): Promise<void> {
    await this.cdp.send('Browser.close', {}, '', 5_000).catch(() => undefined);
    this.cdp.close();
    stop(this.chrome, this.profile);
  }
}
/** Chrome stopped by its own process group's PID, and its profile removed. */
function stop(chrome: ChildProcess, profile: string): void {
  if (chrome.pid && chrome.exitCode === null) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ } }
  rmSync(profile, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------
// Walks: a circuit that takes every arc once (Hierholzer's), so a walk performs every action in every state with no
// travel between them.

export interface Arc { from: string; to: string }
export function circuit<A extends Arc>(arcs: readonly A[], start: string): A[] {
  const out = new Map<string, A[]>();
  for (const a of arcs) { const l = out.get(a.from) ?? []; l.push(a); out.set(a.from, l); }
  for (const l of out.values()) l.reverse();
  const stack: { node: string; arc: A | null }[] = [{ node: start, arc: null }];
  const path: A[] = [];
  while (stack.length) {
    const top = stack[stack.length - 1]!;
    const next = out.get(top.node)?.pop();
    if (next) stack.push({ node: next.to, arc: next });
    else { stack.pop(); if (top.arc) path.push(top.arc); }
  }
  path.reverse();
  if (path.length !== arcs.length) throw Error(`harness: the walk's ${arcs.length} arcs make no circuit from ${start} (${path.length} taken)`);
  return path;
}
