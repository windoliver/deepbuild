// Test-side tools for the blind redraft of #1173's third criterion (C3-REDRAFT.md): `deep-gpu` (#377's binary) built
// once and driven by JSON lines through #378's `view3d`; the puff documents and the look they draw with; the PNG
// reader (copied from #386's helpers, since suites don't import each other); the Metal gate; and this criterion's
// measure: a puff's footprint, its falloff ring, and the 2 × 2 blocks of identical pixels inside that ring. Each
// check a wrong program must fail returns its failures as sentences naming the emitter. Nothing here draws a puff.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1173 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const BIN = 'deep-gpu';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
function obj(v: JsonValue | undefined, what: string): JsonObject { expect(isObject(v), `${what} is an object: ${shown(v)}`).toBe(true); return v as JsonObject; }
function arr(v: JsonValue | undefined, what: string): JsonValue[] { expect(Array.isArray(v), `${what} is an array: ${shown(v)}`).toBe(true); return v as JsonValue[]; }
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

// ---------------------------------------------------------------------------------------------------
// The machine: the GPU layer draws on macOS's Metal device.

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The binary, built once per file, and a fresh output folder per test.

export interface Builds { bin: () => string }
export function useBuild(): Builds {
  let dir = '';
  let error = '';
  let bin = '';
  beforeAll(() => {
    // Off macOS nothing is drawn, so nothing is built: each test is INCONCLUSIVE before it asks for the binary.
    if (process.platform !== 'darwin') return;
    dir = mkdtempSync(join(tmpdir(), 'deep-1173-c3-bins-'));
    const args = ['build', '--locked', '--bin', BIN];
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) error = `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
    else { bin = join(dir, BIN); copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', exe(BIN)), bin); }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return { bin(): string { expect(error, `the binary builds: cargo build --locked --bin ${BIN}`).toBe(''); return bin; } };
}
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1173-c3-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted puff_block_copy]`: one scenario `{out, calls}` per line in, one answer out (#377).

/** The wrong program this criterion names: a half-resolution puff shaded once per 2 × 2 px block on the even grid, that value written to all four pixels (the base's particles.wgsl). */
export type Planted = 'puff_block_copy';
export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const name = `${BIN} ${args.join(' ')}`;
  expect(r.error, `${name} ran and finished within its timeout`).toBeUndefined();
  expect(r.status, `${name} exited 0; stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['ok'], `${name} accepted the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((v, i) => obj(v, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}

/** The one frame `n` a `view3d` reply captured, its final target read back as an 8-bit RGBA PNG named by its SHA-256. */
export function finalOf(reply: JsonObject, out: string, n: number, what: string): Image {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} answered unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => obj(v, `${what}: frames[${i}]`));
  const f = frames.find((x) => x['frame'] === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.map((x) => shown(x['frame'])).join(', ')})`).toBeDefined();
  const hash = f!['final'];
  expect(hash, `${what}: frame ${n}'s final target is named by a SHA-256`).toMatch(/^[0-9a-f]{64}$/);
  const file = readFileSync(join(out, `${String(hash)}.png`));
  expect(sha256(file), `${what}: the final PNG hashes to its name`).toBe(hash);
  const png = decodePng(file);
  expect(png.channels, `${what}: the final target is an RGBA PNG`).toBe(4);
  return png;
}

// ---------------------------------------------------------------------------------------------------
// PNG (copied from #386's helpers).

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array; channels: number }
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
  return { width, height, rgba, channels };
}

// ---------------------------------------------------------------------------------------------------
// The look and the documents.

/**
 * A physical-basis `look@1`: a near-black ground, the puffs in a mid grey, tone map none at the exposure whose scale is
 * 1, the finish at identity, no deband, no bloom, no ground grid. Mid grey keeps a puff's crown well under white, so no
 * pixel clips and every step of its falloff is a different 8-bit code.
 */
export const LOOK: JsonObject = {
  id: 'puffs-1173-c3', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #1173 C3 redraft look: puffs in mid grey on a near-black ground.',
  palette: { night: '#101114', grey: '#808080', graphite: '#1b1d22' },
  roles: { ground: 'night', ink: 'graphite', smoke: 'grey', anchor: 'night' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
};

export const SIZE: [number, number] = [320, 240];
export const FPS = 60;
/** The frame measured: 1 s in, each emitter's one particle alive and still. */
export const FRAME = 60;
/** The puff's size in px (its diameter): a 24 px radius. */
export const PUFF_PX = 48;

/** The two emitters: the criterion's half-resolution puff, and a full-resolution one beside it that the planted block copy leaves alone. */
export const HALF = 'puff-half';
export const FULL = 'puff-full';
export const EMITTERS: Record<string, { x: number; resolution: 'half' | 'full' }> = {
  [HALF]: { x: -1.8, resolution: 'half' },
  [FULL]: { x: 1.8, resolution: 'full' },
};

/** One still puff: one particle from a point, at rest (ballistic, no speed, no gravity, no drag), living past the span. */
function emitter(id: string, resolution: 'half' | 'full'): JsonObject {
  return {
    id, kind: 'particles@1', name: id, order: `c-${id}`, layer: 'main',
    params: {
      count: 1, emit: { anchor: `${id}-anchor`, shape: 'point', rate: 1, span: 0.5 }, life: [10, 10],
      motion: { ballistic: { v0: [0, 0], gravity: [0, 0, 0], drag: 0 } },
      size: PUFF_PX, opacity: 1, color: [{ at: 0, role: 'smoke' }, { at: 1, role: 'smoke' }], draw: 'puff', resolution, seed: 11,
    },
    at: { pos: [EMITTERS[id]!.x, 0, 0] },
  };
}

/**
 * The scene: under an orthographic camera looking along −Z, 8 m across 320 px (40 px per m), the two emitters' anchors
 * (boxes 2 cm across, under 1 px, in the ground's role) at x = −1.8 m and +1.8 m, 144 px apart, and the emitters
 * `with` lists. Every variant holds both anchors, so a variant without an emitter differs from it only by its puff.
 */
export function puffsDoc(withEmitters: readonly string[]): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'orthographic', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 0, distance: 20 }, view_width: 8 } },
  };
  for (const [id, e] of Object.entries(EMITTERS)) {
    items[`${id}-anchor`] = { id: `${id}-anchor`, kind: 'mark.box@1', name: `${id} anchor`, order: `b-${id}`, layer: 'main', params: { size: [0.02, 0.02, 0.02], paint: { fill: { role: 'anchor' } } }, at: { pos: [e.x, 0, 0] } };
  }
  for (const id of withEmitters) items[id] = emitter(id, EMITTERS[id]!.resolution);
  const tag = withEmitters.length ? withEmitters.join('+') : 'bare';
  return {
    format: 1, id: `puffs-1173-c3-${tag}`, profile: 'scene', title: `Puffs (${tag})`, description: 'Two still puffs, one at half resolution and one at full, on a near-black ground.',
    size: SIZE, camera: 'cam', seed: 7, transport: { span: '2s' },
    requires: { modules: { scene3d: '^1', effects: '^1' } }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items,
  };
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
export const view3dCall = (doc: string): JsonObject =>
  ({ call: 'view3d', doc, look: LOOK, size: SIZE, fps: FPS, from: FRAME, frames: 1, capture: [FRAME], targets: ['final'] });

// ---------------------------------------------------------------------------------------------------
// The measure.

/** A pixel belongs to a puff's footprint when its emitter's frame differs from the bare frame by at least this in R, G or B. */
export const FOOTPRINT_CODES = 4;
/**
 * "Inside its soft edge": the puff's falloff ring, every pixel whose centre lies between INNER and OUTER of the
 * footprint's radius from the footprint's centroid. Inside INNER is the crown, where the falloff flattens to its peak and
 * a correct shading's neighbours, symmetric about the centre, may meet in one 8-bit code; outside OUTER is the rim,
 * where the tail is a few codes above the ground and the sprite ends. Between them the falloff falls by more than one
 * 8-bit code per px, so no four neighbouring pixels of a puff shaded per pixel or upsampled through a filter are equal.
 */
export const INNER = 0.25;
export const OUTER = 0.8;

export interface Footprint { cx: number; cy: number; radius: number; pixels: number }
/** The pixels where `withPuff` differs from `bare`: their centroid and the radius of a disc of their area. */
export function footprintOf(withPuff: Image, bare: Image): Footprint {
  expect([withPuff.width, withPuff.height], 'the two frames are the same size').toEqual([bare.width, bare.height]);
  let n = 0; let sx = 0; let sy = 0;
  for (let y = 0; y < bare.height; y++) {
    for (let x = 0; x < bare.width; x++) {
      const o = (y * bare.width + x) * 4;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(withPuff.rgba[o + c]! - bare.rgba[o + c]!));
      if (d >= FOOTPRINT_CODES) { n++; sx += x + 0.5; sy += y + 0.5; }
    }
  }
  return n === 0 ? { cx: NaN, cy: NaN, radius: 0, pixels: 0 } : { cx: sx / n, cy: sy / n, radius: Math.sqrt(n / Math.PI), pixels: n };
}

export interface Blocks { examined: number; identical: [number, number][] }
/**
 * Every 2 × 2 block of `image` (at every offset, not only the even grid) whose four pixel centres all lie in the
 * footprint's falloff ring, and those whose four pixels have equal R, G and B.
 */
export function blocksIn(image: Image, f: Footprint): Blocks {
  const out: Blocks = { examined: 0, identical: [] };
  const inRing = (x: number, y: number): boolean => {
    const r = Math.hypot(x + 0.5 - f.cx, y + 0.5 - f.cy);
    return r >= INNER * f.radius && r <= OUTER * f.radius;
  };
  const same = (a: number, b: number): boolean => image.rgba[a] === image.rgba[b] && image.rgba[a + 1] === image.rgba[b + 1] && image.rgba[a + 2] === image.rgba[b + 2];
  for (let y = 0; y + 1 < image.height; y++) {
    for (let x = 0; x + 1 < image.width; x++) {
      if (!(inRing(x, y) && inRing(x + 1, y) && inRing(x, y + 1) && inRing(x + 1, y + 1))) continue;
      out.examined++;
      const o = (y * image.width + x) * 4; const right = o + 4; const down = o + image.width * 4; const diag = down + 4;
      if (same(o, right) && same(o, down) && same(o, diag)) out.identical.push([x, y]);
    }
  }
  return out;
}

/** The criterion's words, as sentences naming the emitter: each emitter's puff drew, and no 2 × 2 block inside its soft edge is identical. */
export function puffProblems(frame: Image, single: Record<string, Image>, bare: Image): { problems: string[]; report: string[] } {
  const problems: string[] = []; const report: string[] = [];
  for (const id of Object.keys(EMITTERS)) {
    const f = footprintOf(single[id]!, bare);
    const want = PUFF_PX / 2;
    if (!(f.radius >= 0.5 * want && f.radius <= 1.5 * want)) {
      problems.push(`emitter ${id}: its puff covers ${f.pixels} px, a disc of radius ${f.radius.toFixed(1)} px, not within half and one and a half times its ${want} px radius, so the puff didn't draw as asked`);
      continue;
    }
    const b = blocksIn(frame, f);
    report.push(`${id}: footprint ${f.pixels} px, centre (${f.cx.toFixed(1)}, ${f.cy.toFixed(1)}), radius ${f.radius.toFixed(1)} px; ${b.examined} blocks in the falloff ring, ${b.identical.length} identical`);
    if (b.examined < 200) problems.push(`emitter ${id}: only ${b.examined} 2 × 2 blocks lie in its falloff ring, too few to judge`);
    if (b.identical.length > 0) {
      problems.push(`emitter ${id}: ${b.identical.length} of the ${b.examined} 2 × 2 blocks inside its puff's soft edge are four identical pixels, the first at (${b.identical.slice(0, 5).map(([x, y]) => `${x}, ${y}`).join('), (')})`);
    }
  }
  return { problems, report };
}
