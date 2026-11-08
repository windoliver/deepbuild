// Test-side tools for the #467 acceptance tests: the base's two binaries, `deep-canvas-render` (the CPU side: `check`,
// `raster`, `path`) and `deep-gpu run` (the GPU layer: `layers`, `film2d`, `live`), each built once per file and driven
// by JSON lines; this suite's documents, built in code; PNG reading and writing; and the closed forms the criteria
// state (parallax, the foot order), computed here in f64. Nothing here stands in for the renderer.
// README: The surface under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

// Vitest's 5 s default stays out, under any root: every test here spawns a build or a binary.
vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/467 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #467.ae875f3c',
  2: 'AC2 #467.93e9eaf5',
  3: 'AC3 #467.2c11652d',
  4: 'AC4 #467.2680a499',
  5: 'AC5 #467.2184c808',
  6: 'AC6 #467.0c9e76a0',
  7: 'AC7 #467.16dd5c0a',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and judging

export const shown = (v: unknown): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v)}`).toBe('string');
  return v as string;
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v, `${what} is a number, got ${shown(v)}`).toBe('number');
  return v as number;
}
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** Every number anywhere inside a JSON value. */
export function numbersIn(v: JsonValue | undefined): number[] {
  if (typeof v === 'number') return [v];
  if (Array.isArray(v)) return v.flatMap(numbersIn);
  if (isObject(v)) return Object.values(v).flatMap(numbersIn);
  return [];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names `name`: what a planted program must give. */
export function failsNaming(failures: readonly string[], name: string, what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => f.includes(name)), `${what}: a failure names "${name}"; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The GPU layer draws on macOS's Metal device; anywhere else a test that reads it is INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file and copied out of the target folder.

const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
function cargoBuild(bin: string): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const args = ['build', '--locked', '--bin', bin];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** `bin` built once for this file; the returned function gives its path, failing the test if the build failed. */
export function useBin(bin: 'deep-gpu' | 'deep-canvas-render'): () => string {
  let dir = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-467-bin-'));
    error = cargoBuild(bin);
    if (error === '') copyFileSync(join(targetDir(), 'debug', bin), join(dir, bin));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `the binary builds: cargo build --locked --bin ${bin}`).toBe(''); return join(dir, bin); };
}
/** A fresh temporary folder per test, deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-467-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render <check | raster | path>`: one JSON line in, one out, every platform (#373, #381, #160).

/** Every input line through one process of `deep-canvas-render <sub>` (several lines are a play). */
export function render(bin: string, sub: 'check' | 'raster' | 'path', inputs: JsonValue[]): JsonObject[] {
  const name = `deep-canvas-render ${sub}`;
  const run = spawnSync(bin, [sub], { cwd: REPO, input: `${inputs.map((i) => JSON.stringify(i)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  expect(run.status, `${name} exited 0; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${name}: answer ${i}`));
}
export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }
export function issuesOf(answer: JsonObject, what: string): Issue[] {
  return arr(answer['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const raw = obj(v, `${what}: issues[${i}]`);
    return { code: String(raw['code']), severity: String(raw['severity']), path: String(raw['path']), ids: Array.isArray(raw['ids']) ? raw['ids'].map(String) : [], raw };
  });
}
export const errorsOf = (issues: Issue[]): Issue[] => issues.filter((i) => i.severity === 'error');
/** `check {doc, look, store?, planted?}`. */
export function check(bin: string, doc: JsonObject, extra: JsonObject = {}): { answer: JsonObject; errors: Issue[] } {
  const [answer] = render(bin, 'check', [{ doc, look: LOOK, ...extra }]);
  expect(typeof answer!['ok'], `check answers ok: ${shown(answer)}`).toBe('boolean');
  return { answer: answer!, errors: errorsOf(issuesOf(answer!, 'check')) };
}
export const describeErrors = (errors: Issue[]): string => errors.map((e) => `${e.code} [${e.ids.join(', ')}] ${e.path}`).join('; ') || 'none';
/** Whether a refusal names the item: its `path` under `items/<id>`, or an issue whose `ids` hold it. */
export function refusalNames(answer: JsonObject, id: string): boolean {
  if (typeof answer['path'] === 'string' && (answer['path'] === `items/${id}` || answer['path'].startsWith(`items/${id}/`))) return true;
  return issuesOf(answer, 'the refusal').some((i) => i.ids.includes(id) || i.path === `items/${id}` || i.path.startsWith(`items/${id}/`));
}

let rasters = 0;
/** A `raster` line drawing `doc` at `t` flicks into a PNG under `dir`. */
export function rasterLine(dir: string, doc: JsonObject, t = 0): JsonObject {
  rasters += 1;
  return { out: join(dir, `r${process.pid}-${rasters}.png`), doc, look: LOOK, t };
}
export interface Raster { answer: JsonObject; image: Image }
/** A raster's accepted answer and its PNG. */
export function drawn(line: JsonObject, answer: JsonObject | undefined, what: string): Raster {
  const a = obj(answer, `raster ${what}`);
  expect(a['ok'], `raster ${what} was drawn, not refused: ${shown(a)}`).toBe(true);
  return { answer: a, image: decodePng(readFileSync(str(line['out'], 'out'))) };
}
/** Each of `docs` at `t`, in one process. */
export function rasterAll(bin: string, dir: string, docs: JsonObject[], what: string, t = 0): Raster[] {
  const lines = docs.map((d) => rasterLine(dir, d, t));
  const answers = render(bin, 'raster', lines);
  return lines.map((l, i) => drawn(l, answers[i], `${what} [${i}]`));
}

/** One glyph of a text's shaped run as `raster`'s `texts` reports it (#381's Glyph). */
export interface Glyph { font: string; size: number; id: number; x: number; y: number; grapheme: number }
export function glyphsOf(v: JsonValue | undefined, what: string): Glyph[] {
  return arr(v, what).map((g, i) => {
    const o = obj(g, `${what}[${i}]`);
    return { font: str(o['font'], `${what}[${i}].font`), size: num(o['size'], `${what}[${i}].size`), id: num(o['id'], `${what}[${i}].id`), x: num(o['x'], `${what}[${i}].x`), y: num(o['y'], `${what}[${i}].y`), grapheme: num(o['grapheme'], `${what}[${i}].grapheme`) };
  });
}
/** `raster`'s `texts.<id>` entry. */
export const textEntry = (answer: JsonObject, id: string, what: string): JsonObject => obj(obj(answer['texts'], `${what}: texts`)[id], `${what}: texts.${id}`);

/** `path {doc, item: group, times}`'s frames' `parallax.offset` (README: `path`: a group's parallax). */
export function parallaxOffsets(bin: string, doc: JsonObject, group: string, times: number[], what: string): [number, number][] {
  const [answer] = render(bin, 'path', [{ doc, item: group, times, look: LOOK }]);
  expect(answer!['ok'], `path ${what} was answered, not refused: ${shown(answer)}`).toBe(true);
  const frames = arr(answer!['frames'], `path ${what}: frames`);
  expect(frames.length, `path ${what}: one frame per time`).toBe(times.length);
  return frames.map((f, i) => {
    const o = arr(obj(obj(f, `path ${what}: frames[${i}]`)['parallax'], `path ${what}: frames[${i}].parallax`)['offset'], `path ${what}: frames[${i}].parallax.offset`);
    return [num(o[0], 'offset x'), num(o[1], 'offset y')];
  });
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario line in, one answer out (#377). Each runGpu is a fresh process.

/** The wrong program this suite plants in `deep-gpu` (README: Planted programs). */
export type Planted = 'bevel_lit_opposite';
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = run.stdout ?? '';
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  if (answer['code'] === 'unsupported_platform') inconclusive(`${name} reports unsupported_platform`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}
export const hasFile = (out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer => {
  const name = str(hash, `${what}: its file's SHA-256`);
  const bytes = readFileSync(join(out, `${name}.${ext}`));
  expect(sha256(bytes), `${what}: the file is named by its SHA-256`).toBe(name);
  return bytes;
};

export type Renderer = 'gpu_layer' | 'vello_cpu';
/** `layers` (#385): each writer layer drawn alone over transparent black, by each renderer in `by`. */
export const layersCall = (doc: JsonObject, by: Renderer[]): JsonObject => ({ call: 'layers', doc, look: LOOK, by });
export interface Side { image: Image; runs: Map<string, Image> }
/** Layer `main`'s side drawn by `renderer`: its PNG and each glyph run's coverage PNG by item ID. */
export function sideOf(out: string, reply: JsonObject, renderer: Renderer, what: string): Side {
  answered(reply, what);
  const rows = arr(reply['layers'], `${what}: layers`).map((v) => obj(v, `${what}: layers[]`));
  const row = rows.find((r) => r['layer'] === 'main');
  expect(row, `${what}: the reply lists layer main`).toBeDefined();
  const side = answered(obj(obj(row!['drawn'], `${what}: drawn`)[renderer], `${what}: drawn.${renderer}`), `${what}: ${renderer}`);
  const runs = new Map<string, Image>();
  for (const r of arr(side['runs'] ?? [], `${what}: ${renderer} runs`)) {
    const o = obj(r, `${what}: run`);
    if (o['kind'] === 'glyphs') runs.set(str(o['id'], 'run id'), decodePng(hasFile(out, o['png'], 'png', `${what}: run ${String(o['id'])}`)));
  }
  return { image: decodePng(hasFile(out, side['png'], 'png', `${what}: ${renderer}`)), runs };
}

export const film2dCall = (doc: JsonObject, extra: JsonObject): JsonObject => ({ call: 'film2d', doc, look: LOOK, hash: true, ...extra });
/** A `film2d` reply's captured frame's PNG (#149's `capture`: `final` on the frame's row). */
export function capturedPng(out: string, reply: JsonObject, frame: number, what: string): Buffer {
  answered(reply, what);
  const row = arr(reply['frames'], `${what}: frames`).map((f) => obj(f, `${what}: frames[]`)).find((f) => f['frame'] === frame);
  expect(row, `${what}: frame ${frame} was drawn`).toBeDefined();
  return hasFile(out, row!['final'], 'png', `${what}: frame ${frame}'s capture`);
}

// ---------------------------------------------------------------------------------------------------
// Pictures: 8-bit PNG, straight alpha.

export interface Image { width: number; height: number; rgba: Uint8Array }
export const px = (im: Image, x: number, y: number): [number, number, number, number] => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!];
};
/** The largest per-channel difference (RGBA) at (x, y). */
export const diffAt = (a: Image, b: Image, x: number, y: number): number => {
  const p = px(a, x, y); const q = px(b, x, y);
  return Math.max(...p.map((v, i) => Math.abs(v - q[i]!)));
};
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
  let pos = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (pos < file.length) {
    const length = file.readUInt32BE(pos);
    const type = file.toString('latin1', pos + 4, pos + 8);
    const body = file.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      if (pred === undefined) throw Error(`PNG filter ${filter}`);
      line[i] = (line[i]! + pred) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!;
      rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
/** An 8-bit RGBA PNG written by the suite: the terrain's atlas. */
export function encodeRgbaPng(width: number, height: number, value: (x: number, y: number) => [number, number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(value(x, y), y * (width * 4 + 1) + 1 + x * 4);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}
/** An animated PNG of equal-sized frames at `fps`, looping, written by the suite: the parallax recording. */
export function encodeApng(frames: Image[], fps: number): Buffer {
  const { width, height } = frames[0]!;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0);
  const parts: Buffer[] = [SIGNATURE, chunk('IHDR', ihdr), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4; const r = y * (width * 3 + 1) + 1 + x * 3;
      raw[r] = f.rgba[o]!; raw[r + 1] = f.rgba[o + 1]!; raw[r + 2] = f.rgba[o + 2]!;
    }
    const data = deflateSync(raw, { level: 9 });
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------------
// The look and the documents (README: Documents). Every color is a role of fixtures/look.json.

export const LOOK: JsonObject = JSON.parse(readFileSync(join(FIXTURES, 'look.json'), 'utf8')) as JsonObject;
/** A role's color in the look's light theme. */
export function role(name: string): [number, number, number] {
  const palette = obj(LOOK['palette'], 'look.palette');
  const hex = str(palette[str(obj(LOOK['roles'], 'look.roles')[name], `look.roles.${name}`)], `the palette entry of ${name}`);
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export const FLICKS = 705_600_000;
/** Seconds to flicks, as the document's time literals give them. */
export const fl = (s: number): number => Math.round(s * FLICKS);

/** The envelope every document here takes: one writer layer `main`, class figure. */
export function doc(id: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `#467 ${id}`, description: `The #467 acceptance document ${id}.`, size,
    budget: { class: 'figure' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [str(i['id'], 'item id'), i])), ...extra,
  };
}
export const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, layer: 'main', name: id, order, params, ...extra });
/** A keyed f32 channel, linear between `[seconds, value]` keys. */
export function keyed(target: string, keys: [number, number][]): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, v], i) => [`k${i}`, { t: `${t}s`, value: v, interp: 'linear' }])) };
}
/** A keyed channel's value at `t` flicks: linear between keys, held before the first and after the last. */
export function keyedAt(keys: [number, number][], t: number): number {
  const s = t / FLICKS;
  if (s <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [t0, v0] = keys[i - 1]!; const [t1, v1] = keys[i]!;
    if (s <= t1) return v0 + ((v1 - v0) * (s - t0)) / (t1 - t0);
  }
  return keys[keys.length - 1]![1];
}
/** A seeded generator (mulberry32): the same seed gives the same times on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A backdrop rect in `role` over the whole document, drawn first. */
export const backdrop = (size: [number, number], fill = 'paper'): JsonObject => item('backdrop', 'rect@1', 'a0', { box: [0, 0, size[0], size[1]], paint: { fill: { role: fill } } });

// --- Text cards (AC1, AC2, AC7) --------------------------------------------------------------------

export const CARD_SIZE: [number, number] = [360, 160];
/** A card: the backdrop and one text@1 `word` at 72 px with `paint` beside its fill. */
export function card(id: string, paint: JsonObject = {}, text = 'Paint'): JsonObject {
  return doc(id, CARD_SIZE, [
    backdrop(CARD_SIZE),
    item('word', 'text@1', 'a1', { text, font: 'body', size: 72, box: { w: 280, h: 100 }, paint: { fill: { role: 'title' }, ...paint } }, { at: { pos: [40, 30, 0] } }),
  ]);
}
/**
 * A number that fits its box only without what reaches past its glyphs: a story constant 8 shown by a template at
 * 20 px, left-aligned in a 30 × 40 u box that doesn't grow (Honest numbers: a number that doesn't fit fails).
 */
export function numberCard(id: string, paint: JsonObject = {}): JsonObject {
  return doc(id, [200, 120], [
    backdrop([200, 120]),
    item('fit', 'text@1', 'a1', { template: '{data/k}', font: 'body', size: 20, box: { w: 30, h: 40 }, autosize: 'none', max_lines: 1, align: 'start', paint: { fill: { role: 'title' }, ...paint } }, { at: { pos: [80, 40, 0] } }),
  ], { data: { k: { value: 8, source: 'story' } } });
}

/** AC2's four, each as its default reads plus what makes it visible here, and the outer bevel beside them. */
export const PAINTS: { name: string; where: 'inner' | 'outer'; paint: JsonObject }[] = [
  { name: 'glow (outer)', where: 'outer', paint: { glow: { where: 'outer', role: 'glow', size: 10, opacity: 1, mode: 'normal' } } },
  { name: 'glow (inner)', where: 'inner', paint: { glow: { where: 'inner', role: 'glow', size: 6, opacity: 1, mode: 'normal' } } },
  { name: 'inner shade', where: 'inner', paint: { shade: { kind: 'inner', role: 'shade', offset: 4, light: 135, blur: 3, choke: 0.2, opacity: 1 } } },
  { name: 'bevel (inner)', where: 'inner', paint: { bevel: { shape: 'inner', size: 5, light: { angle: 135, altitude: 30 }, highlight: { role: 'light', opacity: 0.75 }, shadow: { role: 'dark', opacity: 0.75 } } } },
  { name: 'bevel (outer)', where: 'outer', paint: { bevel: { shape: 'outer', size: 5, light: { angle: 135, altitude: 30 }, highlight: { role: 'light', opacity: 0.75 }, shadow: { role: 'dark', opacity: 0.75 } } } },
  { name: 'satin', where: 'inner', paint: { satin: { role: 'satin', offset: 6, size: 8, angle: 19, opacity: 0.8, mode: 'normal' } } },
];
/** All four on one still card. */
export const ALL_FOUR: JsonObject = {
  glow: { where: 'outer', role: 'glow', size: 10, opacity: 0.75 },
  shade: { kind: 'inner', role: 'shade', offset: 4, light: 135, blur: 3, opacity: 1 },
  bevel: { shape: 'inner', size: 5, light: { angle: 135, altitude: 30 }, highlight: { role: 'light', opacity: 0.75 }, shadow: { role: 'dark', opacity: 0.75 } },
  satin: { role: 'satin', offset: 6, size: 8, angle: 19, opacity: 0.5 },
};

// --- The 200 u disc (AC5) -----------------------------------------------------------------------------

export const DISC_SIZE: [number, number] = [320, 320];
/** The disc's center sits on a pixel center, so rays along the axes and diagonals step through pixel centers. */
export const DISC_CENTER: [number, number] = [160.5, 160.5];
export const DISC_R = 100;
/** A black 200 u disc over transparent black with `paint` beside its fill: the only item of its layer. */
export const disc = (id: string, paint: JsonObject = {}): JsonObject => doc(id, DISC_SIZE, [
  item('disc', 'circle@1', 'a1', { center: [...DISC_CENTER], r: DISC_R, paint: { fill: { role: 'black' }, ...paint } }),
]);

// --- The isometric sorting line (AC3, AC7) -------------------------------------------------------------

export const LINE_SIZE: [number, number] = [420, 280];
export const LINE_SPAN = 4;
export const FIG = 70;
/** A figure: `[x, y]` keys of its box's top-left corner (one key: still), its order key, its role. */
export interface Figure { id: string; order: string; role: string; x: [number, number][]; y: [number, number][] }
/**
 * Six figures of one size in a `sort: y` group. `a` walks down-right and `b` up-left, crossing each other at 2 s and
 * passing `c` and `d`; `c` and `d` stand with equal feet, where the order key (`d`'s is lower) and the ID disagree;
 * `e` and `f` stand with equal feet and equal order keys, so the ID decides, and `f` is written first.
 */
export const FIGURES: Figure[] = [
  { id: 'a', order: 'b1', role: 'figa', x: [[0, 40], [4, 200]], y: [[0, 30], [4, 170]] },
  { id: 'b', order: 'b2', role: 'figb', x: [[0, 200], [4, 40]], y: [[0, 170], [4, 30]] },
  { id: 'c', order: 'c1', role: 'figc', x: [[0, 110]], y: [[0, 100]] },
  { id: 'd', order: 'c0', role: 'figd', x: [[0, 150]], y: [[0, 100]] },
  { id: 'f', order: 'e0', role: 'figf', x: [[0, 330]], y: [[0, 160]] },
  { id: 'e', order: 'e0', role: 'fige', x: [[0, 300]], y: [[0, 160]] },
];
export function sortingLine(): JsonObject {
  const channels: JsonObject = {};
  const figures = FIGURES.map((f) => {
    if (f.x.length > 1) channels[`${f.id}-x`] = keyed(`items/${f.id}/params/box/0`, f.x);
    if (f.y.length > 1) channels[`${f.id}-y`] = keyed(`items/${f.id}/params/box/1`, f.y);
    return item(f.id, 'rect@1', f.order, { box: [f.x[0]![1], f.y[0]![1], FIG, FIG], paint: { fill: { role: f.role } } }, { parent: 'line' });
  });
  return doc('sorting-line', LINE_SIZE, [
    backdrop(LINE_SIZE),
    item('line', 'group@1', 'a1', { sort: 'y' }),
    ...figures,
  ], { transport: { span: `${LINE_SPAN}s` }, channels });
}
/** Each figure's box at `t` flicks. */
export const boxAt = (f: Figure, t: number): [number, number, number, number] => [keyedAt(f.x, t), keyedAt(f.y, t), FIG, FIG];
/** The draw order the criterion states at `t`: by foot y (the box's bottom, sort_anchor [0.5, 1]), then order key, then ID. */
export function footOrder(t: number): Figure[] {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return [...FIGURES].sort((p, q) => {
    const fp = keyedAt(p.y, t) + FIG; const fq = keyedAt(q.y, t) + FIG;
    return fp !== fq ? fp - fq : cmp(p.order, q.order) || cmp(p.id, q.id);
  });
}

// --- Parallax (AC4, AC6, AC7) ----------------------------------------------------------------------------

export interface Parallax { rate: [number, number]; repeat: [number, number]; drift: [number, number]; origin: [number, number] }
/** Floored modulo: v − R⌊v ÷ R⌋, the design's wrap; an axis whose repeat is 0 doesn't wrap. */
export const wrap = (v: number, r: number): number => (r === 0 ? v : v - r * Math.floor(v / r));
/** The design's closed form: origin + camera × (1 − rate) + drift × t, wrapped by repeat. */
export function closedForm(p: Parallax, cam: [number, number], seconds: number): [number, number] {
  return [0, 1].map((i) => wrap(p.origin[i]! + cam[i]! * (1 - p.rate[i]!) + p.drift[i]! * seconds, p.repeat[i]!)) as [number, number];
}
/** The distance between two wrapped offsets on an axis: across the wrap only where the expected value sits within 1e-3 of it. */
export function wrappedGap(got: number, want: number, r: number): number {
  const d = Math.abs(got - want);
  if (r === 0) return d;
  const nearSeam = want < 1e-3 || r - want < 1e-3;
  return nearSeam ? Math.min(d, Math.abs(r - d)) : d;
}

export const CAM_X: [number, number][] = [[0, 240], [10, 2240]];
export const CAM_Y: [number, number][] = [[0, 135], [10, -365]];
export const HILLS: Parallax = { rate: [0.35, 0.6], repeat: [170, 90], drift: [23.5, -11.25], origin: [12, -7] };
/** A 10 s figure whose 2D camera (#149's `camera@1`, its target as its position) travels while `hills` drifts and wraps on both axes. */
export function cameraParallax(): JsonObject {
  return doc('parallax-camera', [480, 270], [
    item('cam', 'camera@1', 'a0', { projection: 'orthographic', target: [CAM_X[0]![1], CAM_Y[0]![1], 0], view_width: 480 }),
    item('hills', 'group@1', 'a1', { parallax: { ...HILLS, repeat_count: 4 } }),
    item('hill', 'circle@1', 'a2', { center: [60, 200], r: 40, paint: { fill: { role: 'hill' } } }, { parent: 'hills' }),
  ], {
    camera: 'cam', transport: { span: '10s' },
    channels: { 'cam-x': keyed('items/cam/params/target/0', CAM_X), 'cam-y': keyed('items/cam/params/target/1', CAM_Y) },
  });
}

export const LOOP_S = 4.7;
export const CLOUDS: Parallax = { rate: [1, 1], repeat: [170, 0], drift: [170 / LOOP_S, 0], origin: [0, 0] };
export const NEAR: Parallax = { rate: [1, 1], repeat: [340, 0], drift: [340 / LOOP_S, 0], origin: [0, 0] };
/** AC6's 4.7 s loop: a sky, a cloud band repeating every 170 u and a near band every 340 u, each drifting one repeat a loop. */
export function bands(): JsonObject {
  return doc('parallax-bands', [480, 270], [
    backdrop([480, 270], 'sky'),
    item('clouds', 'group@1', 'a1', { parallax: { ...CLOUDS, repeat_count: 4 } }),
    item('cloud-1', 'circle@1', 'a2', { center: [40, 60], r: 22, paint: { fill: { role: 'cloud' } } }, { parent: 'clouds' }),
    item('cloud-2', 'circle@1', 'a3', { center: [70, 52], r: 30, paint: { fill: { role: 'cloud' } } }, { parent: 'clouds' }),
    item('cloud-3', 'circle@1', 'a4', { center: [130, 90], r: 18, paint: { fill: { role: 'cloud' } } }, { parent: 'clouds' }),
    item('near', 'group@1', 'a5', { parallax: { ...NEAR, repeat_count: 3 } }),
    item('hill-1', 'circle@1', 'a6', { center: [90, 300], r: 110, paint: { fill: { role: 'hill' } } }, { parent: 'near' }),
    item('hill-2', 'circle@1', 'a7', { center: [260, 320], r: 90, paint: { fill: { role: 'hill' } } }, { parent: 'near' }),
  ], { transport: { span: `${LOOP_S}s`, loop: 'wrap' } });
}
/** The marquee: repeat 881 u in a 4.8 s loop at −183.5 u/s, which travels 880.8 u and so jumps 0.2 u at the wrap. */
export function marquee(): JsonObject {
  return doc('parallax-marquee', [480, 120], [
    backdrop([480, 120], 'sky'),
    item('marquee', 'group@1', 'a1', { parallax: { rate: [1, 1], repeat: [881, 0], repeat_count: 2, drift: [-183.5, 0], origin: [0, 0] } }),
    item('sign', 'rect@1', 'a2', { box: [20, 40, 300, 40], paint: { fill: { role: 'marquee' } } }, { parent: 'marquee' }),
  ], { transport: { span: '4.8s', loop: 'wrap' } });
}

// --- Atlas tiles from the terrain recipe (AC4) --------------------------------------------------------------

/** Four interchangeable 16 × 16 grass tiles side by side, each its own green: the atlas the terrain picks from. */
export function atlasPng(): Buffer {
  return encodeRgbaPng(64, 16, (x) => [40 + 40 * Math.floor(x / 16), 140, 60, 255]);
}
/**
 * A hex floor (`rules: edges_6`) of grass cells. Every tile is grass with grass on all six edges, so a cell's six edge
 * labels are grass whether or not a neighbor is there (Mark set: hex grid), and its tile is the recipe's seeded choice
 * among four equal candidates. `cells` is written in the order given.
 */
export function terrain(atlas: string, cells: [number, number][]): JsonObject {
  const grass = Array.from({ length: 6 }, () => 'grass');
  return doc('terrain', [320, 240], [
    item('floor', 'tiles.terrain@1', 'a1', {
      atlas: { asset: atlas, cell: [16, 16], padding: 1 },
      grid: { shape: 'hex', cell: [32, 28], hex: { orient: 'pointy', offset: 'odd' } },
      tiles: [0, 1, 2, 3].map((tile) => ({ tile, terrain: 'grass', edges: grass })),
      cells: cells.map(([cx, cy]) => [cx, cy, 'grass']),
      rules: 'edges_6', precedence: ['grass'], seed: 467,
    }),
  ]);
}
/** A typed column (`{dtype, len, data: base64}`), a `{const}` column over `n` rows, or a plain array, as numbers. */
export function columnValues(v: JsonValue | undefined, n: number, what: string): number[] {
  if (Array.isArray(v)) return v.map((x, i) => num(x, `${what}[${i}]`));
  const c = obj(v, what);
  if ('const' in c) return Array.from({ length: n }, () => num(c['const'], `${what}.const`));
  const bytes = Buffer.from(str(c['data'], `${what}.data`), 'base64');
  const dtype = str(c['dtype'], `${what}.dtype`);
  const read: Record<string, [number, (o: number) => number]> = {
    i32: [4, (o) => bytes.readInt32LE(o)], u32: [4, (o) => bytes.readUInt32LE(o)], u16: [2, (o) => bytes.readUInt16LE(o)],
    u8: [1, (o) => bytes.readUInt8(o)], f32: [4, (o) => bytes.readFloatLE(o)], f64: [8, (o) => bytes.readDoubleLE(o)],
  };
  const r = read[dtype];
  expect(r, `${what}: a column dtype this suite reads (${Object.keys(read).join(', ')}), got ${dtype}`).toBeDefined();
  const len = typeof c['len'] === 'number' ? c['len'] : bytes.length / r![0];
  return Array.from({ length: len }, (_, i) => r![1](i * r![0]));
}
/**
 * The tile each cell got, by `"cx,cy"`, from the check's answer: the `marks@1` set with `cx`, `cy` and `tile` columns
 * that the `floor` instance expanded into (`expansions[].derived`), or, where the check fills a set in place, the one
 * in `lowered.items`.
 */
export function tilesOf(answer: JsonObject): Map<string, number> {
  const candidates: JsonObject[] = [];
  for (const e of Array.isArray(answer['expansions']) ? answer['expansions'] : []) {
    const derived = isObject(e) && isObject(e['derived']) ? e['derived'] : {};
    for (const d of Object.values(derived)) if (isObject(d)) candidates.push(d);
  }
  const lowered = isObject(answer['lowered']) && isObject(answer['lowered']['items']) ? answer['lowered']['items'] : {};
  for (const d of Object.values(lowered)) if (isObject(d)) candidates.push(d);
  const set = candidates.find((d) => d['kind'] === 'marks@1' && isObject(d['params']) && isObject(d['params']['columns']) && ['cx', 'cy', 'tile'].every((c) => c in (d['params'] as { columns: JsonObject }).columns));
  expect(set, `the check expands the terrain into a marks@1 set with cx, cy and tile columns; expansions: ${shown(answer['expansions'])}`).toBeDefined();
  const params = obj(set!['params'], 'the set\'s params');
  const columns = obj(params['columns'], 'the set\'s columns');
  const n = typeof params['n'] === 'number' ? params['n'] : columnValues(columns['tile'], 0, 'tile').length;
  const [cx, cy, tile] = ['cx', 'cy', 'tile'].map((c) => columnValues(columns[c], n, `column ${c}`));
  expect([cx!.length, cy!.length], 'cx, cy and tile have one value per row').toEqual([tile!.length, tile!.length]);
  return new Map(tile!.map((t, i) => [`${cx![i]},${cy![i]}`, t]));
}
