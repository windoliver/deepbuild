// AC9 #542.f0bbc9b7: A key press mid-tail stops the tail on that event. A planted build that keeps it scrolls and fails.
//
// Through `deep-show run` (README: The surface under test), on the list fixture with a document-class `list`, the
// pointer over the list throughout: a trackpad gesture (its begin, four changes of 30 px down, its end), then its
// momentum tail (README: `momentum: true`): a begin and two changes of 20 px, which scroll the list; then a key press
// ("x", which no control takes); then three more changes of 20 px and the tail's end. Each input's `appended` and the
// camera before and after are read. The planted `scroll_tail_survives_keys` (README: Planted twins) lets the tail go on
// after a key press.
import { describe, expect, it } from 'vitest';
import { tilesProgram } from './programs.ts';
import { OVER, listDoc, putAtlas } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, appendedOf, binOf, cameraText, entriesText, failsNaming, none, prebuild, presented, putEvidence, runShow, sameCamera,
  scenario, scopeView, stateOf, toPanel, useTemp, viewOf, type ShowPlanted,
} from './helpers.ts';

prebuild('deep-show');
const temp = useTemp();
const D = DOC(9);

function judge(planted?: ShowPlanted): string[] {
  const ev = temp();
  const tiles = tilesProgram();
  putEvidence(ev, tiles.bytes);
  const doc = listDoc('list-tail', { atlas: putAtlas(ev), tiles, scroll: { id: 'list', spec: { class: 'document', range: [0, 190] } } });
  const p = toPanel(scopeView(binOf('deep-show'), ev, D, doc, {}, 'AC9 the list'), OVER);
  const s = new Script();
  s.present(D, doc);
  const before = s.scope();
  const gesture = [
    s.scroll({ phase: 'begin', pos: p, delta: [0, 0] }, 200),
    ...[0, 1, 2, 3].map(() => s.scroll({ phase: 'change', pos: p, delta: [0, 30] })),
    s.scroll({ phase: 'end', pos: p, delta: [0, 0] }),
  ];
  const tail = [
    s.scroll({ phase: 'begin', pos: p, delta: [0, 0], momentum: true }),
    s.scroll({ phase: 'change', pos: p, delta: [0, 20], momentum: true }),
    s.scroll({ phase: 'change', pos: p, delta: [0, 20], momentum: true }),
  ];
  const key = s.input({ type: 'key', key: 'x' }, 16);
  const rest = [
    ...[0, 1, 2].map(() => s.scroll({ phase: 'change', pos: p, delta: [0, 20], momentum: true })),
    s.scroll({ phase: 'end', pos: p, delta: [0, 0], momentum: true }),
  ];
  const after = s.scope();
  const r = runShow(binOf('deep-show'), scenario(ev, [D], s.calls, planted ? { planted } : {}), 'AC9 a key press mid-tail');
  presented(r[0]!, 'the list');

  // The fixture: the gesture and the tail before the key scroll the list, so the key lands mid-tail.
  const scrolled = [...gesture, ...tail].flatMap((i) => appendedOf(r[i]!, `event ${i}`));
  const inTail = tail.flatMap((i) => appendedOf(r[i]!, `tail event ${i}`));
  expect(scrolled.length > 0 && scrolled.every((e) => e['control'] === 'list') && inTail.length > 0, `the fixture: the gesture and its tail scroll the list before the key (${entriesText(scrolled)})`).toBe(true);

  const failures: string[] = [];
  const at = appendedOf(r[key]!, 'the key');
  if (at.length) failures.push(`the key press appends ${entriesText(at)}`);
  const later = rest.flatMap((i) => appendedOf(r[i]!, `event ${i}`));
  if (later.length) failures.push(`after the key press the tail goes on scrolling list: ${entriesText(later)}`);
  const c0 = viewOf(stateOf(r[before]!, 'before'), 'before');
  const c1 = viewOf(stateOf(r[after]!, 'after'), 'after');
  if (!sameCamera(c0, c1)) failures.push(`the gesture and its tail move the camera from ${cameraText(c0)} to ${cameraText(c1)}`);
  return failures;
}

describe(`${AC[9]} a key press ends a scroll gesture's momentum tail`, () => {
  it(`${AC[9]} a key press mid-tail stops the tail on that event`, () => {
    none(judge(), 'the tail after a key press');
  }, TIMEOUT);

  it(`${AC[9]} planted scroll_tail_survives_keys keeps the tail, scrolls and fails`, () => {
    failsNaming(judge('scroll_tail_survives_keys'), [/after the key press the tail goes on scrolling list/], 'the planted build that keeps the tail');
  }, TIMEOUT);
});
