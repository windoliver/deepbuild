// AC3 #542.8b5ba7e9: In class view, scrolling adds no entry to the input track and leaves the document's hash and its
// golden as they were; End moves to 190 and announces it by its value text; with the pointer outside the list's area
// the wheel zooms the camera as before; and a planted router that gives the wheel to the list everywhere fails the
// camera's zoom fixture, naming the control
//
// Through `deep-show run` (README: The surface under test), on the list fixture with `list` in class view (range
// [0, 190], `value_text` "Row {value}"). The camera's zoom fixture: the same document with no scroll control, where a
// trackpad gesture of 120 px down at (360, 120), on the page's right half, zooms the camera from where it starts; with
// `list` there, the same gesture after three wheel lines over the list must leave the camera where that fixture does.
// The document's hash is `read`'s (#504), the golden its `eval` frame at 1 s with pixels (#387, #539). Then Tab
// focuses `list`, and ArrowDown and End move it; `see` gives what was announced. The planted
// `wheel_to_list_everywhere` (README: Planted twins) gives the wheel to the list wherever the pointer is.
import { describe, expect, it } from 'vitest';
import { tilesProgram } from './programs.ts';
import { OUTSIDE, OVER, listDoc, putAtlas } from './fixtures.ts';
import {
  AC, DOC, FLICKS, Script, TIMEOUT, appendedOf, binOf, cameraText, entriesText, failsNaming, focusOf, intsOf, none, obj, once, prebuild, presented,
  putEvidence, runShow, sameCamera, scenario, scopeView, seenOf, show, stateOf, str, toPanel, useTemp, viewOf, type JsonObject, type Pt, type ShowPlanted, type View,
} from './helpers.ts';

prebuild('deep-show');
const temp = useTemp();
const D = DOC(3);
const GOLDEN_T = FLICKS;

/** A trackpad gesture of 120 px down at `p`: its begin, three changes of 40 px, its end (#383's pace). */
function gesture(s: Script, p: Pt): number[] {
  return [
    s.scroll({ phase: 'begin', pos: p, delta: [0, 0] }, 200),
    ...[0, 1, 2].map(() => s.scroll({ phase: 'change', pos: p, delta: [0, 40] })),
    s.scroll({ phase: 'end', pos: p, delta: [0, 0] }),
  ];
}
const docs = once(() => {
  const ev = temp();
  const atlas = putAtlas(ev);
  const tiles = tilesProgram();
  return {
    view: listDoc('list-view', { atlas, tiles, scroll: { id: 'list', spec: { class: 'view', range: [0, 190] } } }),
    bare: listDoc('list-bare', { atlas, tiles }),
    tiles,
  };
});
/** An evidence store holding the atlas and the tiles program, for one scenario. */
function evidence(): string {
  const ev = temp();
  putAtlas(ev);
  putEvidence(ev, docs().tiles.bytes);
  return ev;
}

/** The camera's zoom fixture: the document with no scroll control, its camera before and after the gesture outside. */
const zoomFixture = once((): { before: View; after: View } => {
  const ev = evidence();
  const s = new Script();
  s.present(D, docs().bare);
  const a = s.scope();
  const view = scopeView(binOf('deep-show'), ev, D, docs().bare, {}, 'AC3 the zoom fixture');
  gesture(s, toPanel(view, OUTSIDE));
  const b = s.scope();
  const r = runShow(binOf('deep-show'), scenario(ev, [D], s.calls), 'AC3 the camera\'s zoom fixture, with no scroll control');
  presented(r[0]!, 'the zoom fixture');
  const out = { before: viewOf(stateOf(r[a]!, 'before'), 'before'), after: viewOf(stateOf(r[b]!, 'after'), 'after') };
  expect(sameCamera(out.before, out.after), `the fixture: the gesture at (360, 120) zooms the camera with no scroll control (${cameraText(out.before)} then ${cameraText(out.after)})`).toBe(false);
  return out;
});

interface Run { entries: string[]; kept: string[]; scrolled: string[]; end: string[]; zoom: string[] }
function judge(planted?: ShowPlanted): Run {
  const ev = evidence();
  const doc = docs().view;
  const view = scopeView(binOf('deep-show'), ev, D, doc, {}, 'AC3 the list in class view');
  const s = new Script();
  s.present(D, doc);
  const read0 = s.read(D);
  const golden0 = s.eval(D, GOLDEN_T);
  const lines = [0, 1, 2].map(() => s.wheel(toPanel(view, OVER)));
  const outside = gesture(s, toPanel(view, OUTSIDE));
  const cam = s.scope();
  const read1 = s.read(D);
  const revs = s.revisions(D);
  const golden1 = s.eval(D, GOLDEN_T);
  const tab = s.key('Tab');
  const down = s.key('ArrowDown');
  const downAt = s.now;
  const end = s.key('End');
  const seen = s.see();
  const r = runShow(binOf('deep-show'), scenario(ev, [D], s.calls, planted ? { planted } : {}), `AC3 scrolling the list in class view${planted ? ` (planted ${planted})` : ''}`);
  presented(r[0]!, 'the list in class view');

  const entries: string[] = [];
  const appended = [...lines, ...outside, tab, down, end].flatMap((i) => appendedOf(r[i]!, `call ${i}`));
  if (appended.length) entries.push(`scrolling and the keys in class view append ${entriesText(appended)} to the input track, not nothing`);

  const kept: string[] = [];
  const hash = (i: number): string => str(obj(r[i]!, 'read')['hash'], 'read: hash');
  if (hash(read1) !== hash(read0)) kept.push(`the document's hash changed from ${hash(read0)} to ${hash(read1)}`);
  const revisions = Array.isArray(r[revs]!['revisions']) ? r[revs]!['revisions'] : [];
  if (revisions.length !== 1) kept.push(`the document has ${revisions.length} revisions after scrolling, not the one presented`);
  const frame = (i: number): string | null => {
    const snaps = r[i]!['snapshots'];
    return Array.isArray(snaps) && snaps[0] && typeof snaps[0] === 'object' && !Array.isArray(snaps[0]) ? String((snaps[0] as JsonObject)['sha256'] ?? '') : null;
  };
  if (!frame(golden0)) kept.push(`eval at 1 s gives no frame: ${show(r[golden0], 600)}`);
  else if (frame(golden1) !== frame(golden0)) kept.push(`the golden's frame at 1 s changed from ${frame(golden0)} to ${frame(golden1)} after scrolling`);

  const endF: string[] = [];
  if (focusOf(r[tab]!, 'after Tab') !== 'list') endF.push(`Tab focuses ${show(focusOf(r[tab]!, 'after Tab'))}, not list`);
  const said = seenOf(r[seen]!, 'see').announcements.filter((a) => a.id === 'list' && (a.t === null || a.t >= downAt));
  const arrow = said[0];
  const last = said[said.length - 1];
  if (!last || intsOf(last.text)[0] !== 190 || !/\bRow\b/.test(last.text)) endF.push(`End announces ${show(last?.text ?? null)}, not its value text "Row 190" (announcements of list from ArrowDown on: ${show(said.map((a) => a.text))})`);

  // The zoom fixture: the camera after the gesture outside the list's area, where the same gesture leaves it with no scroll control.
  const zoom: string[] = [];
  const fixture = zoomFixture();
  const after = viewOf(stateOf(r[cam]!, 'after the gesture outside'), 'after the gesture outside');
  const tookIt = arrow !== undefined && intsOf(arrow.text)[0] !== 4;
  if (!sameCamera(after, fixture.after))
    zoom.push(`the camera's zoom fixture: the wheel at (360, 120), outside listbox, leaves the camera ${cameraText(after)}, not ${cameraText(fixture.after)} as with no scroll control${tookIt ? `; the control list took it (ArrowDown after three lines then announces ${JSON.stringify(arrow.text)}, not Row 4)` : ''}`);
  // The scrolling happened: the three wheel lines moved the session's position to 3, so ArrowDown then says "Row 4".
  const scrolled = !arrow || intsOf(arrow.text)[0] !== 4 || !/\bRow\b/.test(arrow.text) ? [`the three wheel lines didn't scroll the list to 3: ArrowDown after them announces ${show(arrow?.text ?? null)}, not "Row 4"`] : [];
  return { entries, kept, scrolled, end: endF, zoom };
}
const honest = once(() => judge());

describe(`${AC[3]} a scroll control in class view is session state: no entry, no change to the document, the camera keeps the wheel elsewhere`, () => {
  it(`${AC[3]} in class view, scrolling adds no entry to the input track and leaves the document's hash and its golden as they were`, () => {
    none([...honest().scrolled, ...honest().entries, ...honest().kept], 'scrolling in class view');
  }, TIMEOUT);

  it(`${AC[3]} End moves to 190 and announces it by its value text`, () => {
    none(honest().end, 'Tab and End on the list');
  }, TIMEOUT);

  it(`${AC[3]} with the pointer outside the list's area the wheel zooms the camera as before`, () => {
    none(honest().zoom, 'the wheel outside the list\'s area');
  }, TIMEOUT);

  it(`${AC[3]} planted wheel_to_list_everywhere fails the camera's zoom fixture, naming the control`, () => {
    failsNaming(judge('wheel_to_list_everywhere').zoom, [/zoom fixture/, /the control list took it/], 'the planted router');
  }, TIMEOUT);
});
