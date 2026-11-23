// AC5 #1217.bf9688c3: With the pointer unused, Tab reaches each part's anchor and two Enters read the distance between
// the two anchors.
//
// The fixture (README: Fixtures, the two parts): `plinth`, a `slab@1` of size [1, 1, 1] at (−2, 0, 0), and `beam`, a
// `slab@1` of size [1, 2, 1] at (2, 0, 0), each of `role: part`. A part's anchors are the ones its builder returns
// (Builder: `anchors: {name → frame}`), read here through the base's `geometry` call, so no anchor's name is assumed;
// each is addressed `<item>#<anchor>` (ID and sub-address), and its world point is its `pos` at the part's `at.pos`.
//
// No scenario of this test holds a pointer event: the tool is turned on by the viewer's setting, and only keys follow.
// Run 1, the sweep: 24 Tab presses, the focus read after each (`state.focus`). Every anchor of both parts must be among
// the stops, and the stops must come round. Run 2, the measure, planned from the sweep's order: Tab to the first anchor
// of the plinth and Enter, Tab on to the next anchor of the beam and Enter. The focus before each Enter must be the
// planned stop; A must be on the plinth at the first anchor's point and B on the beam at the second's, each within
// 1e-5 m; and the readout's distance must be the distance between the two anchors, at two decimals in metres.
//
// Wrong programs this fails on: the base (Tab walks controls only; there is no tool); Tab that skips a part or an
// anchor; Enter that places nothing, or places at the pointer; a distance between other points than the two anchors.
import { describe, expect, it } from 'vitest';
import {
  AC, PARTS, TIMEOUT, Script, at, builtOf, dist, fmt, measureIn, metres, notPresented, readoutText, requireMetal, runShow, scenario, show, twoParts, useShow,
  useTemp, type JsonValue, type V3,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();
const BOUND = 1e-5;
const SWEEP = 24;
const IDS = Object.keys(PARTS);

describe(`${AC[5]} the measure tool by keyboard alone`, () => {
  it(`${AC[5]} with no pointer event, Tab reaches every anchor of each part, and Enter on an anchor of one part and of the other reads the distance between them`, () => {
    requireMetal();
    const f = twoParts(5);
    const pointerless = (calls: readonly { [key: string]: JsonValue }[]): boolean =>
      calls.every((c) => c['call'] !== 'input' || ['control', 'key'].includes(String(at(c['event'], 'type'))));

    // Run 1: the sweep.
    const s = new Script();
    const shown = s.present(f.id, f.document);
    const geometry = s.geometry(f.id, IDS);
    const on = s.measure(true);
    const tabs = Array.from({ length: SWEEP }, () => s.key('Tab'));
    expect(pointerless(s.calls), 'the sweep\'s scenario holds no pointer event').toBe(true);
    const sweep = runShow(bin(), scenario(temp(), f.id, f.size, s.calls), 'AC5 the sweep');
    expect(sweep.ok, `deep-show run takes the sweep: ${show(sweep.raw, 2000)}`).toBe(true);
    const r = sweep.replies;
    expect(notPresented(r[shown]), 'the two parts, a document that offers the measure tool (viewer_tools: {measure: true}), are presented').toBe('');

    // Each part's anchors, as its builder returns them.
    const { built, problem } = builtOf(r[geometry], PARTS);
    expect(problem, 'the fixture: geometry gives both parts\' built meshes').toBe('');
    const anchors = new Map<string, V3>();
    for (const part of built) {
      expect(Object.keys(part.anchors).length, `the fixture: the builder returns at least one anchor for ${part.id}`).toBeGreaterThan(0);
      for (const [name, point] of Object.entries(part.anchors)) anchors.set(`${part.id}#${name}`, point);
    }

    expect(measureIn(r[on]).on, `the viewer's setting turns the tool on: state.measure is ${show(at(r[on], 'state', 'measure'))}`).toBe(true);
    const stops = tabs.map((i) => at(r[i], 'state', 'focus') ?? null);
    const reached = [...anchors.keys()].filter((a) => stops.includes(a));
    console.log(`${AC[5]}: the parts' anchors: ${[...anchors.keys()].join(', ')}; Tab's stops: ${show(stops, 800)}`);
    expect(reached, `Tab reaches each part's anchor, as <item>#<anchor>; the stops of ${SWEEP} presses were ${show(stops, 800)}`).toEqual([...anchors.keys()]);
    const first = stops.findIndex((x) => typeof x === 'string' && x.startsWith('plinth#') && anchors.has(x));
    const second = stops.findIndex((x, k) => k > first && typeof x === 'string' && x.startsWith('beam#') && anchors.has(x));
    expect(first >= 0 && second > first, `Tab comes to an anchor of the plinth and then to one of the beam within ${SWEEP} presses: ${show(stops, 800)}`).toBe(true);
    const from = String(stops[first]); const to = String(stops[second]);

    // Run 2: Tab to the plinth's anchor, Enter; Tab on to the beam's anchor, Enter.
    const m = new Script();
    const shownAgain = m.present(f.id, f.document);
    m.measure(true);
    let atFirst = 0;
    for (let k = 0; k <= first; k++) atFirst = m.key('Tab');
    const enterA = m.key('Enter');
    let atSecond = 0;
    for (let k = first + 1; k <= second; k++) atSecond = m.key('Tab');
    const enterB = m.key('Enter');
    expect(pointerless(m.calls), 'the measure\'s scenario holds no pointer event').toBe(true);
    const run = runShow(bin(), scenario(temp(), f.id, f.size, m.calls), 'AC5 the measure');
    expect(run.ok, `deep-show run takes the measure: ${show(run.raw, 2000)}`).toBe(true);
    const q = run.replies;
    expect(notPresented(q[shownAgain]), 'the two parts are presented again').toBe('');
    expect(at(q[atFirst], 'state', 'focus'), `after ${first + 1} Tab presses the focus is on ${from}, as in the sweep`).toBe(from);
    const one = measureIn(q[enterA]);
    expect(one.a?.item, `Enter places A at the focused anchor ${from}: state.measure is ${show(one.raw)}`).toBe('plinth');
    expect(dist(one.a!.point, anchors.get(from)!), `A is the anchor ${from} at ${fmt(anchors.get(from)!)} within ${BOUND} m: got ${fmt(one.a!.point)}`).toBeLessThanOrEqual(BOUND);
    expect(one.b, 'B is not placed after one Enter').toBeNull();
    expect(at(q[atSecond], 'state', 'focus'), `${second - first} more Tab presses bring the focus to ${to}, as in the sweep`).toBe(to);
    const two = measureIn(q[enterB]);
    expect([two.a?.item, two.b?.item], `the second Enter places B at the focused anchor ${to}: state.measure is ${show(two.raw)}`).toEqual(['plinth', 'beam']);
    expect(dist(two.a!.point, anchors.get(from)!), `A stays at ${from}: got ${fmt(two.a!.point)}`).toBeLessThanOrEqual(BOUND);
    expect(dist(two.b!.point, anchors.get(to)!), `B is the anchor ${to} at ${fmt(anchors.get(to)!)} within ${BOUND} m: got ${fmt(two.b!.point)}`).toBeLessThanOrEqual(BOUND);
    const between = dist(anchors.get(from)!, anchors.get(to)!);
    console.log(`${AC[5]}: ${from} ${fmt(anchors.get(from)!)} to ${to} ${fmt(anchors.get(to)!)}: ${between} m; ${readoutText(two.readout)}`);
    expect(between, 'the fixture: the two anchors are apart').toBeGreaterThan(1);
    expect(two.readout?.distance, `two Enters read the distance between ${from} and ${to}, ${between.toFixed(4)} m: ${readoutText(two.readout)}`).toBe(metres(between));
  }, TIMEOUT);
});
