// AC5: "With the orthographic blocker moved to hide 0.33 to 0.73 m, and the line's `dash` and `hidden.dash` both
// 0.05 m on and 0.05 m off in world size space, the first hidden dash ends at 0.35 m and the next starts at 0.40 m,
// within 1e-5 m, and the visible dash after the blocker runs from 0.73 to 0.75 m. A planted dash that restarts at
// each split ends its first hidden dash at 0.38 m and fails, naming the edge"
//
// The fixture is ridge.ts under the orthographic camera, its opaque quad from x = −0.17 to 0.23 m, so it hides 0.33
// to 0.73 m of the ridge measured from its start. The line is `size_space: world`, 0.02 m wide, `dash: [0.05, 0.05]`,
// `hidden: {dash: [0.05, 0.05], paint: muted}`. A dash's start and end are read as data, from `dashes` on the noop
// lane, because 1e-5 m is far below a pixel (README: How a dash's start and end are observed).
//
// Data (noop lane): the spans are 0 to 0.33 m visible, 0.33 to 0.73 m hidden, 0.73 to 1 m visible; in `dashes` the
// first hidden dash ends at 0.35 m, the next starts at 0.40 m, the first visible dash at or after 0.73 m runs 0.73 to
// 0.75 m, and the whole list is the reference's (reference.ts: inked), each end within 1e-5 m. Under `--planted
// edges_dash_restarts_at_split` the first hidden dash ends at 0.38 m and the check fails, naming the edge.
// Drawn (reference Mac): 640 px across 1.6 m, so s metres from the ridge's start is x = 120 + 400 s px in row 240.
// A swatch frame the base draws (the fixture with its twin line alone, solid, painted `muted`) guards that mapping
// and gives `hidden.paint` as a line draws it. In the fixture's frame the ID target carries the line at the middle of
// every reference dash, over the blocker too, and not at the middle of any gap; the final target there is the
// swatch's color on hidden dashes and another on visible ones. The planted run fails it, naming the edge.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHA, decodePng, obj, readIds, view3Reply, type Ids, type Image } from '../1640/helpers.ts';
import {
  AC, HIDDEN_PAINT, NOOP, SIZE, TOLERANCE, dashesOf, drawHidden, edgeName, failsNaming, framesOf, none, rankedEdges, requireGpu, run, spanProblems,
  spansOf, startName, tilingProblems, useDir, useGpuBin, viewCall, type Draw, type Frame, type Span, type Startup,
} from './helpers.ts';
import { DASH, DASH_ENDS, MOVED, RIDGE, inked, quad, type Edge } from './reference.ts';
import { HALFWAY, LINE, TWIN, VIEW_WIDTH, ridge, ridgeEdge, type Ridge } from './ridge.ts';

const bin = useGpuBin();
const dir = useDir();

/** "the orthographic blocker moved to hide 0.33 to 0.73 m": x from −0.17 to 0.23 m. */
const FIXTURE: Ridge = {
  title: 'Dashes across a split', view: 'orthographic', occluder: { id: 'blocker', quad: quad(-0.17, 0.23, HALFWAY), material: 'grey' },
  style: { size_space: 'world', width: 0.02, dash: [...DASH] }, hidden: { dash: DASH },
};
/** Every stretch the line inks, by the reference, and the gaps between them (the 5 cm after the last dash left out). */
const DASHES = inked(MOVED, DASH);
const GAPS = DASHES.slice(1).map((d, i): [number, number] => [DASHES[i]![1], d[0]]).filter(([a, b]) => b - a > 0.01);
const m = (x: number): string => String(+x.toFixed(3));

/** AC5's check on the data: the spans, the issue's three dash ends, and the whole reference list. */
function dashProblems(spans: readonly Span[], dashes: readonly Span[], edge: Edge): string[] {
  const name = edgeName(edge);
  const off = (a: number, b: number): boolean => Math.abs(a - b) > TOLERANCE;
  const out = [...tilingProblems(spans, [edge]), ...spanProblems(spans, edge, MOVED)];
  const hidden = dashes.filter((d) => d.edge === edge.id && d.hidden);
  const after = dashes.find((d) => d.edge === edge.id && !d.hidden && d.from >= DASH_ENDS.visibleAfter[0] - TOLERANCE);
  if (!hidden[0] || off(hidden[0].to, DASH_ENDS.firstHiddenEnd)) out.push(`${name}: its first hidden dash ends at ${hidden[0]?.to ?? 'no'} m, not ${DASH_ENDS.firstHiddenEnd} m`);
  if (!hidden[1] || off(hidden[1].from, DASH_ENDS.nextHiddenStart)) out.push(`${name}: its next hidden dash starts at ${hidden[1]?.from ?? 'no'} m, not ${DASH_ENDS.nextHiddenStart} m`);
  if (!after || off(after.from, DASH_ENDS.visibleAfter[0]) || off(after.to, DASH_ENDS.visibleAfter[1])) out.push(`${name}: the visible dash after the blocker runs ${after ? `${after.from} to ${after.to}` : 'nowhere'}, not ${DASH_ENDS.visibleAfter.join(' to ')} m`);
  return [...out, ...spanProblems(dashes, edge, DASHES, 'dash')];
}
function data(startup: Startup): { spans: Span[]; dashes: Span[]; edge: Edge; what: string } {
  const { edges, frames, what } = drawHidden(bin(), dir(), ridge(FIXTURE), LINE, TWIN, startup);
  const edge = ridgeEdge(edges, `${what}, its guard`);
  return { spans: spansOf(frames[0]!, LINE, what), dashes: dashesOf(frames[0]!, LINE, what), edge, what };
}

// ---- The drawn frame

type Rgb = [number, number, number];
interface Shot { ids: Ids; final: Image }
/** s metres from the ridge's start, in frame px: the orthographic camera shows 1.6 m across 640 px, y = 0 in row 240. */
const pixel = (s: number): [number, number] => [SIZE[0] / 2 + (RIDGE.start[0] + s) * (SIZE[0] / VIEW_WIDTH), SIZE[1] / 2];
const rgb = (image: Image, [x, y]: [number, number]): Rgb => { const o = (Math.floor(y) * image.width + Math.floor(x)) * 4; return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!]; };
/** The largest per-channel difference between two colors, in 8-bit codes. */
const codes = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const SAME = 12;
const OTHER = 40;

const captured = (d: Draw): Draw => ({ ...d, targets: ['final', 'ids'], capture: [0] });
const without = (d: Draw, id: string): Record<string, Draw['items'][string]> => Object.fromEntries(Object.entries(d.items).filter(([k]) => k !== id));
/**
 * The swatch, which the base draws: the fixture with its twin line alone, solid and in `hidden.paint`. It has no
 * dash because where the base starts a dash on an edge is not this suite's to say (README: An edge's start).
 */
function swatch(): Draw {
  const d = ridge({ ...FIXTURE, style: { size_space: 'world', width: 0.02 } });
  const twin = obj(d.items[TWIN], 'the twin line');
  return captured({ ...d, title: 'Dash swatch', items: { ...without(d, LINE), [TWIN]: { ...twin, params: { ...obj(twin['params'], 'the twin line\'s params'), paint: HIDDEN_PAINT } } } });
}
/** The fixture's frame: the line with `hidden` alone, so no twin draws over its dashes. */
const fixtureFrame = (): Draw => { const d = ridge(FIXTURE); return captured({ ...d, items: without(d, TWIN) }); };

/** Both frames on Metal: the swatch held to its guards, then the fixture's shot, `hidden.paint` and the edge. */
function shots(startup: Startup): { shot: Shot; paint: Rgb; edge: Edge; what: string } {
  const docs = [swatch(), fixtureFrame()];
  const replies = run(bin(), dir(), docs.map((d) => viewCall(dir(), d)), startup);
  const [guard, shot] = replies.map((reply, i): Shot & { frame: Frame } => {
    const what = `${docs[i]!.title} on ${startName(startup)}`;
    const frame = framesOf(reply, what)[0]!;
    const final = frame.raw['final'];
    expect(typeof final === 'string' && SHA.test(final), `${what}: the final target is written`).toBe(true);
    return { ids: readIds(dir(), view3Reply(reply, what, 1)[0]!, what), final: decodePng(readFileSync(join(dir(), `${String(final)}.png`))), frame };
  });
  const what = `the dashed ridge on ${startName(startup)}`;
  const edge = ridgeEdge(rankedEdges(guard!.frame, TWIN, `${what}, the swatch`), `${what}, the swatch`);
  const seen = DASHES.filter(([, , hidden]) => !hidden).map(([a, b]) => guard!.ids.at(...pixel((a + b) / 2)));
  expect(seen, `${what}, the swatch: the twin line is in the ID target at the middle of each dash the blocker doesn't hide`).toEqual(seen.map(() => TWIN));
  expect(guard!.ids.at(...pixel(0.53)), `${what}, the swatch: the blocker is in the ID target at 0.53 m`).toBe('blocker');
  return { shot: shot!, paint: rgb(guard!.final, pixel(0.125)), edge, what };
}
/** AC5's check on the frame: ink at the middle of each reference dash, in its style's paint, and none in a gap. */
function drawnProblems(shot: Shot, paint: Rgb, edge: Edge): string[] {
  const out: string[] = [];
  for (const [a, b, hidden] of DASHES) {
    const at = pixel((a + b) / 2);
    const what = `${hidden ? 'hidden' : 'visible'} dash ${m(a)} to ${m(b)} m`;
    const id = shot.ids.at(...at);
    const apart = codes(rgb(shot.final, at), paint);
    if (id !== LINE) out.push(`${edgeName(edge)}: no ink at the middle of the ${what} (the ID target has ${id ?? 'nothing'} there)`);
    else if (hidden && apart > SAME) out.push(`${edgeName(edge)}: the ${what} is ${apart} codes from hidden.paint`);
    else if (!hidden && apart < OTHER) out.push(`${edgeName(edge)}: the ${what} is drawn in hidden.paint`);
  }
  for (const [a, b] of GAPS) if (shot.ids.at(...pixel((a + b) / 2)) === LINE) out.push(`${edgeName(edge)}: ink at the middle of the gap ${m(a)} to ${m(b)} m`);
  return out;
}

describe(`${AC[5]} dashes of 0.05 m on and off across a blocker that hides 0.33 to 0.73 m`, () => {
  it(`${AC[5]} the first hidden dash ends at 0.35 m, the next starts at 0.40 m and the visible dash after the blocker runs 0.73 to 0.75 m, within 1e-5 m (noop lane)`, () => {
    const { spans, dashes, edge, what } = data(NOOP);
    none(dashProblems(spans, dashes, edge), `${what}: the ridge's dashes`);
  }, 600_000);

  it(`${AC[5]} a planted dash that restarts at each split ends its first hidden dash at 0.38 m and fails, naming the edge (noop lane)`, () => {
    const { spans, dashes, edge, what } = data({ backend: 'noop', planted: 'edges_dash_restarts_at_split' });
    const first = dashes.find((d) => d.hidden);
    expect(first === undefined ? NaN : Math.abs(first.to - DASH_ENDS.restartedFirstHiddenEnd), `${what}: the planted dash ends its first hidden dash at ${DASH_ENDS.restartedFirstHiddenEnd} m, got ${first?.to}`).toBeLessThanOrEqual(TOLERANCE);
    failsNaming(dashProblems(spans, dashes, edge), [`${edgeName(edge)}: its first hidden dash ends at`], 'the dash that restarts at each split');
  }, 600_000);

  it(`${AC[5]} the drawn frame inks the middle of each dash, hidden ones over the blocker in hidden.paint, and no gap (reference Mac)`, () => {
    requireGpu();
    const { shot, paint, edge, what } = shots({});
    none(drawnProblems(shot, paint, edge), `${what}: the drawn dashes`);
  }, 600_000);

  it(`${AC[5]} the planted dash that restarts at each split fails the drawn frame, naming the edge (reference Mac)`, () => {
    requireGpu();
    const { shot, paint, edge } = shots({ planted: 'edges_dash_restarts_at_split' });
    failsNaming(drawnProblems(shot, paint, edge), [`${edgeName(edge)}: ink at the middle of the gap 0.35 to 0.4 m`], 'the dash that restarts at each split, drawn');
  }, 600_000);
});
