// Test-side tools for the #140 acceptance tests, view group (criteria 2, 3, 4, 6, 7, 8, 10 and 15): the
// binaries built once per Cargo feature set and copied out under their own names (#377's pattern), driven by
// JSON lines; the fixtures; PNG reading; the evidence store's layout; the perceptual oracle the design says is
// reviewed test code (interior pixels, coverage and centroids, computed here from the files the binaries
// write); and #377's reference-Mac gate with a load reading. Nothing here stands in for a seam, a backend or a
// renderer under test.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/140/view is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const SCENE = join(FIXTURES, 'parity', 'gpu', 'live-headless.scene');
export const CLI = join(REPO, 'packages', 'cli', 'dist', 'main.js');

/** One second in flicks (the time grammar's unit; Frame clock). */
export const FLICKS = 705_600_000;
/** The seams the issue lists (Fields: Seam and backend). */
export const SEAMS = ['gpu', 'surface', 'display', 'fonts', 'accessibility', 'input', 'color', 'codecs', 'audio', 'capture', 'cpu', 'headless', 'network'] as const;

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
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------------------------------
// Fixtures

export const fixture = (rel: string): JsonObject => JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8')) as JsonObject;
export const LIVE_HEADLESS = 'parity/gpu/live-headless';
export const FIGURE = (): JsonObject => fixture(`${LIVE_HEADLESS}/figure.json`);
export const FILM = (): JsonObject => fixture(`${LIVE_HEADLESS}/film.json`);
export const LOOK_2D = (): JsonObject => fixture(`${LIVE_HEADLESS}/look-2d.json`);
export const LOCALE_DOC = (): JsonObject => fixture('locale.json');

/** A document as an agent sends it to deep_show: no `id`, no `layers`, no item `layer` (#393: the hub stamps them). */
export function asAgent(doc: JsonObject): JsonObject {
  const d = clone(doc);
  delete d['id'];
  delete d['layers'];
  for (const v of Object.values(obj(d['items'], 'the document\'s items'))) if (isObject(v)) delete v['layer'];
  return d;
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file per feature set, copied out of target/debug under its own name.

export interface Build { bin: string; features?: string[] }
const key = (b: Build): string => `${b.bin}${b.features?.length ? `+${b.features.join(',')}` : ''}`;
const cargoArgs = (b: Build): string[] => ['build', '--locked', '--bin', b.bin, ...(b.features?.length ? ['--features', b.features.join(',')] : [])];

function cargoBuild(b: Build): string {
  const args = cargoArgs(b);
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export interface Builds { bin: (b: Build) => string }

/** Builds every listed binary once before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-140-view-bins-'));
    for (const b of builds) {
      if (made.has(key(b))) continue;
      const error = cargoBuild(b);
      const bin = join(dir, key(b).replace(/[^A-Za-z0-9_-]/g, '_'));
      if (error === '') copyFileSync(join(REPO, 'target', 'debug', b.bin), bin);
      made.set(key(b), { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(b: Build): string {
      const entry = made.get(key(b));
      if (!entry) throw Error(`the file didn't list the build ${key(b)} in useBuilds`);
      expect(entry.error, `the binary builds: cargo ${cargoArgs(b).join(' ')}`).toBe('');
      return entry.bin;
    },
  };
}

export const DEEP_SHOW: Build = { bin: 'deep-show' };
export const DEEP_GPU: Build = { bin: 'deep-gpu' };
export const RENDER: Build = { bin: 'deep-canvas-render' };
/** README: the fonts backend at its next version, nothing else changed. */
export const RENDER_FONTS_NEXT: Build = { bin: 'deep-canvas-render', features: ['test-fonts-next'] };

// ---------------------------------------------------------------------------------------------------
// Running a binary: JSON lines in, one JSON line out per line in.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }

export function start(bin: string, args: string[], inputs: JsonValue[], opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, {
    cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 900_000, killSignal: 'SIGKILL', env: opts.env ?? process.env,
  });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

/** Every input line answered, in order, exit 0: the answers. */
export function answers(bin: string, args: string[], inputs: JsonValue[], opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): JsonObject[] {
  const s = start(bin, args, inputs, opts);
  const shown = `${bin.split('/').pop()} ${args.join(' ')}`;
  expect(s.timedOut, `${shown} finished within its timeout`).toBe(false);
  expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-2000)}`).toBe(0);
  expect(s.lines.length, `${shown}: one output line per input line; stdout: ${s.stdout.slice(0, 1500)}`).toBe(inputs.length);
  return s.lines.map((l, i) => obj(l, `${shown}: answer ${i}`));
}

/** One answer that must be `ok: true`. */
export function ok(answer: JsonObject, what: string): JsonObject {
  expect(answer['ok'], `${what} answered ok: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  return answer;
}

/** A fresh temporary folder per test, deleted after it. */
export function useDir(prefix = 'deep-140-view-'): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), prefix)); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// deep-show (#393's scenario, #376's `see`, this suite's `live` and `render_back`: README)

export const PANEL = 'main';
export const SESSION = 's1';
/** One frame of #96's virtual display clock at 60 Hz, in flicks. */
export const FRAME = FLICKS / 60;
/** #96's virtual display clock, as #376's scenarios carry it: 60 Hz, latched at the vsync, a check taking no clock time. */
export const CLOCK: JsonObject = { refresh_hz: 60, lead: 0, check: 0 };
/**
 * A deep-show scenario that presents one agent document in the main panel at t = 0 on the virtual clock (#393's
 * and #376's fields), then plays `calls`, each 10 frames after the one before unless it carries its own `at`.
 */
export function showScenario(evidence: string, doc: JsonObject, docId: string, extra: JsonObject = {}, calls: JsonObject[] = []): JsonObject {
  const size = arr(doc['size'], 'the document\'s size').map((v) => num(v, 'size'));
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-a', name: 'agent-a', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }],
    panels: { [PANEL]: { rect: [0, 0, size[0]!, size[1]!] } },
    docs: { [docId]: { panel: PANEL } },
    window: [size[0]!, size[1]! + 40],
    clock: CLOCK,
    ...extra,
    calls: [
      { call: 'deep_show', session: SESSION, doc: docId, document: asAgent(doc), at: 0 },
      ...calls.map((c, i) => ({ at: (i + 1) * 10 * FRAME, ...c })),
      // The panel's frames so far (#383), last: the clock runs to here, so the revision has been presented.
      { call: 'presented', panel: PANEL, at: (calls.length + 1) * 10 * FRAME },
    ],
  };
}
export const replies = (answer: JsonObject, what: string): JsonObject[] =>
  arr(ok(answer, what)['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));

/**
 * `deep-show live` with the scenario's `live` options (README): the app's real, shown window, then one answer
 * line and exit. A machine with no display to show it on answers `no_display`, which is INCONCLUSIVE here.
 */
export function liveRun(bin: string, scenario: JsonObject, timeoutMs = 120_000): { live: JsonObject; replies: JsonObject[] } {
  const s = start(bin, ['live'], [scenario], { timeoutMs });
  expect(s.timedOut, `deep-show live finished within ${timeoutMs} ms (it must not hold its window once \`live\` is done)`).toBe(false);
  expect(s.status, `deep-show live exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-2000)}`).toBe(0);
  expect(s.lines.length, `deep-show live answers its one line; stdout: ${s.stdout.slice(0, 1500)}`).toBe(1);
  const answer = obj(s.lines[0], 'deep-show live: the answer');
  if (answer['ok'] === false && (answer['code'] === 'no_display' || answer['code'] === 'unsupported_platform')) {
    inconclusive(`deep-show live could not show a window here (${String(answer['code'])}); the app's side needs a Mac with a display`);
  }
  return { live: obj(ok(answer, 'deep-show live')['live'], 'deep-show live: live'), replies: replies(answer, 'deep-show live') };
}

/** The evidence store's file for a hash (#393: `<first 2 hex>/<other 62 hex>`), checked against its name. */
export function evidenceFile(root: string, hash: string, what: string): Buffer {
  expect(hash, `${what} is a SHA-256`).toMatch(SHA);
  const path = join(root, hash.slice(0, 2), hash.slice(2));
  expect(existsSync(path), `${what} ${hash} is in the evidence store`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}'s file hashes to its name`).toBe(hash);
  return bytes;
}

// ---------------------------------------------------------------------------------------------------
// Backends (criterion 7)

export interface Backend { name: string; version: string }
/** A result's `backends`: every seam named is one of the issue's, each with a non-empty name and version. */
export function backendsOf(result: JsonObject, what: string): Map<string, Backend> {
  const b = obj(result['backends'], `${what}: backends (Seam and backend: "its name and version enter every … result it feeds")`);
  const out = new Map<string, Backend>();
  for (const [seam, v] of Object.entries(b)) {
    expect(SEAMS as readonly string[], `${what}: backends names the seam ${seam}, one of the issue's`).toContain(seam);
    const e = obj(v, `${what}: backends.${seam}`);
    const name = str(e['name'], `${what}: backends.${seam}.name`);
    const version = str(e['version'], `${what}: backends.${seam}.version`);
    expect(name.length > 0 && version.length > 0, `${what}: backends.${seam} has a name and a version`).toBe(true);
    out.set(seam, { name, version });
  }
  return out;
}
/** This machine's CPU architecture as the cpu seam names it. */
export const CPU_ARCH = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch;

// ---------------------------------------------------------------------------------------------------
// PNG (8-bit RGB or RGBA, no interlace), as #377's helpers read it

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
/** The pixel hash: SHA-256 of the pixels as 8-bit RGBA, rows top-down, no padding. */
export const pixelHash = (image: Image): string => sha256(image.rgba);

/** The blank guard's measure (design: luma at most 0.06 over at least 98% of the pixels, Rec. 709 weights). */
export function isBlank(image: Image): boolean {
  let dark = 0;
  const n = image.width * image.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const luma = (0.2126 * image.rgba[o]! + 0.7152 * image.rgba[o + 1]! + 0.0722 * image.rgba[o + 2]!) / 255;
    if (luma <= 0.06) dark++;
  }
  return dark >= 0.98 * n;
}
/** How many distinct RGBA values an image holds (a picture of the document holds several). */
export function colors(image: Image): number {
  const seen = new Set<number>();
  const v = new DataView(image.rgba.buffer, image.rgba.byteOffset, image.rgba.byteLength);
  for (let i = 0; i < image.rgba.length; i += 4) { seen.add(v.getUint32(i)); if (seen.size > 64) break; }
  return seen.size;
}

// ---------------------------------------------------------------------------------------------------
// The perceptual oracle (criterion 6; design: "Images from two renderers compare through one perceptual
// oracle, written as reviewed test code"). Edges are line segments [x0, y0, x1, y1] in device px.

export type Segment = [number, number, number, number];

/** Pixels whose centre lies farther than `d` device px from every segment: the interior. */
export function interiorMask(width: number, height: number, edges: Segment[], d = 1.5): Uint8Array {
  const near = new Uint8Array(width * height);
  for (const [x0, y0, x1, y1] of edges) {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - d - 1)); const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + d + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - d - 1)); const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + d + 1));
    const dx = x1 - x0; const dy = y1 - y0; const len2 = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5; const py = y + 0.5;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
        const ex = x0 + t * dx - px; const ey = y0 + t * dy - py;
        if (ex * ex + ey * ey <= d * d) near[y * width + x] = 1;
      }
    }
  }
  const interior = new Uint8Array(width * height);
  for (let i = 0; i < interior.length; i++) interior[i] = near[i] ? 0 : 1;
  return interior;
}

export interface InteriorReading { interior: number; within: number; share: number; worst: { x: number; y: number; diff: number } | null }
/** On the interior pixels, how many have every channel within `codes` code values of the other image. */
export function interiorWithin(a: Image, b: Image, interior: Uint8Array, codes = 1): InteriorReading {
  let n = 0; let within = 0; let worst: InteriorReading['worst'] = null;
  for (let i = 0; i < interior.length; i++) {
    if (!interior[i]) continue;
    n++;
    let diff = 0;
    for (let c = 0; c < 4; c++) diff = Math.max(diff, Math.abs(a.rgba[i * 4 + c]! - b.rgba[i * 4 + c]!));
    if (diff <= codes) within++;
    else if (!worst || diff > worst.diff) worst = { x: i % a.width, y: Math.floor(i / a.width), diff };
  }
  return { interior: n, within, share: n === 0 ? 0 : within / n, worst };
}

/** A coverage mask's summed coverage (alpha ÷ 255) and its coverage centroid in device px (pixel centres). */
export function coverage(mask: Image): { sum: number; cx: number; cy: number } {
  let sum = 0; let sx = 0; let sy = 0;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const a = mask.rgba[(y * mask.width + x) * 4 + 3]! / 255;
    sum += a; sx += a * (x + 0.5); sy += a * (y + 0.5);
  }
  return { sum, cx: sum ? sx / sum : NaN, cy: sum ? sy / sum : NaN };
}

/** The first pixel where two images differ in any channel, or null when they are bit-identical. */
export function firstDifference(a: Image, b: Image): { x: number; y: number; a: number[]; b: number[] } | null {
  if (a.width !== b.width || a.height !== b.height) return { x: -1, y: -1, a: [a.width, a.height], b: [b.width, b.height] };
  for (let i = 0; i < a.rgba.length; i++) {
    if (a.rgba[i] !== b.rgba[i]) {
      const p = Math.floor(i / 4);
      return { x: p % a.width, y: Math.floor(p / a.width), a: [...a.rgba.subarray(p * 4, p * 4 + 4)], b: [...b.rgba.subarray(p * 4, p * 4 + 4)] };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// The reference Mac (#377's gate) and the machine's load

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export const chipName = (): string => { try { return sh('sysctl', '-n', 'machdep.cpu.brand_string'); } catch { return ''; } };

/** Null on a fit reference Mac (Low Power Mode off, thermal state nominal); else why not. */
export function referenceMacProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
/** Null when the machine is quiet enough for a timing reading; else the load (1-minute average above half the cores). */
export function loadProblem(): string | null {
  const [one] = loadavg();
  const cores = availableParallelism();
  return one! > cores / 2 ? `the machine is loaded: 1-minute load average ${one!.toFixed(1)} on ${cores} cores` : null;
}
/** Fails the test as INCONCLUSIVE (never a pass, never a skip), with the reason and any readings. */
export function inconclusive(reason: string, readings: string[] = []): never {
  expect.fail(`INCONCLUSIVE: ${reason}${readings.length ? `\n${readings.slice(0, 40).join('\n')}` : ''}`);
}
