// AC2 #539.262f22dd: With a units set drawn above that grid and both named in rows, a click on unit 5 picks {set 1,
// key 5}; with unit 5's alive false, or its opacity 0 from a fog array, the same click picks the terrain cell under it,
// keyboard focus skips unit 5, and the screen reader never names it; and a planted hit test that ignores alive picks
// unit 5 and fails, naming the row
//
// The fixture (fixtures.ts `squareDoc` with `troops`): criterion 1's grid `board`, and above it `army`, 8 free rows of
// 12 × 12 u from `troops` (programs.ts: unit i at the centre of cell (2 + i, 8), so unit 5 sits on cell (7, 8) at
// (120, 136)), alive from `troops.alive` and opacity from the fog array `troops.fog`. `place` is a pick control whose
// rows are [board, army] (set 0 the board, set 1 the units), and `orders` a pick control whose rows are [army] with
// `focus`: the units as one Tab stop, the keyboard's way over them (README: Readings). The units' key is the row's index,
// so unit 5's pick is {set 1, key [5, 0]}. Three variants of `troops`: all drawn; unit 5's alive false; unit 5's fog 0.
// For each, through `deep-show run`: the click on unit 5 (`input`'s `appended`); then, in a fresh run, Tab into the
// units' stop and Right through them, each `input`'s `state.focus`, and `see` (the tree and the announcements).
import { describe, expect, it } from 'vitest';
import { SQUARE, UNIT, troopsProgram, unitAt, unitCell, worldProgram, type Troops } from './programs.ts';
import { cellText, pickControl, putAtlas, squareDoc } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, appendedOf, binOf, entriesText, failsNaming, focusOf, none, pickOf, pickText, prebuild, presented,
  putEvidence, runShow, scenario, scopeView, seenOf, show, toPanel, useTemp, type Planted,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(2);
const unit = (i: number): string => `army#${i}`;

interface Judged { failures: string[]; picked: string }
/** The criterion's check of one variant: the click, the walk over the units, and what the screen reader hears. */
function judge(v: Troops, planted?: Planted): Judged {
  const ev = temp();
  const atlas = putAtlas(ev);
  const world = worldProgram(SQUARE);
  const troops = troopsProgram(v);
  for (const p of [world, troops]) putEvidence(ev, p.bytes);
  const doc = squareDoc(`units-${v}`, atlas, {
    world, troops,
    controls: { orders: pickControl('Orders', ['army'], {}), place: pickControl('Place', ['board', 'army']) },
  });
  const what = `AC2 unit 5 ${v === 'all' ? 'drawn' : v === 'dead5' ? 'with alive false' : 'at opacity 0'}${planted ? ` (planted ${planted})` : ''}`;
  const view = scopeView(binOf(), ev, D, doc, {}, what);
  const o = planted ? { planted } : {};
  const failures: string[] = [];

  const c = new Script();
  c.present(D, doc);
  c.scope();
  const [down, up] = c.click(toPanel(view, unitAt(UNIT)));
  const r = runShow(binOf(), scenario(ev, [D], c.calls, o), `${what}: the click`);
  presented(r[0]!, what);
  const entries = [...appendedOf(r[down]!, 'the press'), ...appendedOf(r[up]!, 'the release')];
  const pick = entries.length === 1 && entries[0]!['control'] === 'place' ? pickOf(entries[0]!) : null;
  const want = v === 'all' ? { set: 1, key: [UNIT, 0] as [number, number] } : { set: 0, key: unitCell(UNIT) };
  if (pickText(pick) !== pickText(want)) {
    const named = pick && pick.set === 1 && pick.key[0] === UNIT ? ` (the row ${unit(UNIT)}, unit 5, ${v === 'all' ? 'which draws' : 'which doesn\'t draw'})` : '';
    failures.push(`${what}: the click on unit 5 at (120, 136) appends ${entriesText(entries)}, picking ${pickText(pick)}${named}, not one entry of place with ${pickText(want)}${v === 'all' ? '' : `, the terrain cell ${cellText(unitCell(UNIT))} under it`}`);
  }

  const w = new Script();
  w.present(D, doc);
  w.scope();
  const tab = w.key('Tab');
  const rights = Array.from({ length: v === 'all' ? 7 : 6 }, () => w.key('ArrowRight'));
  const seen = w.see();
  const k = runShow(binOf(), scenario(ev, [D], w.calls, o), `${what}: the walk over the units`);
  const foci = [tab, ...rights].map((i, j) => focusOf(k[i]!, j === 0 ? 'after Tab' : `after Right ${j}`));
  const order = v === 'all' ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 6, 7];
  if (show(foci) !== show(order.map(unit))) failures.push(`${what}: Tab and then Right through the units focus ${show(foci)}, not ${show(order.map(unit))}${foci.includes(unit(UNIT)) && v !== 'all' ? `: the focus stops on ${unit(UNIT)}, unit 5, which doesn't draw` : ''}`);
  const heard = seenOf(k[seen]!, `${what}: see`);
  const said = heard.announcements.filter((a) => a.id === unit(UNIT));
  const node = heard.tree.filter((n) => n['id'] === unit(UNIT));
  if (v === 'all' && said.length === 0) failures.push(`${what}: the walk focuses unit 5 and nothing announces ${unit(UNIT)}; the announcements: ${show(heard.announcements, 800)}`);
  if (v !== 'all' && (said.length || node.length)) failures.push(`${what}: the screen reader names ${unit(UNIT)}, unit 5, which doesn't draw: ${show([...said, ...node], 600)}`);
  return { failures, picked: pickText(pick) };
}

describe(`${AC[2]} rows that don't draw are never hit, focused or announced, over a grid with units above it`, () => {
  it(`${AC[2]} with unit 5 drawn, a click on it picks {set 1, key 5}, and the keyboard's walk over the units focuses and announces it`, () => {
    none(judge('all').failures, 'unit 5 drawn');
  }, TIMEOUT);

  it(`${AC[2]} with unit 5's alive false, the same click picks the terrain cell (7, 8) under it, keyboard focus skips unit 5, and the screen reader never names it`, () => {
    none(judge('dead5').failures, 'unit 5 with alive false');
  }, TIMEOUT);

  it(`${AC[2]} with unit 5 at opacity 0 from a fog array, the same click picks the terrain cell (7, 8) under it, keyboard focus skips unit 5, and the screen reader never names it`, () => {
    none(judge('fog5').failures, 'unit 5 at opacity 0');
  }, TIMEOUT);

  it(`${AC[2]} planted hit_ignores_alive picks unit 5 whose alive is false and fails, naming the row`, () => {
    const twin = judge('dead5', 'hit_ignores_alive');
    expect(twin.picked, 'under the planted hit test the click picks unit 5').toBe(pickText({ set: 1, key: [UNIT, 0] }));
    failsNaming(twin.failures, [new RegExp(unit(UNIT))], 'the click under hit_ignores_alive');
  }, TIMEOUT);
});
