type Obj = { [key: string]: any };

export type Twin = 'clean' | 'spikes' | 'timer' | 'blip';

export const ID = 'crawler';
export const WIDTH = 18;
export const HEIGHT = 3;
export const CORRIDOR_ROW = 1;
export const CLASS = { open: 0, blocked: 1, door: 2, locked: 3, key: 4, exit: 5, trap: 6 } as const;
export const AT = { key: 9, door: 12, trap: 14, exit: 16 } as const;
export const TRAP_TAKES = 5;
export const WOUNDED_HP = 2;
export const BLIP_TWIN_HP = 9;
export const TIMER_STEP = 6;
export const BLIP_STEP = 811;
export const MAX_ROWS = 4;

const path = (name: string): string => `${ID}.${name}`;
export const PATH = {
  grid: path('grid'), cell: path('cell'), hp: path('hp'), turn: path('turn'), key: path('has_key'), door: path('door_open'), won: path('won'),
  legal: path('legal'), nlegal: path('nlegal'), accepted: path('accepted'), refused: path('refused'),
} as const;

const CONTROLS: Obj = { aim: { kind: 'point' }, wait_key: { kind: 'actions', actions: { wait: { keys: ['period'] } } } };
const READS = ['aim', 'wait_key'];
const WRITES: Obj = {
  grid: { type: 'i32', count: WIDTH * HEIGHT }, cell: { type: 'i32', count: 2 }, hp: { type: 'i32' }, turn: { type: 'i32' },
  has_key: { type: 'i32' }, door_open: { type: 'i32' }, won: { type: 'i32' },
  legal: { type: 'i32', count: 3 * MAX_ROWS }, nlegal: { type: 'i32' }, accepted: { type: 'i32' }, refused: { type: 'i32' },
};

export function crawlerPlay(o: { hidden?: string[] } = {}): Obj {
  return {
    grid: {
      cells: PATH.grid, size: [WIDTH, HEIGHT], shape: 'square', moves: 4,
      classes: { open: [CLASS.open, CLASS.trap], blocked: [CLASS.blocked], door: [CLASS.door], locked: [CLASS.locked], key: [CLASS.key], exit: [CLASS.exit] },
      locks: { [String(CLASS.locked)]: CLASS.key },
    },
    units: { cell: PATH.cell, hp: PATH.hp, self: 0 },
    turn: PATH.turn,
    values: { has_key: PATH.key, door_open: PATH.door, won: PATH.won },
    actions: { move: { control: 'aim', args: 'cell' }, wait: { control: 'wait_key', action: 'wait', args: 'none' } },
    legal: { rows: PATH.legal, count: PATH.nlegal },
    accepted: PATH.accepted,
    refused: PATH.refused,
    ...(o.hidden ? { hidden: o.hidden } : {}),
  };
}

export const EXPLORER: Obj = { explorer: { every: 1 } };
export const SLOW_EXPLORER: Obj = { explorer: { every: 4 } };
export const IDLE: Obj = { policy: {} };
export const MODEL_PROVIDER = 'test.recorded@1';
export const MODEL: Obj = { model: { provider: MODEL_PROVIDER, every: 15, budget: { calls: 8, tokens: 100_000 } } };

export const NEVER_NEGATIVE = { name: 'never_negative', when: 'hp >= 0' } as const;
export const KEY_BEFORE_DOOR = { name: 'key_before_door', first: 'has_key', then: 'door_open' } as const;
export const GOALS = [{ name: 'door', when: 'door_open >= 1', each: true }, { name: 'out', when: 'won >= 1', each: true }];

export const SEED = 3264;
export const RUNS = 20;
export const SPAN = 60;
export function playtest(piece: string, play: Obj, o: Obj = {}): Obj {
  return { piece, play, bots: [EXPLORER], runs: RUNS, seed: SEED, span: { steps: SPAN }, goals: GOALS, piece_seed: 'run', frames: { every: 0 }, ...o };
}

export const READS_AT = 0;
export const WRITES_AT = 40960;
export const STATE = 49152;
const GRID = 49408;
const S = {
  hx: STATE, hy: STATE + 4, hp: STATE + 8, key: STATE + 12, door: STATE + 16, won: STATE + 20, turn: STATE + 24, accepted: STATE + 28, refused: STATE + 32,
};
const HEAD = `(memory (export "memory") 2 2)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))`;

export const pieceOf = (program: { sha: string; b64: string }): Obj => ({
  seed: SEED, class: 'figure', controls: CONTROLS,
  items: { [ID]: { kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: READS, writes: WRITES } } },
  assets: { [program.sha]: program.b64 },
});

const ld = (a: number): string => `(i32.load (i32.const ${a}))`;
const st = (a: number, v: string): string => `(i32.store (i32.const ${a}) ${v})`;
const inc = (a: number): string => st(a, `(i32.add ${ld(a)} (i32.const 1))`);
const c = (n: number): string => `(i32.const ${n})`;
const seedBits = (from: number): string => `(i32.wrap_i64 (i64.and (i64.shr_u (local.get $seed) (i64.const ${from})) (i64.const 3)))`;
const cell = (x: number): string => `(call $at ${c(x)} ${c(CORRIDOR_ROW)})`;

export function crawlerText(v: Twin, AIM: number, WAIT: number, W: (name: string) => number): string {
  const startHp = v === 'blip' ? c(BLIP_TWIN_HP) : `(i32.add ${c(WOUNDED_HP)} (i32.mul ${seedBits(16)} ${c(TRAP_TAKES)}))`;
  const trapFloor = v === 'spikes' ? '' : `(if (i32.lt_s ${ld(S.hp)} (i32.const 0)) (then ${st(S.hp, c(0))}))`;
  const timer = v === 'timer' ? `(if (i32.and (i64.eq (local.get $k) (i64.const ${TIMER_STEP})) (i32.eqz ${ld(S.door)}))
      (then ${st(S.door, c(1))} (i32.store ${cell(AT.door)} ${c(CLASS.door)})))` : '';
  const shownHp = v === 'blip' ? `(select (i32.sub ${ld(S.hp)} ${c(TRAP_TAKES)}) ${ld(S.hp)} (i64.eq (local.get $k) (i64.const ${BLIP_STEP})))` : ld(S.hp);
  return `
(module
  ${HEAD}
  (func $abs (param $v i32) (result i32)
    (select (local.get $v) (i32.sub (i32.const 0) (local.get $v)) (i32.ge_s (local.get $v) (i32.const 0))))
  (func $at (param $x i32) (param $y i32) (result i32)
    (i32.add ${c(GRID)} (i32.shl (i32.add (i32.mul (local.get $y) ${c(WIDTH)}) (local.get $x)) (i32.const 2))))
  (func $here (param $x i32) (param $y i32) (result i32)
    (if (result i32) (i32.or (i32.ge_u (local.get $x) ${c(WIDTH)}) (i32.ge_u (local.get $y) ${c(HEIGHT)}))
      (then ${c(CLASS.blocked)})
      (else (i32.load (call $at (local.get $x) (local.get $y))))))
  (func $pass (param $x i32) (param $y i32) (result i32) (local $v i32)
    (local.set $v (call $here (local.get $x) (local.get $y)))
    (i32.or
      (i32.and (i32.ne (local.get $v) ${c(CLASS.blocked)}) (i32.ne (local.get $v) ${c(CLASS.locked)}))
      (i32.and (i32.eq (local.get $v) ${c(CLASS.locked)}) ${ld(S.key)})))
  (func $enter (param $x i32) (param $y i32) (local $v i32)
    (local.set $v (call $here (local.get $x) (local.get $y)))
    ${st(S.hx, '(local.get $x)')}
    ${st(S.hy, '(local.get $y)')}
    (if (i32.eq (local.get $v) ${c(CLASS.key)})
      (then ${st(S.key, c(1))} (i32.store (call $at (local.get $x) (local.get $y)) ${c(CLASS.open)})))
    (if (i32.eq (local.get $v) ${c(CLASS.locked)})
      (then ${st(S.door, c(1))} ${st(S.key, c(0))} (i32.store (call $at (local.get $x) (local.get $y)) ${c(CLASS.door)})))
    (if (i32.eq (local.get $v) ${c(CLASS.trap)})
      (then ${st(S.hp, `(i32.sub ${ld(S.hp)} ${c(TRAP_TAKES)})`)} ${trapFloor}))
    (if (i32.eq (local.get $v) ${c(CLASS.exit)}) (then ${st(S.won, c(1))})))
  (func $row (param $i i32) (param $x i32) (param $y i32) (local $p i32)
    (local.set $p (i32.add ${c(W('legal'))} (i32.mul (local.get $i) (i32.const 12))))
    (i32.store (local.get $p) (i32.const 0))
    (i32.store offset=4 (local.get $p) (local.get $x))
    (i32.store offset=8 (local.get $p) (local.get $y)))
  (func $list (param $n i32) (param $x i32) (param $y i32) (result i32)
    (if (result i32) (call $pass (local.get $x) (local.get $y))
      (then (call $row (local.get $n) (local.get $x) (local.get $y)) (i32.add (local.get $n) (i32.const 1)))
      (else (local.get $n))))
  (func (export "init") (param $seed i64) (local $i i32)
    (local.set $i (i32.const 0))
    (loop $walls
      (i32.store (i32.add ${c(GRID)} (i32.shl (local.get $i) (i32.const 2))) ${c(CLASS.blocked)})
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $walls (i32.lt_u (local.get $i) ${c(WIDTH * HEIGHT)})))
    (local.set $i (i32.const 0))
    (loop $corridor
      (i32.store (call $at (local.get $i) ${c(CORRIDOR_ROW)}) ${c(CLASS.open)})
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $corridor (i32.le_u (local.get $i) ${c(AT.exit)})))
    (i32.store ${cell(AT.key)} ${c(CLASS.key)})
    (i32.store ${cell(AT.door)} ${c(CLASS.locked)})
    (i32.store ${cell(AT.trap)} ${c(CLASS.trap)})
    (i32.store ${cell(AT.exit)} ${c(CLASS.exit)})
    ${st(S.hx, `(i32.shl ${seedBits(8)} (i32.const 1))`)}
    ${st(S.hy, c(CORRIDOR_ROW))}
    ${st(S.hp, startHp)})
  (func (export "step") (param $k i64)
    (local $n i32) (local $j i32) (local $rec i32) (local $fx f64) (local $fy f64) (local $x i32) (local $y i32) (local $ok i32) (local $i i32)
    (local.set $n ${ld(AIM)})
    (local.set $j (i32.const 0))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
      (local.set $rec (i32.add (i32.const ${AIM + 16}) (i32.shl (local.get $j) (i32.const 8))))
      (if (i32.eqz (i32.load8_u (local.get $rec)))
        (then
          (local.set $ok (i32.const 0))
          (if (i32.and (i32.eqz ${ld(S.won)}) (i32.and (i32.load8_u offset=3 (local.get $rec)) (i32.const 1)))
            (then
              (local.set $fx (f64.load offset=8 (local.get $rec)))
              (local.set $fy (f64.load offset=16 (local.get $rec)))
              (if (i32.and (i32.and (f64.ge (local.get $fx) (f64.const 0)) (f64.lt (local.get $fx) (f64.const ${WIDTH})))
                           (i32.and (f64.ge (local.get $fy) (f64.const 0)) (f64.lt (local.get $fy) (f64.const ${HEIGHT}))))
                (then
                  (local.set $x (i32.trunc_f64_s (local.get $fx)))
                  (local.set $y (i32.trunc_f64_s (local.get $fy)))
                  (if (i32.and
                        (i32.eq (i32.add (call $abs (i32.sub (local.get $x) ${ld(S.hx)})) (call $abs (i32.sub (local.get $y) ${ld(S.hy)}))) (i32.const 1))
                        (call $pass (local.get $x) (local.get $y)))
                    (then (local.set $ok (i32.const 1))))))))
          (if (local.get $ok)
            (then (call $enter (local.get $x) (local.get $y)) ${inc(S.accepted)} ${inc(S.turn)})
            (else ${inc(S.refused)}))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $each)))
    ${st(S.refused, `(i32.add ${ld(S.refused)} ${ld(WAIT)})`)}
    ${timer}
    (local.set $i (i32.const 0))
    (loop $copy
      (i32.store (i32.add ${c(W('grid'))} (local.get $i)) (i32.load (i32.add ${c(GRID)} (local.get $i))))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br_if $copy (i32.lt_u (local.get $i) ${c(WIDTH * HEIGHT * 4)})))
    ${st(W('cell'), ld(S.hx))}
    ${st(W('cell') + 4, ld(S.hy))}
    ${st(W('hp'), shownHp)}
    ${st(W('turn'), ld(S.turn))}
    ${st(W('has_key'), ld(S.key))}
    ${st(W('door_open'), ld(S.door))}
    ${st(W('won'), ld(S.won))}
    ${st(W('accepted'), ld(S.accepted))}
    ${st(W('refused'), ld(S.refused))}
    (local.set $i (i32.const 0))
    (loop $clear
      (i32.store (i32.add ${c(W('legal'))} (local.get $i)) (i32.const 0))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br_if $clear (i32.lt_u (local.get $i) ${c(3 * MAX_ROWS * 4)})))
    (local.set $n (i32.const 0))
    (if (i32.eqz ${ld(S.won)})
      (then
        (local.set $n (call $list (local.get $n) ${ld(S.hx)} (i32.sub ${ld(S.hy)} (i32.const 1))))
        (local.set $n (call $list (local.get $n) (i32.add ${ld(S.hx)} (i32.const 1)) ${ld(S.hy)}))
        (local.set $n (call $list (local.get $n) ${ld(S.hx)} (i32.add ${ld(S.hy)} (i32.const 1))))
        (local.set $n (call $list (local.get $n) (i32.sub ${ld(S.hx)} (i32.const 1)) ${ld(S.hy)}))))
    ${st(W('nlegal'), '(local.get $n)')}))`;
}

export const PROBE_TEXT = `(module ${HEAD} (func (export "init") (param $seed i64)) (func (export "step") (param $k i64)))`;
