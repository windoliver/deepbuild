// Test-side tools for the blind redraft of #1992's criterion 5: this checkout's `deep-gpu` and the merge base's, the
// second built from an export of that commit and shown by cargo's own build messages to be compiled there (README:
// The merge base and how its build is shown to be its own); `view3d` as the base has it (#378, with #422's `packs`);
// the castle of each commit and the labels the tests add to it; PNG reading; and the judge, which compares two
// renderers' frames pixel by pixel and names the first that differs. The JSON, run and PNG helpers are copied from
// #422's suite, since suites don't import each other. Nothing here stands in for a renderer.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1992-redraft-ac5 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** The criterion's ID: the first 8 hex digits of SHA-256 of its text. */
export const AC5 = 'AC5 #1992.597ff532';

// ---------------------------------------------------------------------------------------------------
// JSON

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;
const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
const readJson = (path: string): JsonObject => obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, path);

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

/** A test that can't be judged here fails with this, never passes. */
function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// cargo, queued by the machine's build throttle (the checkout's scripts/throttle.mjs, which only waits for a grant
// and then runs the command where it was started). Its JSON build messages are what the merge base's build is judged
// by; compiler errors still go to stderr as text.

const GPU_ARGS = ['build', '--locked', '--bin', 'deep-gpu', '--message-format=json-render-diagnostics'];
interface Built { error: string; messages: JsonObject[] }
function cargoBuild(root: string, targetDir: string): Built {
  const env = { ...process.env, CARGO_TARGET_DIR: targetDir, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync(process.execPath, [join(REPO, 'scripts', 'throttle.mjs'), 'build', '--wait', '60', '--', 'cargo', ...GPU_ARGS], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, env });
  if (run.error) return { error: `cargo could not run in ${root}: ${run.error.message}`, messages: [] };
  const messages: JsonObject[] = [];
  const other: string[] = [];
  for (const line of run.stdout.split('\n')) {
    if (line === '') continue;
    try { const m = JSON.parse(line) as JsonValue; if (isObject(m)) { messages.push(m); continue; } } catch { /* not a build message */ }
    other.push(line);
  }
  if (run.status !== 0) {
    const text = [...other, ...run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Fresh/.test(l))].join('\n');
    return { error: `cargo ${GPU_ARGS.join(' ')} failed in ${root} (exit ${run.status}):\n${text.slice(-4000)}`, messages };
  }
  return { error: '', messages };
}

/** One unit cargo's build messages report (`compiler-artifact`): a crate's lib, build script, macro or binary. */
interface Unit { crate: string; target: string; fresh: boolean; manifest: string; path: boolean; executable: string | null }
function units(messages: readonly JsonObject[]): Unit[] {
  return messages.filter((m) => m['reason'] === 'compiler-artifact').map((m) => {
    const target = isObject(m['target']) ? m['target'] : {};
    const id = typeof m['package_id'] === 'string' ? m['package_id'] : '';
    const manifest = typeof m['manifest_path'] === 'string' ? m['manifest_path'] : '';
    // A package ID ends `<folder>#<version>`, or `#<name>@<version>` where the folder's name isn't the crate's.
    const [before = '', after = ''] = id.split('#');
    return {
      crate: after.includes('@') ? after.slice(0, after.indexOf('@')) : before.slice(before.lastIndexOf('/') + 1), target: `${JSON.stringify(target['kind'])} ${String(target['name'])}`,
      fresh: m['fresh'] !== false, manifest, path: id.startsWith('path+'), executable: typeof m['executable'] === 'string' ? m['executable'] : null,
    };
  });
}
/** What a build of `deep-gpu` in the export at `root` shows of itself: the failures that make it not the export's own
 * build, the workspace and `vendor/` crates compiled there, and how many third-party units were reused.
 * It is the export's own build only when cargo finished it, every unit of a crate whose manifest lies in the export
 * was compiled in this build (`fresh: false`), no path crate lies outside the export, and the `deep-gpu` binary is
 * one of the units compiled. A unit cargo took as fresh was compiled somewhere else, from sources this build never
 * read. */
export function ownBuild(messages: readonly JsonObject[], root: string): { failures: string[]; compiled: string[]; reused: number; bin: string | null } {
  const roots = [...new Set([root, realpathSync(root)])];
  const inside = (p: string): boolean => roots.some((r) => p.startsWith(r + sep));
  const failures: string[] = [];
  if (!messages.some((m) => m['reason'] === 'build-finished' && m['success'] === true)) failures.push('cargo reported no finished build');
  const compiled = new Set<string>();
  let reused = 0; let bin: string | null = null;
  for (const u of units(messages)) {
    if (!inside(u.manifest)) {
      if (u.path) failures.push(`${u.crate} (${u.target}) is a path crate outside the export: ${u.manifest}`);
      else if (u.fresh) reused++;
      continue;
    }
    if (u.fresh) { failures.push(`${u.crate} (${u.target}) was taken fresh from an earlier build, not compiled in the export`); continue; }
    compiled.add(u.crate);
    if (u.target === '["bin"] deep-gpu') bin = u.executable;
  }
  if (bin === null) failures.push('the deep-gpu binary is not among the units compiled in the export');
  return { failures, compiled: [...compiled].sort(), reused, bin };
}

// ---------------------------------------------------------------------------------------------------
// The two renderers

/** What the suite keeps under the checkout's (git-ignored) target folder: one merge-base renderer. */
const KEEP = join(REPO, 'target', 'acceptance', '1992-redraft-ac5');
const CASTLE = 'packs/examples/castle.json';
const CASTLE_LOOK = 'packs/examples/castle.look.json';
const CASTLE_PACK = 'packs/composites-1.0.0';

/** The merge base, read at test time: `git merge-base HEAD origin/main`, else against `main`. */
function mergeBase(): string {
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let sha: string;
  try { sha = git('merge-base', 'HEAD', 'origin/main'); } catch { sha = git('merge-base', 'HEAD', 'main'); }
  return git('rev-parse', '--verify', `${sha}^{commit}`);
}
/** Every file under `dir`, as paths from it. */
function filesUnder(dir: string, at = ''): string[] {
  return readdirSync(join(dir, at), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(dir, join(at, e.name)) : [join(at, e.name)]));
}
/** The kept folder's marker holds: it names `sha`, and each file it lists is there with the SHA-256 it lists. */
function proven(kept: string, sha: string): boolean {
  try {
    const marker = readJson(join(kept, 'PROVEN.json'));
    const files = Object.entries(obj(marker['files'], 'the marker\'s files'));
    return marker['sha'] === sha && files.some(([name]) => name === 'deep-gpu') && files.every(([name, hash]) => sha256(readFileSync(join(kept, name))) === hash);
  } catch { return false; }
}
/** The names of the export's path crates (its workspace members and `vendor/` crates), by cargo's own listing. */
function pathCrates(root: string): Set<string> {
  const meta = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1'], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 })) as JsonValue;
  return new Set(arr(obj(meta, 'cargo metadata')['packages'], 'cargo metadata: packages').map((p) => obj(p, 'a package')).filter((p) => p['source'] === null).map((p) => str(p['name'], 'a package\'s name')));
}
/**
 * The merge base's `deep-gpu` with the castle that commit draws, kept in `target/acceptance/1992-redraft-ac5/base-<sha>`
 * and reused while its marker holds. Otherwise it is built here: the commit exported whole by `git archive`, third-party
 * artifacts seeded from a copy-on-write clone of this checkout's target folder with every path crate's fingerprints and
 * build-script outputs removed, `cargo build --locked --bin deep-gpu` run in the export, and cargo's build messages
 * judged by `ownBuild`. The binary, the castle's files and then the marker are kept only when that check held; the
 * export and the cloned target folder are deleted either way. Returns an error instead of a renderer when it didn't.
 */
function baseRenderer(seed: string): { sha: string; root: string; bin: string } | string {
  let sha: string;
  try { sha = mergeBase(); } catch (e) { return `the merge base could not be read: ${(e as Error).message}`; }
  const kept = join(KEEP, `base-${sha}`);
  const at = { sha, root: kept, bin: join(kept, 'deep-gpu') };
  if (proven(kept, sha)) { console.log(`${AC5}: the merge base ${sha.slice(0, 12)}'s deep-gpu is kept in ${kept}, its marker holds`); return at; }
  const started = Date.now();
  const work = join(KEEP, 'work');
  rmSync(work, { recursive: true, force: true });
  rmSync(kept, { recursive: true, force: true });
  try {
    const src = join(work, 'src');
    mkdirSync(src, { recursive: true });
    execFileSync('git', ['archive', '--format=tar', '-o', join(work, 'src.tar'), sha], { cwd: REPO });
    execFileSync('tar', ['-xf', join(work, 'src.tar'), '-C', src]);
    rmSync(join(work, 'src.tar'));
    const target = join(work, 'target');
    mkdirSync(target);
    if (existsSync(join(seed, 'debug'))) {
      execFileSync('cp', ['-c', '-R', join(seed, 'debug'), join(target, 'debug')]);
      const own = pathCrates(src);
      for (const sub of ['.fingerprint', 'build']) {
        const dir = join(target, 'debug', sub);
        for (const entry of existsSync(dir) ? readdirSync(dir) : []) {
          const crate = /^(.+)-[0-9a-f]{16}$/.exec(entry)?.[1];
          if (crate !== undefined && own.has(crate)) rmSync(join(dir, entry), { recursive: true, force: true });
        }
      }
    }
    const built = cargoBuild(src, target);
    if (built.error !== '') return `the merge base ${sha.slice(0, 12)}'s deep-gpu did not build: ${built.error}`;
    const own = ownBuild(built.messages, src);
    if (own.failures.length > 0 || own.bin === null) {
      return `the merge base ${sha.slice(0, 12)}'s deep-gpu is not shown to be built from its own sources (${own.failures.length} units):\n  ${own.failures.slice(0, 80).join('\n  ')}`;
    }
    mkdirSync(kept, { recursive: true });
    copyFileSync(own.bin, at.bin, constants.COPYFILE_FICLONE);
    for (const path of [CASTLE, CASTLE_LOOK, CASTLE_PACK]) cpSync(join(src, path), join(kept, path), { recursive: true });
    const files = Object.fromEntries(filesUnder(kept).map((name) => [name, sha256(readFileSync(join(kept, name)))]));
    const seconds = Math.round((Date.now() - started) / 1000);
    writeFileSync(join(kept, 'PROVEN.json'), `${JSON.stringify({ sha, built: new Date().toISOString(), seconds, compiled: own.compiled, reused: own.reused, files }, null, 1)}\n`);
    for (const other of readdirSync(KEEP)) if (other.startsWith('base-') && other !== `base-${sha}`) rmSync(join(KEEP, other), { recursive: true, force: true });
    console.log(`${AC5}: the merge base ${sha.slice(0, 12)}'s deep-gpu built from its export in ${seconds} s: ${own.compiled.length} workspace and vendor crates compiled there (${own.compiled.join(', ')}), ${own.reused} third-party units reused; kept in ${kept}`);
    return at;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export interface Renderer { name: string; bin: string; root: string }
/** Builds both renderers before the file's tests: this checkout's `deep-gpu`, copied out of its target folder, and
 * the merge base's. A test that uses one that didn't build, or wasn't shown to be its commit's own, fails with why. */
export function useRenderers(): { mine: () => Renderer; base: () => Renderer; out: () => string } {
  let dir = ''; let mineError = 'the build did not run'; let based: ReturnType<typeof baseRenderer> = 'the merge base\'s build did not run';
  beforeAll(() => {
    if (process.platform !== 'darwin') return;
    dir = mkdtempSync(join(tmpdir(), 'deep-1992-ac5-'));
    const seed = process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
    mineError = cargoBuild(REPO, seed).error;
    if (mineError === '') copyFileSync(join(seed, 'debug', 'deep-gpu'), join(dir, 'deep-gpu'), constants.COPYFILE_FICLONE);
    try { based = baseRenderer(seed); } catch (e) { based = `the merge base's build stopped: ${(e as Error).message}`; }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  const onMac = (): void => { if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS only; this is ${process.platform}`); };
  return {
    mine: () => { onMac(); expect(mineError, 'this checkout\'s deep-gpu builds').toBe(''); return { name: 'this checkout', bin: join(dir, 'deep-gpu'), root: REPO }; },
    base: () => {
      onMac();
      if (typeof based === 'string') return expect.fail(based);
      return { name: `the merge base ${based.sha.slice(0, 12)}`, bin: based.bin, root: based.root };
    },
    out: () => dir,
  };
}

// ---------------------------------------------------------------------------------------------------
// The castle of a renderer's commit, and the labels the tests add (README: The fixture)

/** The frame rate the castle is drawn at, and the sampled times: the quarter-turns of its orbit, as #422 samples it. */
const FPS = 30;
/** The fields #1992 adds that the castle as committed must not name: `background_intensity` and the `linear` curve on
 * a sky, `fog` on any other item (a sky's own `fog` is its color, a field the base has). */
export function newFields(doc: JsonObject): string[] {
  const found: string[] = [];
  for (const [id, v] of Object.entries(obj(doc['items'], 'items'))) {
    const item = obj(v, `items/${id}`);
    const params = isObject(item['params']) ? item['params'] : {};
    if (item['kind'] === 'sky@1') {
      if (params['background_intensity'] !== undefined) found.push(`items/${id}/params/background_intensity`);
      const curve = params['fog_curve'];
      if (curve !== undefined && curve !== 'exp' && curve !== 'exp2') found.push(`items/${id}/params/fog_curve = ${JSON.stringify(curve)}`);
    } else {
      if (params['fog'] !== undefined) found.push(`items/${id}/params/fog`);
      if (item['fog'] !== undefined) found.push(`items/${id}/fog`);
    }
  }
  return found;
}
/** The labels: world-size `mark.text@1` items in the look's ink, facing the camera (the default), each above the part
 * it names and above the camera's own height, so the sky is behind it at every sampled time. Every field is the
 * base's. */
export const LABELS: Record<string, { text: string; pos: [number, number, number] }> = {
  label_keep: { text: 'Keep', pos: [-3, 17, -2] },
  label_gate: { text: 'Gate', pos: [-1.5, 19.5, -6] },
  label_castle: { text: 'The castle', pos: [3, 22, -2] },
};
/** `doc` with the labels added; `fog` is written on each label's params when given. */
export function labelled(doc: JsonObject, fog?: boolean): JsonObject {
  const out = JSON.parse(JSON.stringify(doc)) as JsonObject;
  const items = obj(out['items'], 'items');
  let k = 0;
  for (const [id, l] of Object.entries(LABELS)) {
    expect(items[id], `the castle has no item named ${id} yet`).toBeUndefined();
    items[id] = {
      id, kind: 'mark.text@1', name: `Label: ${l.text}`, order: `z${String(k++).padStart(3, '0')}`,
      params: { text: l.text, size: 2, size_space: 'world', paint: { fill: { role: 'ink' } }, ...(fog === undefined ? {} : { fog }) }, at: { pos: l.pos },
    };
  }
  return out;
}

export interface Castle { doc: JsonObject; look: JsonObject; pack: string; size: [number, number]; frames: number[] }
/** The castle under `root` (a checkout, or the kept merge-base folder): its description, its look, its pack folder,
 * its own size, and the four sampled frames at 30 fps. */
export function castleOf(root: string): Castle {
  const doc = readJson(join(root, CASTLE));
  const span = /^(\d+(?:\.\d+)?)s$/.exec(str(obj(doc['transport'], `${CASTLE}: transport`)['span'], `${CASTLE}: transport.span`));
  expect(span, `${CASTLE}: transport.span is in seconds`).not.toBeNull();
  const turn = Number(span![1]) * FPS;
  expect(Number.isInteger(turn / 4), `${CASTLE}: its span is a whole number of frames at ${FPS} fps, divisible by 4`).toBe(true);
  const size = arr(doc['size'], `${CASTLE}: size`).map((v, i) => num(v, `${CASTLE}: size[${i}]`)) as [number, number];
  return { doc, look: readJson(join(root, CASTLE_LOOK)), pack: join(root, CASTLE_PACK), size, frames: [0, 1, 2, 3].map((k) => (k * turn) / 4) };
}

// ---------------------------------------------------------------------------------------------------
// view3d (#378, `packs` from #422): one process per document, one call per sampled frame

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
function decodePng(file: Buffer): Image {
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
function readNamed(out: string, hash: JsonValue | undefined, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash as string}.png`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}

/** One sampled frame as a renderer drew it: the reply's `pixel_hash`, its final target's pixels, and the item the
 * object-ID target names at each pixel (null where nothing draws). */
export interface Frame { frame: number; t: string; pixel_hash: string; final: Image; item: (i: number) => string | null }
/** `doc` drawn by `r` at the castle's sampled frames, at its own size: the final and object-ID targets. The renderer
 * runs in its own commit's folder and is given absolute paths, so it reads no other commit's files. */
export function draw(r: Renderer, c: Castle, name: string, doc: JsonObject, outRoot: string): Frame[] {
  const out = join(outRoot, `${name}-${r.root === REPO ? 'mine' : 'base'}`);
  mkdirSync(out, { recursive: true });
  const path = join(out, `${name}.json`);
  writeFileSync(path, JSON.stringify(doc));
  const calls = c.frames.map((n) => ({ call: 'view3d', doc: path, look: c.look, size: c.size, from: n, frames: 1, fps: FPS, capture: 'every', targets: ['final', 'ids'], packs: [c.pack] }));
  const what = `${name} drawn by ${r.name}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(r.bin, ['run'], { cwd: r.root, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (run.error) expect.fail(`${what}: deep-gpu run: ${run.error.message}`);
  expect(run.status, `${what}: deep-gpu run exited 0 (${run.signal ?? 'no signal'}); stdout: ${run.stdout.slice(0, 1500)}; stderr: ${run.stderr.slice(-3000)}`).toBe(0);
  const lines = run.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: the scenario was refused: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`);
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  return replies.map((v, k): Frame => {
    const reply = obj(v, `${what}: replies[${k}]`);
    if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
    expect(reply['code'], `${what}: frame ${c.frames[k]} was drawn, not refused: ${shown(reply)}`).toBeUndefined();
    const frames = arr(reply['frames'], `${what}: frames`);
    expect(frames.length, `${what}: the call for frame ${c.frames[k]} draws one frame`).toBe(1);
    const f = obj(frames[0], `${what}: the frame`);
    const n = num(f['frame'], `${what}: frame`);
    expect(n, `${what}: the frame drawn is the one asked for`).toBe(c.frames[k]);
    const at = `${what}, frame ${n}`;
    const final = decodePng(readNamed(out, f['final'], `${at}: the final target`));
    const ids = decodePng(readNamed(out, f['ids'], `${at}: the object-ID target`));
    expect([final.width, final.height, ids.width, ids.height], `${at}: both targets are the castle's size`).toEqual([...c.size, ...c.size]);
    const picks = obj(f['picks'], `${at}: picks`);
    // The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws.
    const item = (i: number): string | null => {
      const o = i * 4;
      const pick = (ids.rgba[o]! + ids.rgba[o + 1]! * 256 + ids.rgba[o + 2]! * 65_536 + ids.rgba[o + 3]! * 16_777_216) >>> 0;
      return pick === 0 ? null : typeof picks[String(pick)] === 'string' ? (picks[String(pick)] as string) : `unknown:${pick}`;
    };
    return { frame: n, t: `${n / FPS}s`, pixel_hash: str(f['pixel_hash'], `${at}: pixel_hash`), final, item };
  });
}

// ---------------------------------------------------------------------------------------------------
// The judge

const rgba = (im: Image, i: number): string => `rgba(${[...im.rgba.subarray(i * 4, i * 4 + 4)].join(', ')})`;
/** The failures of `mine` against `base`, frame by frame: a failure for each frame whose `pixel_hash` or whose final
 * target's pixels differ, naming the frame and its first differing pixel, rows top-down and left to right in each. */
export function judge(what: string, base: readonly Frame[], mine: readonly Frame[]): string[] {
  expect(mine.map((f) => f.frame), `${what}: both renderers drew the same frames`).toEqual(base.map((f) => f.frame));
  const failures: string[] = [];
  for (const [k, b] of base.entries()) {
    const m = mine[k]!;
    const at = `${what}, frame ${b.frame} (t = ${b.t})`;
    if (m.final.width !== b.final.width || m.final.height !== b.final.height) { failures.push(`${at}: drawn at ${m.final.width} × ${m.final.height}, the merge base's at ${b.final.width} × ${b.final.height}`); continue; }
    let first = -1; let differing = 0;
    for (let i = 0; i < b.final.width * b.final.height; i++) {
      const o = i * 4;
      if (m.final.rgba[o] === b.final.rgba[o] && m.final.rgba[o + 1] === b.final.rgba[o + 1] && m.final.rgba[o + 2] === b.final.rgba[o + 2] && m.final.rgba[o + 3] === b.final.rgba[o + 3]) continue;
      if (first < 0) first = i;
      differing++;
    }
    const hashes = `pixel_hash ${m.pixel_hash.slice(0, 16)}… against the merge base's ${b.pixel_hash.slice(0, 16)}…`;
    if (first >= 0) {
      failures.push(`${at}: the first differing pixel is (${first % b.final.width}, ${Math.floor(first / b.final.width)}): the merge base draws ${rgba(b.final, first)}, this draws ${rgba(m.final, first)}; ${differing} of ${b.final.width * b.final.height} pixels differ; ${hashes}`);
    } else if (m.pixel_hash !== b.pixel_hash) {
      failures.push(`${at}: no pixel of the final target differs, but the frames' hashes do: ${hashes}`);
    }
  }
  return failures;
}

/** A label's contrast against the sky behind it in one frame: over the pixels the object-ID target of `ids` gives the
 * label, the mean of |`frame` − `behind`| over the three color channels, in 8-bit codes. */
export function contrast(label: string, ids: Frame, frame: Frame, behind: Frame): { pixels: number; contrast: number; onSky: boolean } {
  let pixels = 0; let sum = 0; let onSky = true;
  for (let i = 0; i < ids.final.width * ids.final.height; i++) {
    if (ids.item(i) !== label) continue;
    pixels++;
    if (behind.item(i) !== null) onSky = false;
    for (let c = 0; c < 3; c++) sum += Math.abs(frame.final.rgba[i * 4 + c]! - behind.final.rgba[i * 4 + c]!);
  }
  return { pixels, contrast: pixels === 0 ? 0 : sum / (pixels * 3), onSky };
}
