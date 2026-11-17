// This suite's providers, packs and documents (README: Fixtures), every expected value from the issue: a 32 × 32 × 32
// occupancy grid holding one solid 10 × 10 × 10 block, meshed one quad per exposed voxel face into 600 quads (1,200
// triangles). Each program is WebAssembly text assembled by #238's assembler (tests/acceptance/238/wat; helpers.ts), and
// keeps to the one subset: one memory whose maximum is its minimum, no imports (but the importing provider), the
// exports `memory`, `gen(seed: i64) → i32` and the immutable globals `params_at`, `assets_at` and `out_at`.

import { expect } from 'vitest';
import {
  assemble, decodeMesh, keep, openEdges, paramBytes, runInNode, sha256, writePack,
  type Fixture, type JsonObject, type OpenEdge, type PackDir, type ParamSpec,
} from './helpers.ts';

// ---------------------------------------------------------------------------------------------------
// The grid and the block.

export const N = 32;
/** The solid block, in voxels: x in [3, 13), y in [11, 21), z in [19, 29), off centre so a swapped axis shows. */
export const BLOCK = { lo: [3, 11, 19], hi: [13, 21, 29] } as const;
/** One byte a voxel, x fastest, then y, then z (index x + 32 × (y + 32 × z)); 1 is solid. */
export function grid(): Buffer {
  const g = Buffer.alloc(N * N * N);
  for (let z = BLOCK.lo[2]; z < BLOCK.hi[2]; z++) for (let y = BLOCK.lo[1]; y < BLOCK.hi[1]; y++) for (let x = BLOCK.lo[0]; x < BLOCK.hi[0]; x++) g[x + N * (y + N * z)] = 1;
  return g;
}
/** The block's bounds in metres at voxel edge `size`: [[min x, y, z], [max x, y, z]]. */
export const blockBounds = (size: number): number[][] => [BLOCK.lo.map((v) => v * size), BLOCK.hi.map((v) => v * size)];
export const QUADS = 600;
export const TRIANGLES = 1200;
/** Voxel edge lengths the documents give, each exact in binary, none the schema's default nor a range end. */
export const SIZE = { first: 0.25, changed: 0.375, constant: 0.125 } as const;

// ---------------------------------------------------------------------------------------------------
// The voxel mesher and its planted twin.

const PARAMS_AT = 16;
const TABLE_AT = 256;
const ASSETS_AT = 1024;
const OUT_AT = 65536;
/** Each face: its outward normal (i8 × 3, a pad byte), then its four corners as voxel offsets (u8 × 3 each), wound
 * counter-clockwise seen from outside, so (c1 − c0) × (c2 − c0) points along the normal. Order: −x, +x, −y, +y, −z, +z. */
const FACES: [number[], number[][]][] = [
  [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
  [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
];
const escaped = (bytes: Buffer): string => [...bytes].map((b) => `\\${b.toString(16).padStart(2, '0')}`).join('');
const faceTable = (): string => escaped(Buffer.from(FACES.flatMap(([n, cs]) => [...n.map((x) => x & 0xff), 0, ...cs.flat()])));

/**
 * The voxel mesher: reads its grid, an asset of 32,768 bytes copied in after its u32 length at `assets_at` (it
 * traps `unreachable` when that length is anything else), and its one param `size` (f64, metres) at `params_at`;
 * counts the exposed faces F of the solid voxels (a face whose neighbour is empty or outside the grid), then writes
 * at `out_at` a mesh of 4F vertices and 6F indices: per face, its four corners × size, its normal, uv0 (0,0) (1,0)
 * (1,1) (0,1), and the triangles (0, 1, 2) and (0, 2, 3) of its corners. Returns 0. With `skipFirst` (the planted
 * twin) it leaves out the first exposed face it meets, in z, y, x, face order, and writes the rest.
 */
function mesherText(skipFirst: boolean): string {
  const store3 = (addr: string, value: (k: number) => string): string =>
    [0, 1, 2].map((k) => `(f32.store offset=${4 * k} ${addr} ${value(k)})`).join('\n      ');
  const axis = ['$x', '$y', '$z'];
  return `(module
  (memory (export "memory") 4 4)
  (global (export "params_at") i32 (i32.const ${PARAMS_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  (global (export "out_at") i32 (i32.const ${OUT_AT}))
  (data (i32.const ${TABLE_AT}) "${faceTable()}")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (local $faces i32)
    (if (i32.ne (i32.load (i32.const ${ASSETS_AT})) (i32.const ${N * N * N})) (then (unreachable)))
    (local.set $faces (call $pass (i32.const 0) (i32.const 0)))
    (i32.store (i32.const ${OUT_AT}) (i32.shl (local.get $faces) (i32.const 2)))
    (i32.store (i32.const ${OUT_AT + 4}) (i32.mul (local.get $faces) (i32.const 6)))
    (drop (call $pass (i32.const 1) (local.get $faces)))
    (i32.const 0))
  ;; 1 when (x, y, z) is inside the grid and solid
  (func $solid (param $x i32) (param $y i32) (param $z i32) (result i32)
    (if (i32.or (i32.or (i32.ge_u (local.get $x) (i32.const ${N})) (i32.ge_u (local.get $y) (i32.const ${N}))) (i32.ge_u (local.get $z) (i32.const ${N})))
      (then (return (i32.const 0))))
    (i32.ne (i32.load8_u offset=${ASSETS_AT + 4}
      (i32.add (local.get $x) (i32.mul (i32.const ${N}) (i32.add (local.get $y) (i32.mul (i32.const ${N}) (local.get $z)))))) (i32.const 0)))
  ;; counts (write 0) or writes (write 1, of faces in all) the exposed faces; returns how many it took
  (func $pass (param $write i32) (param $faces i32) (result i32)
    (local $x i32) (local $y i32) (local $z i32) (local $d i32) (local $t i32) (local $seen i32) (local $k i32)
    (loop $zl
      (local.set $y (i32.const 0))
      (loop $yl
        (local.set $x (i32.const 0))
        (loop $xl
          (if (call $solid (local.get $x) (local.get $y) (local.get $z))
            (then
              (local.set $d (i32.const 0))
              (loop $dl
                (local.set $t (i32.add (i32.const ${TABLE_AT}) (i32.shl (local.get $d) (i32.const 4))))
                (if (i32.eqz (call $solid
                      (i32.add (local.get $x) (i32.load8_s (local.get $t)))
                      (i32.add (local.get $y) (i32.load8_s offset=1 (local.get $t)))
                      (i32.add (local.get $z) (i32.load8_s offset=2 (local.get $t)))))
                  (then
                    (if (i32.eqz (i32.and (i32.const ${skipFirst ? 1 : 0}) (i32.eqz (local.get $seen))))
                      (then
                        (if (local.get $write)
                          (then (call $quad (local.get $k) (local.get $faces) (local.get $x) (local.get $y) (local.get $z) (local.get $t))))
                        (local.set $k (i32.add (local.get $k) (i32.const 1)))))
                    (local.set $seen (i32.add (local.get $seen) (i32.const 1)))))
                (local.set $d (i32.add (local.get $d) (i32.const 1)))
                (br_if $dl (i32.lt_u (local.get $d) (i32.const 6))))))
          (local.set $x (i32.add (local.get $x) (i32.const 1)))
          (br_if $xl (i32.lt_u (local.get $x) (i32.const ${N}))))
        (local.set $y (i32.add (local.get $y) (i32.const 1)))
        (br_if $yl (i32.lt_u (local.get $y) (i32.const ${N}))))
      (local.set $z (i32.add (local.get $z) (i32.const 1)))
      (br_if $zl (i32.lt_u (local.get $z) (i32.const ${N}))))
    (local.get $k))
  ;; quad k of faces in all: voxel (x, y, z), its face's table entry at t
  (func $quad (param $k i32) (param $faces i32) (param $x i32) (param $y i32) (param $z i32) (param $t i32)
    (local $n i32) (local $nn i32) (local $uv i32) (local $ix i32) (local $c i32) (local $v i32) (local $o i32) (local $s f64)
    (local.set $n (i32.shl (local.get $faces) (i32.const 2)))
    (local.set $nn (i32.add (i32.const ${OUT_AT + 8}) (i32.mul (local.get $n) (i32.const 12))))
    (local.set $uv (i32.add (local.get $nn) (i32.mul (local.get $n) (i32.const 12))))
    (local.set $ix (i32.add (local.get $uv) (i32.shl (local.get $n) (i32.const 3))))
    (local.set $s (f64.load (i32.const ${PARAMS_AT})))
    (loop $cl
      (local.set $v (i32.add (i32.shl (local.get $k) (i32.const 2)) (local.get $c)))
      (local.set $o (i32.add (i32.add (local.get $t) (i32.const 4)) (i32.mul (local.get $c) (i32.const 3))))
      ${store3('(i32.add (i32.const ' + (OUT_AT + 8) + ') (i32.mul (local.get $v) (i32.const 12)))', (k) => `(f32.demote_f64 (f64.mul (f64.convert_i32_s (i32.add (local.get ${axis[k]}) (i32.load8_u offset=${k} (local.get $o)))) (local.get $s)))`)}
      ${store3('(i32.add (local.get $nn) (i32.mul (local.get $v) (i32.const 12)))', (k) => `(f32.convert_i32_s (i32.load8_s offset=${k} (local.get $t)))`)}
      (f32.store (i32.add (local.get $uv) (i32.shl (local.get $v) (i32.const 3)))
        (f32.convert_i32_u (i32.or (i32.eq (local.get $c) (i32.const 1)) (i32.eq (local.get $c) (i32.const 2)))))
      (f32.store offset=4 (i32.add (local.get $uv) (i32.shl (local.get $v) (i32.const 3)))
        (f32.convert_i32_u (i32.ge_u (local.get $c) (i32.const 2))))
      (local.set $c (i32.add (local.get $c) (i32.const 1)))
      (br_if $cl (i32.lt_u (local.get $c) (i32.const 4))))
    (local.set $v (i32.shl (local.get $k) (i32.const 2)))
    (local.set $o (i32.add (local.get $ix) (i32.mul (local.get $k) (i32.const 24))))
    (i32.store (local.get $o) (local.get $v))
    (i32.store offset=4 (local.get $o) (i32.add (local.get $v) (i32.const 1)))
    (i32.store offset=8 (local.get $o) (i32.add (local.get $v) (i32.const 2)))
    (i32.store offset=12 (local.get $o) (local.get $v))
    (i32.store offset=16 (local.get $o) (i32.add (local.get $v) (i32.const 2)))
    (i32.store offset=20 (local.get $o) (i32.add (local.get $v) (i32.const 3)))))`;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3's providers: a tetrahedron writer with a fault param, and a provider that imports a function.

const TETRA_OUT = 4096;
/** A unit tetrahedron, flat shaded: 4 faces wound outward, 12 vertices; with `extra`, a 13th (a copy of the first). */
function tetraBytes(extra: boolean): Buffer {
  const A = [0, 0, 0], B = [1, 0, 0], C = [0, 1, 0], D = [0, 0, 1];
  const s = 1 / Math.sqrt(3);
  const faces: [number[][], number[]][] = [[[A, C, B], [0, 0, -1]], [[A, B, D], [0, -1, 0]], [[A, D, C], [-1, 0, 0]], [[B, C, D], [s, s, s]]];
  const positions = faces.flatMap(([vs]) => vs);
  const normals = faces.flatMap(([vs, n]) => vs.map(() => n));
  if (extra) { positions.push(positions[0]!); normals.push(normals[0]!); }
  const n = positions.length;
  const b = Buffer.alloc(8 + 32 * n + 4 * 12);
  b.writeUInt32LE(n, 0);
  b.writeUInt32LE(12, 4);
  let p = 8;
  for (const v of [...positions, ...normals]) for (const x of v) { b.writeFloatLE(x, p); p += 4; }
  p += 8 * n;
  for (let i = 0; i < 12; i++) { b.writeUInt32LE(i, p); p += 4; }
  return b;
}
/**
 * The fault provider: its one param `fault` (an integer, i64 at `params_at`) picks what `gen` does. 0 (the default),
 * or any value but 1 and 2: it copies the 12-vertex tetrahedron to `out_at`. 1: the same mesh with a 13th vertex, one
 * past its `max_vertices` of 12. 2: an endless loop. So its pack's check, run at the param's range ends (0 and 3)
 * and at its default, meets neither fault, and only a document that gives 1 or 2 does.
 */
function tetraText(): string {
  const plain = tetraBytes(false), extra = tetraBytes(true);
  return `(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const ${PARAMS_AT}))
  (global (export "assets_at") i32 (i32.const 64))
  (global (export "out_at") i32 (i32.const ${TETRA_OUT}))
  (data (i32.const 8192) "${escaped(plain)}")
  (data (i32.const 12288) "${escaped(extra)}")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (local $fault i64)
    (local.set $fault (i64.load (i32.const ${PARAMS_AT})))
    (if (i64.eq (local.get $fault) (i64.const 2)) (then (loop $forever (br $forever))))
    (if (i64.eq (local.get $fault) (i64.const 1))
      (then (memory.copy (i32.const ${TETRA_OUT}) (i32.const 12288) (i32.const ${extra.length})))
      (else (memory.copy (i32.const ${TETRA_OUT}) (i32.const 8192) (i32.const ${plain.length}))))
    (i32.const 0)))`;
}
/** The importing provider: it imports `env.now` and stores its value at `out_at`. */
const clockText = (): string => `(module
  (import "env" "now" (func $now (result i64)))
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const ${PARAMS_AT}))
  (global (export "assets_at") i32 (i32.const 64))
  (global (export "out_at") i32 (i32.const ${TETRA_OUT}))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (i64.store (i32.const ${TETRA_OUT + 8}) (call $now))
    (i32.const 0)))`;
/** The import criterion 3's refusal names. */
export const IMPORT = { module: 'env', name: 'now' } as const;

/** Criterion 4's logic item: every step writes 0.25 to its one array, `grain` (f64). */
const grainText = (): string => `(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (f64.store (i32.const 4096) (f64.const 0.25))))`;

const assembled = new Map<string, Fixture>();
const once = (name: string, text: () => string): Fixture => {
  let fx = assembled.get(name);
  if (!fx) { fx = assemble(name, text()); assembled.set(name, fx); }
  return fx;
};
export const mesher = (): Fixture => once('voxel_mesher', () => mesherText(false));
export const holeyMesher = (): Fixture => once('voxel_mesher_holey', () => mesherText(true));
export const tetra = (): Fixture => once('tetra_faults', tetraText);
export const clock = (): Fixture => once('clock_import', clockText);
export const grainLogic = (): Fixture => once('grain_logic', grainText);

// ---------------------------------------------------------------------------------------------------
// The packs (README: Packs), each an outside pack written per test.

export const SIZE_PARAM: ParamSpec = { type: 'f64', unit: 'm', default: 0.5, range: [0.0625, 1] };
export const FAULT_PARAM: ParamSpec = { type: 'i32', unit: '', default: 0, range: [0, 3] };
const REQUIRES = { core: '>=0.0.0', modules: { sandbox: '>=0.0.0' } };
const pack = (root: string, name: string, about: string, providers: JsonObject, assets: Record<string, Buffer>): PackDir =>
  writePack(root, { name, version: '1.0.0', license: 'MIT', description: `A test pack of the #192 voxel acceptance suite: ${about}`, requires: REQUIRES, providers }, assets);
const meshProvider = (program: Fixture, params: Record<string, ParamSpec>, out: JsonObject, assets: Buffer[] = []): JsonObject =>
  ({ program: sha256(program.bytes), params: params as unknown as JsonObject, ...(assets.length ? { assets: assets.map((a) => sha256(a)) } : {}), out: { mesh: out } });

/** test/voxpack@1.0.0: `voxpack.mesher`, the voxel mesher over the grid asset, a closed mesh of at most 2,400 vertices. */
export const voxPack = (root: string): PackDir => pack(root, 'voxpack', 'a voxel mesher over a 32 × 32 × 32 grid asset.',
  { mesher: meshProvider(mesher(), { size: SIZE_PARAM }, { max_vertices: 4 * QUADS, closed: true }, [grid()]) },
  { 'mesher.wasm': mesher().bytes, 'grid.bin': grid() });
/** test/holeypack@1.0.0 (planted): `holeypack.holey`, the mesher that leaves one face out, declared closed. */
export const holeyPack = (root: string): PackDir => pack(root, 'holeypack', 'a planted voxel mesher that leaves one face out.',
  { holey: meshProvider(holeyMesher(), { size: SIZE_PARAM }, { max_vertices: 4 * QUADS, closed: true }, [grid()]) },
  { 'holey.wasm': holeyMesher().bytes, 'grid.bin': grid() });
/** test/faultpack@1.0.0: `faultpack.overcap` and `faultpack.spin`, two entries of the fault provider, at most 12 vertices. */
export const faultPack = (root: string): PackDir => pack(root, 'faultpack', 'a tetrahedron writer whose fault param writes past its cap or loops.',
  { overcap: meshProvider(tetra(), { fault: FAULT_PARAM }, { max_vertices: 12, closed: false }), spin: meshProvider(tetra(), { fault: FAULT_PARAM }, { max_vertices: 12, closed: false }) },
  { 'tetra.wasm': tetra().bytes });
/** test/importpack@1.0.0: `importpack.clock`, whose program imports `env.now`. */
export const importPack = (root: string): PackDir => pack(root, 'importpack', 'a provider whose program imports a function.',
  { clock: meshProvider(clock(), {}, { max_vertices: 12, closed: false }) },
  { 'clock.wasm': clock().bytes });

// ---------------------------------------------------------------------------------------------------
// Documents: a board naming a provider's mesh through #238's test kind `test.mesh@1`.

export const meshItem = (id: string, gen: string, params: JsonObject): JsonObject =>
  ({ id, kind: 'test.mesh@1', name: `Mesh ${id}`, order: 'a0', params: { mesh: { gen, params } } });
export const rect = (id: string, box: number[], order: string): JsonObject =>
  ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role: 'muted' } } } });
export function board(title: string, packs: string[], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  const modules = { 'test.mesh': '^1', ...(isObjectLike(extra['requires']) ? (extra['requires'] as { modules?: JsonObject }).modules : {}) };
  return {
    format: 1, profile: 'board', title, description: `${title}, a board of the #192 voxel acceptance suite.`, size: [640, 360],
    packs, ...extra, requires: { modules }, items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}
const isObjectLike = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The voxel document: the mesher's mesh at voxel edge `size`, under the document's `seed`. */
export const voxelDoc = (size: number, seed: number, extra: JsonObject = {}): JsonObject =>
  board('Voxels', ['test/voxpack@1.0.0'], [meshItem('vox', 'voxpack.mesher', { size })], { seed, ...extra });
/** A rect whose x a channel moves from 20 to 400 px over 60 s, so every frame of a 60 s play differs. */
export const MOVING: JsonObject = {
  transport: { span: '60s' },
  channels: { slide: { target: 'items/mover/params/box/0', type: 'f32', keys: { k0: { t: '0s', value: 20, interp: 'linear' }, k1: { t: '60s', value: 400, interp: 'linear' } } } },
};
export const mover = (): JsonObject => rect('mover', [20, 40, 120, 80], 'b0');

// ---------------------------------------------------------------------------------------------------
// What the fixtures write, run in Node's WebAssembly with the README's params and assets layout. A fixture that
// doesn't write what its comment says fails here first, so it can't make a right program fail.

export interface Written { vertexCount: number; positions: number[][]; normals: number[][]; uv0: number[][]; indices: number[] }
export async function written(program: Fixture, schema: Record<string, ParamSpec>, given: Record<string, number>, assets: Buffer[]): Promise<Written> {
  const r = await runInNode(program.bytes, paramBytes(schema, given), assets, 0n);
  expect(r.result, `fixture ${program.name}: gen returns 0`).toBe(0);
  return decodeMesh(r.memory, r.outAt);
}
/** The mesher's output at `size`, checked to be what criterion 1 asks: 600 quads, closed, the block's bounds. */
export async function mesherOutput(size: number): Promise<Written> {
  const w = await written(mesher(), { size: SIZE_PARAM }, { size }, [grid()]);
  expect([w.vertexCount, w.indices.length], `fixture voxel_mesher at size ${size}: 600 quads as 2,400 vertices and 3,600 indices`).toEqual([4 * QUADS, 3 * TRIANGLES]);
  expect(openEdges(w.positions, w.indices), `fixture voxel_mesher at size ${size}: closed (every welded edge joins two faces)`).toEqual([]);
  const lo = [0, 1, 2].map((k) => Math.min(...w.positions.map((p) => p[k]!)));
  const hi = [0, 1, 2].map((k) => Math.max(...w.positions.map((p) => p[k]!)));
  expect([lo, hi], `fixture voxel_mesher at size ${size}: the block's bounds`).toEqual(blockBounds(size));
  return w;
}
/** The planted mesher's open edges at `size`: the four sides of the one face it leaves out. */
export async function holeyOpenEdges(size: number): Promise<OpenEdge[]> {
  const w = await written(holeyMesher(), { size: SIZE_PARAM }, { size }, [grid()]);
  expect([w.vertexCount, w.indices.length], 'fixture voxel_mesher_holey: 599 quads').toEqual([4 * (QUADS - 1), 6 * (QUADS - 1)]);
  const open = openEdges(w.positions, w.indices);
  expect(open.map((e) => e.faces), 'fixture voxel_mesher_holey: the left-out face leaves four edges with one face each').toEqual([1, 1, 1, 1]);
  return open;
}
/** The fault provider at `fault` 0 and 1: 12 and 13 vertices (2 loops, so it isn't run here). */
export async function tetraVertexCounts(): Promise<number[]> {
  const counts: number[] = [];
  for (const fault of [0, 1]) counts.push((await written(tetra(), { fault: FAULT_PARAM }, { fault }, [])).vertexCount);
  const plain = await written(tetra(), { fault: FAULT_PARAM }, {}, []);
  expect(openEdges(plain.positions, plain.indices), 'fixture tetra_faults: its tetrahedron is closed').toEqual([]);
  return counts;
}
/** Keeps criterion 4's logic program in the evidence store and returns its sha256. */
export const keepGrainLogic = (evidence: string): string => keep(evidence, grainLogic().bytes);
