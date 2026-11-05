// AC4 #428.f0dfcbc8: A black dielectric sphere of ior 1.5 and roughness 0.3 with specular_color [1, 0, 0], lit only by a
// sun behind the camera, reflects it at its center in red within 1% of a CPU reference of the lobe and in green and blue
// at 0 within 1 code value, as KHR_materials_specular gives at normal incidence, where a planted lobe that ignores the
// color reflects all three alike and fails; and black dielectric spheres of ior 1.5 with iridescence weight 1 and ior
// 1.3 at 100, 200, 300, 400 and 500 nm match a CPU reference of the thin-film Fresnel that KHR_materials_iridescence
// specifies within 1% at 8 view angles, where a planted lobe that ignores thickness gives the five one color and fails,
// each naming the material.
//
// Test 1: `red_specular` (base color black, ior 1.5, roughness 0.3, specular_color [1, 0, 0]) on #422's sphere fixture
// (radius 1, 6 m away, fov 30° on 320 × 320) under a π lx sun shining along the view: the mean of its 2 × 2 centre
// pixels in red within 1% of the mean of `reference.ts`'s compensated lobe at those pixels' rays (F0 = 0.04 × [1, 0, 0]
// at v·h = 1); green and blue in the final target at most 1 code value. `--planted specular_color_ignored` fails naming
// `red_specular`.
// Test 2: five balls of radius 1 in a row, 2.4 m apart (`film_100` … `film_500`: base color black, ior 1.5, roughness 0.2,
// iridescence {weight 1, ior 1.3, thickness}), orthographic at 160 px/m, under one π lx sun at a time, turned 2θ from
// the view for θ = 0°, 10°, … 70°, so the view angle at the mirror point (n = h) is θ: on each ball, at the pixel where
// the CPU's lobe peaks, every channel within 1% of `reference.ts`'s lobe with KHR_materials_iridescence's thin-film
// Fresnel at v·h (Belcour and Barla's, rgb_mix). The five references differ from each other by more than 2% somewhere,
// so a renderer that gives them one color can't pass. `--planted iridescence_ignores_thickness` fails naming a film.
// Wrong programs: the base (specular color read but no iridescence); a color that tints f90 as well as F0 at normal
// incidence, or none; a film evaluated at the wrong angle, thickness or IOR, or by a Fresnel that isn't the film's.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, PLAIN_LOOK, SPHERE_CAM, ball, drawSpheres, failsNaming, frameAt, framesOf, material, none, orthoCamera, px, readLinear, requireMetal,
  runGpu, sessionDoc, sphereDoc, sun, useDir, useGpu, view3dCall, writeJson, type GpuPlanted, type JsonObject,
} from './helpers.ts';
import { LOBES, brdfCos, hitSphere, onb, orthoPoint, pixelRay, rad, unit, type Lobes, type Ortho, type Rgb, type V3 } from './reference.ts';

const ID = AC[4];
const bin = useGpu();
const dir = useDir();
const E = Math.PI;

/** The lobe at a sphere's surface point for view `v` and light `l` (the ball's frame: n and an orthonormal pair). */
function lobeAt(m: Lobes, c: V3, p: V3, v: V3, l: V3): Rgb {
  const n = unit([p[0] - c[0], p[1] - c[1], p[2] - c[2]]); const [t, b] = onb(n);
  return brdfCos(m, { n, t, b }, v, l).map((x) => x * E) as Rgb;
}

function redSpecular(planted?: GpuPlanted): string[] {
  const out = dir();
  const [d] = drawSpheres(bin(), out, [{ name: 'red_specular', doc: sphereDoc('red_specular', { base_color: [0, 0, 0, 1], metallic: 0, roughness: 0.3, ior: 1.5, specular_color: [1, 0, 0] }, DARK_SKY, sun(E, [0, 0, 0])) }], planted);
  const m: Lobes = { ...LOBES, base: [0, 0, 0], roughness: 0.3, specularColor: [1, 0, 0] };
  const centre: [number, number][] = [[159, 159], [160, 159], [159, 160], [160, 160]];
  const ref: Rgb = [0, 0, 0]; const got: Rgb = [0, 0, 0];
  for (const [x, y] of centre) {
    const dir3 = pixelRay(SPHERE_CAM, x, y); const p = hitSphere(SPHERE_CAM.position, dir3, [0, 0, 0], 1)!;
    const r = lobeAt(m, [0, 0, 0], p, [-dir3[0], -dir3[1], -dir3[2]], [0, 0, 1]);
    const g = d!.linear.at(x, y);
    for (let c = 0; c < 3; c++) { ref[c] = ref[c]! + r[c]! / 4; got[c] = got[c]! + g[c]! / 4; }
  }
  const codes = centre.map(([x, y]) => px(d!.final, x, y));
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: red_specular's centre reads ${got.map((v) => v.toFixed(5)).join(', ')}, the reference ${ref.map((v) => v.toFixed(5)).join(', ')}; codes ${codes.map((c) => c.join('/')).join(' ')}`);
  const failures: string[] = [];
  if (!(Math.abs(got[0] - ref[0]) <= 0.01 * ref[0])) failures.push(`red_specular: its centre reflects red at ${got[0].toFixed(5)}, not within 1% of the reference ${ref[0].toFixed(5)}`);
  for (const [c, name] of [[1, 'green'], [2, 'blue']] as const) {
    const worst = Math.max(...codes.map((k) => k[c]!));
    if (worst > 1) failures.push(`red_specular: its centre reflects ${name} at ${worst} code values, not 0 within 1`);
  }
  return failures;
}

const THICK = [100, 200, 300, 400, 500];
const ANGLES = [0, 10, 20, 30, 40, 50, 60, 70];
const FILMS: Ortho = { target: [0, 0, 0], viewWidth: 12, size: [1920, 384] };
const centreOf = (k: number): V3 => [(k - 2) * 2.4, 0, 0];
function filmsDoc(theta: number): JsonObject {
  const items: Record<string, JsonObject> = { cam: orthoCamera(FILMS), sky: DARK_SKY, sun: sun(E, [0, 2 * theta, 0]) };
  THICK.forEach((t, k) => {
    items[`film_${t}`] = material({ base_color: [0, 0, 0, 1], metallic: 0, roughness: 0.2, ior: 1.5, iridescence: { weight: 1, ior: 1.3, thickness: t } });
    items[`ball_${t}`] = ball(1, centreOf(k), `film_${t}`);
  });
  return sessionDoc(`films-${theta}`, FILMS.size, items);
}
function films(planted?: GpuPlanted): string[] {
  const out = dir();
  const replies = runGpu(bin(), out, ANGLES.map((a) => view3dCall({ doc: writeJson(out, `films-${a}`, filmsDoc(a)), look: PLAIN_LOOK, size: FILMS.size, targets: ['linear'] })), planted);
  const failures: string[] = [];
  const v: V3 = [0, 0, 1];
  ANGLES.forEach((theta, i) => {
    const lin = readLinear(out, frameAt(framesOf(replies[i]!, `θ ${theta}°`), 0, `θ ${theta}°`).linear, FILMS.size, `θ ${theta}°`);
    const l: V3 = [Math.sin(rad(2 * theta)), 0, Math.cos(rad(2 * theta))];
    const refs: Rgb[] = [];
    THICK.forEach((t, k) => {
      const c = centreOf(k);
      const m: Lobes = { ...LOBES, base: [0, 0, 0], roughness: 0.2, iridescence: { weight: 1, ior: 1.3, thickness: t } };
      // The mirror point n = h, and the pixel round it where the CPU's lobe peaks.
      const h = unit([l[0] + v[0], l[1] + v[1], l[2] + v[2]]);
      const k0 = (FILMS.size[0] / FILMS.viewWidth);
      const cx = FILMS.size[0] / 2 + (c[0] + h[0]) * k0; const cy = FILMS.size[1] / 2 - h[1] * k0;
      let best: { x: number; y: number; ref: Rgb } | null = null;
      for (let y = Math.floor(cy) - 3; y <= Math.floor(cy) + 3; y++) for (let x = Math.floor(cx) - 3; x <= Math.floor(cx) + 3; x++) {
        const o = orthoPoint(FILMS, x + 0.5, y + 0.5, 50);
        const p = hitSphere(o, [0, 0, -1], c, 1);
        if (!p) continue;
        const r = lobeAt(m, c, p, v, l);
        if (!best || r[0] + r[1] + r[2] > best.ref[0] + best.ref[1] + best.ref[2]) best = { x, y, ref: r };
      }
      expect(best, `film_${t} at θ ${theta}°: the mirror point is on the ball`).not.toBeNull();
      refs.push(best!.ref);
      const got = lin.at(best!.x, best!.y);
      const off = Math.max(...[0, 1, 2].map((ch) => Math.abs(got[ch]! - best!.ref[ch]!) / Math.max(best!.ref[ch]!, 1e-6)));
      if (off > 0.01) failures.push(`film_${t}: at view angle ${theta}° its mirror point (${best!.x}, ${best!.y}) reads ${got.map((x) => x.toFixed(4)).join(', ')}, the thin-film reference ${best!.ref.map((x) => x.toFixed(4)).join(', ')} (${(off * 100).toFixed(1)}% off)`);
    });
    if (theta === 0) {
      const spread = Math.max(...refs.flatMap((a) => refs.map((b) => Math.max(...[0, 1, 2].map((ch) => Math.abs(a[ch]! - b[ch]!) / Math.max(a[ch]!, b[ch]!, 1e-6))))));
      expect(spread, 'the five films\' references differ by more than 2% (so one color for all five fails)').toBeGreaterThan(0.02);
    }
  });
  return failures;
}

describe(`${ID} specular color and the thin film`, () => {
  it(`${ID} a black sphere with specular_color [1, 0, 0] reflects a sun behind the camera at its centre in red within 1% of the CPU lobe and in green and blue at 0 within 1 code value; a planted lobe that ignores the color fails, naming the material`, () => {
    requireMetal();
    none(redSpecular(), 'the red specular sphere');
    failsNaming(redSpecular('specular_color_ignored'), ['red_specular'], '--planted specular_color_ignored');
  }, 3_600_000);

  it(`${ID} films of 100 to 500 nm match KHR_materials_iridescence's thin-film Fresnel within 1% at 8 view angles; a planted film that ignores thickness fails, naming the material`, () => {
    requireMetal();
    none(films(), 'the five films at eight angles');
    failsNaming(films('iridescence_ignores_thickness'), ['film_'], '--planted iridescence_ignores_thickness');
  }, 3_600_000);
});
