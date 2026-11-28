export type Cell = readonly [number, number];
export interface Floor { w: number; h: number; cells: readonly number[] }
export type Through = string | Cell;
export type FloorName = 'locked' | 'opened' | 'rooms' | 'nokey' | 'walled';

export const SIZE = 9;
export const CLASSES = { open: [0], blocked: [1], door: [2], locked: [3], key: [4], exit: [5] } as const;
export const LOCKS = { '3': 4 } as const;
export const START: Cell = [1, 4];
export const EXIT: Cell = [7, 4];
export const LOCKED_DOOR: Cell = [4, 4];
export const OPENED: Cell = [4, 3];

const GLYPHS: Readonly<Record<string, number>> = { '.': 0, '#': 1, d: 2, L: 3, k: 4, E: 5 };
export const DRAWN: Readonly<Record<FloorName, readonly string[]>> = {
  locked: [
    '#########',
    '#...#...#',
    '#...#...#',
    '#...#...#',
    '#...L..E#',
    '#...#...#',
    '##d######',
    '#.k.#####',
    '#########',
  ],
  opened: [
    '#########',
    '#...#...#',
    '#...#...#',
    '#.......#',
    '#...L..E#',
    '#...#...#',
    '##d######',
    '#.k.#####',
    '#########',
  ],
  rooms: [
    '#########',
    '#..ddd..#',
    '#.#ddd#.#',
    '#.#ddd#.#',
    '#.#####E#',
    '#.#kkk#.#',
    '#.#kkk#.#',
    '#..kkk..#',
    '#########',
  ],
  nokey: [
    '#########',
    '#...#...#',
    '#...#...#',
    '#...#...#',
    '#...d..E#',
    '#...#...#',
    '##d######',
    '#...#####',
    '#########',
  ],
  walled: [
    '#########',
    '#...#...#',
    '#...#...#',
    '#...#..##',
    '#...L.#E#',
    '#...#..##',
    '##d######',
    '#.k.#####',
    '#########',
  ],
};

export function floorOf(name: FloorName): Floor {
  const rows = DRAWN[name];
  const cells = rows.flatMap((row) => [...row].map((glyph) => {
    const value = GLYPHS[glyph];
    if (value === undefined) throw Error(`the drawn floor ${name} holds ${glyph}, which is no glyph of ${Object.keys(GLYPHS).join(' ')}`);
    return value;
  }));
  if (rows.length !== SIZE || rows.some((row) => row.length !== SIZE)) throw Error(`the drawn floor ${name} isn't ${SIZE} × ${SIZE}`);
  return { w: SIZE, h: SIZE, cells };
}

const PASSABLE: ReadonlySet<string> = new Set(['open', 'door', 'key', 'exit']);
export function classOf(value: number): string {
  return Object.entries(CLASSES).find(([, values]) => (values as readonly number[]).includes(value))?.[0] ?? 'blocked';
}
export const indexOf = (floor: Floor, [x, y]: Cell): number => y * floor.w + x;
export const cellOf = (floor: Floor, i: number): Cell => [i % floor.w, Math.floor(i / floor.w)];
export const said = ([x, y]: Cell): string => `[${x}, ${y}]`;
export const same = (a: Cell, b: Cell): boolean => a[0] === b[0] && a[1] === b[1];
export const cellsOfClass = (floor: Floor, name: string): number[] => floor.cells.flatMap((value, i) => (classOf(value) === name ? [i] : []));

export function neighbours(floor: Floor, i: number): number[] {
  const [x, y] = cellOf(floor, i);
  const steps: Cell[] = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
  return steps.filter(([a, b]) => a >= 0 && a < floor.w && b >= 0 && b < floor.h).map((cell) => indexOf(floor, cell));
}

export function closedBy(floor: Floor, through: readonly Through[]): Set<number> {
  const closed = new Set<number>();
  for (const entry of through) {
    if (typeof entry === 'string') for (const i of cellsOfClass(floor, entry)) closed.add(i);
    else closed.add(indexOf(floor, entry));
  }
  return closed;
}

export function reachedFrom(floor: Floor, starts: readonly number[], closed: ReadonlySet<number> = new Set()): Set<number> {
  const locks: Readonly<Record<string, number>> = LOCKS;
  const keyValues = new Set(Object.values(locks));
  const held = new Set<number>();
  for (;;) {
    const reached = new Set(starts.filter((i) => !closed.has(i)));
    const queue = [...reached];
    for (let q = 0; q < queue.length; q++) {
      for (const n of neighbours(floor, queue[q]!)) {
        if (reached.has(n) || closed.has(n)) continue;
        const value = floor.cells[n]!;
        const name = classOf(value);
        const key = locks[String(value)];
        if (PASSABLE.has(name) || (name === 'locked' && key !== undefined && held.has(key))) { reached.add(n); queue.push(n); }
      }
    }
    const found = [...reached].map((i) => floor.cells[i]!).filter((value) => keyValues.has(value) && !held.has(value));
    if (!found.length) return reached;
    for (const value of found) held.add(value);
  }
}

export interface Fact { goal: boolean; through: number; closedGoal: boolean }
export function needFact(floor: Floor, starts: readonly number[], goal: readonly number[], through: readonly Through[]): Fact {
  const closed = closedBy(floor, through);
  const plain = reachedFrom(floor, starts);
  const shut = reachedFrom(floor, starts, closed);
  return { goal: goal.length > 0 && goal.every((i) => plain.has(i)), through: closed.size, closedGoal: goal.some((i) => shut.has(i)) };
}

const startOf = (floor: Floor): number[] => [indexOf(floor, START)];
const exitOf = (floor: Floor): number => indexOf(floor, EXIT);
const reaches = (floor: Floor, through: readonly Through[]): boolean => reachedFrom(floor, startOf(floor), closedBy(floor, through)).has(exitOf(floor));
const count = (floor: Floor, name: string): number => cellsOfClass(floor, name).length;
const unreachedOpen = (floor: Floor): string[] => {
  const reached = reachedFrom(floor, startOf(floor));
  return cellsOfClass(floor, 'open').filter((i) => !reached.has(i)).map((i) => said(cellOf(floor, i)));
};
const shape = (floor: Floor, name: FloorName): string[] => [
  ...(floor.cells.length === SIZE * SIZE ? [] : [`${name} holds ${floor.cells.length} cells, not ${SIZE} × ${SIZE}`]),
  ...(classOf(floor.cells[exitOf(floor)]!) === 'exit' && count(floor, 'exit') === 1 ? [] : [`${name}'s one exit isn't at ${said(EXIT)}`]),
  ...(classOf(floor.cells[indexOf(floor, START)]!) === 'open' ? [] : [`${name}'s start ${said(START)} isn't an open cell`]),
];

export function lockedFacts(): string[] {
  const floor = floorOf('locked');
  return [
    ...shape(floor, 'locked'),
    ...(classOf(floor.cells[indexOf(floor, LOCKED_DOOR)]!) === 'locked' && count(floor, 'locked') === 1 ? [] : [`locked's one locked door isn't at ${said(LOCKED_DOOR)}`]),
    ...(count(floor, 'key') === 1 ? [] : [`locked holds ${count(floor, 'key')} key cells, not 1`]),
    ...(reaches(floor, []) ? [] : ['locked: the search with its key doesn\'t reach the exit']),
    ...(unreachedOpen(floor).length ? [`locked: the search with its key leaves open cells unreached: ${unreachedOpen(floor).join(' ')}`] : []),
    ...(reaches(floor, [LOCKED_DOOR]) ? ['locked: the exit is reached with the locked door closed, so it doesn\'t lie behind it'] : []),
    ...(reachedFrom(floor, startOf(floor), closedBy(floor, ['door'])).has(cellsOfClass(floor, 'key')[0] ?? -1) ? ['locked: the key is reached with the side room\'s door closed, so it lies in no side room'] : []),
    ...(reaches(floor, ['key']) ? ['locked: the exit is reached with the key cells closed'] : []),
  ];
}

export function openedFacts(): string[] {
  const floor = floorOf('opened');
  const locked = floorOf('locked');
  const differ = floor.cells.flatMap((value, i) => (value === locked.cells[i] ? [] : [i]));
  const at = indexOf(floor, OPENED);
  return [
    ...shape(floor, 'opened'),
    ...(differ.length === 1 && differ[0] === at ? [] : [`opened differs from locked at ${differ.map((i) => said(cellOf(floor, i))).join(' ') || 'no cell'}, not at ${said(OPENED)} alone`]),
    ...(classOf(locked.cells[at]!) === 'blocked' && classOf(floor.cells[at]!) === 'open' ? [] : [`${said(OPENED)} isn't a wall cell of locked that opened is open at`]),
    ...(neighbours(floor, indexOf(floor, LOCKED_DOOR)).includes(at) ? [] : [`${said(OPENED)} isn't beside the locked door ${said(LOCKED_DOOR)}`]),
    ...(reaches(floor, []) ? [] : ['opened: the search with its key doesn\'t reach the exit']),
    ...(unreachedOpen(floor).length ? [`opened: the search with its key leaves open cells unreached: ${unreachedOpen(floor).join(' ')}`] : []),
    ...(reaches(floor, ['key']) ? [] : ['opened: the exit isn\'t reached with the key cells closed, so no route skips the key']),
    ...(reaches(floor, ['key', OPENED]) ? ['opened: the exit is reached with the key cells and the opened cell closed, so a route skips the key without crossing it'] : []),
  ];
}

export const ROOMS = { first: 'door', second: 'key' } as const;
export function roomsFacts(): string[] {
  const floor = floorOf('rooms');
  return [
    ...shape(floor, 'rooms'),
    ...(count(floor, ROOMS.first) === 9 && count(floor, ROOMS.second) === 9 ? [] : [`rooms: its two rooms hold ${count(floor, ROOMS.first)} ${ROOMS.first} and ${count(floor, ROOMS.second)} ${ROOMS.second} cells, not 9 each`]),
    ...(count(floor, 'locked') === 0 ? [] : ['rooms holds a locked cell']),
    ...(reaches(floor, []) ? [] : ['rooms: the search doesn\'t reach the exit']),
    ...(unreachedOpen(floor).length ? [`rooms: the search leaves open cells unreached: ${unreachedOpen(floor).join(' ')}`] : []),
    ...(reaches(floor, [ROOMS.first]) ? [] : [`rooms: the exit isn't reached with the ${ROOMS.first} room closed`]),
    ...(reaches(floor, [ROOMS.second]) ? [] : [`rooms: the exit isn't reached with the ${ROOMS.second} room closed`]),
    ...(reaches(floor, [ROOMS.first, ROOMS.second]) ? ['rooms: the exit is reached with both rooms closed'] : []),
  ];
}

export function nokeyFacts(): string[] {
  const floor = floorOf('nokey');
  return [
    ...shape(floor, 'nokey'),
    ...(count(floor, 'key') === 0 ? [] : [`nokey holds ${count(floor, 'key')} key cells, not 0`]),
    ...(reaches(floor, []) ? [] : ['nokey: the search doesn\'t reach the exit']),
    ...(unreachedOpen(floor).length ? [`nokey: the search leaves open cells unreached: ${unreachedOpen(floor).join(' ')}`] : []),
  ];
}

export function walledFacts(): string[] {
  const floor = floorOf('walled');
  const ring = neighbours(floor, exitOf(floor)).filter((i) => classOf(floor.cells[i]!) !== 'blocked');
  return [
    ...shape(floor, 'walled'),
    ...(count(floor, 'key') === 1 ? [] : [`walled holds ${count(floor, 'key')} key cells, not 1`]),
    ...(ring.length ? [`walled: the exit's neighbours ${ring.map((i) => said(cellOf(floor, i))).join(' ')} aren't blocked`] : []),
    ...(reaches(floor, []) ? ['walled: the search with its key reaches the exit'] : []),
    ...(unreachedOpen(floor).length ? [`walled: the search with its key leaves open cells unreached: ${unreachedOpen(floor).join(' ')}`] : []),
  ];
}
