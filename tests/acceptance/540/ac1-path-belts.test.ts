// AC1 #540.ba264743: A point control with drag path on the 12 × 12 grid: a straight drag from cell (2, 2) to (9, 2)
// writes a press at (2, 2), a move at each of (3, 2) to (9, 2) and a release at (9, 2), nine entries, and a fixture
// logic that lays a belt on each cell it reads holds 8 belts; and a planted control that stamps the press with the cell
// under the pointer one frame later, after the drag has reached (3, 2), lays no belt on (2, 2) and fails, naming the
// entry
//
// The grid (fixtures.ts `gridDoc`): `board`, 12 × 12 cells of 16 u from `world`, at (8, 8) on a 224 × 224 u page in an
// 896 × 896 px panel; `place`, a document-class point control `on: board` with `drag: path`; `belts`, a logic item
// reading `place` that lays a belt on the cell each entry's row names (programs.ts). Through `deep-show run`: the
// document presented, the scope read (its camera, which `toPanel` assumes), a drag with the primary button through the
// centres of cells (2, 2) to (9, 2), one pointer sample a 120 Hz frame apart, and `logic` over 60 steps. The planted
// `press_cell_next_frame` (README: Planted twins) stamps the press with the cell under the pointer at the next frame.
import { describe, expect, it } from 'vitest';
import { cellCentre, gridDoc, PANEL_2D, putAtlas, toPanel } from './fixtures.ts';
import type { V2 } from './geometry.ts';
import {
  AC, DOC, Script, TIMEOUT, arr, binOf, entriesOf, entriesText, entryName, failsNaming, lastArray, logicOf, none, num, obj, once, prebuild, presented,
  putEvidence, runShow, sameEntry, scenario, stateOf, useTemp, valueOf, type JsonObject, type Planted,
} from './helpers.ts';
import { GRID, beltsProgram, worldProgram } from './programs.ts';

prebuild();
const temp = useTemp();
const D = DOC(1);
const PATH: V2[] = [2, 3, 4, 5, 6, 7, 8, 9].map((cx) => [cx, 2]);
const cellText = ([cx, cy]: V2): string => `(${cx}, ${cy})`;
/** The nine entries the criterion names: a press at (2, 2), a move at each of (3, 2) to (9, 2), a release at (9, 2). */
const EXPECTED: { phase: string; cell: V2 }[] = [
  { phase: 'press', cell: PATH[0]! }, ...PATH.slice(1).map((cell) => ({ phase: 'move', cell })), { phase: 'release', cell: PATH[PATH.length - 1]! },
];

interface Run { failures: string[]; entries: JsonObject[]; belts: V2[] }
function judge(planted?: Planted): Run {
  const ev = temp();
  const atlas = putAtlas(ev);
  const world = worldProgram();
  const belts = beltsProgram();
  for (const p of [world, belts]) putEvidence(ev, p.bytes);
  const s = new Script();
  s.present(D, gridDoc(atlas, world, belts));
  const seen = s.scope();
  const drag = s.drag(PATH.map((c) => toPanel(cellCentre(c))));
  const lg = s.logic(D, 60);
  const r = runShow(binOf(), scenario(ev, [{ id: D, size: PANEL_2D }], s.calls, planted), 'AC1 the drag');
  presented(r[0]!, 'the grid');

  // The fixture: the panel shows the page as `toPanel` maps it (the camera's target the page's centre, its view width the page's).
  const st = stateOf(r[seen]!, 'the scope');
  const cam = obj(st['camera'], 'the scope: camera');
  const target = arr(cam['target'], 'the scope: camera.target');
  expect([num(target[0], 'target x'), num(target[1], 'target y'), num(cam['view_width'], 'view_width')], 'the fixture: the figure\'s camera is centred on the page, 224 u across').toEqual([112, 112, 224]);

  const failures: string[] = [];
  const entries = entriesOf(r, drag, 'place');
  if (entries.length !== EXPECTED.length) failures.push(`the drag writes ${entries.length} entries of place, not nine: ${entriesText(entries)}`);
  EXPECTED.forEach((want, i) => {
    const e = entries[i];
    if (!e) return;
    const v = valueOf(e);
    const ok = v.phase === want.phase && v.cell !== null && v.cell[0] === want.cell[0] && v.cell[1] === want.cell[1] && v.button === 'primary' && e['writer'] === 'you';
    if (!ok) failures.push(`entry ${i + 1}, ${entryName(e)}, holds ${v.phase} at cell ${v.cell ? cellText(v.cell) : 'none'} (button ${v.button}, writer ${String(e['writer'])}), not a ${want.phase} at ${cellText(want.cell)} with the primary button, written by you`);
  });

  const run = logicOf(r[lg]!, 'the logic run');
  const track = run.track.filter((e) => e['control'] === 'place');
  if (track.length !== entries.length || !track.every((e, i) => sameEntry(e, entries[i]!))) failures.push(`the track the logic run reads holds ${entriesText(track)}, not the drag's entries`);
  const laid = lastArray(run.steps, 'belts.belts');
  const cells: V2[] = [];
  if (!laid || laid.length !== GRID * GRID) failures.push(`the logic run reports no belts.belts of 144 cells: ${String(laid?.length)} values`);
  else laid.forEach((b, i) => { if (b === 1) cells.push([i % GRID, Math.floor(i / GRID)]); });
  const press = entries[0];
  for (const c of PATH) {
    if (!cells.some(([x, y]) => x === c[0] && y === c[1])) failures.push(`no belt on ${cellText(c)}${c === PATH[0] && press ? `, the cell of ${entryName(press)}, which reads ${valueOf(press).cell ? cellText(valueOf(press).cell!) : 'no cell'}` : ''}`);
  }
  const extra = cells.filter(([x, y]) => !PATH.some((c) => c[0] === x && c[1] === y));
  if (extra.length) failures.push(`belts on ${extra.map(cellText).join(', ')}, which the drag never entered`);
  if (cells.length !== 8) failures.push(`the fixture logic holds ${cells.length} belts, not 8`);
  return { failures, entries, belts: cells };
}

const honest = once(() => judge());

describe(`${AC[1]} a path drag on a grid writes one entry per cell entered, each computed at the gesture`, () => {
  it(`${AC[1]} a straight drag from (2, 2) to (9, 2) writes a press, seven moves and a release, and the fixture logic holds 8 belts`, () => {
    none(honest().failures, 'the drag, its nine entries and the belts');
  }, TIMEOUT);

  it(`${AC[1]} planted press_cell_next_frame stamps the press at (3, 2), lays no belt on (2, 2) and fails, naming the entry`, () => {
    const twin = judge('press_cell_next_frame');
    const press = twin.entries[0];
    expect(press && valueOf(press).cell, 'under the planted control the press holds the cell the pointer reached one frame later').toEqual([3, 2]);
    failsNaming(twin.failures, [/no belt on \(2, 2\)/, /the press entry of place at t \d+/], 'the planted press_cell_next_frame');
  }, TIMEOUT);
});
