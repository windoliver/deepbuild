// This suite's programs in WebAssembly text (README: Programs): the driver, a logic program that plays a script of
// mods.lib@1 calls and writes every total it reads, and this suite's own wrong libraries (README: Planted twins), each
// a relocatable object under the one subset. The script, an asset the driver reads, is encoded here from a Plan
// (model.ts). Nothing here computes an expected total: model.ts does, from the rule.

import { type Layout, type Program, entryAt } from '../190/helpers.ts';
import { assemble } from '../416/interfaces/wat.ts';
import { ID_COLUMN, TABLE, fnv1a } from './catalog.ts';
import { MAX_STATS, type Edit, type ModRow, type Plan } from './model.ts';

/** mods.lib@1's exports as a pack lists them (README: The surface). */
export const EXPORTS = [
  { name: 'attach', params: ['i32', 'i32', 'i32', 'i32'], results: [] as string[] },
  { name: 'detach', params: ['i32', 'i32'], results: [] as string[] },
  { name: 'add', params: ['i32', 'i32'], results: ['i32'] },
  { name: 'remove', params: ['i32', 'i32'], results: [] as string[] },
  { name: 'tick', params: ['i32', 'i32'], results: [] as string[] },
  { name: 'total', params: ['i32', 'i32', 'i32'], results: ['i64'] },
];
export const EXPORT_NAMES = EXPORTS.map((e) => e.name);
/** The tree's bytes in the caller's memory, its header's, and a modifier row's (README: The surface). */
const TREE_BYTES = 1_048_576;
const HEADER_BYTES = 128;
const ROW_BYTES = 104;

/** The driver's memory: 0 reads, 4096 writes, 65536 its own state, 131072 the tree, then its assets (the script first, then the catalog). */
const WRITES_AT = 4096;
const DRIVER_AT = 65536;
const TREE_AT = 131072;
const ASSETS_AT = TREE_AT + TREE_BYTES + 65536;
const PAGES = 64;
const SCRIPT_AT = ASSETS_AT + 4;

/** The driver's writes: `totals` (f64, one per read, in read order), `reads` (how many the step read) and `last_id` (the id the latest add returned, -1 before any). */
export const driverWrites = (reads: number) => ({ totals: { type: 'f64' as const, count: reads }, reads: { type: 'i32' as const }, last_id: { type: 'i32' as const } });

/** A program built for no layout: `check` of an item naming it reports the item's layout (#416's probe, at this driver's regions). */
export const layoutProbe = (): Program => assemble('mods_layout_probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param i64))
  (func (export "step") (param i64)))`);

const tag = (module: string): string => module.replace(/[^a-z0-9]/gi, '_');

/**
 * The driver, importing mods.lib@1's six exports from `module` (`lib:mods.lib@1` for the interface, `lib:<name>` for a
 * library by its own name). `init` copies the script's tree header to the tree and points it at the catalog (the
 * item's second asset); each step runs the script's ops up to its END, each READ writing total(node, stat) as an f64
 * into `totals`, then writes `reads` and `last_id`. A script past its end (HALT) runs nothing.
 */
export function driver(module: string, l: Layout, reads: number): Program {
  const at = (name: string): number => WRITES_AT + entryAt(l, 'writes', name);
  const CURSOR = DRIVER_AT, COUNT = DRIVER_AT + 4, LAST = DRIVER_AT + 8;
  const op = (code: number, body: string): string => `
          (if (i32.eq (local.get $op) (i32.const ${code})) (then${body}
            (br $known)))`;
  return assemble(`mods_driver_${tag(module)}_${reads}_${at('totals')}_${at('reads')}_${at('last_id')}`, `
(module
  (import "env" "__linear_memory" (memory ${PAGES} ${PAGES}))
  (import "${module}" "attach" (func $attach (param i32 i32 i32 i32)))
  (import "${module}" "detach" (func $detach (param i32 i32)))
  (import "${module}" "add" (func $add (param i32 i32) (result i32)))
  (import "${module}" "remove" (func $remove (param i32 i32)))
  (import "${module}" "tick" (func $tick (param i32 i32)))
  (import "${module}" "total" (func $total (param i32 i32 i32) (result i64)))
  (global $reads_at (export "reads_at") i32 (i32.const 0))
  (global $writes_at (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global $assets_at (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  (func $init (export "init") (param $seed i64) (local $i i32)
    (loop $copy
      (i32.store (i32.add (i32.const ${TREE_AT}) (i32.shl (local.get $i) (i32.const 2)))
        (i32.load (i32.add (i32.const ${SCRIPT_AT}) (i32.shl (local.get $i) (i32.const 2)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $copy (i32.lt_u (local.get $i) (i32.const ${HEADER_BYTES / 4}))))
    (i32.store (i32.const ${TREE_AT}) (i32.add (i32.add (i32.const ${SCRIPT_AT}) (i32.load (i32.const ${ASSETS_AT}))) (i32.const 4)))
    (i32.store (i32.const ${CURSOR}) (i32.const ${HEADER_BYTES}))
    (i32.store (i32.const ${LAST}) (i32.const -1)))
  (func $read (param $n i32) (param $s i32) (local $r i32)
    (local.set $r (i32.load (i32.const ${COUNT})))
    (if (i32.ge_u (local.get $r) (i32.const ${reads})) (then (unreachable)))
    (f64.store (i32.add (i32.const ${at('totals')}) (i32.shl (local.get $r) (i32.const 3)))
      (f64.convert_i64_s (call $total (i32.const ${TREE_AT}) (local.get $n) (local.get $s))))
    (i32.store (i32.const ${COUNT}) (i32.add (local.get $r) (i32.const 1))))
  (func $step (export "step") (param $k i64)
    (local $p i32) (local $op i32) (local $n i32) (local $s i32) (local $end i32) (local $S i32)
    (i32.store (i32.const ${COUNT}) (i32.const 0))
    (local.set $S (i32.load offset=12 (i32.const ${TREE_AT})))
    (local.set $p (i32.add (i32.const ${SCRIPT_AT}) (i32.load (i32.const ${CURSOR}))))
    (block $done
      (loop $next
        (local.set $op (i32.load (local.get $p)))
        (br_if $done (i32.eq (local.get $op) (i32.const 8)))
        (local.set $p (i32.add (local.get $p) (i32.const 4)))
        (br_if $done (i32.eqz (local.get $op)))
        (block $known${op(1, `
            (call $attach (i32.const ${TREE_AT}) (i32.load (local.get $p)) (i32.load offset=4 (local.get $p)) (i32.load offset=8 (local.get $p)))
            (local.set $p (i32.add (local.get $p) (i32.const 12)))`)}${op(2, `
            (call $detach (i32.const ${TREE_AT}) (i32.load (local.get $p)))
            (local.set $p (i32.add (local.get $p) (i32.const 4)))`)}${op(3, `
            (i32.store (i32.const ${LAST}) (call $add (i32.const ${TREE_AT}) (local.get $p)))
            (local.set $p (i32.add (local.get $p) (i32.const ${ROW_BYTES})))`)}${op(4, `
            (call $remove (i32.const ${TREE_AT}) (i32.load (local.get $p)))
            (local.set $p (i32.add (local.get $p) (i32.const 4)))`)}${op(5, `
            (call $tick (i32.const ${TREE_AT}) (i32.load (local.get $p)))
            (local.set $p (i32.add (local.get $p) (i32.const 4)))`)}${op(6, `
            (call $read (i32.load (local.get $p)) (i32.load offset=4 (local.get $p)))
            (local.set $p (i32.add (local.get $p) (i32.const 8)))`)}${op(7, `
            (local.set $n (i32.load (local.get $p)))
            (local.set $end (i32.add (local.get $n) (i32.load offset=4 (local.get $p))))
            (local.set $p (i32.add (local.get $p) (i32.const 8)))
            (block $nodes (loop $node
              (br_if $nodes (i32.ge_s (local.get $n) (local.get $end)))
              (local.set $s (i32.const 0))
              (block $stats (loop $stat
                (br_if $stats (i32.ge_s (local.get $s) (local.get $S)))
                (call $read (local.get $n) (local.get $s))
                (local.set $s (i32.add (local.get $s) (i32.const 1)))
                (br $stat)))
              (local.set $n (i32.add (local.get $n) (i32.const 1)))
              (br $node)))`)}
          (unreachable))
        (br $next)))
    (i32.store (i32.const ${CURSOR}) (i32.sub (local.get $p) (i32.const ${SCRIPT_AT})))
    (i32.store (i32.const ${at('reads')}) (i32.load (i32.const ${COUNT})))
    (i32.store (i32.const ${at('last_id')}) (i32.load (i32.const ${LAST}))))
  (data (i32.const ${DRIVER_AT}) "\\00\\00\\00\\00"))`, 'program');
}

// ---------------------------------------------------------------------------------------------------
// The script (README: The driver's script).

const OPS = { end: 0, attach: 1, detach: 2, add: 3, remove: 4, tick: 5, read: 6, readNodes: 7, halt: 8 } as const;

/** A modifier row's bytes (README: Modifier row). */
function rowBytes(r: ModRow): Buffer {
  const b = Buffer.alloc(ROW_BYTES);
  b.writeInt32LE(r.source, 0);
  b.writeInt32LE(r.stat, 4);
  b.writeInt32LE(r.op, 8);
  b.writeInt32LE(r.reach, 12);
  b.writeBigInt64LE(BigInt(r.value), 16);
  b.writeInt32LE(r.duration.kind, 24);
  b.writeInt32LE(r.duration.count, 28);
  b.writeInt32LE(r.filters.length, 32);
  r.filters.forEach((f, i) => {
    b.writeUInt32LE(fnv1a(f.column), 40 + 16 * i);
    b.writeInt32LE(f.cmp, 44 + 16 * i);
    b.writeBigInt64LE(BigInt(f.value), 48 + 16 * i);
  });
  return b;
}
/** The tree header the program writes (README: The tree): the catalog's address (the driver's to fill), the node table, its ID column, the stat count and each stat's base column. */
function headerBytes(stats: string[]): Buffer {
  if (stats.length < 1 || stats.length > MAX_STATS) throw Error(`a tree totals 1 to ${MAX_STATS} stats, not ${stats.length}`);
  const b = Buffer.alloc(HEADER_BYTES);
  b.writeUInt32LE(fnv1a(TABLE), 4);
  b.writeUInt32LE(fnv1a(ID_COLUMN), 8);
  b.writeUInt32LE(stats.length, 12);
  stats.forEach((s, i) => b.writeUInt32LE(fnv1a(s), 16 + 4 * i));
  return b;
}
const words = (...xs: number[]): Buffer => { const b = Buffer.alloc(4 * xs.length); xs.forEach((x, i) => b.writeInt32LE(x | 0, 4 * i)); return b; };
function editBytes(e: Edit): Buffer {
  switch (e.kind) {
    case 'attach': return words(OPS.attach, e.node, e.parent, fnv1a(e.row) | 0);
    case 'detach': return words(OPS.detach, e.node);
    case 'add': return Buffer.concat([words(OPS.add), rowBytes(e.row)]);
    case 'remove': return words(OPS.remove, e.id);
    case 'tick': return words(OPS.tick, e.boundary);
  }
}
/** A plan's script: the header, then each step's edits and reads and an END, then HALT. */
export function scriptBytes(plan: Plan): Buffer {
  const parts: Buffer[] = [headerBytes(plan.stats)];
  for (const step of plan.steps) {
    for (const e of step.edits) parts.push(editBytes(e));
    for (const r of step.reads) parts.push('node' in r ? words(OPS.read, r.node, r.stat) : words(OPS.readNodes, r.first, r.count));
    parts.push(words(OPS.end));
  }
  parts.push(words(OPS.halt));
  const script = Buffer.concat(parts);
  if (SCRIPT_AT + script.length + 4 > PAGES * 65536 - 65536) throw Error(`BLOCKED: a script of ${script.length} bytes leaves the driver's memory no room for the catalog`);
  return script;
}

// ---------------------------------------------------------------------------------------------------
// This suite's own mods.lib@1 libraries (README: Planted twins), from one text: by the rule, unless a twin flag
// changes the one thing its criterion names. They keep no data of their own: every byte is in the tree at `t`.

export interface Twin {
  /** Criterion 1: an attach or a detach of node n leaves the cached totals of n's descendants as they were. */
  stale?: boolean;
  /** Criterion 2: a row's filters are tested on its source's catalog row, not the receiving node's. */
  onSource?: boolean;
  /** Criterion 3: the percent is applied before the add: base × (1 + Σ percent ÷ 100) + Σ add. */
  pctFirst?: boolean;
  /** Criterion 4: each percent's share of (base + Σ add) is rounded toward zero on its own, then summed. */
  roundEach?: boolean;
}

/**
 * A mods.lib@1 library. The tree at t: the header (+0 to +127), then the library's own: next id (+128), the cache
 * generation (+132), node records at +256 (16 bytes each: state, parent, row index), the cache at +8448 (16 bytes per
 * node and stat: the total, and the generation it was computed at + 1), rows at +139520 (112 bytes each: the 104-byte
 * row, alive, turns or rounds left). Every change bumps the generation, so every cached total is marked; a total is
 * recomputed from every row when it is read marked.
 */
export function library(twin: Twin = {}): Program {
  const name = `mods_lib_${Object.entries(twin).filter(([, v]) => v).map(([k]) => k).join('_') || 'rule'}`;
  const filterOn = twin.onSource ? '(i32.load (local.get $rp))' : '(local.get $n)';
  const changed = twin.stale
    ? `
  (func $changed (param $t i32) (param $n i32)
    (local $old i32) (local $new i32) (local $d i32) (local $s i32) (local $c i32)
    (local.set $old (call $stamp (local.get $t)))
    (call $mark (local.get $t))
    (local.set $new (call $stamp (local.get $t)))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $d) (i32.const 512)))
      (if (call $under (local.get $t) (local.get $d) (local.get $n)) (then
        (local.set $s (i32.const 0))
        (block $stats (loop $stat
          (br_if $stats (i32.ge_u (local.get $s) (i32.const 16)))
          (local.set $c (call $cachep (local.get $t) (local.get $d) (local.get $s)))
          (if (i32.eq (i32.load offset=8 (local.get $c)) (local.get $old)) (then (i32.store offset=8 (local.get $c) (local.get $new))))
          (local.set $s (i32.add (local.get $s) (i32.const 1)))
          (br $stat)))))
      (local.set $d (i32.add (local.get $d) (i32.const 1)))
      (br $each))))`
    : `
  (func $changed (param $t i32) (param $n i32) (call $mark (local.get $t)))`;
  const x = twin.pctFirst
    ? '(local.set $x (i64.add (i64.mul (local.get $b) (i64.add (i64.const 100) (local.get $pct))) (i64.mul (local.get $add) (i64.const 100))))'
    : twin.roundEach
      ? `(local.set $id (i32.const 0))
    (block $done2 (loop $each2
      (br_if $done2 (i32.ge_u (local.get $id) (i32.load offset=128 (local.get $t))))
      (local.set $rp (call $rowp (local.get $t) (local.get $id)))
      (if (i32.eq (i32.load offset=8 (local.get $rp)) (i32.const 1)) (then
        (if (call $applies (local.get $t) (local.get $rp) (local.get $n) (local.get $s)) (then
          (local.set $parts (i64.add (local.get $parts)
            (i64.div_s (i64.mul (i64.add (local.get $b) (local.get $add)) (i64.load offset=16 (local.get $rp))) (i64.const 100))))))))
      (local.set $id (i32.add (local.get $id) (i32.const 1)))
      (br $each2)))
    (local.set $x (i64.mul (i64.add (i64.add (local.get $b) (local.get $add)) (local.get $parts)) (i64.const 100)))`
      : '(local.set $x (i64.mul (i64.add (local.get $b) (local.get $add)) (i64.add (i64.const 100) (local.get $pct))))';
  return assemble(name, `
(module
  (import "env" "__linear_memory" (memory 0))
  (func $node (param $t i32) (param $n i32) (result i32)
    (i32.add (i32.add (local.get $t) (i32.const 256)) (i32.shl (local.get $n) (i32.const 4))))
  (func $rowp (param $t i32) (param $id i32) (result i32)
    (i32.add (i32.add (local.get $t) (i32.const 139520)) (i32.mul (local.get $id) (i32.const 112))))
  (func $cachep (param $t i32) (param $n i32) (param $s i32) (result i32)
    (i32.add (i32.add (local.get $t) (i32.const 8448)) (i32.shl (i32.add (i32.shl (local.get $n) (i32.const 4)) (local.get $s)) (i32.const 4))))
  (func $stamp (param $t i32) (result i32) (i32.add (i32.load offset=132 (local.get $t)) (i32.const 1)))
  (func $mark (param $t i32) (i32.store offset=132 (local.get $t) (i32.add (i32.load offset=132 (local.get $t)) (i32.const 1))))
  ;; n has the strict ancestor a, through parent links as they stand (a never-attached node has none).
  (func $under (param $t i32) (param $n i32) (param $a i32) (result i32) (local $p i32) (local $g i32)
    (if (i32.eqz (i32.load (call $node (local.get $t) (local.get $n)))) (then (return (i32.const 0))))
    (local.set $p (i32.load offset=4 (call $node (local.get $t) (local.get $n))))
    (block $no (loop $up
      (br_if $no (i32.lt_s (local.get $p) (i32.const 0)))
      (if (i32.eq (local.get $p) (local.get $a)) (then (return (i32.const 1))))
      (br_if $no (i32.eqz (i32.load (call $node (local.get $t) (local.get $p)))))
      (local.set $p (i32.load offset=4 (call $node (local.get $t) (local.get $p))))
      (local.set $g (i32.add (local.get $g) (i32.const 1)))
      (br_if $up (i32.lt_u (local.get $g) (i32.const 1024)))))
    (i32.const 0))
  ;; n is in the tree: attached, and so is every ancestor up to a root.
  (func $live (param $t i32) (param $n i32) (result i32) (local $p i32) (local $g i32)
    (local.set $p (local.get $n))
    (block $no (loop $up
      (br_if $no (i32.ne (i32.load (call $node (local.get $t) (local.get $p))) (i32.const 1)))
      (local.set $p (i32.load offset=4 (call $node (local.get $t) (local.get $p))))
      (if (i32.lt_s (local.get $p) (i32.const 0)) (then (return (i32.const 1))))
      (local.set $g (i32.add (local.get $g) (i32.const 1)))
      (br_if $up (i32.lt_u (local.get $g) (i32.const 1024)))))
    (i32.const 0))
  (func $root (param $t i32) (param $n i32) (result i32) (local $p i32)
    (block $top (loop $up
      (local.set $p (i32.load offset=4 (call $node (local.get $t) (local.get $n))))
      (br_if $top (i32.lt_s (local.get $p) (i32.const 0)))
      (local.set $n (local.get $p))
      (br $up)))
    (local.get $n))
  ;; The catalog: the node table's directory entry, a column of it, a row by its ID hash.
  (func $table (param $t i32) (result i32) (local $c i32) (local $i i32) (local $p i32)
    (local.set $c (i32.load (local.get $t)))
    (local.set $p (i32.add (local.get $c) (i32.const 20)))
    (block $no (loop $each
      (br_if $no (i32.ge_u (local.get $i) (i32.load offset=8 (local.get $c))))
      (if (i32.eq (i32.load (local.get $p)) (i32.load offset=4 (local.get $t))) (then (return (local.get $p))))
      (local.set $p (i32.add (local.get $p) (i32.add (i32.const 12) (i32.shl (i32.load offset=8 (local.get $p)) (i32.const 4)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (i32.const 0))
  (func $column (param $tab i32) (param $hash i32) (result i32) (local $i i32) (local $p i32)
    (local.set $p (i32.add (local.get $tab) (i32.const 12)))
    (block $no (loop $each
      (br_if $no (i32.ge_u (local.get $i) (i32.load offset=8 (local.get $tab))))
      (if (i32.eq (i32.load (local.get $p)) (local.get $hash)) (then (return (local.get $p))))
      (local.set $p (i32.add (local.get $p) (i32.const 16)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (i32.const 0))
  (func $i32col (param $t i32) (param $hash i32) (result i32) (local $tab i32) (local $col i32)
    (local.set $tab (call $table (local.get $t)))
    (if (i32.eqz (local.get $tab)) (then (return (i32.const 0))))
    (local.set $col (call $column (local.get $tab) (local.get $hash)))
    (if (i32.eqz (local.get $col)) (then (return (i32.const 0))))
    (if (i32.load offset=4 (local.get $col)) (then (return (i32.const 0))))
    (local.get $col))
  (func $cellv (param $t i32) (param $col i32) (param $row i32) (result i64)
    (i64.extend_i32_s (i32.load (i32.add (i32.add (i32.load (local.get $t)) (i32.load offset=8 (local.get $col))) (i32.shl (local.get $row) (i32.const 2))))))
  (func $find (param $t i32) (param $hash i32) (result i32)
    (local $tab i32) (local $col i32) (local $lo i32) (local $hi i32) (local $mid i32) (local $v i32) (local $base i32)
    (local.set $tab (call $table (local.get $t)))
    (if (i32.eqz (local.get $tab)) (then (return (i32.const -1))))
    (local.set $col (call $column (local.get $tab) (i32.load offset=8 (local.get $t))))
    (if (i32.eqz (local.get $col)) (then (return (i32.const -1))))
    (local.set $base (i32.add (i32.load (local.get $t)) (i32.load offset=8 (local.get $col))))
    (local.set $hi (i32.load offset=4 (local.get $tab)))
    (block $no (loop $search
      (br_if $no (i32.ge_u (local.get $lo) (local.get $hi)))
      (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
      (local.set $v (i32.load (i32.add (local.get $base) (i32.shl (local.get $mid) (i32.const 2)))))
      (if (i32.eq (local.get $v) (local.get $hash)) (then (return (local.get $mid))))
      (if (i32.lt_u (local.get $v) (local.get $hash))
        (then (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
        (else (local.set $hi (local.get $mid))))
      (br $search)))
    (i32.const -1))
  (func $rowof (param $t i32) (param $n i32) (result i32)
    (if (result i32) (i32.eqz (i32.load (call $node (local.get $t) (local.get $n))))
      (then (i32.const -1))
      (else (i32.load offset=8 (call $node (local.get $t) (local.get $n))))))
  (func $base (param $t i32) (param $n i32) (param $s i32) (result i64) (local $r i32) (local $col i32)
    (local.set $r (call $rowof (local.get $t) (local.get $n)))
    (if (i32.lt_s (local.get $r) (i32.const 0)) (then (return (i64.const 0))))
    (local.set $col (call $i32col (local.get $t) (i32.load offset=16 (i32.add (local.get $t) (i32.shl (local.get $s) (i32.const 2))))))
    (if (i32.eqz (local.get $col)) (then (return (i64.const 0))))
    (call $cellv (local.get $t) (local.get $col) (local.get $r)))
  ;; Every filter of the row at rp holds on node m's catalog row.
  (func $holds (param $t i32) (param $rp i32) (param $m i32) (result i32)
    (local $k i32) (local $f i32) (local $r i32) (local $col i32) (local $v i64) (local $cmp i32) (local $want i64)
    (local.set $r (call $rowof (local.get $t) (local.get $m)))
    (block $fail (loop $each
      (if (i32.ge_u (local.get $k) (i32.load offset=32 (local.get $rp))) (then (return (i32.const 1))))
      (br_if $fail (i32.lt_s (local.get $r) (i32.const 0)))
      (local.set $f (i32.add (i32.add (local.get $rp) (i32.const 40)) (i32.shl (local.get $k) (i32.const 4))))
      (local.set $col (call $i32col (local.get $t) (i32.load (local.get $f))))
      (br_if $fail (i32.eqz (local.get $col)))
      (local.set $v (call $cellv (local.get $t) (local.get $col) (local.get $r)))
      (local.set $cmp (i32.load offset=4 (local.get $f)))
      (local.set $want (i64.load offset=8 (local.get $f)))
      (br_if $fail (i32.and (i32.eqz (local.get $cmp)) (i64.ne (local.get $v) (local.get $want))))
      (br_if $fail (i32.and (i32.eq (local.get $cmp) (i32.const 1)) (i64.lt_s (local.get $v) (local.get $want))))
      (br_if $fail (i32.and (i32.eq (local.get $cmp) (i32.const 2)) (i64.gt_s (local.get $v) (local.get $want))))
      (local.set $k (i32.add (local.get $k) (i32.const 1)))
      (br $each)))
    (i32.const 0))
  ;; The row at rp reaches node n (in the tree): down, its source's descendants; side, every node under its source's
  ;; side (the source's root, itself not included); all, every node in the tree.
  (func $reaches (param $t i32) (param $rp i32) (param $n i32) (result i32) (local $src i32) (local $reach i32) (local $r i32)
    (local.set $src (i32.load (local.get $rp)))
    (if (i32.eqz (call $live (local.get $t) (local.get $src))) (then (return (i32.const 0))))
    (local.set $reach (i32.load offset=12 (local.get $rp)))
    (if (i32.eqz (local.get $reach)) (then (return (call $under (local.get $t) (local.get $n) (local.get $src)))))
    (if (i32.eq (local.get $reach) (i32.const 1)) (then
      (local.set $r (call $root (local.get $t) (local.get $src)))
      (return (i32.and (i32.eq (call $root (local.get $t) (local.get $n)) (local.get $r)) (i32.ne (local.get $n) (local.get $r))))))
    (i32.const 1))
  (func $applies (param $t i32) (param $rp i32) (param $n i32) (param $s i32) (result i32)
    (if (i32.eqz (i32.load offset=104 (local.get $rp))) (then (return (i32.const 0))))
    (if (i32.ne (i32.load offset=4 (local.get $rp)) (local.get $s)) (then (return (i32.const 0))))
    (if (i32.eqz (call $reaches (local.get $t) (local.get $rp) (local.get $n))) (then (return (i32.const 0))))
    (call $holds (local.get $t) (local.get $rp) ${filterOn}))
  (func $compute (param $t i32) (param $n i32) (param $s i32) (result i64)
    (local $b i64) (local $add i64) (local $pct i64) (local $hasSet i32) (local $set i64) (local $setSrc i32)
    (local $hasCap i32) (local $cap i64) (local $id i32) (local $rp i32) (local $op i32) (local $v i64) (local $x i64) (local $parts i64)
    (local.set $b (call $base (local.get $t) (local.get $n) (local.get $s)))
    (if (i32.eqz (call $live (local.get $t) (local.get $n))) (then (return (local.get $b))))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $id) (i32.load offset=128 (local.get $t))))
      (local.set $rp (call $rowp (local.get $t) (local.get $id)))
      (if (call $applies (local.get $t) (local.get $rp) (local.get $n) (local.get $s)) (then
        (local.set $op (i32.load offset=8 (local.get $rp)))
        (local.set $v (i64.load offset=16 (local.get $rp)))
        (if (i32.eqz (local.get $op)) (then (local.set $add (i64.add (local.get $add) (local.get $v)))))
        (if (i32.eq (local.get $op) (i32.const 1)) (then (local.set $pct (i64.add (local.get $pct) (local.get $v)))))
        (if (i32.eq (local.get $op) (i32.const 2)) (then
          (if (i32.or (i32.eqz (local.get $hasSet)) (i32.ge_s (i32.load (local.get $rp)) (local.get $setSrc))) (then
            (local.set $hasSet (i32.const 1)) (local.set $set (local.get $v)) (local.set $setSrc (i32.load (local.get $rp)))))))
        (if (i32.eq (local.get $op) (i32.const 3)) (then
          (if (i32.or (i32.eqz (local.get $hasCap)) (i64.lt_s (local.get $v) (local.get $cap))) (then
            (local.set $hasCap (i32.const 1)) (local.set $cap (local.get $v))))))))
      (local.set $id (i32.add (local.get $id) (i32.const 1)))
      (br $each)))
    ${x}
    (if (local.get $hasSet) (then (local.set $x (i64.mul (local.get $set) (i64.const 100)))))
    (if (i32.and (local.get $hasCap) (i64.lt_s (i64.mul (local.get $cap) (i64.const 100)) (local.get $x))) (then
      (local.set $x (i64.mul (local.get $cap) (i64.const 100)))))
    (i64.div_s (local.get $x) (i64.const 100)))
  ${changed}
  (func $total (export "total") (param $t i32) (param $n i32) (param $s i32) (result i64) (local $c i32) (local $v i64)
    (if (i32.or (i32.ge_u (local.get $n) (i32.const 512)) (i32.ge_u (local.get $s) (i32.load offset=12 (local.get $t))))
      (then (return (i64.const 0))))
    (local.set $c (call $cachep (local.get $t) (local.get $n) (local.get $s)))
    (if (i32.eq (i32.load offset=8 (local.get $c)) (call $stamp (local.get $t))) (then (return (i64.load (local.get $c)))))
    (local.set $v (call $compute (local.get $t) (local.get $n) (local.get $s)))
    (i64.store (local.get $c) (local.get $v))
    (i32.store offset=8 (local.get $c) (call $stamp (local.get $t)))
    (local.get $v))
  (func $attach (export "attach") (param $t i32) (param $n i32) (param $p i32) (param $row i32) (local $rec i32)
    (if (i32.ge_u (local.get $n) (i32.const 512)) (then (return)))
    (if (i32.or (i32.lt_s (local.get $p) (i32.const -1)) (i32.ge_s (local.get $p) (i32.const 512))) (then (return)))
    (if (i32.ge_s (local.get $p) (i32.const 0)) (then
      (if (i32.eq (local.get $p) (local.get $n)) (then (return)))
      (if (call $under (local.get $t) (local.get $p) (local.get $n)) (then (return)))))
    (local.set $rec (call $node (local.get $t) (local.get $n)))
    (i32.store (local.get $rec) (i32.const 1))
    (i32.store offset=4 (local.get $rec) (local.get $p))
    (i32.store offset=8 (local.get $rec) (call $find (local.get $t) (local.get $row)))
    (call $changed (local.get $t) (local.get $n)))
  (func $detach (export "detach") (param $t i32) (param $n i32) (local $rec i32)
    (if (i32.ge_u (local.get $n) (i32.const 512)) (then (return)))
    (local.set $rec (call $node (local.get $t) (local.get $n)))
    (if (i32.ne (i32.load (local.get $rec)) (i32.const 1)) (then (return)))
    (i32.store (local.get $rec) (i32.const 2))
    (i32.store offset=4 (local.get $rec) (i32.const -1))
    (call $changed (local.get $t) (local.get $n)))
  (func $add (export "add") (param $t i32) (param $src i32) (result i32) (local $id i32) (local $rp i32) (local $i i32)
    (local.set $id (i32.load offset=128 (local.get $t)))
    (if (i32.ge_u (local.get $id) (i32.const 4096)) (then (return (i32.const -1))))
    (if (i32.ge_u (i32.load (local.get $src)) (i32.const 512)) (then (return (i32.const -1))))
    (if (i32.ge_u (i32.load offset=4 (local.get $src)) (i32.load offset=12 (local.get $t))) (then (return (i32.const -1))))
    (if (i32.gt_u (i32.load offset=8 (local.get $src)) (i32.const 3)) (then (return (i32.const -1))))
    (if (i32.gt_u (i32.load offset=12 (local.get $src)) (i32.const 2)) (then (return (i32.const -1))))
    (if (i32.gt_u (i32.load offset=24 (local.get $src)) (i32.const 2)) (then (return (i32.const -1))))
    (if (i32.gt_u (i32.load offset=32 (local.get $src)) (i32.const 4)) (then (return (i32.const -1))))
    (local.set $rp (call $rowp (local.get $t) (local.get $id)))
    (loop $copy
      (i32.store (i32.add (local.get $rp) (local.get $i)) (i32.load (i32.add (local.get $src) (local.get $i))))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br_if $copy (i32.lt_u (local.get $i) (i32.const 104))))
    (i32.store offset=104 (local.get $rp) (i32.const 1))
    (i32.store offset=108 (local.get $rp) (i32.load offset=28 (local.get $src)))
    (i32.store offset=128 (local.get $t) (i32.add (local.get $id) (i32.const 1)))
    (call $mark (local.get $t))
    (local.get $id))
  (func $remove (export "remove") (param $t i32) (param $id i32) (local $rp i32)
    (if (i32.ge_u (local.get $id) (i32.load offset=128 (local.get $t))) (then (return)))
    (local.set $rp (call $rowp (local.get $t) (local.get $id)))
    (if (i32.eqz (i32.load offset=104 (local.get $rp))) (then (return)))
    (i32.store offset=104 (local.get $rp) (i32.const 0))
    (call $mark (local.get $t)))
  (func $tick (export "tick") (param $t i32) (param $b i32) (local $id i32) (local $rp i32) (local $left i32)
    (if (i32.gt_u (local.get $b) (i32.const 1)) (then (return)))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $id) (i32.load offset=128 (local.get $t))))
      (local.set $rp (call $rowp (local.get $t) (local.get $id)))
      (if (i32.and (i32.load offset=104 (local.get $rp)) (i32.eq (i32.load offset=24 (local.get $rp)) (i32.add (local.get $b) (i32.const 1)))) (then
        (local.set $left (i32.sub (i32.load offset=108 (local.get $rp)) (i32.const 1)))
        (i32.store offset=108 (local.get $rp) (local.get $left))
        (if (i32.le_s (local.get $left) (i32.const 0)) (then (i32.store offset=104 (local.get $rp) (i32.const 0))))))
      (local.set $id (i32.add (local.get $id) (i32.const 1)))
      (br $each)))
    (call $mark (local.get $t))))`, 'library');
}
