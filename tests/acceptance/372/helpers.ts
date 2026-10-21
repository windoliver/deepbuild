import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** The checkout root (tests/acceptance/372 is three levels down) and the binary the tests drive. */
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? 'deep-canvas.exe' : 'deep-canvas');

export function fixture(name: string): JsonObject {
  return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8')) as JsonObject;
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes).digest('hex');
}

/** Builds the binary; returns '' or the build's error text. The build is cached between files. */
export function buildBinary(): string {
  const run = spawnSync('cargo', ['build', '--locked', '-p', 'deep-canvas', '--bin', 'deep-canvas'], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build -p deep-canvas failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds the binary once per file and fails every test of the file, not just the hook, when it can't be built. */
export function useBinary(): void {
  let error = '';
  beforeAll(() => { error = buildBinary(); }, 600_000);
  beforeEach(() => { expect(error, 'the deep-canvas binary builds').toBe(''); });
}

/** Pipes every input line into one run of `deep-canvas <args>` and returns one parsed JSON object per line. */
export function batch(args: string[], inputs: JsonValue[]): JsonObject[] {
  const run = spawnSync(BIN, args, {
    input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  // A run that exits early (an unknown subcommand, a panic) can close stdin before reading it all: report
  // its exit and stderr first, rather than the broken pipe that follows.
  if (run.status !== null && run.status !== 0) throw Error(`deep-canvas ${args.join(' ')} exited ${run.status}:\n${run.stderr}`);
  if (run.error) throw Error(`deep-canvas ${args.join(' ')}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`deep-canvas ${args.join(' ')} exited ${run.status} (signal ${run.signal}):\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `deep-canvas ${args.join(' ')}: one output line per input line`).toBe(inputs.length);
  return lines.map((line) => {
    const out = JSON.parse(line) as JsonValue;
    expect(typeof out === 'object' && out !== null && !Array.isArray(out), `deep-canvas ${args.join(' ')}: an object per line`).toBe(true);
    return out as JsonObject;
  });
}

export function one(args: string[], input: JsonValue): JsonObject {
  return batch(args, [input])[0]!;
}

/** The revision hash of #389: the SHA-256 of the document's canonical bytes. */
export function revisionHash(doc: JsonObject): string {
  const out = one(['canonical'], { doc });
  expect(typeof out['sha256'], `canonical: ${JSON.stringify(out)}`).toBe('string');
  return out['sha256'] as string;
}

// ---------------------------------------------------------------------------------------------------
// The session surface: a document, a viewport and a list of inputs in; the state after each input out.

export type Vec = [number, number, number];
export interface Camera { position: Vec; target: Vec; azimuth: number; elevation: number; distance: number; fov: number; view_width: number; zoom: number }
export interface State { camera: Camera; view: { [control: string]: JsonValue }; hover: string | null }
export interface Session { ok: true; hash: string; doc: JsonObject; track: JsonObject[]; start: State; trace: State[] }

export type Input =
  | { op: 'drag'; at: [number, number]; delta: [number, number] }
  | { op: 'pinch'; at: [number, number]; scale: number }
  | { op: 'hover'; at: [number, number] }
  | { op: 'control'; control: string; value: JsonValue };

export function sessions(runs: { doc: JsonObject; viewport: [number, number]; inputs: Input[] }[]): Session[] {
  const outs = batch(['session'], runs as unknown as JsonValue[]);
  return outs.map((out, i) => {
    expect(out['ok'], `session ${i} answers ok: ${JSON.stringify(out).slice(0, 400)}`).toBe(true);
    const trace = out['trace'];
    expect(Array.isArray(trace) && trace.length === runs[i]!.inputs.length, `session ${i}: one state in the trace per input`).toBe(true);
    return out as unknown as Session;
  });
}

export function session(doc: JsonObject, viewport: [number, number], inputs: Input[]): Session {
  return sessions([{ doc, viewport, inputs }])[0]!;
}

// ---------------------------------------------------------------------------------------------------
// The render surface: a document's still frame into a panel of a given size, as raw RGBA8 on disk.

export interface Image { width: number; height: number; rgba: Uint8Array }

let scratch = '';
let serial = 0;
export function render(doc: JsonObject, panel: [number, number], ground: [number, number, number]): Image {
  if (scratch === '') scratch = mkdtempSync(join(tmpdir(), 'deep-canvas-372-'));
  const out = join(scratch, `frame-${serial++}.rgba`);
  const answer = one(['render'], { doc, panel, ground, out });
  expect(answer['ok'], `render ${panel.join('x')} answers ok: ${JSON.stringify(answer).slice(0, 400)}`).toBe(true);
  expect([answer['width'], answer['height']], 'render reports the panel size').toEqual(panel);
  const rgba = new Uint8Array(readFileSync(out));
  expect(rgba.length, `render ${panel.join('x')} writes width x height x 4 bytes`).toBe(panel[0] * panel[1] * 4);
  return { width: panel[0], height: panel[1], rgba };
}

export function pixel(img: Image, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.rgba[i]!, img.rgba[i + 1]!, img.rgba[i + 2]!, img.rgba[i + 3]!];
}

export function isColor(img: Image, x: number, y: number, rgb: readonly number[]): boolean {
  const i = (y * img.width + x) * 4;
  return img.rgba[i] === rgb[0] && img.rgba[i + 1] === rgb[1] && img.rgba[i + 2] === rgb[2] && img.rgba[i + 3] === 255;
}

/** Whether every pixel of row y is the given opaque color. */
export function rowIs(img: Image, y: number, rgb: readonly number[]): boolean {
  for (let x = 0; x < img.width; x++) if (!isColor(img, x, y, rgb)) return false;
  return true;
}

/** Rows [y0, y0 + h) of an image as its own image. */
export function rows(img: Image, y0: number, h: number): Image {
  return { width: img.width, height: h, rgba: img.rgba.subarray(y0 * img.width * 4, (y0 + h) * img.width * 4) };
}

/** The pixels exactly of one opaque color: how many, and their centroid (pixel centres at +0.5). */
export function blob(img: Image, rgb: readonly number[]): { count: number; cx: number; cy: number } {
  let count = 0; let sx = 0; let sy = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (isColor(img, x, y, rgb)) { count++; sx += x + 0.5; sy += y + 0.5; }
    }
  }
  return { count, cx: count ? sx / count : NaN, cy: count ? sy / count : NaN };
}

// ---------------------------------------------------------------------------------------------------
// A seeded PRNG of this file's own: splitmix32 seeds four xorshift128 words. Fixed seeds live below.

export const SEEDS = { ac1: 0x3720_0001, eye: 0x3720_0002, yaw: 0x3720_0003, pan: 0x3720_0004, pinch: 0x3720_0005 } as const;

export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  constructor(seed: number) {
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next(); this.b = next(); this.c = next(); this.d = next() | 1;
  }
  u32(): number {
    let t = this.d;
    const s = this.a;
    this.d = this.c; this.c = this.b; this.b = s;
    t ^= t << 11; t ^= t >>> 8;
    this.a = (t ^ s ^ (s >>> 19)) >>> 0;
    return this.a;
  }
  /** A float in [0, 1). */
  unit(): number { return this.u32() / 4294967296; }
  /** A float in [lo, hi). */
  float(lo: number, hi: number): number { return lo + (hi - lo) * this.unit(); }
  /** An integer in [lo, hi]. */
  range(lo: number, hi: number): number { return lo + (this.u32() % (hi - lo + 1)); }
  chance(p: number): boolean { return this.unit() < p; }
}

/** A drag that starts anywhere in the viewport and moves up to `reach` px each way, in whole px. */
export function randomDrag(rng: Rng, viewport: [number, number], reach: number): Input {
  return { op: 'drag', at: [rng.range(0, viewport[0] - 1), rng.range(0, viewport[1] - 1)], delta: [rng.range(-reach, reach), rng.range(-reach, reach)] };
}

/** A pinch anywhere in the viewport by a factor between 0.7 and 1.4 (log-uniform), rounded to 1/1024. */
export function randomPinch(rng: Rng, viewport: [number, number]): Input {
  const scale = Math.round(Math.exp(rng.float(Math.log(0.7), Math.log(1.4))) * 1024) / 1024;
  return { op: 'pinch', at: [rng.range(0, viewport[0] - 1), rng.range(0, viewport[1] - 1)], scale };
}

/** An angle difference wrapped into (-180, 180]. */
export function wrapDeg(d: number): number {
  let r = ((d % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return r;
}
