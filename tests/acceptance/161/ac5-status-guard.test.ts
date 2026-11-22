// AC5 #161.8352d648: Wherever status can show, no fx@1 output ends within the look's status distance of a status color.
//
// A fixture that tries, once per operator. The picture a group holds is three bands, each a gradient between two data
// roles that sit 0.11 to 0.12 OKLab lighter and darker than a status color (fail, pass, running), so the look's own
// check admits every role while most of each band's length passes within the look's distance, 0.10, of that status
// color. The group's one pass names the operator at its defaults; an opaque ground lies under it, so every pixel of
// the layer's PNG is the color that shows. The document binds one status mark (`gate`, in state fail), so status can
// show and the status guard applies (design: Status guard; The status-color rule).
//
// Each of the 70 is drawn by `layers` (#385's call) under that look. In each drawing, every pixel outside the status
// mark's own box (grown by 2 px) keeps at least 0.10 − 0.005 OKLab from every status color (0.005: the most an 8-bit
// rounding moves a guarded pixel, #382's reading). One more drawing passes the picture through untouched,
// `fx.invert@1 {amount: 0}`, so at least one pass writes the very pixels that try. That the fixture tries is shown on
// the same picture with no pass and no binding, an art film on its own, which no guard touches: 200 or more of its
// pixels lie within the distance.
//
// Wrong programs: the base (53 of the operators are unknown to it); an operator whose output skips the guard.
import { describe, expect, it } from 'vitest';
import {
  AC, ALL, PACK_DIR, STATUS_COLORS, STATUS_DISTANCE, TIMEOUT, buildLine, deltaE, document, group, isObject, item, listProblems, look1, oklab, packOperators, pngOf, px8, rect, refusal,
  requireGpu, runGpu, shown, useBin, useDir, type Image, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = AC[5];
const gpu = useBin('deep-gpu');
const dir = useDir();
const SIZE = [208, 96] as const;
const GATE = { box: [188, 4, 16, 10] as const, verdict: 'verdict:01JB1610000000000000000161' };
/** Each band's two roles: lighter and darker than its status color by 0.11 to 0.12 OKLab, along lightness. */
const BANDS: { state: string; hi: [number, number, number]; lo: [number, number, number] }[] = [
  { state: 'fail', hi: [234, 80, 78], lo: [145, 0, 0] },
  { state: 'pass', hi: [58, 153, 77], lo: [0, 81, 0] },
  { state: 'running', hi: [54, 136, 224], lo: [0, 63, 145] },
];
const ROLES = Object.fromEntries(BANDS.flatMap((b) => [[`${b.state}_hi`, b.hi], [`${b.state}_lo`, b.lo]])) as Record<string, [number, number, number]>;
const LOOK = look1('tries-161', ROLES, true);
const STATUS = Object.entries(STATUS_COLORS).map(([state, h]) => ({ state, lab: oklab([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))) }));
/** The nearest status color to an 8-bit color, and how far it is. */
function nearest(rgb: readonly number[]): { state: string; d: number } {
  const lab = oklab(rgb);
  return STATUS.map((s) => ({ state: s.state, d: deltaE(lab, s.lab) })).sort((a, b) => a.d - b.d)[0]!;
}
/** The 8-bit rounding of a guarded pixel can move it this much (README: Readings). */
const QUANT = 0.005;

function figure(id: string, passes: JsonValue[] | null, bound: boolean): JsonObject {
  const items: JsonObject[] = [rect('floor', 'a0', [0, 0, SIZE[0], SIZE[1]], 'ground')];
  items.push(group('fx', 'a1', passes ?? []));
  BANDS.forEach((b, k) => items.push(item(`band${k}`, 'rect@1', `a${k + 2}`, {
    box: [8, 12 + 24 * k, 144, 24], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: `${b.state}_hi` }, { at: 1, role: `${b.state}_lo` }] } } },
  }, { parent: 'fx' })));
  if (!bound) return document(id, SIZE, items, { profile: 'board' });
  items.push(item('gate', 'rect@1', 'a9', { box: [...GATE.box] }));
  return document(id, SIZE, items, { profile: 'board', status_bindings: { 'gate-state': { target: 'items/gate/params/paint/fill', source: GATE.verdict } } });
}
const call = (doc: JsonObject, bound: boolean): JsonObject => ({ call: 'layers', doc, look: LOOK, by: ['gpu_layer'], packs: [PACK_DIR], ...(bound ? { states: { [GATE.verdict]: 'fail' } } : {}) });
/** Layer main's PNG from a `layers` reply, or why there is none. */
function pictureOf(out: string, reply: JsonObject | undefined, what: string): Image | string {
  const refused = refusal(reply, what);
  if (refused) return refused;
  const layer = (Array.isArray(reply!['layers']) ? reply!['layers'] : []).filter(isObject).find((l) => l['layer'] === 'main');
  const side = isObject(layer?.['drawn']) && isObject(layer['drawn']['gpu_layer']) ? layer['drawn']['gpu_layer'] : undefined;
  if (!side || side['code'] !== undefined) return `${what}: the GPU layer drew no layer main: ${shown(layer ?? reply, 400)}`;
  const png = pngOf(out, side['png']);
  return typeof png === 'string' ? `${what}: ${png}` : png;
}
/** The pixels within `limit` of a status color, outside the status mark's own box grown by 2 px. */
function clashes(im: Image, limit: number): { n: number; first: string } {
  let n = 0; let first = '';
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    if (x >= GATE.box[0] - 2 && x < GATE.box[0] + GATE.box[2] + 2 && y >= GATE.box[1] - 2 && y < GATE.box[1] + GATE.box[3] + 2) continue;
    const p = px8(im, x, y);
    if (p[3] === 0) continue;
    const near = nearest(p);
    if (near.d < limit) { n++; first ||= `(${x}, ${y}) is (${p.slice(0, 3).join(', ')}), ${near.d.toFixed(3)} from ${near.state}`; }
  }
  return { n, first };
}

describe(`${ID} fx@1 under the status guard`, () => {
  it(`${ID} on a fixture that tries, where status can show, no pixel any of the 70 operators writes ends within 0.10 OKLab of a status color`, () => {
    // The look's data roles keep the distance, and the bands between them don't: the fixture is legal and it tries.
    for (const b of BANDS) for (const role of [b.hi, b.lo]) expect(nearest(role).d, `the data role (${role.join(', ')}) keeps the status distance`).toBeGreaterThanOrEqual(STATUS_DISTANCE);
    for (const b of BANDS) {
      const mid = b.hi.map((v, i) => Math.round((v + b.lo[i]!) / 2));
      expect(nearest(mid), `the middle of the ${b.state} band is within the distance of ${b.state}`).toMatchObject({ state: b.state });
      expect(nearest(mid).d, `the middle of the ${b.state} band`).toBeLessThan(STATUS_DISTANCE / 2);
    }
    expect(listProblems(packOperators()), 'packs/fx-1.0.0 holds the issue\'s 69 operators and fx.slice_shift@1, each by its ID').toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');

    const out = dir();
    const cases: { name: string; passes: JsonValue[] }[] = [
      ...ALL.map((op) => ({ name: op, passes: [{ op, params: {} }] as JsonValue[] })),
      { name: 'fx.invert@1 at amount 0 (the picture passed through)', passes: [{ op: 'fx.invert@1', params: { amount: 0 } }] },
    ];
    const ran = runGpu(gpu().bin, out, [call(figure('tries-alone', null, false), false), ...cases.map((c, i) => call(figure(`tries-${i}`, c.passes, true), true))]);
    expect(ran.problem, 'deep-gpu draws the fixture once per operator').toBe('');

    const alone = pictureOf(out, ran.replies[0], 'the picture on its own, with no pass and no binding');
    expect(typeof alone, `the picture on its own draws: ${typeof alone === 'string' ? alone : ''}`).toBe('object');
    const tries = clashes(alone as Image, STATUS_DISTANCE);
    expect(tries.n, 'the fixture tries: on its own, 200 or more of its pixels lie within the distance of a status color').toBeGreaterThanOrEqual(200);

    const found: string[] = [];
    cases.forEach((c, i) => {
      const im = pictureOf(out, ran.replies[i + 1], c.name);
      if (typeof im === 'string') { found.push(im); return; }
      const hit = clashes(im, STATUS_DISTANCE - QUANT);
      if (hit.n > 0) found.push(`${c.name}: ${hit.n} pixels end within the status distance of a status color; first ${hit.first}`);
    });
    expect(found, `${found.length} findings:\n  ${found.slice(0, 30).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
