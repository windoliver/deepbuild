// This suite's maze (README: The maze and its save): #184's clean maze, grid, walls and rules, which also declares
// one save slot and asks for it at the end of step 1,799, so the logic module writes a save of it at step 1,800, and
// which exports its state layout. `earlier` is an earlier program of the same maze: the same rules with its press
// count kept before the token, so another state layout. Each program exports `memory`, `init(seed: i64)`,
// `step(k: i64)` and the immutable globals `reads_at` (0), `writes_at` (4096) and `layout_at`, and keeps to the logic
// subset. Region offsets are the item's own, read from `deep-logic check`. Assembled by #533's assembler, through its
// helpers, as #184's programs are. The grid, the walls and the route are #184's (tests/acceptance/184/programs.ts);
// its wall table is rebuilt here because that file doesn't export it.
import { expect } from 'vitest';
import { assemble, checkCall, onLogic, type Program } from '../533/helpers.ts';
import { EXIT, ROUTE, SIZE, WALLS } from '../184/programs.ts';
import type { Obj } from '../184/helpers.ts';

export type { Program };

/** The piece's one logic item, and the paths the playtest reads of it (#184's). */
export const MAZE = 'maze';
/** The maze's arrays: #184's three, and `save`, its request array (Logic: saves). */
export const WRITES = { cell: { type: 'i32', count: 2 }, won: { type: 'i32' }, presses: { type: 'i32' }, save: { type: 'i32' } };
/** Its saves: one slot, asked through `save`, and no migration. */
export const SAVES = { slots: 1, request: 'save' };
export const SLOT = 1;
/** The step whose end the maze asks for its save at, and the step the save is written at. */
export const SAVE_ASKED_AT = 1799;
export const SAVED_AT = 1800;

const FLICKS = 705_600_000;
const STEP_60 = FLICKS / 60;
/**
 * The input recorded before the save: the route's first four presses (east, east, east, north), one every 300 steps,
 * as yours. They leave the token on (3, 1) with 4 presses counted, so the saved state isn't the start's.
 */
export const PRESS_STEPS = [300, 600, 900, 1200];
export const SAVE_TRACK: Obj[] = PRESS_STEPS.map((k, n) => ({ t: k * STEP_60, seq: n, control: 'arrow', value: ROUTE[n]!, writer: 'you', player: 1 }));
export const SAVED_CELL: [number, number] = [3, 1];
export const SAVED_PRESSES = PRESS_STEPS.length;

// ---------------------------------------------------------------------------------------------------
// The wall table, as #184's maze reads it: one byte a cell (row-major), bit d − 1 set when an inner wall blocks
// direction d (1 north, 2 east, 3 south, 4 west); the grid's edges are the program's.

const STEPS_OF: Record<number, [number, number]> = { 1: [0, 1], 2: [1, 0], 3: [0, -1], 4: [-1, 0] };
function wallBytes(): number[] {
  const walled = (x: number, y: number, d: number): boolean => {
    const to = [x + STEPS_OF[d]![0], y + STEPS_OF[d]![1]];
    return WALLS.some(([a, b]) => (a[0] === x && a[1] === y && b[0] === to[0] && b[1] === to[1]) || (b[0] === x && b[1] === y && a[0] === to[0] && a[1] === to[1]));
  };
  const bytes: number[] = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    let b = 0;
    for (const d of [1, 2, 3, 4]) if (walled(x, y, d)) b |= 1 << (d - 1);
    bytes.push(b);
  }
  return bytes;
}
const bytesText = (bytes: Iterable<number>): string => [...bytes].map((b) => `\\${b.toString(16).padStart(2, '0')}`).join('');

// ---------------------------------------------------------------------------------------------------
// Where the maze's item reads and writes, from the logic module's own check.

interface Entry { region: string; name: string; offset: number }
const HEAD = `(memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func (export "init") (param $seed i64))`;
const params = (program: string): Obj => ({ program, step_rate: 60, reads: ['arrow'], writes: WRITES, saves: SAVES });
let entries: Entry[] | undefined;
function regionOf(region: 'reads' | 'writes', name: string): number {
  if (!entries) {
    const probe = assemble('probe1047', `(module ${HEAD} (func (export "step") (param $k i64)))`);
    const piece = { seed: 1047, class: 'figure', controls: { arrow: { kind: 'slider' } }, items: { [MAZE]: { kind: 'logic@1', params: params(probe.sha) } }, assets: { [probe.sha]: probe.b64 } };
    const [reply] = onLogic([checkCall(piece as never)]) as Obj[];
    expect(reply?.['ok'], `deep-logic check takes the layout probe's piece: ${JSON.stringify(reply).slice(0, 1200)}`).toBe(true);
    entries = reply!['items'][MAZE]['layout']['entries'] as Entry[];
  }
  const e = entries.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(entries)}`);
  return e.offset;
}

// ---------------------------------------------------------------------------------------------------
// The maze's two programs.

const WALLS_AT = 8448;
const LAYOUT_AT = 8704;
/** Where a program keeps its state, and the state layout it exports (Logic: saves across changes). */
interface Kept { x: number; y: number; presses: number; won: number; version: number }
const KEPT: Record<'clean' | 'earlier', Kept> = {
  /** The clean maze: the token, then its press count, then won. */
  clean: { x: 8192, y: 8196, presses: 8200, won: 8204, version: 2 },
  /** The earlier program: its press count before the token. */
  earlier: { x: 8196, y: 8200, presses: 8192, won: 8204, version: 1 },
};
/** A program's layout bytes: its name, its version and where each field sits. */
export function layoutBytes(variant: 'clean' | 'earlier'): Buffer {
  const k = KEPT[variant];
  const fields = [{ name: 'token', offset: k.x, type: 'i32', count: 2 }, { name: 'presses', offset: k.presses, type: 'i32', count: 1 }, { name: 'won', offset: k.won, type: 'i32', count: 1 }];
  return Buffer.from(JSON.stringify({ name: 'maze', version: k.version, fields: fields.sort((a, b) => a.offset - b.offset) }));
}

/**
 * The maze: each step it reads every `arrow` entry of the step in order, counts it as a press, and moves the token one
 * cell its way (1 north, 2 east, 3 south, 4 west) unless a wall or the grid's edge is there; it writes `cell` [x, y],
 * `won` (1 from the step the token first stands on (5, 5)) and `presses`, as #184's clean maze does, and 1 into `save`
 * at the end of step 1,799 (0 at any other), which asks for slot 1's save at step 1,800.
 */
export function mazeProgram(variant: 'clean' | 'earlier' = 'clean'): Program {
  const k = KEPT[variant];
  const arrow = regionOf('reads', 'arrow');
  const [cell, won, presses, save] = ['cell', 'won', 'presses', 'save'].map((n) => 4096 + regionOf('writes', n)) as [number, number, number, number];
  const layout = layoutBytes(variant);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(layout.length);
  return assemble(`maze1047_${variant}_${arrow}_${cell}_${won}_${presses}_${save}`, `
(module
  ${HEAD}
  (global (export "layout_at") i32 (i32.const ${LAYOUT_AT}))
  (data (i32.const ${WALLS_AT}) "${bytesText(wallBytes())}")
  (data (i32.const ${LAYOUT_AT}) "${bytesText(Buffer.concat([length, layout]))}")
  (func (export "step") (param $k i64) (local $n i32) (local $j i32) (local $v i32) (local $x i32) (local $y i32)
    (local $nx i32) (local $ny i32) (local $p i32)
    (local.set $x (i32.load (i32.const ${k.x})))
    (local.set $y (i32.load (i32.const ${k.y})))
    (local.set $p (i32.load (i32.const ${k.presses})))
    (local.set $n (i32.load (i32.const ${arrow})))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
        (local.set $v (i32.trunc_f64_s (f64.load (i32.add (i32.const ${arrow + 16}) (i32.shl (local.get $j) (i32.const 4))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (block $skip
          (br_if $skip (i32.or (i32.lt_s (local.get $v) (i32.const 1)) (i32.gt_s (local.get $v) (i32.const 4))))
          (br_if $skip (i32.and
            (i32.load8_u (i32.add (i32.const ${WALLS_AT}) (i32.add (i32.mul (local.get $y) (i32.const ${SIZE})) (local.get $x))))
            (i32.shl (i32.const 1) (i32.sub (local.get $v) (i32.const 1)))))
          (local.set $nx (local.get $x))
          (local.set $ny (local.get $y))
          (if (i32.eq (local.get $v) (i32.const 1)) (then (local.set $ny (i32.add (local.get $y) (i32.const 1)))))
          (if (i32.eq (local.get $v) (i32.const 2)) (then (local.set $nx (i32.add (local.get $x) (i32.const 1)))))
          (if (i32.eq (local.get $v) (i32.const 3)) (then (local.set $ny (i32.sub (local.get $y) (i32.const 1)))))
          (if (i32.eq (local.get $v) (i32.const 4)) (then (local.set $nx (i32.sub (local.get $x) (i32.const 1)))))
          (br_if $skip (i32.or
            (i32.or (i32.lt_s (local.get $nx) (i32.const 0)) (i32.ge_s (local.get $nx) (i32.const ${SIZE})))
            (i32.or (i32.lt_s (local.get $ny) (i32.const 0)) (i32.ge_s (local.get $ny) (i32.const ${SIZE})))))
          (local.set $x (local.get $nx))
          (local.set $y (local.get $ny)))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $each)))
    (if (i32.and (i32.eq (local.get $x) (i32.const ${EXIT[0]})) (i32.eq (local.get $y) (i32.const ${EXIT[1]})))
      (then (i32.store (i32.const ${k.won}) (i32.const 1))))
    (i32.store (i32.const ${k.x}) (local.get $x))
    (i32.store (i32.const ${k.y}) (local.get $y))
    (i32.store (i32.const ${k.presses}) (local.get $p))
    (i32.store (i32.const ${cell}) (local.get $x))
    (i32.store (i32.const ${cell + 4}) (local.get $y))
    (i32.store (i32.const ${won}) (i32.load (i32.const ${k.won})))
    (i32.store (i32.const ${presses}) (local.get $p))
    (i32.store (i32.const ${save}) (i64.eq (local.get $k) (i64.const ${SAVE_ASKED_AT})))))`);
}

/** The piece as the replica and `deep-logic` take it: the maze alone, of class figure, its program its own asset. */
export function mazePiece(program: Program): Obj {
  return { seed: 1047, class: 'figure', controls: { arrow: { kind: 'slider' } }, items: { [MAZE]: { kind: 'logic@1', params: params(program.sha) } }, assets: { [program.sha]: program.b64 } };
}
