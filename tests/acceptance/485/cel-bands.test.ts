// AC2 #485.f339bc40: Cel bands follow the scene's lights: a sphere under one sun at 45° elevation, shadows on, with a
// post whose shadow crosses its lit side, whose light response returns base_color × radiance × min(floor(3 ×
// max(dot(n, l), 0) × shadow), 2) ÷ 2 and whose ambient returns 0, shows exactly three linear values per channel on
// its interior pixels (those whose samples all hit the sphere) before tone mapping, read on one machine, with the
// post's shadow at the lowest; and a planted loop that hands the response a shadow of 1 leaves the post's shadow in
// upper bands and fails, naming the first such pixel.
//
// The fixture (helpers: `celDoc`, `CEL`): a 1 m sphere, base color (0.8, 0.5, 0.3), under a 2 lx sun at 45° elevation
// from the front right (`at.rot` [−45, 60, 0]), `shadow: true`, and a post 0.5 m square and 8 m tall 2.6 m from the
// sphere's centre toward the sun; a black sky; 512 × 512 from the front, the post out of frame. The sphere's operator
// `cel` writes base_color and answers with the issue's cel light and an ambient of 0. Read on the linear target
// (before exposure and the tone map) of one frame on this Mac; interior pixels are those whose 5 × 5 block shows only
// the sphere in the object-ID target (a pixel there takes any item one of its samples covers, so these pixels' samples
// all hit the sphere).
// Per channel: the three values held by the most interior pixels are 0, m and 2m (the band ÷ 2 times base_color ×
// radiance, with the ambient 0), within 0.2% of the brightest; every other interior value is a 4× resolve of two
// adjacent bands (j/4 of the way, j = 1, 2, 3: a pixel whose samples straddle a band edge), on at most 0.1% of them.
// The post's shadow (`reference.ts`: `celPixels`): interior pixels whose ray toward the sun meets the post shrunk by
// 8 cm on every side, where n · l ≥ 1/3 + 0.05 (an upper band without the shadow); each reads the lowest value.
// 1. The bands and the post's shadow at the lowest.
// 2. `--planted loop_shadow_one` (the loop hands `light` a shadow of 1): the check fails, naming the first pixel in the
//    post's shadow, in row order, that reads an upper band.
// Wrong programs: the base (no light response: the operator is refused); a loop that doesn't call the response per
// light or passes it another shadow, normal or light direction; bands smoothed or counted wrong; an ambient added.
import { describe, expect, it } from 'vitest';
import {
  AC, CEL, PLAIN_LOOK, TIMEOUT, celDoc, celPinhole, celToSun, drawFirst, failsNaming, fmtRgb, none, requireMetal, useDir, useGpu, within,
  type Frame, type Planted, type Rgb,
} from './helpers.ts';
import { celPixels } from './reference.ts';

const ID = AC[2];
const bin = useGpu();
const dir = useDir();
const CHANNELS = ['red', 'green', 'blue'] as const;

interface Group { value: number; count: number }
/** One channel's interior values: its three bands (low, middle, high) and what's wrong with them. */
function bandsOf(values: Float64Array, channel: string): { failures: string[]; low: number } {
  const sorted = Float64Array.from(values).sort();
  const top = Math.abs(sorted[sorted.length - 1] ?? 0);
  const tol = Math.max(2e-3 * top, 1e-6);
  const groups: Group[] = [];
  let first = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i]! - sorted[i - 1]! <= tol) continue;
    let sum = 0; for (let k = first; k < i; k++) sum += sorted[k]!;
    groups.push({ value: sum / (i - first), count: i - first });
    first = i;
  }
  const list = (gs: Group[]): string => gs.slice(0, 8).map((g) => `${g.value.toFixed(5)} on ${g.count} px`).join(', ') + (gs.length > 8 ? `, and ${gs.length - 8} more` : '');
  if (groups.length < 3) return { failures: [`${channel}: the sphere's interior shows ${groups.length} linear value(s), not three: ${list(groups)}`], low: groups[0]?.value ?? 0 };
  const bands = [...groups].sort((a, b) => b.count - a.count).slice(0, 3);
  const [lo, mid, hi] = bands.map((g) => g.value).sort((a, b) => a - b) as [number, number, number];
  const failures: string[] = [];
  if (Math.abs(lo) > tol) failures.push(`${channel}: the lowest band reads ${lo.toFixed(5)}, not 0 (the ambient returns 0 and nothing is emitted)`);
  if (mid <= tol || Math.abs(hi - 2 * mid) > 2 * tol) failures.push(`${channel}: the bands read ${lo.toFixed(5)}, ${mid.toFixed(5)} and ${hi.toFixed(5)}, not 0, m and 2m`);
  const mixes = [1, 2, 3].flatMap((j) => [lo + ((mid - lo) * j) / 4, mid + ((hi - mid) * j) / 4]);
  const others = groups.filter((g) => !bands.includes(g));
  const extra = others.filter((g) => !mixes.some((m) => Math.abs(g.value - m) <= tol));
  if (extra.length) failures.push(`${channel}: the sphere's interior shows more than three linear values: ${list(extra)}, besides ${lo.toFixed(5)}, ${mid.toFixed(5)} and ${hi.toFixed(5)}`);
  const mixed = others.reduce((s, g) => s + g.count, 0);
  if (mixed > 0.001 * values.length) failures.push(`${channel}: ${mixed} of ${values.length} interior pixels resolve between two bands, more than 0.1%`);
  return { failures, low: lo };
}

/** The bands on the sphere's interior and the post's shadow at the lowest; failures name the channel or the pixel. */
function celFailures(f: Frame): string[] {
  const ids = f.ids!; const lin = f.linear!;
  const [w, h] = CEL.size;
  const ref = celPixels({ cam: celPinhole(), centre: [0, 0, 0], radius: 1, toSun: celToSun(), post: CEL.post }, CEL.margin);
  const interior: { x: number; y: number; v: Rgb }[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (within(ids, 'ball', x, y, 2)) interior.push({ x, y, v: lin.at(x, y) });
  if (interior.length < 40_000) return [`only ${interior.length} interior pixels of the sphere (40,000 expected of this framing)`];
  const failures: string[] = [];
  const low: number[] = [];
  CHANNELS.forEach((name, c) => {
    const r = bandsOf(Float64Array.from(interior, (p) => p.v[c]!), name);
    failures.push(...r.failures);
    low.push(r.low);
  });
  const shade = interior.filter((p) => ref.umbra[p.y * w + p.x] === 1 && ref.ndl[p.y * w + p.x]! >= CEL.lit);
  console.log(`${ID}: ${interior.length} interior pixels; ${shade.length} of them deep in the post's shadow on the lit side; lowest bands ${fmtRgb(low)}`);
  if (shade.length < 1_000) return [...failures, `only ${shade.length} interior pixels lie deep in the post's shadow on the lit side (1,000 needed)`];
  const top = [0, 1, 2].map((c) => interior.reduce((m, p) => Math.max(m, Math.abs(p.v[c]!)), 0));
  const upper = shade.filter((p) => p.v.some((v, c) => Math.abs(v - low[c]!) > Math.max(2e-3 * top[c]!, 1e-6)));
  if (upper.length) {
    const p = upper[0]!;
    failures.push(`pixel (${p.x}, ${p.y}) in the post's shadow reads ${fmtRgb(p.v)}, above the lowest band ${fmtRgb(low)}; ${upper.length} of the ${shade.length} pixels deep in the post's shadow read an upper band`);
  }
  return failures;
}

function drawCel(planted?: Planted): Frame {
  const [f] = drawFirst(bin(), dir(), [{ name: 'the cel sphere', doc: celDoc('cel-sphere'), look: PLAIN_LOOK, size: CEL.size }], ['linear', 'ids'], planted) as [Frame];
  return f;
}

describe(`${ID} cel bands follow the scene's lights`, () => {
  it(`${ID} the sphere under its cel response shows exactly three linear values per channel on its interior pixels, with the post's shadow at the lowest`, () => {
    requireMetal();
    none(celFailures(drawCel()), 'the cel bands');
  }, TIMEOUT);

  it(`${ID} a planted loop that hands the response a shadow of 1 (--planted loop_shadow_one) leaves the post's shadow in upper bands and fails, naming the first such pixel`, () => {
    requireMetal();
    const failures = celFailures(drawCel('loop_shadow_one'));
    failsNaming(failures, ['in the post\'s shadow reads'], '--planted loop_shadow_one');
    const named = failures.find((f) => f.includes('in the post\'s shadow reads'))!;
    expect(named, 'the failure names the first such pixel').toMatch(/^pixel \(\d+, \d+\) in the post's shadow/);
    console.log(`${ID}: --planted loop_shadow_one fails: ${named}`);
  }, TIMEOUT);
});
