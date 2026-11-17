// This suite's crawler, its twins, its play interface and its bots (README: The crawler). The crawler is one logic item,
// `crawler`, in WebAssembly text assembled by #533's assembler (tests/acceptance/533/wat, read only; built as
// helpers.ts says). Its region offsets are its own, read from `deep-logic check` of a piece with its reads and
// writes, so the program reads and writes where the logic module lays its entries out. Every program exports
// `memory`, `init(seed)`, `step(k)` and the immutable globals `reads_at` (0) and `writes_at` (40960), within the
// logic subset.
import { expect } from 'vitest';
import { checkCall, onLogic } from '../533/helpers.ts';
import { assemble, type Obj, type Program } from './helpers.ts';

export type { Program };

/** The grid: 32 × 32 cells, x east, y south, row-major, an i32 a cell. */
export const SIZE = 32;
/** Each class's one value (the interface's `classes`). */
export const CLASS = { open: 0, blocked: 1, door: 2, locked: 3, key: 4, exit: 5 } as const;
/** Three floors, depth 1 to 3; the goal deep is depth >= 3. */
export const FLOORS = 3;
/** The hero's hp at the start and after the potion on each floor below the first; the twin's potion heals to 120. */
export const HP = 100;
export const POTION_TWIN_HP = 120;
/** The wraith acts every 4th step (k % 4 == 3): it strikes a hero that took no move or descend that step, 10 hp a strike, when within one cell. */
export const WRAITH_EVERY = 4;
export const STRIKE = 10;
/** The twin that moves the hero down a floor on its own does so at every step k > 0 with k % 500 == 0. */
export const SINK_EVERY = 500;
/** The legal list: at most 4 moves, the descend and the wait; i32 rows of (action, a, b). */
export const MAX_ROWS = 6;
/** The interface's actions in declaration order: a legal row's `action` is this index. */
export const ACTIONS = ['move', 'wait', 'descend'] as const;

export type Variant = 'clean' | 'lag' | 'nofight' | 'sinker' | 'noturn' | 'potion';

/** The piece's controls: `aim`, a point control a move's cell goes on; `wait_key` and `stairs`, an actions control of one action each. */
export const CONTROLS: Obj = {
  aim: { kind: 'point' },
  wait_key: { kind: 'actions', actions: { wait: { keys: ['period'] } } },
  stairs: { kind: 'actions', actions: { descend: { keys: ['shift+period'] } } },
};
export const READS = ['aim', 'wait_key', 'stairs'];
/** The crawler's arrays (the noturn twin declares no `turn`). `rooms` counts each floor's rooms, for this suite's own reading. */
export function writesOf(v: Variant): Obj {
  return {
    grid: { type: 'i32', count: SIZE * SIZE }, cell: { type: 'i32', count: 4 }, hp: { type: 'i32', count: 2 },
    side: { type: 'i32', count: 2 }, alive: { type: 'i32', count: 2 },
    ...(v === 'noturn' ? {} : { turn: { type: 'i32' } }),
    depth: { type: 'i32' }, won: { type: 'i32' }, dead: { type: 'i32' },
    legal: { type: 'i32', count: 3 * MAX_ROWS }, nlegal: { type: 'i32' }, accepted: { type: 'i32' }, refused: { type: 'i32' },
    rooms: { type: 'i32', count: FLOORS },
  };
}

// ---------------------------------------------------------------------------------------------------
// The play interface (README: The surface), locked in the brief before generation.

export const ID = 'crawler';
const path = (name: string): string => `${ID}.${name}`;
/** The interface's array paths this suite reads from a run's values. */
export const PATH = {
  grid: path('grid'), cell: path('cell'), hp: path('hp'), turn: path('turn'), depth: path('depth'), won: path('won'), dead: path('dead'),
  legal: path('legal'), nlegal: path('nlegal'), accepted: path('accepted'), refused: path('refused'), rooms: path('rooms'),
} as const;

/**
 * The crawler's `game.play@1`: its grid, classes and locks, the hero (the self unit, row 0 of `units`), hp, depth, turn,
 * won and dead, and its move, wait and descend actions. `hp` and `depth` may be given as `{name, unit?, range?}`.
 */
export function crawlerPlay(o: { hp?: Obj | string; depth?: Obj | string } = {}): Obj {
  return {
    grid: {
      cells: PATH.grid, size: [SIZE, SIZE], shape: 'square', moves: 4,
      classes: { open: [CLASS.open], blocked: [CLASS.blocked], door: [CLASS.door], locked: [CLASS.locked], key: [CLASS.key], exit: [CLASS.exit] },
      locks: { [String(CLASS.locked)]: CLASS.key },
      floor: PATH.depth,
    },
    units: { cell: PATH.cell, hp: o.hp ?? PATH.hp, side: path('side'), alive: path('alive'), self: 0 },
    turn: PATH.turn,
    rewards: {},
    values: { depth: o.depth ?? PATH.depth, won: PATH.won, dead: PATH.dead },
    actions: {
      move: { control: 'aim', args: 'cell' },
      wait: { control: 'wait_key', action: 'wait', args: 'none' },
      descend: { control: 'stairs', action: 'descend', args: 'none' },
    },
    legal: { rows: PATH.legal, count: PATH.nlegal },
    accepted: PATH.accepted,
    refused: PATH.refused,
  };
}

// ---------------------------------------------------------------------------------------------------
// The bots, as Check input: playtest spells them, and the playtest's input.

export const DESCENDER: Obj = { descender: { action: 'descend', every: 1 } };
export const EXPLORER: Obj = { explorer: { every: 1 } };
export const LEGAL: Obj = { legal: { pick: 'seeded', every: 1 } };
/** A policy that only waits: the action `wait` named on its control every 0.25 s (README: The surface). */
export const WAITING: Obj = { policy: { pick: { wait_key: { from: ['wait'], every: 0.25 } } } };
/** Criterion 1's bots with their bands, in this order: the descender, the explorer, the seeded legal bot, the waiting policy. */
export const DESCENDER_BAND: Obj = { ...DESCENDER, share: { deep: [0.9, 1] } };
export const WAITING_BAND: Obj = { ...WAITING, expect: { deep: 'miss' }, share: { dead: [1, 1] } };

export const SEED = 555;
export const RUNS = 20;
export const SPAN_STEPS = 4000;
export const GOALS = [{ name: 'deep', when: 'depth >= 3' }, { name: 'dead', when: 'dead >= 1' }];
/** Criterion 1's playtest of `piece` under `play`: 20 runs a bot, seed 555, span {steps: 4,000}, the goals deep and dead, each run from its own seed. */
export function crawlerInput(piece: string, play: Obj, bots: Obj[], o: Obj = {}): Obj {
  return { piece, play, bots, runs: RUNS, seed: SEED, span: { steps: SPAN_STEPS }, goals: GOALS, piece_seed: 'run', frames: { every: 0 }, ...o };
}

// ---------------------------------------------------------------------------------------------------
// Layouts, from the logic module's own check.

interface Entry { region: string; name: string; offset: number; size: number }
function at(entries: Entry[], region: 'reads' | 'writes', name: string): number {
  const e = entries.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(entries)}`);
  return e.offset;
}
const end = (entries: Entry[], region: string): number => Math.max(0, ...entries.filter((e) => e.region === region).map((e) => e.offset + e.size));

export const READS_AT = 0;
export const WRITES_AT = 40960;
/** The program's own state, past the write region; each floor's cells from 65536, 4 KiB a floor. */
const STATE = 49152;
const META = 49408;
const ROOMS = 49664;
const FLOORS_AT = 65536;
const S = {
  rng: STATE, hx: STATE + 8, hy: STATE + 12, wx: STATE + 16, wy: STATE + 20, hp: STATE + 24, depth: STATE + 28, won: STATE + 32,
  dead: STATE + 36, turn: STATE + 40, accepted: STATE + 44, refused: STATE + 48, haskey: STATE + 52, px: STATE + 56, py: STATE + 60,
  dirty: STATE + 64,
};
const HEAD = `(memory (export "memory") 2 2)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))`;

const layouts = new Map<string, Entry[]>();
function layoutOf(v: Variant): Entry[] {
  const key = v === 'noturn' ? 'noturn' : 'all';
  const known = layouts.get(key);
  if (known) return known;
  const probe = assemble('probe555', `(module ${HEAD} (func (export "init") (param $seed i64)) (func (export "step") (param $k i64)))`);
  const p = {
    seed: SEED, class: 'figure', controls: CONTROLS,
    items: { [ID]: { kind: 'logic@1', params: { program: probe.sha, step_rate: 60, reads: READS, writes: writesOf(v) } } },
    assets: { [probe.sha]: probe.b64 },
  };
  const [reply] = onLogic([checkCall(p as never)]) as Obj[];
  expect(reply?.['ok'], `deep-logic check takes the crawler's layout probe: ${JSON.stringify(reply).slice(0, 1500)}`).toBe(true);
  const entries = reply!['items'][ID]['layout']['entries'] as Entry[];
  expect(end(entries, 'reads'), 'the read region ends before writes_at').toBeLessThanOrEqual(WRITES_AT - READS_AT);
  expect(WRITES_AT + end(entries, 'writes'), 'the write region ends before the program\'s own state').toBeLessThanOrEqual(STATE);
  layouts.set(key, entries);
  return entries;
}

// ---------------------------------------------------------------------------------------------------
// The crawler.

/**
 * The crawler. `init` generates three floors from its seed (the run's, with `piece_seed: run`): each 32 × 32, walled,
 * with 6 to 10 rooms in a 3 × 4 grid of slots taken in snake order, rooms 0 to R − 2 joined one to the next by
 * corridors whose ends are doors, and room R − 1 a vault joined to room R − 2 through one locked cell; the hero starts
 * in room 0, the exit is in room R − 2, the key in a room between, and a wraith starts in room R − 2's corner.
 * Each step it takes the step's entries: a press on `aim` at a cell next to the hero that it may enter moves it there
 * (a locked cell once it has stood on this floor's key); an entry on `stairs` while it stands on the exit descends
 * (floor 3's exit: won); an entry on `wait_key` waits when the hero has no move. Each other entry is refused. Then, every
 * 4th step, the wraith (it passes walls) steps toward the hero, or strikes it for 10 when within one cell and the hero
 * took no move or descend that step; at hp 0 the hero is dead. Arriving on a floor below the first, a living hero
 * drinks the floor's potion, which heals to 100. It publishes the floor, the units (hero, then wraith), turn (each
 * accepted entry), depth, won, dead, the legal rows (each move, the descend on the exit, the wait when there's no move;
 * none once dead or won) and the accepted and refused counts.
 * Twins: `lag` publishes the hero's cell as the step before left it; `nofight`'s wraith never strikes; `sinker` moves
 * the hero down a floor on its own at every 500th step; `noturn` publishes no turn array; `potion`'s potion heals to 120.
 */
export function crawlerProgram(v: Variant): Program {
  const l = layoutOf(v);
  const AIM = READS_AT + at(l, 'reads', 'aim');
  const WAIT = READS_AT + at(l, 'reads', 'wait_key');
  const STAIRS = READS_AT + at(l, 'reads', 'stairs');
  const W = (name: string): number => WRITES_AT + at(l, 'writes', name);
  return assemble(`crawler_${v}_${AIM}_${WAIT}_${STAIRS}_${W('grid')}`, crawlerText(v, AIM, WAIT, STAIRS, W));
}

/** The crawler's WebAssembly text, given where its reads and writes sit. */
export function crawlerText(v: Variant, AIM: number, WAIT: number, STAIRS: number, W: (name: string) => number): string {
  const ld = (a: number): string => `(i32.load (i32.const ${a}))`;
  const st = (a: number, v: string): string => `(i32.store (i32.const ${a}) ${v})`;
  const inc = (a: number): string => st(a, `(i32.add ${ld(a)} (i32.const 1))`);
  const c = (n: number): string => `(i32.const ${n})`;
  const potion = v === 'potion' ? POTION_TWIN_HP : HP;
  const text = `
(module
  ${HEAD}
  (func $rnd (param $n i32) (result i32) (local $s i64)
    (local.set $s (i64.add (i64.mul (i64.load (i32.const ${S.rng})) (i64.const 6364136223846793005)) (i64.const 1442695040888963407)))
    (i64.store (i32.const ${S.rng}) (local.get $s))
    (i32.rem_u (i32.wrap_i64 (i64.shr_u (local.get $s) (i64.const 33))) (local.get $n)))
  (func $abs (param $v i32) (result i32)
    (select (local.get $v) (i32.sub (i32.const 0) (local.get $v)) (i32.ge_s (local.get $v) (i32.const 0))))
  (func $at (param $f i32) (param $x i32) (param $y i32) (result i32)
    (i32.add (i32.add ${c(FLOORS_AT)} (i32.shl (local.get $f) (i32.const 12)))
      (i32.shl (i32.add (i32.shl (local.get $y) (i32.const 5)) (local.get $x)) (i32.const 2))))
  (func $put (param $f i32) (param $x i32) (param $y i32) (param $v i32)
    (i32.store (call $at (local.get $f) (local.get $x) (local.get $y)) (local.get $v)))
  (func $hline (param $f i32) (param $y i32) (param $a i32) (param $b i32) (local $x i32) (local $e i32)
    (local.set $x (select (local.get $a) (local.get $b) (i32.lt_s (local.get $a) (local.get $b))))
    (local.set $e (select (local.get $b) (local.get $a) (i32.lt_s (local.get $a) (local.get $b))))
    (block $done (loop $l
      (call $put (local.get $f) (local.get $x) (local.get $y) ${c(CLASS.open)})
      (br_if $done (i32.ge_s (local.get $x) (local.get $e)))
      (local.set $x (i32.add (local.get $x) (i32.const 1)))
      (br $l))))
  (func $vline (param $f i32) (param $x i32) (param $a i32) (param $b i32) (local $y i32) (local $e i32)
    (local.set $y (select (local.get $a) (local.get $b) (i32.lt_s (local.get $a) (local.get $b))))
    (local.set $e (select (local.get $b) (local.get $a) (i32.lt_s (local.get $a) (local.get $b))))
    (block $done (loop $l
      (call $put (local.get $f) (local.get $x) (local.get $y) ${c(CLASS.open)})
      (br_if $done (i32.ge_s (local.get $y) (local.get $e)))
      (local.set $y (i32.add (local.get $y) (i32.const 1)))
      (br $l))))
  ;; A slot's column in snake order: rows of 4, every other row right to left.
  (func $col (param $s i32) (result i32) (local $c i32)
    (local.set $c (i32.and (local.get $s) (i32.const 3)))
    (select (i32.sub (i32.const 3) (local.get $c)) (local.get $c) (i32.and (i32.shr_u (local.get $s) (i32.const 2)) (i32.const 1))))
  (func $room (param $p i32) (param $what i32) (result i32)
    (i32.load (i32.add (i32.add ${c(ROOMS)} (i32.shl (local.get $p) (i32.const 4))) (i32.shl (local.get $what) (i32.const 2)))))
  ;; A random cell of room p: x in the result's low half, y in its high half.
  (func $inside (param $p i32) (result i32)
    (i32.or
      (i32.add (call $room (local.get $p) (i32.const 0)) (call $rnd (call $room (local.get $p) (i32.const 2))))
      (i32.shl (i32.add (call $room (local.get $p) (i32.const 1)) (call $rnd (call $room (local.get $p) (i32.const 3)))) (i32.const 16))))
  ;; Room a joined to room a + 1 by a corridor whose ends are doors; the end at room a + 1 is locked when it's the vault.
  (func $join (param $f i32) (param $a i32) (param $vault i32)
    (local $b i32) (local $ra i32) (local $ca i32) (local $cb i32) (local $ya i32) (local $yb i32) (local $xm i32)
    (local $xs i32) (local $xe i32) (local $xa i32) (local $xb i32) (local $ym i32) (local $ys i32) (local $ye i32)
    (local.set $b (i32.add (local.get $a) (i32.const 1)))
    (local.set $ra (i32.shr_u (local.get $a) (i32.const 2)))
    (if (i32.eq (local.get $ra) (i32.shr_u (local.get $b) (i32.const 2)))
      (then
        (local.set $ca (call $col (local.get $a)))
        (local.set $cb (call $col (local.get $b)))
        (local.set $ya (i32.add (call $room (local.get $a) (i32.const 1)) (call $rnd (call $room (local.get $a) (i32.const 3)))))
        (local.set $yb (i32.add (call $room (local.get $b) (i32.const 1)) (call $rnd (call $room (local.get $b) (i32.const 3)))))
        (local.set $xm (i32.add (i32.shl (select (local.get $ca) (local.get $cb) (i32.lt_s (local.get $ca) (local.get $cb))) (i32.const 3)) (i32.const 7)))
        (if (i32.gt_s (local.get $cb) (local.get $ca))
          (then
            (local.set $xs (i32.add (call $room (local.get $a) (i32.const 0)) (call $room (local.get $a) (i32.const 2))))
            (local.set $xe (i32.sub (call $room (local.get $b) (i32.const 0)) (i32.const 1))))
          (else
            (local.set $xs (i32.sub (call $room (local.get $a) (i32.const 0)) (i32.const 1)))
            (local.set $xe (i32.add (call $room (local.get $b) (i32.const 0)) (call $room (local.get $b) (i32.const 2))))))
        (call $hline (local.get $f) (local.get $ya) (local.get $xs) (local.get $xm))
        (call $vline (local.get $f) (local.get $xm) (local.get $ya) (local.get $yb))
        (call $hline (local.get $f) (local.get $yb) (local.get $xm) (local.get $xe))
        (call $put (local.get $f) (local.get $xs) (local.get $ya) ${c(CLASS.door)})
        (call $put (local.get $f) (local.get $xe) (local.get $yb) (select ${c(CLASS.locked)} ${c(CLASS.door)} (local.get $vault))))
      (else
        (local.set $xa (i32.add (call $room (local.get $a) (i32.const 0)) (call $rnd (call $room (local.get $a) (i32.const 2)))))
        (local.set $xb (i32.add (call $room (local.get $b) (i32.const 0)) (call $rnd (call $room (local.get $b) (i32.const 2)))))
        (local.set $ym (i32.add (i32.mul (local.get $ra) (i32.const 10)) (i32.const 9)))
        (local.set $ys (i32.add (call $room (local.get $a) (i32.const 1)) (call $room (local.get $a) (i32.const 3))))
        (local.set $ye (i32.sub (call $room (local.get $b) (i32.const 1)) (i32.const 1)))
        (call $vline (local.get $f) (local.get $xa) (local.get $ys) (local.get $ym))
        (call $hline (local.get $f) (local.get $ym) (local.get $xa) (local.get $xb))
        (call $vline (local.get $f) (local.get $xb) (local.get $ym) (local.get $ye))
        (call $put (local.get $f) (local.get $xa) (local.get $ys) ${c(CLASS.door)})
        (call $put (local.get $f) (local.get $xb) (local.get $ye) (select ${c(CLASS.locked)} ${c(CLASS.door)} (local.get $vault))))))
  ;; Floor f: R rooms (6 to 10) in slots 0 to R − 1, joined in order, the last the vault; start, exit, key and wraith.
  (func $gen (param $f i32)
    (local $i i32) (local $R i32) (local $s i32) (local $row i32) (local $col i32) (local $w i32) (local $h i32)
    (local $x0 i32) (local $y0 i32) (local $p i32) (local $y i32) (local $m i32) (local $cell i32)
    (local.set $i (i32.const 0))
    (loop $fill
      (i32.store (i32.add (i32.add ${c(FLOORS_AT)} (i32.shl (local.get $f) (i32.const 12))) (i32.shl (local.get $i) (i32.const 2))) ${c(CLASS.blocked)})
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $fill (i32.lt_u (local.get $i) (i32.const ${SIZE * SIZE}))))
    (local.set $R (i32.add (i32.const 6) (call $rnd (i32.const 5))))
    (local.set $s (i32.const 0))
    (loop $rooms
      (local.set $row (i32.shr_u (local.get $s) (i32.const 2)))
      (local.set $col (call $col (local.get $s)))
      (local.set $w (i32.add (i32.const 3) (call $rnd (i32.const 3))))
      (local.set $h (i32.add (i32.const 3) (call $rnd (i32.const 4))))
      (local.set $x0 (i32.add (i32.add (i32.shl (local.get $col) (i32.const 3)) (i32.const 1)) (call $rnd (i32.sub (i32.const 6) (local.get $w)))))
      (local.set $y0 (i32.add (i32.add (i32.mul (local.get $row) (i32.const 10)) (i32.const 1)) (call $rnd (i32.sub (i32.const 8) (local.get $h)))))
      (local.set $p (i32.add ${c(ROOMS)} (i32.shl (local.get $s) (i32.const 4))))
      (i32.store (local.get $p) (local.get $x0))
      (i32.store offset=4 (local.get $p) (local.get $y0))
      (i32.store offset=8 (local.get $p) (local.get $w))
      (i32.store offset=12 (local.get $p) (local.get $h))
      (local.set $y (local.get $y0))
      (loop $rows
        (call $hline (local.get $f) (local.get $y) (local.get $x0) (i32.sub (i32.add (local.get $x0) (local.get $w)) (i32.const 1)))
        (local.set $y (i32.add (local.get $y) (i32.const 1)))
        (br_if $rows (i32.lt_s (local.get $y) (i32.add (local.get $y0) (local.get $h)))))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br_if $rooms (i32.lt_u (local.get $s) (local.get $R))))
    (local.set $s (i32.const 0))
    (loop $joins
      (call $join (local.get $f) (local.get $s) (i32.eq (i32.add (local.get $s) (i32.const 2)) (local.get $R)))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br_if $joins (i32.lt_u (local.get $s) (i32.sub (local.get $R) (i32.const 1)))))
    (local.set $m (i32.add ${c(META)} (i32.shl (local.get $f) (i32.const 5))))
    (local.set $cell (call $inside (i32.const 0)))
    (i32.store (local.get $m) (i32.and (local.get $cell) (i32.const 0xffff)))
    (i32.store offset=4 (local.get $m) (i32.shr_u (local.get $cell) (i32.const 16)))
    (local.set $cell (call $inside (i32.sub (local.get $R) (i32.const 2))))
    (call $put (local.get $f) (i32.and (local.get $cell) (i32.const 0xffff)) (i32.shr_u (local.get $cell) (i32.const 16)) ${c(CLASS.exit)})
    (i32.store offset=8 (local.get $m) (call $room (i32.sub (local.get $R) (i32.const 2)) (i32.const 0)))
    (i32.store offset=12 (local.get $m) (call $room (i32.sub (local.get $R) (i32.const 2)) (i32.const 1)))
    (local.set $cell (call $inside (i32.add (i32.const 1) (call $rnd (i32.sub (local.get $R) (i32.const 3))))))
    (call $put (local.get $f) (i32.and (local.get $cell) (i32.const 0xffff)) (i32.shr_u (local.get $cell) (i32.const 16)) ${c(CLASS.key)})
    (i32.store offset=16 (local.get $m) (local.get $R)))
  ;; The hero arrives on floor f at its start, the wraith at its corner; a living hero below the first floor drinks the potion.
  (func $enter (param $f i32) (local $m i32)
    (local.set $m (i32.add ${c(META)} (i32.shl (local.get $f) (i32.const 5))))
    ${st(S.hx, '(i32.load (local.get $m))')}
    ${st(S.hy, '(i32.load offset=4 (local.get $m))')}
    ${st(S.wx, '(i32.load offset=8 (local.get $m))')}
    ${st(S.wy, '(i32.load offset=12 (local.get $m))')}
    ${st(S.haskey, c(0))}
    ${st(S.dirty, c(1))}
    (if (i32.and (i32.gt_u (local.get $f) (i32.const 0)) (i32.eqz ${ld(S.dead)})) (then ${st(S.hp, c(potion))})))
  (func $down
    (if (i32.lt_s ${ld(S.depth)} (i32.const ${FLOORS}))
      (then ${st(S.depth, `(i32.add ${ld(S.depth)} (i32.const 1))`)} (call $enter (i32.sub ${ld(S.depth)} (i32.const 1))))
      (else ${st(S.won, c(1))})))
  ;; The current floor's value at (x, y); blocked off the grid.
  (func $here (param $x i32) (param $y i32) (result i32)
    (if (result i32) (i32.or (i32.ge_u (local.get $x) (i32.const ${SIZE})) (i32.ge_u (local.get $y) (i32.const ${SIZE})))
      (then ${c(CLASS.blocked)})
      (else (i32.load (call $at (i32.sub ${ld(S.depth)} (i32.const 1)) (local.get $x) (local.get $y))))))
  (func $pass (param $x i32) (param $y i32) (result i32) (local $v i32)
    (local.set $v (call $here (local.get $x) (local.get $y)))
    (i32.or
      (i32.or (i32.or (i32.eq (local.get $v) ${c(CLASS.open)}) (i32.eq (local.get $v) ${c(CLASS.door)}))
              (i32.or (i32.eq (local.get $v) ${c(CLASS.key)}) (i32.eq (local.get $v) ${c(CLASS.exit)})))
      (i32.and (i32.eq (local.get $v) ${c(CLASS.locked)}) ${ld(S.haskey)})))
  (func $moves (result i32)
    (i32.add (i32.add (call $pass ${ld(S.hx)} (i32.sub ${ld(S.hy)} (i32.const 1))) (call $pass (i32.add ${ld(S.hx)} (i32.const 1)) ${ld(S.hy)}))
             (i32.add (call $pass ${ld(S.hx)} (i32.add ${ld(S.hy)} (i32.const 1))) (call $pass (i32.sub ${ld(S.hx)} (i32.const 1)) ${ld(S.hy)}))))
  (func $over (result i32) (i32.or ${ld(S.dead)} ${ld(S.won)}))
  (func $row (param $i i32) (param $a i32) (param $x i32) (param $y i32) (local $p i32)
    (local.set $p (i32.add ${c(W('legal'))} (i32.mul (local.get $i) (i32.const 12))))
    (i32.store (local.get $p) (local.get $a))
    (i32.store offset=4 (local.get $p) (local.get $x))
    (i32.store offset=8 (local.get $p) (local.get $y)))
  (func $list_move (param $n i32) (param $x i32) (param $y i32) (result i32)
    (if (result i32) (call $pass (local.get $x) (local.get $y))
      (then (call $row (local.get $n) (i32.const 0) (local.get $x) (local.get $y)) (i32.add (local.get $n) (i32.const 1)))
      (else (local.get $n))))
  (func (export "init") (param $seed i64)
    (i64.store (i32.const ${S.rng}) (i64.xor (local.get $seed) (i64.const 0x2545f4914f6cdd1d)))
    (call $gen (i32.const 0))
    (call $gen (i32.const 1))
    (call $gen (i32.const 2))
    ${st(S.depth, c(1))}
    ${st(S.hp, c(HP))}
    (call $enter (i32.const 0))
    ${st(S.px, ld(S.hx))}
    ${st(S.py, ld(S.hy))})
  (func (export "step") (param $k i64)
    (local $n i32) (local $j i32) (local $rec i32) (local $fx f64) (local $fy f64) (local $x i32) (local $y i32)
    (local $ok i32) (local $acted i32) (local $dx i32) (local $dy i32) (local $i i32) (local $from i32)
    ;; Presses on aim: a move to the cell pressed.
    (local.set $n ${ld(AIM)})
    (local.set $j (i32.const 0))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
      (local.set $rec (i32.add (i32.const ${AIM + 16}) (i32.shl (local.get $j) (i32.const 8))))
      (if (i32.eqz (i32.load8_u (local.get $rec)))
        (then
          (local.set $ok (i32.const 0))
          (if (i32.and (i32.eqz (call $over)) (i32.and (i32.load8_u offset=3 (local.get $rec)) (i32.const 1)))
            (then
              (local.set $fx (f64.load offset=8 (local.get $rec)))
              (local.set $fy (f64.load offset=16 (local.get $rec)))
              (if (i32.and (i32.and (f64.ge (local.get $fx) (f64.const 0)) (f64.lt (local.get $fx) (f64.const ${SIZE})))
                           (i32.and (f64.ge (local.get $fy) (f64.const 0)) (f64.lt (local.get $fy) (f64.const ${SIZE}))))
                (then
                  (local.set $x (i32.trunc_f64_s (local.get $fx)))
                  (local.set $y (i32.trunc_f64_s (local.get $fy)))
                  (if (i32.and
                        (i32.eq (i32.add (call $abs (i32.sub (local.get $x) ${ld(S.hx)})) (call $abs (i32.sub (local.get $y) ${ld(S.hy)}))) (i32.const 1))
                        (call $pass (local.get $x) (local.get $y)))
                    (then (local.set $ok (i32.const 1))))))))
          (if (local.get $ok)
            (then
              ${st(S.hx, '(local.get $x)')}
              ${st(S.hy, '(local.get $y)')}
              ${inc(S.accepted)}
              ${inc(S.turn)}
              (local.set $acted (i32.const 1))
              (if (i32.eq (call $here (local.get $x) (local.get $y)) ${c(CLASS.key)}) (then ${st(S.haskey, c(1))})))
            (else ${inc(S.refused)}))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $each)))
    ;; Entries on wait_key: a wait, taken only when the hero has no move.
    (local.set $n ${ld(WAIT)})
    (local.set $j (i32.const 0))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
      (if (i32.and (i32.eqz (call $over)) (i32.eqz (call $moves)))
        (then ${inc(S.accepted)} ${inc(S.turn)})
        (else ${inc(S.refused)}))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $each)))
    ;; Entries on stairs: a descend, taken on the exit.
    (local.set $n ${ld(STAIRS)})
    (local.set $j (i32.const 0))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
      (if (i32.and (i32.eqz (call $over)) (i32.eq (call $here ${ld(S.hx)} ${ld(S.hy)}) ${c(CLASS.exit)}))
        (then ${inc(S.accepted)} ${inc(S.turn)} (local.set $acted (i32.const 1)) (call $down))
        (else ${inc(S.refused)}))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $each)))
    ${v === 'sinker' ? `;; The twin: down a floor on its own every ${SINK_EVERY} steps.
    (if (i32.and (i64.gt_s (local.get $k) (i64.const 0)) (i64.eqz (i64.rem_u (local.get $k) (i64.const ${SINK_EVERY}))))
      (then (if (i32.lt_s ${ld(S.depth)} (i32.const ${FLOORS})) (then (call $down)))))` : ''}
    ;; The wraith, every ${WRAITH_EVERY}th step.
    (if (i32.and (i32.eqz (call $over)) (i64.eq (i64.rem_u (local.get $k) (i64.const ${WRAITH_EVERY})) (i64.const ${WRAITH_EVERY - 1})))
      (then
        (local.set $dx (i32.sub ${ld(S.hx)} ${ld(S.wx)}))
        (local.set $dy (i32.sub ${ld(S.hy)} ${ld(S.wy)}))
        (if (i32.le_s (i32.add (call $abs (local.get $dx)) (call $abs (local.get $dy))) (i32.const 1))
          (then
            ${v === 'nofight' ? '' : `(if (i32.eqz (local.get $acted))
              (then
                ${st(S.hp, `(i32.sub ${ld(S.hp)} (i32.const ${STRIKE}))`)}
                (if (i32.le_s ${ld(S.hp)} (i32.const 0)) (then ${st(S.hp, c(0))} ${st(S.dead, c(1))}))))`})
          (else
            (if (i32.ge_s (call $abs (local.get $dx)) (call $abs (local.get $dy)))
              (then ${st(S.wx, `(i32.add ${ld(S.wx)} (select (i32.const 1) (i32.const -1) (i32.gt_s (local.get $dx) (i32.const 0))))`)})
              (else ${st(S.wy, `(i32.add ${ld(S.wy)} (select (i32.const 1) (i32.const -1) (i32.gt_s (local.get $dy) (i32.const 0))))`)}))))))
    ;; Publish: the floor when it changed, the units, the counters and the legal rows.
    (if ${ld(S.dirty)}
      (then
        (local.set $from (i32.add ${c(FLOORS_AT)} (i32.shl (i32.sub ${ld(S.depth)} (i32.const 1)) (i32.const 12))))
        (local.set $i (i32.const 0))
        (loop $copy
          (i32.store (i32.add ${c(W('grid'))} (local.get $i)) (i32.load (i32.add (local.get $from) (local.get $i))))
          (local.set $i (i32.add (local.get $i) (i32.const 4)))
          (br_if $copy (i32.lt_u (local.get $i) (i32.const ${SIZE * SIZE * 4}))))
        ${st(S.dirty, c(0))}))
    ${v === 'lag' ? `${st(W('cell'), ld(S.px))}
    ${st(W('cell') + 4, ld(S.py))}` : `${st(W('cell'), ld(S.hx))}
    ${st(W('cell') + 4, ld(S.hy))}`}
    ${st(S.px, ld(S.hx))}
    ${st(S.py, ld(S.hy))}
    ${st(W('cell') + 8, ld(S.wx))}
    ${st(W('cell') + 12, ld(S.wy))}
    ${st(W('hp'), ld(S.hp))}
    ${st(W('hp') + 4, c(50))}
    ${st(W('side'), c(0))}
    ${st(W('side') + 4, c(1))}
    ${st(W('alive'), `(i32.eqz ${ld(S.dead)})`)}
    ${st(W('alive') + 4, c(1))}
    ${v === 'noturn' ? '' : st(W('turn'), ld(S.turn))}
    ${st(W('depth'), ld(S.depth))}
    ${st(W('won'), ld(S.won))}
    ${st(W('dead'), ld(S.dead))}
    ${st(W('accepted'), ld(S.accepted))}
    ${st(W('refused'), ld(S.refused))}
    ${st(W('rooms'), ld(META + 16))}
    ${st(W('rooms') + 4, ld(META + 32 + 16))}
    ${st(W('rooms') + 8, ld(META + 64 + 16))}
    (local.set $i (i32.const 0))
    (loop $clear
      (i32.store (i32.add ${c(W('legal'))} (local.get $i)) (i32.const 0))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br_if $clear (i32.lt_u (local.get $i) (i32.const ${3 * MAX_ROWS * 4}))))
    (local.set $n (i32.const 0))
    (if (i32.eqz (call $over))
      (then
        (local.set $n (call $list_move (local.get $n) ${ld(S.hx)} (i32.sub ${ld(S.hy)} (i32.const 1))))
        (local.set $n (call $list_move (local.get $n) (i32.add ${ld(S.hx)} (i32.const 1)) ${ld(S.hy)}))
        (local.set $n (call $list_move (local.get $n) ${ld(S.hx)} (i32.add ${ld(S.hy)} (i32.const 1))))
        (local.set $n (call $list_move (local.get $n) (i32.sub ${ld(S.hx)} (i32.const 1)) ${ld(S.hy)}))
        (if (i32.eqz (local.get $n)) (then (call $row (local.get $n) (i32.const 1) (i32.const 0) (i32.const 0)) (local.set $n (i32.const 1))))
        (if (i32.eq (call $here ${ld(S.hx)} ${ld(S.hy)}) ${c(CLASS.exit)})
          (then (call $row (local.get $n) (i32.const 2) (i32.const 0) (i32.const 0)) (local.set $n (i32.add (local.get $n) (i32.const 1)))))))
    ${st(W('nlegal'), '(local.get $n)')}))`;
  return text;
}

/** The piece as the replica and `deep-logic` take it: the crawler alone, of class figure, at 60 Hz. */
export function crawlerPiece(program: Program, v: Variant): Obj {
  return {
    seed: SEED, class: 'figure', controls: CONTROLS,
    items: { [ID]: { kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: READS, writes: writesOf(v) } } },
    assets: { [program.sha]: program.b64 },
  };
}
