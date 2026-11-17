// This suite's programs as WebAssembly text (README: Programs), each a function of what it needs to know, and nothing
// else: no test tooling is imported here, so the text can be checked on its own. Every program is this job's fixture,
// written from the issue and the design; none is the implementation's.
//
// The provider layouts are the coordinated ones (README: The surface): params at `params_at`, each 8 bytes in the
// order of the param names sorted by byte (integers as i64, floats as f64); assets at `assets_at`, each a u32 length
// then its bytes, a `mesh_in` mesh after them; the output at `out_at`, a data asset as a u32 length then its bytes,
// a mesh as `u32 vertex_count, u32 index_count, f32 positions[3n], f32 normals[3n], f32 uv0[2n], u32 indices[]`.

/** WebAssembly text's string of these bytes. */
export const dataText = (b: Uint8Array): string =>
  Array.from(b, (x) => (x >= 0x20 && x < 0x7f && x !== 0x22 && x !== 0x5c ? String.fromCharCode(x) : `\\${x.toString(16).padStart(2, '0')}`)).join('');

// ---------------------------------------------------------------------------------------------------
// The dungeon generator (criteria 5 and 8): one source, built as a provider and as its library form.

/** Where the provider form keeps its params and writes its output (its own immutable globals). */
export const DUNGEON = { params_at: 1024, assets_at: 2048, out_at: 4096 } as const;
/** The rounds of mixing one room costs: about 34 fuel each (each block its instruction count: 340,164 a room at the base), so a floor of 6 to 12 rooms is 2 to 4 million fuel, past one logic step's default 1,000,000. */
export const ROOM_WORK = 10_000;

/**
 * The generator's shared source: helper functions and `share(seed, params_at, out_at) → i32`, which does one share of a
 * floor's work per call and returns the shares left (0 once the output is whole). Its progress is the output's own
 * length word at out_at: 0 before the first share. The params are floor, height, width (sorted by name), each an i64.
 *
 * The tile graph it writes (layout `<pack>.tiles@1`, README: The surface), little-endian: `u32 width, u32 height, u32
 * node_count n`, then n nodes `{u16 x, u16 y, u16 w, u16 h}` (rooms, each inside the floor's border), then n links
 * `{u16 a, u16 b}` (node i to node i + 1 mod n, a ring): 12 + 12n bytes. Share 0 writes the header (n is 6 to 12,
 * from hash(seed, floor)); share 1 + i writes room i (from hash(seed, floor, i), ROOM_WORK rounds); share n + 1 the
 * links. `planted`: the wrong library form of criterion 8, which seeds each share from its step (the share's number)
 * instead of the seed it is given.
 */
function generator(fn: string, planted: boolean): string {
  const seedOf = (step: string): string => (planted ? `(i64.extend_i32_u ${step})` : '(local.get $seed)');
  return `
  (func $mix (param $x i64) (result i64) (local $z i64)
    (local.set $z (i64.add (local.get $x) (i64.const 0x9E3779B97F4A7C15)))
    (local.set $z (i64.mul (i64.xor (local.get $z) (i64.shr_u (local.get $z) (i64.const 30))) (i64.const 0xBF58476D1CE4E5B9)))
    (local.set $z (i64.mul (i64.xor (local.get $z) (i64.shr_u (local.get $z) (i64.const 27))) (i64.const 0x94D049BB133111EB)))
    (i64.xor (local.get $z) (i64.shr_u (local.get $z) (i64.const 31))))
  (func $base (param $s i64) (param $p i32) (result i64)
    (i64.xor (local.get $s) (i64.mul (i64.load (local.get $p)) (i64.const 0x9E3779B97F4A7C15))))
  (func $room (param $base i64) (param $i i32) (result i64) (local $z i64) (local $k i32)
    (local.set $z (i64.xor (local.get $base) (call $mix (i64.extend_i32_u (i32.add (local.get $i) (i32.const 1))))))
    (local.set $k (i32.const ${ROOM_WORK}))
    (loop $again
      (local.set $z (call $mix (local.get $z)))
      (br_if $again (local.tee $k (i32.sub (local.get $k) (i32.const 1)))))
    (local.get $z))
  (func ${fn} (param $seed i64) (param $p i32) (param $o i32) (result i32)
    (local $len i32) (local $n i32) (local $i i32) (local $j i32) (local $width i32) (local $height i32)
    (local $r i64) (local $rw i32) (local $rh i32) (local $at i32)
    (local.set $height (i32.wrap_i64 (i64.load offset=8 (local.get $p))))
    (local.set $width (i32.wrap_i64 (i64.load offset=16 (local.get $p))))
    (local.set $len (i32.load (local.get $o)))
    (if (i32.eqz (local.get $len))
      (then
        (local.set $n (i32.add (i32.const 6)
          (i32.wrap_i64 (i64.rem_u (call $mix (call $base ${seedOf('(i32.const 0)')} (local.get $p))) (i64.const 7)))))
        (i32.store offset=4 (local.get $o) (local.get $width))
        (i32.store offset=8 (local.get $o) (local.get $height))
        (i32.store offset=12 (local.get $o) (local.get $n))
        (i32.store (local.get $o) (i32.const 12))
        (return (i32.add (local.get $n) (i32.const 1)))))
    (local.set $n (i32.load offset=12 (local.get $o)))
    (if (i32.lt_u (local.get $len) (i32.add (i32.const 12) (i32.shl (local.get $n) (i32.const 3))))
      (then
        (local.set $i (i32.shr_u (i32.sub (local.get $len) (i32.const 12)) (i32.const 3)))
        (local.set $r (call $room (call $base ${seedOf('(i32.add (local.get $i) (i32.const 1))')} (local.get $p)) (local.get $i)))
        (local.set $rw (i32.add (i32.const 3) (i32.rem_u (i32.and (i32.wrap_i64 (local.get $r)) (i32.const 255)) (i32.const 6))))
        (local.set $rh (i32.add (i32.const 3) (i32.rem_u (i32.and (i32.wrap_i64 (i64.shr_u (local.get $r) (i64.const 8))) (i32.const 255)) (i32.const 6))))
        (local.set $at (i32.add (i32.add (local.get $o) (i32.const 4)) (local.get $len)))
        (i32.store16 (local.get $at) (i32.add (i32.const 1)
          (i32.rem_u (i32.and (i32.wrap_i64 (i64.shr_u (local.get $r) (i64.const 16))) (i32.const 65535)) (i32.sub (i32.sub (local.get $width) (local.get $rw)) (i32.const 1)))))
        (i32.store16 offset=2 (local.get $at) (i32.add (i32.const 1)
          (i32.rem_u (i32.and (i32.wrap_i64 (i64.shr_u (local.get $r) (i64.const 32))) (i32.const 65535)) (i32.sub (i32.sub (local.get $height) (local.get $rh)) (i32.const 1)))))
        (i32.store16 offset=4 (local.get $at) (local.get $rw))
        (i32.store16 offset=6 (local.get $at) (local.get $rh))
        (i32.store (local.get $o) (i32.add (local.get $len) (i32.const 8)))
        (return (i32.sub (local.get $n) (local.get $i)))))
    (if (i32.eq (local.get $len) (i32.add (i32.const 12) (i32.shl (local.get $n) (i32.const 3))))
      (then
        (local.set $at (i32.add (i32.add (local.get $o) (i32.const 4)) (local.get $len)))
        (loop $link
          (i32.store16 (local.get $at) (local.get $j))
          (i32.store16 offset=2 (local.get $at) (i32.rem_u (i32.add (local.get $j) (i32.const 1)) (local.get $n)))
          (local.set $at (i32.add (local.get $at) (i32.const 4)))
          (br_if $link (i32.lt_u (local.tee $j (i32.add (local.get $j) (i32.const 1))) (local.get $n))))
        (i32.store (local.get $o) (i32.add (i32.const 12) (i32.mul (local.get $n) (i32.const 12))))))
    (i32.const 0))`;
}

/** The dungeon provider (gen@1): `gen(seed)` runs the generator's shares to the end on its own params and output. */
export const dungeonProvider = (): string => `
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const ${DUNGEON.params_at}))
  (global (export "assets_at") i32 (i32.const ${DUNGEON.assets_at}))
  (global (export "out_at") i32 (i32.const ${DUNGEON.out_at}))${generator('$share', false)}
  (func $gen (export "gen") (param $seed i64) (result i32)
    (loop $more
      (br_if $more (call $share (local.get $seed) (i32.const ${DUNGEON.params_at}) (i32.const ${DUNGEON.out_at}))))
    (i32.const 0)))`;

/**
 * The dungeon generator's library form (a relocatable object under `--library`): the same source, exporting
 * `gen(seed, params_at, out_at) → i32`, one share a call (README: The surface: the library form). `planted`: the
 * library form that seeds from the step (criterion 8's twin).
 */
export const dungeonLibrary = (planted = false): string => `
(module
  (import "env" "__linear_memory" (memory 0))${generator('$gen (export "gen")', planted)})`;

/** A tile graph's validator (layout `<pack>.tiles@1`): -1 when valid, else the first bad byte's offset. */
export const tilesValidator = (): string => `
(module
  (memory (export "memory") 1 1)
  (global (export "in_at") i32 (i32.const 1024))
  (func $validate (export "validate") (param $len64 i64) (result i64)
    (local $len i32) (local $w i32) (local $h i32) (local $n i32) (local $i i32) (local $at i32)
    (if (i64.lt_u (local.get $len64) (i64.const 12)) (then (return (i64.const 0))))
    (if (i64.gt_u (local.get $len64) (i64.const 65536)) (then (return (i64.const 0))))
    (local.set $len (i32.wrap_i64 (local.get $len64)))
    (local.set $w (i32.load (i32.const 1024)))
    (local.set $h (i32.load (i32.const 1028)))
    (local.set $n (i32.load (i32.const 1032)))
    (if (i32.eqz (local.get $w)) (then (return (i64.const 0))))
    (if (i32.eqz (local.get $h)) (then (return (i64.const 4))))
    (if (i32.or (i32.gt_u (local.get $n) (i32.const 4096))
          (i32.ne (local.get $len) (i32.add (i32.const 12) (i32.mul (local.get $n) (i32.const 12)))))
      (then (return (i64.const 8))))
    (local.set $at (i32.const 1036))
    (block $nodes
      (loop $node
        (br_if $nodes (i32.ge_u (local.get $i) (local.get $n)))
        (if (i32.or
              (i32.or (i32.eqz (i32.load16_u offset=4 (local.get $at))) (i32.eqz (i32.load16_u offset=6 (local.get $at))))
              (i32.or
                (i32.gt_u (i32.add (i32.load16_u (local.get $at)) (i32.load16_u offset=4 (local.get $at))) (local.get $w))
                (i32.gt_u (i32.add (i32.load16_u offset=2 (local.get $at)) (i32.load16_u offset=6 (local.get $at))) (local.get $h))))
          (then (return (i64.extend_i32_u (i32.sub (local.get $at) (i32.const 1024))))))
        (local.set $at (i32.add (local.get $at) (i32.const 8)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $node)))
    (local.set $i (i32.const 0))
    (block $links
      (loop $link
        (br_if $links (i32.ge_u (local.get $i) (local.get $n)))
        (if (i32.or (i32.ge_u (i32.load16_u (local.get $at)) (local.get $n)) (i32.ge_u (i32.load16_u offset=2 (local.get $at)) (local.get $n)))
          (then (return (i64.extend_i32_u (i32.sub (local.get $at) (i32.const 1024))))))
        (local.set $at (i32.add (local.get $at) (i32.const 4)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $link)))
    (i64.const -1)))`;

/** The layout's malformed twin: 40 × 40, 2 rooms, links (0, 1) and (1, 7): node 7 doesn't exist, bad at byte 32. */
export function tilesTwin(): Buffer {
  const b = Buffer.alloc(36);
  b.writeUInt32LE(40, 0); b.writeUInt32LE(40, 4); b.writeUInt32LE(2, 8);
  [1, 1, 3, 3, 10, 10, 4, 4].forEach((v, i) => b.writeUInt16LE(v, 12 + 2 * i));
  [0, 1, 1, 7].forEach((v, i) => b.writeUInt16LE(v, 28 + 2 * i));
  return b;
}
export const TWIN_BAD_AT = 32;

// ---------------------------------------------------------------------------------------------------
// Logic programs (criteria 5, 7 and 8). Each writes one array, so its write region holds that array at offset 0
// whatever order a region map lists writes in (Logic `logic@1`: Region map).

const logicHead = `
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))`;

/**
 * The reader (criteria 5 and 8): a logic item whose first data asset is a tile graph, copied to assets_at (8192) as a
 * u32 length then its bytes. Each step it writes `head` (i32 × 4): the asset's length, then the header's width,
 * height and node count. Item: writes `{head: {type: i32, count: 4}}`, assets: one tile graph.
 */
export const reader = (): string => `
(module
  (memory (export "memory") 1 1)${logicHead}
  (global (export "assets_at") i32 (i32.const 8192))
  (func $step (export "step") (param $k i64)
    (memory.copy (i32.const 4096) (i32.const 8192) (i32.const 16))))`;

/** The maker's memory: the params it gives the library form, the seed, and the output region. */
export const MAKER = { params_at: 8192, seed_at: 8216, out_at: 9216, data: 9472, floor: 66 } as const;
/**
 * The maker (criterion 8; a relocatable object under `--program`, linking the dungeon library form as
 * `lib:<library>.gen`): every step it calls gen(seed, params_at, out_at) once, so a floor is made one share a step, and
 * writes `floor` (i32 × 66): the shares left (0 once whole), then the output region's first 260 bytes (the u32 length,
 * then the tile graph). Its own data holds the params (floor, height, width as i64s) and the seed. Item: writes
 * `{floor: {type: i32, count: 66}}`, links the library form.
 */
export function maker(library: string, seed: bigint, params: { floor: number; height: number; width: number }): string {
  const data = Buffer.alloc(MAKER.data);
  data.writeBigInt64LE(BigInt(params.floor), MAKER.params_at);
  data.writeBigInt64LE(BigInt(params.height), MAKER.params_at + 8);
  data.writeBigInt64LE(BigInt(params.width), MAKER.params_at + 16);
  data.writeBigUInt64LE(seed, MAKER.seed_at);
  return `
(module
  (import "env" "__linear_memory" (memory 1 1))
  (import "lib:${library}" "gen" (func $gen (param i64 i32 i32) (result i32)))${logicHead}
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const 4096) (call $gen (i64.load (i32.const ${MAKER.seed_at})) (i32.const ${MAKER.params_at}) (i32.const ${MAKER.out_at})))
    (memory.copy (i32.const 4100) (i32.const ${MAKER.out_at}) (i32.const ${4 * (MAKER.floor - 1)})))
  (data (i32.const 0) "${dataText(data)}"))`;
}

/** The brain (criterion 7): a logic item that writes pos, live and gen and leaves them zero. */
export const brain = (): string => `
(module
  (memory (export "memory") 1 1)${logicHead}
  (func $step (export "step") (param $k i64)))`;

// ---------------------------------------------------------------------------------------------------
// The voxelizer (criterion 7).

export const VOX = { params_at: 1024, assets_at: 65536, out_at: 4096, pages: 16 } as const;
/** The box it writes: 6 faces of 4 vertices, each face's corners counter-clockwise from outside. */
function boxTemplate(): { select: Buffer; normals: Buffer; uv: Buffer; indices: Buffer } {
  // Each face: its normal axis and sign, and two tangents u, v with u × v = the normal.
  const faces: [number, number, number, number][] = [[0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0]];
  const select = Buffer.alloc(72); const normals = Buffer.alloc(288); const uv = Buffer.alloc(192); const indices = Buffer.alloc(144);
  const corners: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  faces.forEach(([axis, sign, u, v], f) => {
    corners.forEach(([cu, cv], c) => {
      const vert = 4 * f + c;
      const sel = [0, 0, 0];
      sel[axis] = sign > 0 ? 1 : 0; sel[u] = cu; sel[v] = cv;
      sel.forEach((s, k) => { select[3 * vert + k] = s; });
      const n = [0, 0, 0]; n[axis] = sign;
      n.forEach((x, k) => normals.writeFloatLE(x, 12 * vert + 4 * k));
      uv.writeFloatLE(cu, 8 * vert); uv.writeFloatLE(cv, 8 * vert + 4);
    });
    [0, 1, 2, 0, 2, 3].forEach((x, k) => indices.writeUInt32LE(4 * f + x, 4 * (6 * f + k)));
  });
  return { select, normals, uv, indices };
}
/**
 * The voxelizing provider (gen@1, criterion 7): its param `cell` (f64, m, the first in name order) and its mesh_in
 * param `source`, whose mesh it finds at assets_at (after a u32 length when the first word is that length, 8 + 32
 * vertices + 4 indices, else at assets_at itself). It voxelizes the mesh's bounds into cells: lo = floor(min ÷ cell) ×
 * cell and hi = ceil(max ÷ cell) × cell on each axis, and writes the box from lo to hi, 24 vertices and 36 indices,
 * each face wound counter-clockwise from outside. Given no mesh (no vertices, as a pack check's runs have), it writes
 * an empty mesh.
 */
export function voxelizer(): string {
  const t = boxTemplate();
  const at = { select: 1100, normals: 1200, uv: 1500, indices: 1700 };
  const o = VOX.out_at;
  const axis = (k: number): string => `
    (local.set $lo${k} (f64.const inf)) (local.set $hi${k} (f64.const -inf))`;
  const grow = (k: number): string => `
        (local.set $x (f64.promote_f32 (f32.load offset=${8 + 4 * k} (local.get $p))))
        (local.set $lo${k} (f64.min (local.get $lo${k}) (local.get $x)))
        (local.set $hi${k} (f64.max (local.get $hi${k}) (local.get $x)))`;
  const snap = (k: number): string => `
    (local.set $lo${k} (f64.mul (f64.floor (f64.div (local.get $lo${k}) (local.get $cell))) (local.get $cell)))
    (local.set $hi${k} (f64.mul (f64.ceil (f64.div (local.get $hi${k}) (local.get $cell))) (local.get $cell)))`;
  const put = (k: number): string => `
        (f32.store offset=${o + 8 + 4 * k} (local.get $q)
          (f32.demote_f64 (select (local.get $hi${k}) (local.get $lo${k}) (i32.load8_u offset=${at.select + k} (local.get $s)))))`;
  return `
(module
  (memory (export "memory") ${VOX.pages} ${VOX.pages})
  (global (export "params_at") i32 (i32.const ${VOX.params_at}))
  (global (export "assets_at") i32 (i32.const ${VOX.assets_at}))
  (global (export "out_at") i32 (i32.const ${o}))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (local $m i32) (local $vc i32) (local $i i32) (local $p i32) (local $q i32) (local $s i32) (local $x f64) (local $cell f64)
    (local $lo0 f64) (local $lo1 f64) (local $lo2 f64) (local $hi0 f64) (local $hi1 f64) (local $hi2 f64)
    (local.set $cell (f64.load (i32.const ${VOX.params_at})))
    (local.set $m (i32.const ${VOX.assets_at}))
    (if (i32.eq (i32.load (i32.const ${VOX.assets_at}))
          (i32.add (i32.const 8) (i32.add (i32.shl (i32.load (i32.const ${VOX.assets_at + 4})) (i32.const 5)) (i32.shl (i32.load (i32.const ${VOX.assets_at + 8})) (i32.const 2)))))
      (then (local.set $m (i32.const ${VOX.assets_at + 4}))))
    (local.set $vc (i32.load (local.get $m)))
    (if (i32.eqz (local.get $vc))
      (then (i32.store (i32.const ${o}) (i32.const 0)) (i32.store (i32.const ${o + 4}) (i32.const 0)) (return (i32.const 0))))${[0, 1, 2].map(axis).join('')}
    (local.set $p (local.get $m))
    (block $read
      (loop $vertex
        (br_if $read (i32.ge_u (local.get $i) (local.get $vc)))${[0, 1, 2].map(grow).join('')}
        (local.set $p (i32.add (local.get $p) (i32.const 12)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $vertex)))${[0, 1, 2].map(snap).join('')}
    (i32.store (i32.const ${o}) (i32.const 24))
    (i32.store (i32.const ${o + 4}) (i32.const 36))
    (local.set $i (i32.const 0))
    (loop $corner
      (local.set $q (i32.mul (local.get $i) (i32.const 12)))
      (local.set $s (i32.mul (local.get $i) (i32.const 3)))${[0, 1, 2].map(put).join('')}
      (br_if $corner (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 24))))
    (memory.copy (i32.const ${o + 8 + 288}) (i32.const ${at.normals}) (i32.const 288))
    (memory.copy (i32.const ${o + 8 + 576}) (i32.const ${at.uv}) (i32.const 192))
    (memory.copy (i32.const ${o + 8 + 768}) (i32.const ${at.indices}) (i32.const 144))
    (i32.const 0))
  (data (i32.const ${at.select}) "${dataText(t.select)}")
  (data (i32.const ${at.normals}) "${dataText(t.normals)}")
  (data (i32.const ${at.uv}) "${dataText(t.uv)}")
  (data (i32.const ${at.indices}) "${dataText(t.indices)}"))`;
}

/** snap (criterion 7's library, a relocatable object under `--library`): snap(x, cell) = nearest(x ÷ cell) × cell. */
export const snapLibrary = (): string => `
(module
  (import "env" "__linear_memory" (memory 0))
  (func $snap (export "snap") (param $x f64) (param $cell f64) (result f64)
    (f64.mul (f64.nearest (f64.div (local.get $x) (local.get $cell))) (local.get $cell))))`;

/**
 * A provider that links snap (criterion 7; a relocatable object under `--program`): gen writes one triangle, its
 * first corner at snap(0.3, cell) on x. Its pack ships snap with no fixture, so it must never link.
 */
export const snapProvider = (): string => `
(module
  (import "env" "__linear_memory" (memory 1 1))
  (import "lib:snap" "snap" (func $snap (param f64 f64) (result f64)))
  (global $params_at (export "params_at") i32 (i32.const 1024))
  (global $assets_at (export "assets_at") i32 (i32.const 2048))
  (global $out_at (export "out_at") i32 (i32.const 4096))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (i32.store (i32.const 4096) (i32.const 3))
    (i32.store (i32.const 4100) (i32.const 3))
    (f32.store (i32.const 4104) (f32.demote_f64 (call $snap (f64.const 0.3) (f64.load (i32.const 1024)))))
    (f32.store (i32.const 4116) (f32.const 1))
    (f32.store (i32.const 4132) (f32.const 1))
    (i32.store (i32.const 4204) (i32.const 1))
    (i32.store (i32.const 4208) (i32.const 2))
    (i32.const 0)))`;
