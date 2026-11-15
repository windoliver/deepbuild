// Test-side tools for the blind redraft of #466's AC7: `deep-show run` (#393's scenarios, with #501's `export` to a
// png_seq and its receipt), built once per file; the moving-box film the tests export and the look it names; the
// exported frames (PNG files); and the reading of one row of a frame into runs of coverage. Nothing here stands in for
// the canvas: every picture comes from the binary, every expected value from the issue's text computed here.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/466-redraft-ac7 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const SHOW = 'deep-show';
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes this timeout (30 min): a first build of `deep-show` can take many minutes. */
export const TIMEOUT = 1_800_000;

/** The criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC7 = 'AC7 #466.e1124907';

// ---------------------------------------------------------------------------------------------------
// The criterion's numbers, and what they give

/** The export's frame rate, the look's quantize, the shutter and the box's speed. */
export const FPS = 24;
export const QUANTIZE_HZ = 12;
export const SHUTTER_DEG = 180;
export const SPEED = 240;
/** The film: 2 s at 24 fps, 48 frames. */
export const SPAN_S = 2;
export const FRAMES = SPAN_S * FPS;
/** The box: 12 u wide (narrower than one 1/12 s step of travel, 20 u, so two copies a step apart stand apart), 40 u
 * tall, its left edge at 40 u at 0 s, moving right at 240 u/s along y 60–100. */
export const BOX_W = 12;
export const BOX_X0 = 40;
export const BOX_Y: [number, number] = [60, 100];
/** The row the tests read: the box's middle. */
export const ROW = 80;
/** The travel over one exposure: 240 u/s × (180°/360°) × (1/24 s) = 5 u (1 u = 1 px). */
export const TRAVEL = SPEED * (SHUTTER_DEG / 360) / FPS;
/** The travel over one quantize step: 240 u/s ÷ 12 Hz = 20 u. */
export const STEP_TRAVEL = SPEED / QUANTIZE_HZ;
/** The box's left edge at the quantized time of frame k: ⌊k ÷ 2⌋ ÷ 12 s. */
export const leftAt = (k: number): number => BOX_X0 + SPEED * Math.floor((k * QUANTIZE_HZ) / FPS) / QUANTIZE_HZ;
/** The pairs judged: frames 2m and 2m + 1 for m = 1..23. Frames 0 and 1 are judged for byte identity only: their
 * exposure reaches before 0 s, where the box hasn't started moving (README: Choices). */
export const FIRST_JUDGED = 2;

// ---------------------------------------------------------------------------------------------------
// JSON and failures

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const show = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A check that must fail on a planted program: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted program passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show --no-default-features --features full`, once per file.

export function useShow(): () => string {
  let dir = ''; let bin = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-466-ac7-bin-'));
    const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) error = `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
    else { bin = join(dir, `${SHOW}-full`); copyFileSync(join(TARGET, 'debug', SHOW), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => { expect(error, `the binary builds: cargo build --locked --bin ${SHOW} --no-default-features --features full`).toBe(''); return bin; };
}

/** Fresh folders for a test (the evidence store and the export's output), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-466-ac7-')); made.push(d); return d; };
}

/** `deep-show run`: one scenario line in, one answer line out, exit 0, ok, one reply per call. */
export function run(bin: string, scenario: JsonObject, what: string): JsonObject[] {
  const calls = arr(scenario['calls'], 'the calls').length;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${what}: ${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${what}: ${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(out['ok'], `${what}: ${SHOW} run answers the scenario ok; got ${show(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The evidence store and PNG

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
function putStore(evidence: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let p = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (p < file.length) {
    const len = file.readUInt32BE(p); const type = file.toString('latin1', p + 4, p + 8); const body = file.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      line[i] = (filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) rgba[(y * width + x) * 4 + k] = line[x * channels + k]!;
      rgba[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------------------------------
// The look and the film (README: The fixture)

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Made by the acceptance tests at test time.', shareable: true, credit: 'Test fixture.' };
/** The ink and the ground, as the look's palette holds them. */
export const INK: [number, number, number] = [0x1b, 0x1d, 0x22];
export const GROUND: [number, number, number] = [0xff, 0xff, 0xff];
/** The look's quantize and motion blur, exactly as the tests write them (README: Choices). */
export const TIME: JsonObject = { quantize_hz: QUANTIZE_HZ, state: { span: '0.25s', interp: { ease: { name: 'in_out_cubic' } } } };
export const MOTION_BLUR: JsonObject = { scope: 'declared_moves', shutter_angle: SHUTTER_DEG, phase: 'centred', samples: 8, adaptive: true };

/**
 * The look: a look@1 on a drawing basis with flat roles (a white ground, a dark graphite ink, a mid-grey `muted`), its
 * time quantized at 12 Hz, motion blur on at a 180° shutter with 8 samples, and one sub-sample per frame, so the
 * frame's samples are the shutter's alone. Its bytes go into the evidence store.
 */
export function blurLook(): { id: string; sha: string; bytes: Buffer } {
  const id = 'blur-look';
  const def = {
    id, format: 1, basis: 'drawing', license: 'Apache-2.0', description: 'A flat look whose time steps at twelve a second, with motion blur on.',
    palette: {
      ground: '#ffffff', muted: '#7c7c7c', accent: '#a0a0a0', raised: '#f5f5f5',
      graphite: '#1b1d22', fog: '#e3e4e6',
      graphite_secondary: '#1b1d22d6', graphite_tertiary: '#1b1d2285', graphite_disabled: '#1b1d2233', graphite_hover: '#1b1d220f', graphite_selected: '#1b1d221a',
      orchid: '#b0207f', indigo: '#2c3e7b', cream: '#f4ecd8',
    },
    roles: {
      ground: 'ground', ink: 'graphite', muted: 'muted', accent: 'accent', raised: 'raised', divider: 'fog',
      ink_primary: 'graphite', ink_secondary: 'graphite_secondary', ink_tertiary: 'graphite_tertiary', ink_disabled: 'graphite_disabled',
      hover: 'graphite_hover', selected: 'graphite_selected', session_readout: 'orchid', session_line: 'indigo', paper: 'cream',
    },
    themes: { light: {} },
    status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
    status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
    min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    lines: { line: { kind: 'exact', width: 2 } }, fills: { fill: { kind: 'flat' } }, ground: { kind: 'flat' },
    fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
    fallback: [], time: TIME, samples: { live: 1, export: 1 }, motion_blur: MOTION_BLUR, finish: [],
  };
  const bytes = Buffer.from(`${JSON.stringify(def, null, 1)}\n`);
  return { id, sha: sha256(bytes), bytes };
}

/** The film's size: 640 × 360 u, 1 u = 1 px. */
export const SIZE: [number, number] = [640, 360];
export const BOX = 'box';
const LAYER = 'you-main';

/**
 * The film: 640 × 360 at 24 frames a second, 2 s, under the blur look. A mid-grey `muted` field over the bottom half
 * (so no frame is one flat luma, which the export refuses as film.blank), ordered first, and the box, 12 × 40 u in the
 * ink role on the white ground of the top half, its x keyed linearly from 40 u at 0 s to 520 u at 2 s: 240 u/s, a
 * declared move.
 */
export function blurFilm(doc: string, look: { id: string; sha: string }): JsonObject {
  const items: JsonObject[] = [
    { id: 'field', kind: 'rect@1', name: 'Field', order: 'a0001', layer: LAYER, params: { box: [0, 180, 640, 180], paint: { fill: { role: 'muted' } } } },
    { id: BOX, kind: 'rect@1', name: 'Box', order: 'a0002', layer: LAYER, params: { box: [0, BOX_Y[0], BOX_W, BOX_Y[1] - BOX_Y[0]], paint: { fill: { role: 'ink' } } }, at: { pos: [BOX_X0, 0, 0] } },
  ];
  return {
    format: 1, id: doc, profile: 'film', title: 'A box in motion', description: 'A box crossing the frame under a look that steps time and blurs motion.',
    size: SIZE, safe: 24, transport: { frame_rate: `${FPS}/1`, span: `${SPAN_S}s` },
    look: { asset: `${look.id}@1`, theme: 'light' }, assets: { [look.id]: { sha256: look.sha, license: LICENSE } },
    layers: { [LAYER]: { writer: 'you:you', title: 'You', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    channels: {
      slide: {
        target: `items/${BOX}/at/pos/0`, type: 'f32',
        keys: { k00: { t: '0s', value: BOX_X0, interp: 'linear' }, k01: { t: `${SPAN_S}s`, value: BOX_X0 + SPEED * SPAN_S, interp: 'linear' } },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The scenario and the export

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB466E', 1);
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];

/**
 * The scenario: the film's panel, `deep show` of the film from your shell (the payload with no `layers` and no item
 * `layer`; the hub stamps them), then a png_seq export of the whole film at 24 fps into `out`; a planted program by
 * the scenario's `planted`.
 */
export function exportScenario(evidence: string, out: string, planted?: string): JsonObject {
  const look = blurLook();
  putStore(evidence, look.bytes);
  const payload = blurFilm(DOC, look);
  delete payload['layers'];
  for (const item of Object.values(payload['items'] as JsonObject)) if (isObject(item)) delete item['layer'];
  return {
    evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } },
    ...(planted ? { planted } : {}),
    calls: [
      { call: 'deep show', peer: { pid: 3002, start: 3_000 }, doc: DOC, document: payload, include: ['issues'] },
      { call: 'export', doc: DOC, out, frame_rate: [FPS, 1], video: { codec: 'png_seq' } },
    ],
  };
}

/** What an export gives the judge: its receipt's frame rate and frame hashes, and its frames decoded in name order. */
export interface Exported { frameRate: JsonValue; hashes: string[]; frames: Image[] }
export function exported(reply: JsonObject, out: string, what: string): Exported {
  expect(reply['outcome'], `${what} is exported: ${show(reply, 3000)}`).toBe('exported');
  const receipt = obj(reply['receipt'], `${what}: receipt`);
  const hashes = arr(receipt['frame_hashes'], `${what}: receipt.frame_hashes`).map((h, i) => { expect(typeof h, `${what}: frame_hashes[${i}]`).toBe('string'); return h as string; });
  expect(existsSync(out), `${what}: the export wrote ${out}`).toBe(true);
  const names = readdirSync(out).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  return { frameRate: receipt['frame_rate'] ?? null, hashes, frames: names.map((f) => decodePng(readFileSync(join(out, f)))) };
}

// ---------------------------------------------------------------------------------------------------
// Reading a frame's row: coverage in linear light, and its runs

const linear = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (rgb: readonly number[]): number => 0.2126 * linear(rgb[0]!) + 0.7152 * linear(rgb[1]!) + 0.0722 * linear(rgb[2]!);
const L_GROUND = lum(GROUND); const L_INK = lum(INK);
/** A run of pixels on the row that differ from the ground: [first, last] x, its peak coverage, its full pixels
 * (coverage ≥ 0.97), its partial pixels left and right of the first and last full one, and its coverage-weighted centre. */
export interface Run { first: number; last: number; peak: number; full: number; left: number; right: number; centre: number }
/** The ink's coverage of each pixel on row `y`, in linear light: 0 on the ground, 1 at the ink. */
export function coverage(img: Image, y: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < img.width; x++) {
    const o = (y * img.width + x) * 4;
    const px = [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!];
    out.push(px[0] === GROUND[0] && px[1] === GROUND[1] && px[2] === GROUND[2] ? 0 : Math.max(0, (L_GROUND - lum(px)) / (L_GROUND - L_INK)));
  }
  return out;
}
export function runsOf(img: Image, y: number): Run[] {
  const c = coverage(img, y);
  const runs: Run[] = [];
  for (let x = 0; x < c.length;) {
    if (c[x] === 0) { x++; continue; }
    const first = x;
    while (x < c.length && c[x] !== 0) x++;
    const last = x - 1;
    const span = c.slice(first, last + 1);
    const fulls = span.map((v, i) => (v >= 0.97 ? i : -1)).filter((i) => i >= 0);
    const weight = span.reduce((a, b) => a + b, 0);
    runs.push({
      first, last, peak: Math.max(...span), full: fulls.length,
      left: fulls.length ? fulls[0]! : span.length, right: fulls.length ? span.length - 1 - fulls[fulls.length - 1]! : span.length,
      centre: span.reduce((a, v, i) => a + v * (first + i + 0.5), 0) / weight,
    });
  }
  return runs;
}
const runText = (r: Run): string => `[${r.first}, ${r.last}] peak ${r.peak.toFixed(2)}, ${r.full} full px, ${r.left} + ${r.right} partial px, centre ${r.centre.toFixed(2)}`;

/**
 * One blur on frame k's row: exactly one run; its length the box's width plus the exposure's travel (17 ± 2 px); a
 * plateau of full ink (the width less the travel, 7 ± 2 px) between at least 3 partial pixels on each side; centred
 * within 1 px on the box's centre at the frame's quantized time. Each failure names `frame k:`.
 */
export function blurFailures(img: Image, k: number): string[] {
  const runs = runsOf(img, ROW);
  if (runs.length !== 1) return [`frame ${k}: the box's row shows ${runs.length} copies, not one blur: ${runs.map(runText).join('; ')}`];
  const r = runs[0]!;
  const failures: string[] = [];
  const length = r.last - r.first + 1;
  if (Math.abs(length - (BOX_W + TRAVEL)) > 2) failures.push(`frame ${k}: the blur is ${length} px long, not ${BOX_W} + ${TRAVEL} ± 2: ${runText(r)}`);
  if (Math.abs(r.full - (BOX_W - TRAVEL)) > 2) failures.push(`frame ${k}: the blur holds ${r.full} px of full ink, not ${BOX_W} − ${TRAVEL} ± 2: ${runText(r)}`);
  if (r.left < 3 || r.right < 3) failures.push(`frame ${k}: the box's edges aren't blurred (${r.left} and ${r.right} partial px, each needs 3): ${runText(r)}`);
  const centre = leftAt(k) + BOX_W / 2;
  if (Math.abs(r.centre - centre) > 1) failures.push(`frame ${k}: the blur is centred at ${r.centre.toFixed(2)}, not on the box at its quantized time, ${centre}`);
  return failures;
}

/**
 * The judge, the same for the clean export and the planted one: 48 frames at 24 fps; frames 2m and 2m + 1 byte-identical
 * (one receipt hash and the same decoded pixels) for every m; and one blur on each frame from frame 2 on. Each failure
 * names the frame.
 */
export function exportFailures(e: Exported): string[] {
  const failures: string[] = [];
  if (JSON.stringify(e.frameRate) !== JSON.stringify([FPS, 1])) failures.push(`the export's receipt says frame_rate ${show(e.frameRate)}, not [${FPS}, 1]`);
  if (e.hashes.length !== FRAMES || e.frames.length !== FRAMES) return [...failures, `the export holds ${e.hashes.length} frame hashes and ${e.frames.length} PNG frames, not ${FRAMES}`];
  for (let k = 0; k + 1 < FRAMES; k += 2) {
    const a = e.frames[k]!; const b = e.frames[k + 1]!;
    const same = e.hashes[k] === e.hashes[k + 1] && a.width === b.width && a.height === b.height && Buffer.from(a.rgba).equals(Buffer.from(b.rgba));
    if (!same) failures.push(`frame ${k}: frames ${k} and ${k + 1} aren't byte-identical`);
  }
  for (let k = FIRST_JUDGED; k < FRAMES; k++) failures.push(...blurFailures(e.frames[k]!, k));
  return failures;
}

/**
 * Two half-opacity copies on even frame k: two runs on the row, each peaking at half coverage (0.5 ± 0.1) with no full
 * ink, their centres a quantize step's travel apart (20 ± 1.5 px). The planted blur's observation (README: Planted).
 */
export function twoCopiesFailures(img: Image, k: number): string[] {
  const runs = runsOf(img, ROW);
  if (runs.length !== 2) return [`frame ${k}: the box's row shows ${runs.length} runs, not two copies: ${runs.map(runText).join('; ')}`];
  const failures: string[] = [];
  for (const r of runs) if (Math.abs(r.peak - 0.5) > 0.1 || r.full > 0) failures.push(`frame ${k}: a copy isn't at half opacity: ${runText(r)}`);
  const apart = runs[1]!.centre - runs[0]!.centre;
  if (Math.abs(apart - STEP_TRAVEL) > 1.5) failures.push(`frame ${k}: the copies stand ${apart.toFixed(2)} px apart, not ${STEP_TRAVEL}`);
  return failures;
}
