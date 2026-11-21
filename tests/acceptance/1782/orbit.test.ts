// AC7: "A 10 s orbit of a 100,000-triangle asset, sampled at 100 fixed times, gives the same edge IDs, spans and dash
// phases when its frames are evaluated forward, in reverse, in a seeded shuffle and one per fresh process. The pick
// set is derived once and a still view recomputes no span, both counted on the noop lane. A planted cache keyed
// without the camera returns the first time's spans at the second and fails, naming the first span that differs"
//
// The asset is #1640's folded sheet (100,000 triangles, a `mesh.asset@1`), read by one line: `crease {angle: 30}`,
// `border: false`, `material: true`, world size space, `dash` and `hidden.dash` both 5 mm on and off. It picks the
// sheet's four fold lines, 800 edges of 0.02 m, whose IDs are the reference's ranks. The camera is #1640's, turning
// once in 10 s from azimuth 45°; the 100 times are t = k ÷ 10 s, frames 0 to 99 at 10 fps (reference.ts: ORBIT).
// The sheet hides part of itself: by the reference (reference.ts: sheetHides) no fold edge is hidden at some of the
// 100 times, some are at others, and the hidden set at t = 0.1 s isn't the one at t = 0.
//
// Guard, which the base answers: a twin line without `hidden` or `material` draws the reference's 800 edges.
// Forward (one call, 100 frames, noop lane): at every time the spans are in edge order, every edge tiled; the span
// over an edge's middle is hidden exactly when the reference says the sheet hides that point (edges within 0.1 mm
// of a change left out); every edge has a dash, and a hidden one where a span is hidden. `edge_sets_derived` is 1
// in frame 0 and 0 after; `edge_spans_computed` is 1 in every frame. Orders: in reverse and in the seeded shuffle
// (one process each, one call a time, `from: k`) and one per fresh process, each time's `spans` and `dashes` equal
// the forward run's, number for number. Still: with no channel on the camera, 4 frames give 1, 0, 0, 0 for both
// counts and the same spans. Planted `edges_spans_cache_no_camera`: forward, t = 0.1 s gets t = 0's spans; against a
// fresh process at t = 0.1 s the same-in-every-order check fails, naming the first span that differs.
// Drawn (reference Mac): each of the 100 frames has the same `pixel_hash` forward and in reverse; under the planted
// cache the first two don't.

import { describe, expect, it } from 'vitest';
import { ASSET_TRIANGLES } from '../1640/helpers.ts';
import { add, creaseReference, foldedSheet, gltf, scale, sub, weldKey, type V3 } from '../1640/reference.ts';
import {
  AC, ANGLE, NOOP, assetItem, computedOf, creaseEdges, dashesOf, derivedOf, draw, edgeName, failsNaming, framesOf, line, none, rankedEdges, requireGpu,
  run, spanText, spansOf, tilingProblems, useDir, useGpuBin, viewCall, type Draw, type Frame, type JsonObject, type Span, type Startup,
} from './helpers.ts';
import { ORBIT, orbitEye, rank, sheetHides, shuffled, type Edge } from './reference.ts';

const bin = useGpuBin();
const dir = useDir();
const LINE = 'edges';
const TWIN = 'twin';
const SEED = 1782;
const STILL_FRAMES = 4;
const STYLE = { size_space: 'world' as const, width: 0.01, dash: [0.005, 0.005] };
const SHEET = gltf(foldedSheet());
/** The sheet's fold lines by ID, from the reference mesh: the asset stands at the origin, unrotated. */
const EDGES: Edge[] = rank(creaseReference(foldedSheet(), ANGLE, false));
const TIMES = Array.from({ length: ORBIT.times }, (_, k) => k);
const seconds = (k: number): string => `t = ${k / ORBIT.fps} s`;

/** The orbit's document with one line: the one with `hidden`, or the guard's twin. `still` leaves the camera's channel out. */
function orbit(o: { still?: boolean; twin?: boolean } = {}): Draw {
  const edges = creaseEdges('sheet', { border: false });
  const spin = { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: ORBIT.azimuth, interp: 'linear' }, k1: { t: `${ORBIT.seconds}s`, value: ORBIT.azimuth + ORBIT.turn } } };
  return {
    title: o.twin ? 'Orbit guard' : o.still ? 'Still sheet' : 'Hidden orbit', assets: [SHEET], fps: ORBIT.fps,
    items: {
      cam: { kind: 'camera@1', params: { projection: 'perspective', target: [...ORBIT.target], orbit: { azimuth: ORBIT.azimuth, elevation: ORBIT.elevation, distance: ORBIT.distance }, fov: ORBIT.fov, near: 0.1 } },
      sheet: assetItem(SHEET),
      ...(o.twin ? { [TWIN]: line({ edges, ...STYLE }) } : { [LINE]: line({ edges: { ...edges, material: true }, ...STYLE }, { dash: [0.005, 0.005] }) }),
    },
    extra: { transport: { span: `${ORBIT.seconds}s` }, ...(o.still ? {} : { channels: { spin } }) },
  };
}

interface At { k: number; spans: Span[]; dashes: Span[] }
const at = (f: Frame, what: string): At => ({ k: f.frame, spans: spansOf(f, LINE, what), dashes: dashesOf(f, LINE, what) });
/** The orbit's first `times` frames in one call, forward. Their spans are read by the caller, after its other runs. */
function forward(startup: Startup, times: number = ORBIT.times): { frames: Frame[]; what: string } {
  const what = `the orbit forward on ${startup.planted ?? startup.backend ?? 'Metal'}`;
  return { frames: draw(bin(), dir(), { ...orbit(), frames: times }, startup), what };
}
/** The times of `order`, one `view3d` call each (`from: k, frames: 1`), in one process. */
function seeked(order: readonly number[], startup: Startup, what: string): Frame[] {
  const base = viewCall(dir(), orbit());
  const replies = run(bin(), dir(), order.map((k): JsonObject => ({ ...base, from: k })), startup);
  return order.map((k, i) => framesOf(replies[i]!, `${what}, ${seconds(k)}`, k)[0]!);
}

const differs = (a: Span | undefined, b: Span | undefined): boolean => !a || !b || a.edge !== b.edge || a.from !== b.from || a.to !== b.to || a.hidden !== b.hidden;
const told = (s: Span | undefined): string => (s ? `edge ${s.edge}, ${spanText(s)}` : 'nothing');
/** One time's spans and dashes in `order` against the forward run's; the first of each that differs is named. */
function sameProblems(got: At, fwd: At, order: string): string[] {
  return ([['span', got.spans, fwd.spans], ['dash', got.dashes, fwd.dashes]] as const).flatMap(([noun, a, b]) => {
    const i = Array.from({ length: Math.max(a.length, b.length) }, (_, n) => n).find((n) => differs(a[n], b[n]));
    return i === undefined ? [] : [`${seconds(got.k)}, ${order}: ${noun} ${i} is ${told(a[i])}, not the forward run's ${told(b[i])}`];
  });
}

const MARGIN = 1e-4;
const along = (e: Edge, s: number): V3 => add(e.start, scale(sub(e.end, e.start), s / e.length));
/** How many fold edges the sheet hides at their middle at time k, by the reference alone. */
const hiddenMiddles = (k: number): boolean[] => EDGES.map((e) => sheetHides(along(e, e.length / 2), orbitEye(k)));
/** A time's spans against the reference: the span over each edge's middle is hidden exactly when the sheet hides it. */
function referenceProblems(a: At): string[] {
  const eye = orbitEye(a.k);
  const by = new Map<number, Span[]>();
  for (const s of a.spans) by.set(s.edge, [...(by.get(s.edge) ?? []), s]);
  const dashed = new Set(a.dashes.map((d) => d.edge));
  const out: string[] = [];
  for (const e of EDGES) {
    const mid = e.length / 2;
    const want = sheetHides(along(e, mid), eye);
    const clear = sheetHides(along(e, mid - MARGIN), eye) === want && sheetHides(along(e, mid + MARGIN), eye) === want;
    const span = (by.get(e.id) ?? []).find((s) => s.from <= mid && mid <= s.to);
    if (clear && span?.hidden !== want) out.push(`${seconds(a.k)}: ${edgeName(e)} is ${want ? 'hidden' : 'visible'} at its middle by the reference, ${span ? (span.hidden ? 'hidden' : 'visible') : 'in no span'} in spans`);
    if (!dashed.has(e.id)) out.push(`${seconds(a.k)}: ${edgeName(e)} has no dash`);
  }
  if (a.spans.some((s) => s.hidden) && !a.dashes.some((d) => d.hidden)) out.push(`${seconds(a.k)}: a span is hidden and no dash is`);
  return out;
}

describe(`${AC[7]} a 10 s orbit of a 100,000-triangle asset, sampled at 100 fixed times`, () => {
  it(`${AC[7]} forward: edge IDs are the ranks, every edge is tiled and hidden where the sheet hides it; the pick set is derived once and each frame computes its spans once (noop lane)`, () => {
    expect(foldedSheet().triangles.length, 'the asset has the issue\'s 100,000 triangles').toBe(ASSET_TRIANGLES);
    const counts = TIMES.map((k) => hiddenMiddles(k).filter(Boolean).length);
    expect([counts.some((n) => n === 0), counts.some((n) => n > 0 && n < EDGES.length)], 'the fixture, by the reference: at some times no fold edge is hidden, at others some are').toEqual([true, true]);
    const [guard] = draw(bin(), dir(), orbit({ twin: true }), NOOP);
    const key = (e: Edge): string => `${weldKey(e.start)}|${weldKey(e.end)}`;
    expect(rankedEdges(guard!, TWIN, 'the orbit\'s guard').map(key), 'the guard, as the base draws it: the twin line draws the reference\'s 800 fold edges').toEqual(EDGES.map(key));
    const { frames, what } = forward(NOOP);
    const ats = frames.map((f) => at(f, what));
    none(ats.flatMap((a) => [...tilingProblems(a.spans, EDGES).slice(0, 3), ...referenceProblems(a).slice(0, 3)]).slice(0, 40), `${what}: the spans at the 100 times`);
    expect(frames.map((f) => derivedOf(f, LINE, what)), `${what}: the pick set is derived once, in frame 0`).toEqual(TIMES.map((k) => (k === 0 ? 1 : 0)));
    expect(frames.map((f) => computedOf(f, LINE, what)), `${what}: the camera moves, so every frame computes its spans once`).toEqual(TIMES.map(() => 1));
  }, 3_600_000);

  it(`${AC[7]} gives the same edge IDs, spans and dashes in reverse, in a seeded shuffle and one per fresh process as forward (noop lane)`, () => {
    const shuffle = shuffled(ORBIT.times, SEED);
    expect([[...shuffle].sort((a, b) => a - b), shuffle.some((k, i) => k !== i)], 'the shuffle is a permutation of the 100 times, not their order').toEqual([TIMES, true]);
    // The three one-process runs first: that a seeked call's frame is numbered k is the base's to answer (#380).
    const played = forward(NOOP);
    const seeks = ([[[...TIMES].reverse(), 'in reverse'], [shuffle, 'in the seeded shuffle']] as const).map(([order, name]) => ({ name, frames: seeked(order, NOOP, `the orbit ${name}`) }));
    const fwd = played.frames.map((f) => at(f, played.what));
    for (const { name, frames } of seeks) {
      none(frames.flatMap((f) => sameProblems(at(f, `the orbit ${name}`), fwd[f.frame]!, name)).slice(0, 20), `the orbit ${name} against forward`);
    }
    const fresh = TIMES.flatMap((k) => sameProblems(at(seeked([k], NOOP, 'the orbit in a fresh process')[0]!, 'the orbit in a fresh process'), fwd[k]!, 'in a fresh process'));
    none(fresh.slice(0, 20), 'the orbit one time per fresh process against forward');
  }, 3_600_000);

  it(`${AC[7]} a still view recomputes no span and derives no pick set again (noop lane)`, () => {
    const what = 'the still sheet on noop';
    const frames = draw(bin(), dir(), { ...orbit({ still: true }), frames: STILL_FRAMES }, NOOP);
    const ats = frames.map((f) => at(f, what));
    expect(ats[0]!.spans.some((s) => s.hidden), `${what}: from azimuth 45° some span is hidden`).toBe(true);
    expect(frames.map((f) => derivedOf(f, LINE, what)), `${what}: the pick set is derived in frame 0 alone`).toEqual([1, 0, 0, 0]);
    expect(frames.map((f) => computedOf(f, LINE, what)), `${what}: the spans are computed in frame 0 alone`).toEqual([1, 0, 0, 0]);
    none(ats.slice(1).flatMap((a) => sameProblems(a, ats[0]!, 'still')), `${what}: every frame holds frame 0's spans`);
  }, 3_600_000);

  it(`${AC[7]} a planted cache keyed without the camera returns the first time's spans at the second and fails, naming the first span that differs (noop lane)`, () => {
    const planted: Startup = { backend: 'noop', planted: 'edges_spans_cache_no_camera' };
    const [h0, h1] = [hiddenMiddles(0), hiddenMiddles(1)];
    expect(h0.some((v, i) => v !== h1[i]), 'the fixture, by the reference: the hidden edges at t = 0.1 s aren\'t those at t = 0').toBe(true);
    const played = forward(planted, 2);
    const fwd = played.frames.map((f) => at(f, played.what));
    none(sameProblems(fwd[1]!, { ...fwd[0]!, k: 1 }, 'forward under the planted cache').map((p) => p.replace('the forward run\'s', 't = 0\'s')), 'the planted cache returns t = 0\'s spans at t = 0.1 s');
    const fresh = at(seeked([1], planted, 'the planted cache in a fresh process')[0]!, 'the planted cache in a fresh process');
    failsNaming(sameProblems(fresh, fwd[1]!, 'in a fresh process'), [`${seconds(1)}, in a fresh process: span `], 'the cache keyed without the camera');
  }, 3_600_000);

  it(`${AC[7]} the drawn frames have the same pixel hash forward and in reverse; under the planted cache the first two don't (reference Mac)`, () => {
    requireGpu();
    const hashProblems = (startup: Startup, times: number): string[] => {
      const fwd = forward(startup, times).frames;
      const back = seeked(TIMES.slice(0, times).reverse(), startup, 'the orbit in reverse');
      return back.flatMap((f) => {
        const hash = fwd[f.frame]!.pixel_hash;
        return hash !== null && hash === f.pixel_hash ? [] : [`${seconds(f.frame)}: the pixel hash in reverse, ${f.pixel_hash}, isn't the forward run's, ${hash}`];
      });
    };
    none(hashProblems({}, ORBIT.times).slice(0, 20), 'the orbit drawn in reverse against forward');
    failsNaming(hashProblems({ planted: 'edges_spans_cache_no_camera' }, 2), [`${seconds(1)}: the pixel hash in reverse`], 'the cache keyed without the camera, drawn');
  }, 3_600_000);
});
