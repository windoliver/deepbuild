import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/391 is three levels down) and what the tests drive. */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);
/** Motion evaluation, key insertion and the frame clock on a virtual display: `eval`, `insert`, `run`. */
export const MOTION_BIN = exe('deep-motion');
export const MOTION_BIN_NAME = 'deep-motion';
/** The headless 2D view drawn with GPUI's offscreen Metal renderer: `frames`, `session`, `render`. */
export const RENDER_BIN = exe('deep-canvas-render');
export const RENDER_BIN_NAME = 'deep-canvas-render';

// ---------------------------------------------------------------------------------------------------
// Time: flicks, 1/705,600,000 s (canvas primitives: Time and the flick). Every time the tests send or
// read is a whole flick count as a JSON number; every one they use is far below 2^53.

export const FLICKS_PER_SECOND = 705_600_000;
/** Seconds to flicks; every value the tests pass is a whole number of flicks. */
export function sec(seconds: number): number {
  const flicks = Math.round(seconds * FLICKS_PER_SECOND);
  if (Math.abs(flicks - seconds * FLICKS_PER_SECOND) > 1e-3) throw Error(`${seconds} s is not a whole number of flicks`);
  return flicks;
}
export const ms = (milliseconds: number): number => milliseconds * 705_600;
/** One vsync at 60 Hz: 11,760,000 flicks. */
export const VSYNC_60 = FLICKS_PER_SECOND / 60;

// ---------------------------------------------------------------------------------------------------
// Fixtures and JSON

export function fixture(path: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${path} is not a JSON object`);
  return value;
}

export function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 400)}`).toBe(true);
  return value as JsonObject;
}

export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 400)}`).toBe(true);
  return value as JsonValue[];
}

export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value, `${what} is a number, got ${JSON.stringify(value)}`).toBe('number');
  return value as number;
}

/** JSON text with every object's keys sorted, for comparing evaluated data independently of key order. */
export function canonical(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------------------------------
// The binaries: built once per file, driven by JSON lines on stdin, one JSON line out per line in.

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
export function batch(bin: string, args: string[], inputs: (JsonValue | string)[]): JsonValue[] {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  const name = `${bin.split('/').at(-1)} ${args.join(' ')}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines.map((line) => JSON.parse(line) as JsonValue);
}

/** One line through `<bin> <subcommand>`; the answer must be an object. */
export function one(bin: string, subcommand: string, input: JsonValue | string): JsonObject {
  const out = batch(bin, [subcommand], [input])[0];
  return obj(out, `${bin.split('/').at(-1)} ${subcommand}: the answer`);
}

/** One line that must be accepted (`ok: true`). */
export function accepted(bin: string, subcommand: string, input: JsonValue): JsonObject {
  const out = one(bin, subcommand, input);
  expect(out['ok'], `${bin.split('/').at(-1)} ${subcommand} refused: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  return out;
}

/** Fails with an INCONCLUSIVE message off macOS: the GPU tests need GPUI's offscreen Metal renderer. */
export function requireMacos(): void {
  expect(process.platform, 'INCONCLUSIVE: the view is drawn with GPUI\'s offscreen Metal renderer, macOS only; this is not a pass').toBe('darwin');
}

/** One line through `deep-canvas-render <subcommand>`, INCONCLUSIVE on `unsupported_platform`, else accepted. */
export function render(subcommand: string, input: JsonValue): JsonObject {
  requireMacos();
  const out = one(RENDER_BIN, subcommand, input);
  if (out['ok'] !== true && out['code'] === 'unsupported_platform') {
    expect.fail(`INCONCLUSIVE: deep-canvas-render ${subcommand} reports unsupported_platform; this is not a pass`);
  }
  expect(out['ok'], `deep-canvas-render ${subcommand} refused: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The look the tests hand the renderer: role → sRGB-encoded [r, g, b], per theme. The tests' documents
// name only these roles; a paint never carries a literal color (2D marks and paint).

export const LOOK: JsonObject = {
  light: {
    ground: [250, 250, 248], ink: [28, 28, 30], muted: [120, 120, 128], accent: [40, 90, 200],
    'grad.from': [236, 238, 244], 'grad.to': [214, 220, 232], live: [200, 120, 40],
  },
  dark: {
    ground: [18, 18, 20], ink: [230, 230, 232], muted: [140, 140, 150], accent: [90, 140, 240],
    'grad.from': [36, 38, 44], 'grad.to': [54, 60, 72], live: [230, 150, 60],
  },
};

// ---------------------------------------------------------------------------------------------------
// Floating point: ulp distance in f64, and Blender's EXPECT_FLOAT_EQ (4 ulps of f32).

function ordered64(x: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigInt64(0);
  return bits < 0n ? -(bits & 0x7fffffffffffffffn) : bits;
}

/** The number of f64 values between a and b (0 when equal, 1 for neighbours; +0 and -0 are 0 apart). */
export function ulps64(a: number, b: number): bigint {
  const d = ordered64(a) - ordered64(b);
  return d < 0n ? -d : d;
}

function ordered32(x: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, x);
  const bits = view.getInt32(0);
  return bits < 0 ? -(bits & 0x7fffffff) : bits;
}

/** googletest's EXPECT_FLOAT_EQ, which Blender's subdivision test uses: equal within 4 ulps once both are f32. */
export function floatEq(a: number, b: number): boolean {
  return Number.isFinite(a) && Math.abs(ordered32(a) - ordered32(b)) <= 4;
}

// ---------------------------------------------------------------------------------------------------
// The reference for cubic-bezier() timing, ported from web-platform-tests at 2f57f45d21,
// css/css-easing/testcommon.js (`cubicBezier`), which the WPT easing tests compare against.
//
// Copyright © web-platform-tests contributors. Licensed under the 3-Clause BSD License:
// Redistribution and use in source and binary forms, with or without modification, are permitted
// provided that the following conditions are met: 1. Redistributions of source code must retain the
// above copyright notice, this list of conditions and the following disclaimer. 2. Redistributions in
// binary form must reproduce the above copyright notice, this list of conditions and the following
// disclaimer in the documentation and/or other materials provided with the distribution. 3. Neither
// the name of the copyright holder nor the names of its contributors may be used to endorse or
// promote products derived from this software without specific prior written permission. THIS
// SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED
// WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
// FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
// PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
// USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

/** Cubic Bézier with control points (0, 0), (x1, y1), (x2, y2) and (1, 1), solved by binary subdivision. */
export function wptCubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  function xForT(t: number): number {
    const omt = 1 - t;
    return 3 * omt * omt * t * x1 + 3 * omt * t * t * x2 + t * t * t;
  }
  function yForT(t: number): number {
    const omt = 1 - t;
    return 3 * omt * omt * t * y1 + 3 * omt * t * t * y2 + t * t * t;
  }
  function tForX(x: number): number {
    let mint = 0;
    let maxt = 1;
    for (let i = 0; i < 30; ++i) {
      const guesst = (mint + maxt) / 2;
      const guessx = xForT(guesst);
      if (x < guessx) maxt = guesst;
      else mint = guesst;
    }
    return (mint + maxt) / 2;
  }
  return function bezierClosure(x: number): number {
    if (x === 0) return 0;
    if (x === 1) return 1;
    return yForT(tForX(x));
  };
}
// (end of the WPT port)

// ---------------------------------------------------------------------------------------------------
// PNG: a reader for what the render writes (8-bit RGB or RGBA, no interlace), with node built-ins only,
// as #390's tests read theirs.

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

// ---------------------------------------------------------------------------------------------------
// Evaluated frames from `deep-motion eval` and `run`.

/** The evaluated x of an item (`at.pos[0]`) in one frame. */
export function itemX(frame: JsonObject, item: string): number {
  const items = obj(frame['items'], `frame ${String(frame['t'])}: items`);
  const at = obj(obj(items[item], `frame ${String(frame['t'])}: items.${item}`)['at'], `items.${item}.at`);
  const pos = arr(at['pos'], `items.${item}.at.pos`);
  return num(pos[0], `items.${item}.at.pos[0] at t=${String(frame['t'])}`);
}

/** A document channel's evaluated value in one frame. */
export function channelOf(frame: JsonObject, channel: string): JsonObject {
  const channels = obj(frame['channels'], `frame ${String(frame['t'])}: channels`);
  return obj(channels[channel], `frame ${String(frame['t'])}: channels.${channel}`);
}

/** `deep-motion eval` over `times`; returns the frames, one per time, each checked to carry its time. */
export function evalFrames(doc: JsonObject, times: number[]): JsonObject[] {
  const out = accepted(MOTION_BIN, 'eval', { doc, times });
  const frames = arr(out['frames'], 'eval: frames').map((f, i) => obj(f, `eval: frames[${i}]`));
  expect(frames.length, 'eval: one frame per time').toBe(times.length);
  frames.forEach((f, i) => expect(f['t'], `eval: frames[${i}].t`).toBe(times[i]));
  return frames;
}

/**
 * Compares an armed run with an every-vsync run of `deep-motion run`, vsync by vsync: the presented
 * frame's evaluated data must be the same item by item. Returns null when they agree, or a message that
 * names the first vsync where they don't and every item that differs there.
 */
export function compareRuns(armed: JsonValue[], every: JsonValue[]): string | null {
  if (armed.length !== every.length) return `the runs have ${armed.length} and ${every.length} vsyncs`;
  for (let k = 0; k < armed.length; k++) {
    const a = armed[k]; const e = every[k];
    if (!isObject(a) || !isObject(e)) return `vsync ${k} is not an object`;
    if (a['t'] !== e['t']) return `vsync ${k} is at ${String(a['t'])} in the armed run and ${String(e['t'])} in the every-vsync run`;
    const ai = isObject(a['items']) ? a['items'] : {};
    const ei = isObject(e['items']) ? e['items'] : {};
    const ids = [...new Set([...Object.keys(ai), ...Object.keys(ei)])].sort();
    const differ = ids.filter((id) => canonical(ai[id]) !== canonical(ei[id]));
    if (differ.length > 0) {
      const t = num(a['t'], `vsync ${k}: t`);
      const detail = differ.map((id) => `item ${id}: armed shows ${canonical(ai[id])}, every-vsync evaluated ${canonical(ei[id])}`).join('; ');
      return `at vsync ${k} (t = ${t} flicks, ${(t / FLICKS_PER_SECOND).toFixed(4)} s) the presented data differs: ${detail}`;
    }
  }
  return null;
}
