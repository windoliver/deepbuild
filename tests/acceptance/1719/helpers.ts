// Test-side tools for the #1719 acceptance tests: the base's `deep-show` (`deep-show run`, #393's hub stand-in) and
// `deep-gpu` (#377's GPU layer: `view3d`, `decide` and `golden`), built once per file and driven by one JSON line each;
// the evidence store seeded by its layout (`<first 2 hex>/<other 62 hex>`); the looks and documents; a PNG reader; and
// the measures the criteria state: a pixel hash, the most common color's share, a region's mean channels and luma. The
// build, the scenario runner, the PNG reader and the JSON tools are copied in part from #1722's and #1729's helpers,
// the golden calls from #1399's, since suites don't import each other. Nothing here stands in for the render-back
// under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1719 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${shown(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${shown(value)}`).toBe(true);
  return value as JsonValue[];
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const shown = (v: JsonValue | undefined, at = 1200): string => JSON.stringify(v)?.slice(0, at) ?? 'undefined';
/** No failures; the message lists them, each naming what failed. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** Every object in a JSON value, itself included. */
export function objects(value: JsonValue | undefined): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  return isObject(value) ? [value, ...Object.values(value).flatMap(objects)] : [];
}
/** Every number in a JSON value. */
export function numbers(value: JsonValue | undefined): number[] {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numbers);
  return isObject(value) ? Object.values(value).flatMap(numbers) : [];
}

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** Render-back of a 3D revision and the GPU layer draw on macOS's Metal device (#378). */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`a 3D revision renders back on macOS's Metal device; this is ${process.platform}`);
}
/** A reply this machine's GPU couldn't draw is INCONCLUSIVE, never a pass. */
function drawable(reply: JsonObject, what: string): void {
  if (/"(unsupported_platform|gpu_unavailable|no_device)"/.test(JSON.stringify(reply))) inconclusive(`${what}: this machine could not draw it (${shown(reply, 300)})`);
}

// ---------------------------------------------------------------------------------------------------
// The build: the binaries built once per file by one cargo call, and cloned out of the target folder.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-show', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
export interface Bins { show: () => string; gpu: () => string }
/** Builds both binaries before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBins(): Bins {
  let dir = '';
  let error = 'not built';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1719-bin-'));
    error = cargoBuild();
    if (error === '') for (const b of ['deep-show', 'deep-gpu']) copyFileSync(join(targetDir(), 'debug', exe(b)), join(dir, exe(b)), constants.COPYFILE_FICLONE);
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  const bin = (name: string) => (): string => {
    expect(error, `the binaries build: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe(name));
  };
  return { show: bin('deep-show'), gpu: bin('deep-gpu') };
}
/** A fresh temporary folder per test (the evidence store, outputs, the golden store), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1719-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
/** A folder under `root`, made when it isn't there. */
export function sub(root: string, name: string): string {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  return d;
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (Asset: one checked read by a 64-hex name)

/** Puts `bytes` into the evidence store at `root` by its layout; returns its SHA-256. */
export function seed(root: string, bytes: Buffer): string {
  const h = sha256(bytes);
  mkdirSync(join(root, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
/** A SHA-256 no file in any store has: the hash of a text no test writes anywhere. */
export const ABSENT = sha256('#1719: the look no store holds');

// ---------------------------------------------------------------------------------------------------
// Looks

/** `packs/examples/castle.look.json`, as committed: the look `castle-dusk`. */
export const castleLookBytes = (): Buffer => readFileSync(join(REPO, 'packs', 'examples', 'castle.look.json'));
/** The look the issue's documents name. */
export const DUSK = 'castle-dusk';

/** A look of the suite's own: a light ground, so its status colors keep their contrast on the 2D path, and flat roles;
 * drawing basis, no tone map, the exposure whose scale 1 ÷ (1.2 × 2^EV100) is 1, no bloom, no deband, no ground grid. */
export function ownLook(id: string, extra: JsonObject = {}): JsonObject {
  return {
    id, format: 1, basis: 'drawing', license: 'Apache-2.0', description: 'An acceptance look for render-back of a scene.',
    palette: { paper: '#f2f0ea', ink: '#22252b', slate: '#8a9099', coal: '#14161a', brick: '#7a1f1f', sand: '#e0c060' },
    roles: { ground: 'paper', ink: 'ink', muted: 'slate', accent: 'brick', slate: 'slate', coal: 'coal', sand: 'sand' },
    themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
    status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
    status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
    min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto', ...extra,
  };
}

// ---------------------------------------------------------------------------------------------------
// Documents, as the agent sends them (#393's payload: no `id`, no `layers`, no item `layer`). Displayed text holds no
// number and no number word (the base's honest-numbers rule), so a fixture fails only on what this issue is about.

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', shareable: true, credit: 'Made by this suite' };
/** The document's `look` and its `assets`: `looks` maps each look's ID to its bytes' hash, `named` is the one drawn in. */
export function naming(named: string, looks: Record<string, string>): JsonObject {
  return { look: { asset: `${named}@1` }, assets: Object.fromEntries(Object.entries(looks).map(([id, sha]) => [id, { sha256: sha, license: LICENSE }])) };
}
/** A scene of `items` in order, its camera `cam`, at `size`, with `extra` envelope fields. */
export function scene(title: string, size: readonly [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const out: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(k++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: an acceptance fixture for render-back in a document's look.`,
    size: [...size], camera: 'cam', transport: { span: '4s' }, requires: { modules: { scene3d: '^1' } }, ...extra, items: out,
  };
}
/** `packs/examples/castle.json`, as committed. */
export const CASTLE_FILE = join(REPO, 'packs', 'examples', 'castle.json');
/** The castle naming the look `castle-dusk` by `sha`. */
export const castle = (sha: string): JsonObject => ({ ...(JSON.parse(readFileSync(CASTLE_FILE, 'utf8')) as JsonObject), ...naming(DUSK, { [DUSK]: sha }) });
/** The castle's own size, px. */
export const CASTLE_SIZE: [number, number] = [1280, 800];
/** The castle's recipes' pack, as `deep-show run`'s `packs` and view3d's take it. */
export const CASTLE_PACKS = (): JsonObject[] => [{ id: 'deepbuild/composites', dir: join(REPO, 'packs', 'composites-1.0.0') }];

// ---------------------------------------------------------------------------------------------------
// deep-show run (#393): one scenario line in, one answer line out.

/** The test agent, writing its own layer of each document. */
export const SESSION = 'sess-alpha';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-alpha', name: 'Test agent alpha: looks', process: { pid: 4100, start: 1_000 } } };
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB1719D0${String(n).padStart(16, '0')}`;
/** Flicks in a second, which `render_back`'s `t` counts. */
export const FLICKS = 705_600_000;

/** The wrong program AC2 names (README: Planted program), reachable only through the scenario's `planted`. */
export const PLANTED = 'render_back_drops_look';

export interface Extra { planted?: string; packs?: JsonObject[]; /** Documents stored at revision 0, by ID. */ stored?: Record<string, JsonObject> }
/** A scenario: the agent's session, each document in a visible panel of its own, then `calls`. */
export function scenario(evidence: string, docs: readonly string[], calls: JsonObject[], extra: Extra = {}): JsonObject {
  const panels: JsonObject = {};
  const map: JsonObject = {};
  docs.forEach((d, i) => {
    panels[`p${i + 1}`] = { rect: [0, 0, 1280, 800] };
    map[d] = { panel: `p${i + 1}`, ...(extra.stored?.[d] ? { document: extra.stored[d]! } : {}) };
  });
  return { evidence, sessions: SESSIONS, panels, docs: map, calls, ...(extra.packs ? { packs: extra.packs } : {}), ...(extra.planted ? { planted: extra.planted } : {}) };
}
/** `deep-show run`: one scenario, answered ok with one reply per call. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const label = `deep-show run (${what}${sc['planted'] ? `, planted ${String(sc['planted'])}` : ''})`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within its timeout`);
  if (run.error) throw Error(`${label}: ${run.error.message}`);
  expect(run.status, `${label} exits 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(0, 800)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${label}: the answer`);
  expect(answer['ok'], `${label}: deep-show run answers the scenario ok${sc['planted'] ? ' (README: Planted program)' : ''}; got ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${label}: replies`).map((r, i) => obj(r, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  replies.forEach((r, i) => drawable(r, `${label}: replies[${i}]`));
  return replies;
}
/** The agent's deep_show of a whole document, presented with its pixels at `t` whole seconds and `size`. */
export const present = (doc: string, document: JsonObject, size: readonly [number, number], t = 0): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, t: `${t}s`, size: [...size], include: ['issues', 'pixels'] });
/** A render-back of `doc` as of revision `rev` at `t` whole seconds and `size`: `deep_show` with no document and no
 * patch, as `deep-show run` takes it (#1722). */
export const renderBack = (doc: string, rev: number, size: readonly [number, number], t = 0): JsonObject =>
  ({ call: 'render_back', session: SESSION, doc, t: t * FLICKS, rev, size: [...size] });

// ---------------------------------------------------------------------------------------------------
// Snapshots: the PNG the evidence store holds under a reply's `sha256`, and what the criteria measure on it.

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
export interface Snap { image: Image; file: string; /** SHA-256 of the PNG. */ sha256: string; pixelHash: string }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      let v: number;
      switch (filter) { case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break; case 4: v = x + paeth(a, b, c); break; default: throw Error(`PNG filter ${filter}`); }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!; rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
/** The pixel hash: SHA-256 of the picture's width and height (u32, big-endian) and its RGBA bytes, so two PNGs of the
 * same pixels hash alike however they were encoded. */
export function pixelHash(image: Image): string {
  const head = Buffer.alloc(8); head.writeUInt32BE(image.width, 0); head.writeUInt32BE(image.height, 4);
  return createHash('sha256').update(head).update(image.rgba).digest('hex');
}
/** The most common color (R, G, B) and the share of the frame's pixels that hold it. */
export function mostCommon(image: Image): { color: string; share: number } {
  const counts = new Map<number, number>();
  const n = image.width * image.height;
  for (let i = 0; i < n; i++) { const k = image.rgba[i * 4]! * 65_536 + image.rgba[i * 4 + 1]! * 256 + image.rgba[i * 4 + 2]!; counts.set(k, (counts.get(k) ?? 0) + 1); }
  let best = 0; let count = 0;
  for (const [k, c] of counts) if (c > count) { best = k; count = c; }
  return { color: `#${best.toString(16).padStart(6, '0')}`, share: count / n };
}
/** A rectangle of pixels, [x0, y0, x1, y1), clipped to the frame. */
export type Rect = readonly [number, number, number, number];
/** The mean of each of red, green and blue over `r`, each 0 to 1. */
export function meanRgb(image: Image, r: Rect): [number, number, number] {
  const [x0, y0] = [Math.max(0, Math.round(r[0])), Math.max(0, Math.round(r[1]))];
  const [x1, y1] = [Math.min(image.width, Math.round(r[2])), Math.min(image.height, Math.round(r[3]))];
  const sum: [number, number, number] = [0, 0, 0]; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * image.width + x) * 4;
    for (let k = 0; k < 3; k++) sum[k]! += image.rgba[o + k]! / 255;
    n++;
  }
  expect(n, `the rectangle ${r.join(', ')} holds pixels of the ${image.width} × ${image.height} frame`).toBeGreaterThan(0);
  return sum.map((s) => s / n) as [number, number, number];
}
/** The mean Rec. 709 luma over `r`, on encoded values as the blank guard reads it (`crates/deep-gpu/src/guard.rs`). */
export function meanLuma(image: Image, r: Rect): number {
  const [red, green, blue] = meanRgb(image, r);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
export const pct = (share: number): string => `${(100 * share).toFixed(2)}%`;

/** A reply's first snapshot, read from the evidence store, or why there is none (a refusal names its code and path). */
export function snapshotOf(evidence: string, reply: JsonObject): Snap | string {
  if (typeof reply['code'] === 'string') return `answers ${reply['code']}${typeof reply['path'] === 'string' ? ` at ${reply['path']}` : ''}, with no snapshot: ${shown(reply)}`;
  const list = reply['snapshots'];
  const first = Array.isArray(list) ? list[0] : undefined;
  if (!isObject(first) || typeof first['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(first['sha256'])) return `gives no snapshot: ${shown(reply)}`;
  const h = first['sha256'];
  const file = join(evidence, h.slice(0, 2), h.slice(2));
  if (!existsSync(file)) return `names snapshot ${h}, which the evidence store doesn't hold`;
  const bytes = readFileSync(file);
  if (sha256(bytes) !== h) return `names snapshot ${h}, whose file hashes to ${sha256(bytes)}`;
  const image = decodePng(bytes);
  if (first['w'] !== image.width || first['h'] !== image.height) return `names snapshot ${h} as ${shown(first['w'])} × ${shown(first['h'])} px, its PNG is ${image.width} × ${image.height}`;
  return { sha256: h, file, image, pixelHash: pixelHash(image) };
}
/** The snapshot a reply must carry, at `size`. */
export function drawn(evidence: string, reply: JsonObject, size: readonly [number, number], what: string): Snap {
  const snap = snapshotOf(evidence, reply);
  if (typeof snap === 'string') return expect.fail(`${what} ${snap}`);
  expect([snap.image.width, snap.image.height], `${what}: its snapshot is at the size asked`).toEqual([...size]);
  return snap;
}
/** An item's box in a reply's `visible` table, as a rectangle of the snapshot's pixels. */
export function visibleBox(reply: JsonObject, id: string, what: string): Rect {
  const row = arr(reply['visible'], `${what}: visible`).find((r): r is JsonObject => isObject(r) && r['id'] === id);
  const b = isObject(row) ? row['box'] : undefined;
  expect(Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number'), `${what}: visible lists ${id} with its box: ${shown(reply['visible'])}`).toBe(true);
  const [x, y, w, h] = b as number[] as [number, number, number, number];
  return [x, y, x + w, y + h];
}

/** The two replies a revision comes back on (Render-back): its presenting reply, and a render-back of it. */
export type Way = 'presenting' | 'render_back';
export const WAYS: readonly Way[] = ['presenting', 'render_back'];
export interface Shown { reply: JsonObject; snap: Snap }
/** The agent presents `document` (its rev 1), then renders it back at rev 1, both at `t` and `size`: each way's reply
 * and snapshot. */
export function bothWays(bin: string, evidence: string, document: JsonObject, size: readonly [number, number], what: string, extra: { t?: number; packs?: JsonObject[] } = {}): Record<Way, Shown> {
  const doc = DOC(1);
  const t = extra.t ?? 0;
  const replies = runShow(bin, scenario(evidence, [doc], [present(doc, document, size, t), renderBack(doc, 1, size, t)], extra.packs ? { packs: extra.packs } : {}), what);
  const [p, b] = replies as [JsonObject, JsonObject];
  expect(p['rev'], `${what}: the agent's whole document is rev 1: ${shown(p)}`).toBe(1);
  return { presenting: { reply: p, snap: drawn(evidence, p, size, `${what}, presenting`) }, render_back: { reply: b, snap: drawn(evidence, b, size, `${what}, render_back of rev 1`) } };
}

// ---------------------------------------------------------------------------------------------------
// deep-gpu run (#377, #380): `{out, calls}` in, one reply per call; every file in `out` is named by its SHA-256.

export function runGpu(bin: string, out: string, calls: JsonObject[], what: string): JsonObject[] {
  const label = `deep-gpu run (${what})`;
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within its timeout`);
  if (run.error) throw Error(`${label}: ${run.error.message}`);
  expect(run.status, `${label} exits 0 (${run.signal ?? 'no signal'}); stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const answer = obj(JSON.parse((run.stdout ?? '').split('\n').find((l) => l !== '') ?? 'null') as JsonValue, `${label}: the answer`);
  expect(answer['ok'], `${label}: deep-gpu answers the scenario ok: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${label}: replies`).map((r, i) => obj(r, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  replies.forEach((r, i) => drawable(r, `${label}: replies[${i}]`));
  return replies;
}

/** Prints what the issue's Proof line asks to see, so a passing run shows it. */
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #1719 ${label}: ${JSON.stringify(value)}`);
}
