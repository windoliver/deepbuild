// #465.e0d48d0f: "With `streak: {count: 4, length: 0.25}` on a point light of linear radiance 50 at the centre of a
// 1920 × 1080 frame, the four arms lie at 0°, 90°, 180° and 270° within 1° and each reaches 480 ± 4 px where it falls
// below 1% of its peak; with `streak: {count: 2, anamorphic: true}` the arms are horizontal and the vertical spread
// stays within 2 px of the light's. `starburst: {blades: 6}` gives six spikes at 60° steps within 1°"
//
// The fixture (1920 × 1080, fov 40° across the width): a black room, the camera at z = 20 looking down −Z, and the light
// `key-light` (radius 0.05 m, radiance 50, so its disc is about 6.6 px in radius) at the origin, the frame's centre
// (960, 540). Three flares, each alone: `streak: {count: 4, length: 0.25}`; `streak: {count: 2, length: 0.25,
// anamorphic: true}` (the issue gives no length for it; 0.25 as above); `starburst: {blades: 6}`. The flare's own light
// is `pre_tone`'s luminance with the flare less the same room without it.
//
// Arms (README: Readings): angles counterclockwise from +x on the screen. A 1° histogram of the flare's light over an
// annulus round the light (40 to 400 px for streaks, the disc's radius + 6 to 200 px for spikes), smoothed over 3°,
// gives its peaks, at least 20° apart; each arm's angle is the light-weighted mean of a 0.1° histogram within 10° of
// its peak. There must be exactly as many arms as asked: no further peak above 10% of the weakest. An arm's reach is
// where its profile (at each radius, the brightest of the 7 points across the arm, read bilinearly) last stands at 1%
// of its peak, interpolated between pixels. The anamorphic spread is, in each column 40 to 400 px either side of the
// light, the rows from the first to the last at 1% of the arms' peak; its widest must stay within 2 px over the light's
// own projected disc, 2 × 6.6 px. Wrong programs: arms turned or of the wrong count, a length off the frame's width,
// anamorphic streaks that spread vertically, a starburst with the wrong count or spacing.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, DARK_SKY, type Flare, type JsonObject, type Lum, camItem, discPx, flare, frameAt, framesOf, look3d, minus, none, pointLight, readLum,
  requireGpu, runGpu, sceneDoc, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [1920, 1080];
const CAM: Cam = { position: [0, 0, 20], target: [0, 0, 0], fov: 40, size: SIZE };
const LOOK = look3d('streaks-465');
const DISC = discPx(CAM, 20);
const CX = SIZE[0] / 2; const CY = SIZE[1] / 2;
const CASES: [string, Flare | null][] = [
  ['plain', null],
  ['streak4', { streak: { count: 4, length: 0.25, anamorphic: false } }],
  ['anamorphic', { streak: { count: 2, length: 0.25, anamorphic: true } }],
  ['starburst', { starburst: { blades: 6 } }],
];

const at = (f: Lum, x: number, y: number): number => {
  const fx = x - 0.5; const fy = y - 0.5; const x0 = Math.floor(fx); const y0 = Math.floor(fy); const tx = fx - x0; const ty = fy - y0;
  const v = (i: number, j: number): number => (i < 0 || j < 0 || i >= f.width || j >= f.height ? 0 : f.y[j * f.width + i]!);
  return (1 - ty) * ((1 - tx) * v(x0, y0) + tx * v(x0 + 1, y0)) + ty * ((1 - tx) * v(x0, y0 + 1) + tx * v(x0 + 1, y0 + 1));
};
const angleOf = (x: number, y: number): number => ((Math.atan2(-(y + 0.5 - CY), x + 0.5 - CX) * 180) / Math.PI + 360) % 360;
const gap = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

/** The arms' angles (exactly `count` of them, or failures naming what else was found), counterclockwise from +x. */
function arms(f: Lum, count: number, inner: number, outer: number, what: string): { angles: number[]; failures: string[] } {
  const fine = new Float64Array(3600);
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
    const r = Math.hypot(x + 0.5 - CX, y + 0.5 - CY); const w = f.y[y * f.width + x]!;
    if (r >= inner && r <= outer && w > 0) { const b = Math.floor(angleOf(x, y) * 10) % 3600; fine[b] = fine[b]! + w; }
  }
  const coarse = Array.from({ length: 360 }, (_, d) => fine.slice(d * 10, d * 10 + 10).reduce((s, v) => s + v, 0));
  const smooth = coarse.map((_, d) => coarse[(d + 359) % 360]! + coarse[d]! + coarse[(d + 1) % 360]!);
  const maxima = smooth.map((v, d) => ({ d, v })).filter(({ d, v }) => v > 0 && v >= smooth[(d + 359) % 360]! && v > smooth[(d + 1) % 360]!).sort((a, b) => b.v - a.v);
  const picked: { d: number; v: number }[] = [];
  for (const m of maxima) if (picked.every((p) => gap(p.d, m.d) >= 20)) picked.push(m);
  const failures: string[] = [];
  if (picked.length < count) return { angles: [], failures: [`${what}: ${picked.length} arms found, not ${count}`] };
  const weakest = Math.min(...picked.slice(0, count).map((p) => p.v));
  for (const extra of picked.slice(count)) if (extra.v > 0.1 * weakest) failures.push(`${what}: an arm beyond the ${count} at about ${extra.d}°`);
  const angles = picked.slice(0, count).map((p) => {
    let sx = 0; let sy = 0;
    for (let k = -100; k <= 100; k++) { const b = (p.d * 10 + 5 + k + 3600) % 3600; const a = ((b + 0.5) / 10) * (Math.PI / 180); sx += fine[b]! * Math.cos(a); sy += fine[b]! * Math.sin(a); }
    return ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  }).sort((a, b) => a - b);
  return { angles, failures };
}
/** Where the arm at `angle` last stands at 1% of its peak, in px from the light, and that peak. */
function reach(f: Lum, angle: number): { reach: number; peak: number } {
  const a = (angle * Math.PI) / 180; const dx = Math.cos(a); const dy = -Math.sin(a);
  const toX = Math.abs(dx) > 1e-9 ? (dx > 0 ? SIZE[0] - CX : CX) / Math.abs(dx) : Infinity;
  const toY = Math.abs(dy) > 1e-9 ? (dy > 0 ? SIZE[1] - CY : CY) / Math.abs(dy) : Infinity;
  const limit = Math.floor(Math.min(toX, toY)) - 2;
  const p = Array.from({ length: limit + 1 }, (_, r) => Math.max(...[-3, -2, -1, 0, 1, 2, 3].map((o) => at(f, CX + r * dx - o * dy, CY + r * dy + o * dx))));
  const peak = Math.max(...p); const floor = 0.01 * peak;
  let last = -1;
  for (let r = 0; r <= limit; r++) if (p[r]! >= floor) last = r;
  if (last < 0 || last >= limit) return { reach: last, peak };
  return { reach: last + (p[last]! - floor) / (p[last]! - p[last + 1]!), peak };
}

describe(`${AC[7]} streak and starburst geometry`, () => {
  it(`${AC[7]} four arms at 0°, 90°, 180° and 270° within 1°, each reaching 480 ± 4 px; anamorphic arms horizontal, spreading within 2 px of the light; six spikes at 60° steps within 1°`, () => {
    requireGpu();
    const dir = out();
    const replies = runGpu(bin(), dir, CASES.map(([name, f]) => {
      const items: Record<string, JsonObject> = { cam: camItem(CAM), sky: DARK_SKY, 'key-light': pointLight([0, 0, 0], 50) };
      if (f) items['flare'] = flare(f);
      return view3d({ doc: writeJson(dir, name, sceneDoc(`streaks-${name}`, SIZE, items)), look: LOOK, size: SIZE, frames: 1, capture: [0], targets: ['pre_tone'] });
    }));
    const [plain, streak4, anamorphic, starburst] = replies.map((r, i) => readLum(dir, frameAt(framesOf(r, CASES[i]![0]), 0, CASES[i]![0]), 'pre_tone', SIZE, CASES[i]![0]));
    const failures: string[] = [];

    const four = arms(minus(streak4!, plain!), 4, 40, 400, 'count 4');
    failures.push(...four.failures);
    four.angles.forEach((angle, k) => {
      const want = [0, 90, 180, 270].reduce((best, w) => (gap(angle, w) < gap(angle, best) ? w : best), 0);
      if (gap(angle, want) > 1) failures.push(`count 4: arm ${k + 1} lies at ${angle.toFixed(2)}°, not within 1° of ${want}°`);
      const { reach: r } = reach(minus(streak4!, plain!), angle);
      console.log(`${AC[7]}: count 4, arm at ${angle.toFixed(2)}° reaches ${r.toFixed(2)} px`);
      if (Math.abs(r - 480) > 4) failures.push(`count 4: the arm at ${angle.toFixed(2)}° falls below 1% of its peak at ${r.toFixed(2)} px, not 480 ± 4`);
    });
    if (new Set(four.angles.map((a) => Math.round(a / 90) % 4)).size !== 4 && four.angles.length === 4) failures.push(`count 4: the arms ${four.angles.map((a) => a.toFixed(1)).join(', ')} aren't one at each of 0°, 90°, 180° and 270°`);

    const flat = minus(anamorphic!, plain!);
    const two = arms(flat, 2, 40, 400, 'anamorphic');
    failures.push(...two.failures);
    if (two.angles.length === 2 && !(two.angles.some((a) => gap(a, 0) <= 1) && two.angles.some((a) => gap(a, 180) <= 1))) failures.push(`anamorphic: the arms lie at ${two.angles.map((a) => a.toFixed(2)).join('° and ')}°, not horizontal within 1°`);
    const armPeak = Math.max(...two.angles.map((a) => reach(flat, a).peak), 0);
    let spread = 0;
    for (let x = 0; x < SIZE[0]; x++) {
      const off = Math.abs(x + 0.5 - CX); if (off < 40 || off > 400) continue;
      let top = -1; let bottom = -1;
      for (let y = 0; y < SIZE[1]; y++) if (flat.y[y * SIZE[0] + x]! >= 0.01 * armPeak) { if (top < 0) top = y; bottom = y; }
      if (top >= 0) spread = Math.max(spread, bottom - top + 1);
    }
    console.log(`${AC[7]}: anamorphic vertical spread ${spread} px; the light's disc ${(2 * DISC).toFixed(2)} px`);
    if (spread > 2 * DISC + 2) failures.push(`anamorphic: the streak spreads ${spread} px vertically, more than 2 px over the light's ${(2 * DISC).toFixed(2)} px`);

    const six = arms(minus(starburst!, plain!), 6, DISC + 6, 200, 'starburst 6');
    failures.push(...six.failures);
    six.angles.forEach((a, k) => {
      const next = six.angles[(k + 1) % 6]!; const step = (next - a + 360) % 360;
      if (Math.abs(step - 60) > 1) failures.push(`starburst 6: the spikes at ${a.toFixed(2)}° and ${next.toFixed(2)}° are ${step.toFixed(2)}° apart, not 60° within 1°`);
    });
    console.log(`${AC[7]}: count 4 at ${four.angles.map((a) => a.toFixed(2)).join(', ')}; anamorphic at ${two.angles.map((a) => a.toFixed(2)).join(', ')}; spikes at ${six.angles.map((a) => a.toFixed(2)).join(', ')}`);
    none(failures, 'streak and starburst geometry');
    expect(six.angles.length, 'six spikes').toBe(6);
  });
});
