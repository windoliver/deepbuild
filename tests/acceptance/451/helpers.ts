// Test-side tools for the #451 acceptance tests (README: The surface under test). They reuse #449's suite helpers for
// what is the same here (one `deep-gpu run` scenario, the `particles` call and its 3D reader, `view3d` with its
// `particles` field, the evaluated-data hash, the GPU guard, seeded random numbers, the animated PNG of the canvas's
// own frames) and add: this suite's criterion IDs and planted name; builds of `deep-gpu` and `deep-canvas-render`;
// `deep-canvas-render`'s `look` and `geometry` (the graph's routes as the canvas lays them out, the reference AC1 is
// judged by); the 2D documents, the graph before and after its relayout; the `particles` call's reading of a 2D item;
// `film2d` with this suite's `particles` field and its 2D evaluated-data hash; the seek-against-play check AC1 and AC3
// share; and a point's distance to a polyline and its place along it. Nothing here stands in for the emitter, the
// layout, the router, the stream integration or the renderer.

import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect } from 'vitest';
import {
  FLICKS, REPO, SHA, TIMEOUT, arr, inconclusive, isObject, num, obj, particlesCall, random, runGpu, sha256, show, str,
  type JsonObject, type JsonValue, type Startup,
} from '../449/helpers.ts';

export {
  FLICKS, REPO, SHA, TIMEOUT, apng, arr, camera, checkOf, errors, evaluatedHash, failsNaming, flicks, fmt, framesOf,
  inconclusive, isObject, linearChannel, none, num, obj, particlesCall, passed, reading, requireGpu, secondsOf, sha256,
  show, str, useDir, view3d, writeJson, STILL,
  type Checked, type JsonObject, type JsonValue, type V3,
} from '../449/helpers.ts';

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (scripts/proof-change.mjs). */
export const CRITERIA = { 1: '#451.5e48c360', 2: '#451.6846b36f', 3: '#451.9c598890', 4: '#451.98808b85' } as const;
/** A test title's prefix: `AC<n> #451.<id>`. */
export const ac = (n: keyof typeof CRITERIA): string => `AC${n} ${CRITERIA[n]}`;

const MIB = 1024 * 1024;

// ---------------------------------------------------------------------------------------------------
// Builds: each binary once per file, `cargo build --locked --bin <name>`, copied out of the target folder.

const target = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  NO_COLOR: '1',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
export type BinName = 'deep-gpu' | 'deep-canvas-render';
function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV } });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') return `BLOCKED: cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN})`;
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** Builds every listed binary before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBins(names: readonly BinName[]): { bin: (name: BinName) => string } {
  let dir = '';
  const made = new Map<BinName, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-451-bins-'));
    for (const name of names) {
      const error = cargo(['build', '--locked', '--bin', name]);
      const bin = join(dir, name);
      if (error === '') copyFileSync(join(target(), 'debug', name), bin);
      made.set(name, { bin, error });
    }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(name: BinName): string {
      const entry = made.get(name);
      if (!entry) throw Error(`the file didn't list ${name} in useBins`);
      if (entry.error.startsWith('BLOCKED:')) throw Error(entry.error);
      expect(entry.error, `${name} builds: cargo build --locked --bin ${name}`).toBe('');
      return entry.bin;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Running binaries

/** The `deep-gpu --planted` name this suite adds (README: The planted program). */
export type Planted = 'particles_follow_arrows';
/** One `deep-gpu run` scenario (#449's runGpu: `{out, calls}` in, `{ok: true, replies}` out), planted when asked. */
export function run(bin: string, out: string, calls: JsonObject[], s: { backend?: 'noop'; planted?: Planted } = {}): JsonObject[] {
  return runGpu(bin, out, calls, s as unknown as Startup);
}

/** `deep-canvas-render <command>`: one JSON line in, one out, exit 0, accepted (`ok: true`). */
export function render(bin: string, command: 'geometry' | 'look', input: JsonObject, what: string): JsonObject {
  const r = spawnSync(bin, [command], { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 256 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`deep-canvas-render ${command}: ${r.error.message}`);
  expect(r.status, `deep-canvas-render ${command} exits 0 (${what}): ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `deep-canvas-render ${command}: one answer line (${what})`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `deep-canvas-render ${command}: the answer (${what})`);
  expect(answer['ok'], `${what}: accepted, got ${show(answer)}`).toBe(true);
  return answer;
}
/** The shipped clean look, as `deep-canvas-render look` answers it (#399's way). */
export const cleanLook = (renderBin: string): JsonObject => obj(render(renderBin, 'look', { look: 'clean' }, 'the clean look')['look'], 'look "clean": look');

// ---------------------------------------------------------------------------------------------------
// 2D geometry (document u, y down)

export type P2 = [number, number];
const p2 = (v: JsonValue | undefined, what: string): P2 => {
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) return v as P2;
  throw Error(`${what} is [x, y], got ${show(v)}`);
};
/** A polyline's length. */
export function lengthOf(poly: readonly P2[]): number {
  let s = 0;
  for (let i = 1; i < poly.length; i++) s += Math.hypot(poly[i]![0] - poly[i - 1]![0], poly[i]![1] - poly[i - 1]![1]);
  return s;
}
/** The nearest point of a polyline to `p`: its distance and its arc length from the polyline's first point. */
export function nearest(poly: readonly P2[], p: P2): { d: number; s: number } {
  let best = { d: Infinity, s: 0 };
  let s0 = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!; const b = poly[i]!;
    const ex = b[0] - a[0]; const ey = b[1] - a[1];
    const len2 = ex * ex + ey * ey;
    const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len2));
    const d = Math.hypot(a[0] + u * ex - p[0], a[1] + u * ey - p[1]);
    const len = Math.sqrt(len2);
    if (d < best.d) best = { d, s: s0 + u * len };
    s0 += len;
  }
  return best;
}
/** The point at arc length `s` along a polyline (clamped to its ends). */
export function pointAt(poly: readonly P2[], s: number): P2 {
  let rest = Math.max(0, s);
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!; const b = poly[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (rest <= len && len > 0) return [a[0] + ((b[0] - a[0]) * rest) / len, a[1] + ((b[1] - a[1]) * rest) / len];
    rest -= len;
  }
  return [...poly[poly.length - 1]!] as P2;
}

// ---------------------------------------------------------------------------------------------------
// Time: the 2D films run 10 s at 30 frames a second (README: Fixtures)

export const SPAN = 10;
export const FPS = 30;
/** Frame n's time in whole flicks at 30 fps (n × 23,520,000). */
export const frameT = (n: number): number => (n * FLICKS) / FPS;
/** `n` distinct frames in [lo, hi], drawn by mulberry32 from `seed`, ascending: the "random times" of AC1 and AC3. */
export function pickFrames(seed: number, n: number, lo: number, hi: number): number[] {
  const rnd = random(seed);
  const out = new Set<number>();
  while (out.size < n) out.add(lo + Math.floor(rnd() * (hi - lo + 1)));
  return [...out].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------
// 2D documents (README: Document fields and Fixtures)

/** A 2D document (one writer layer `main`), each item given its ID, name, order and layer. */
export function doc2d(slug: string, title: string, size: P2, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id: `doc-451-${slug}`, profile: 'figure', title, description: `${title}: a #451 acceptance fixture.`, size, seed: 451,
    transport: { span: `${SPAN}s`, frame_rate: `${FPS}/1` }, requires: { modules: { effects: '^1' } },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    ...extra,
    items: withIds,
  };
}
/** How a 2D particles item draws in these fixtures: a dot of `size` px in one role. */
export const dots = (role: string, size: number): JsonObject => ({ draw: 'dot', size, opacity: 1, color: [{ at: 0, role }, { at: 1, role }] });

/**
 * The graph (AC1, AC4): a pinned `graph@1` at (30, 20) with nodes A, C and B of 60 × 30 u and the one edge `ab`, routed
 * orthogonally. Before the relayout B sits right of A at A's height, with C between them on the straight line, so
 * the route leaves A's east side and bends around C to B's west side; the relayout moves B below A (layout memory
 * B (40, 440)), so the route runs down from A's south side to B's north side. `packets`: 20 particles, life 2 s,
 * born 10 a second, moving along `net#ab` at 120 to 160 u/s: at most 320 u in a life, short of either route's length.
 */
export const GRAPH = { at: [30, 20] as P2, edge: 'net#ab', count: 20, life: 2, rate: 10, speed: [120, 160] as P2 } as const;
export type Layout = 'before' | 'after';
export function graphDoc(layout: Layout, withPackets = true): JsonObject {
  const nodes = ['A', 'C', 'B'].map((id) => ({ id, kind: 'step', w: 60, h: 30 }));
  const memory: JsonObject = { A: [0, 0, 40, 40], C: [0, 1, 240, 40], B: layout === 'before' ? [0, 2, 440, 40] : [1, 0, 40, 440] };
  const items: Record<string, JsonObject> = {
    net: {
      kind: 'graph@1', at: { pos: [GRAPH.at[0], GRAPH.at[1], 0] },
      params: { graph: { nodes, edges: [{ id: 'ab', a: 'A', b: 'B', kind: 'flow' }] }, layout: { algo: 'pinned', direction: 'down', seed: 451 }, memory, route: { mode: 'orthogonal', corner_radius: 0 } },
    },
  };
  if (withPackets) {
    items['packets'] = {
      kind: 'particles@1',
      params: { dimensions: 2, count: GRAPH.count, life: GRAPH.life, emit: { rate: GRAPH.rate }, motion: { along: { curves: [GRAPH.edge], speed: [...GRAPH.speed] } }, ...dots('accent', 6) },
    };
  }
  // One document ID and title before and after: the relayout is a revision of the same document.
  return doc2d('graph-edge', 'Packets on a graph edge', layout === 'before' ? [600, 160] : [600, 520], items);
}
/** Edge `ab`'s route in a graph document, as `deep-canvas-render geometry` lays it out (#399): corner points, document u. */
export function routeOf(renderBin: string, look: JsonObject, doc: JsonObject, what: string): P2[] {
  const answer = render(renderBin, 'geometry', { doc, look, item: 'net' }, what);
  const g = obj(answer['graph'], `${what}: geometry's graph`);
  const route = arr(obj(g['routes'], `${what}: graph.routes`)['ab'], `${what}: graph.routes.ab`).map((p, i) => p2(p, `${what}: graph.routes.ab[${i}]`));
  expect(route.length, `${what}: edge ab has a route of at least two points`).toBeGreaterThanOrEqual(2);
  return route;
}

// ---------------------------------------------------------------------------------------------------
// The `particles` call on a 2D item (README: The surface under test)

export interface Particle2 { row: number; born: number; ends: number; curve: string }
export interface Sample2 { t: number; cpu: (P2 | null)[] }
export interface Reading2 { id: string; count: number; particles: Particle2[]; at: Sample2[] }
/** A `particles` reply on a 2D item whose check passed: its particles (row, birth, end, curve) and its places at `times`. */
export function reading2d(reply: JsonObject, id: string, times: readonly number[], what: string): Reading2 {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what}: the particles call answers rather than refusing the call: ${show(reply)}`).toBeUndefined();
  const errs = arr(reply['issues'] ?? [], `${what}: issues`).filter((i) => isObject(i) && i['severity'] === 'error');
  expect(reply['outcome'], `${what}: the check passes, got ${show(reply['outcome'])} with ${show(errs)}`).toBe('checked');
  expect(errs, `${what}: no error issue`).toEqual([]);
  const o = obj(obj(reply['items'], `${what}: items`)[id], `${what}: items.${id}`);
  const count = num(o['count'], `${what}: items.${id}.count`);
  const particles = arr(o['particles'], `${what}: items.${id}.particles`).map((v, i): Particle2 => {
    const q = obj(v, `${what}: items.${id}.particles[${i}]`);
    const w = `${what}: items.${id}.particles[${i}]`;
    return { row: num(q['row'], `${w}.row`), born: num(q['born'], `${w}.born`), ends: num(q['ends'], `${w}.ends`), curve: str(q['curve'], `${w}.curve (the curve it moves along)`) };
  });
  const at = arr(o['at'], `${what}: items.${id}.at`).map((v, k): Sample2 => {
    const q = obj(v, `${what}: items.${id}.at[${k}]`);
    const cpu = arr(q['cpu'], `${what}: items.${id}.at[${k}].cpu`);
    expect(cpu.length, `${what}: items.${id}.at[${k}].cpu holds one entry per row`).toBe(count);
    return { t: num(q['t'], `${what}: items.${id}.at[${k}].t`), cpu: cpu.map((p, r) => (p === null ? null : p2(p, `${what}: items.${id}.at[${k}].cpu[${r}] (a 2D item's place, [x, y] in u)`))) };
  });
  expect(at.map((s) => s.t), `${what}: one reading at each time asked, in order`).toEqual([...times]);
  return { id, count, particles, at };
}
/** The particles live at sample k: each row's place and the particle the list says holds that row then (or null). */
export interface Live2 { row: number; at: P2; particle: Particle2 | null }
export function liveAt(r: Reading2, k: number): Live2[] {
  const t = r.at[k]!.t / FLICKS;
  return r.at[k]!.cpu.flatMap((at, row) => (at === null ? [] : [{ row, at, particle: r.particles.find((p) => p.row === row && p.born <= t && t < p.ends) ?? null }]));
}

/**
 * The 2D evaluated-data hash (README: film2d's `particles` field): SHA-256 over the item's rows in order, a live row as
 * the byte 1 then x and y (document u) as f64 little-endian, a row with no live particle as the byte 0.
 */
export function hash2d(cpu: readonly (P2 | null)[]): string {
  const out = Buffer.alloc(cpu.reduce((n, p) => n + (p === null ? 1 : 17), 0));
  let o = 0;
  for (const p of cpu) {
    if (p === null) { out[o++] = 0; continue; }
    out[o++] = 1;
    out.writeDoubleLE(p[0], o); o += 8;
    out.writeDoubleLE(p[1], o); o += 8;
  }
  return sha256(out);
}

// ---------------------------------------------------------------------------------------------------
// film2d (#417, #149) with this suite's `particles` field

export interface Film2Spec { doc: JsonObject; frames: number; from?: number; particles?: string[]; capture?: number[] }
/** A `film2d` call in the shipped clean look at 30 fps. */
export const film2d = (s: Film2Spec): JsonObject => ({ call: 'film2d', look: 'clean', fps: FPS, ...(s as unknown as JsonObject) });
export interface Frame2 { frame: number; final: string | null; particles: Map<string, { hash: string; live: number }> }
export function frames2d(reply: JsonObject, what: string, items: readonly string[]): Frame2[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was drawn, not refused: ${show(reply)}`).toBeUndefined();
  return arr(reply['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frame ${String(f['frame'])}`;
    const particles = new Map<string, { hash: string; live: number }>();
    if (items.length) {
      const p = obj(f['particles'], `${at}: particles (README: film2d's particles field)`);
      for (const id of items) {
        const q = obj(p[id], `${at}: particles.${id}`);
        expect(q['hash'], `${at}: particles.${id}.hash is a SHA-256`).toMatch(SHA);
        particles.set(id, { hash: q['hash'] as string, live: num(q['live'], `${at}: particles.${id}.live`) });
      }
    }
    return { frame: num(f['frame'], `${what}: frames[${i}].frame`), final: typeof f['final'] === 'string' ? f['final'] : null, particles };
  });
}

/**
 * Seeking against playing for 2D films (AC1, AC3). Each document is evaluated at each of `frames` by the `particles`
 * call in a fresh process (the seek of the closed form); one process plays every document from frame 0 to its end with
 * `film2d`, in order; and each of `seeks` opens a fresh process at that frame of every document. Each played frame's
 * evaluated-data hash must be the hash of the evaluation's places at that time, and each sought frame's the played
 * one's. Guards: the item is live at every frame read, and the frames' data differ. Failures name the item and frame.
 */
export function seekEqualsPlay(bin: string, dir: string, docs: { name: string; doc: JsonObject; path: string }[], id: string, frames: readonly number[], seeks: readonly number[]): string[] {
  const times = frames.map(frameT);
  const total = SPAN * FPS;
  const cpu = docs.map((d) => {
    const call = particlesCall({ doc: d.path, t: [...times], items: [id] });
    return reading2d(run(bin, dir, [call], { backend: 'noop' })[0]!, id, times, `${d.name}, evaluated`);
  });
  const played = run(bin, dir, docs.map((d) => film2d({ doc: d.doc, frames: total, particles: [id] }))).map((reply, j) => {
    const fs = frames2d(reply, `${docs[j]!.name}, played`, [id]);
    expect(fs.map((f) => f.frame), `${docs[j]!.name}: the play holds frames 0 to ${total - 1}`).toEqual(Array.from({ length: total }, (_, n) => n));
    return fs;
  });
  const out: string[] = [];
  docs.forEach((d, j) => {
    const seen = new Set<string>();
    frames.forEach((n, k) => {
      const want = hash2d(cpu[j]!.at[k]!.cpu);
      const got = played[j]![n]!.particles.get(id)!;
      expect(got.live, `${d.name}: ${id} is live at frame ${n}`).toBeGreaterThan(0);
      seen.add(want);
      if (got.hash !== want) out.push(`${id} in ${d.name} at frame ${n} (${(n / FPS).toFixed(3)} s): playing draws evaluated data ${got.hash.slice(0, 12)}, seeking the evaluation gives ${want.slice(0, 12)}`);
    });
    expect(seen.size, `${d.name}: ${id}'s evaluated data differ from frame to frame (it moves)`).toBeGreaterThan(frames.length / 2);
  });
  for (const n of seeks) {
    const sought = run(bin, dir, docs.map((d) => film2d({ doc: d.doc, from: n, frames: 1, particles: [id] })));
    sought.forEach((reply, j) => {
      const f = frames2d(reply, `${docs[j]!.name}, sought to frame ${n}`, [id]).find((x) => x.frame === n);
      const a = f?.particles.get(id)?.hash;
      const b = played[j]![n]!.particles.get(id)!.hash;
      if (a !== b) out.push(`${id} in ${docs[j]!.name} at frame ${n}: seeking draws evaluated data ${a?.slice(0, 12) ?? 'none'}, playing ${b.slice(0, 12)}`);
    });
  }
  return out;
}
