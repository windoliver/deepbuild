// Test-side tools for the #2031 acceptance tests. The build of each binary, the JSON-lines drivers of
// `deep-canvas-render` and `deep-gpu run`, PNG reading and the keyed channels come from ../467/helpers.ts by import,
// and the perf lane's five-run judge from ../465/helpers.ts. This file adds the documents' envelope, the frames as the
// app's window and a film show them, and the closed forms the issue states (a light's reach, linear light, the clamp
// and the single sRGB encode), computed here in f64. Nothing here stands in for the renderer.
// README: The surface under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect } from 'vitest';
import {
  answered, arr, decodePng, hasFile, item, obj, px, render, REPO, runGpu, sha256, shown, str,
  type Image, type JsonObject, type JsonValue, type Planted as Planted467,
} from '../467/helpers.ts';

export {
  arr, errorsOf, failsNaming, fl, inconclusive, issuesOf, item, keyed, keyedAt, none, num, obj, px, render, requireMetal, shown,
  str, useBin, useDir,
  type Image, type Issue, type JsonObject, type JsonValue,
} from '../467/helpers.ts';
export { judge, median, timingProblem } from '../465/helpers.ts';

/** Each criterion's ID: `#2031.` + the first 8 hex digits of SHA-256 of its text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #2031.39426810',
  2: 'AC2 #2031.b71a6207',
  3: 'AC3 #2031.f59a759e',
  4: 'AC4 #2031.fd03b852',
  5: 'AC5 #2031.4cb41821',
  6: 'AC6 #2031.0ee07497',
  7: 'AC7 #2031.270a96f9',
  8: 'AC8 #2031.416073b6',
} as const;

/**
 * The look every call takes: the shipped look `clean`, whose status map the window's status marks draw from. Its role
 * `ground` is #ffffff, the white of every rect and light here; `accent` and `focus` are colored.
 */
export const LOOK = 'clean';
export const WHITE = 'ground';

/** The wrong programs this suite plants (README: Planted programs); any other name stays `bad_input`. */
export type Planted =
  | 'light_linear_falloff' | 'light_encoded_sum' | 'light_default_ambient_zero' | 'light_every_child' | 'light_stale_list'
  | 'light_accepts_seventeenth';

// ---------------------------------------------------------------------------------------------------
// The closed forms the issue states, in f64

/** sRGB-encoded 0..1 to linear light. */
const decode = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** Linear light 0..1 to sRGB-encoded. */
const encode = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
/** A light's reach: (1 − (d ÷ range)²)² inside its range, 0 past it. */
export const reach = (d: number, range: number): number => (d < range ? (1 - (d / range) ** 2) ** 2 : 0);
export interface Light { at: [number, number]; energy: number; range: number }
/**
 * The code a white child shows at pixel (x, y) under white lights: white decoded to linear light (1), multiplied by
 * `ambient` plus the sum of energy × reach × white (1) over the lights, clamped to 1 and encoded once. d is measured
 * from `at` to the pixel's centre (x + 0.5, y + 0.5), at 1 px a unit.
 */
export function whiteLit(ambient: number, lights: Light[], x: number, y: number): number {
  let sum = ambient;
  for (const l of lights) sum += l.energy * reach(Math.hypot(x + 0.5 - l.at[0], y + 0.5 - l.at[1]), l.range);
  return Math.round(255 * encode(Math.min(1, decode(1) * sum)));
}
/** The largest difference of R, G and B from `code` at (x, y). */
export const offBy = (im: Image, x: number, y: number, code: number): number => Math.max(...px(im, x, y).slice(0, 3).map((c) => Math.abs(c - code)));
/** SHA-256 of the RGBA bytes inside `box` ([x, y, w, h] in whole px), row by row. */
export function boxHash(im: Image, box: [number, number, number, number]): string {
  const h = createHash('sha256');
  for (let y = box[1]; y < box[1] + box[3]; y++) h.update(im.rgba.subarray((y * im.width + box[0]) * 4, (y * im.width + box[0] + box[2]) * 4));
  return h.digest('hex');
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Documents)

/** The envelope every document here takes: one writer layer `main`, class figure. */
export function doc(id: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `Lights ${id}`, description: `An acceptance document for lights in a group: ${id}.`, size,
    budget: { class: 'figure' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [str(i['id'], 'item id'), i])), ...extra,
  };
}
/** A `group@1` with `light` when given, and without the field when not. */
export const group = (id: string, order: string, light?: JsonObject, extra: JsonObject = {}): JsonObject => item(id, 'group@1', order, light === undefined ? {} : { light }, extra);
/** A rect filled in `fill` (a role, white unless named), a child of `parent`. */
export const rect = (id: string, order: string, box: [number, number, number, number], parent: string, fill = WHITE): JsonObject =>
  item(id, 'rect@1', order, { box, paint: { fill: { role: fill } } }, { parent });
/** A light as the issue writes it: `{at, color, energy, range}`, white unless named. */
export const light = (l: Light, color = WHITE): JsonObject => ({ at: [...l.at], color, energy: l.energy, range: l.range });
/** The same document with the group `id`'s `light` removed. */
export function unlitTwin(d: JsonObject, id: string): JsonObject {
  const twin = JSON.parse(JSON.stringify(d)) as JsonObject;
  delete obj(obj(obj(twin['items'], 'items')[id], id)['params'], `${id}.params`)['light'];
  return twin;
}

// ---------------------------------------------------------------------------------------------------
// Frames: `deep-gpu run` (macOS, Metal)

/**
 * Each of `docs` as the app's window shows it: #385's `window2d` (each writer layer on the path `layers` names, the
 * status marks and their legend over them), its PNG read back. One `deep-gpu run` process for all of them.
 */
export function windows(bin: string, out: string, docs: JsonObject[], o: { planted?: Planted | undefined; states?: JsonObject } = {}): Image[] {
  const calls = docs.map((d) => ({ call: 'window2d', doc: d, look: LOOK, ...(o.states ? { states: o.states } : {}) }));
  const replies = runGpu(bin, out, calls, o.planted as Planted467 | undefined);
  return replies.map((r, i) => {
    const what = `window2d of ${String(docs[i]!['id'])}${o.planted ? ` under ${o.planted}` : ''}`;
    return decodePng(hasFile(out, answered(r, what)['window'], 'png', what));
  });
}
/** `film2d` (#417's, #430's `from` and `hash`): each frame's pixel hash and GPU time, by absolute frame index. */
export function film(bin: string, out: string, d: JsonObject, o: { fps: number; from: number; frames: number; planted?: Planted | undefined }): Map<number, { hash: string; gpu_ms: number }> {
  const [reply] = runGpu(bin, out, [{ call: 'film2d', doc: d, look: LOOK, fps: o.fps, from: o.from, frames: o.frames, hash: true }], o.planted as Planted467 | undefined);
  const what = `film2d of ${String(d['id'])} from frame ${o.from}${o.planted ? ` under ${o.planted}` : ''}`;
  const rows = arr(answered(reply!, what)['frames'], `${what}: frames`).map((f) => obj(f, `${what}: a frame`));
  expect(rows.length, `${what}: one row per frame drawn`).toBe(o.frames);
  return new Map(rows.map((f) => [f['frame'] as number, { hash: str(f['pixel_hash'], `${what}: frame ${shown(f['frame'])}'s pixel_hash`), gpu_ms: f['gpu_ms'] as number }]));
}
/** Each of `docs` played by `film2d` from frame 0 in one process, side by side: each one's rows by frame. */
export function films(bin: string, out: string, docs: JsonObject[], o: { fps: number; frames: number }): JsonObject[][] {
  const replies = runGpu(bin, out, docs.map((d) => ({ call: 'film2d', doc: d, look: LOOK, fps: o.fps, from: 0, frames: o.frames, hash: true })));
  return replies.map((r, i) => {
    const what = `film2d of ${String(docs[i]!['id'])}`;
    const rows = arr(answered(r, what)['frames'], `${what}: frames`).map((f) => obj(f, `${what}: a frame`));
    expect(rows.length, `${what}: one row per frame drawn`).toBe(o.frames);
    return rows;
  });
}

// ---------------------------------------------------------------------------------------------------
// AC7: the merge base's binaries and its 2D fixtures (README: Readings, "Every 2D fixture already in the repo")

const TARGET = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
/** `git merge-base HEAD origin/main`, else `main`; '' when neither answers. */
function mergeBase(): string {
  for (const ref of ['origin/main', 'main']) {
    const r = spawnSync('git', ['merge-base', 'HEAD', ref], { cwd: REPO, encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return '';
}
interface Base { rev: string; src: string; canvas: string; gpu: string }
/**
 * The merge base's tree, exported once with `git archive` into `<target>/acceptance-2031-base/src-<rev>` (no worktree
 * is added), and `deep-canvas-render` and `deep-gpu` built there, as the checkout's are, into a target folder of its
 * own beside it; each binary copied to a temporary folder. The returned function fails the test if any step failed.
 */
export function useMergeBase(): () => Base {
  let error = ''; let bins = ''; let found: Base | undefined;
  beforeAll(() => {
    const rev = mergeBase();
    if (!rev) { error = 'git merge-base HEAD origin/main (or main) gave no commit'; return; }
    const own = join(TARGET(), 'acceptance-2031-base');
    const src = join(own, `src-${rev.slice(0, 12)}`);
    if (!existsSync(join(src, '.exported'))) {
      rmSync(src, { recursive: true, force: true });
      mkdirSync(src, { recursive: true });
      const tar = `${src}.tar`;
      const a = spawnSync('git', ['archive', '--format=tar', '-o', tar, rev], { cwd: REPO, encoding: 'utf8' });
      const x = a.status === 0 ? spawnSync('tar', ['-xf', tar, '-C', src], { encoding: 'utf8' }) : a;
      rmSync(tar, { force: true });
      if (x.status !== 0) { error = `exporting the merge base ${rev} failed: ${x.stderr}`; return; }
      writeFileSync(join(src, '.exported'), rev);
    }
    const env = { ...process.env, CARGO_TARGET_DIR: join(own, 'target'), CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const args = ['build', '--locked', '--bin', 'deep-canvas-render', '--bin', 'deep-gpu'];
    const b = spawnSync('cargo', args, { cwd: src, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (b.status !== 0) { error = `cargo ${args.join(' ')} at the merge base ${rev} failed: ${(b.error?.message ?? '')}${(b.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`; return; }
    bins = mkdtempSync(join(tmpdir(), 'deep-2031-base-'));
    for (const bin of ['deep-canvas-render', 'deep-gpu']) copyFileSync(join(own, 'target', 'debug', bin), join(bins, bin));
    found = { rev, src, canvas: join(bins, 'deep-canvas-render'), gpu: join(bins, 'deep-gpu') };
  }, 4 * 3_600_000);
  afterAll(() => { if (bins) rmSync(bins, { recursive: true, force: true }); });
  return () => { expect(error, 'the merge base exports and its binaries build').toBe(''); return found!; };
}

interface Fixture { path: string; doc: JsonObject; inputs: JsonObject; store: string }
const rolesIn = (v: JsonValue | undefined, out: Set<string>): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => rolesIn(x, out));
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'role' && typeof x === 'string') out.add(x); rolesIn(x, out); }
  return out;
};
const names = (v: JsonValue | undefined, key: string): string[] => Object.values(v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {})
  .map((b) => (b !== null && typeof b === 'object' && !Array.isArray(b) ? b[key] : undefined)).filter((s): s is string => typeof s === 'string');
/**
 * Every file of the parity suite's 2D area (`fixtures/parity/2d/`, at any depth) in `rev`'s tree, read from `src`,
 * with what drawing it needs: the shipped look `clean` where it binds status (its roles are clean's), else a role map
 * giving each role it names its own color and `ground` white; each status source pinned `pass`; each reading 7; and a
 * store of every file in its suite's `fixtures/` folder named by its SHA-256. `lit` lists any that names a `light`,
 * which the criterion leaves out.
 */
export function parityFixtures(src: string, rev: string, scratch: string): { fixtures: Fixture[]; lit: string[] } {
  const listed = spawnSync('git', ['ls-tree', '-r', '--name-only', rev], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
  expect(listed.status, `git ls-tree ${rev}: ${listed.stderr}`).toBe(0);
  const paths = listed.stdout.split('\n').filter((p) => /(^|\/)fixtures\/parity\/2d\/[^/]+$/.test(p));
  const files = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]));
  const stores = new Map<string, string>();
  const fixtures: Fixture[] = []; const lit: string[] = [];
  for (const path of paths) {
    const d = JSON.parse(readFileSync(join(src, path), 'utf8')) as JsonObject;
    const items = obj(d['items'], `${path}: items`);
    const params = (i: JsonValue | undefined): JsonValue | undefined => (i !== null && typeof i === 'object' && !Array.isArray(i) ? i['params'] : undefined);
    if (Object.values(items).some((i) => { const p = params(i); return p !== null && typeof p === 'object' && !Array.isArray(p) && 'light' in p; })) { lit.push(path); continue; }
    const suite = path.slice(0, path.indexOf('fixtures/') + 'fixtures'.length);
    if (!stores.has(suite)) {
      const store = join(scratch, `store-${stores.size}`);
      mkdirSync(store, { recursive: true });
      for (const f of files(join(src, suite))) { const bytes = readFileSync(f); writeFileSync(join(store, sha256(bytes)), bytes); }
      stores.set(suite, store);
    }
    const bound = 'status_bindings' in d;
    const roles = [...rolesIn(items, new Set<string>())];
    const look: JsonValue = bound ? LOOK : { light: Object.fromEntries([['ground', [255, 255, 255]], ...roles.filter((r) => r !== 'ground').map((r) => [r, [...createHash('sha256').update(r).digest().subarray(0, 3)]])]) };
    fixtures.push({
      path, doc: d, store: stores.get(suite)!,
      inputs: {
        look,
        states: Object.fromEntries(names(d['status_bindings'], 'source').map((s) => [s, 'pass'])),
        readings: Object.fromEntries(names(d['bound_values'], 'source').filter((s) => s.startsWith('reading:')).map((s) => [s, 7])),
      },
    });
  }
  return { fixtures, lit };
}
/** The times each fixture is drawn at: 0 and 1 s, in flicks. */
const FIXTURE_TIMES = [0, 705_600_000];
/**
 * Every frame each fixture draws at each time, by what drew it: `raster` (Vello CPU, as goldens draw), `window2d` (the
 * app's window) and `layers` by GPUI, the GPU layer and Vello CPU, each layer's draw path too. A frame is `png <SHA-256
 * of its bytes>`, a refusal `refused <code> <path>`. One process of each binary.
 */
export function framesOf(canvas: string, gpu: string, fixtures: Fixture[], out: string): Map<string, string> {
  mkdirSync(out, { recursive: true });
  const frames = new Map<string, string>();
  const refusal = (r: JsonObject): string => `refused ${String(r['code'])} ${String(r['path'] ?? '')}`;
  const cases = fixtures.flatMap((f) => FIXTURE_TIMES.map((t) => ({ f, t, key: `${f.path} at ${t / 705_600_000} s` })));
  const lines = cases.map((c, k) => ({ out: join(out, `raster-${k}.png`), doc: c.f.doc, t: c.t, store: c.f.store, ...c.f.inputs }));
  render(canvas, 'raster', lines).forEach((a, k) => frames.set(`${cases[k]!.key}: raster`, a['ok'] === true ? `png ${sha256(readFileSync(lines[k]!.out))}` : refusal(a)));
  const calls = cases.flatMap((c) => [
    { call: 'window2d', doc: c.f.doc, t: c.t, ...c.f.inputs },
    { call: 'layers', doc: c.f.doc, t: c.t, ...c.f.inputs, by: ['gpui', 'gpu_layer', 'vello_cpu'] },
  ]);
  const replies = runGpu(gpu, out, calls);
  cases.forEach((c, k) => {
    const [win, layers] = [replies[2 * k]!, replies[2 * k + 1]!];
    frames.set(`${c.key}: window2d`, typeof win['window'] === 'string' ? `png ${win['window']}` : refusal(win));
    if (!Array.isArray(layers['layers'])) { frames.set(`${c.key}: layers`, refusal(layers)); return; }
    for (const row of layers['layers'].map((l) => obj(l, `${c.key}: a layer`))) {
      frames.set(`${c.key}: layer ${String(row['layer'])}'s path`, JSON.stringify(row['path']));
      for (const [by, side] of Object.entries(obj(row['drawn'], `${c.key}: drawn`))) {
        const s = obj(side, `${c.key}: drawn.${by}`);
        frames.set(`${c.key}: layer ${String(row['layer'])} by ${by}`, typeof s['png'] === 'string' ? `png ${s['png']}` : refusal(s));
      }
    }
  });
  return frames;
}
