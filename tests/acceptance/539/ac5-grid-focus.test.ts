// AC5 #539.ece9dcef: Tab reaches the 12 × 12 grid as one stop, and the next Tab leaves it for the next control, not for
// one of 144 cells; from (0, 0), Right three times and Down twice focus (3, 2), each announced by its label and writing
// no entry, and Enter then writes one pick entry (3, 2); with (1, 0)'s alive false, Right from (0, 0) focuses (2, 0); on
// the pointy odd hex fixture, Up from (1, 1) focuses (1, 0), its tie with (2, 0) going to the smaller cx; when the
// focused row's alive turns false, focus moves to the nearest drawn row and announces it; and a planted focus that stops
// on hidden rows announces (1, 0) and fails, naming it
//
// The fixtures: criterion 1's grid with `place` (rows [board], `focus: {}`: the rows as one Tab stop entered at the
// first drawn row, each labelled by its key) and, after it, `speed`, a slider; the same grid with (1, 0)'s alive false;
// the same grid where (2, 2), (4, 2) and (3, 3) never draw and (3, 2) stops drawing at step 120 (2 s), so (3, 1) is
// then the one nearest drawn row to it, 16 u away (programs.ts `worldProgram`); and criterion 3's hex fixture with
// `focus: {start: [1, 1]}`. Through `deep-show run` on the scope's clock: keys (`input`, `type: key`: Tab, ArrowRight,
// ArrowDown, ArrowUp, Enter), each reply's `state.focus` (a row as `<set>#<cx>,<cy>`) and `appended`, and `see`'s
// announcements (README: the announcements). The planted `focus_stops_on_hidden_rows` moves the focus over rows that
// don't draw as over drawn ones.
import { describe, expect, it } from 'vitest';
import { HEX, SQUARE, worldProgram, type Cell, type WorldPlan } from './programs.ts';
import { cellText, hexDoc, pickControl, putAtlas, rowId, slider, squareDoc } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, appendedOf, binOf, entriesText, failsNaming, focusOf, intsOf, none, pickOf, pickText, prebuild, presented,
  putEvidence, runShow, scenario, seenOf, show, useTemp, type JsonObject, type Planted, type Rect, type Seen,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(5);
const HEX_RECT: Rect = [0, 0, 896, 640];
const board = (c: Cell): string => rowId('board', c);

/** A run of the grid document (with `speed` after `place`) on `plan`, its keys from `keys`, and `see` at the end. */
function walk(plan: WorldPlan, keys: (s: Script) => number[], planted?: Planted, after?: (s: Script) => number[]): { r: JsonObject[]; at: number[]; later: number[]; seen: number } {
  const ev = temp();
  const atlas = putAtlas(ev);
  const world = worldProgram(plan);
  putEvidence(ev, world.bytes);
  const doc = squareDoc('focus', atlas, { world, plan, controls: { place: pickControl('Place', ['board'], {}), speed: slider('Speed') } });
  const s = new Script();
  s.present(D, doc);
  s.scope();
  const at = keys(s);
  const later = after ? after(s) : [];
  const seen = s.see();
  const r = runShow(binOf(), scenario(ev, [D], s.calls, planted ? { planted } : {}), `AC5 the keys over the grid${planted ? ` (planted ${planted})` : ''}`);
  presented(r[0]!, 'the grid with its focus');
  return { r, at, later, seen };
}
/** The announcements of rows of `set` that name `cell` by its label: the row's ID, and the label's numbers its key's. */
const announces = (heard: Seen, set: string, cell: Cell): number[] =>
  heard.announcements.flatMap((a, i) => (a.id === rowId(set, cell) && show(intsOf(a.text)) === show(cell) ? [i] : []));

/** The criterion's check of Right from (0, 0) with (1, 0)'s alive false; each failure names the cell it is about. */
function hiddenRight(planted?: Planted): string[] {
  const { r, at, seen } = walk({ ...SQUARE, dead: [[1, 0]] }, (s) => [s.key('Tab'), s.key('ArrowRight')], planted);
  const failures: string[] = [];
  const got = focusOf(r[at[1]!]!, 'after Right');
  if (got !== board([2, 0])) failures.push(`with (1, 0)'s alive false, Right from (0, 0) focuses ${got ?? 'nothing'}${got === board([1, 0]) ? ', the row (1, 0), which doesn\'t draw' : ''}, not ${board([2, 0])}`);
  const heard = seenOf(r[seen]!, 'see');
  const said = heard.announcements.filter((a) => a.id === board([1, 0]));
  if (said.length) failures.push(`the screen reader announces (1, 0), which doesn't draw: ${show(said, 400)}`);
  return failures;
}

describe(`${AC[5]} grid focus: one Tab stop, arrows over the drawn rows by the grid's rule, announced, and Enter picks`, () => {
  it(`${AC[5]} Tab reaches the 12 × 12 grid as one stop, entered at (0, 0), and the next Tab leaves it for the next control, not for one of the 144 cells`, () => {
    const { r, at } = walk(SQUARE, (s) => [s.key('Tab'), s.key('Tab')]);
    const foci = at.map((i, k) => focusOf(r[i]!, `after Tab ${k + 1}`));
    expect(foci, `Tab focuses the grid's one stop at its first drawn row, then the next control, speed; the focus after each Tab: ${show(foci)}`).toEqual([board([0, 0]), 'speed']);
  }, TIMEOUT);

  it(`${AC[5]} from (0, 0), Right three times and Down twice focus (3, 2), each announced by its label and writing no entry, and Enter then writes one pick entry (3, 2)`, () => {
    const path: [string, Cell][] = [['ArrowRight', [1, 0]], ['ArrowRight', [2, 0]], ['ArrowRight', [3, 0]], ['ArrowDown', [3, 1]], ['ArrowDown', [3, 2]]];
    let enter = -1;
    const { r, at, seen } = walk(SQUARE, (s) => [s.key('Tab'), ...path.map(([k]) => s.key(k))], undefined, (s) => [enter = s.key('Enter')]);
    const failures: string[] = [];
    const tab = focusOf(r[at[0]!]!, 'after Tab');
    if (tab !== board([0, 0])) failures.push(`Tab focuses ${tab ?? 'nothing'}, not ${board([0, 0])}`);
    path.forEach(([key, cell], k) => {
      const reply = r[at[k + 1]!]!;
      const f = focusOf(reply, `after ${key} ${k + 1}`);
      if (f !== board(cell)) failures.push(`${key} (key ${k + 1} after Tab) focuses ${f ?? 'nothing'}, not ${board(cell)}`);
      const entries = appendedOf(reply, `${key} ${k + 1}`);
      if (entries.length) failures.push(`${key} (key ${k + 1}) appends ${entriesText(entries)}; moving the focus writes no entry`);
    });
    const tabEntries = appendedOf(r[at[0]!]!, 'Tab');
    if (tabEntries.length) failures.push(`Tab appends ${entriesText(tabEntries)}; moving the focus writes no entry`);
    // Each move is announced by the focused row's label, in order (the label's numbers are its key's).
    const heard = seenOf(r[seen]!, 'see after the walk');
    let from = -1;
    for (const [, cell] of path) {
      const found = announces(heard, 'board', cell).find((i) => i > from);
      if (found === undefined) { failures.push(`after the announcement of the move before it, nothing announces ${board(cell)} by its label (its key ${cellText(cell)}); the announcements: ${show(heard.announcements, 900)}`); break; }
      from = found;
    }
    const picks = appendedOf(r[enter]!, 'Enter');
    const p = picks.length === 1 && picks[0]!['control'] === 'place' ? pickOf(picks[0]!) : null;
    if (pickText(p) !== pickText({ set: 0, key: [3, 2] })) failures.push(`Enter on (3, 2) appends ${entriesText(picks)}, not one entry of place with {set 0, key (3, 2)}`);
    none(failures, 'the walk to (3, 2) and Enter');
  }, TIMEOUT);

  it(`${AC[5]} with (1, 0)'s alive false, Right from (0, 0) focuses (2, 0), and nothing announces (1, 0)`, () => {
    none(hiddenRight(), 'Right over a row that doesn\'t draw');
  }, TIMEOUT);

  it(`${AC[5]} on the pointy odd hex fixture, Up from (1, 1) focuses (1, 0), its tie with (2, 0) going to the smaller cx`, () => {
    // The tie, from the design's centres: (1, 1) at x 48; on row 0, (1, 0) at 32 and (2, 0) at 64, each 16 away.
    expect([Math.abs(48 - 32), Math.abs(48 - 64)], 'the fixture: (1, 0) and (2, 0) are equally near (1, 1) along x').toEqual([16, 16]);
    const ev = temp();
    const atlas = putAtlas(ev);
    const world = worldProgram(HEX);
    putEvidence(ev, world.bytes);
    const s = new Script();
    s.present(D, hexDoc('hex-focus', atlas, world, { start: [1, 1] }));
    s.scope();
    const tab = s.key('Tab');
    const up = s.key('ArrowUp');
    const seen = s.see();
    const r = runShow(binOf(), scenario(ev, [D], s.calls, { rect: HEX_RECT }), 'AC5 Up on the hex fixture');
    presented(r[0]!, 'the hex fixture with its focus');
    const failures: string[] = [];
    const entered = focusOf(r[tab]!, 'after Tab');
    if (entered !== rowId('hexes', [1, 1])) failures.push(`Tab enters the hex rows at ${entered ?? 'nothing'}, not their focus start ${rowId('hexes', [1, 1])}`);
    const moved = focusOf(r[up]!, 'after Up');
    if (moved !== rowId('hexes', [1, 0])) failures.push(`Up from (1, 1) focuses ${moved ?? 'nothing'}, not ${rowId('hexes', [1, 0])}${moved === rowId('hexes', [2, 0]) ? ': the tie went to the larger cx' : ''}`);
    if (!announces(seenOf(r[seen]!, 'see'), 'hexes', [1, 0]).length) failures.push(`nothing announces ${rowId('hexes', [1, 0])} by its label after Up`);
    none(failures, 'Up on the hex fixture');
  }, TIMEOUT);

  it(`${AC[5]} when the focused row's alive turns false, focus moves to the nearest drawn row and announces it`, () => {
    const plan: WorldPlan = { ...SQUARE, dead: [[2, 2], [4, 2], [3, 3]], dies: { cell: [3, 2], step: 120 } };
    const path = ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown'];
    const { r, at, later, seen } = walk(plan, (s) => [s.key('Tab'), ...path.map((k) => s.key(k))], undefined, (s) => { s.wait(1700); return [s.scope()]; });
    const failures: string[] = [];
    const before = focusOf(r[at[at.length - 1]!]!, 'after the walk');
    expect(before, 'the fixture: the walk focuses (3, 2) before it stops drawing at 2 s').toBe(board([3, 2]));
    const after = focusOf(r[later[0]!]!, 'the scope after 2 s');
    if (after !== board([3, 1])) failures.push(`after (3, 2) stops drawing at 2 s, the focus is ${after ?? 'nothing'}, not the nearest drawn row ${board([3, 1])}`);
    const heard = seenOf(r[seen]!, 'see');
    const last32 = Math.max(-1, ...announces(heard, 'board', [3, 2]));
    if (!announces(heard, 'board', [3, 1]).some((i) => i > last32)) failures.push(`after (3, 2) stops drawing, nothing announces ${board([3, 1])} by its label; the announcements: ${show(heard.announcements, 900)}`);
    none(failures, 'the focus off a row that stops drawing');
  }, TIMEOUT);

  it(`${AC[5]} planted focus_stops_on_hidden_rows announces (1, 0) and fails, naming it`, () => {
    failsNaming(hiddenRight('focus_stops_on_hidden_rows'), [/announces \(1, 0\)/], 'Right from (0, 0) under focus_stops_on_hidden_rows');
  }, TIMEOUT);
});
