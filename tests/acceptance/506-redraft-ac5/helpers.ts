// Test-side tools for the blind redraft of #506 criterion 5's last clause (README: The surface under test). They build
// `deep-show` (the canvas core's checks and interaction scope), drive it by one JSON scenario line, read the PNGs its
// `view` writes into the evidence store, and hold the room: a lamp, a sofa and the card anchored to the lamp. Nothing
// here stands in for an overlay, a control, the scope or the renderer. Suites don't import each other, so the PNG
// coding and the scenario's process table are copied here (from #424's and #504's helpers, and #506's first suite).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];
export type Rgb = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/506-redraft-ac5 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Criterion 5's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (scripts/proof-change.mjs). */
export const AC5 = 'AC5 #506.f7b7c9cf';
/** A cold build of deep-show takes many minutes. */
export const TIMEOUT = 3_600_000;
const MIB = 1024 * 1024;
/** Flicks a second (#449). */
export const FLICKS = 705_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and failures

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The room's pixels are drawn on macOS's Metal device: INCONCLUSIVE anywhere else. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the room's pixels are drawn on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-show built once per file and copied out of the target folder. No cargo is BLOCKED.

const BUILD = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const target = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
function cargo(args: string[]): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
    CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
    NO_COLOR: '1',
    PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}`,
  };
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') return `BLOCKED: cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN})`;
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** Builds deep-show before the file's tests; a test that uses it fails with cargo's error when the build failed. */
export function useDeepShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-506-ac5-bin-'));
    error = cargo(BUILD);
    if (error === '') copyFileSync(join(target(), 'debug', 'deep-show'), join(dir, 'deep-show'));
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    if (error.startsWith('BLOCKED:')) throw Error(error);
    expect(error, `deep-show builds: cargo ${BUILD.join(' ')}`).toBe('');
    return join(dir, 'deep-show');
  };
}
/** A fresh temporary folder per test (the scenario's evidence store), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-506-ac5-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// deep-show run: one scenario line in, one answer line out, exit 0 (#393), with the interaction scope on #383's
// virtual clock (#504's Tab stops).

export function runShow(bin: string, scenario: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  expect(timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  if (r.error) throw Error(`${what}: deep-show run: ${r.error.message}`);
  expect(r.status, `${what}: deep-show run exits 0; stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: deep-show run writes one answer line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run takes the scenario: ${show(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(scenario['calls'], 'calls').length);
  return replies;
}
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: cards', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell (pid 3002): it acts as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
/** The room's document ID, a ULID. */
export const DOC = '01JB506R000000000000000051';
/** The one panel, showing the room at its own size. */
export const PANEL = 'main';

/** A document as a writer sends it: no `layers` and no item `layer`, which the hub stamps from the connection. */
function strip(doc: JsonObject): JsonObject {
  const out = clone(doc);
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) if (isObject(item)) delete item['layer'];
  return out;
}

/** The calls of one scenario, each `at` its own time on the virtual clock: `deep show` of the room first, then the scope. */
export class Calls {
  readonly list: JsonObject[] = [];
  private t = FLICKS;
  private add(c: JsonObject, gapMs: number): number {
    this.t += Math.round((gapMs * FLICKS) / 1000);
    this.list.push({ ...c, at: this.t });
    return this.list.length - 1;
  }
  constructor(document: JsonObject) {
    this.list.push({ call: 'deep show', peer: YOU_PEER, doc: DOC, document: strip(document), include: ['issues'], at: this.t });
  }
  /** The panel's scope with no input; the index of its reply. */
  scope(): number { return this.add({ call: 'scope', panel: PANEL }, 50); }
  /** One key pressed on the panel; the index of its reply. */
  key(key: string): number { return this.add({ call: 'input', panel: PANEL, event: { type: 'key', key } }, 200); }
  /** The panel's view, drawn into the evidence store; the index of its reply. */
  view(): number { return this.add({ call: 'view', panel: PANEL }, 100); }
}
export function scenarioOf(evidence: string, calls: Calls): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: { [PANEL]: { rect: [0, 0, ...ROOM.size] } },
    docs: { [DOC]: { panel: PANEL } }, clock: { refresh_hz: 60, lead: 0, check: 0 }, calls: calls.list,
  };
}
/** The room is presented: shown, with no item skipped as a kind the build doesn't know. */
export function presented(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, what);
  const notes = [...(Array.isArray(r['notices']) ? r['notices'] : []), ...(Array.isArray(r['issues']) ? r['issues'] : [])].filter(isObject);
  expect(notes.filter((n) => n['code'] === 'unknown_kind').map((n) => show(n)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(r['outcome'], `${what} is presented: ${show(r, 3000)}`).toBe('presented');
}
/** The scope's Tab stop with focus, from a `scope` or `input` reply. */
export const focusOf = (reply: JsonObject | undefined, what: string): JsonValue => obj(obj(reply, what)['state'], `${what}: state`)['focus'] ?? null;

/** Keeps `bytes` in the evidence store at `<first 2 hex>/<other 62 hex>` (deep-show's layout); its SHA-256. */
export function putEvidence(root: string, bytes: Uint8Array): string {
  const sha = sha256(bytes);
  mkdirSync(join(root, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
/** A `view` reply's snapshot, read back from the evidence store; INCONCLUSIVE where the platform can't draw. */
export function snapshotOf(root: string, reply: JsonObject | undefined, what: string): Image {
  const r = obj(reply, what);
  if (r['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  const s = obj(r['snapshot'], `${what}: snapshot (the reply was ${show(r)})`);
  const sha = str(s['sha256'], `${what}: snapshot.sha256`);
  expect(sha, `${what}: a SHA-256`).toMatch(SHA);
  const bytes = readFileSync(join(root, sha.slice(0, 2), sha.slice(2)));
  expect(sha256(bytes), `${what}: the stored file hashes to its name`).toBe(sha);
  return decodePng(bytes);
}

// ---------------------------------------------------------------------------------------------------
// PNGs (copied from #424's helpers)

export interface Image { width: number; height: number; rgba: Uint8Array }
export const px = (im: Image, x: number, y: number): Rgb => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!]; };
export const codeOff = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
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
    const len = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
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
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
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
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
/** An 8-bit RGBA PNG of `width × height` from `rgba` (rows top-down, no filter, zlib level 9). */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  const h = Buffer.alloc(13); h.writeUInt32BE(width, 0); h.writeUInt32BE(height, 4); h[8] = 8; h[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

// ---------------------------------------------------------------------------------------------------
// The room (README: The fixture)

/**
 * The card's background color: the role `accent` of the look deep-show draws a document in when it names none, the
 * shipped clean look (crates/deep-canvas-marks/looks/clean.json: `accent` is `lagoon`, #1aa3c8, in its light theme).
 */
export const ACCENT: Rgb = [0x1a, 0xa3, 0xc8];
/** Whether a pixel reads the card's background (within 2 code values on every channel). */
export const isCard = (c: Rgb): boolean => codeOff(c, ACCENT) <= 2;
export function cardPixels(im: Image): number {
  let n = 0;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) if (isCard(px(im, x, y))) n++;
  return n;
}

/** The room's size, px; the lamp's point (world); the sofa between it and the camera; the card frame's size, px. */
export const ROOM = { size: [640, 360] as [number, number], anchor: [0, 0.7, 0] as V3, sofa: { size: [2.4, 1, 0.9] as V3, pos: [0, 0.5, 2] as V3 }, card: [160, 100] as [number, number] } as const;
/** The still camera: from (0.6, 1.4, 6) toward (0.6, 0.9, 0), 50° across the frame's width. */
export const CAM = { position: [0.6, 1.4, 6] as V3, target: [0.6, 0.9, 0] as V3, fov: 50 } as const;

/** The card's image: a 64 × 48 opaque PNG in a lamp shade's colors. */
export const cardImage = (): Buffer => encodeRgbaPng(64, 48, Uint8Array.from({ length: 64 * 48 * 4 }, (_, i) => [200, 160, 90, 255][i % 4]!));

const material = (base: Rgb): JsonObject => ({ kind: 'material@1', params: { base_color: [...base, 1], roughness: 0.7 } });
const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });

/**
 * The room as a whole scene document (#378): a floor, a lamp (its point (0, 0.7, 0) at its centre), a sofa between it
 * and the camera, a warm grey sky and a sun, all in one writer layer. The card is `overlay.frame@1` `card` holding the
 * 160 × 100 px frame `card-frame`: its background `card-bg` (role `accent`), its title `card-title` ("Reading lamp"),
 * its image `card-image` (the PNG above, by its SHA-256 in the evidence store) and its close button `card-close` (role
 * `ink`), anchored to the lamp's point at offset (0, 0). The close button is the view-class toggle `close-card`
 * (role button, label Close), bound to `items/card/visible`, default on, drawn by `card-close`: #506's first suite's
 * surface 11. No text holds a number, and every role is one the clean look holds.
 */
export function roomDoc(imageSha: string): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [...CAM.position], target: [...CAM.target], fov: CAM.fov, near: 0.05, far: 500 } },
    sky: { kind: 'sky@1', params: { top: [0.5, 0.48, 0.45, 1], low: [0.62, 0.58, 0.52, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-40, 150, 0] } },
    'floor-mat': material([0.3, 0.28, 0.26]), 'lamp-mat': material([0.15, 0.12, 0.1]), 'sofa-mat': material([0.4, 0.12, 0.08]),
    floor: box([14, 0.1, 14], [0, -0.05, 0], 'floor-mat'),
    lamp: box([0.3, 1.4, 0.3], [...ROOM.anchor], 'lamp-mat'),
    sofa: box(ROOM.sofa.size, ROOM.sofa.pos, 'sofa-mat'),
    'card-frame': { kind: 'frame@1', params: { box: [0, 0, ...ROOM.card] } },
    'card-bg': { kind: 'rect@1', parent: 'card-frame', params: { box: [0, 0, ...ROOM.card], paint: { fill: { role: 'accent' } } } },
    'card-title': { kind: 'text@1', parent: 'card-frame', params: { text: 'Reading lamp', font: 'body', size: 14, box: { w: 112, h: 20 }, paint: { fill: { role: 'ink' } } }, at: { pos: [12, 10, 0] } },
    'card-image': { kind: 'image@1', parent: 'card-frame', params: { asset: imageSha, box: [12, 36, 64, 48], fit: 'fill', alt: 'The lamp shade' } },
    'card-close': { kind: 'rect@1', parent: 'card-frame', params: { box: [136, 8, 16, 16], paint: { fill: { role: 'ink' } } } },
    card: { kind: 'overlay.frame@1', params: { frame: 'card-frame', anchor: { item: 'lamp', point: [0, 0, 0] }, offset: [0, 0] } },
  };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id: 'room-card', profile: 'scene', title: 'A card anchored to a lamp', description: 'A lamp in a room with a card over it, closed from its own button.',
    size: [...ROOM.size], camera: 'cam', seed: 506, transport: { span: '4s' },
    requires: { modules: { scene3d: '^1', marks2d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    controls: { 'close-card': { kind: 'toggle', class: 'view', label: 'Close', role: 'button', binds: ['items/card/visible'], default: true, handle: { item: 'card-close' } } },
    items: withIds,
  };
}
