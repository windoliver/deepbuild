// AC8 #542.49a44569: A recorded flick that starts over a scroll area and drifts off moves the camera 0
//
// Through `deep-show run` (README: The surface under test), on the list fixture with a document-class `list`: one
// recorded flick, its begin over the list at (120, 120), six changes of 30 px down as the pointer drifts right past the
// area's edge (x = 240) to (370, 120), its end, then its momentum tail (README: `momentum: true`), a begin and six
// decaying changes off the area, and the tail's end. The camera is read by `scope` before and after; the flick being the
// list's is read from the entries it appended.
import { describe, expect, it } from 'vitest';
import { tilesProgram } from './programs.ts';
import { listDoc, putAtlas } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, appendedOf, binOf, cameraText, entriesText, none, prebuild, presented, putEvidence, runShow, sameCamera, scenario,
  scopeView, stateOf, toPanel, useTemp, viewOf,
} from './helpers.ts';

prebuild('deep-show');
const temp = useTemp();
const D = DOC(8);
const XS = [120, 170, 220, 270, 320, 370];
const TAIL = [20, 16, 12, 8, 6, 4];

describe(`${AC[8]} a scroll gesture's tail stays with the target it began on`, () => {
  it(`${AC[8]} a recorded flick that starts over the list's area and drifts off moves the camera 0`, () => {
    const ev = temp();
    const tiles = tilesProgram();
    putEvidence(ev, tiles.bytes);
    const doc = listDoc('list-flick', { atlas: putAtlas(ev), tiles, scroll: { id: 'list', spec: { class: 'document', range: [0, 190] } } });
    const view = scopeView(binOf('deep-show'), ev, D, doc, {}, 'AC8 the list');
    const at = (x: number): [number, number] => toPanel(view, [x, 120]);
    const s = new Script();
    s.present(D, doc);
    const before = s.scope();
    const flick = [
      s.scroll({ phase: 'begin', pos: at(XS[0]!), delta: [0, 0] }, 200),
      ...XS.map((x) => s.scroll({ phase: 'change', pos: at(x), delta: [0, 30] })),
      s.scroll({ phase: 'end', pos: at(380), delta: [0, 0] }),
      s.scroll({ phase: 'begin', pos: at(390), delta: [0, 0], momentum: true }),
      ...TAIL.map((dy, k) => s.scroll({ phase: 'change', pos: at(400 + 10 * k), delta: [0, dy], momentum: true })),
      s.scroll({ phase: 'end', pos: at(460), delta: [0, 0], momentum: true }),
    ];
    const after = s.scope();
    const r = runShow(binOf('deep-show'), scenario(ev, [D], s.calls), 'AC8 the flick that drifts off the list');
    presented(r[0]!, 'the list');

    const failures: string[] = [];
    const c0 = viewOf(stateOf(r[before]!, 'before the flick'), 'before the flick');
    const c1 = viewOf(stateOf(r[after]!, 'after the flick'), 'after the flick');
    if (!sameCamera(c0, c1)) failures.push(`the flick moves the camera from ${cameraText(c0)} to ${cameraText(c1)}, not 0`);
    const entries = flick.flatMap((i) => appendedOf(r[i]!, `event ${i}`));
    const values = entries.map((e) => e['value']);
    if (!entries.length || entries.some((e) => e['control'] !== 'list') || values.some((v, i) => typeof v !== 'number' || (i > 0 && v <= (values[i - 1] as number))))
      failures.push(`the flick that began over the list appends ${entriesText(entries)}, not the list's rising positions`);
    expect(XS.some((x) => x > 240), 'the fixture: the flick drifts past the area\'s right edge at x = 240').toBe(true);
    none(failures, 'the flick that starts over the list and drifts off');
  }, TIMEOUT);
});
