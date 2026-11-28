import { expect } from 'vitest';
import { checkCall, onLogic, type Program } from '../533/helpers.ts';
import { assemble, type Obj } from '../556/helpers.ts';
import { CLASSES, LOCKS, SIZE, START, floorOf, type FloorName, type Through } from './floors.ts';

export const ITEM = 'level';
export const CELLS = `${ITEM}.cells`;
export const DEPTH = `${ITEM}.depth`;
export const FLOOR_DEPTH = 1;
export const RUNS = 2;
export const SEED = 3263;
export const SPAN = 2;
export interface Need { goal: Through; through: Through[]; by?: 'agent' }

const WRITES: Obj = { cells: { type: 'i32', count: SIZE * SIZE }, depth: { type: 'i32' } };
const WRITES_AT = 1024;
const WRITES_END = 4096;
const HEAD = `(memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))`;

interface Entry { region: string; name: string; offset: number; size: number }
let layout: Entry[] | undefined;
function writeAt(name: string): number {
  if (!layout) {
    const probe = assemble('probe3263', `(module ${HEAD} (func (export "init") (param $seed i64)) (func (export "step") (param $k i64)))`);
    const [reply] = onLogic([checkCall(piece(probe) as never)]) as Obj[];
    expect(reply?.['ok'], `deep-logic check takes the layout probe: ${JSON.stringify(reply).slice(0, 1500)}`).toBe(true);
    layout = (reply!['items'][ITEM]['layout']['entries'] as Entry[]).filter((e) => e.region === 'writes');
    for (const e of layout) expect(WRITES_AT + e.offset + e.size, `${e.name} ends inside the program's one page of writes`).toBeLessThanOrEqual(WRITES_END);
  }
  const entry = layout.find((e) => e.name === name);
  if (!entry) throw Error(`the layout has no write ${name}: ${JSON.stringify(layout)}`);
  return WRITES_AT + entry.offset;
}

export function program(name: FloorName): Program {
  const cells = writeAt('cells');
  const stores = floorOf(name).cells.flatMap((value, i) => (value === 0 ? [] : [`(i32.store (i32.const ${cells + 4 * i}) (i32.const ${value}))`]));
  return assemble(`floor3263_${name}_${cells}`, `
(module
  ${HEAD}
  (func (export "init") (param $seed i64)
    ${stores.join('\n    ')}
    (i32.store (i32.const ${writeAt('depth')}) (i32.const ${FLOOR_DEPTH})))
  (func (export "step") (param $k i64)))`);
}

export function piece(p: Program): Obj {
  return {
    seed: SEED, class: 'figure', controls: {},
    items: { [ITEM]: { kind: 'logic@1', params: { program: p.sha, step_rate: 60, reads: [], writes: WRITES } } },
    assets: { [p.sha]: p.b64 },
  };
}

export function floorPlay(): Obj {
  return {
    grid: {
      cells: CELLS, size: [SIZE, SIZE], shape: 'square', moves: 4, floor: DEPTH,
      classes: Object.fromEntries(Object.entries(CLASSES).map(([name, values]) => [name, [...values]])),
      locks: { ...LOCKS },
    },
  };
}

export function playtest(at: string, play: Obj): Obj {
  return { piece: at, play, bots: [{ policy: {} }], runs: RUNS, seed: SEED, span: { steps: SPAN }, goals: [], frames: { every: 0 } };
}

export function reach(needs?: Need[]): Obj {
  return { playtest: 'R-floor', starts: [[...START]], goals: ['exit'], every: ['open'], depths: [FLOOR_DEPTH], ...(needs ? { needs } : {}) };
}
