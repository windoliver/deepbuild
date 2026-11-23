// AC2 #161.2bd9eeb2: levels and curves through spline match their Fritsch and Carlson reference within one 10-bit code
// value, and corner_pin through homography puts a quad's corners within 0.5 px.
//
// Three groups drawn by `layers` (#385's call, #430's `float`), each beside the same group with no pass, in one run:
//   - a 256 × 64 px grey ramp, black to white, under `fx.curves@1 {points}` with five points, and under
//     `fx.levels@1 {in_black: 0.2, in_white: 0.8, out_black: 0.1, out_white: 0.9}`. Each texel's input is read from the
//     draw with no pass; its answer is the monotone cubic through the points at that input, on r, g and b, alpha kept:
//     Fritsch and Carlson's monotone piecewise cubic with Fritsch and Butland's interior slopes and the three-point,
//     shape-preserving end slopes, held at its end values past either end, which is what the base's `spline@1` builds
//     (and what #431's suite holds it to). For levels the points are its two ends, (in_black, out_black) and
//     (in_white, out_white): the cubic through two points is the line between them.
//   - one opaque 160 × 96 px rectangle under `fx.corner_pin@1 {quad}`, the quad in uv of the group's bounds, its
//     corners in `homography@1`'s order: the bounds' corners (0, 0), (1, 0), (1, 1), (0, 1) land on quad[0] … quad[3].
//     Each edge of what is drawn is found where coverage crosses one half (25 crossings along the middle 60% of each
//     edge, a line fitted through them); adjacent edges meet at the corners, each held to 0.5 px of the quad's.
//
// The reference is an oracle only once it reproduces published numbers: Fritsch and Carlson's own nine-point data, at
// the eleven abscissae and with the values, to 5e-5, that #431's suite holds the base's reference to. Wrong programs:
// the base (it has none of the three operators); a levels that doesn't hold its ends; a curve through other slopes
// (it differs from the reference by more than a code on this data); a quad in another corner order or in frame uv.
import { describe, expect, it } from 'vitest';
import {
  AC, ONE, PACK_DIR, TIMEOUT, at, buildLine, codes, document, fx, group, item, layersCall, listProblems, mainLayer, opId, packOperators, rect, requireGpu, runGpu, useBin, useDir,
  type Drawn, type Floats, type JsonObject, type JsonValue,
} from './helpers.ts';
import { drawnCorners, monotone, type Pt } from './measures.ts';

const ID = AC[2];
const gpu = useBin('deep-gpu');
const dir = useDir();

/** Fritsch and Carlson's nine points, with the published values of their interpolant at eleven abscissae. */
const PUBLISHED: Pt[] = [[7.99, 0], [8.09, 0.27643e-4], [8.19, 0.4375e-1], [8.7, 0.16918], [9.2, 0.46943], [10, 0.94374], [12, 0.99864], [15, 0.99992], [20, 0.99999]];
const PUBLISHED_AT = [7.99, 9.191, 10.392, 11.593, 12.794, 13.995, 15.196, 16.397, 17.598, 18.799, 20];
const PUBLISHED_IS = [0, 0.464, 0.9645, 0.9965, 0.9992, 0.9998, 0.9999, 1, 1, 1, 1];

/** The curve: a flat toe, a steep middle, a shoulder; a cubic through other slopes leaves the reference by codes. */
const POINTS: Pt[] = [[0, 0.05], [0.2, 0.12], [0.45, 0.5], [0.7, 0.62], [1, 0.95]];
const LEVELS = { in_black: 0.2, in_white: 0.8, out_black: 0.1, out_white: 0.9 };
const RAMP = { size: [288, 96] as const, box: [16, 16, 256, 64] as const };
const rampDoc = (id: string, passes: JsonValue[]): JsonObject => document(id, RAMP.size, [
  group('graded', 'a1', passes),
  item('ramp', 'rect@1', 'a2', { box: [...RAMP.box], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'black' }, { at: 1, role: 'white' }] } } } }, { parent: 'graded' }),
]);

const PIN = { size: [256, 160] as const, box: [48, 32, 160, 96] as const, quad: [[0.125, 0.25], [0.875, 0.125], [0.75, 0.875], [0.25, 0.75]] as Pt[] };
const pinDoc = (id: string, passes: JsonValue[]): JsonObject => document(id, PIN.size, [group('pinned', 'a1', passes), rect('card', 'a2', PIN.box, 'accent', 1, { parent: 'pinned' })]);
/** The quad's corners in the frame's px. */
const CORNERS: Pt[] = PIN.quad.map(([u, v]): Pt => [PIN.box[0] + u * PIN.box[2], PIN.box[1] + v * PIN.box[3]]);

/** A ramp's texels against the reference through `pts`, the inputs read from the same ramp with no pass. */
function rampProblems(name: string, got: Floats, input: Floats, pts: Pt[]): string[] {
  const ref = monotone(pts);
  const found: string[] = []; const inputs = new Set<number>(); let moved = 0; let texels = 0; let lo = 1; let hi = 0;
  for (let y = RAMP.box[1] + 1; y < RAMP.box[1] + RAMP.box[3] - 1; y++) for (let x = RAMP.box[0] + 1; x < RAMP.box[0] + RAMP.box[2] - 1; x++) {
    const v = fx(input, x, y); const g = fx(got, x, y);
    const want = [ref(v[0]), ref(v[1]), ref(v[2]), v[3]];
    texels++; inputs.add(Math.round(v[0] * 1023)); lo = Math.min(lo, v[0]); hi = Math.max(hi, v[0]);
    if (codes(want[0]!, v[0]) > 8) moved++;
    const worst = Math.max(...want.map((w, i) => codes(g[i]!, w)));
    if (worst > ONE && found.length < 6) found.push(`${name}: (${x}, ${y}) reads ${at(g)}; its input ${at(v)} through the reference is ${at(want)}, ${worst.toFixed(2)} codes away`);
  }
  if (inputs.size < 200 || lo > 0.02 || hi < 0.98) found.push(`${name}: the ramp with no pass holds ${inputs.size} inputs from ${lo.toFixed(3)} to ${hi.toFixed(3)}; the fixture needs 200 or more across 0 to 1`);
  if (moved < texels / 2) found.push(`${name}: the reference moves ${moved} of ${texels} texels by more than 8 codes; the fixture doesn't try`);
  return found;
}

/** The drawn quad's corners against `want`, each within 0.5 px. */
function cornerProblems(im: Floats, want: Pt[]): string[] {
  const { corners, problems } = drawnCorners(im, want);
  if (problems.length) return problems;
  return corners.flatMap((c, k) => {
    const miss = Math.hypot(c[0] - want[k]![0], c[1] - want[k]![1]);
    return miss <= 0.5 ? [] : [`corner ${k}: the drawn quad's corner is at (${c[0].toFixed(2)}, ${c[1].toFixed(2)}), ${miss.toFixed(2)} px from quad[${k}] at ${at(want[k]!)}`];
  });
}

describe(`${ID} levels and curves through spline, corner_pin through homography`, () => {
  it(`${ID} a grey ramp under fx.curves@1 and under fx.levels@1 reads the monotone cubic through their points within one 10-bit code at every texel, and fx.corner_pin@1 puts its bounds' corners within 0.5 px of its quad's`, () => {
    // The reference reproduces Fritsch and Carlson's published data before anything is judged against it.
    const published = monotone(PUBLISHED);
    expect(PUBLISHED_AT.map((x, i) => Math.abs(published(x) - PUBLISHED_IS[i]!)).filter((e) => e > 5e-5), 'the f64 reference reproduces the published values within 5e-5').toEqual([]);
    // The quad moves every corner by 10 px or more, so a pass that does nothing misses.
    const bounds: Pt[] = [[PIN.box[0], PIN.box[1]], [PIN.box[0] + PIN.box[2], PIN.box[1]], [PIN.box[0] + PIN.box[2], PIN.box[1] + PIN.box[3]], [PIN.box[0], PIN.box[1] + PIN.box[3]]];
    expect(CORNERS.every((c, k) => Math.hypot(c[0] - bounds[k]![0], c[1] - bounds[k]![1]) > 10), 'each quad corner is over 10 px from the bounds\' corner').toBe(true);
    const needed = ['levels', 'curves', 'corner_pin'].map(opId);
    expect(listProblems(packOperators()).filter((p) => needed.some((id) => p.includes(id))), 'the pack holds fx.levels@1, fx.curves@1 and fx.corner_pin@1').toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');

    const out = dir();
    const pass = (op: string, params: JsonObject): JsonValue[] => [{ op, params, grow: 0 }];
    const ran = runGpu(gpu().bin, out, [
      layersCall(rampDoc('ramp-plain', [])), layersCall(rampDoc('ramp-curves', pass(opId('curves'), { points: POINTS }))), layersCall(rampDoc('ramp-levels', pass(opId('levels'), LEVELS))),
      layersCall(pinDoc('pin-plain', [])), layersCall(pinDoc('pin-pinned', pass(opId('corner_pin'), { quad: PIN.quad }))),
    ]);
    expect(ran.problem, `deep-gpu draws the five figures (packs: ${PACK_DIR})`).toBe('');
    const [plain, curves, levels] = [0, 1, 2].map((i) => mainLayer(out, ran.replies[i], RAMP.size, ['the ramp', 'the ramp under fx.curves@1', 'the ramp under fx.levels@1'][i]!)) as [Drawn | string, Drawn | string, Drawn | string];
    const [card, pinned] = [3, 4].map((i) => mainLayer(out, ran.replies[i], PIN.size, ['the card', 'the card under fx.corner_pin@1'][i - 3]!)) as [Drawn | string, Drawn | string];
    const found: string[] = [];
    for (const d of [plain, curves, levels, card, pinned]) if (typeof d === 'string') found.push(d);
    if (typeof plain !== 'string' && typeof curves !== 'string') found.push(...rampProblems('fx.curves@1', curves.floats, plain.floats, POINTS));
    if (typeof plain !== 'string' && typeof levels !== 'string') found.push(...rampProblems('fx.levels@1', levels.floats, plain.floats, [[LEVELS.in_black, LEVELS.out_black], [LEVELS.in_white, LEVELS.out_white]]));
    if (typeof card !== 'string' && typeof pinned !== 'string') {
      // The measure finds the bounds' own corners on the card with no pass, so it reads what it says it reads.
      found.push(...cornerProblems(card.floats, bounds).map((p) => `the card with no pass (the measure's own check): ${p}`));
      found.push(...cornerProblems(pinned.floats, CORNERS).map((p) => `fx.corner_pin@1: ${p}`));
    }
    expect(found, found.slice(0, 20).join('\n  ')).toEqual([]);
  }, TIMEOUT);
});
