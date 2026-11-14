// AC4 #539.953cfa78: A ghost driver reading place.hover follows the pointer's cell live, while the fixture's golden and
// its export show no ghost, since hover evaluates as none there; a logic item that declares place.hover as a read is
// refused at check, naming the read; and a planted export that keeps the live hover draws the ghost and fails the
// golden, naming the item
//
// The fixture (fixtures.ts `squareDoc` with `ghost`): criterion 1's grid and pick control `place`, and `ghost`, a
// 16 × 16 u square in the look's accent drawn above the board, whose two drivers place it on the cell `place.hover` names
// (16 cx, 16 cy) and off the page while hover is none (README: Readings). Through `deep-show run`: `eval` at 1 s with a
// snapshot (the fixture's golden: the document's own frame, README) before any hover; the pointer moved, with no
// button, to cell (2, 3)'s centre and then to (9, 6)'s, the panel's live view (`view`, #504) after each; `eval` again;
// and the export of the whole span as a PNG sequence at 4 fps (#504's `png_seq`). Every picture is sampled at the two
// cells' centres, at its own scale. The refusal: `deep_show` of the fixture with a logic item `peek` that reads
// `place.hover`, and with one that reads `place`. The planted `export_keeps_live_hover` draws the panel's live hover in
// the export's frames.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SQUARE, rulesProgram, worldProgram, type Cell } from './programs.ts';
import { SQUARE_PAGE, cellCentre, cellText, pickControl, putAtlas, squareDoc } from './fixtures.ts';
import {
  AC, DOC, FLICKS, Script, TIMEOUT, arr, binOf, codeOff, decodePng, failsNaming, getEvidence, issuesOf, namedIn, names, namesItem, none,
  obj, pagePixel, presented, prebuild, putEvidence, runShow, scenario, scopeView, show, str, toPanel, useTemp, type Image, type JsonObject,
  type Planted, type Rgb,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(4);
const FIRST: Cell = [2, 3];
const SECOND: Cell = [9, 6];
/** The golden's time: 1 s into the span. */
const T = FLICKS;

const evalImage = (ev: string, reply: JsonObject, what: string): Image => {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply, 1200)}`).toBe('evaluated');
  const snaps = arr(reply['snapshots'], `${what}: snapshots`);
  return decodePng(getEvidence(ev, str(obj(snaps[0], `${what}: snapshots[0]`)['sha256'], `${what}: snapshots[0].sha256`), what));
};
const viewImage = (ev: string, reply: JsonObject, what: string): Image =>
  decodePng(getEvidence(ev, str(obj(reply['snapshot'], `${what}: view.snapshot (${show(reply, 600)})`)['sha256'], `${what}: view.snapshot.sha256`), what));
const at = (im: Image, c: Cell): Rgb => pagePixel(im, SQUARE_PAGE, cellCentre(c));

function judge(planted?: Planted): { failures: string[]; exported: number } {
  const ev = temp();
  const out = join(temp(), 'frames');
  const atlas = putAtlas(ev);
  const world = worldProgram(SQUARE);
  putEvidence(ev, world.bytes);
  const doc = squareDoc('ghost', atlas, { world, ghost: true, controls: { place: pickControl('Place', ['board']) } });
  const view = scopeView(binOf(), ev, D, doc, {}, 'AC4 the ghost fixture');
  const s = new Script();
  s.present(D, doc);
  s.scope();
  const golden = s.eval(D, T);
  s.move(toPanel(view, cellCentre(FIRST)));
  const live1 = s.view();
  s.move(toPanel(view, cellCentre(SECOND)));
  const live2 = s.view();
  const goldenAfter = s.eval(D, T);
  const exported = s.export(D, out, 4);
  const what = `AC4 the hover ghost${planted ? ` (planted ${planted})` : ''}`;
  const r = runShow(binOf(), scenario(ev, [D], s.calls, planted ? { planted } : {}), what);
  presented(r[0]!, 'the ghost fixture');

  const failures: string[] = [];
  const g = evalImage(ev, r[golden]!, 'the golden before any hover');
  const board = { first: at(g, FIRST), second: at(g, SECOND) };
  const l1 = viewImage(ev, r[live1]!, 'the live view over (2, 3)');
  const ghost = at(l1, FIRST);
  // The live view follows the pointer's cell: the ghost on the hovered cell, the board elsewhere.
  if (codeOff(ghost, board.first) <= 40) failures.push(`the live view with the pointer over cell ${cellText(FIRST)} shows ${show(ghost)} there, the board's own ${show(board.first)}: no ghost follows the pointer`);
  if (codeOff(at(l1, SECOND), board.second) > 3) failures.push(`the live view with the pointer over ${cellText(FIRST)} shows ${show(at(l1, SECOND))} at ${cellText(SECOND)}, not the board's ${show(board.second)}`);
  const l2 = viewImage(ev, r[live2]!, 'the live view over (9, 6)');
  if (codeOff(at(l2, SECOND), ghost) > 3 || codeOff(ghost, board.second) <= 40) failures.push(`the live view with the pointer moved to ${cellText(SECOND)} shows ${show(at(l2, SECOND))} there, not the ghost's ${show(ghost)}: the ghost doesn't follow the pointer`);
  if (codeOff(at(l2, FIRST), board.first) > 3) failures.push(`the live view with the pointer moved to ${cellText(SECOND)} still shows ${show(at(l2, FIRST))} at ${cellText(FIRST)}, not the board's ${show(board.first)}`);
  // The golden after the hover, and every exported frame: hover evaluates as none, so no ghost.
  const g2 = evalImage(ev, r[goldenAfter]!, 'the golden after the hover');
  for (const c of [FIRST, SECOND]) if (codeOff(at(g2, c), at(g, c)) > 3) failures.push(`the golden at 1 s after the hover differs from the golden before it at cell ${cellText(c)}, inside the item ghost's box: ${show(at(g2, c))}, not ${show(at(g, c))}`);
  const e = r[exported]!;
  if (e['outcome'] !== 'exported') failures.push(`the export is ${String(e['outcome'])}: ${show(e, 800)}`);
  const files = e['outcome'] === 'exported' ? readdirSync(out).filter((f) => f.toLowerCase().endsWith('.png')).sort() : [];
  if (e['outcome'] === 'exported' && files.length === 0) failures.push('the export wrote no frame');
  files.forEach((f, k) => {
    const im = decodePng(readFileSync(join(out, f)));
    for (const c of [SECOND, FIRST]) {
      const seen = at(im, c);
      if (codeOff(seen, at(g, c)) > 3) failures.push(`export frame ${k} differs from the golden at cell ${cellText(c)}, inside the item ghost's box: ${show(seen)}${codeOff(seen, ghost) <= 3 ? ', the ghost\'s color' : ''}, not the golden's ${show(at(g, c))}`);
    }
  });
  return { failures, exported: files.length };
}

describe(`${AC[4]} hover is viewer state: a ghost follows it live, and goldens, exports and logic never see it`, () => {
  it(`${AC[4]} the ghost driver reading place.hover follows the pointer's cell live, while the golden and the export show no ghost`, () => {
    none(judge().failures, 'the ghost live, in the golden and in the export');
  }, TIMEOUT);

  it(`${AC[4]} a logic item that declares place.hover as a read is refused at check, naming the read`, () => {
    const ev = temp();
    const atlas = putAtlas(ev);
    const world = worldProgram(SQUARE);
    const rules = rulesProgram();
    for (const p of [world, rules]) putEvidence(ev, p.bytes);
    const docOf = (reads: string[]): JsonObject => squareDoc(`peek-${reads.join('-')}`, atlas, { world, rules: { program: rules, reads, id: 'peek' }, controls: { place: pickControl('Place', ['board']) } });
    const s = new Script();
    const hover = s.present(DOC(41), docOf(['place.hover']));
    const pick = s.present(DOC(42), docOf(['place']));
    const r = runShow(binOf(), scenario(ev, [DOC(41), DOC(42)], s.calls), 'AC4 the logic reads');
    expect(r[hover]!['outcome'], `a logic item that reads place.hover is refused at check: ${show(r[hover], 2500)}`).toBe('refused');
    const errors = issuesOf(r[hover]!).filter((i) => i['severity'] === 'error');
    const naming = errors.filter((i) => i['code'] !== 'unknown_field' && (names(namedIn(i), 'place.hover') || (namesItem(i, 'peek') && String(i['path'] ?? '').endsWith('/reads/0'))));
    expect(naming.length, `an error, other than a field the check doesn't know, names the read place.hover; the errors: ${show(errors, 2500)}`).toBeGreaterThan(0);
    presented(r[pick]!, 'the same logic item reading the pick control place');
  }, TIMEOUT);

  it(`${AC[4]} planted export_keeps_live_hover draws the ghost in the export and fails the golden, naming the item`, () => {
    const twin = judge('export_keeps_live_hover');
    expect(twin.exported, 'the planted export writes its frames').toBeGreaterThan(0);
    failsNaming(twin.failures, [/^export frame/, /ghost/], 'the export under export_keeps_live_hover');
  }, TIMEOUT);
});
