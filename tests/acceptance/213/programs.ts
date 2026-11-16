// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text. Every one exports
// `memory` (its maximum equal to its minimum), `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at`
// and `writes_at`; one that declares services also `services_at`, and one that declares mirrors each mirror's global.
// Arrays sit in the write region in declaration order, each on an 8-byte boundary (#531's layout rule). The services
// region is physics.cast@1's block (README: The services region): at services_at a u32 request count and 4 zero bytes,
// `max_per_step` requests of 160 bytes, a u32 result count and 4 zero bytes, `max_per_step` results of 520 bytes.

import {
  LIST_BYTES, REQUEST_BYTES, RESULT_BYTES, assemble, hitAt, rayBytes, requestAt, resultAt, resultCountAt, type Program, type Vec3,
} from './helpers.ts';

const head = (o: { pages: number; readsAt: number; writesAt: number; servicesAt?: number; globals?: Record<string, number>; digest?: string }): string => `
  (memory (export "memory") ${o.pages} ${o.pages})
  (global (export "reads_at") i32 (i32.const ${o.readsAt}))
  (global (export "writes_at") i32 (i32.const ${o.writesAt}))
  ${o.servicesAt === undefined ? '' : `(global (export "services_at") i32 (i32.const ${o.servicesAt}))`}
  ${Object.entries(o.globals ?? {}).map(([n, v]) => `(global (export "${n}") i32 (i32.const ${v}))`).join('\n  ')}
  ${o.digest === undefined ? '' : `(global (export "regions_digest") i64 (i64.const 0x${o.digest}))`}
  (func (export "init") (param $seed i64))`;
/** Bytes as a WebAssembly text data string. */
const data = (b: Buffer): string => Array.from(b, (x) => `\\${x.toString(16).padStart(2, '0')}`).join('');
/** The stores that write one ray request at `at` (README: The services region). */
const rayStores = (at: number, world: number, groups: number, max: number, from: Vec3, dir: Vec3): string => [
  `(i32.store (i32.const ${at}) (i32.const 0))`,
  `(i32.store (i32.const ${at + 4}) (i32.const ${world | 0}))`,
  `(i32.store (i32.const ${at + 8}) (i32.const ${groups | 0}))`,
  `(i32.store (i32.const ${at + 12}) (i32.const 0))`,
  `(f64.store (i32.const ${at + 16}) (f64.const ${max}))`,
  ...from.map((v, i) => `(f64.store (i32.const ${at + 24 + 8 * i}) (f64.const ${v}))`),
  ...dir.map((v, i) => `(f64.store (i32.const ${at + 48 + 8 * i}) (f64.const ${v}))`),
].join('\n      ');

/** Every program that asks services puts its region at 65,536 and its arrays at 4,096; it reads nothing (the seed at 0). */
export const S = 65_536;
const W = 4096;

/**
 * Criteria 1 and 2, the hit-scan shooter (max_per_step 1). At step `ask` it asks one ray from the origin along +x, max
 * 100 m, every group, in world `world` (its handle); at every step it first copies what its region holds of the answers
 * to the step before into `answered` (the result count), `hits` (request 0's hit count), `id` (its first hit's body),
 * `dist` (its distance) and `x` (its point's x). Writes: answered, hits, id i32; dist, x f64.
 */
export function shooter(world: number, ask = 30): Program {
  const m = 1;
  const h = hitAt(S, m, 0, 0);
  return assemble(`shooter_${world}_${ask}`, `
(module${head({ pages: 4, readsAt: 0, writesAt: W, servicesAt: S })}
  (func (export "step") (param $k i64)
    (i32.store (i32.const ${W}) (i32.load (i32.const ${resultCountAt(S, m)})))
    (i32.store (i32.const ${W + 8}) (i32.load (i32.const ${resultAt(S, m, 0)})))
    (i32.store (i32.const ${W + 16}) (i32.load (i32.const ${h})))
    (f64.store (i32.const ${W + 24}) (f64.load (i32.const ${h + 56})))
    (f64.store (i32.const ${W + 32}) (f64.load (i32.const ${h + 8})))
    (if (i64.eq (local.get $k) (i64.const ${ask}))
      (then
      (i32.store (i32.const ${S}) (i32.const 1))
      ${rayStores(requestAt(S, 0), world, -1, 100, [0, 0, 0], [1, 0, 0])})
      (else (i32.store (i32.const ${S}) (i32.const 0))))))`);
}
export const SHOOTER_WRITES = { answered: { type: 'i32' }, hits: { type: 'i32' }, id: { type: 'i32' }, dist: { type: 'f64' }, x: { type: 'f64' } } as const;

/** Criterion 3, the flood (max_per_step 256): k into `n` every step; at step 20 a request count of 257, else 0. */
export const flood = (): Program => assemble('flood', `
(module${head({ pages: 4, readsAt: 0, writesAt: W, servicesAt: S })}
  (func (export "step") (param $k i64)
    (i32.store (i32.const ${W}) (i32.wrap_i64 (local.get $k)))
    (i32.store (i32.const ${S}) (select (i32.const 257) (i32.const 0) (i64.eq (local.get $k) (i64.const 20))))))`);

/**
 * Criterion 3, the meter (max_per_step 4): every step the same work, three ray requests written and k into `n`, and
 * a request count of k mod 4, so step k asks k mod 4 rays and its own fuel is the same at every step.
 */
export function meter(world: number): Program {
  const rays = [0, 1, 2].map((i) => rayStores(requestAt(S, i), world, -1, 100, [0, 0, 0], [1, 0, 0])).join('\n      ');
  return assemble(`meter_${world}`, `
(module${head({ pages: 4, readsAt: 0, writesAt: W, servicesAt: S })}
  (func (export "step") (param $k i64)
    (i32.store (i32.const ${W}) (i32.wrap_i64 (local.get $k)))
    (i32.store (i32.const ${S}) (i32.wrap_i64 (i64.rem_u (local.get $k) (i64.const 4))))
      ${rays}))`);
}

/** Copies a whole batch of `m` requests from `from` into the region and sets the count (one memory.copy). */
const askBatch = (m: number, from: string): string => `
    (memory.copy (i32.const ${requestAt(S, 0)}) ${from} (i32.const ${m * REQUEST_BYTES}))
    (i32.store (i32.const ${S}) (i32.const ${m}))`;

/**
 * Criterion 8, the volley (max_per_step 256): every step the same 256 rays (`rays`, 256 × 160 bytes, a data segment at
 * 393,216), and the answers to the step before summed: `answered` the result count, `hits` every result's hit count.
 */
export function volley(rays: Buffer, key: string): Program {
  const m = 256;
  const at = 393_216;
  return assemble(`volley_${key}`, `
(module${head({ pages: 8, readsAt: 0, writesAt: W, servicesAt: S })}
  (data (i32.const ${at}) "${data(rays)}")
  (func (export "step") (param $k i64) (local $i i32) (local $total i32)
    (i32.store (i32.const ${W}) (i32.load (i32.const ${resultCountAt(S, m)})))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (i32.const ${m})))
      (local.set $total (i32.add (local.get $total) (i32.load (i32.add (i32.const ${resultAt(S, m, 0)}) (i32.mul (local.get $i) (i32.const ${RESULT_BYTES}))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (i32.store (i32.const ${W + 8}) (local.get $total))${askBatch(m, `(i32.const ${at})`)}))`);
}

/**
 * The Oracle lane's caster (max_per_step `m`): `batches` batches of `m` requests (`requests`, a data segment at
 * 262,144), batch b asked at step b + 1; at every step each result's hit count into `n`, its first hit's body into
 * `id`, distance into `dist`, point into `point` and normal into `normal`. Writes: n, id i32 × m; dist f64 × m;
 * point, normal vec3 × m.
 */
export function caster(requests: Buffer, m: number, batches: number, key: string): Program {
  const at = 262_144;
  const pages = Math.ceil((at + requests.length) / 65_536);
  const n = W;
  const id = W + 4 * m;
  const dist = id + 4 * m;
  const point = dist + 8 * m;
  const normal = point + 24 * m;
  return assemble(`caster_${key}`, `
(module${head({ pages, readsAt: 0, writesAt: W, servicesAt: S })}
  (data (i32.const ${at}) "${data(requests)}")
  (func (export "step") (param $k i64) (local $i i32) (local $h i32)
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (i32.const ${m})))
      (local.set $h (i32.add (i32.const ${hitAt(S, m, 0, 0)}) (i32.mul (local.get $i) (i32.const ${RESULT_BYTES}))))
      (i32.store (i32.add (i32.const ${n}) (i32.shl (local.get $i) (i32.const 2))) (i32.load (i32.sub (local.get $h) (i32.const 8))))
      (i32.store (i32.add (i32.const ${id}) (i32.shl (local.get $i) (i32.const 2))) (i32.load (local.get $h)))
      (f64.store (i32.add (i32.const ${dist}) (i32.shl (local.get $i) (i32.const 3))) (f64.load offset=56 (local.get $h)))
      (memory.copy (i32.add (i32.const ${point}) (i32.mul (local.get $i) (i32.const 24))) (i32.add (local.get $h) (i32.const 8)) (i32.const 24))
      (memory.copy (i32.add (i32.const ${normal}) (i32.mul (local.get $i) (i32.const 24))) (i32.add (local.get $h) (i32.const 32)) (i32.const 24))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (if (i32.and (i64.ge_u (local.get $k) (i64.const 1)) (i64.le_u (local.get $k) (i64.const ${batches})))
      (then${askBatch(m, `(i32.add (i32.const ${at}) (i32.mul (i32.wrap_i64 (i64.sub (local.get $k) (i64.const 1))) (i32.const ${m * REQUEST_BYTES})))`)})
      (else (i32.store (i32.const ${S}) (i32.const 0))))))`);
}
export const casterWrites = (m: number): Record<string, { type: 'i32' | 'f64' | 'vec3'; count: number }> =>
  ({ n: { type: 'i32', count: m }, id: { type: 'i32', count: m }, dist: { type: 'f64', count: m }, point: { type: 'vec3', count: m }, normal: { type: 'vec3', count: m } });
/** A batch of ray requests as one data string's bytes. */
export const requestsOf = (rays: { world: number; groups: number; max: number; from: Vec3; dir: Vec3 }[]): Buffer =>
  Buffer.concat(rays.map((r) => rayBytes(r.world, r.groups, r.max, r.from, r.dir)));

/** Criterion 8's idle item and every handle probe: k into `n`, nothing read, nothing asked. Writes: n i32. */
export const ticker = (): Program => assemble('ticker', `
(module${head({ pages: 1, readsAt: 0, writesAt: W })}
  (func (export "step") (param $k i64)
    (i32.store (i32.const ${W}) (i32.wrap_i64 (local.get $k)))))`);

// ---------------------------------------------------------------------------------------------------
// Mirror reads (criteria 5 to 8): writers, mirror readers and plain readers, run by deep-logic.

/** FNV-1a's offset and prime over 8-byte words: the readers' checksum of the bytes they hold. */
const SUM = `
  (func $sum (param $p i32) (param $end i32) (result i64) (local $h i64)
    (local.set $h (i64.const 0xcbf29ce484222325))
    (block $done (loop $next
      (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
      (local.set $h (i64.mul (i64.xor (local.get $h) (i64.load (local.get $p))) (i64.const 0x100000001b3)))
      (local.set $p (i32.add (local.get $p) (i32.const 8)))
      (br $next)))
    (local.get $h))`;
/** A reader's `sum` array (two i32, low word first) as the u64 it holds. */
export const sumOf = (words: readonly number[]): bigint => (BigInt(words[1]! >>> 0) << 32n) | BigInt(words[0]! >>> 0);

const MW = 65_536;
/**
 * Criterion 5, the crowd: 100,000 vec3 positions; step k writes 10 runs of 100, run r from element 10,000 r + o(k),
 * o(k) = ((37 k) mod 99) × 100, each element (k + 1, its index, r). Four MiB; positions at 65,536.
 */
export const crowd = (): Program => assemble('crowd', `
(module${head({ pages: 64, readsAt: 0, writesAt: MW })}
  (func (export "step") (param $k i64) (local $x f64) (local $o i32) (local $r i32) (local $i i32) (local $e i32) (local $a i32)
    (local.set $x (f64.convert_i64_u (i64.add (local.get $k) (i64.const 1))))
    (local.set $o (i32.mul (i32.wrap_i64 (i64.rem_u (i64.mul (local.get $k) (i64.const 37)) (i64.const 99))) (i32.const 100)))
    (block $rd (loop $rl
      (br_if $rd (i32.ge_u (local.get $r) (i32.const 10)))
      (local.set $i (i32.const 0))
      (block $id (loop $il
        (br_if $id (i32.ge_u (local.get $i) (i32.const 100)))
        (local.set $e (i32.add (i32.add (i32.mul (local.get $r) (i32.const 10000)) (local.get $o)) (local.get $i)))
        (local.set $a (i32.add (i32.const ${MW}) (i32.mul (local.get $e) (i32.const 24))))
        (f64.store (local.get $a) (local.get $x))
        (f64.store offset=8 (local.get $a) (f64.convert_i32_u (local.get $e)))
        (f64.store offset=16 (local.get $a) (f64.convert_i32_u (local.get $r)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $il)))
      (local.set $r (i32.add (local.get $r) (i32.const 1)))
      (br $rl)))))`);
/** The runs crowd's step k writes: [first, count] for r = 0 … 9. */
export const crowdRuns = (k: number): [number, number][] => Array.from({ length: 10 }, (_, r) => [10_000 * r + ((37 * k) % 99) * 100, 100]);

/**
 * A mirror reader: its mirror (global `global`, at `mirrorAt`, `bytes` long) and its read region at 0. Every step it
 * copies its mirror's list (at `listAt` in the read region, LIST_BYTES long) into `list` (i32 × 513) and its checksum
 * of the mirror's bytes into `sum` (i32 × 2).
 */
export function mirrorReader(o: { name: string; pages: number; global: string; mirrorAt: number; bytes: number; listAt: number }): Program {
  return assemble(`${o.name}_${o.listAt}`, `
(module${head({ pages: o.pages, readsAt: 0, writesAt: MW, globals: { [o.global]: o.mirrorAt } })}${SUM}
  (func (export "step") (param $k i64)
    (memory.copy (i32.const ${MW}) (i32.const ${o.listAt}) (i32.const ${LIST_BYTES}))
    (i64.store (i32.const ${MW + 2056}) (call $sum (i32.const ${o.mirrorAt}) (i32.const ${o.mirrorAt + o.bytes})))))`);
}
export const MIRROR_WRITES = { list: { type: 'i32', count: 513 }, sum: { type: 'i32', count: 2 } } as const;
/** A plain reader of one array (its first read, at offset 0 of its read region at `readsAt`): its checksum into `sum`. */
export function plainReader(o: { name: string; pages: number; readsAt: number; bytes: number }): Program {
  return assemble(o.name, `
(module${head({ pages: o.pages, readsAt: o.readsAt, writesAt: MW })}${SUM}
  (func (export "step") (param $k i64)
    (i64.store (i32.const ${MW}) (call $sum (i32.const ${o.readsAt}) (i32.const ${o.readsAt + o.bytes})))))`);
}
export const PLAIN_WRITES = { sum: { type: 'i32', count: 2 } } as const;

/** Criterion 6, the scatter: f64 × 4,096; at step 9 elements 0, 10, 20 … 2,990 become 10 (300 ranges); nothing else. */
export const scatter = (): Program => assemble('scatter', `
(module${head({ pages: 4, readsAt: 0, writesAt: MW })}
  (func (export "step") (param $k i64) (local $j i32)
    (if (i64.eq (local.get $k) (i64.const 9)) (then
      (block $d (loop $l
        (br_if $d (i32.ge_u (local.get $j) (i32.const 300)))
        (f64.store (i32.add (i32.const ${MW}) (i32.mul (local.get $j) (i32.const 80))) (f64.const 10))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $l)))))))`);
/** Criterion 6's item that mirrors its own array: f64 × 16, mirror global at 8,192. Refused at check. */
export const selfish = (): Program => assemble('selfish', `
(module${head({ pages: 1, readsAt: 0, writesAt: 4096, globals: { self_at: 8192 } })}
  (func (export "step") (param $k i64)))`);

/** Criterion 7's writers. left: f64 × 1,000, step k sets element k and elements 600 + k … 602 + k to k + 1. */
export const left = (): Program => assemble('left', `
(module${head({ pages: 1, readsAt: 0, writesAt: 4096 })}
  (func (export "step") (param $k i64) (local $x f64) (local $a i32)
    (local.set $x (f64.convert_i64_u (i64.add (local.get $k) (i64.const 1))))
    (local.set $a (i32.mul (i32.wrap_i64 (local.get $k)) (i32.const 8)))
    (f64.store (i32.add (i32.const 4096) (local.get $a)) (local.get $x))
    (f64.store (i32.add (i32.const ${4096 + 4800}) (local.get $a)) (local.get $x))
    (f64.store (i32.add (i32.const ${4096 + 4808}) (local.get $a)) (local.get $x))
    (f64.store (i32.add (i32.const ${4096 + 4816}) (local.get $a)) (local.get $x))))`);
export const leftRuns = (k: number): [number, number][] => [[k, 1], [600 + k, 3]];
/** right: i32 × 500, step k sets element 2k to k + 1. */
export const right = (): Program => assemble('right', `
(module${head({ pages: 1, readsAt: 0, writesAt: 4096 })}
  (func (export "step") (param $k i64)
    (i32.store (i32.add (i32.const 4096) (i32.mul (i32.wrap_i64 (local.get $k)) (i32.const 8))) (i32.wrap_i64 (i64.add (local.get $k) (i64.const 1))))))`);
export const rightRuns = (k: number): [number, number][] => [[2 * k, 1]];
/** Bytes of the read region criterion 7's panel copies into `region` (i32 × 1,200) every step. */
export const PANEL_BYTES = 4800;
/** Criterion 7's panel: reads knob, mirrors left.vals at 131,072 and right.vals at 147,456; with `digest` its regions_digest. */
export const panel = (digest?: string): Program => assemble(`panel_${digest ?? 'probe'}`, `
(module${head({ pages: 4, readsAt: 0, writesAt: MW, globals: { left_at: 131_072, right_at: 147_456 }, ...(digest ? { digest } : {}) })}
  (func (export "step") (param $k i64)
    (memory.copy (i32.const ${MW}) (i32.const 0) (i32.const ${PANEL_BYTES}))))`);

/**
 * Criterion 8's writer: f64 × 1,000,000 (8 MiB of memory); step k changes 10,000 elements in 64 runs, run r from
 * 15,625 r + ((97 k) mod 15,400), 157 long for r < 16 and 156 after, each to k + 1.
 */
export const bulk = (): Program => assemble('bulk', `
(module${head({ pages: 128, readsAt: 0, writesAt: MW })}
  (func (export "step") (param $k i64) (local $x f64) (local $r i32) (local $a i32) (local $end i32)
    (local.set $x (f64.convert_i64_u (i64.add (local.get $k) (i64.const 1))))
    (block $rd (loop $rl
      (br_if $rd (i32.ge_u (local.get $r) (i32.const 64)))
      (local.set $a (i32.add (i32.const ${MW}) (i32.shl (i32.add (i32.mul (local.get $r) (i32.const 15625))
        (i32.wrap_i64 (i64.rem_u (i64.mul (local.get $k) (i64.const 97)) (i64.const 15400)))) (i32.const 3))))
      (local.set $end (i32.add (local.get $a) (i32.shl (i32.add (i32.const 156) (i32.lt_u (local.get $r) (i32.const 16))) (i32.const 3))))
      (block $ed (loop $el
        (br_if $ed (i32.ge_u (local.get $a) (local.get $end)))
        (f64.store (local.get $a) (local.get $x))
        (local.set $a (i32.add (local.get $a) (i32.const 8)))
        (br $el)))
      (local.set $r (i32.add (local.get $r) (i32.const 1)))
      (br $rl)))))`);
/** Criterion 8's mirror reader of bulk.vals (at 131,072): its list's count into `ranges` (i32 × 1) every step. */
export const reader8 = (listAt: number): Program => assemble(`reader8_${listAt}`, `
(module${head({ pages: 128, readsAt: 0, writesAt: MW, globals: { vals_at: 131_072 } })}
  (func (export "step") (param $k i64)
    (i32.store (i32.const ${MW}) (i32.load (i32.const ${listAt})))))`);
