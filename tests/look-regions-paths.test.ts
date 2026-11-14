// #462's regressions the blind suite doesn't reach (tests/acceptance/462/README.md, Not tested; canvas primitives: Look
// `look@1`: regions and edges, and motifs). The suite reads regions only through `view3d`'s read-back frames and
// motifs only in `film2d`; the design's regions apply to 2D films and every 3D view, and its motifs to any scene's
// bound items. Each case fails on the program before this change, which drew one look and moved nothing there:
// - `film2d`: a 2D band across a rect mask's edge draws in the shot's look and the region's, coverage summing to one
//   (red 240 on every band pixel) for each of the four edges, and a third look outside a transition is refused naming
//   the shot and the time.
// - `canonical` (an export) and `live` draw the blind suite's split film in both looks, coverage summing to one.
// - `view3d`: a look's motifs move the 3D items the document binds (seek equals play), hold still without motifs or
//   under reduced motion, and leave bound text still inside a reading hold.

import { describe, expect, it } from 'vitest';
import {
  BODY, COVERAGE_LOOKS, FLICKS, REPO, TIMEOUT, drawn, edgeColumn, edgeDoc, frameAt, framesOf, inconclusive, near, none, pixel,
  readPng, requireGpu, rgbText, run, shotTimes, show, slabPixels, useBins, useDir, view3d, writeJson,
  type Image, type JsonObject, type Rgb,
} from './acceptance/462/helpers.ts';
import { look3 } from './acceptance/382/helpers.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const MARGIN = 30;
const EDGES = ['straight', 'torn', 'pixel', 'brush'] as const;

/** Every slab pixel whose red is off 240 by more than a code: where the looks' coverage doesn't sum to one. */
function sumsToOne(image: Image, pixels: [number, number][], when: string): string[] {
  const off = pixels.filter(([x, y]) => Math.abs(pixel(image, x, y)[0] - 240) > 1);
  return off.length ? [`${when}: ${off.length} of ${pixels.length} pixels have red other than 240 ± 1: ${off.slice(0, 6).map(([x, y]) => `(${x}, ${y}) ${rgbText(pixel(image, x, y))}`).join(', ')}`] : [];
}
/** The most common color left and right of `edge` (30 px off) against the looks that draw there. */
function sides(image: Image, pixels: [number, number][], edge: number, left: Rgb, right: Rgb, when: string): string[] {
  const count = (keep: (x: number) => boolean): Rgb => {
    const tally = new Map<string, number>();
    for (const [x, y] of pixels) if (keep(x)) { const k = rgbText(pixel(image, x, y)); tally.set(k, (tally.get(k) ?? 0) + 1); }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '(0, 0, 0)';
    return best.slice(1, -1).split(', ').map(Number) as Rgb;
  };
  const l = count((x) => x + 0.5 <= edge - MARGIN);
  const r = count((x) => x + 0.5 >= edge + MARGIN);
  return [
    ...(near(l, left, 1) ? [] : [`${when}: left of the edge draws ${rgbText(l)}, not ${rgbText(left)}`]),
    ...(near(r, right, 1) ? [] : [`${when}: right of the edge draws ${rgbText(r)}, not ${rgbText(right)}`]),
  ];
}

// ---------------------------------------------------------------------------------------------------
// 2D: a band across a rect mask's edge in a 480 × 270 film, its camera one u a px.

const SIZE2: [number, number] = [480, 270];
const BAND = { x: 40, y: 100, w: 400, h: 70 } as const;
const EDGE2 = 240;
/** The clean 2D look with `body` in `c`. */
function look2(c: Rgb): JsonObject {
  const clean = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as JsonObject;
  const hex = `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return { ...clean, id: `band-${hex.slice(1)}`, palette: { ...(clean['palette'] as JsonObject), 'c-body': hex }, roles: { ...(clean['roles'] as JsonObject), body: 'c-body' } };
}
const LOOKS2 = (): Record<string, JsonObject> => ({ a: look2(BODY.a), b: look2(BODY.b), c: look2(BODY.c) });
function film2(edge: string, third = false): JsonObject {
  const item = (id: string, order: string, kind: string, params: JsonObject, extra: JsonObject = {}): JsonObject =>
    ({ id, kind, layer: 'main', name: id, order, params, at: { pos: [0, 0, 0] }, ...extra });
  const rect = (id: string, order: string, box: number[], extra: JsonObject = {}): JsonObject => item(id, order, 'rect@1', { box, paint: { fill: { role: 'body' } } }, extra);
  const region = (mask: string, look: string, seed: number): JsonObject => ({ mask, look, edge, width: 16, seed });
  return {
    format: 1, id: `film-462-band-${edge}${third ? '-third' : ''}`, profile: 'film', title: `A band across a ${edge} edge`,
    description: 'A #462 regression: a band crossing a rect mask\'s edge.', size: SIZE2, camera: 'cam',
    transport: { span: '4s' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: {
      cam: item('cam', 'a0', 'camera@1', { projection: 'orthographic', target: [SIZE2[0] / 2, SIZE2[1] / 2, 0], view_width: SIZE2[0] }),
      band: rect('band', 'b0', [BAND.x, BAND.y, BAND.w, BAND.h]),
      zone: rect('zone', 'c0', [EDGE2, -20, 400, 320], { visible: false }),
      zone2: rect('zone2', 'c1', [0, -20, 100, 320], { visible: false }),
    },
    channels: { arrive: { target: 'items/zone2/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 2000, interp: 'hold' }, k1: { t: '2s', value: 0, interp: 'hold' } } } },
    shots: { one: { start: '0s', end: '4s', camera: 'cam', move: 'hold', look: 'a', regions: [region('zone', 'b', 3), ...(third ? [region('zone2', 'c', 4)] : [])] } },
  };
}
function bandPixels(): [number, number][] {
  const out: [number, number][] = [];
  for (let y = BAND.y + 3; y < BAND.y + BAND.h - 3; y++) for (let x = BAND.x + 3; x < BAND.x + BAND.w - 3; x++) out.push([x, y]);
  return out;
}

describe('#462 look regions in a 2D film', () => {
  it('a band across a rect mask draws in both looks, coverage summing to one, for every edge', () => {
    requireGpu();
    const d = dir();
    const looks = LOOKS2();
    const calls = EDGES.map((edge) => ({ call: 'film2d', doc: film2(edge), look: looks['a']!, looks, fps: 30, from: 30, frames: 1, capture: [30], hash: true }));
    const replies = run(bins.bin('deep-gpu'), d, calls);
    const problems = EDGES.flatMap((edge, i) => {
      const image = readPng(d, frameAt(framesOf(replies[i]!, `the ${edge} band`), 30, `the ${edge} band`).final, `the ${edge} band at 1 s`);
      return [...sumsToOne(image, bandPixels(), `${edge}, 1 s`), ...sides(image, bandPixels(), EDGE2, BODY.a, BODY.b, `${edge}, 1 s`)];
    });
    none(problems, 'the band across the region\'s edge in a 2D film');
  }, TIMEOUT);

  it('a third look outside a transition window is refused, naming the shot and the time', () => {
    requireGpu();
    const d = dir();
    const looks = LOOKS2();
    const [refused, plain] = run(bins.bin('deep-gpu'), d, [
      { call: 'film2d', doc: film2('torn', true), look: looks['a']!, looks, fps: 30, frames: 1, hash: true },
      { call: 'film2d', doc: film2('torn'), look: looks['a']!, looks, fps: 30, from: 75, frames: 1, hash: true },
    ]);
    if (refused!['code'] === 'unsupported_platform') inconclusive('film2d reports unsupported_platform');
    framesOf(plain!, 'the film with one region, at 2.5 s');
    expect(refused!['frames'], `three looks from 2 s are refused before a frame draws: ${show(refused)}`).toBeUndefined();
    const times = shotTimes(refused!, 'one');
    expect(times.length, `the refusal names the shot one with a time: ${show(refused)}`).toBeGreaterThan(0);
    for (const t of times) expect(t >= 2 * FLICKS && t < 4 * FLICKS, `${t} flicks is when three looks draw`).toBe(true);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// 3D: the blind suite's split film (look a, region b across a torn edge) through an export and the live window.

/** A view3d document as a writer's payload, as `canonical` and `live` take it. */
function payload(doc: JsonObject): JsonObject {
  const out = structuredClone(doc);
  delete out['id'];
  delete out['layers'];
  for (const item of Object.values(out['items'] as Record<string, JsonObject>)) delete item['layer'];
  return out;
}
const SIZE3: [number, number] = [480, 270];
function splitProblems(image: Image, when: string): string[] {
  const pixels = slabPixels(3, [image.width, image.height]);
  const edge = edgeColumn([image.width, image.height]);
  return [...sumsToOne(image, pixels, when), ...sides(image, pixels, edge, BODY.a, BODY.b, when)];
}

describe('#462 look regions in the export and live paths of a 3D view', () => {
  it('an export (canonical) draws the slab in both looks, coverage summing to one', () => {
    requireGpu();
    const d = dir();
    const looks = COVERAGE_LOOKS();
    const doc = writeJson(d, 'split.json', payload(edgeDoc('split', { edge: 'torn' })));
    const [reply] = run(bins.bin('deep-gpu'), d, [{ call: 'canonical', look: looks['a']!, looks, writer: 'agent:alpha', doc, size: SIZE3, frame: 31, fps: 30, purpose: 'export', targets: ['final'] }]);
    if (reply!['code'] === 'unsupported_platform') inconclusive('canonical reports unsupported_platform');
    expect(typeof reply!['final'], `the export wrote its final frame: ${show(reply)}`).toBe('string');
    none(splitProblems(readPng(d, reply!['final'] as string, 'the export at 1 s'), 'export, 1 s'), 'the export of the split film');
  }, TIMEOUT);

  it('the live window draws the slab in both looks, coverage summing to one', () => {
    requireGpu();
    const d = dir();
    const looks = COVERAGE_LOOKS();
    const doc = writeJson(d, 'split.json', payload(edgeDoc('split', { edge: 'torn' })));
    // Its first frames, which a still scene draws whatever else it holds back.
    const capture = [1, 2, 3];
    const [reply] = run(bins.bin('deep-gpu'), d, [{ call: 'live', look: looks['a']!, looks, fps: 30, frames: 3, capture, report: ['hashes'], sessions: [{ session: 's', writer: 'agent:alpha', doc, size: SIZE3 }] }]);
    if (reply!['code'] === 'unsupported_platform') inconclusive('live reports unsupported_platform');
    expect(reply!['code'], `the live call drew: ${show(reply)}`).toBeUndefined();
    const finals = [...JSON.stringify(reply).matchAll(/"final":"([0-9a-f]{64})"/g)];
    expect(finals.length, `the live window wrote its captured frames: ${show(reply).slice(0, 2000)}`).toBeGreaterThan(0);
    none(splitProblems(readPng(d, finals.at(-1)![1]!, 'the live window\'s last frame'), 'live'), 'the live window of the split film');
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// 3D motifs: a box the document binds to a drift motif, and a label to another, seen straight on.

const MOTIF_ROLES: Record<string, Rgb> = { body: [220, 120, 80], ink: [30, 30, 30] };
function motifLook3(motifs: boolean): JsonObject {
  const look = look3('motifs-3d-462', MOTIF_ROLES) as JsonObject;
  return motifs ? { ...look, motifs: { drift: { motion: 'drift', amount: 0.4, hz: 1, desync: false }, words: { motion: 'drift', amount: 0.3, hz: 1, desync: false } } } : look;
}
function motifDoc(bound: 'box' | 'text'): JsonObject {
  const item = (id: string, order: string, extra: JsonObject): JsonObject => ({ id, name: id, order, layer: 'main', ...extra });
  return {
    format: 1, id: `doc-462-motifs-3d-${bound}`, profile: 'scene', title: 'A drifting box and label', description: 'A #462 regression: motifs on 3D items.',
    size: SIZE3, seed: 462, camera: 'cam', requires: { modules: { scene3d: '^1', effects: '^1' } },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, transport: { span: '2s' },
    items: {
      cam: item('cam', 'a0', { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.5, 0], orbit: { azimuth: 0, elevation: 0, distance: 7 }, fov: 40, near: 0.1 } }),
      sun: item('sun', 'a1', { kind: 'light.sun@1', params: { illuminance: Math.PI, shadow: false, angle: 0.53 }, at: { rot: [0, 0, 0] } }),
      bob: item('bob', 'b0', { kind: 'mark.box@1', params: { size: [0.6, 0.6, 0.6], paint: { fill: { role: 'body' } } }, at: { pos: [-1, 0.5, 0] } }),
      label: item('label', 'b1', { kind: 'mark.text@1', params: { text: 'Drift', size: 24, font: 'body', paint: { fill: { role: 'ink' } } }, at: { pos: [1, 1.2, 0] } }),
    },
    collections: { bobs: { members: ['bob'] }, labels: { members: ['label'] } },
    motif_slots: bound === 'box' ? { drift: 'bobs' } : { words: 'labels' },
    markers: { read: { kind: 'hold', name: 'read', t: '0.5s', span: '0.5s' } },
  };
}

describe('#462 motifs in a 3D view', () => {
  it('a look\'s motif moves the box the document binds, as seeking does, and holds it still without motifs or under reduced motion', () => {
    requireGpu();
    const d = dir();
    const doc = writeJson(d, 'box.json', motifDoc('box'));
    const call = (look: JsonObject, extra: JsonObject = {}): JsonObject => view3d({ doc, look, fps: 30, from: 0, frames: 12, ...extra } as never);
    const [moving, still, reduced, seek] = run(bins.bin('deep-gpu'), d, [
      call(motifLook3(true)), call(motifLook3(false)), call(motifLook3(true), { reduced_motion: true }), call(motifLook3(true), { from: 7, frames: 1 }),
    ]);
    const hashes = (r: JsonObject, what: string): string[] => framesOf(r, what).map((f) => f.pixelHash);
    const m = hashes(moving!, 'the motif look');
    expect(new Set(m).size, 'the bound box moves under the look\'s motif: its frames differ').toBeGreaterThan(6);
    expect(new Set(hashes(still!, 'the look without motifs')).size, 'without motifs the frames are alike').toBe(1);
    expect(new Set(hashes(reduced!, 'reduced motion')).size, 'under reduced motion the frames are alike').toBe(1);
    expect(hashes(seek!, 'frame 7 seeked')[0], 'frame 7 seeked equals frame 7 played').toBe(m[7]);
  }, TIMEOUT);

  it('a bound 3D label holds still inside a reading hold and moves outside it', () => {
    requireGpu();
    const d = dir();
    const doc = writeJson(d, 'text.json', motifDoc('text'));
    const [reply] = run(bins.bin('deep-gpu'), d, [view3d({ doc, look: motifLook3(true), fps: 30, from: 0, frames: 36 } as never)]);
    drawn(reply!, 'the label film');
    const h = framesOf(reply!, 'the label film').map((f) => f.pixelHash);
    // The hold spans 0.5 s to 1 s: frames 15 to 30; its edges left out by a frame.
    expect(new Set(h.slice(16, 30)).size, 'inside the reading hold the label holds still').toBe(1);
    expect(new Set(h.slice(0, 14)).size, 'before the hold the label moves').toBeGreaterThan(6);
  }, TIMEOUT);
});
