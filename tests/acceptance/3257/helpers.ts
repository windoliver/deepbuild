// Test-side tools for the #3257 acceptance tests: the criteria's IDs; the decode worker, a process of `deep-gpu`, driven
// by its own `transcode` jobs (README: The surface under test); the pinned merge base's `deep-gpu`; the drawn square
// and its object-ID share; and the timed worker. Builds, documents, frames and the timing judge are #1634's helpers and
// the PNG writer #423's, by import; the maps and the checkers are ./chains.ts. Nothing here stands in for the decode
// worker, the renderer or the player: every value a test compares comes from a binary or the player's wasm, every
// expected value from the issue.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, expect } from 'vitest';
import { encodePng } from '../423/helpers.ts';
import {
  DARK_SKY, PLAIN_LOOK, REPO, TIMEOUT, arr, framesOf, inconclusive, isObject, obj, offReferenceMac, requireMetal, runGpu, sessionDoc, sha256, shown, str,
  view3dCall, writeJson, type Frame, type JsonObject, type JsonValue, type Size,
} from '../1634/helpers.ts';
import { keptShare, levelsOf, named, type Level } from './chains.ts';

/** The criteria's IDs: `#3257.` and the first 8 hex digits of SHA-256 of each criterion's text (README). */
export const AC = {
  1: 'AC1 #3257.99ce0129', 2: 'AC2 #3257.0856a85c', 3: 'AC3 #3257.699e8b81', 4: 'AC4 #3257.09613218',
  5: 'AC5 #3257.d4ceba15', 6: 'AC6 #3257.8b7b7fd8', 7: 'AC7 #3257.c1dee41c', 8: 'AC8 #3257.389c0d78',
} as const;

/** The drawn criteria run on the reference Mac (the issue's "Runs on"): INCONCLUSIVE elsewhere, never a pass. */
export function onReferenceMac(): void {
  requireMetal();
  const off = offReferenceMac();
  if (off) inconclusive(`the drawn criteria run on the reference Mac: ${off}`);
}

// ---------------------------------------------------------------------------------------------------
// Maps as files, and the decode worker's `transcode` job

export interface Asset { sha: string; path: string }
export function writeMap(dir: string, name: string, map: Level): Asset {
  const png = encodePng(map.w, map.h, (x, y) => [...map.px.subarray(4 * (y * map.w + x), 4 * (y * map.w + x) + 4)]);
  const path = join(dir, `${name}.png`);
  writeFileSync(path, png);
  return { sha: sha256(png), path };
}
/** A job's role words as the base's `Role::read` takes them. */
export type Role = 'base_color' | 'data';
export interface Job { name: string; map: Level; role?: Role; /** The `mask` material's `alpha_cutoff`; none where no `mask` material samples the map. */ cutoff?: number }
/** The job as JSON: the base's fields and, for a map a `mask` material samples, `alpha_cutoff`. */
export const jobLine = (j: { role?: Role; cutoff?: number }, path: string, out: string): JsonObject =>
  ({ op: 'transcode', path, role: j.role ?? 'base_color', bc: true, out, ...(j.cutoff === undefined ? {} : { alpha_cutoff: j.cutoff }) });

export interface Made { reply: JsonObject; file: string; data: Buffer; levels: Level[] }
/** One reply of the decode worker held to what the base already answers: RGBA8 in the role's encoding, a full chain of
 * the map's size, its bytes in `out`, and level 0 the file's own byte for byte (the issue's Scope). */
export function readMade(line: JsonValue, j: Job, out: string): Made {
  const what = `the decode worker's reply to ${j.name}`;
  const envelope = obj(line, what);
  const reply = obj(envelope['reply'], `${what}: reply`);
  expect(reply['refused'], `${what}: not refused: ${shown(reply)}`).toBeUndefined();
  expect(reply['format'], `${what}: format`).toBe(j.role === 'data' ? 'rgba8unorm' : 'rgba8unorm-srgb');
  expect(reply['size'], `${what}: size`).toEqual([j.map.w, j.map.h]);
  const data = readFileSync(out);
  expect(reply['bytes'], `${what}: bytes, the length of the chain in its out file`).toBe(data.length);
  const levels = levelsOf(data, j.map.w, j.map.h);
  expect(levels, `${what}: its out file holds the full chain, every level end to end`).not.toBeNull();
  expect(reply['mips'], `${what}: mips`).toBe(levels!.length);
  expect(Buffer.compare(levels![0]!.px, j.map.px), `${what}: level 0 is the file's own, byte for byte`).toBe(0);
  return { reply, file: str(envelope['file'], `${what}: file`), data, levels: levels! };
}
/** The jobs in one decode worker of `bin`, in order. */
export function transcode(bin: string, dir: string, jobs: Job[]): Made[] {
  const outs = jobs.map((j) => join(dir, `${j.name}.chain`));
  const lines = jobs.map((j, i) => JSON.stringify(jobLine(j, writeMap(dir, j.name, j.map).path, outs[i]!)));
  const run = spawnSync(bin, ['decode-worker'], { cwd: REPO, input: `${lines.join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 600_000, killSignal: 'SIGKILL' });
  expect(run.error?.message ?? '', 'the decode worker ran').toBe('');
  expect(run.status, `the decode worker exits 0 at its input's end: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const replies = run.stdout.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as JsonValue);
  expect(replies.length, 'one reply a job').toBe(jobs.length);
  return jobs.map((j, i) => readMade(replies[i]!, j, outs[i]!));
}
/** A list of shares, one a level (`kept: [f32]`), each what the chain's own bytes keep at `cutoff`. */
export function keptFaults(list: JsonValue | undefined, levels: readonly Level[], cutoff: number, what: string): string[] {
  if (!Array.isArray(list) || list.length !== levels.length || !list.every((v) => typeof v === 'number')) return [`${what}: kept is not a list of ${levels.length} shares, one a level: ${shown(list)}`];
  return levels.flatMap((level, l) => {
    const want = keptShare(level, cutoff);
    return Math.abs((list[l] as number) - want) <= 1e-6 ? [] : [`${what}: kept says ${String(list[l])} at ${named(l, level)}, where its bytes keep ${want}`];
  });
}

// ---------------------------------------------------------------------------------------------------
// The merge base's `deep-gpu`. The base commit this suite was written on is pinned, so the comparison stays with the
// plain box after the change merges. Git runs with every GIT_* variable taken out of its environment, so a hook's or a
// worktree's settings can't point it at another repository; the tree is exported with `git archive` (no .git is copied)
// and built in a target folder of its own, which the suite's files share.

export const BASE = 'b41a1b521b6bae88709338542fb304d95b841312';
export const gitEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
export function buildBase(scratch: string, release = false): { bin: string; error: string } {
  const own = join(targetDir(), 'acceptance-3257-base');
  const src = join(own, `src-${BASE.slice(0, 12)}`);
  const bin = join(scratch, release ? 'deep-gpu-base-release' : 'deep-gpu-base');
  if (!existsSync(join(src, '.exported'))) {
    rmSync(src, { recursive: true, force: true });
    mkdirSync(src, { recursive: true });
    const tar = `${src}.tar`;
    const a = spawnSync('git', ['archive', '--format=tar', '-o', tar, BASE], { cwd: REPO, encoding: 'utf8', env: gitEnv() });
    if (a.status !== 0) return { bin, error: `git archive ${BASE} failed: ${a.stderr}` };
    const x = spawnSync('tar', ['-xf', tar, '-C', src], { encoding: 'utf8' });
    rmSync(tar, { force: true });
    if (x.status !== 0) return { bin, error: `unpacking the merge base ${BASE} failed: ${x.stderr}` };
    writeFileSync(join(src, '.exported'), BASE);
  }
  const pinned = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
  const env = {
    ...gitEnv(), PATH: existsSync(pinned) ? `${process.env['PATH'] ?? ''}${delimiter}${pinned}` : (process.env['PATH'] ?? ''),
    CARGO_TARGET_DIR: join(own, 'target'), CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  };
  const args = ['build', '--locked', ...(release ? ['--release'] : []), '--bin', 'deep-gpu'];
  const b = spawnSync('cargo', args, { cwd: src, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (b.status !== 0) return { bin, error: `cargo ${args.join(' ')} at the merge base ${BASE} failed: ${b.error?.message ?? ''}${(b.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}` };
  copyFileSync(join(own, 'target', release ? 'release' : 'debug', 'deep-gpu'), bin);
  return { bin, error: '' };
}
/** Builds the merge base's deep-gpu before the file's tests; a test that uses a build that failed fails with its error. */
export function useBase(): () => string {
  let dir = ''; let built = { bin: '', error: 'the build did not run' };
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-3257-base-')); built = buildBase(dir); }, 3 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(built.error, `the merge base ${BASE.slice(0, 12)} builds: cargo build --locked --bin deep-gpu`).toBe(''); return built.bin; };
}

// ---------------------------------------------------------------------------------------------------
// Drawn: an upright 2 m square seen head-on, in front of nothing. The frame is 512 px a side under a 90° field of view,
// so its focal length is 256 px and the square, centred on the frame, spans 512 ÷ d px at d m: each pixel's centre is a
// texel's centre of the level that is that many texels a side. The square is a `slab@1` 2 mm thick whose face lies at
// z = 0, its uv0 planar along z over 2 m, so the map covers it once (its seam, under `wrap: repeat`, at x = 0).

export const FRAME: Size = [512, 512];
/** Each criterion distance: how many px the square spans, and how far it is, m. */
export const FAR: readonly { px: number; m: number }[] = [{ px: 256, m: 2 }, { px: 128, m: 4 }, { px: 64, m: 8 }, { px: 32, m: 16 }];
const THICK = 0.002;
/** A camera at (0, 0, z) looking along −Z. */
export const camera = (z: number, fov = 90): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position: [0, 0, z], target: [0, 0, z - 1], fov, near: 0.1 } });
export const cutout = (sha: string, cutoff?: number): JsonObject =>
  ({ kind: 'material@1', params: { base_color: [1, 1, 1, 1], unlit: true, alpha_mode: 'mask', ...(cutoff === undefined ? {} : { alpha_cutoff: cutoff }), maps: { base_color: sha } } });
/** The square, its face centred on (x, 0, z). */
export const square = (material: string, x = 0, z = 0): JsonObject =>
  ({ kind: 'slab@1', params: { size: [2, 2, THICK], uv0: { planar: { axis: 'z' } }, uv_scale: 2 }, at: { pos: [x, -1, z - THICK / 2] }, material });
export const scene = (id: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject =>
  sessionDoc(id, FRAME, 'work_product', { cam: camera(2), sky: DARK_SKY, ...items }, extra);
/** The fence square alone, `m` metres away. */
export const squareDoc = (id: string, sha: string, m: number): JsonObject => scene(id, { cam: camera(m), mat: cutout(sha), fence: square('mat') });

/** The pictures' frame (AC8): four copies of one card side by side, each facing the camera at one of the criterion's
 * distances, 256, 128, 64 and 32 px across with 16 px between, on a plain blue-grey sky. */
export const PICTURE: Size = [560, 288];
export function cardsDoc(id: string, sha: string): JsonObject {
  const centres = [144, 352, 464, 528];
  const sky: JsonObject = { kind: 'sky@1', params: { top: [0.3, 0.4, 0.55, 1], low: [0.3, 0.4, 0.55, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
  const cards = Object.fromEntries(FAR.map(({ px, m }, i) => [`card_${px}`, square('mat', ((centres[i]! - PICTURE[0] / 2) * m) / 256, -m)]));
  return sessionDoc(id, PICTURE, 'work_product', { cam: camera(0, (2 * Math.atan(PICTURE[0] / 2 / 256) * 180) / Math.PI), sky, mat: cutout(sha), ...cards });
}

/** One call a document: its frame's `targets`, its receipt asked for. */
export const drawCall = (out: string, name: string, doc: JsonObject, assets: Asset[], targets: ('final' | 'ids')[]): JsonObject => ({
  ...view3dCall({ doc: writeJson(out, name, doc), look: PLAIN_LOOK, size: obj(doc, name)['size'] as Size, targets }),
  assets: Object.fromEntries(assets.map((a) => [a.sha, a.path])), receipt: true,
});
export function frameOf(out: string, reply: JsonObject, size: Size, what: string): Frame {
  const [frame] = framesOf(out, reply, size, what);
  expect(frame, `${what}: its frame is in the reply`).toBeDefined();
  return frame!;
}
/** The share of a square's px the object-ID pass keeps for `id`, the square `px` across and centred on frame x `cx`;
 * any pixel of `id` outside the square is a fault of the fixture. */
export function drawnShare(frame: Frame, id: string, px: number, what: string, cx = FRAME[0] / 2): number {
  expect(frame.ids, `${what}: the object-ID pass is in the reply`).not.toBeNull();
  let inside = 0; let outside = 0;
  for (let y = 0; y < FRAME[1]; y++) for (let x = 0; x < FRAME[0]; x++) {
    if (frame.ids!.at(x, y) !== id) continue;
    if (Math.abs(x + 0.5 - cx) < px / 2 && Math.abs(y + 0.5 - FRAME[1] / 2) < px / 2) inside++; else outside++;
  }
  expect(outside, `${what}: no pixel outside the ${px} px square shows ${id}`).toBe(0);
  return inside / (px * px);
}
/** The fence square's drawn share at each distance, by `bin`. */
export function drawnShares(bin: string, out: string, fence: Asset): number[] {
  const docs = FAR.map(({ px, m }) => squareDoc(`fence-${px}`, fence.sha, m));
  const replies = runGpu(bin, out, docs.map((d, i) => drawCall(out, `fence-${FAR[i]!.px}`, d, [fence], ['ids'])));
  return replies.map((r, i) => drawnShare(frameOf(out, r, FRAME, `the fence at ${FAR[i]!.px} px`), 'fence', FAR[i]!.px, `the fence at ${FAR[i]!.px} px`));
}
export const points = (v: number): string => `${(100 * v).toFixed(2)}%`;

/** A receipt's rows for image `sha` (`receipt.maps`). */
export function rowsOf(reply: JsonObject, sha: string, what: string): JsonObject[] {
  const receipt = obj(reply['receipt'], `${what}: receipt`);
  return arr(receipt['maps'], `${what}: receipt.maps`).map((m, i) => obj(m, `${what}: receipt.maps[${i}]`)).filter((m) => m['sha256'] === sha);
}
/** The transcode jobs a run's decode workers ran on image `sha` (the `workers` call). */
export function transcodesOf(reply: JsonObject, sha: string): number {
  return arr(reply['workers'], 'workers').map((w, i) => obj(w, `workers[${i}]`)).flatMap((w) => arr(w['jobs'], 'jobs'))
    .filter((j) => isObject(j) && j['op'] === 'transcode' && j['file'] === sha).length;
}

// ---------------------------------------------------------------------------------------------------
// A decode worker held open, its jobs timed one at a time (AC7)

export class Worker {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: AsyncIterator<string>;
  constructor(bin: string) {
    this.child = spawn(bin, ['decode-worker'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume();
    this.lines = createInterface({ input: this.child.stdout })[Symbol.asyncIterator]();
  }
  /** One job: its reply's envelope and its time from the line sent to the reply read, ms. */
  async ask(job: JsonObject): Promise<{ line: JsonValue; ms: number }> {
    const start = performance.now();
    this.child.stdin.write(`${JSON.stringify(job)}\n`);
    const next = await this.lines.next();
    const ms = performance.now() - start;
    expect(next.done === true, 'the decode worker answers the job').toBe(false);
    return { line: JSON.parse(next.value as string) as JsonValue, ms };
  }
  /** Closes its input, at whose end it exits. */
  close(): void { this.child.stdin.end(); }
}
