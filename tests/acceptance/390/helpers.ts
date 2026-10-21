import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** The checkout root (tests/acceptance/390 is three levels down) and what the tests drive. */
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const exe = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);
/** The shaper's binary (crate `deep-text`): `fit` and `fonts`. Its crate must not reach GPUI. */
export const TEXT_BIN = exe('deep-text');
/** The headless render binary (any workspace crate that may reach GPUI): `render`. */
export const RENDER_BIN = exe('deep-text-render');
export const RENDER_BIN_NAME = 'deep-text-render';
export const LINT = join(REPO, 'scripts', 'text-lint.mjs');
/** The lint's scope marker and crate-name prefix. */
export const SCOPE_MARKER = 'canvas_text';
export const SCOPE_PREFIX = 'deep-text';

export function fixture<T = JsonValue>(name: string): T {
  return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8')) as T;
}

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

/** Pipes every input line into one run of `<bin> <args>` and returns one parsed JSON value per line. */
export function batch(bin: string, args: string[], inputs: JsonValue[]): JsonValue[] {
  const run = spawnSync(bin, args, {
    cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  const name = `${bin.split('/').at(-1)} ${args.join(' ')}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines.map((line) => JSON.parse(line) as JsonValue);
}

export function one(bin: string, args: string[], input: JsonValue): JsonObject {
  const out = batch(bin, args, [input])[0];
  expect(isObject(out), `${bin.split('/').at(-1)} ${args.join(' ')}: an object per line`).toBe(true);
  return out as JsonObject;
}

/** `deep-text fit` over a batch; every line must be accepted (`ok: true`). */
export function fitAll(inputs: JsonObject[]): JsonObject[] {
  const outs = batch(TEXT_BIN, ['fit'], inputs);
  return outs.map((out, i) => {
    expect(isObject(out), `fit ${JSON.stringify(inputs[i])}: an object`).toBe(true);
    const o = out as JsonObject;
    expect(o['ok'], `fit ${JSON.stringify(inputs[i])} was refused: ${JSON.stringify(o)}`).toBe(true);
    return o;
  });
}

export function number(value: JsonValue | undefined, what: string): number {
  expect(typeof value, `${what} is a number, got ${JSON.stringify(value)}`).toBe('number');
  return value as number;
}

// ---------------------------------------------------------------------------------------------------
// PNG: a reader for what the render writes (8-bit RGB or RGBA, no interlace), with node built-ins only.

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Buffer): Image {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!file.subarray(0, 8).equals(signature)) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!;
    } else if (type === 'IDAT') data.push(body);
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

export function readPng(path: string): Image { return decodePng(readFileSync(path)); }

export type Rgb = [number, number, number];
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}

/** The number of pixels where two images differ in any of R, G, B, and the first such pixel. */
export function diffPixels(a: Image, b: Image): { count: number; first: [number, number] | null } {
  if (a.width !== b.width || a.height !== b.height) return { count: a.width * a.height, first: [0, 0] };
  let count = 0; let first: [number, number] | null = null;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const o = (y * a.width + x) * 4;
    if (a.rgba[o] !== b.rgba[o] || a.rgba[o + 1] !== b.rgba[o + 1] || a.rgba[o + 2] !== b.rgba[o + 2]) { count++; first ??= [x, y]; }
  }
  return { count, first };
}

export interface Box { x: number; y: number; w: number; h: number }

/** The box the render reports for label `i`, as integers that cover it. */
export function labelBox(report: JsonObject, i: number): Box {
  const labels = report['labels'];
  expect(Array.isArray(labels), `render reports labels: ${JSON.stringify(report)}`).toBe(true);
  const label = (labels as JsonValue[])[i];
  expect(isObject(label), `render reports label ${i}`).toBe(true);
  const l = label as JsonObject;
  const x = number(l['x'], `labels[${i}].x`); const y = number(l['y'], `labels[${i}].y`);
  const w = number(l['w'], `labels[${i}].w`); const h = number(l['h'], `labels[${i}].h`);
  expect(w > 0 && h > 0, `labels[${i}] has a positive box, got ${JSON.stringify(l)}`).toBe(true);
  return { x: Math.floor(x), y: Math.floor(y), w: Math.ceil(x + w) - Math.floor(x), h: Math.ceil(y + h) - Math.floor(y) };
}

/** The ink's bounds: every pixel that differs from `background` by more than `threshold` in any channel. */
export function inkBounds(image: Image, background: Rgb, threshold = 8): Box | null {
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const p = pixel(image, x, y);
    if (Math.abs(p[0] - background[0]) > threshold || Math.abs(p[1] - background[1]) > threshold || Math.abs(p[2] - background[2]) > threshold) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Whether `inner` lies inside `outer` grown by `margin` on every side. */
export function within(inner: Box, outer: Box, margin: number): boolean {
  return inner.x >= outer.x - margin && inner.y >= outer.y - margin
    && inner.x + inner.w <= outer.x + outer.w + margin && inner.y + inner.h <= outer.y + outer.h + margin;
}

// ---------------------------------------------------------------------------------------------------
// The user's font-smoothing preference, for the render process only: an unbundled executable's
// CFPreferences application domain is its executable name, so `defaults write deep-text-render
// AppleFontSmoothing -int 0` is what GPUI's `CFPreferencesCopyAppValue(…, kCFPreferencesCurrentApplication)`
// reads in that process (verified on macOS 14 with a probe tool). Nothing global is touched.

function defaults(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync('defaults', args, { encoding: 'utf8' });
  if (run.error) throw Error(`defaults ${args.join(' ')}: ${run.error.message}`);
  return { status: run.status, stdout: run.stdout.trim(), stderr: run.stderr.trim() };
}

export interface PreferenceState { domainExisted: boolean; value: string | null }

export function readRenderSmoothingPreference(): PreferenceState {
  const domain = defaults(['read', RENDER_BIN_NAME]);
  const value = defaults(['read', RENDER_BIN_NAME, 'AppleFontSmoothing']);
  return { domainExisted: domain.status === 0, value: value.status === 0 ? value.stdout : null };
}

/** The user's own, global setting: "0" when smoothing is off for every app. */
export function globalSmoothingPreference(): string | null {
  const value = defaults(['read', '-g', 'AppleFontSmoothing']);
  return value.status === 0 ? value.stdout : null;
}

export function setRenderSmoothingOff(): void {
  const run = defaults(['write', RENDER_BIN_NAME, 'AppleFontSmoothing', '-int', '0']);
  if (run.status !== 0) throw Error(`defaults write failed: ${run.stderr}`);
}

export function restoreRenderSmoothingPreference(prior: PreferenceState): void {
  if (prior.value !== null) { defaults(['write', RENDER_BIN_NAME, 'AppleFontSmoothing', '-int', prior.value]); return; }
  defaults(['delete', RENDER_BIN_NAME, 'AppleFontSmoothing']);
  if (!prior.domainExisted) defaults(['delete', RENDER_BIN_NAME]);
}

/** Fails with an INCONCLUSIVE message off macOS: the pixel tests need the offscreen Metal renderer. */
export function requireMacos(): void {
  expect(process.platform, 'INCONCLUSIVE: the render draws with GPUI\'s offscreen Metal renderer, macOS only; this is not a pass').toBe('darwin');
}

// ---------------------------------------------------------------------------------------------------
// cargo metadata: the workspace's packages and the normal-dependency closure of one of them.

export interface Metadata {
  packages: { id: string; name: string; manifest_path: string; targets: { name: string; kind: string[] }[]; metadata: JsonValue }[];
  resolve: { nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null; target: string | null }[] }[] }[] };
  workspace_members: string[];
}

export function cargoMetadata(root = REPO): Metadata {
  const run = spawnSync('cargo', ['metadata', '--format-version', '1', '--locked'], { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (run.error) throw Error(`cargo metadata: ${run.error.message}`);
  if (run.status !== 0) throw Error(`cargo metadata exited ${run.status}:\n${run.stderr}`);
  return JSON.parse(run.stdout) as Metadata;
}

/** The names of every package reachable from `name` over normal (not dev, not build) dependencies, on any target. */
export function normalClosure(meta: Metadata, name: string): Set<string> {
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const root = meta.packages.find((p) => p.name === name && meta.workspace_members.includes(p.id));
  if (!root) throw Error(`no workspace package named ${name}`);
  const seen = new Set<string>();
  const queue = [root.id];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind === null || k.kind === 'normal')) queue.push(dep.pkg);
    }
  }
  return new Set([...seen].map((id) => byId.get(id)?.name ?? id));
}
