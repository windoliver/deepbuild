// Test-side tools for the #1484 acceptance tests: the binaries (built by cargo in the checkout, once per file and cached
// by cargo across files, copied out under their own names, as #1479's suite does), runs of their JSON lines, the
// documents the criteria draw, PNG reading, the shipped clean look's ground and ink, and the coverage reading #385's
// first criterion holds a glyph run to (as #1479's suite reads it). Nothing here stands in for the shaper, the atlas
// or a renderer: every value a test compares comes from a binary, and every expected value from the issue, the font
// file (instance.ts) or a second renderer.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1484 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #1484.57659fda',
  2: 'AC2 #1484.2a04de3f',
  3: 'AC3 #1484.1be2fec6',
  4: 'AC4 #1484.f9223910',
  5: 'AC5 #1484.6f97433d',
  6: 'AC6 #1484.c44e2788',
  7: 'AC7 #1484.2d4b65dd',
} as const;

/** The run every criterion but the warm shaping's shows: plain letters, each a simple glyph in the bundled Inter
 * faces (no i or j, whose dots make them composites the oracle doesn't read), one glyph per letter, no ligature. */
export const TEXT = 'Hamburgefonts';

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 800)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 800)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe('string');
  return value as string;
}
/** A criterion that can't be judged here stays open: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A check that must fail on a wrong program: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the wrong program passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The builds: `cargo build --locked [--release] --bin <name>` in the checkout (cargo's cache makes every build after a
// run's first a no-op), the binary copied out of the target folder under its own name into a folder of the file's.

export const CARGO_ENV: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

/** `cargo build --locked [--release] --bin <name>` in `cwd` into `target`: '' when it built, else cargo's error. */
export function cargoBuild(cwd: string, name: string, release: boolean, env: NodeJS.ProcessEnv = CARGO_ENV): string {
  const args = ['build', '--locked', ...(release ? ['--release'] : []), '--bin', name];
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status === 0) return '';
  return `cargo ${args.join(' ')} failed in ${cwd}:\n${(run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
}

/** Where `cargo build` in `cwd` puts `<profile>/<name>` (CARGO_TARGET_DIR when set, as cargo reads it). */
export function built(cwd: string, name: string, release: boolean, env: NodeJS.ProcessEnv = CARGO_ENV): string {
  const target = env['CARGO_TARGET_DIR'] ? resolve(cwd, env['CARGO_TARGET_DIR']) : join(cwd, 'target');
  return join(target, release ? 'release' : 'debug', exe(name));
}

/** The binary built before the file's tests and copied out; a test that uses it after a failed build fails with
 * cargo's error. */
export function useBin(name: 'deep-canvas-render' | 'deep-text', release = false): () => string {
  let dir = '';
  let bin = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), `deep-1484-${name}-`));
    error = cargoBuild(REPO, name, release);
    if (error === '') {
      bin = join(dir, exe(name));
      copyFileSync(built(REPO, name, release), bin);
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked${release ? ' --release' : ''} --bin ${name}`).toBe('');
    return bin;
  };
}

/** A fresh temporary folder per test, deleted after it. */
export function useDir(prefix: string): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), prefix)); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running a binary: JSON lines in, one JSON line out per line in, in order, exit 0.

/** One process of `<bin> <args>` over `lines`: every line answered, in order, exit 0. */
export function run(bin: string, args: string[], lines: JsonObject[], timeoutMs = 3_000_000): JsonObject[] {
  const shown = `${bin.split('/').at(-1)} ${args.join(' ')}`;
  const r = spawnSync(bin, args, {
    cwd: REPO, input: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') throw Error(`${shown}: ${r.error.message}`);
  expect(r.error, `${shown} finished within ${timeoutMs} ms`).toBeUndefined();
  const stdout = r.stdout ?? '';
  expect(r.status, `${shown} exited 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${shown}: one output line per input line; stdout: ${stdout.slice(0, 1500)}`).toBe(lines.length);
  return out.map((l, i) => {
    let v: JsonValue;
    try { v = JSON.parse(l) as JsonValue; } catch { v = l; }
    return obj(v, `${shown}: answer ${i + 1}`);
  });
}

/** GPUI's frame path draws only on macOS (its offscreen Metal renderer); anywhere else the test is INCONCLUSIVE. */
export function needsMac(): void {
  if (process.platform !== 'darwin') inconclusive(`GPUI's frame path needs macOS with Metal; this is ${process.platform}`);
}
/** An answer drew: `ok`, with `unsupported_platform` INCONCLUSIVE, never a pass. */
export function drew(answer: JsonObject, what: string): JsonObject {
  if (answer['ok'] === false && answer['code'] === 'unsupported_platform') inconclusive(`${what} answers unsupported_platform`);
  expect(answer['ok'], `${what} answered ok: ${JSON.stringify(answer).slice(0, 1500)}`).toBe(true);
  return answer;
}

// ---------------------------------------------------------------------------------------------------
// Documents: text@1 items in the body role, in the shipped clean look (the one the app draws in).

export const LOOK = 'clean';
export interface Item { id: string; text: string; size: number; weight: number; pos: [number, number] }
/** A figure of `size` u holding `items`, each a text@1 item in the body role, inked in the look's `ink`. */
export function textDoc(id: string, size: [number, number], items: Item[]): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `#1484 ${id}`, description: `The #1484 acceptance tests' document ${id}.`, size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } },
    items: Object.fromEntries(items.map((t, k) => [t.id, {
      id: t.id, kind: 'text@1', layer: 'main', name: t.id, order: `a${k}`, at: { pos: [t.pos[0], t.pos[1], 0] },
      params: { text: t.text, font: 'body', size: t.size, weight: t.weight, paint: { fill: { role: 'ink' } } },
    }])),
  };
}
let drawn = 0;
/** A `render` (GPUI's frame) or `raster` (Vello CPU) line: `doc` in the clean look at view zoom `zoom`, its PNG in `dir`. */
export function drawLine(dir: string, doc: JsonObject, zoom: number, theme: 'light' | 'dark' = 'dark', extra: JsonObject = {}): JsonObject {
  drawn += 1;
  return { out: join(dir, `d${drawn}.png`), doc, look: LOOK, view: { zoom, theme }, ...extra };
}
/** How a run is named in a failure: its item, text, size and weight. */
export const runName = (t: Item): string => `run ${t.id} (${JSON.stringify(t.text)}, ${t.size} u, weight ${t.weight})`;

// ---------------------------------------------------------------------------------------------------
// The clean look's ground and ink in a theme, read from the shipped look file (sRGB, 0-255).

export interface Colors { ground: [number, number, number]; ink: [number, number, number] }
export function lookColors(theme: 'light' | 'dark'): Colors {
  const look = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as JsonObject;
  const t = obj(obj(look['themes'], 'clean.json: themes')[theme], `clean.json: themes.${theme}`);
  const roles = { ...obj(look['roles'], 'clean.json: roles'), ...(isObject(t['roles']) ? t['roles'] : {}) };
  const palette = { ...obj(look['palette'], 'clean.json: palette'), ...(isObject(t['palette']) ? t['palette'] : {}) };
  const rgb = (role: string): [number, number, number] => {
    const hex = str(palette[str(roles[role], `clean.json: the ${theme} role ${role}`)], `clean.json: the ${theme} ${role}'s color`);
    expect(/^#[0-9a-f]{6}$/i.test(hex), `clean.json: the ${theme} ${role} is an opaque #rrggbb, got ${hex}`).toBe(true);
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  };
  const c: Colors = { ground: rgb('ground'), ink: rgb('ink') };
  expect(Math.abs(c.ink[0] - c.ground[0]), `the ${theme} theme's ink and ground are far apart in red`).toBeGreaterThan(100);
  return c;
}

// ---------------------------------------------------------------------------------------------------
// PNG (8-bit RGB or RGBA, no interlace)

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
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
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw Error(`PNG filter ${filter}`);
      }
      line[i] = v & 255;
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

/** One drawn line's picture: the answer accepted and its PNG the document's size at the zoom, in device px. */
export function picture(line: JsonObject, answer: JsonObject, what: string): Image {
  drew(answer, what);
  const out = String(line['out']);
  expect(existsSync(out), `${what}: the PNG was written to ${out}`).toBe(true);
  const image = decodePng(readFileSync(out));
  const size = arr(obj(line['doc'], 'doc')['size'], 'doc.size').map((v) => num(v, 'doc.size'));
  const zoom = num(obj(line['view'], 'view')['zoom'], 'view.zoom');
  const near = Math.abs(image.width - size[0]! * zoom) <= 1 && Math.abs(image.height - size[1]! * zoom) <= 1;
  expect(near, `${what}: the PNG is the document's size at zoom ${zoom} in device px (within a pixel), got ${image.width} × ${image.height}`).toBe(true);
  return image;
}

// ---------------------------------------------------------------------------------------------------
// A text item's glyphs as `raster` (Vello CPU) reports them (#381's `texts`, #496's `advance`, `outline`, `transform`).

export interface Glyph {
  index: number; id: number; grapheme: number; font: string; size: number; x: number; advance: number;
  /** The pen position in document u: the glyph's own frame's origin on its baseline. */
  pen: [number, number];
  /** Path commands in the glyph's own frame, in u, y down. */
  outline: (string | number)[][];
}
export function glyphsOf(answer: JsonObject, item: string, what: string): Glyph[] {
  const t = obj(obj(answer['texts'], `${what}: texts`)[item], `${what}: texts.${item}`);
  return arr(t['glyphs'], `${what}: texts.${item}.glyphs`).map((g, index) => {
    const o = obj(g, `${what}: ${item}'s glyph ${index}`);
    const m = arr(o['transform'], `${what}: ${item}'s glyph ${index}'s transform`).map((v) => num(v, 'transform'));
    return {
      index, id: num(o['id'], 'glyph id'), grapheme: num(o['grapheme'], 'glyph grapheme'), font: str(o['font'], 'glyph font'),
      size: num(o['size'], 'glyph size'), x: num(o['x'], 'glyph x'), advance: num(o['advance'], 'glyph advance'), pen: [m[4]!, m[5]!],
      outline: arr(o['outline'], `${what}: ${item}'s glyph ${index}'s outline`).map((c) => arr(c, 'outline command') as (string | number)[]),
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Coverage (#385's first criterion, as #1479's suite reads it): a pixel's coverage is how far its red channel lies from
// the ground's toward the ink's (2D writer layers composite in sRGB-encoded space, so a pixel at coverage a is
// ground + a·(ink − ground) in every channel); summed over pixels, its centroid weighted by pixel centres.

export interface Cover { sum: number; cx: number; cy: number }
/** Coverage summed over the rect [x0, x1) × [y0, y1) of `image` (all of it by default), and its centroid. */
export function coverage(image: Image, colors: Colors, x0 = 0, x1 = image.width, y0 = 0, y1 = image.height): Cover {
  const [g, i] = [colors.ground[0], colors.ink[0]];
  let sum = 0; let sx = 0; let sy = 0;
  const [a, b] = [Math.max(0, Math.floor(x0)), Math.min(image.width, Math.ceil(x1))];
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(image.height, Math.ceil(y1)); y++) {
    for (let x = a; x < b; x++) {
      const c = (image.rgba[(y * image.width + x) * 4]! - g) / (i - g);
      sum += c; sx += c * (x + 0.5); sy += c * (y + 0.5);
    }
  }
  return { sum, cx: sum ? sx / sum : NaN, cy: sum ? sy / sum : NaN };
}

/** #385's first criterion for one glyph run: summed coverage within 2% of Vello CPU's, its centroid within 0.1 device
 * px. The frame holds that run alone, so the frame's coverage is the run's. Each problem names the run. */
export function runProblems(name: string, gpui: Image, vello: Image, colors: Colors, what: string): string[] {
  const v = coverage(vello, colors);
  const g = coverage(gpui, colors);
  if (!(v.sum > 0)) return [`${what}: ${name} covers nothing in Vello CPU's snapshot`];
  const p: string[] = [];
  const off = (g.sum - v.sum) / v.sum;
  if (!(Math.abs(off) <= 0.02)) p.push(`${what}: ${name}: summed coverage ${g.sum.toFixed(2)} in the window against ${v.sum.toFixed(2)} in Vello CPU's snapshot, ${(off * 100).toFixed(1)}% apart, past 2%`);
  const d = Math.hypot(g.cx - v.cx, g.cy - v.cy);
  if (!(d <= 0.1)) p.push(`${what}: ${name}: coverage centroid (${g.cx.toFixed(3)}, ${g.cy.toFixed(3)}) in the window against (${v.cx.toFixed(3)}, ${v.cy.toFixed(3)}) in Vello CPU's snapshot, ${d.toFixed(3)} device px apart, past 0.1`);
  return p;
}
