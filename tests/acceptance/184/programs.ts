// This suite's maze, its twins and its bots, in WebAssembly text (README: The maze and its bots). Every program exports
// `memory`, `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` (0) and `writes_at` (4096), and
// keeps to the logic subset (Logic `logic@1`: Exports). Region offsets are the item's own, read from `deep-logic
// check` of a piece that holds the maze and the bots as the replica adds them (README: The surface), so a program
// reads and writes where the logic module lays its entries out. Assembled by #533's assembler (tests/acceptance/533/wat,
// read only, through its helpers).
import { expect } from 'vitest';
import { assemble, bakeCall, checkCall, onLogic, type Program } from '../533/helpers.ts';
import { type Obj, keepAsset } from './helpers.ts';

export type { Program };

/** The grid: 6 × 6 cells, x east, y north; the token starts at (0, 0) and `won` holds once it stands on (5, 5). */
export const SIZE = 6;
export const START: [number, number] = [0, 0];
export const EXIT: [number, number] = [5, 5];
/** The cell the stuck twin's token never leaves, on the route bot's route. */
export const TRAP_CELL: [number, number] = [3, 4];
/** An arrow press's value: 1 north (+y), 2 east (+x), 3 south (−y), 4 west (−x); anything else moves nothing. */
export const NORTH = 1;
const STEPS_OF: Record<number, [number, number]> = { 1: [0, 1], 2: [1, 0], 3: [0, -1], 4: [-1, 0] };
type Edge = [[number, number], [number, number]];
/** The clean maze's inner walls, each between two cells. No cell has fewer than two open sides. */
export const WALLS: Edge[] = [[[1, 0], [1, 1]], [[2, 2], [3, 2]], [[4, 1], [4, 2]], [[1, 3], [2, 3]], [[4, 3], [5, 3]]];
/** The walled twin's two more walls: (5, 5) closed from both its neighbours. */
export const EXIT_WALLS: Edge[] = [[[4, 5], [5, 5]], [[5, 4], [5, 5]]];
/** The route bot's route, a shortest one (10 presses, the Manhattan distance) through (3, 4). */
export const ROUTE = [2, 2, 2, 1, 1, 1, 1, 2, 2, 1];

const blocked = (walls: Edge[], [x, y]: [number, number], d: number): boolean => {
  const [dx, dy] = STEPS_OF[d]!;
  const to: [number, number] = [x + dx, y + dy];
  if (to[0] < 0 || to[0] >= SIZE || to[1] < 0 || to[1] >= SIZE) return true;
  return walls.some(([a, b]) => (a[0] === x && a[1] === y && b[0] === to[0] && b[1] === to[1]) || (b[0] === x && b[1] === y && a[0] === to[0] && a[1] === to[1]));
};
/** One byte a cell (row-major): bit d − 1 set when an inner wall blocks direction d (the edges are the program's). */
function wallBytes(walls: Edge[]): number[] {
  const bytes: number[] = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    let b = 0;
    for (const d of [1, 2, 3, 4]) {
      const [dx, dy] = STEPS_OF[d]!;
      const inside = x + dx >= 0 && x + dx < SIZE && y + dy >= 0 && y + dy < SIZE;
      if (inside && blocked(walls, [x, y], d)) b |= 1 << (d - 1);
    }
    bytes.push(b);
  }
  return bytes;
}
/** The route bot's table, one byte a cell: the press its route makes there, toward the exit by breadth-first search elsewhere, 0 at the exit. */
function routeTable(): number[] {
  const dist = new Map<string, number>([[EXIT.join(), 0]]);
  const queue: [number, number][] = [EXIT];
  while (queue.length) {
    const c = queue.shift()!;
    for (const d of [1, 2, 3, 4]) {
      if (blocked(WALLS, c, d)) continue;
      const n: [number, number] = [c[0] + STEPS_OF[d]![0], c[1] + STEPS_OF[d]![1]];
      if (!dist.has(n.join())) { dist.set(n.join(), dist.get(c.join())! + 1); queue.push(n); }
    }
  }
  const table: number[] = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const here = dist.get([x, y].join()) ?? 0;
    table.push(here === 0 ? 0 : [1, 2, 3, 4].find((d) => !blocked(WALLS, [x, y], d) && dist.get([x + STEPS_OF[d]![0], y + STEPS_OF[d]![1]].join()) === here - 1) ?? 0);
  }
  let pos: [number, number] = START;
  for (const d of ROUTE) {
    expect(blocked(WALLS, pos, d), `the route's press ${d} from (${pos.join(', ')}) is open`).toBe(false);
    table[pos[1] * SIZE + pos[0]] = d;
    pos = [pos[0] + STEPS_OF[d]![0], pos[1] + STEPS_OF[d]![1]];
  }
  expect(pos, 'the route ends at the exit').toEqual(EXIT);
  return table;
}
/** Every cell of the clean maze and of the walled twin but its closed exit has at least two open sides, so a seeded policy never sits 10 s in a dead end. */
function checkOpenSides(): void {
  for (const walls of [WALLS, [...WALLS, ...EXIT_WALLS]]) {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      if (walls !== WALLS && x === EXIT[0] && y === EXIT[1]) continue;
      const open = [1, 2, 3, 4].filter((d) => !blocked(walls, [x, y], d)).length;
      expect(open, `cell (${x}, ${y}) has two open sides or more`).toBeGreaterThanOrEqual(2);
    }
  }
}
const bytesText = (bytes: number[]): string => bytes.map((b) => `\\${b.toString(16).padStart(2, '0')}`).join('');

// ---------------------------------------------------------------------------------------------------
// Layouts, from the logic module's own check.

interface Entry { region: string; name: string; offset: number }
/** Where an item's region entry sits, in the layout `deep-logic check` reported. */
function at(entries: Entry[], region: 'reads' | 'writes', name: string): number {
  const e = entries.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(entries)}`);
  return e.offset;
}
const HEAD = `(memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func (export "init") (param $seed i64))`;
/** The maze's arrays, as its item declares them. */
export const MAZE_WRITES = { cell: { type: 'i32', count: 2 }, won: { type: 'i32' }, presses: { type: 'i32' } };
/** A logic bot's one `plays` array, as the replica declares it: a value and a serial (README: The surface). */
export const PLAYS_WRITES = { press: { type: 'f64', count: 2 } };
export const ROUTE_READS = ['maze.cell', 'maze.won'];

let layouts: { maze: Entry[]; bot: Entry[]; lone: Entry[] } | undefined;
function layoutsOf(): { maze: Entry[]; bot: Entry[]; lone: Entry[] } {
  if (layouts) return layouts;
  const probe = assemble('probe184', `(module ${HEAD} (func (export "step") (param $k i64)))`);
  const item = (params: Obj): Obj => ({ kind: 'logic@1', params: { program: probe.sha, ...params } });
  const p = {
    seed: 184, class: 'figure', controls: { arrow: { kind: 'slider' } },
    items: { maze: item({ reads: ['arrow'], writes: MAZE_WRITES }), bot: item({ reads: ROUTE_READS, writes: PLAYS_WRITES }), lone: item({ writes: PLAYS_WRITES }) },
    assets: { [probe.sha]: probe.b64 },
  };
  const [reply] = onLogic([checkCall(p as never)]) as Obj[];
  expect(reply?.['ok'], `deep-logic check takes the layout probe's piece: ${JSON.stringify(reply).slice(0, 1200)}`).toBe(true);
  const of = (id: string): Entry[] => (reply!['items'][id]['layout']['entries'] as Entry[]);
  layouts = { maze: of('maze'), bot: of('bot'), lone: of('lone') };
  return layouts;
}

// ---------------------------------------------------------------------------------------------------
// The maze and its twins.

export type Variant = 'clean' | 'stuck' | 'walled' | 'trap' | 'heavy';
/**
 * The maze: each step it reads every `arrow` entry of the step in order, counts it as a press, and moves the token one
 * cell its way unless a wall or the grid's edge is there; it writes `cell` [x, y], `won` (1 from the step the token
 * first stands on (5, 5)) and `presses`. The twins: `stuck` moves nothing once the token stands on (3, 4); `walled`
 * has (5, 5) walled off; `trap` divides by 40 − presses on every press, so its 40th press divides by zero; `heavy`
 * burns `burn` iterations of an LCG every step (criterion 5's 9,000,000 fuel, at 240 Hz).
 */
export function mazeProgram(variant: Variant, burn = 0): Program {
  const l = layoutsOf().maze;
  const arrow = at(l, 'reads', 'arrow');
  const cell = 4096 + at(l, 'writes', 'cell');
  const won = 4096 + at(l, 'writes', 'won');
  const presses = 4096 + at(l, 'writes', 'presses');
  const walls = variant === 'walled' ? [...WALLS, ...EXIT_WALLS] : WALLS;
  const p = assemble(`maze_${variant}_${burn}_${arrow}_${cell}_${won}_${presses}`, `
(module
  ${HEAD}
  (data (i32.const 8448) "${bytesText(wallBytes(walls))}")
  (func (export "step") (param $k i64) (local $n i32) (local $j i32) (local $v i32) (local $x i32) (local $y i32)
    (local $nx i32) (local $ny i32) (local $p i32) (local $i i32) (local $acc i64)
    (local.set $x (i32.load (i32.const 8192)))
    (local.set $y (i32.load (i32.const 8196)))
    (local.set $p (i32.load (i32.const 8200)))
    (local.set $n (i32.load (i32.const ${arrow})))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
        (local.set $v (i32.trunc_f64_s (f64.load (i32.add (i32.const ${arrow + 16}) (i32.shl (local.get $j) (i32.const 4))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        ${variant === 'trap' ? '(drop (i32.div_s (i32.const 1) (i32.sub (i32.const 40) (local.get $p))))' : ''}
        (block $skip
          ${variant === 'stuck' ? `(br_if $skip (i32.and (i32.eq (local.get $x) (i32.const ${TRAP_CELL[0]})) (i32.eq (local.get $y) (i32.const ${TRAP_CELL[1]}))))` : ''}
          (br_if $skip (i32.or (i32.lt_s (local.get $v) (i32.const 1)) (i32.gt_s (local.get $v) (i32.const 4))))
          (br_if $skip (i32.and
            (i32.load8_u (i32.add (i32.const 8448) (i32.add (i32.mul (local.get $y) (i32.const ${SIZE})) (local.get $x))))
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
      (then (i32.store (i32.const 8204) (i32.const 1))))
    ${variant === 'heavy' ? `(local.set $i (i32.const ${burn}))
    (loop $burn
      (local.set $acc (i64.add (i64.mul (local.get $acc) (i64.const 6364136223846793005)) (i64.const 1442695040888963407)))
      (br_if $burn (local.tee $i (i32.sub (local.get $i) (i32.const 1)))))
    (i64.store (i32.const 8208) (i64.add (i64.load (i32.const 8208)) (local.get $acc)))` : ''}
    (i32.store (i32.const 8192) (local.get $x))
    (i32.store (i32.const 8196) (local.get $y))
    (i32.store (i32.const 8200) (local.get $p))
    (i32.store (i32.const ${cell}) (local.get $x))
    (i32.store (i32.const ${cell + 4}) (local.get $y))
    (i32.store (i32.const ${won}) (i32.load (i32.const 8204)))
    (i32.store (i32.const ${presses}) (local.get $p))))`);
  return keepAsset(p);
}

/** The piece as the replica and `deep-logic` take it (README: The surface): the maze alone, of class figure. */
export function mazePiece(program: Program, o: { hz?: number; fuel?: number } = {}): Obj {
  const params: Obj = { program: program.sha, step_rate: o.hz ?? 60, reads: ['arrow'], writes: MAZE_WRITES };
  if (o.fuel !== undefined) params['budget'] = { fuel: o.fuel };
  return { seed: 184, class: 'figure', controls: { arrow: { kind: 'slider' } }, items: { maze: { kind: 'logic@1', params } }, assets: { [program.sha]: program.b64 } };
}

/** The 240 Hz twin's fuel budget a step: the logic budget's most, so 9,000,000 fuel of work runs and never traps. */
export const HEAVY_FUEL_BUDGET = 10_000_000;
export const HEAVY_FUEL = 9_000_000;
/**
 * The 240 Hz twin, its burn sized by the logic module's own fuel counts (two `deep-logic bake`s of one step with no
 * entries), so a step with no press spends at least 9,000,000 and under 9,100,000 fuel.
 */
export function heavyMaze(): { program: Program; fuel: number } {
  const fuelOf = (burn: number): number => {
    const [r] = onLogic([bakeCall(mazePiece(mazeProgram('heavy', burn), { hz: 240, fuel: HEAVY_FUEL_BUDGET }) as never, [], 1)]) as Obj[];
    const fuel = r?.['steps']?.[0]?.['items']?.['maze']?.['fuel'];
    expect(Number.isSafeInteger(fuel), `deep-logic bakes the heavy maze with a burn of ${burn}: ${JSON.stringify(r).slice(0, 1200)}`).toBe(true);
    return fuel as number;
  };
  const a = fuelOf(100_000);
  const b = fuelOf(200_000);
  const per = (b - a) / 100_000;
  const burn = Math.ceil((HEAVY_FUEL - (a - per * 100_000)) / per);
  const fuel = fuelOf(burn);
  expect(fuel, `the heavy maze's step spends 9,000,000 fuel or more (burn ${burn})`).toBeGreaterThanOrEqual(HEAVY_FUEL);
  expect(fuel, `and under 9,100,000 (burn ${burn})`).toBeLessThan(HEAVY_FUEL + 100_000);
  return { program: mazeProgram('heavy', burn), fuel };
}

// ---------------------------------------------------------------------------------------------------
// The bots.

/**
 * The route bot: a logic bot that walks the shortest route. Every 4th of its steps, until it reads `maze.won`, it reads
 * `maze.cell`, looks up its table's press for that cell and bumps its serial; every step it writes [press, serial]
 * to `press`, so each bump is one entry of `arrow`.
 */
export function routeBotProgram(): Program {
  checkOpenSides();
  const l = layoutsOf().bot;
  const cell = at(l, 'reads', 'maze.cell');
  const won = at(l, 'reads', 'maze.won');
  const press = 4096 + at(l, 'writes', 'press');
  return keepAsset(assemble(`route_bot_${cell}_${won}_${press}`, `
(module
  ${HEAD}
  (data (i32.const 8448) "${bytesText(routeTable())}")
  (func (export "step") (param $k i64) (local $x i32) (local $y i32)
    (if (i32.and (i32.eqz (i32.load (i32.const ${won}))) (i64.eqz (i64.rem_u (local.get $k) (i64.const 4))))
      (then
        (local.set $x (i32.load (i32.const ${cell})))
        (local.set $y (i32.load (i32.const ${cell + 4})))
        (f64.store (i32.const 8200) (f64.convert_i32_u (i32.load8_u
          (i32.add (i32.const 8448) (i32.add (i32.mul (local.get $y) (i32.const ${SIZE})) (local.get $x))))))
        (f64.store (i32.const 8192) (f64.add (f64.load (i32.const 8192)) (f64.const 1)))))
    (f64.store (i32.const ${press}) (f64.load (i32.const 8200)))
    (f64.store (i32.const ${press + 8}) (f64.load (i32.const 8192)))))`));
}

/** A bot that reads nothing, writing `press` with `body` (which leaves $v and $s, f64 locals, as the value and serial). */
function loneBot(name: string, body: string): Program {
  const press = 4096 + at(layoutsOf().lone, 'writes', 'press');
  return keepAsset(assemble(`${name}_${press}`, `
(module
  ${HEAD}
  (func (export "step") (param $k i64) (local $v f64) (local $s f64)
    ${body}
    (f64.store (i32.const ${press}) (local.get $v))
    (f64.store (i32.const ${press + 8}) (local.get $s))))`));
}
/** Criterion 7: a logic bot that divides by k − 5, so its step 5 traps. */
export const trapBotProgram = (): Program => loneBot('trap_bot', '(drop (i32.div_s (i32.const 1) (i32.wrap_i64 (i64.sub (local.get $k) (i64.const 5)))))');
/** Criterion 10: north with serial 1 at its step 2 and serial 2 from its step 3 on; [0, 0] before. */
export const twoPressBotProgram = (): Program => loneBot('two_press_bot', `
    (if (i64.ge_s (local.get $k) (i64.const 2)) (then (local.set $v (f64.const ${NORTH})) (local.set $s (f64.const 1))))
    (if (i64.ge_s (local.get $k) (i64.const 3)) (then (local.set $s (f64.const 2))))`);
/** Criterion 10: north with serial 0, the write region's first serial, at every step. */
export const keepSerialBotProgram = (): Program => loneBot('keep_serial_bot', `(local.set $v (f64.const ${NORTH}))`);

/** A logic bot of the check input (Check input: playtest's Bot), playing its `press` array on `arrow`. */
export const logicBot = (p: Program, reads: string[] = []): Obj => ({ logic: { program: p.sha, reads, plays: { press: 'arrow' } } });
export const routeBot = (p: Program): Obj => logicBot(p, ROUTE_READS);
/** Criterion 1's policy: seeded arrow presses every 0.25 s. */
export const POLICY: Obj = { policy: { pick: { arrow: { from: [1, 2, 3, 4], every: 0.25 } } } };
