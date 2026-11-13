// AC5 #539.ece9dcef, Oracle lane: the pinned upstream focus-group tests (README: Sources), re-expressed and run against
// our output. Upstream checks that a focus group is one Tab stop that Tab enters at its first item and the next Tab leaves
// for the next control, that arrow keys move over a grid's rows and columns and skip a cell that can't take focus, and
// Home and End. Ours: each upstream group is a grid of rows (`strip`, 16 u cells laid out by grid.size from a logic
// item, at (8, 8)) named by a pick control with `focus`, a cell that can't take focus a row whose alive is false;
// "focus X, then press K" is a document whose `focus.start` is X, entered by Tab, then K. Every case reads the scope's
// `state.focus` through `deep-show run` (the #539 suite's surface); nothing upstream is copied or run.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Script, TIMEOUT, binOf, focusOf, none, pickControl, prebuild, presented, putAtlas, putEvidence, rowId, runShow, scenario, show,
  slider, stripDoc, useTemp, worldProgram, type Cell, type JsonObject, type WorldPlan,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const strip = (c: Cell): string => rowId('strip', c);

/** One case: a strip on `plan` with its controls, the keys pressed after the document is shown, and the focus wanted after each. */
interface Case { name: string; plan: WorldPlan; controls?: JsonObject; start?: Cell; keys: string[]; want: (string | Cell)[] }
/** Every case of one upstream file in one scenario, each document in a panel of its own; the failures, each naming its case. */
function run(file: string, cases: Case[]): string[] {
  const ev = temp();
  const atlas = putAtlas(ev);
  const docs = cases.map((_, i) => DOC(500 + i));
  const s = new Script();
  const at: number[][] = [];
  cases.forEach((c, i) => {
    const world = worldProgram(c.plan);
    putEvidence(ev, world.bytes);
    s.panel = `p${i + 1}`;
    s.present(docs[i]!, stripDoc(`case-${i}`, atlas, world, c.plan, c.controls ?? { group: pickControl('Group', ['strip'], c.start ? { start: c.start } : {}) }));
    s.scope();
  });
  cases.forEach((c, i) => {
    s.panel = `p${i + 1}`;
    at.push(c.keys.map((k) => s.key(k)));
  });
  const width = Math.max(...cases.map((c) => 16 * c.plan.cols + 16));
  const height = Math.max(...cases.map((c) => 16 * c.plan.rows + 16));
  const r = runShow(binOf(), scenario(ev, docs, s.calls, { rect: [0, 0, 4 * width, 4 * height] }), `the Oracle lane: ${file}`);
  const failures: string[] = [];
  cases.forEach((c, i) => {
    presented(r[2 * i]!, `${file}: ${c.name}`);
    const got = at[i]!.map((j, k) => focusOf(r[j]!, `${c.name}: after ${c.keys[k]}`));
    const want = c.want.map((w) => (typeof w === 'string' ? w : strip(w)));
    if (show(got) !== show(want)) failures.push(`${file}: ${c.name}: after ${c.keys.join(', ')} the focus is ${show(got)}, not ${show(want)}`);
  });
  return failures;
}

const AROUND: JsonObject = { before: slider('Before'), group: pickControl('Group', ['strip'], {}), next: slider('Next') };
const ROW3: WorldPlan = { cols: 3, rows: 1 };
const GRID: WorldPlan = { cols: 3, rows: 2 };
const HOLE: WorldPlan = { cols: 3, rows: 3, dead: [[1, 1]] };
const COLUMN3: WorldPlan = { cols: 1, rows: 3 };
const ROW5_GAP: WorldPlan = { cols: 5, rows: 1, dead: [[2, 0]] };

describe(`${AC[5]} Oracle lane: the pinned upstream focus-group tests, run against the grid focus of our rows`, () => {
  it(`${AC[5]} sequential navigation: Tab enters the group at its first item and the next Tab leaves for the next control; arrows move within it`, () => {
    none(run('the sequential-navigation Tab test', [
      { name: 'Tab enters at the first item, and exits to the next control', plan: ROW3, controls: AROUND, keys: ['Tab', 'Tab', 'Tab'], want: ['before', [0, 0], 'next'] },
      { name: 'directional input keeps working within the group', plan: ROW3, controls: AROUND, keys: ['Tab', 'Tab', 'ArrowRight', 'ArrowRight'], want: ['before', [0, 0], [1, 0], [2, 0]] },
    ]), 'the Tab stop');
  }, TIMEOUT);

  it(`${AC[5]} the grid's simple case: Right and Left move along a row, Down and Up along a column`, () => {
    none(run('the grid simple case', [
      { name: 'Right from r1c1 to r1c2', plan: GRID, start: [0, 0], keys: ['Tab', 'ArrowRight'], want: [[0, 0], [1, 0]] },
      { name: 'Down from r1c1 to r2c1', plan: GRID, start: [0, 0], keys: ['Tab', 'ArrowDown'], want: [[0, 0], [0, 1]] },
      { name: 'Left from r1c2 to r1c1', plan: GRID, start: [1, 0], keys: ['Tab', 'ArrowLeft'], want: [[1, 0], [0, 0]] },
      { name: 'Up from r2c1 to r1c1', plan: GRID, start: [0, 1], keys: ['Tab', 'ArrowUp'], want: [[0, 1], [0, 0]] },
    ]), 'the simple grid');
  }, TIMEOUT);

  it(`${AC[5]} the grid with a cell in the centre that can't take focus: each arrow skips it`, () => {
    expect(HOLE.dead, 'the fixture: r2c2, the centre, doesn\'t draw').toEqual([[1, 1]]);
    none(run('the grid with a non-focusable centre', [
      { name: 'Right from r2c1 skips r2c2 to r2c3', plan: HOLE, start: [0, 1], keys: ['Tab', 'ArrowRight'], want: [[0, 1], [2, 1]] },
      { name: 'Down from r1c2 skips r2c2 to r3c2', plan: HOLE, start: [1, 0], keys: ['Tab', 'ArrowDown'], want: [[1, 0], [1, 2]] },
      { name: 'Left from r2c3 skips r2c2 to r2c1', plan: HOLE, start: [2, 1], keys: ['Tab', 'ArrowLeft'], want: [[2, 1], [0, 1]] },
      { name: 'Up from r3c2 skips r2c2 to r1c2', plan: HOLE, start: [1, 2], keys: ['Tab', 'ArrowUp'], want: [[1, 2], [1, 0]] },
    ]), 'the grid with a hole');
  }, TIMEOUT);

  it(`${AC[5]} Home and End go to the first and last items, stay there at the ends, ignore the start item and skip what can't take focus`, () => {
    none(run('the Home and End test', [
      { name: 'Home moves to the first item of a row', plan: ROW3, start: [1, 0], keys: ['Tab', 'Home'], want: [[1, 0], [0, 0]] },
      { name: 'End moves to the last item of a row', plan: ROW3, start: [1, 0], keys: ['Tab', 'End'], want: [[1, 0], [2, 0]] },
      { name: 'Home on the first item stays there', plan: ROW3, start: [0, 0], keys: ['Tab', 'Home'], want: [[0, 0], [0, 0]] },
      { name: 'End on the last item stays there', plan: ROW3, start: [2, 0], keys: ['Tab', 'End'], want: [[2, 0], [2, 0]] },
      { name: 'Home in a column (the block-only menu) moves to the first item', plan: COLUMN3, start: [0, 2], keys: ['Tab', 'Home'], want: [[0, 2], [0, 0]] },
      { name: 'End in a column (the block-only menu) moves to the last item', plan: COLUMN3, start: [0, 0], keys: ['Tab', 'End'], want: [[0, 0], [0, 2]] },
      { name: 'Home goes to the first item, not the start item', plan: ROW3, start: [1, 0], keys: ['Tab', 'ArrowRight', 'Home'], want: [[1, 0], [2, 0], [0, 0]] },
      { name: 'End goes to the last item, not the start item', plan: ROW3, start: [1, 0], keys: ['Tab', 'ArrowLeft', 'End'], want: [[1, 0], [0, 0], [2, 0]] },
      { name: 'Home skips an item that can\'t take focus and reaches the first', plan: ROW5_GAP, start: [4, 0], keys: ['Tab', 'Home'], want: [[4, 0], [0, 0]] },
      { name: 'End skips an item that can\'t take focus and reaches the last', plan: ROW5_GAP, start: [0, 0], keys: ['Tab', 'End'], want: [[0, 0], [4, 0]] },
    ]), 'Home and End');
  }, TIMEOUT);
});
