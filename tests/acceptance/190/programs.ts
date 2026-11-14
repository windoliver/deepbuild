// This suite's logic programs and libraries, as an agent would write them (README: Programs), in WebAssembly text.
// A program that links libraries and every library is a relocatable object (README: Relocatable objects): it imports
// its memory as env.__linear_memory and its libraries' functions as lib:<name>.<function>; this suite's assembler
// (wat/) writes its `linking` and `reloc.CODE` sections. A program without links is a whole module, as #531's are.
// Programs that write region entries are built against the item's layout as `check` reports it (helpers: layoutFor).
//
// The expected values (routes, move counts, the values a fixture expects) are worked here from first principles: a
// breadth-first search of the same grid with grid_path@1's documented neighbor order, never read from a library.

import { assemble, entryAt, seeded, type Layout, type Program } from './helpers.ts';

/** A program built for no layout: `check` of an item naming it reports the item's layout. */
export const layoutProbe = (): Program => assemble('layout_probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);

/** An address in an object's own data, as this suite's assembler reads it: an R_WASM_MEMORY_ADDR_SLEB relocation. */
export const ADDR = (n: number): number => 0x4000_0000 + n;
/** WebAssembly text's string of these bytes. */
const dataText = (b: Buffer): string => Array.from(b, (x) => (x >= 0x20 && x < 0x7f && x !== 0x22 && x !== 0x5c ? String.fromCharCode(x) : `\\${x.toString(16).padStart(2, '0')}`)).join('');
const PAGE = 65_536;
const i32le = (xs: number[]): Buffer => { const b = Buffer.alloc(4 * xs.length); xs.forEach((x, i) => b.writeInt32LE(x, 4 * i)); return b; };

// ---------------------------------------------------------------------------------------------------
// grid_path: the grid search.

/** A grid: w × h cells, (x, y) from (0, 0), the blocked cells, and the route asked for. */
export interface Grid { w: number; h: number; walls: [number, number][]; from: [number, number]; to: [number, number] }
/** grid_path@1's fixture grid (the issue's): 5 × 5, walls on (2, 0) to (2, 3), a route from (0, 0) to (4, 0). */
export const FIXTURE_GRID: Grid = { w: 5, h: 5, walls: [[2, 0], [2, 1], [2, 2], [2, 3]], from: [0, 0], to: [4, 0] };
/** grid_path@1's neighbor order, its documented contract: E, W, S, N, SE, SW, NE, NW, each (dx, dy). */
export const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
/**
 * grid_path@1's contract, worked here: a breadth-first search over 8-connected moves of unit cost, neighbors tried in
 * DIRS order, a cell's predecessor the first cell that reaches it, stopping when the goal leaves the queue; a diagonal
 * move is taken only when both cells beside it are open (no diagonal past a blocked cell), unless `cut`, the planted
 * library's wrong rule. The route's cells from start to goal, or null when none reaches it.
 */
export function bfsRoute(g: Grid, cut = false): [number, number][] | null {
  const blocked = new Set(g.walls.map(([x, y]) => y * g.w + x));
  const prev = new Array<number>(g.w * g.h).fill(-1);
  const start = g.from[1] * g.w + g.from[0];
  const goal = g.to[1] * g.w + g.to[0];
  prev[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    if (cur === goal) break;
    const cx = cur % g.w; const cy = Math.floor(cur / g.w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx; const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const ni = ny * g.w + nx;
      if (blocked.has(ni) || prev[ni] !== -1) continue;
      if (!cut && dx !== 0 && dy !== 0 && (blocked.has(cy * g.w + nx) || blocked.has(ny * g.w + cx))) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return null;
  const cells: [number, number][] = [];
  for (let i = goal; ; i = prev[i]!) { cells.unshift([i % g.w, Math.floor(i / g.w)]); if (i === start) break; }
  return cells;
}
/** The most route cells a route program writes. */
export const ROUTE_CELLS = 25;
/** The `route` array a route program writes: each cell's x and y, then -1 to ROUTE_CELLS cells. */
export const routeArray = (cells: [number, number][] | null): number[] => {
  const out = new Array<number>(2 * ROUTE_CELLS).fill(-1);
  (cells ?? []).slice(0, ROUTE_CELLS).forEach(([x, y], i) => { out[2 * i] = x; out[2 * i + 1] = y; });
  return out;
};
/** A route program's writes: the route, then its move count. */
export const ROUTE_WRITES = { route: { type: 'i32' as const, count: 2 * ROUTE_CELLS }, moves: { type: 'i32' as const } };
export const V_WRITES = { v: { type: 'i32' as const } };

export interface GridPathOptions {
  /** The planted library: diagonals cut a blocked cell's corner. */
  cut?: boolean;
  /** One byte of its data, past the neighbor table: a library one byte apart. */
  pad?: number;
  /** An import of the host function env.now, never called (criterion 8). */
  hostImport?: boolean;
  /** grid_path@2: the same search, and `version` returning 2. */
  v2?: boolean;
}
/**
 * grid_path, a library: `find_route(grid, w, h, sx, sy, gx, gy, scratch, out) → moves` searches the w × h grid of
 * bytes at `grid` (non-zero: blocked) from (sx, sy) to (gx, gy) as bfsRoute does, using 8 × w × h bytes at `scratch`,
 * writes the route's cells at `out` as i32 pairs and returns its move count, or -1. Its neighbor table is its own
 * data (64 bytes, then 8 bytes of padding), read through a relocated address, so a linker that misplaces the
 * libraries' data breaks it.
 */
export function gridPath(o: GridPathOptions = {}): Program {
  const table = Buffer.concat([i32le(DIRS.flat()), Buffer.from([o.pad ?? 0, 0, 0, 0, 0, 0, 0, 0])]);
  const corner = o.cut ? '' : `
            (if (i32.and (i32.ne (local.get $dx) (i32.const 0)) (i32.ne (local.get $dy) (i32.const 0)))
              (then
                (br_if $next (i32.load8_u (i32.add (local.get $g) (i32.add (i32.mul (local.get $cy) (local.get $w)) (local.get $nx)))))
                (br_if $next (i32.load8_u (i32.add (local.get $g) (i32.add (i32.mul (local.get $ny) (local.get $w)) (local.get $cx)))))))`;
  const name = `grid_path${o.cut ? '_cut' : ''}${o.v2 ? '_v2' : ''}${o.hostImport ? '_host' : ''}_${o.pad ?? 0}`;
  return assemble(name, `
(module
  (import "env" "__linear_memory" (memory 0))
  ${o.hostImport ? '(import "env" "now" (func $now (result i64)))' : ''}
  (func $find_route (export "find_route") (param $g i32) (param $w i32) (param $h i32) (param $sx i32) (param $sy i32)
    (param $gx i32) (param $gy i32) (param $prev i32) (param $out i32) (result i32)
    (local $n i32) (local $q i32) (local $head i32) (local $tail i32) (local $cur i32) (local $cx i32) (local $cy i32)
    (local $d i32) (local $dx i32) (local $dy i32) (local $nx i32) (local $ny i32) (local $ni i32) (local $start i32)
    (local $goal i32) (local $len i32) (local $i i32) (local $dirs i32)
    (local.set $dirs (i32.const ${ADDR(0)}))
    (local.set $n (i32.mul (local.get $w) (local.get $h)))
    (local.set $q (i32.add (local.get $prev) (i32.shl (local.get $n) (i32.const 2))))
    (memory.fill (local.get $prev) (i32.const 255) (i32.shl (local.get $n) (i32.const 2)))
    (local.set $start (i32.add (i32.mul (local.get $sy) (local.get $w)) (local.get $sx)))
    (local.set $goal (i32.add (i32.mul (local.get $gy) (local.get $w)) (local.get $gx)))
    (i32.store (i32.add (local.get $prev) (i32.shl (local.get $start) (i32.const 2))) (local.get $start))
    (i32.store (local.get $q) (local.get $start))
    (local.set $tail (i32.const 1))
    (block $done
      (loop $bfs
        (br_if $done (i32.ge_u (local.get $head) (local.get $tail)))
        (local.set $cur (i32.load (i32.add (local.get $q) (i32.shl (local.get $head) (i32.const 2)))))
        (local.set $head (i32.add (local.get $head) (i32.const 1)))
        (br_if $done (i32.eq (local.get $cur) (local.get $goal)))
        (local.set $cx (i32.rem_u (local.get $cur) (local.get $w)))
        (local.set $cy (i32.div_u (local.get $cur) (local.get $w)))
        (local.set $d (i32.const 0))
        (loop $each
          (block $next
            (local.set $dx (i32.load (i32.add (local.get $dirs) (i32.shl (local.get $d) (i32.const 3)))))
            (local.set $dy (i32.load offset=4 (i32.add (local.get $dirs) (i32.shl (local.get $d) (i32.const 3)))))
            (local.set $nx (i32.add (local.get $cx) (local.get $dx)))
            (local.set $ny (i32.add (local.get $cy) (local.get $dy)))
            (br_if $next (i32.ge_u (local.get $nx) (local.get $w)))
            (br_if $next (i32.ge_u (local.get $ny) (local.get $h)))
            (local.set $ni (i32.add (i32.mul (local.get $ny) (local.get $w)) (local.get $nx)))
            (br_if $next (i32.load8_u (i32.add (local.get $g) (local.get $ni))))
            (br_if $next (i32.ne (i32.load (i32.add (local.get $prev) (i32.shl (local.get $ni) (i32.const 2)))) (i32.const -1)))${corner}
            (i32.store (i32.add (local.get $prev) (i32.shl (local.get $ni) (i32.const 2))) (local.get $cur))
            (i32.store (i32.add (local.get $q) (i32.shl (local.get $tail) (i32.const 2))) (local.get $ni))
            (local.set $tail (i32.add (local.get $tail) (i32.const 1))))
          (local.set $d (i32.add (local.get $d) (i32.const 1)))
          (br_if $each (i32.lt_u (local.get $d) (i32.const 8))))
        (br $bfs)))
    (if (i32.eq (i32.load (i32.add (local.get $prev) (i32.shl (local.get $goal) (i32.const 2)))) (i32.const -1))
      (then (return (i32.const -1))))
    (local.set $i (local.get $goal))
    (block $counted
      (loop $count
        (br_if $counted (i32.eq (local.get $i) (local.get $start)))
        (local.set $i (i32.load (i32.add (local.get $prev) (i32.shl (local.get $i) (i32.const 2)))))
        (local.set $len (i32.add (local.get $len) (i32.const 1)))
        (br $count)))
    (local.set $i (local.get $goal))
    (local.set $d (local.get $len))
    (loop $write
      (i32.store (i32.add (local.get $out) (i32.shl (local.get $d) (i32.const 3))) (i32.rem_u (local.get $i) (local.get $w)))
      (i32.store offset=4 (i32.add (local.get $out) (i32.shl (local.get $d) (i32.const 3))) (i32.div_u (local.get $i) (local.get $w)))
      (if (i32.gt_u (local.get $d) (i32.const 0))
        (then
          (local.set $i (i32.load (i32.add (local.get $prev) (i32.shl (local.get $i) (i32.const 2)))))
          (local.set $d (i32.sub (local.get $d) (i32.const 1)))
          (br $write))))
    (local.get $len))
  ${o.v2 ? '(func $version (export "version") (result i32) (i32.const 2))' : ''}
  (data (i32.const 0) "${dataText(table)}"))`, 'library');
}

/** A program object's memory map: the regions, then the grid, the route's cells and the search's scratch, all its own data. */
const GRID_AT = 8192;
const align8 = (n: number): number => Math.ceil(n / 8) * 8;
function gridData(g: Grid): { bytes: Buffer; grid: number; out: number; scratch: number; pages: number } {
  const n = g.w * g.h;
  const out = align8(GRID_AT + n);
  const scratch = out + 8 * n;
  const end = scratch + 8 * n;
  const bytes = Buffer.alloc(end);
  for (const [x, y] of g.walls) bytes[GRID_AT + y * g.w + x] = 1;
  return { bytes, grid: GRID_AT, out, scratch, pages: Math.ceil(end / PAGE) + 1 };
}
const FIND_ROUTE_TYPE = '(param i32 i32 i32 i32 i32 i32 i32 i32 i32) (result i32)';
const searchArgs = (g: Grid, d: ReturnType<typeof gridData>): string =>
  [d.grid, g.w, g.h, g.from[0], g.from[1], g.to[0], g.to[1], d.scratch, d.out].map((v) => `(i32.const ${v})`).join(' ');
const programHead = (pages: number, imports: string): string => `
  (import "env" "__linear_memory" (memory ${pages} ${pages}))
  ${imports}
  (global $reads_at (export "reads_at") i32 (i32.const 0))
  (global $writes_at (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))`;

/**
 * A route program (an object that links grid_path): every step it calls lib:grid_path.find_route on its grid and
 * writes the route (routeArray's layout) and the move count. Item: writes ROUTE_WRITES, links grid_path.
 */
export function routeProgram(l: Layout, g: Grid, name = 'route'): Program {
  const d = gridData(g);
  const route = 4096 + entryAt(l, 'writes', 'route');
  const moves = 4096 + entryAt(l, 'writes', 'moves');
  return assemble(`${name}_${g.w}x${g.h}_${route}_${moves}`, `
(module${programHead(d.pages, `(import "lib:grid_path" "find_route" (func $find_route ${FIND_ROUTE_TYPE}))`)}
  (func $step (export "step") (param $k i64) (local $n i32) (local $c i32)
    (local.set $n (call $find_route ${searchArgs(g, d)}))
    (i32.store (i32.const ${moves}) (local.get $n))
    (memory.fill (i32.const ${route}) (i32.const 255) (i32.const ${8 * ROUTE_CELLS}))
    (if (i32.ge_s (local.get $n) (i32.const 0))
      (then
        (local.set $c (i32.add (local.get $n) (i32.const 1)))
        (if (i32.gt_u (local.get $c) (i32.const ${ROUTE_CELLS})) (then (local.set $c (i32.const ${ROUTE_CELLS}))))
        (memory.copy (i32.const ${route}) (i32.const ${d.out}) (i32.shl (local.get $c) (i32.const 3))))))
  (data (i32.const 0) "${dataText(d.bytes)}"))`, 'program');
}

// ---------------------------------------------------------------------------------------------------
// Libraries that call libraries (criteria 3 and 9).

/** The cell plan returns: the route's second cell as x + 1000 × y, or -1 for a route under one move. */
export const planOf = (cells: [number, number][] | null): number => (cells && cells.length > 1 ? cells[1]![0] + 1000 * cells[1]![1] : -1);
/** pathing, a library that needs grid_path: `plan(…find_route's parameters) → planOf(the route)`. */
export const pathing = (): Program => assemble('pathing', `
(module
  (import "env" "__linear_memory" (memory 0))
  (import "lib:grid_path" "find_route" (func $find_route ${FIND_ROUTE_TYPE}))
  (func $plan (export "plan") (param $g i32) (param $w i32) (param $h i32) (param $sx i32) (param $sy i32)
    (param $gx i32) (param $gy i32) (param $scratch i32) (param $out i32) (result i32)
    (if (i32.lt_s (call $find_route (local.get $g) (local.get $w) (local.get $h) (local.get $sx) (local.get $sy)
          (local.get $gx) (local.get $gy) (local.get $scratch) (local.get $out)) (i32.const 1))
      (then (return (i32.const -1))))
    (i32.add (i32.load offset=8 (local.get $out)) (i32.mul (i32.load offset=12 (local.get $out)) (i32.const 1000)))))`, 'library');
/** scout, a library that needs grid_path@2: `scout(…find_route's parameters) → moves`. */
export const scout = (): Program => assemble('scout', `
(module
  (import "env" "__linear_memory" (memory 0))
  (import "lib:grid_path" "find_route" (func $find_route ${FIND_ROUTE_TYPE}))
  (func $scout (export "scout") (param $g i32) (param $w i32) (param $h i32) (param $sx i32) (param $sy i32)
    (param $gx i32) (param $gy i32) (param $scratch i32) (param $out i32) (result i32)
    (call $find_route (local.get $g) (local.get $w) (local.get $h) (local.get $sx) (local.get $sy)
      (local.get $gx) (local.get $gy) (local.get $scratch) (local.get $out))))`, 'library');
/** A tactics program: every step it writes `v`, lib:pathing.plan of its grid (or another library's function of find_route's parameters). Item: writes V_WRITES, links pathing. */
export function tacticsProgram(l: Layout, g: Grid, lib = 'pathing', fn = 'plan'): Program {
  const d = gridData(g);
  const v = 4096 + entryAt(l, 'writes', 'v');
  return assemble(`tactics_${lib}_${fn}_${g.w}x${g.h}_${v}`, `
(module${programHead(d.pages, `(import "lib:${lib}" "${fn}" (func $plan ${FIND_ROUTE_TYPE}))`)}
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const ${v}) (call $plan ${searchArgs(g, d)})))
  (data (i32.const 0) "${dataText(d.bytes)}"))`, 'program');
}
/** ping and pong, two libraries that call each other: ping(x) = x = 0 ? 0 : pong(x − 1), and pong the same of ping. */
export const pingPong = (me: 'ping' | 'pong'): Program => {
  const other = me === 'ping' ? 'pong' : 'ping';
  return assemble(me, `
(module
  (import "env" "__linear_memory" (memory 0))
  (import "lib:${other}" "${other}" (func $other (param i32) (result i32)))
  (func $me (export "${me}") (param $x i32) (result i32)
    (if (result i32) (i32.eqz (local.get $x)) (then (i32.const 0)) (else (call $other (i32.sub (local.get $x) (i32.const 1)))))))`, 'library');
};
/** turns, a library: next_turn(k, players) = (k + 1) mod players. */
export const turns = (): Program => assemble('turns', `
(module
  (import "env" "__linear_memory" (memory 0))
  (func $next_turn (export "next_turn") (param $k i32) (param $players i32) (result i32)
    (i32.rem_u (i32.add (local.get $k) (i32.const 1)) (local.get $players))))`, 'library');
export const nextTurn = (k: number, players: number): number => (k + 1) % players;

/** A program object that writes `v` = the call each step makes: `call` is its body's expression, k the step as an i32. */
function valueProgram(l: Layout, name: string, imports: string, call: string, pages = 1): Program {
  const v = 4096 + entryAt(l, 'writes', 'v');
  return assemble(`${name}_${v}`, `
(module${programHead(pages, imports)}
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const ${v}) ${call.replaceAll('$K', '(i32.wrap_i64 (local.get $k))')}))
  (data (i32.const 0) "${dataText(Buffer.alloc(8192))}"))`, 'program');
}
/** v = lib:ping.ping(3) (or pong's): 0 once linked. */
export const pingProgram = (l: Layout, me: 'ping' | 'pong' = 'ping'): Program => valueProgram(l, `${me}_user`, `(import "lib:${me}" "${me}" (func $f (param i32) (result i32)))`, '(call $f (i32.const 3))');
/** v = lib:turns.next_turn(k, 3). */
export const turnsProgram = (l: Layout): Program => valueProgram(l, 'turns_user', '(import "lib:turns" "next_turn" (func $next_turn (param i32 i32) (result i32)))', '(call $next_turn $K (i32.const 3))');

// ---------------------------------------------------------------------------------------------------
// Sized libraries (criteria 3 and 10).

/** bulk, a library whose data is `n` bytes of "a" (0x61): first() reads its first byte, 97. */
export const bulk = (n: number): Program => assemble(`bulk_${n}`, `
(module
  (import "env" "__linear_memory" (memory 0))
  (func $first (export "first") (result i32) (i32.load8_u (i32.const ${ADDR(0)})))
  (data (i32.const 0) "${'a'.repeat(n)}"))`, 'library');
/** The memory a bulk program declares: room for 4 MiB of library data after its own 8 KiB. */
export const BULK_PAGES = 128;
/** v = lib:bulk.first(), with BULK_PAGES pages (its item's budget.memory is 8 MiB). */
export const bulkProgram = (l: Layout): Program => valueProgram(l, 'bulk_user', '(import "lib:bulk" "first" (func $first (result i32)))', '(call $first)', BULK_PAGES);

/** Junk work in a function body: `lines` xors into $y, each a 5-byte constant, so code size is known. */
const junk = (lines: number, salt: number): string => Array.from({ length: lines }, (_, j) => `(local.set $y (i32.xor (local.get $y) (i32.const ${0x1000_0000 + ((salt * 7919 + j * 104_729) % 0x0fff_ffff)})))`).join('\n    ');
/** Functions f0 … f(count − 1): f_i(x) = (i mod 64 = 0 ? x : f_(i−1)(x)) + 1 after `lines` lines of junk; so f_i(x) = x + (i mod 64) + 1. */
const chain = (count: number, lines: number, salt: number): string => Array.from({ length: count }, (_, i) => `
  (func $f${i} (param $x i32) (result i32) (local $y i32)
    ${junk(lines, salt + i)}
    (i32.add ${i % 64 === 0 ? '(local.get $x)' : `(call $f${i - 1} (local.get $x))`} (i32.const 1)))`).join('');
/** Bytes each junk line takes in the code section. */
const LINE_BYTES = 10;
/** A library of about `size` bytes, half code and half seeded data: top(x) = f_last(x) + its data's last byte. */
export interface BigLib { program: Program; top: (x: number) => number }
export function bigLib(name: string, size: number, seed: number): BigLib {
  const count = Math.max(1, Math.round(size / 2 / (100 * LINE_BYTES)));
  const r = seeded(seed);
  const data = Buffer.from(Array.from({ length: Math.round(size / 2) }, () => Math.floor(r() * 256)));
  const program = assemble(`${name}_${size}_${seed}`, `
(module
  (import "env" "__linear_memory" (memory 0))${chain(count, 100, seed)}
  (func $top (export "top") (param $x i32) (result i32)
    (i32.add (call $f${count - 1} (local.get $x)) (i32.load8_u (i32.const ${ADDR(data.length - 1)}))))
  (data (i32.const 0) "${dataText(data)}"))`, 'library');
  return { program, top: (x) => x + ((count - 1) % 64) + 1 + data[data.length - 1]! };
}
/** A program of about `size` bytes, half code and half data, that writes v = lib:big_a.top(k) + lib:big_b.top(k) + its own chain's. */
export function bigProgram(l: Layout, size: number): Program {
  const count = Math.max(1, Math.round(size / 2 / (100 * LINE_BYTES)));
  const pages = Math.ceil((8192 + size / 2) / PAGE) + 20;
  const v = 4096 + entryAt(l, 'writes', 'v');
  return assemble(`big_program_${size}_${v}`, `
(module${programHead(pages, `(import "lib:big_a" "top" (func $a (param i32) (result i32)))
  (import "lib:big_b" "top" (func $b (param i32) (result i32)))`)}${chain(count, 100, 190_10)}
  (func $step (export "step") (param $k i64) (local $x i32)
    (local.set $x (i32.wrap_i64 (local.get $k)))
    (i32.store (i32.const ${v}) (i32.add (i32.add (call $a (local.get $x)) (call $b (local.get $x))) (call $f${count - 1} (local.get $x)))))
  (data (i32.const 0) "${dataText(Buffer.alloc(8192 + Math.round(size / 2)))}"))`, 'program');
}
/** v = lib:<lib>.top(k): a big library's fixture program. */
export const topProgram = (l: Layout, lib: string): Program => valueProgram(l, `${lib}_user`, `(import "lib:${lib}" "top" (func $top (param i32) (result i32)))`, '(call $top $K)', 1);

// ---------------------------------------------------------------------------------------------------
// A program without links (criteria 1, 7 and 10): a whole module, as #531's.

/** count: a counter in a mutable global, written each step as `v`. Item: writes V_WRITES. */
export const counter = (l: Layout): Program => {
  const v = 4096 + entryAt(l, 'writes', 'v');
  return assemble(`counter_${v}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $c (mut i32) (i32.const 0))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (global.set $c (i32.add (global.get $c) (i32.const 1)))
    (i32.store (i32.const ${v}) (global.get $c))))`);
};
