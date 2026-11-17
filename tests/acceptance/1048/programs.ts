// This suite's fixtures (README: Fixtures): the crawler's twins, the 2-layer map, the armor pair and the text fixture,
// each a logic item in WebAssembly text assembled by #533's assembler (#555's helper builds it from a copy). The clean
// fixture is #555's crawler itself (its programs.ts, read only); the twins below are a copy of its text with one
// planted change each, and ac01 checks that the copy's clean text assembles to #555's clean program byte for byte.
// Region offsets are read from `deep-logic check` of a probe with each piece's reads and writes, so every program reads
// and writes where the logic module lays its entries out.
import { expect } from 'vitest';
import { checkCall, onLogic } from '../533/helpers.ts';
import { CLASS, CONTROLS, FLOORS, HP, MAX_ROWS, READS, SEED as CRAWLER_SEED, SIZE, STRIKE, WRAITH_EVERY, crawlerPiece, writesOf } from '../555/programs.ts';
import { assemble, type Obj } from './helpers.ts';
import type { Program } from '../533/helpers.ts';

export type { Program };
export { CLASS, SIZE, CRAWLER_SEED };

// ---------------------------------------------------------------------------------------------------
// Layouts, from the logic module's own check.

interface Entry { region: string; name: string; offset: number; size: number }
const layouts = new Map<string, Entry[]>();
const head = (pages: number, readsAt: number, writesAt: number): string => `(memory (export "memory") ${pages} ${pages})
  (global (export "reads_at") i32 (i32.const ${readsAt}))
  (global (export "writes_at") i32 (i32.const ${writesAt}))`;
/** The layout `deep-logic check` gives a piece with these controls, reads and writes (its program a probe). */
function layoutOf(key: string, controls: Obj, reads: string[], writes: Obj, readsAt: number, writesAt: number, state: number): Entry[] {
  const known = layouts.get(key);
  if (known) return known;
  const probe = assemble(`probe1048_${key}`, `(module ${head(2, readsAt, writesAt)} (func (export "init") (param $seed i64)) (func (export "step") (param $k i64)))`);
  const p = {
    seed: 1048, class: 'figure', controls,
    items: { probe: { kind: 'logic@1', params: { program: probe.sha, step_rate: 60, reads, writes } } },
    assets: { [probe.sha]: probe.b64 },
  };
  const [reply] = onLogic([checkCall(p as never)]) as Obj[];
  expect(reply?.['ok'], `deep-logic check takes ${key}'s layout probe: ${JSON.stringify(reply).slice(0, 1500)}`).toBe(true);
  const entries = reply!['items']['probe']['layout']['entries'] as Entry[];
  const end = (region: string): number => Math.max(0, ...entries.filter((e) => e.region === region).map((e) => e.offset + e.size));
  expect(readsAt + end('reads'), `${key}: the read region ends before writes_at`).toBeLessThanOrEqual(writesAt);
  expect(writesAt + end('writes'), `${key}: the write region ends before the program's own state`).toBeLessThanOrEqual(state);
  layouts.set(key, entries);
  return entries;
}
function at(entries: Entry[], region: 'reads' | 'writes', name: string): number {
  const e = entries.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(entries)}`);
  return e.offset;
}

// ---------------------------------------------------------------------------------------------------
// The crawler's twins: #555's crawler text with one planted change each.

/**
 * `clean`: #555's crawler, unchanged. `wall`: a press on any wall (blocked) cell moves the hero into it, a move no row
 * lists. `descend`: lists descend on every cell, and takes it only on the exit, as the crawler does. `leak`: memory of
 * 10 MiB (160 pages, budget.memory 10); init writes one byte into each of pages 2 to 63, so with the crawler's own
 * pages 0 and 1 its memory holds 64 pages with a nonzero byte (4 MiB); then each step k with k % 1000 == 0 writes one
 * byte into page 64 + k / 1000 (to page 159): after step k, 65 + floor(k / 1000) pages. `calm`: the wraith never
 * strikes (#555's nofight, byte for byte). `pit`: calm, and the first cell the hero may enter from its start on the
 * first floor (north, east, south, west) is a pit: while the hero stands on it on floor 1, every entry is refused, though
 * the moves out stay listed.
 */
export type Twin = 'clean' | 'wall' | 'descend' | 'leak' | 'calm' | 'pit';
export const LEAK = { pages: 160, mib: 10, start: 64, every: 1000 } as const;

const C_READS_AT = 0;
const C_WRITES_AT = 40960;
const STATE = 49152;
const META = 49408;
const ROOMS = 49664;
const FLOORS_AT = 65536;
const S = {
  rng: STATE, hx: STATE + 8, hy: STATE + 12, wx: STATE + 16, wy: STATE + 20, hp: STATE + 24, depth: STATE + 28, won: STATE + 32,
  dead: STATE + 36, turn: STATE + 40, accepted: STATE + 44, refused: STATE + 48, haskey: STATE + 52, px: STATE + 56, py: STATE + 60,
  dirty: STATE + 64, pitx: STATE + 68, pity: STATE + 72,
};

/** A twin's program, assembled; its layout is the clean crawler's (same reads and writes). */
export function twinProgram(v: Twin): Program {
  const l = layoutOf('crawler', CONTROLS, READS, writesOf('clean'), C_READS_AT, C_WRITES_AT, STATE);
  const AIM = C_READS_AT + at(l, 'reads', 'aim');
  const WAIT = C_READS_AT + at(l, 'reads', 'wait_key');
  const STAIRS = C_READS_AT + at(l, 'reads', 'stairs');
  const W = (name: string): number => C_WRITES_AT + at(l, 'writes', name);
  return assemble(`crawler1048_${v}_${AIM}_${WAIT}_${STAIRS}_${W('grid')}`, twinText(v, AIM, WAIT, STAIRS, W));
}
/** A twin as the replica takes it: #555's crawler piece with the twin's program (the leak twin with budget.memory 10). */
export function twinPiece(program: Program, v: Twin): Obj {
  const p = crawlerPiece(program, 'clean');
  if (v === 'leak') p['items']['crawler']['params']['budget'] = { memory: LEAK.mib };
  return p;
}

/** The twin's WebAssembly text: #555's crawler text (crawlerText), with the twin's change. */
export function twinText(v: Twin, AIM: number, WAIT: number, STAIRS: number, W: (name: string) => number): string {
  const ld = (a: number): string => `(i32.load (i32.const ${a}))`;
  const st = (a: number, x: string): string => `(i32.store (i32.const ${a}) ${x})`;
  const inc = (a: number): string => st(a, `(i32.add ${ld(a)} (i32.const 1))`);
  const c = (n: number): string => `(i32.const ${n})`;
  const calm = v === 'calm' || v === 'pit';
  const HEAD = head(v === 'leak' ? LEAK.pages : 2, C_READS_AT, C_WRITES_AT);
  // The press's test: next to the hero and passable (the wall twin: or any wall cell; the pit twin: not from the pit).
  const near = '(i32.and\n                        (i32.eq (i32.add (call $abs (i32.sub (local.get $x) ' + ld(S.hx) + ')) (call $abs (i32.sub (local.get $y) ' + ld(S.hy) + '))) (i32.const 1))\n                        (call $pass (local.get $x) (local.get $y)))';
  const takes = v === 'wall' ? `(i32.or ${near} (i32.eq (call $here (local.get $x) (local.get $y)) ${c(CLASS.blocked)}))`
    : v === 'pit' ? `(i32.and ${near} (i32.eqz (call $inpit)))` : near;
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
    (if (i32.and (i32.gt_u (local.get $f) (i32.const 0)) (i32.eqz ${ld(S.dead)})) (then ${st(S.hp, c(HP))})))
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
  ${v === 'pit' ? `;; The twin's pit: the hero on it, on the first floor.
  (func $inpit (result i32)
    (i32.and (i32.eq ${ld(S.depth)} (i32.const 1))
      (i32.and (i32.eq ${ld(S.hx)} ${ld(S.pitx)}) (i32.eq ${ld(S.hy)} ${ld(S.pity)}))))
  ` : ''}(func $row (param $i i32) (param $a i32) (param $x i32) (param $y i32) (local $p i32)
    (local.set $p (i32.add ${c(W('legal'))} (i32.mul (local.get $i) (i32.const 12))))
    (i32.store (local.get $p) (local.get $a))
    (i32.store offset=4 (local.get $p) (local.get $x))
    (i32.store offset=8 (local.get $p) (local.get $y)))
  (func $list_move (param $n i32) (param $x i32) (param $y i32) (result i32)
    (if (result i32) (call $pass (local.get $x) (local.get $y))
      (then (call $row (local.get $n) (i32.const 0) (local.get $x) (local.get $y)) (i32.add (local.get $n) (i32.const 1)))
      (else (local.get $n))))
  (func (export "init") (param $seed i64)${v === 'leak' ? ' (local $p i32)' : ''}
    (i64.store (i32.const ${S.rng}) (i64.xor (local.get $seed) (i64.const 0x2545f4914f6cdd1d)))
    (call $gen (i32.const 0))
    (call $gen (i32.const 1))
    (call $gen (i32.const 2))
    ${st(S.depth, c(1))}
    ${st(S.hp, c(HP))}
    (call $enter (i32.const 0))
    ${st(S.px, ld(S.hx))}
    ${st(S.py, ld(S.hy))}${v === 'pit' ? `
    ;; The pit: the first cell the hero may enter from its start, north, east, south, west.
    ${st(S.pitx, ld(S.hx))}
    ${st(S.pity, ld(S.hy))}
    (if (call $pass (i32.sub ${ld(S.hx)} (i32.const 1)) ${ld(S.hy)}) (then ${st(S.pitx, `(i32.sub ${ld(S.hx)} (i32.const 1))`)} ${st(S.pity, ld(S.hy))}))
    (if (call $pass ${ld(S.hx)} (i32.add ${ld(S.hy)} (i32.const 1))) (then ${st(S.pitx, ld(S.hx))} ${st(S.pity, `(i32.add ${ld(S.hy)} (i32.const 1))`)}))
    (if (call $pass (i32.add ${ld(S.hx)} (i32.const 1)) ${ld(S.hy)}) (then ${st(S.pitx, `(i32.add ${ld(S.hx)} (i32.const 1))`)} ${st(S.pity, ld(S.hy))}))
    (if (call $pass ${ld(S.hx)} (i32.sub ${ld(S.hy)} (i32.const 1))) (then ${st(S.pitx, ld(S.hx))} ${st(S.pity, `(i32.sub ${ld(S.hy)} (i32.const 1))`)}))` : ''}${v === 'leak' ? `
    ;; The leak twin's memory: one byte in each of pages 2 to ${LEAK.start - 1}.
    (local.set $p (i32.const 2))
    (loop $pages
      (i32.store8 (i32.shl (local.get $p) (i32.const 16)) (i32.const 1))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br_if $pages (i32.lt_u (local.get $p) (i32.const ${LEAK.start}))))` : ''})
  (func (export "step") (param $k i64)
    (local $n i32) (local $j i32) (local $rec i32) (local $fx f64) (local $fy f64) (local $x i32) (local $y i32)
    (local $ok i32) (local $acted i32) (local $dx i32) (local $dy i32) (local $i i32) (local $from i32)${v === 'leak' ? ' (local $page i32)' : ''}
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
                  (if ${takes}
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
      (br $each)))${v === 'leak' ? `
    ;; The leak: one more page with a nonzero byte every ${LEAK.every} steps.
    (if (i64.eqz (i64.rem_u (local.get $k) (i64.const ${LEAK.every})))
      (then
        (local.set $page (i32.add (i32.const ${LEAK.start}) (i32.wrap_i64 (i64.div_u (local.get $k) (i64.const ${LEAK.every})))))
        (if (i32.lt_u (local.get $page) (i32.const ${LEAK.pages}))
          (then (i32.store8 (i32.shl (local.get $page) (i32.const 16)) (i32.const 1))))))` : ''}
    ;; The wraith, every ${WRAITH_EVERY}th step.
    (if (i32.and (i32.eqz (call $over)) (i64.eq (i64.rem_u (local.get $k) (i64.const ${WRAITH_EVERY})) (i64.const ${WRAITH_EVERY - 1})))
      (then
        (local.set $dx (i32.sub ${ld(S.hx)} ${ld(S.wx)}))
        (local.set $dy (i32.sub ${ld(S.hy)} ${ld(S.wy)}))
        (if (i32.le_s (i32.add (call $abs (local.get $dx)) (call $abs (local.get $dy))) (i32.const 1))
          (then
            ${calm ? '' : `(if (i32.eqz (local.get $acted))
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
    ${st(W('cell'), ld(S.hx))}
    ${st(W('cell') + 4, ld(S.hy))}
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
    ${st(W('turn'), ld(S.turn))}
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
        ${v === 'descend' ? ';; The twin lists descend on every cell.\n        (call $row (local.get $n) (i32.const 2) (i32.const 0) (i32.const 0)) (local.set $n (i32.add (local.get $n) (i32.const 1)))' : `(if (i32.eq (call $here ${ld(S.hx)} ${ld(S.hy)}) ${c(CLASS.exit)})
          (then (call $row (local.get $n) (i32.const 2) (i32.const 0) (i32.const 0)) (local.set $n (i32.add (local.get $n) (i32.const 1)))))`}))
    ${st(W('nlegal'), '(local.get $n)')}))`;
  return text;
}

// ---------------------------------------------------------------------------------------------------
// The 2-layer map (criterion 4): 16 × 16 cells a layer, a surface (layer 0) and a cave (layer 1).

export const MAP = {
  id: 'map', size: 16, layers: 2,
  /** Cells by (x, Y), Y = layer × 16 + y: the start, the gate's two ends, the teleporter's two ends, the exit. */
  start: [1, 1], g0: [5, 5], g1: [5, 21], t1: [10, 26], t0: [9, 9], exit: [14, 14],
  /** Classes: open 0, blocked 1, exit 5. */
  open: 0, blocked: 1, exitClass: 5,
} as const;
/** A cell's index: layer × 256 + y × 16 + x, which for (x, Y) is Y × 16 + x. */
export const idx = ([x, y]: readonly [number, number] | readonly number[]): number => y! * MAP.size + x!;
/** The links: the gate, two-way, from the surface down to the cave; the teleporter, one-way, from the cave up to the surface. */
export const LINKS: [number, number, number][] = [[idx(MAP.g0), idx(MAP.g1), 1], [idx(MAP.t1), idx(MAP.t0), 0]];
/** The open cells: on the surface room A (x 1 to 5, y 1 to 5, the start and the gate in it) and room B (x 9 to 14, y 9 to 14, the teleporter's end and the exit in it), walled apart; in the cave a corridor from the gate's lower end down to y 10 and east to the teleporter. */
export function mapCells(): number[] {
  const cells = new Array<number>(MAP.size * MAP.size * MAP.layers).fill(MAP.blocked);
  const open = (x: number, Y: number): void => { cells[Y * MAP.size + x] = MAP.open; };
  for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) open(x, y);
  for (let y = 9; y <= 14; y++) for (let x = 9; x <= 14; x++) open(x, y);
  for (let y = 5; y <= 10; y++) open(5, 16 + y);
  for (let x = 6; x <= 10; x++) open(x, 16 + 10);
  cells[idx(MAP.exit)] = MAP.exitClass;
  return cells;
}
const MAP_CONTROLS: Obj = { aim: { kind: 'point' } };
const MAP_READS = ['aim'];
const MAP_ROWS = 6;
const MAP_WRITES: Obj = {
  cells: { type: 'i32', count: MAP.size * MAP.size * MAP.layers }, cell: { type: 'i32', count: 2 },
  turn: { type: 'i32' }, accepted: { type: 'i32' }, refused: { type: 'i32' }, won: { type: 'i32' },
  legal: { type: 'i32', count: 3 * MAP_ROWS }, nlegal: { type: 'i32' }, links: { type: 'i32', count: 3 * LINKS.length }, nlinks: { type: 'i32' },
};
const M_STATE = 49152;
const M = { hx: M_STATE, hy: M_STATE + 4, turn: M_STATE + 8, accepted: M_STATE + 12, refused: M_STATE + 16, won: M_STATE + 20 };
/**
 * The map's program. `init` writes the cells and the links into its arrays and puts the hero on the start. Each step,
 * a press on `aim` at a cell (x, Y) moves the hero there when it is a passable cell (open or the exit) next to the
 * hero's on the same layer, or when a link joins the hero's cell to it (from to to, and back when two-way); every
 * other entry is refused. Standing on the exit sets won. It lists each such move as a row of `move` (action 0) with the
 * cell's x and Y, the 4 neighbours first (north, east, south, west), then the links.
 */
export function mapProgram(): Program {
  const l = layoutOf('map', MAP_CONTROLS, MAP_READS, MAP_WRITES, C_READS_AT, C_WRITES_AT, M_STATE);
  const AIM = C_READS_AT + at(l, 'reads', 'aim');
  const W = (name: string): number => C_WRITES_AT + at(l, 'writes', name);
  const ld = (a: number): string => `(i32.load (i32.const ${a}))`;
  const st = (a: number, x: string): string => `(i32.store (i32.const ${a}) ${x})`;
  const inc = (a: number): string => st(a, `(i32.add ${ld(a)} (i32.const 1))`);
  const cells = mapCells();
  const N = MAP.size;
  const openRuns: string[] = [];
  cells.forEach((v, i) => { if (v !== MAP.blocked) openRuns.push(`(i32.store (i32.const ${W('cells') + 4 * i}) (i32.const ${v}))`); });
  const linkStores = LINKS.flatMap((r, i) => r.map((v, j) => `(i32.store (i32.const ${W('links') + 12 * i + 4 * j}) (i32.const ${v}))`));
  const text = `
(module
  ${head(2, C_READS_AT, C_WRITES_AT)}
  ;; The class at (x, Y): blocked off the map.
  (func $cls (param $x i32) (param $y i32) (result i32)
    (if (result i32) (i32.or (i32.ge_u (local.get $x) (i32.const ${N})) (i32.ge_u (local.get $y) (i32.const ${N * MAP.layers})))
      (then (i32.const ${MAP.blocked}))
      (else (i32.load (i32.add (i32.const ${W('cells')}) (i32.shl (i32.add (i32.mul (local.get $y) (i32.const ${N})) (local.get $x)) (i32.const 2)))))))
  (func $pass (param $x i32) (param $y i32) (result i32) (local $v i32)
    (local.set $v (call $cls (local.get $x) (local.get $y)))
    (i32.or (i32.eq (local.get $v) (i32.const ${MAP.open})) (i32.eq (local.get $v) (i32.const ${MAP.exitClass}))))
  (func $abs (param $v i32) (result i32)
    (select (local.get $v) (i32.sub (i32.const 0) (local.get $v)) (i32.ge_s (local.get $v) (i32.const 0))))
  ;; Whether a link joins cell a to cell b: from a to b, or from b to a when two-way.
  (func $linked (param $a i32) (param $b i32) (result i32) (local $i i32) (local $p i32) (local $r i32)
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) ${ld(W('nlinks'))}))
      (local.set $p (i32.add (i32.const ${W('links')}) (i32.mul (local.get $i) (i32.const 12))))
      (if (i32.and (i32.eq (i32.load (local.get $p)) (local.get $a)) (i32.eq (i32.load offset=4 (local.get $p)) (local.get $b)))
        (then (local.set $r (i32.const 1))))
      (if (i32.and (i32.load offset=8 (local.get $p))
            (i32.and (i32.eq (i32.load offset=4 (local.get $p)) (local.get $a)) (i32.eq (i32.load (local.get $p)) (local.get $b))))
        (then (local.set $r (i32.const 1))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (local.get $r))
  ;; A move from the hero's cell to (x, Y): a passable neighbour on its layer, or a link's other end.
  (func $may (param $x i32) (param $y i32) (result i32) (local $hx i32) (local $hy i32)
    (local.set $hx ${ld(M.hx)})
    (local.set $hy ${ld(M.hy)})
    (i32.or
      (i32.and (call $pass (local.get $x) (local.get $y))
        (i32.and (i32.eq (i32.shr_u (local.get $y) (i32.const 4)) (i32.shr_u (local.get $hy) (i32.const 4)))
          (i32.eq (i32.add (call $abs (i32.sub (local.get $x) (local.get $hx))) (call $abs (i32.sub (local.get $y) (local.get $hy)))) (i32.const 1))))
      (call $linked (i32.add (i32.mul (local.get $hy) (i32.const ${N})) (local.get $hx)) (i32.add (i32.mul (local.get $y) (i32.const ${N})) (local.get $x)))))
  (func $row (param $n i32) (param $x i32) (param $y i32) (result i32) (local $p i32)
    (if (result i32) (i32.and (i32.lt_u (local.get $n) (i32.const ${MAP_ROWS})) (call $may (local.get $x) (local.get $y)))
      (then
        (local.set $p (i32.add (i32.const ${W('legal')}) (i32.mul (local.get $n) (i32.const 12))))
        (i32.store (local.get $p) (i32.const 0))
        (i32.store offset=4 (local.get $p) (local.get $x))
        (i32.store offset=8 (local.get $p) (local.get $y))
        (i32.add (local.get $n) (i32.const 1)))
      (else (local.get $n))))
  (func (export "init") (param $seed i64) (local $i i32)
    (loop $fill
      (i32.store (i32.add (i32.const ${W('cells')}) (i32.shl (local.get $i) (i32.const 2))) (i32.const ${MAP.blocked}))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $fill (i32.lt_u (local.get $i) (i32.const ${cells.length}))))
    ${openRuns.join('\n    ')}
    ${linkStores.join('\n    ')}
    ${st(W('nlinks'), `(i32.const ${LINKS.length})`)}
    ${st(M.hx, `(i32.const ${MAP.start[0]})`)}
    ${st(M.hy, `(i32.const ${MAP.start[1]})`)})
  (func (export "step") (param $k i64)
    (local $n i32) (local $j i32) (local $rec i32) (local $fx f64) (local $fy f64) (local $x i32) (local $y i32) (local $i i32) (local $p i32) (local $here i32)
    (local.set $n ${ld(AIM)})
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
      (local.set $rec (i32.add (i32.const ${AIM + 16}) (i32.shl (local.get $j) (i32.const 8))))
      (if (i32.eqz (i32.load8_u (local.get $rec)))
        (then
          (local.set $x (i32.const -1))
          (local.set $y (i32.const -1))
          (if (i32.and (i32.load8_u offset=3 (local.get $rec)) (i32.const 1))
            (then
              (local.set $fx (f64.load offset=8 (local.get $rec)))
              (local.set $fy (f64.load offset=16 (local.get $rec)))
              (if (i32.and (i32.and (f64.ge (local.get $fx) (f64.const 0)) (f64.lt (local.get $fx) (f64.const ${N})))
                           (i32.and (f64.ge (local.get $fy) (f64.const 0)) (f64.lt (local.get $fy) (f64.const ${N * MAP.layers}))))
                (then
                  (local.set $x (i32.trunc_f64_s (local.get $fx)))
                  (local.set $y (i32.trunc_f64_s (local.get $fy)))))))
          (if (i32.and (i32.ge_s (local.get $x) (i32.const 0)) (call $may (local.get $x) (local.get $y)))
            (then
              ${st(M.hx, '(local.get $x)')}
              ${st(M.hy, '(local.get $y)')}
              ${inc(M.accepted)}
              ${inc(M.turn)}
              (if (i32.eq (call $cls (local.get $x) (local.get $y)) (i32.const ${MAP.exitClass})) (then ${st(M.won, '(i32.const 1)')})))
            (else ${inc(M.refused)}))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $each)))
    ${st(W('cell'), ld(M.hx))}
    ${st(W('cell') + 4, ld(M.hy))}
    ${st(W('turn'), ld(M.turn))}
    ${st(W('accepted'), ld(M.accepted))}
    ${st(W('refused'), ld(M.refused))}
    ${st(W('won'), ld(M.won))}
    (local.set $i (i32.const 0))
    (loop $clear
      (i32.store (i32.add (i32.const ${W('legal')}) (local.get $i)) (i32.const 0))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br_if $clear (i32.lt_u (local.get $i) (i32.const ${3 * MAP_ROWS * 4}))))
    (local.set $n (i32.const 0))
    (local.set $n (call $row (local.get $n) ${ld(M.hx)} (i32.sub ${ld(M.hy)} (i32.const 1))))
    (local.set $n (call $row (local.get $n) (i32.add ${ld(M.hx)} (i32.const 1)) ${ld(M.hy)}))
    (local.set $n (call $row (local.get $n) ${ld(M.hx)} (i32.add ${ld(M.hy)} (i32.const 1))))
    (local.set $n (call $row (local.get $n) (i32.sub ${ld(M.hx)} (i32.const 1)) ${ld(M.hy)}))
    ;; The links from the hero's cell: each one's other end.
    (local.set $here (i32.add (i32.mul ${ld(M.hy)} (i32.const ${N})) ${ld(M.hx)}))
    (local.set $i (i32.const 0))
    (block $done (loop $links
      (br_if $done (i32.ge_u (local.get $i) ${ld(W('nlinks'))}))
      (local.set $p (i32.add (i32.const ${W('links')}) (i32.mul (local.get $i) (i32.const 12))))
      (if (i32.eq (i32.load (local.get $p)) (local.get $here))
        (then (local.set $n (call $row (local.get $n)
          (i32.rem_u (i32.load offset=4 (local.get $p)) (i32.const ${N})) (i32.div_u (i32.load offset=4 (local.get $p)) (i32.const ${N}))))))
      (if (i32.and (i32.load offset=8 (local.get $p)) (i32.eq (i32.load offset=4 (local.get $p)) (local.get $here)))
        (then (local.set $n (call $row (local.get $n)
          (i32.rem_u (i32.load (local.get $p)) (i32.const ${N})) (i32.div_u (i32.load (local.get $p)) (i32.const ${N}))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $links)))
    ${st(W('nlegal'), '(local.get $n)')}))`;
  return assemble(`map1048_${AIM}_${W('cells')}`, text);
}
export function mapPiece(program: Program): Obj {
  return {
    seed: 1048, class: 'figure', controls: MAP_CONTROLS,
    items: { [MAP.id]: { kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: MAP_READS, writes: MAP_WRITES } } },
    assets: { [program.sha]: program.b64 },
  };
}
const mp = (n: string): string => `${MAP.id}.${n}`;
export const MAP_PATH = { cells: mp('cells'), cell: mp('cell'), won: mp('won'), turn: mp('turn'), legal: mp('legal'), nlegal: mp('nlegal') } as const;
/** The map's `game.play@1`, with the issue's layers and links (README: The surface). */
export function mapPlay(): Obj {
  return {
    grid: {
      cells: mp('cells'), size: [MAP.size, MAP.size], layers: MAP.layers, links: { rows: mp('links'), count: mp('nlinks') },
      shape: 'square', moves: 4, classes: { open: [MAP.open], blocked: [MAP.blocked], exit: [MAP.exitClass] },
    },
    units: { cell: mp('cell'), self: 0 },
    turn: mp('turn'),
    values: { won: mp('won') },
    actions: { move: { control: 'aim', args: 'cell' } },
    legal: { rows: mp('legal'), count: mp('nlegal') },
    accepted: mp('accepted'),
    refused: mp('refused'),
  };
}

// ---------------------------------------------------------------------------------------------------
// The armor pair (criterion 5) and the text fixture (criterion 6): one logic item each, its state past a small write region.

const SMALL_READS_AT = 0;
const SMALL_WRITES_AT = 1024;
const SMALL_STATE = 2048;
export const ARMOR = { id: 'duel', range: [0, 10] as [number, number], start: 5, blow: 60 } as const;
const ARMOR_CONTROLS: Obj = { armor: { kind: 'slider', range: ARMOR.range, default: ARMOR.start, increment: 1 } };
const ARMOR_WRITES: Obj = { hurt: { type: 'i32' }, armor: { type: 'i32' } };
/**
 * The duel: armor starts at 5; each entry on the `armor` slider sets it to the entry's value (truncated) and deals a
 * blow, hurt = 60 / armor (i32.div_s), and a step with no entry deals one too. `clamp` false: armor 0 divides by zero
 * and traps (divide). `clamp` true (the clean twin): armor is held to at least 1 before the division.
 */
export function armorProgram(clamp: boolean): Program {
  const l = layoutOf('armor', ARMOR_CONTROLS, ['armor'], ARMOR_WRITES, SMALL_READS_AT, SMALL_WRITES_AT, SMALL_STATE);
  const A = SMALL_READS_AT + at(l, 'reads', 'armor');
  const W = (name: string): number => SMALL_WRITES_AT + at(l, 'writes', name);
  const set = clamp
    ? `(i32.store (i32.const ${SMALL_STATE}) (select (local.get $v) (i32.const 1) (i32.gt_s (local.get $v) (i32.const 1))))`
    : `(i32.store (i32.const ${SMALL_STATE}) (local.get $v))`;
  const text = `
(module
  ${head(1, SMALL_READS_AT, SMALL_WRITES_AT)}
  (func $blow
    (i32.store (i32.const ${W('hurt')}) (i32.div_s (i32.const ${ARMOR.blow}) (i32.load (i32.const ${SMALL_STATE}))))
    (i32.store (i32.const ${W('armor')}) (i32.load (i32.const ${SMALL_STATE}))))
  (func (export "init") (param $seed i64)
    (i32.store (i32.const ${SMALL_STATE}) (i32.const ${ARMOR.start})))
  (func (export "step") (param $k i64) (local $n i32) (local $j i32) (local $v i32)
    (local.set $n (i32.load (i32.const ${A})))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
      (local.set $v (i32.trunc_sat_f64_s (f64.load (i32.add (i32.const ${A + 16}) (i32.shl (local.get $j) (i32.const 4))))))
      ${set}
      (call $blow)
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $each)))
    (if (i32.eqz (local.get $n)) (then (call $blow)))))`;
  return assemble(`armor1048_${clamp ? 'clamped' : 'divides'}_${A}`, text);
}
export function armorPiece(program: Program): Obj {
  return {
    seed: 1048, class: 'figure', controls: ARMOR_CONTROLS,
    items: { [ARMOR.id]: { kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: ['armor'], writes: ARMOR_WRITES } } },
    assets: { [program.sha]: program.b64 },
  };
}
/** The duel's interface: the armor slider listed as an action, hurt held to [0, 60]. */
export function armorPlay(): Obj {
  return {
    actions: { armor: { control: 'armor', args: 'option' } },
    values: { hurt: { name: `${ARMOR.id}.hurt`, range: [0, ARMOR.blow] }, armor: `${ARMOR.id}.armor` },
  };
}
/** The duel's bot: armor 2, 5 or 8, every 0.25 s. */
export const ARMOR_POLICY: Obj = { policy: { pick: { armor: { from: [2, 5, 8], every: 0.25 } } } };

export const TAG = { id: 'tag', maxBytes: 60, region: 64 } as const;
const TAG_CONTROLS: Obj = { name: { kind: 'text', text: { max_bytes: TAG.maxBytes, lines: 'one' } } };
const TAG_WRITES: Obj = { initial: { type: 'i32' } };
/** The text control's read region: its u32 length and up to max_bytes, rounded up to a multiple of 8 (Control: text). */
export function tagRegion(): number {
  const l = layoutOf('tag', TAG_CONTROLS, ['name'], TAG_WRITES, SMALL_READS_AT, SMALL_WRITES_AT, SMALL_STATE);
  return l.find((e) => e.region === 'reads' && e.name === 'name')!.size;
}
/**
 * The name tag: each step it reads the name committed on `name` and writes its last byte as `initial`, indexing the
 * name at length − 1 with no test for an empty name: an empty name's index is past its end (0xFFFFFFFF + the
 * region's offset), and the load traps (bounds).
 */
export function tagProgram(): Program {
  const l = layoutOf('tag', TAG_CONTROLS, ['name'], TAG_WRITES, SMALL_READS_AT, SMALL_WRITES_AT, SMALL_STATE);
  const NAME = SMALL_READS_AT + at(l, 'reads', 'name');
  const W = (name: string): number => SMALL_WRITES_AT + at(l, 'writes', name);
  const text = `
(module
  ${head(1, SMALL_READS_AT, SMALL_WRITES_AT)}
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64)
    (i32.store (i32.const ${W('initial')})
      (i32.load8_u offset=${NAME + 4} (i32.sub (i32.load (i32.const ${NAME})) (i32.const 1))))))`;
  return assemble(`tag1048_${NAME}`, text);
}
export function tagPiece(program: Program): Obj {
  return {
    seed: 1048, class: 'figure', controls: TAG_CONTROLS,
    items: { [TAG.id]: { kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: ['name'], writes: TAG_WRITES } } },
    assets: { [program.sha]: program.b64 },
  };
}
/** The tag's interface: the text control listed as an action, initial held to [0, 255]. */
export function tagPlay(): Obj {
  return { actions: { rename: { control: 'name', args: 'none' } }, values: { initial: { name: `${TAG.id}.initial`, range: [0, 255] } } };
}
/** The tag's bot: a name committed every step (README: The surface: a policy's string on a text control is its commit). */
export const TAG_POLICY: Obj = { policy: { pick: { name: { from: ['ann', 'bo', 'cyd'], every: 1 / 60 } } } };
