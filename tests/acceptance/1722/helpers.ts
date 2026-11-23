// Test-side tools for the #1722 acceptance tests: the base's `deep-show` (#393's hub, played by `deep-show run`), built
// once per file and driven by one JSON line; the fixture, a one-box 3D document with a 2D badge over its 3D frame; the
// calls that present it, change it to rev 2 and render it back; a PNG reader for the snapshots the evidence store holds; and the
// judge the first criterion names, a render-back's snapshot against the presenting reply's by pixel hash. The build,
// the scenario runner and the JSON tools are copied in part from #1401's helpers, the PNG reader from #1174's, since
// suites don't import each other. Nothing here stands in for the render-back under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1722 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed (README). */
export const AC1 = 'AC1 #1722.0e7d621b';
export const AC2 = 'AC2 #1722.3cd1b369';
export const AC3 = 'AC3 #1722.ca41cae8';

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${shown(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${shown(value)}`).toBe(true);
  return value as JsonValue[];
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1200) ?? 'undefined';

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The 3D frame draws on macOS's Metal device (#378), presented and rendered back alike. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`a 3D revision is presented and rendered back on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-show built once per file and copied out of the target folder.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-show'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-show before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let error = 'not built';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1722-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-show')), join(dir, exe('deep-show')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe('deep-show'));
  };
}
/** A fresh temporary folder per test (the evidence store), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1722-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// The scenario: the hub's canvas side as `deep-show run` plays it (#393, #96).

/** The `t` every frame here is presented and rendered back at: 0 s, as the issue's own call has it. `deep_show` takes
 * it as the time grammar's text, `render_back` in flicks (705,600,000 a second), as the hub's tool forwards it. */
export const T = { text: '0s', flicks: 0 } as const;
/** The size every frame here is presented and rendered back at, in px: the document's own size too. */
export const SIZE: [number, number] = [320, 240];

/** The test agent, writing its own layer of the document. */
export const SESSION = 'sess-alpha';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-alpha', name: 'Test agent alpha: render-back', process: { pid: 4100, start: 1_000 } } };
/** A ULID: a fixed prefix padded with zeros to 26 Crockford characters. */
export const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB1722D', 1);

/** The wrong program AC3 names (README: Planted program), reachable only through the scenario's `planted`. */
export const PLANTED = 'render_back_2d_only';

/** The scenario: the agent's session and one document on panel `main`, with no revision until the agent presents it. */
export function scenario(evidence: string, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence, sessions: SESSIONS,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC]: { panel: 'main' } },
    calls, ...(planted ? { planted } : {}),
  };
}

/** `deep-show run`: one scenario, answered ok with one reply per call. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const label = `deep-show run (${what})`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_200_000, killSignal: 'SIGKILL' });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within its timeout`);
  if (run.error) throw Error(`${label}: ${run.error.message}`);
  expect(run.status, `${label} exits 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(0, 800)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${label}: the answer`);
  expect(answer['ok'], `${label}: deep-show run answers the scenario ok${sc['planted'] ? `, with planted ${String(sc['planted'])} (README: Planted program)` : ''}; got ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${label}: replies`).map((r, i) => obj(r, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The fixture: a one-box 3D document with a 2D badge over its 3D frame (README: The fixture).

/** The camera: on the z axis, 8 m out, looking at the origin; `fov` across the wider side. */
const CAMERA = { position: [0, 0, 8], target: [0, 0, 0], fov: 40 };
/** The badge's box in the document's frame, [x, y, w, h] (u, which are px at SIZE): over the box's top-left corner. */
const BADGE: [number, number, number, number] = [40, 30, 100, 60];

/** The agent's document, whole, as it sends it: `box`, a 2 m `mark.box@1` at x = `boxX` m in its 3D writer layer, and
 * `badge`, a `rect@1` at `badge` that layer draws over the 3D frame. Rev 1 is `document()`; rev 2 is `document(1.5, …)`. */
export function document(boxX = 0, badge: [number, number, number, number] = BADGE): JsonObject {
  const item = (id: string, order: string, kind: string, params: JsonObject, extra: JsonObject = {}): JsonObject =>
    ({ id, name: id, order, kind, params, ...extra });
  return {
    format: 1, profile: 'scene', title: 'A box under a badge', description: 'A #1722 acceptance fixture: one 3D box with a 2D badge over it.',
    size: SIZE, camera: 'cam', transport: { span: '1s' },
    requires: { modules: { scene3d: '^1' } },
    items: {
      cam: item('cam', 'a0', 'camera@1', { projection: 'perspective', ...CAMERA }),
      box: item('box', 'a1', 'mark.box@1', { size: [2, 2, 2], paint: { fill: { role: 'accent' } } }, { at: { pos: [boxX, 0, 0] } }),
      badge: item('badge', 'a2', 'rect@1', { box: badge, paint: { fill: { role: 'ink' } } }),
    },
  };
}

/** Pixels the fixture checks read on the presenting snapshot (README: The fixture): where the badge covers the box,
 * where it covers only the backdrop, where the box shows alone, and where neither is. */
export const AT = {
  badgeOverBox: [130, 85] as const,
  badgeAlone: [55, 40] as const,
  boxAlone: [190, 150] as const,
  backdrop: [300, 225] as const,
};

/** The agent presents rev 1 whole, drawn at T and SIZE with its pixels. */
export const present = (): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc: DOC, document: document(), t: T.text, size: SIZE, include: ['pixels'] });

/** The agent's change on rev 1, making rev 2 (README: Readings, "a patch to rev 2"): its next whole revision through
 * `deep_show`, with the box 1.5 m to the right in 3D and the badge 120 px to the right in 2D, and no pixels asked. */
export const changeToRev2 = (): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc: DOC, document: document(1.5, [BADGE[0] + 120, BADGE[1], BADGE[2], BADGE[3]]), t: T.text });

/** A render-back of revision `rev` at T and SIZE: `deep_show` with no document and no patch, as `deep-show run` takes it. */
export const renderBack = (rev: number): JsonObject => ({ call: 'render_back', session: SESSION, doc: DOC, t: T.flicks, rev, size: SIZE });

// ---------------------------------------------------------------------------------------------------
// Snapshots: the PNG the evidence store holds under a reply's `sha256`, and its pixel hash.

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
export type Rgba = [number, number, number, number];

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
  return { width, height, rgba };
}

/** A snapshot as the judge reads it: the reply's entry, its PNG's pixels and its pixel hash. */
export interface Snap { sha256: string; image: Image; pixelHash: string }
/** The pixel hash: SHA-256 of the picture's width and height (u32, big-endian) and its RGBA bytes, so two PNGs of the
 * same pixels hash alike however they were encoded (README: Readings). */
export function pixelHash(image: Image): string {
  const head = Buffer.alloc(8); head.writeUInt32BE(image.width, 0); head.writeUInt32BE(image.height, 4);
  return createHash('sha256').update(head).update(image.rgba).digest('hex');
}
export function pixel(image: Image, [x, y]: readonly [number, number]): Rgba {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!, image.rgba[o + 3]!];
}
/** The largest per-channel difference, in 8-bit codes, between two pixels. */
export const codes = (a: Rgba, b: Rgba): number => Math.max(...a.map((v, k) => Math.abs(v - b[k]!)));

/** A reply's first snapshot, read from the evidence store, or why there is none (a refusal names its code and path). */
export function snapshotOf(evidence: string, reply: JsonObject): Snap | string {
  if (typeof reply['code'] === 'string') return `answers ${reply['code']}${typeof reply['path'] === 'string' ? ` at ${reply['path']}` : ''}, with no snapshot: ${shown(reply)}`;
  const list = reply['snapshots'];
  const first = Array.isArray(list) ? list[0] : undefined;
  if (!isObject(first) || typeof first['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(first['sha256'])) return `gives no snapshot: ${shown(reply)}`;
  const h = first['sha256'];
  const file = join(evidence, h.slice(0, 2), h.slice(2));
  if (!existsSync(file)) return `names snapshot ${h}, which the evidence store doesn't hold`;
  const bytes = readFileSync(file);
  if (sha256(bytes) !== h) return `names snapshot ${h}, whose file hashes to ${sha256(bytes)}`;
  const image = decodePng(bytes);
  if (first['w'] !== image.width || first['h'] !== image.height) return `names snapshot ${h} as ${shown(first['w'])} × ${shown(first['h'])} px, its PNG is ${image.width} × ${image.height}`;
  return { sha256: h, image, pixelHash: pixelHash(image) };
}

/** The presenting reply of rev 1, held to what the fixture needs before any render-back is judged against it. */
export function presented(evidence: string, reply: JsonObject, what: string): Snap {
  expect(reply['outcome'], `${what}: the agent's document is presented: ${shown(reply)}`).toBe('presented');
  expect(reply['rev'], `${what}: the agent's whole document is rev 1`).toBe(1);
  const snap = snapshotOf(evidence, reply);
  if (typeof snap === 'string') return expect.fail(`${what} ${snap}`);
  expect([snap.image.width, snap.image.height], `${what}: its snapshot is at the size asked`).toEqual(SIZE);
  return snap;
}

/** The fixture checks on the presenting snapshot (README: The fixture): the 3D box drawn, the 2D badge drawn over it. */
export function fixtureChecks(snap: Snap, what: string): void {
  const p = (at: readonly [number, number]): Rgba => pixel(snap.image, at);
  const [overBox, alone, box, back] = [p(AT.badgeOverBox), p(AT.badgeAlone), p(AT.boxAlone), p(AT.backdrop)];
  expect(codes(box, back), `the fixture: ${what} draws the 3D box, (${AT.boxAlone}) ${box} against the backdrop's (${AT.backdrop}) ${back}`).toBeGreaterThan(24);
  expect(codes(alone, back), `the fixture: ${what} draws the 2D badge, (${AT.badgeAlone}) ${alone} against the backdrop's ${back}`).toBeGreaterThan(24);
  expect(codes(alone, box), `the fixture: the badge's color (${alone}) is far from the box's (${box})`).toBeGreaterThan(24);
  expect(codes(overBox, alone), `the fixture: ${what} draws the badge over the box, (${AT.badgeOverBox}) ${overBox} as the badge's ${alone}`).toBeLessThanOrEqual(2);
}

/** Why a render-back's snapshot fails the first criterion, as the judge finds it: a refusal or a missing snapshot,
 * or a pixel hash unlike the presenting reply's. */
export type Failure = { kind: 'no_snapshot'; text: string } | { kind: 'pixel_hash'; text: string; back: Snap };

/** The first criterion's judge: a render-back reply against the presenting reply's snapshot by pixel hash. */
export function judge(evidence: string, back: JsonObject, against: Snap, what: string, wanted: string): Failure | null {
  const snap = snapshotOf(evidence, back);
  if (typeof snap === 'string') return { kind: 'no_snapshot', text: `${what} ${snap}` };
  if (snap.pixelHash === against.pixelHash) return null;
  const n = snap.image.width * snap.image.height;
  let off = 0;
  if (snap.image.width === against.image.width && snap.image.height === against.image.height)
    for (let i = 0; i < n; i++) if (codes(pixel(snap.image, [i % snap.image.width, Math.floor(i / snap.image.width)]), pixel(against.image, [i % snap.image.width, Math.floor(i / snap.image.width)])) > 0) off++;
  return {
    kind: 'pixel_hash', back: snap,
    text: `${what}'s snapshot has pixel hash ${snap.pixelHash} (PNG ${snap.sha256}, ${snap.image.width} × ${snap.image.height} px), not ${wanted}'s ${against.pixelHash} (PNG ${against.sha256}); ${off ? `${off} of ${n} pixels differ` : 'the sizes differ'}`,
  };
}

/** Prints what the issue's Proof line asks to see, so a passing run shows it. */
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #1722 ${label}: ${JSON.stringify(value)}`);
}
