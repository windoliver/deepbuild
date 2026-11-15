// AC5 #539.ece9dcef: Tab reaches the 12 × 12 grid as one stop, and the next Tab leaves it for the next control, not for
// one of 144 cells; from (0, 0), Right three times and Down twice focus (3, 2), each announced by its label and writing
// no entry, and Enter then writes one pick entry (3, 2); with (1, 0)'s alive false, Right from (0, 0) focuses (2, 0); on
// the pointy odd hex fixture, Up from (1, 1) focuses (1, 0), its tie with (2, 0) going to the smaller cx; when the
// focused row's alive turns false, focus moves to the nearest drawn row and announces it; and a planted focus that stops
// on hidden rows announces (1, 0) and fails, naming it
//
// The Oracle lane (README): each case below is one of the pinned upstream focus-group tests, re-expressed on our
// output. The upstream group of focusable items becomes a pick control's rows with `focus` (one Tab stop) on a small
// square grid laid out by grid.size, the upstream table's cell r<N>c<M> our cell (M − 1, N − 1), an item that can't take
// focus our row whose `alive` is false, the upstream start attribute our `focus.start`, and focusing an item directly a
// Tab into the stop at `focus.start`. Each case is one `deep-show run` on the scope's clock (../539/README.md: the
// surface): the keys as `input` events, each reply's `state.focus` read (a row as `strip#<cx>,<cy>`, a control as its
// ID). The expected focus is the upstream test's own wherever the design agrees with it; the cases where the design
// gives another answer, or has no counterpart, are left out and listed in the README.
import { describe, it } from 'vitest';
import { worldProgram, type Cell, type WorldPlan } from '../539/programs.ts';
import { pickControl, putAtlas, rowId, slider, stripDoc } from '../539/fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, binOf, failsNaming, focusOf, none, prebuild, presented, putEvidence, runShow, scenario, useTemp,
  type JsonObject, type Planted, type Rect,
} from '../539/helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(15);

/** What a key should leave focused: a row of the strip by its cell, or a control by its ID. */
type Want = Cell | string;
interface Case {
  /** The upstream file, by its name, and the line its test starts on. */
  file: string;
  line: number;
  /** What the upstream test checks, in our words. */
  does: string;
  plan: WorldPlan;
  start?: Cell;
  /** A slider before the rows and one after them, as the upstream page has an item before the group and one after. */
  around?: boolean;
  /** Each key, from no focus, and what it leaves focused. */
  steps: [string, Want][];
}

const R = 'ArrowRight';
const L = 'ArrowLeft';
const U = 'ArrowUp';
const Dn = 'ArrowDown';
const row = (c: Cell): string => rowId('strip', c);
const named = (w: Want): string => (typeof w === 'string' ? w : row(w));

// The upstream fixtures as grids: a group of three in a line, the 3 × 2 table, the 3 × 3 table without its centre, a
// column of three (a block-axis menu) and a line of five with the middle one opted out.
const LINE3: WorldPlan = { cols: 3, rows: 1 };
const TABLE: WorldPlan = { cols: 3, rows: 2 };
const HOLED: WorldPlan = { cols: 3, rows: 3, dead: [[1, 1]] };
const COLUMN3: WorldPlan = { cols: 1, rows: 3 };
const LINE5: WorldPlan = { cols: 5, rows: 1, dead: [[2, 0]] };

const TAB_FILE = 'sequential-navigation/basic-tab-behavior.html';
const GRID_FILE = 'grid-navigation/simple-case.html';
const HOLE_FILE = 'grid-navigation/simple-case-with-non-focusable-cell-in-the-center.html';
const HOME_FILE = 'home-end-keys.optional.html';

const CASES: Case[] = [
  // basic-tab-behavior: an item before the group, three items, an item after.
  { file: TAB_FILE, line: 26, does: 'Tab from the control before enters the rows at their first item, (0, 0), and the next Tab leaves them for the control after', plan: LINE3, around: true, steps: [['Tab', 'before'], ['Tab', [0, 0]], ['Tab', 'after']] },
  { file: TAB_FILE, line: 46, does: 'inside the stop, Right from (0, 0) focuses (1, 0), and Right again (2, 0)', plan: LINE3, around: true, steps: [['Tab', 'before'], ['Tab', [0, 0]], [R, [1, 0]], [R, [2, 0]]] },
  // simple-case: the 3 × 2 table.
  { file: GRID_FILE, line: 29, does: 'Right from r1c1, (0, 0), focuses the next column, r1c2, (1, 0)', plan: TABLE, steps: [['Tab', [0, 0]], [R, [1, 0]]] },
  { file: GRID_FILE, line: 34, does: 'Down from r1c1, (0, 0), focuses the next row, r2c1, (0, 1)', plan: TABLE, steps: [['Tab', [0, 0]], [Dn, [0, 1]]] },
  { file: GRID_FILE, line: 39, does: 'Left from r1c2, (1, 0), focuses the previous column, r1c1, (0, 0)', plan: TABLE, start: [1, 0], steps: [['Tab', [1, 0]], [L, [0, 0]]] },
  { file: GRID_FILE, line: 44, does: 'Up from r2c1, (0, 1), focuses the previous row, r1c1, (0, 0)', plan: TABLE, start: [0, 1], steps: [['Tab', [0, 1]], [U, [0, 0]]] },
  // simple-case-with-non-focusable-cell-in-the-center: the 3 × 3 table, r2c2, (1, 1), not drawn.
  { file: HOLE_FILE, line: 34, does: 'Right from r2c1, (0, 1), skips the centre that doesn\'t draw and focuses r2c3, (2, 1)', plan: HOLED, start: [0, 1], steps: [['Tab', [0, 1]], [R, [2, 1]]] },
  { file: HOLE_FILE, line: 44, does: 'Left from r2c3, (2, 1), skips the centre that doesn\'t draw and focuses r2c1, (0, 1)', plan: HOLED, start: [2, 1], steps: [['Tab', [2, 1]], [L, [0, 1]]] },
  // home-end-keys: a toolbar of three.
  { file: HOME_FILE, line: 85, does: 'Home from the middle row, (1, 0), focuses the first, (0, 0)', plan: LINE3, start: [1, 0], steps: [['Tab', [1, 0]], ['Home', [0, 0]]] },
  { file: HOME_FILE, line: 90, does: 'End from the middle row, (1, 0), focuses the last, (2, 0)', plan: LINE3, start: [1, 0], steps: [['Tab', [1, 0]], ['End', [2, 0]]] },
  { file: HOME_FILE, line: 95, does: 'Home on the first row, (0, 0), stays there', plan: LINE3, steps: [['Tab', [0, 0]], ['Home', [0, 0]]] },
  { file: HOME_FILE, line: 100, does: 'End on the last row, (2, 0), stays there', plan: LINE3, start: [2, 0], steps: [['Tab', [2, 0]], ['End', [2, 0]]] },
  // home-end-keys: a block-axis menu of three, here a column.
  { file: HOME_FILE, line: 119, does: 'in a column, Home from the last row, (0, 2), focuses the first, (0, 0)', plan: COLUMN3, start: [0, 2], steps: [['Tab', [0, 2]], ['Home', [0, 0]]] },
  { file: HOME_FILE, line: 124, does: 'in a column, End from the first row, (0, 0), focuses the last, (0, 2)', plan: COLUMN3, steps: [['Tab', [0, 0]], ['End', [0, 2]]] },
  // home-end-keys: a start item in the middle of three.
  { file: HOME_FILE, line: 143, does: 'with focus.start (1, 0), Home from (2, 0) focuses the first row, (0, 0), not the start', plan: LINE3, start: [1, 0], steps: [['Tab', [1, 0]], [R, [2, 0]], ['Home', [0, 0]]] },
  { file: HOME_FILE, line: 148, does: 'with focus.start (1, 0), End from (0, 0) focuses the last row, (2, 0), not the start', plan: LINE3, start: [1, 0], steps: [['Tab', [1, 0]], [L, [0, 0]], ['End', [2, 0]]] },
  // home-end-keys: five items, the middle one opted out, here a row that doesn't draw.
  { file: HOME_FILE, line: 155, does: 'with (2, 0) not drawn, Home from (4, 0) focuses the first row, (0, 0)', plan: LINE5, start: [4, 0], steps: [['Tab', [4, 0]], ['Home', [0, 0]]] },
  { file: HOME_FILE, line: 160, does: 'with (2, 0) not drawn, End from (0, 0) focuses the last row, (4, 0)', plan: LINE5, steps: [['Tab', [0, 0]], ['End', [4, 0]]] },
];

/** The panel fits the page (cell 16 u, 8 u around), so every row is in view. */
function rectFor(p: WorldPlan): Rect {
  const w = 16 * p.cols + 16;
  const h = 16 * p.rows + 16;
  return w >= h ? [0, 0, 896, Math.round((896 * h) / w)] : [0, 0, Math.round((896 * w) / h), 896];
}

/** One case's run and its check: one failure per key that leaves the focus somewhere else, naming where. */
function check(c: Case, planted?: Planted): string[] {
  const ev = temp();
  const atlas = putAtlas(ev);
  const world = worldProgram(c.plan);
  putEvidence(ev, world.bytes);
  const place = pickControl('Place', ['strip'], c.start ? { start: c.start } : {});
  const controls: JsonObject = c.around ? { before: slider('Before'), place, after: slider('After') } : { place };
  const s = new Script();
  s.present(D, stripDoc('oracle', atlas, world, c.plan, controls));
  s.scope();
  const at = c.steps.map(([key]) => s.key(key));
  const what = `AC5 oracle, ${c.file} line ${c.line}`;
  const r = runShow(binOf(), scenario(ev, [D], s.calls, { rect: rectFor(c.plan), ...(planted ? { planted } : {}) }), what);
  presented(r[0]!, `${what}: the strip`);
  const hidden = new Set((c.plan.dead ?? []).map(row));
  const failures: string[] = [];
  let from = 'no focus';
  c.steps.forEach(([key, want], i) => {
    const got = focusOf(r[at[i]!]!, `${what}: after ${key} (key ${i + 1})`);
    if (got !== named(want)) failures.push(`${key} (key ${i + 1}) from ${from} focuses ${got ?? 'nothing'}${got !== null && hidden.has(got) ? ', a row that doesn\'t draw' : ''}, not ${named(want)}`);
    from = got ?? 'no focus';
  });
  return failures;
}

describe(`${AC[5]} the pinned upstream focus-group tests, run against our grid focus`, () => {
  for (const c of CASES) {
    it(`${AC[5]} upstream ${c.file} line ${c.line}: ${c.does}`, () => {
      none(check(c), `${c.file} line ${c.line}: ${c.does}`);
    }, TIMEOUT);
  }

  it(`${AC[5]} planted focus_stops_on_hidden_rows: the ported Right over the centre that doesn't draw focuses (1, 1) and fails, naming it`, () => {
    const right = CASES.find((c) => c.file === HOLE_FILE && c.line === 34)!;
    failsNaming(check(right, 'focus_stops_on_hidden_rows'), [/focuses strip#1,1, a row that doesn't draw/], 'Right from (0, 1) over the hidden centre under focus_stops_on_hidden_rows');
  }, TIMEOUT);
});
