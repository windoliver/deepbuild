// Test-side tools for the #415 acceptance tests (README: The surface under test). They build deep-show's `full`
// once, drive `deep-show run [--planted <name>]` with `validate`, `install_pack` and `sandbox` calls, and write
// the data assets the criteria name in this suite's reading of each layout's bytes (README: Byte layouts). Nothing
// here stands in for a validator, the cap, the trap mapper or the field a refusal names: every verdict is the
// implementation's own.

import { createHash, type Hash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/415 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const MIB = 1024 * 1024;
/** Every test's own timeout: the first deep-show build and the 256 MiB assets take minutes. */
export const LONG = 3_600_000;

export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
export const show = (v: unknown): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}

// ---------------------------------------------------------------------------------------------------
// deep-show `full`, built once per process (as #238's suite builds it), and its `run` scenarios.

const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};
let built: { bin: string; error: string } | undefined;
let binsDir = '';
function build(): { bin: string; error: string } {
  if (built) return built;
  binsDir = mkdtempSync(join(tmpdir(), 'deep-415-bins-'));
  const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV } });
  const bin = join(binsDir, 'deep-show-full');
  let error = '';
  if (run.error) error = `cargo could not run: ${run.error.message}`;
  else if (run.status !== 0) error = `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  else {
    const target = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
    copyFileSync(join(target, 'debug', 'deep-show'), bin);
  }
  built = { bin, error };
  return built;
}
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(): void { beforeAll(() => { build(); }, LONG); }
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built = undefined; });

/** The planted twins of deep-show's startup `--planted <name>` this suite adds (README: Planted twins). */
export type Planted = 'pages_capped_at_64mib' | 'nav_graph_trusts_link_count';

/** `deep-show run [--planted p]` on one scenario `{evidence, calls}`: exit 0, one reply per call. */
export function runShow(evidence: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const b = build();
  expect(b.error, 'deep-show builds with --no-default-features --features full').toBe('');
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const run = spawnSync(b.bin, args, { cwd: REPO, input: `${JSON.stringify({ evidence, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const what = `deep-show ${args.join(' ')}`;
  expect(run.error, `${what} ran and finished within its timeout`).toBeUndefined();
  expect(run.status, `${what} exits 0 (signal ${run.signal ?? 'none'}); stdout: ${run.stdout.slice(0, 1500)}; stderr: ${run.stderr.slice(-1500)}`).toBe(0);
  const lines = run.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: its reply`);
  expect(out['ok'], `${what} took the scenario: ${show(out)}`).toBe(true);
  const replies = out['replies'];
  expect(Array.isArray(replies) && replies.length === calls.length, `${what}: one reply per call, got ${show(replies)}`).toBe(true);
  return (replies as JsonValue[]).map((r, i) => obj(r, `${what}: replies[${i}] (to ${show(calls[i]).slice(0, 160)})`));
}

export const SANDBOX: JsonObject = { call: 'sandbox' };
export const installPack = (p: PackDir): JsonObject => ({ call: 'install_pack', id: p.id, dir: p.dir });
/** The check-time validation of one data asset in a layout (README: `validate`). */
export const validate = (layout: string, path: string): JsonObject => ({ call: 'validate', layout, path });
export const runsOf = (reply: JsonObject): number => {
  expect(typeof reply['runs'], `sandbox counts carry runs: ${show(reply)}`).toBe('number');
  return reply['runs'] as number;
};

/** A `validate` reply, every field read as the README names it. */
export interface Verdict {
  layout: JsonValue; asset: JsonValue; size: JsonValue; outcome: JsonValue; code: JsonValue;
  offset: JsonValue; field: JsonValue; trap: JsonValue; max_bytes: JsonValue;
}
export function verdict(reply: JsonObject): Verdict {
  const keys = ['layout', 'asset', 'size', 'outcome', 'code', 'offset', 'field', 'trap', 'max_bytes'] as const;
  for (const k of keys) expect(k in reply, `the validate reply carries ${k}: ${show(reply)}`).toBe(true);
  return Object.fromEntries(keys.map((k) => [k, reply[k]!])) as unknown as Verdict;
}

/** A fresh folder per test (evidence store, packs, assets), deleted after it. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-415-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export interface Asset { path: string; sha: string; size: number }
export function writeAsset(dir: string, name: string, bytes: Buffer): Asset {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return { path, sha: sha256(bytes), size: bytes.length };
}

// ---------------------------------------------------------------------------------------------------
// A pack with one layout (as #238's quadpack): pack.json listing its assets by sha256 and size.

export interface PackDir { id: string; version: string; dir: string }
export function writePack(root: string, manifest: JsonObject, assets: Record<string, Buffer>): { pack: PackDir; sha: Record<string, string> } {
  const name = String(manifest['name']);
  const version = String(manifest['version']);
  const dir = join(root, `${name}-${version}`);
  mkdirSync(dir, { recursive: true });
  const sha: Record<string, string> = {};
  const listed: JsonObject[] = [];
  for (const [path, bytes] of Object.entries(assets)) {
    writeFileSync(join(dir, path), bytes);
    sha[path] = sha256(bytes);
    listed.push({ path, sha256: sha[path]!, size: bytes.length, license: 'MIT' });
  }
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({ ...manifest, assets: listed }, null, 2)}\n`);
  return { pack: { id: `test/${name}`, version, dir }, sha };
}

/**
 * The validator of `oobpack.oob@1` (README: Packs), hand-assembled: exports `memory` (one page, max one),
 * the immutable global `in_at` = 1024 and `validate(len: i64) → i64`, whose body is
 * `i32.const -16; i64.load align=3; end`: a load at 0xFFFFFFF0, past any memory a validator may hold, so every
 * run traps `bounds` at that load. Checked with Node's own `WebAssembly.validate` when written.
 */
export function oobValidator(): { bytes: Buffer; loadAt: number } {
  const sec = (id: number, body: number[]): number[] => [id, body.length, ...body];
  const name = (s: string): number[] => [s.length, ...Buffer.from(s, 'latin1')];
  const head = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const parts = [
    head,
    sec(1, [1, 0x60, 1, 0x7e, 1, 0x7e]), // (i64) -> i64
    sec(3, [1, 0]),
    sec(5, [1, 1, 1, 1]), // memory min 1 max 1
    sec(6, [1, 0x7f, 0, 0x41, 0x80, 0x08, 0x0b]), // global i32 const 1024
    sec(7, [3, ...name('memory'), 2, 0, ...name('in_at'), 3, 0, ...name('validate'), 0, 0]),
  ];
  const before = parts.reduce((n, p) => n + p.length, 0);
  const body = [0, 0x41, 0x70, 0x29, 0x03, 0x00, 0x0b];
  parts.push(sec(10, [1, body.length, ...body]));
  const bytes = Buffer.from(parts.flat());
  expect(WebAssembly.validate(bytes), 'the hand-assembled validator is a valid WebAssembly module').toBe(true);
  // code section id and size, body count, body size, local decl count, i32.const and its one-byte immediate
  return { bytes, loadAt: before + 2 + 1 + 1 + 1 + 2 };
}

// ---------------------------------------------------------------------------------------------------
// Byte layouts (README: Byte layouts), little-endian. Each builder returns the bytes and every field's offset
// by the name a refusal gives it, so a test reads the expected field and offset off the bytes it wrote.

type Field = { offset: number };
class Writer {
  private chunks: Buffer[] = [];
  private at = 0;
  readonly fields: Record<string, Field> = {};
  private put(name: string | null, b: Buffer): void {
    if (name) this.fields[name] = { offset: this.at };
    this.chunks.push(b);
    this.at += b.length;
  }
  u8(name: string | null, v: number): void { const b = Buffer.alloc(1); b.writeUInt8(v); this.put(name, b); }
  u16(name: string | null, v: number): void { const b = Buffer.alloc(2); b.writeUInt16LE(v); this.put(name, b); }
  u32(name: string | null, v: number): void { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); this.put(name, b); }
  i32(name: string | null, v: number): void { const b = Buffer.alloc(4); b.writeInt32LE(v); this.put(name, b); }
  f32(name: string | null, v: number): void { const b = Buffer.alloc(4); b.writeFloatLE(v); this.put(name, b); }
  f64(name: string | null, v: number): void { const b = Buffer.alloc(8); b.writeDoubleLE(v); this.put(name, b); }
  raw(name: string | null, b: Buffer): void { this.put(name, b); }
  done(): Built { return { bytes: Buffer.concat(this.chunks), fields: this.fields }; }
}
export interface Built { bytes: Buffer; fields: Record<string, Field> }
export const offsetOf = (b: Built, field: string): number => {
  const f = b.fields[field];
  if (!f) throw Error(`the builder wrote no field ${field}`);
  return f.offset;
};
/** A copy of `b`'s bytes with `field` overwritten by `write(buffer, offset)`. */
export function mutate(b: Built, field: string, write: (buf: Buffer, at: number) => void): Buffer {
  const out = Buffer.from(b.bytes);
  write(out, offsetOf(b, field));
  return out;
}

/** nav.graph@1/@2's polygon vertex cap (README: nav.graph@1). */
export const NAV_VERTEX_CAP = 32;
export const NAV_HEADER_COUNTS = { node_count: 64, link_count: 68 } as const;
const KIND = { walk: 0, jump: 1, drop: 2, wall: 3 } as const;
interface NavNode { floor: number; polygon: [number, number, number][]; tags: number }
interface NavLink { a: number; b: number; cost: number; rise: number; kind: keyof typeof KIND; face?: { shape: number; face: number } }
/**
 * The fixture level's graph (README: The fixture level): mesh form, five convex polygons on floors 0 to 3 m
 * and six links sorted by (a, b): four walks, a jump from 2 up to 3 and a wall link from 3 up to 4 on box 7's
 * face 2 (+y). In nav.graph@2 it carries three tags; their bits lie in 0..2.
 */
export const LEVEL: { nodes: NavNode[]; links: NavLink[]; tags: string[] } = {
  tags: ['near_drop', 'inside', 'spawn'],
  nodes: [
    { floor: 0, tags: 0b100, polygon: [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]] },
    { floor: 0, tags: 0b000, polygon: [[2, 0, 0], [4, 0, 0], [4, 0, 2]] },
    { floor: 0.5, tags: 0b001, polygon: [[4, 0.5, 0], [6, 0.5, 0], [6, 0.5, 2], [4, 0.5, 2]] },
    { floor: 1.5, tags: 0b011, polygon: [[6, 1.5, 0], [8, 1.5, 0], [9, 1.5, 1], [8, 1.5, 2], [6, 1.5, 2]] },
    { floor: 3, tags: 0b000, polygon: [[9, 3, 0], [11, 3, 0], [11, 3, 2], [9, 3, 2]] },
  ],
  links: [
    { a: 0, b: 1, cost: 2, rise: 0, kind: 'walk' },
    { a: 1, b: 0, cost: 2, rise: 0, kind: 'walk' },
    { a: 1, b: 2, cost: 2.25, rise: 0.5, kind: 'walk' },
    { a: 2, b: 1, cost: 2.25, rise: -0.5, kind: 'walk' },
    { a: 2, b: 3, cost: 2, rise: 1, kind: 'jump' },
    { a: 3, b: 4, cost: 1.75, rise: 1.5, kind: 'wall', face: { shape: 7, face: 2 } },
  ],
};
/** The fixture level's graph in nav.graph@`version`'s bytes (README: nav.graph@1, nav.graph@2). */
export function navGraph(version: 1 | 2): Built {
  const w = new Writer();
  w.raw('header.magic', Buffer.from('NAVG', 'latin1'));
  w.u32('header.version', version);
  w.u32('header.form', 1); // mesh
  w.f32('header.capsule.radius', 0.3);
  w.f32('header.capsule.height', 1.8);
  w.f32('header.climb', 0.4);
  w.f32('header.slope', 45);
  w.f32('header.cell', 0.1);
  w.raw('header.source', createHash('sha256').update('the #415 fixture level').digest());
  w.u32('header.node_count', LEVEL.nodes.length);
  w.u32('header.link_count', LEVEL.links.length);
  if (version === 2) {
    w.u32('header.tag_count', LEVEL.tags.length);
    LEVEL.tags.forEach((t, i) => { const b = Buffer.alloc(32); b.write(t, 'utf8'); w.raw(`tags[${i}]`, b); });
  }
  LEVEL.nodes.forEach((n, i) => {
    w.f32(`nodes[${i}].floor`, n.floor);
    w.u32(`nodes[${i}].vertex_count`, n.polygon.length);
    n.polygon.forEach((v, j) => { v.forEach((c, k) => w.f32(k === 0 ? `nodes[${i}].polygon[${j}]` : null, c)); });
    if (version === 2) w.u32(`nodes[${i}].tags`, n.tags);
  });
  LEVEL.links.forEach((l, i) => {
    w.u32(`links[${i}].a`, l.a);
    w.u32(`links[${i}].b`, l.b);
    w.f32(`links[${i}].cost`, l.cost);
    w.f32(`links[${i}].rise`, l.rise);
    if (version === 2) {
      w.u8(`links[${i}].kind`, KIND[l.kind]);
      w.u8(`links[${i}].face`, l.face?.face ?? 0);
      w.u16(`links[${i}].reserved`, 0);
      w.u32(`links[${i}].shape`, l.face?.shape ?? 0);
    }
  });
  return w.done();
}

/** A function table in fn.table@1's bytes (README: fn.table@1), mode linear. */
export function fnTable(x: number[], y: number[]): Built {
  const w = new Writer();
  w.raw('header.magic', Buffer.from('FTAB', 'latin1'));
  w.u32('header.version', 1);
  w.u32('header.mode', 0);
  w.u32('header.count', x.length);
  x.forEach((v, i) => w.f64(`x[${i}]`, v));
  y.forEach((v, i) => w.f64(`y[${i}]`, v));
  return w.done();
}

/** pages@1 (README: pages@1): a 12-byte header, then per page its number as a u32 and its 64 KiB. */
export const PAGE = 65_536;
export const PAGES_HEADER = 12;
export const PAGES_CAP = 4_096;
/** pages@1's own max_bytes: a header and 4,096 pages. */
export const PAGES_MAX_BYTES = PAGES_HEADER + PAGES_CAP * (4 + PAGE);
export const PACK_LAYOUT_CAP = 64 * MIB;
export const pageOffset = (i: number): number => PAGES_HEADER + i * (4 + PAGE);
/**
 * Writes a pages@1 asset whose pages carry `numbers`, streamed a page at a time so a 256 MiB asset never sits
 * in memory whole; each page's 64 KiB holds its number in its first four bytes and zeros after.
 */
export function writePages(dir: string, name: string, numbers: number[]): Asset {
  const path = join(dir, name);
  const fd = openSync(path, 'w');
  const hash: Hash = createHash('sha256');
  let size = 0;
  const put = (b: Buffer): void => { writeSync(fd, b); hash.update(b); size += b.length; };
  try {
    const head = Buffer.alloc(PAGES_HEADER);
    head.write('PAGS', 0, 'latin1');
    head.writeUInt32LE(1, 4);
    head.writeUInt32LE(numbers.length, 8);
    put(head);
    const page = Buffer.alloc(4 + PAGE);
    for (const n of numbers) {
      page.writeUInt32LE(n >>> 0, 0);
      page.writeUInt32LE(n >>> 0, 4);
      put(page);
    }
  } finally {
    closeSync(fd);
  }
  return { path, sha: hash.digest('hex'), size };
}

/** A seeded generator (mulberry32), so the 10,000 mutations are the same on every run. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
