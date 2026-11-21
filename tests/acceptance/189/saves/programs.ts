// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text. Every logic
// program exports `memory`, `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` and `writes_at`
// (Logic `logic@1`: Exports), keeps to the logic subset, and is built against its item's region map as `check`
// reports it (read first with `layoutProbe`), so its offsets are the item's. A program with a state layout exports the
// immutable global `layout_at`: a u32 of the layout bytes' length, then the bytes (README: State layouts).

import { assemble, watBytes, type Program, type Writes } from './helpers.ts';

/** A program built for no layout: `check` of an item naming it reports the item's region map. */
export const layoutProbe = (): Program => assemble('layout_probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 32768))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);

/** A control's entries in the read region: a u32 count, 4 zero bytes, then 16 bytes an entry, its f64 value at +8. */
const valueAt = (slot: number, j: string): string => `(f64.load (i32.add (i32.const ${slot + 16}) (i32.shl ${j} (i32.const 4))))`;
const WRITES_AT = 4096;

// ---------------------------------------------------------------------------------------------------
// The dungeon (criteria 1, 2, 3, 4, 11, 12, 13).

export const DUNGEON = 'dungeon';
/** The dungeon's memory: 32 MiB. */
export const DUNGEON_PAGES = 512;
/** Where its layout bytes sit (its active data segment 0) and its damage table (segment 1, four i32: 2, 3, 4, 5). */
export const LAYOUT_AT = 6144;
export const DAMAGE_AT = 8176;
const DAMAGE = [2, 3, 4, 5];
/** Its state as the first layout places it: a roster of 3 units of 4 i32 (hp, attack, guard, xp), gold, floor and a bag of 8 item keys. */
export const ROSTER_AT = 8192;
export const GOLD_AT = 8240;
export const FLOOR_AT = 12288;
export const BAG_AT = 16384;
/** The bag's keys from the start: four items. */
export const BAG_START = [11, 12, 13, 14];
/** The criterion-4 layout's roster: moved past the old 32 MiB. */
export const MOVED_ROSTER_AT = 32 * 1024 * 1024 + 8192;
/** The 1 KiB constant table of criterion 12's fix: active data segment 2, right after the damage table, 0xEE bytes. */
export const TABLE_AT = 8192;
export const TABLE_BYTES = 1024;
/** The step whose end the dungeon saves slot 1 at: a save at step 1,800. */
export const SAVE_AT = 1799;
export const SAVED_AT = 1800;
export const DUNGEON_WRITES: Writes = {
  roster: { type: 'i32', count: 12 }, gold: { type: 'i32' }, floor: { type: 'i32' }, bag: { type: 'i32', count: 8 }, foe: { type: 'i32' }, request: { type: 'i32' },
};
/** The extra mutable global of criterion 3's program: its index in the program's global index space as written. */
export const EXTRA_GLOBAL_INDEX = 5;

export interface Field { name: string; offset: number; type: 'i32' | 'i64'; count: number }
/** A state layout's bytes (README: State layouts): JSON `{name, version, fields: [{name, offset, type, count}]}`. */
export const layoutBytes = (version: number, fields: Field[]): Buffer => Buffer.from(JSON.stringify({ name: 'dungeon', version, fields }));
const f = (name: string, offset: number, count = 1, type: 'i32' | 'i64' = 'i32'): Field => ({ name, offset, type, count });
/** The dungeon's first layout. */
export const V1 = layoutBytes(1, [f('roster', ROSTER_AT, 12), f('gold', GOLD_AT), f('floor', FLOOR_AT), f('bag', BAG_AT, 8)]);
/** Criterion 1's change: a field (`torch`) inserted before the roster, which moves the roster and gold. */
export const V2 = layoutBytes(2, [f('torch', ROSTER_AT), f('roster', ROSTER_AT + 4, 12), f('gold', GOLD_AT + 4), f('floor', FLOOR_AT), f('bag', BAG_AT, 8)]);
/** Criterion 13's change: `torch` inserted before the roster, gold renamed to coins, floor widened to i64 in place. */
export const V3 = layoutBytes(3, [f('torch', ROSTER_AT), f('roster', ROSTER_AT + 4, 12), f('coins', GOLD_AT + 4), f('floor', FLOOR_AT, 1, 'i64'), f('bag', BAG_AT, 8)]);
/** Criterion 4's new layout, at 48 MiB: the roster moved past the old memory. */
export const V48 = layoutBytes(2, [f('roster', MOVED_ROSTER_AT, 12), f('gold', GOLD_AT), f('floor', FLOOR_AT), f('bag', BAG_AT, 8)]);

/** A dungeon program: where its code keeps each field, which layout bytes it exports, and its other changes. */
export interface Variant {
  name: string;
  /** The layout bytes it exports at `layout_at`, or null: it exports no layout (no `layout_at`, no segment 0). */
  layout: Buffer | null;
  pages: number;
  roster: number; gold: number; floor: number; floorType: 'i32' | 'i64'; bag: number;
  /** The damage formula: the unit's attack times this, plus the damage table's entry, less 3. */
  attack: 1 | 2;
  /** One more mutable global, declared last (criterion 3). */
  extra?: boolean;
  /** The 1 KiB constant table as active segment 2 (criterion 12). */
  table?: boolean;
  /** One `nop` more in `step`: another program whose state means the same. */
  nop?: boolean;
}
const base = { pages: DUNGEON_PAGES, roster: ROSTER_AT, gold: GOLD_AT, floor: FLOOR_AT, floorType: 'i32' as const, bag: BAG_AT, attack: 1 as const };
const shifted = { roster: ROSTER_AT + 4, gold: GOLD_AT + 4 };
export const VARIANTS = {
  /** The dungeon as first written, exporting the first layout. */
  old: { name: 'old', layout: V1, ...base },
  /** Criteria 1, 2, 11: a fix that changes only the damage formula (attack × 2) and keeps the layout. */
  fix: { name: 'fix', layout: V1, ...base, attack: 2 },
  /** Criterion 1: a change that inserts `torch` before the roster and exports a new layout. */
  inserted: { name: 'inserted', layout: V2, ...base, ...shifted },
  /** Criterion 2's planted program: it keeps its state as `inserted` does but still exports the first layout's bytes. */
  shifted: { name: 'shifted', layout: V1, ...base, ...shifted },
  /** Criterion 3: the first layout's bytes and one more mutable global than a save holds. */
  extra: { name: 'extra', layout: V1, ...base, extra: true },
  /** Criterion 12: a fix that adds a 1 KiB constant table right after the damage table, over where the roster lives. */
  table: { name: 'table', layout: V1, ...base, table: true },
  /** Criterion 13: torch inserted, gold renamed to coins, floor widened to i64. */
  v3: { name: 'v3', layout: V3, ...base, ...shifted, floorType: 'i64' },
  /** Criterion 4: the dungeon at 48 MiB with the roster moved. */
  m48: { name: 'm48', layout: V48, ...base, pages: 768, roster: MOVED_ROSTER_AT },
  /** Criterion 3: the dungeon exporting no layout, and the same with a `nop` more. */
  bare: { name: 'bare', layout: null, ...base },
  bareNop: { name: 'bare_nop', layout: null, ...base, nop: true },
} satisfies Record<string, Variant>;

/** The region offsets a dungeon program is built against: its `move` slot and its arrays. */
export interface Regions { move: number; writes: Record<string, number> }

/**
 * The dungeon: a roster of 3 units of (hp, attack, guard, xp), gold, a floor, a bag of item keys, and a foe whose hp
 * and a xorshift64 generator are mutable globals. Each entry of the `move` control a step reads adds (its index in the
 * step + 1) to the xp of unit (value mod 3) and (value + 1) to gold. Each step moves unit (k mod 3)'s hp by the
 * generator's next value (−1 to +2), goes down a floor when the value's bits 20 to 27 are zero, and hits the foe with
 * the damage formula; a foe at 0 or below is replaced at 50 hp. So the damage formula changes only `foe`: the roster,
 * gold, floor and bag follow the same path under `fix` as under `old`. It writes 1 into `request` at the end of step
 * 1,799 (a save of slot 1 at step 1,800). Item: reads ["move"], writes DUNGEON_WRITES, budget memory pages ÷ 16 MiB.
 */
export function dungeon(v: Variant, r: Regions): Program {
  const w = (n: string): number => WRITES_AT + r.writes[n]!;
  const floorLoad = v.floorType === 'i64' ? `(i32.wrap_i64 (i64.load (i32.const ${v.floor})))` : `(i32.load (i32.const ${v.floor}))`;
  const floorStore = (x: string): string => (v.floorType === 'i64' ? `(i64.store (i32.const ${v.floor}) (i64.extend_i32_u ${x}))` : `(i32.store (i32.const ${v.floor}) ${x})`);
  const header = v.layout ? Buffer.concat([Buffer.from(Uint32Array.of(v.layout.length).buffer), v.layout]) : null;
  const damage = Buffer.from(Int32Array.from(DAMAGE).buffer);
  return assemble(`dungeon_${v.name}_${r.move}_${w('roster')}_${w('request')}`, `
(module
  (memory (export "memory") ${v.pages} ${v.pages})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  ${header ? `(global (export "layout_at") i32 (i32.const ${LAYOUT_AT}))` : ''}
  (global $rng (mut i64) (i64.const 0))
  (global $foe (mut i32) (i32.const 0))
  ${v.extra ? '(global $extra (mut i32) (i32.const 0))' : ''}
  ${header ? `(data (i32.const ${LAYOUT_AT}) "${watBytes(header)}")` : ''}
  (data (i32.const ${DAMAGE_AT}) "${watBytes(damage)}")
  ${v.table ? `(data (i32.const ${TABLE_AT}) "${'\\ee'.repeat(TABLE_BYTES)}")` : ''}
  (func $init (export "init") (param $seed i64) (local $u i32) (local $p i32)
    (global.set $rng (i64.or (local.get $seed) (i64.const 1)))
    (global.set $foe (i32.const 50))
    (loop $unit
      (local.set $p (i32.add (i32.const ${v.roster}) (i32.shl (local.get $u) (i32.const 4))))
      (i32.store (local.get $p) (i32.add (i32.const 1000) (i32.mul (local.get $u) (i32.const 100))))
      (i32.store offset=4 (local.get $p) (i32.add (i32.const 7) (local.get $u)))
      (i32.store offset=8 (local.get $p) (i32.add (i32.const 3) (local.get $u)))
      (local.set $u (i32.add (local.get $u) (i32.const 1)))
      (br_if $unit (i32.lt_u (local.get $u) (i32.const 3))))
    ${floorStore('(i32.const 1)')}
    ${BAG_START.map((k, i) => `(i32.store (i32.const ${v.bag + 4 * i}) (i32.const ${k}))`).join(' ')})
  (func $next (result i64)
    (global.set $rng (i64.xor (global.get $rng) (i64.shl (global.get $rng) (i64.const 13))))
    (global.set $rng (i64.xor (global.get $rng) (i64.shr_u (global.get $rng) (i64.const 7))))
    (global.set $rng (i64.xor (global.get $rng) (i64.shl (global.get $rng) (i64.const 17))))
    (global.get $rng))
  (func $step (export "step") (param $k i64) (local $n i32) (local $j i32) (local $v i32) (local $p i32) (local $r i64) (local $d i32)
    ${v.nop ? '(nop)' : ''}
    (local.set $n (i32.load (i32.const ${r.move})))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
      (local.set $v (i32.and (i32.trunc_f64_s ${valueAt(r.move, '(local.get $j)')}) (i32.const 7)))
      (local.set $p (i32.add (i32.const ${v.roster + 12}) (i32.shl (i32.rem_u (local.get $v) (i32.const 3)) (i32.const 4))))
      (i32.store (local.get $p) (i32.add (i32.load (local.get $p)) (i32.add (local.get $j) (i32.const 1))))
      (i32.store (i32.const ${v.gold}) (i32.add (i32.load (i32.const ${v.gold})) (i32.add (local.get $v) (i32.const 1))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $each)))
    (local.set $r (call $next))
    (local.set $p (i32.add (i32.const ${v.roster}) (i32.shl (i32.wrap_i64 (i64.rem_u (local.get $k) (i64.const 3))) (i32.const 4))))
    (i32.store (local.get $p) (i32.add (i32.load (local.get $p)) (i32.sub (i32.wrap_i64 (i64.and (local.get $r) (i64.const 3))) (i32.const 1))))
    (if (i64.eqz (i64.and (i64.shr_u (local.get $r) (i64.const 20)) (i64.const 255)))
      (then ${floorStore(`(i32.add ${floorLoad} (i32.const 1))`)}))
    ;; the damage formula: the unit's attack × ${v.attack}, plus the damage table's entry for k mod 4, less the foe's guard of 3
    (local.set $d (i32.sub (i32.add (i32.mul (i32.load offset=4 (local.get $p)) (i32.const ${v.attack}))
      (i32.load (i32.add (i32.const ${DAMAGE_AT}) (i32.shl (i32.wrap_i64 (i64.and (local.get $k) (i64.const 3))) (i32.const 2))))) (i32.const 3)))
    (global.set $foe (i32.sub (global.get $foe) (local.get $d)))
    (if (i32.le_s (global.get $foe) (i32.const 0)) (then (global.set $foe (i32.const 50))))
    ${v.extra ? '(global.set $extra (i32.add (global.get $extra) (i32.const 1)))' : ''}
    (memory.copy (i32.const ${w('roster')}) (i32.const ${v.roster}) (i32.const 48))
    (i32.store (i32.const ${w('gold')}) (i32.load (i32.const ${v.gold})))
    (i32.store (i32.const ${w('floor')}) ${floorLoad})
    (memory.copy (i32.const ${w('bag')}) (i32.const ${v.bag}) (i32.const 32))
    (i32.store (i32.const ${w('foe')}) (global.get $foe))
    (i32.store (i32.const ${w('request')}) (i64.eq (local.get $k) (i64.const ${SAVE_AT})))))`);
}

/** Criterion 4's remap table asset (README: Migrations): a u32 count, then each pair of i32 keys, old then new. */
export const RENAMED: [number, number][] = [[11, 211], [12, 212], [13, 213]];
export const remapTable = (): Buffer => Buffer.from(Int32Array.from([RENAMED.length, ...RENAMED.flat()]).buffer);

const OLD_N = DUNGEON_PAGES * 65_536;
const NEW_N = VARIANTS.m48.pages * 65_536;
/** The dungeon's mutable globals, rng (i64) and foe (i32): 8 bytes each in a state block. */
const GLOBALS = 2;
const REMAP_AT = 0;
const OLD_AT = 65_536;
const NEW_AT = OLD_AT + OLD_N + 65_536;
/** Its memory: the remap page, the old block, the new block; 1,283 pages, within the new memory plus the old plus 4 MiB. */
const MIGRATION_PAGES = Math.ceil((NEW_AT + 4 + NEW_N + 4 + 8 * GLOBALS) / 65_536);
/**
 * Criterion 4's migration (Logic: saves across changes; README: Migrations) from the dungeon's first layout at 32 MiB
 * to V48 at 48 MiB. The logic module writes the old state block at `old_at` and the remap table at `remap_at`;
 * `migrate()` copies the old 32 MiB into the new block (33,554,432 bytes, so over 33,000,000 fuel by the byte), moves
 * the roster to MOVED_ROSTER_AT and zeroes its old place, renames each bag key the remap table lists, and copies the
 * mutable globals. A block whose memory isn't 32 MiB traps.
 */
export const migration = (): Program => assemble('migration_32_to_48', `
(module
  (memory (export "memory") ${MIGRATION_PAGES} ${MIGRATION_PAGES})
  (global (export "remap_at") i32 (i32.const ${REMAP_AT}))
  (global (export "old_at") i32 (i32.const ${OLD_AT}))
  (global (export "new_at") i32 (i32.const ${NEW_AT}))
  (func (export "migrate") (local $i i32) (local $j i32) (local $key i32) (local $at i32)
    (if (i32.ne (i32.load (i32.const ${OLD_AT})) (i32.const ${OLD_N})) (then (unreachable)))
    (i32.store (i32.const ${NEW_AT}) (i32.const ${NEW_N}))
    (memory.copy (i32.const ${NEW_AT + 4}) (i32.const ${OLD_AT + 4}) (i32.const ${OLD_N}))
    (memory.copy (i32.const ${NEW_AT + 4 + MOVED_ROSTER_AT}) (i32.const ${NEW_AT + 4 + ROSTER_AT}) (i32.const 48))
    (memory.fill (i32.const ${NEW_AT + 4 + ROSTER_AT}) (i32.const 0) (i32.const 48))
    (loop $slot
      (local.set $at (i32.add (i32.const ${NEW_AT + 4 + BAG_AT}) (i32.shl (local.get $i) (i32.const 2))))
      (local.set $key (i32.load (local.get $at)))
      (local.set $j (i32.const 0))
      (block $found (loop $look
        (br_if $found (i32.ge_u (local.get $j) (i32.load (i32.const ${REMAP_AT}))))
        (if (i32.eq (i32.load (i32.add (i32.const ${REMAP_AT + 4}) (i32.shl (local.get $j) (i32.const 3)))) (local.get $key))
          (then
            (i32.store (local.get $at) (i32.load (i32.add (i32.const ${REMAP_AT + 8}) (i32.shl (local.get $j) (i32.const 3)))))
            (br $found)))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $look)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $slot (i32.lt_u (local.get $i) (i32.const 8))))
    (i32.store (i32.const ${NEW_AT + 4 + NEW_N}) (i32.load (i32.const ${OLD_AT + 4 + OLD_N})))
    (memory.copy (i32.const ${NEW_AT + 8 + NEW_N}) (i32.const ${OLD_AT + 8 + OLD_N}) (i32.const ${8 * GLOBALS}))))`);

// ---------------------------------------------------------------------------------------------------
// The scribe (criteria 5 and 11): a 32 MiB memory whose game has written 48 of its pages.

export const SCRIBE = 'scribe';
export const SCRIBE_PAGES = 512;
/** The pages the scribe writes besides page 0 (its regions and counter): 10i + 1 for i in 1 to 47, so 11 to 471. */
export const SCRIBE_WRITTEN = Array.from({ length: 47 }, (_, i) => 10 * (i + 1) + 1);
export const SCRIBE_WRITES: Writes = { count: { type: 'i32' }, request: { type: 'i32' } };
/**
 * Criteria 5 and 11: init writes a byte at the last offset of each page in SCRIBE_WRITTEN; step k writes k + 1 at
 * byte 4,096 of page SCRIBE_WRITTEN[k mod 47], adds 1 to a counter at 8,192 (page 0) and writes it to `count`, and
 * writes 1 into `request` when it read an entry of the `save` control. So from step 47 on its memory holds a nonzero
 * byte in exactly 48 pages: page 0 and the 47. Item: reads ["save"], writes SCRIBE_WRITES, budget memory 32.
 */
export function scribe(r: { save: number; writes: Record<string, number> }): Program {
  const w = (n: string): number => WRITES_AT + r.writes[n]!;
  return assemble(`scribe_${r.save}_${w('count')}_${w('request')}`, `
(module
  (memory (export "memory") ${SCRIBE_PAGES} ${SCRIBE_PAGES})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func $page (param $i i32) (result i32)
    (i32.shl (i32.add (i32.mul (local.get $i) (i32.const 10)) (i32.const 1)) (i32.const 16)))
  (func $init (export "init") (param $seed i64) (local $i i32)
    (local.set $i (i32.const 1))
    (loop $each
      (i32.store8 (i32.add (call $page (local.get $i)) (i32.const 65535)) (local.get $i))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.le_u (local.get $i) (i32.const 47)))))
  (func $step (export "step") (param $k i64)
    (i32.store (i32.add (call $page (i32.add (i32.wrap_i64 (i64.rem_u (local.get $k) (i64.const 47))) (i32.const 1))) (i32.const 4096))
      (i32.wrap_i64 (i64.add (local.get $k) (i64.const 1))))
    (i32.store (i32.const 8192) (i32.add (i32.load (i32.const 8192)) (i32.const 1)))
    (i32.store (i32.const ${w('count')}) (i32.load (i32.const 8192)))
    (i32.store (i32.const ${w('request')}) (i32.ne (i32.load (i32.const ${r.save})) (i32.const 0)))))`);
}

// ---------------------------------------------------------------------------------------------------
// The roguelike (criterion 6).

export const ROGUE = 'rogue';
/** 64 MiB with a nonzero byte in every page, so a save is about 64 MiB and its write can be caught before its rename. */
export const ROGUE_PAGES = 1024;
export const ROGUE_WRITES: Writes = { hp: { type: 'i32' }, request: { type: 'i32' }, ends: { type: 'i32' } };
/** The hero's hp at the start: one less each step, so it reaches 0 at the end of step 2,999. */
export const HERO_HP = 3000;
export const ROGUE_SAVE_AT = 1799;
/**
 * Criterion 6: a roguelike whose hero loses 1 hp a step from HERO_HP. It writes slot 1 into `request` at the end of
 * step 1,799 (a save at step 1,800) and, at the end of the step whose loss brings the hero to 0 (step 2,999), slot 1
 * into `ends` (an ended save at step 3,000). Item: writes ROGUE_WRITES, saves {request, ends}, budget memory 64.
 */
export function roguelike(r: { writes: Record<string, number> }): Program {
  const w = (n: string): number => WRITES_AT + r.writes[n]!;
  return assemble(`rogue_${w('hp')}_${w('ends')}`, `
(module
  (memory (export "memory") ${ROGUE_PAGES} ${ROGUE_PAGES})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func $init (export "init") (param $seed i64) (local $i i32)
    (loop $page
      (i32.store8 (i32.add (i32.shl (local.get $i) (i32.const 16)) (i32.const 32768)) (i32.or (i32.and (local.get $i) (i32.const 127)) (i32.const 1)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $page (i32.lt_u (local.get $i) (i32.const ${ROGUE_PAGES}))))
    (i32.store (i32.const 8192) (i32.const ${HERO_HP})))
  (func $step (export "step") (param $k i64) (local $died i32)
    (if (i32.gt_s (i32.load (i32.const 8192)) (i32.const 0))
      (then
        (i32.store (i32.const 8192) (i32.sub (i32.load (i32.const 8192)) (i32.const 1)))
        (local.set $died (i32.eqz (i32.load (i32.const 8192))))))
    (i32.store (i32.const ${w('hp')}) (i32.load (i32.const 8192)))
    (i32.store (i32.const ${w('request')}) (i64.eq (local.get $k) (i64.const ${ROGUE_SAVE_AT})))
    (i32.store (i32.const ${w('ends')}) (local.get $died))))`);
}
