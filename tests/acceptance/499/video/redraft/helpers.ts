// Test-side tools for the blind redraft of #499 AC3's push clause (REDRAFT.md): `deep-show run` (#393's scenarios, with
// #387's `eval` pixels, #493's shots and #498's `media_import`), built once per file; the recording made by ffmpeg at
// test time; the canonical snapshots read back from the evidence store; and the pixel finders. Nothing here stands in
// for the canvas: every position a test compares is read from a picture the binary drew.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/499/video/redraft is five levels down). */
export const REPO = join(HERE, '..', '..', '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const SHOW = 'deep-show';
/** Every `it` passes this timeout: a first build of `deep-show` can take many minutes. */
export const TIMEOUT = 1_800_000;
/** The criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC3 = 'AC3 #499.65f30d78';

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
/** One frame at the document's 60 fps, in flicks. */
export const F60 = FLICKS / 60;
export const fl = (s: number): number => Math.round(s * FLICKS);

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A check that must fail on a planted twin: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted twin passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The build, once per file; a test that uses a build that failed fails with cargo's error.

export function useShow(): () => string {
  let dir = ''; let error = ''; let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-499-show-'));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const run = spawnSync('cargo', ['build', '--locked', '--bin', SHOW], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo build --locked --bin ${SHOW} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Download/.test(l)).join('\n')}`;
    else { bin = join(dir, SHOW); copyFileSync(join(TARGET, 'debug', process.platform === 'win32' ? `${SHOW}.exe` : SHOW), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => { expect(error, `the binary builds: cargo build --locked --bin ${SHOW}`).toBe(''); return bin; };
}

/** A fresh temporary folder per test (the fixture and the evidence store), deleted after it. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-499-push-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// The recording, made by ffmpeg (fixtures only; it never stands in for the decode worker)

function findFfmpeg(): string | null {
  const named = process.env['DEEP_FFMPEG'];
  const candidates = [named, ...(process.env['PATH'] ?? '').split(':').map((d) => join(d, 'ffmpeg')), '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}
function ffmpeg(args: string[]): Buffer {
  const bin = findFfmpeg();
  if (!bin) expect.fail('BLOCKED: the recording is made by ffmpeg with libx264; none was found on PATH, in /opt/homebrew/bin or /usr/local/bin, or at DEEP_FFMPEG. Unblock: brew install ffmpeg');
  return execFileSync(bin, ['-hide_banner', '-v', 'error', '-nostdin', ...args], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The recording's size in source px, its rate and length, its ground and the recorded click's mark (REDRAFT.md). */
export const REC = { w: 640, h: 360, fps: 30, seconds: 2, ground: 0x20, mark: 0xc0, click: { x: 400, y: 208, size: 16 } } as const;

/** A 30 fps H.264 screen recording, 640 × 360 and 2 s: a dark neutral screen with the recorded click's mark, a light
 * neutral 16 × 16 px square at source px [400, 416) × [208, 224), in every frame. The mark lies on whole 16-px blocks
 * and both colors are neutral, so 4:2:0 chroma and the encoder's blocks can't move its centre. Returns the file. */
export function recording(dir: string): string {
  const path = join(dir, 'recording.mp4');
  const hex = (v: number): string => v.toString(16).padStart(2, '0').repeat(3);
  const c = REC.click;
  ffmpeg(['-y', '-f', 'lavfi', '-i', `color=c=0x${hex(REC.ground)}:s=${REC.w}x${REC.h}:r=${REC.fps}:d=${REC.seconds},drawbox=x=${c.x}:y=${c.y}:w=${c.size}:h=${c.size}:color=0x${hex(REC.mark)}:t=fill`,
    '-an', '-c:v', 'libx264', '-qp', '10', '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p', path]);
  // The fixture came out so: the mark is light and neutral on the dark neutral screen in its first and last frames.
  for (const at of ['0', String(REC.seconds - 1 / REC.fps)]) {
    const rgb = ffmpeg(['-ss', at, '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const px = (x: number, y: number): number[] => [0, 1, 2].map((k) => rgb[(y * REC.w + x) * 3 + k]!);
    const mark = px(c.x + c.size / 2, c.y + c.size / 2); const screen = px(100, 100);
    expect(Math.max(...mark) - Math.min(...mark) <= 4 && Math.max(...screen) - Math.min(...screen) <= 4, `the fixture's colors are neutral at ${at} s: mark ${mark}, screen ${screen}`).toBe(true);
    expect(mark[1]! - screen[1]!, `the fixture's mark stands out from its screen at ${at} s: mark ${mark}, screen ${screen}`).toBeGreaterThan(100);
  }
  return path;
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (REDRAFT.md: The surface)

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const stored = (evidence: string, sha: string): string => join(evidence, sha.slice(0, 2), sha.slice(2));
/** Puts bytes into the scenario's evidence store at their SHA-256, as the hub keeps assets (#1162's way). */
export function putStore(evidence: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(stored(evidence, sha), bytes);
  return sha;
}

/** The document the hub has minted. */
export const DOC_ID = '01JB499V000000000000000001';
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
/** A scenario: the evidence store, your shell's process tree, one 1920 × 1080 panel, the document, the calls. */
export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return { evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1920, 1080] } }, docs: { [DOC_ID]: { panel: 'main' } }, calls };
}
/** `deep show` of a whole document from your shell. The hub stamps the writer layer, so the payload carries no
 * `layers` and no item `layer` (Writer layer: "never in a payload"). */
export function present(document: JsonObject): JsonObject {
  return { call: 'deep show', peer: YOU_PEER, doc: DOC_ID, document, include: ['issues'] };
}
export const mediaImport = (path: string): JsonObject => ({ call: 'media_import', path });
export const evalPixels = (t: number): JsonObject => ({ call: 'eval', doc: DOC_ID, t, pixels: true });

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(run.error?.message ?? '', `${SHOW} run ran and finished within its timeout`).toBe('');
  expect(run.status, `${SHOW} run exits 0; stdout: ${(run.stdout ?? '').slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const first = (run.stdout ?? '').split('\n').find((l) => l !== '') ?? '';
  let out: JsonValue = null;
  try { out = JSON.parse(first) as JsonValue; } catch { /* reported below */ }
  const answer = obj(out, `${SHOW} run: the answer`);
  expect(answer['ok'], `${SHOW} run accepted the scenario: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// Pictures: the canonical snapshot an `eval` with `pixels` stores by hash

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace (#421's reader, as #493's suite uses it). */
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

/** The one snapshot of an `eval` reply, read from the evidence store by its SHA-256 and checked against it. */
export function pictureOf(evidence: string, reply: JsonObject, what: string): Image {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply)}`).toBe('evaluated');
  const list = arr(reply['snapshots'], `${what}: snapshots`);
  expect(list.length, `${what}: one snapshot`).toBe(1);
  const s = obj(list[0], `${what}: snapshots[0]`);
  const sha = str(s['sha256'], `${what}: snapshots[0].sha256`);
  const path = stored(evidence, sha);
  expect(existsSync(path), `${what}: the snapshot ${sha} is in the evidence store`).toBe(true);
  const file = readFileSync(path);
  expect(sha256(file), `${what}: the stored snapshot hashes to its name`).toBe(sha);
  const img = decodePng(file);
  expect([img.width, img.height, num(s['w'], 'w'), num(s['h'], 'h')], `${what}: the snapshot is drawn at the document's size`).toEqual([1920, 1080, 1920, 1080]);
  return img;
}

// ---------------------------------------------------------------------------------------------------
// Finding the ring and the click in a picture (REDRAFT.md: Reading the pixels)

/** A window of pixels, [x0, x1) × [y0, y1), by pixel index. */
export interface Window { x0: number; y0: number; x1: number; y1: number }
/** A weighted centroid in px, pixel (i, j) covering [i, i + 1) × [j, j + 1), so its centre is at (i + 0.5, j + 0.5);
 * `reach` is the farthest counted pixel centre from it. */
export interface Found { x: number; y: number; mass: number; reach: number }

function centroid(img: Image, win: Window, weight: (o: number) => number): Found | null {
  let m = 0; let sx = 0; let sy = 0;
  const kept: [number, number][] = [];
  for (let y = win.y0; y < win.y1; y++) for (let x = win.x0; x < win.x1; x++) {
    const w = weight((y * img.width + x) * 4);
    if (w <= 0) continue;
    m += w; sx += w * (x + 0.5); sy += w * (y + 0.5); kept.push([x + 0.5, y + 0.5]);
  }
  if (m === 0) return null;
  const cx = sx / m; const cy = sy / m;
  return { x: cx, y: cy, mass: m, reach: Math.max(...kept.map(([x, y]) => Math.hypot(x - cx, y - cy))) };
}

/** Weights under this share count as 0, so a faint fringe or noise spread over the window can't pull a centroid. */
const FLOOR = 0.1;
/** A pixel is neutral when its channels lie within this many code values. */
const NEUTRAL = 12;

export interface Reading { ring: Found | null; click: Found | null; problems: string[] }

/** The ring and the click inside `win`, which must lie wholly on the recording, never on the document's ground:
 * - the recording's screen is the window's neutral majority, and it must be dark (the ground is white and must not be
 *   in the window: at least 90% of the window's pixels are neutral within 6 code values of its median level, ≤ 80);
 * - the click is the recording's light neutral mark: a neutral pixel weighs (L − screen) ÷ (brightest − screen);
 * - the ring is the window's only colored mark: a pixel weighs its chroma (largest channel − smallest) ÷ the
 *   window's largest chroma, which the neutral recording and ground both hold at 0;
 * each centroid counts weights from `FLOOR` up, and each must be compact: no counted pixel farther than `reach` px
 * from its centroid, so nothing stray in the window is taken for either. */
export function readPicture(img: Image, win: Window, reach: { ring: number; click: number }): Reading {
  const problems: string[] = [];
  const px = img.rgba;
  const chroma = (o: number): number => Math.max(px[o]!, px[o + 1]!, px[o + 2]!) - Math.min(px[o]!, px[o + 1]!, px[o + 2]!);
  const neutral = (o: number): boolean => chroma(o) <= NEUTRAL;
  const level = (o: number): number => (px[o]! + px[o + 1]! + px[o + 2]!) / 3;
  const hist = new Array<number>(256).fill(0);
  let count = 0; let brightest = 0; let colored = 0;
  for (let y = win.y0; y < win.y1; y++) for (let x = win.x0; x < win.x1; x++) {
    const o = (y * img.width + x) * 4; count++;
    if (neutral(o)) { const l = level(o); hist[Math.round(l)]!++; brightest = Math.max(brightest, l); }
    colored = Math.max(colored, chroma(o));
  }
  let seen = 0; let screen = 0;
  while (screen < 255 && seen + hist[screen]! < count / 2) seen += hist[screen++]!;
  const near = hist.slice(Math.max(0, screen - 6), screen + 7).reduce((a, b) => a + b, 0);
  if (screen > 80 || near < 0.9 * count) problems.push(`the window isn't the recording's dark screen: its median level is ${screen}, ${(100 * near / count).toFixed(1)}% of it within 6 of that`);
  let click: Found | null = null;
  if (brightest - screen < 100) problems.push(`no light neutral mark on the recording (brightest neutral level ${brightest.toFixed(1)}, screen ${screen})`);
  else {
    click = centroid(img, win, (o) => { if (!neutral(o)) return 0; const w = Math.min(1, (level(o) - screen) / (brightest - screen)); return w >= FLOOR ? w : 0; });
    if (click && click.reach > reach.click) problems.push(`the click's mark isn't one compact mark: a counted pixel lies ${click.reach.toFixed(1)} px from its centre (at most ${reach.click})`);
  }
  let ring: Found | null = null;
  if (colored < 80) problems.push(`no colored ring over the recording (largest chroma is ${colored})`);
  else {
    ring = centroid(img, win, (o) => { const w = chroma(o) / colored; return w >= FLOOR ? w : 0; });
    if (ring && ring.reach > reach.ring) problems.push(`the ring isn't one compact mark: a counted pixel lies ${ring.reach.toFixed(1)} px from its centre (at most ${reach.ring})`);
  }
  return { ring, click, problems };
}
