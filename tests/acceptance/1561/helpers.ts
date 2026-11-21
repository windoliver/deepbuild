// Test-side tools for the #1561 acceptance tests: `deep-gpu` (its `film2d` and `live` calls) and `deep-show` (its
// `frames` call) built once per file and driven by JSON lines; the fixtures and the look with one drawn field removed;
// and the pixel hash every comparison here is made by. Nothing here stands in for a renderer: the one expected value is
// the issue's, a frame equal by pixel hash to another frame of the same run on this machine.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

// Vitest's 5 s default stays out, under any root: every test here spawns the GPU or a build.
vi.setConfig({ testTimeout: 1_800_000, hookTimeout: 3_600_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1561 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #1561.785c8c1d',
  2: 'AC2 #1561.4606f756',
  3: 'AC3 #1561.ca22b9de',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and judging

export const shown = (v: unknown): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
}
function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v)}`).toBe('string');
  return v as string;
}
const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that says `words`: what a planted program must give. */
export function failsNaming(failures: readonly string[], words: string, what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => f.includes(words)), `${what}: a failure says "${words}"; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A test whose input is missing or blank fails with this, never passes. */
export function blocked(reason: string): never {
  expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
/** `film2d` and the live window draw on macOS's Metal device; anywhere else the test is INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`film2d and the live window draw these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: each binary built once per file and copied out of the target folder.

type Build = 'deep-gpu' | 'deep-show';
/** cargo on PATH, or the pinned toolchain's when PATH has none. */
function cargoEnv(): NodeJS.ProcessEnv {
  const pinned = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
  const path = existsSync(pinned) ? `${process.env['PATH'] ?? ''}${delimiter}${pinned}` : process.env['PATH'];
  return { ...process.env, PATH: path, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
}
function cargoBuild(bin: Build): string {
  const args = ['build', '--locked', '--bin', bin];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: cargoEnv() });
  if (run.error) return `BLOCKED: cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
/** Builds each named binary once before the file's tests; a test that uses a failed build fails with cargo's error. */
export function useBins(builds: Build[]): (b: Build) => string {
  let dir = '';
  const made = new Map<Build, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1561-bin-'));
    for (const b of builds) {
      const error = cargoBuild(b);
      if (error === '') copyFileSync(join(targetDir(), 'debug', b), join(dir, b));
      made.set(b, error);
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (b: Build): string => {
    expect(made.get(b), `${b} builds: cargo build --locked --bin ${b}`).toBe('');
    return join(dir, b);
  };
}
/** A fresh temporary folder per test, deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1561-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]` and `deep-show run`: one scenario per line in, one line out.

/** The wrong programs this suite plants on `deep-gpu run`, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'live_passes_no_page' | 'reuse_drops_page';

/** One process on `inputs`, a line each: its answers, each accepted (`ok`), a line each, and its exit 0. */
function lines(bin: string, args: string[], inputs: JsonValue[]): JsonObject[] {
  const label = `${bin.split(/[\\/]/).at(-1)} ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const r = spawnSync(bin, args, { cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 900_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within its timeout`);
  if (r.error) throw Error(`${label}: ${r.error.message}`);
  const said = `stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`;
  const answers = (r.stdout ?? '').split('\n').filter((l) => l !== '').map((l, i) => {
    try { return obj(JSON.parse(l) as JsonValue, `${label}: line ${i + 1}`); } catch { return expect.fail(`${label}: line ${i + 1} is JSON; ${said}`); }
  });
  // A refusal first: a binary that doesn't know a planted name answers one line, `ok: false`, and exits non-zero.
  answers.forEach((a, i) => expect(a['ok'], `${label} accepted scenario ${i + 1}: ${shown(a)}`).toBe(true));
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); ${said}`).toBe(0);
  expect(answers.length, `${label}: one output line per input line; ${said}`).toBe(inputs.length);
  return answers;
}
const repliesOf = (answer: JsonObject, calls: JsonValue | undefined, what: string): JsonObject[] => {
  const replies = arr(answer['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(calls, 'calls').length);
  return replies;
};
/** One `deep-gpu` scenario in one process: accepted, with one reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const [answer] = lines(bin, ['run', ...(planted ? ['--planted', planted] : [])], [{ out, calls }]);
  return repliesOf(answer!, calls, 'deep-gpu run');
}
/** `deep-show run`: one scenario per line, each a fresh run of the hub; each accepted, with one reply per call. */
export function runShow(bin: string, scenarios: JsonObject[]): JsonObject[][] {
  return lines(bin, ['run'], scenarios).map((a, k) => repliesOf(a, scenarios[k]!['calls'], `deep-show run, scenario ${k + 1}`));
}
/** A reply the binary answered, not refused; INCONCLUSIVE when it says the platform can't draw it. */
function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// A frame and its pixel hash. Each path keeps a frame as a PNG; the suite decodes it and hashes its RGBA8 rows, so one
// hash compares the three paths (README: The pixel hash).

export interface Shot { hash: string; blank: boolean; png: Buffer }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** An 8-bit RGB or RGBA PNG with no interlace, as straight RGBA rows top-down. */
function decodePng(file: Buffer): { width: number; height: number; rgba: Uint8Array } {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
  let pos = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (pos < file.length) {
    const length = file.readUInt32BE(pos);
    const type = file.toString('latin1', pos + 4, pos + 8);
    const body = file.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    pos += 12 + length;
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
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      if (pred === undefined) throw Error(`PNG filter ${filter}`);
      line[i] = (line[i]! + pred) & 255;
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
/** A frame's PNG as a shot: the fixture's size, its pixel hash, and whether every pixel is one color. */
function shotOf(png: Buffer, what: string): Shot {
  const im = decodePng(png);
  expect([im.width, im.height], `${what}: the frame is ${SIZE.join(' × ')} px`).toEqual([...SIZE]);
  let blank = true;
  for (let i = 4; i < im.rgba.length && blank; i++) blank = im.rgba[i] === im.rgba[i % 4];
  return { hash: sha256(im.rgba), blank, png };
}
/** A file a `deep-gpu` call wrote under `out`, named by its SHA-256. */
function named(out: string, hash: JsonValue | undefined, what: string): Buffer {
  const name = str(hash, `${what}: its PNG's SHA-256 (final)`);
  expect(name, `${what}: final is a SHA-256`).toMatch(SHA);
  const path = join(out, `${name}.png`);
  expect(existsSync(path), `${what}: ${name}.png is under out`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}: the file is named by its SHA-256`).toBe(name);
  return bytes;
}

// ---------------------------------------------------------------------------------------------------
// Fixtures (README: The fixtures)

const fixture = (name: string): JsonObject => JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as JsonObject;
/** Every fixture is 480 × 270. */
const SIZE = [480, 270] as const;
/** The drawn look: a named wash fill, a line profile, paper with tooth and age, and a light. */
export const LOOK: JsonObject = fixture('look.json');
/** Criteria 1 and 3: a paper boat on a pond, every drawn field in use, through a 2D camera that moves. */
export const BOAT: JsonObject = fixture('paper-boat.json');
/** Criterion 2: a leaf whose position alone moves, and a buoy whose radius steps between some frames; no camera. */
export const LEAF: JsonObject = fixture('blown-leaf.json');

/** The five things criterion 1 lists, in its order. */
export const FIELDS = ['the named fill', 'the line profile', 'the paper', 'the light', 'the 2D camera'] as const;
export type Field = (typeof FIELDS)[number];
/** The look and the document with one of the five removed: what a path that dropped it would draw. */
export function without(field: Field, look: JsonObject = LOOK, doc: JsonObject = BOAT): { look: JsonObject; doc: JsonObject } {
  const l = clone(look); const d = clone(doc);
  if (field === 'the named fill') obj(l['fills'], 'fills')['pool'] = { kind: 'flat' };
  else if (field === 'the line profile') delete obj(obj(l['lines'], 'lines')['nib'], 'lines.nib')['profile'];
  else if (field === 'the paper') l['ground'] = { kind: 'flat' };
  else if (field === 'the light') delete l['light'];
  else { delete d['camera']; delete d['channels']; delete obj(d['items'], 'items')['cam']; }
  return { look: l, doc: d };
}
/** The look with every drawn field removed: its roles on a flat ground. */
export function plainLook(): JsonObject {
  let l = LOOK;
  for (const f of FIELDS.slice(0, 4)) l = without(f, l).look;
  return l;
}
/** A document as a writer sends it: no `id`, no `layers`, no item `layer`. */
function payload(doc: JsonObject): JsonObject {
  const p = clone(doc);
  delete p['id']; delete p['layers'];
  for (const item of Object.values(obj(p['items'], 'items'))) delete obj(item, 'an item')['layer'];
  return p;
}

// ---------------------------------------------------------------------------------------------------
// The three paths. `film2d` numbers frames from 0, frame n at t = n / fps; the live window from 1, frame k at
// t = (k − 1) / fps; deep-show's `frames` from 0, a step apart.

/** `film2d` (#417, #149): `frames` frames of `doc` under `look`, the listed ones captured. */
export const film2dCall = (doc: JsonObject, look: JsonObject, fps: number, frames: number, capture: number[]): JsonObject =>
  ({ call: 'film2d', doc, look, fps, frames, capture });
/** The captured frames of a `film2d` reply, by frame number. */
export function filmShots(out: string, reply: JsonObject, capture: readonly number[], what: string): Map<number, Shot> {
  answered(reply, what);
  const rows = arr(reply['frames'], `${what}: frames`).map((f) => obj(f, `${what}: frames[]`));
  return new Map(capture.map((n) => {
    const row = rows.find((r) => r['frame'] === n);
    expect(row, `${what}: frame ${n} is in the reply`).toBeDefined();
    return [n, shotOf(named(out, row!['final'], `${what}: frame ${n}`), `${what}: frame ${n}`)];
  }));
}
const SESSION = 'view';
/** `live` (#379, #397): one session on the writer's payload at `path`, every frame captured. */
export const liveCall = (path: string, look: JsonObject, fps: number, frames: number): JsonObject =>
  ({ call: 'live', look, fps, frames, capture: Array.from({ length: frames }, (_, i) => i + 1), sessions: [{ session: SESSION, writer: 'agent:a', doc: path }] });
export function writePayload(dir: string, name: string, doc: JsonObject): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(payload(doc)));
  return path;
}
/** The session's view row on each of the first `frames` frames of a `live` reply; the session's document was admitted. */
export function liveRows(reply: JsonObject, frames: number, what: string): Map<number, JsonObject> {
  answered(reply, what);
  const session = arr(reply['sessions'], `${what}: sessions`).map((s) => obj(s, `${what}: sessions[]`)).find((s) => s['session'] === SESSION);
  expect(session, `${what}: the reply lists the session`).toBeDefined();
  expect(session!['state'], `${what}: the session's document was admitted, not refused: ${shown(session!['issues'])}`).not.toBe('refused');
  const listed = arr(reply['frames'], `${what}: frames`).map((f) => obj(f, `${what}: frames[]`));
  return new Map(Array.from({ length: frames }, (_, i) => i + 1).map((k) => {
    const frame = listed.find((f) => f['frame'] === k);
    expect(frame, `${what}: frame ${k} is in the reply`).toBeDefined();
    const row = arr(frame!['views'], `${what}: frame ${k}: views`).map((v) => obj(v, `${what}: frame ${k}: views[]`)).find((v) => v['session'] === SESSION);
    expect(row, `${what}: frame ${k} has the session's view row: ${shown(frame)}`).toBeDefined();
    return [k, row!];
  }));
}
/** A drawn view row's captured frame. */
export function rowShot(out: string, row: JsonObject, what: string): Shot {
  expect(row['drawn'], `${what} was drawn: ${shown(row)}`).toBe(true);
  return shotOf(named(out, row['final'], what), what);
}
/** What the view shows on frame `k`: its latest drawn frame at or before `k` (a frame that changes nothing isn't drawn again). */
export function liveShot(out: string, rows: Map<number, JsonObject>, k: number, what: string): Shot {
  for (let j = k; j >= 1; j--) if (rows.get(j)?.['drawn'] === true) return rowShot(out, rows.get(j)!, `${what}: frame ${j}`);
  return expect.fail(`${what}: no frame was drawn by frame ${k}: ${shown([...rows.values()])}`);
}

const FLICKS_PER_SECOND = 705_600_000;
const DOC_ID = '01JB1561D00000000000000001';
/** `deep show` from your shell writes as you. */
const YOU: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
const LICENSE: JsonObject = { id: 'Apache-2.0', terms: 'Apache License, version 2.0.', shareable: true, credit: 'Test fixture made by the #1561 acceptance tests.' };
/**
 * A `deep-show run` scenario (#393): the look kept in the evidence store by its SHA-256 and named by the document as an
 * asset, the writer's payload shown from your shell, then `count` frames `step` apart from t = 0 with their pixels.
 */
export function showScenario(evidence: string, doc: JsonObject, look: JsonObject, count: number, step: string): JsonObject {
  const bytes = Buffer.from(JSON.stringify(look));
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  const id = str(look['id'], 'the look\'s id');
  const document: JsonObject = { ...payload(doc), look: { asset: `${id}@1`, theme: 'light' }, assets: { [id]: { sha256: sha, license: LICENSE } } };
  return {
    evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, SIZE[0], SIZE[1]] } }, docs: { [DOC_ID]: { panel: 'main' } },
    calls: [{ call: 'deep show', peer: YOU, doc: DOC_ID, document, include: ['issues'] }, { call: 'frames', doc: DOC_ID, count, step, pixels: true }],
  };
}
/** The listed frames of a scenario's `frames` reply, each read from the evidence store by its `pixel_hash`; frame k is at k / fps. */
export function showShots(evidence: string, replies: JsonObject[], frames: readonly number[], fps: number, what: string): Map<number, Shot> {
  expect(replies[0]!['outcome'], `${what}: the document is presented: ${shown(replies[0])}`).toBe('presented');
  const listed = arr(replies[1]!['frames'], `${what}: frames: ${shown(replies[1])}`).map((f) => obj(f, `${what}: frames[]`));
  return new Map(frames.map((k) => {
    const row = listed[k];
    expect(row, `${what}: frame ${k} is in the reply`).toBeDefined();
    expect(row!['t'], `${what}: frame ${k} is at t = ${k}/${fps} s, in flicks`).toBe((k * FLICKS_PER_SECOND) / fps);
    const name = str(row!['pixel_hash'], `${what}: frame ${k}'s pixel_hash`);
    expect(name, `${what}: frame ${k}'s pixel_hash is a SHA-256`).toMatch(SHA);
    const path = join(evidence, name.slice(0, 2), name.slice(2));
    expect(existsSync(path), `${what}: frame ${k}'s PNG ${name} is in the evidence store`).toBe(true);
    const bytes = readFileSync(path);
    expect(sha256(bytes), `${what}: the stored file hashes to its name`).toBe(name);
    return [k, shotOf(bytes, `${what}: frame ${k}`)];
  }));
}
