// AC4 #426.46bdf631: Fog takes the background's color. And the design text's refusal: `fog: background` with the froxel grid.
//
// The fixture (helpers: fogDoc): the HDR red [0.797, 0.102, 0.102] above the horizon and blue [0.102, 0.203, 0.797] below it (mantissas ÷ 256,
// exact) as the environment, no background field; `fog: background`, `fog_curve: exp`, `fog_density: 0.02` per m; tone map none at exposure scale 1;
// the linear target read. The eye is the origin, the camera (321 × 241, so its centre pixel (160, 120) holds the centre ray) aimed `elev`° above
// the horizon (−`elev` below it in the second scene) at a near sphere (radius 2, centre 52 m away, so its surface at the centre pixel is 50 m from the
// eye; checked by ray-sphere here) and, 6° to its right at the same elevation, a far sphere (radius 30, centre 1,030 m away, its surface at its own
// centre pixel 1,000 m away); a background pixel 10° to the right of the aim is the one "next to" the far sphere. Both spheres are the same rough
// dielectric (base 0.6, roughness 0.6), lit by the environment. Each scene is drawn twice: with the fog and with `fog_density: 0`, the latter giving c, the
// near sphere's value with no fog (and the far sphere's).
// For elev = 10 (above the horizon, the background there red) and elev = −10 (below, blue):
//   - the near sphere's centre pixel reads mix(c, B, 1 − e^(−1)) within 1 code of the linear target (1/255 of linear), B the background's color there;
//   - the far sphere's centre pixel matches the background pixel next to it within 1 code; that pixel itself reads B within 1 code;
//   - fixture: c is at least 8 codes from B (the fog moves the near sphere), the far sphere with no fog is at least 8 codes from B (the fog moves it
//     all the way), the ID target says near, far and nothing on the three pixels, and the ray through the near centre pixel meets its sphere 50 m
//     from the eye (within 5 cm) and the far one's 1,000 m (within 2 m).
//   - planted: a fog of the environment's mean color (half red, half blue by solid angle) misses the far sphere (it reads the mean, at least 8
//     codes from B) and the near sphere; the same judge fails on it naming the pixel (a CPU-side reference, README: Assumed surfaces 5).
// Refusal: a sky with `fog: background` and `froxels: {cells: [160, 90], slices: 64, range: 100}` is refused (the reply has a `code` and the text
// names the sky `sky`), where the same document with a fog color instead of `background`, and with `fog: background` and no froxels, are drawn.
// Wrong programs: fog in one color; fog that ignores the background's color below the horizon; a fog of the wrong curve or density; fog mixed into
// the sky; a froxel grid that takes background fog.
import { describe, expect, it } from 'vitest';
import {
  AC, BLUE, FOG, FOG_SIZE, MEAN_ENV, RED, failsNamingPixels, fogCam, fogDoc, fogPixels, fogSpheres, frameAt, framesOf, hitSphere, linOff, mix3, nearItem, none,
  rayAt, readIds, readLinear, redBluePixel, requireMetal, runGpu, shown, useDir, useGpu, view3dCall, writeHdr, writeJson, type JsonObject, type Rgb,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const FOG_SHARE = 1 - Math.exp(-1);

const line = (x: number, y: number, what: string, got: Rgb, want: Rgb): string | null =>
  linOff(got, want) <= 1 ? null : `(${x}, ${y}) ${what}: reads ${got.map((v) => v.toFixed(4)).join(', ')}, should read ${want.map((v) => v.toFixed(4)).join(', ')} (${linOff(got, want).toFixed(2)} codes of linear off)`;

describe(`${AC[4]} fog takes the background's color`, () => {
  it(`${AC[4]} above the horizon the near sphere reads mix(c, red, 1 - e^-1) and the far one the red beside it; below, the blue; a fog of the environment's mean color fails naming the pixel`, () => {
    requireMetal();
    const out = dir();
    const hdr = writeHdr(out, [720, 360], redBluePixel);
    const assets = { [hdr.sha]: hdr.path };
    const scenes = [10, -10];
    const calls = scenes.flatMap((e) => [0.02, 0].map((density) => view3dCall({ doc: writeJson(out, `fog-${e}-${density}`, fogDoc(hdr.sha, e, density)), size: FOG_SIZE, targets: ['linear', 'ids'], assets })));
    const replies = runGpu(bin(), out, calls);
    const problems: string[] = []; const planted: string[] = [];
    scenes.forEach((elev, s) => {
      const fogged = frameAt(framesOf(replies[s * 2]!, `elev ${elev}, fog`), 0, `elev ${elev}, fog`); const clear = frameAt(framesOf(replies[s * 2 + 1]!, `elev ${elev}, no fog`), 0, `elev ${elev}, no fog`);
      const lin = readLinear(out, fogged, FOG_SIZE, `elev ${elev}, fog`); const lin0 = readLinear(out, clear, FOG_SIZE, `elev ${elev}, no fog`); const ids = readIds(out, fogged, `elev ${elev}, fog`);
      const p = fogPixels(elev); const B = elev > 0 ? RED : BLUE; const tag = `elev ${elev}°`;
      // The fixture.
      expect([ids.at(...p.near), ids.at(...p.far), ids.at(...p.bg)], `${tag}: the ID target at the near, far and background pixels`).toEqual(['near', 'far', null]);
      expect(nearItem(ids, p.bg[0], p.bg[1], 3) === false, `${tag}: the background pixel is 3 px clear of any sphere`).toBe(true);
      const cam = fogCam(elev); const sp = fogSpheres(elev);
      const dn = hitSphere(cam.position, rayAt(cam, p.near[0] + 0.5, p.near[1] + 0.5), sp.near, FOG.nearRadius);
      const df = hitSphere(cam.position, rayAt(cam, p.far[0] + 0.5, p.far[1] + 0.5), sp.far, FOG.farRadius);
      expect(dn && Math.hypot(...dn), `${tag}: the near sphere's surface at its centre pixel is 50 m from the eye`).toBeCloseTo(50, 1);
      expect(df && Math.hypot(...df), `${tag}: the far sphere's surface at its centre pixel is 1,000 m from the eye`).toBeGreaterThan(998);
      expect(Math.abs(Math.hypot(...(df ?? [0, 0, 0])) - 1000), `${tag}: ... within 2 m`).toBeLessThan(2);
      const c = lin0.at(...p.near); const cFar = lin0.at(...p.far);
      expect(linOff(c, B), `${tag}: c, the near sphere with no fog, is at least 8 codes from the background`).toBeGreaterThanOrEqual(8);
      expect(linOff(cFar, B), `${tag}: the far sphere with no fog is at least 8 codes from the background`).toBeGreaterThanOrEqual(8);
      // The criterion.
      const wantNear = mix3(c, B, FOG_SHARE);
      const gotNear = lin.at(...p.near); const gotFar = lin.at(...p.far); const gotBg = lin.at(...p.bg);
      for (const f of [
        line(p.near[0], p.near[1], `${tag}: the near sphere at 50 m (c = ${c.map((v) => v.toFixed(4)).join(', ')}) is mix(c, ${elev > 0 ? 'red' : 'blue'}, 1 − e^−1)`, gotNear, wantNear),
        line(p.far[0], p.far[1], `${tag}: the far sphere at 1,000 m matches the background pixel (${p.bg.join(', ')}) beside it`, gotFar, gotBg),
        line(p.bg[0], p.bg[1], `${tag}: the background pixel next to the far sphere is the ${elev > 0 ? 'red' : 'blue'}`, gotBg, B),
      ]) if (f) problems.push(f);
      // The planted fog of the environment's mean color, through the same judge.
      const meanNear = mix3(c, MEAN_ENV, FOG_SHARE);
      expect(linOff(MEAN_ENV, B), `${tag}: the mean color is at least 8 codes from the background`).toBeGreaterThanOrEqual(8);
      for (const f of [
        line(p.near[0], p.near[1], `${tag}: planted fog of the mean color on the near sphere`, meanNear, wantNear),
        line(p.far[0], p.far[1], `${tag}: planted fog of the mean color on the far sphere`, MEAN_ENV, gotBg),
      ]) if (f) planted.push(f);
    });
    none(problems, 'fog takes the background\'s color');
    failsNamingPixels(planted, 'the planted fog of the environment\'s mean color');
    expect(planted.some((f) => f.includes('far sphere')), 'the planted fog misses the far sphere').toBe(true);  }, 1_800_000);

  it(`${AC[4]} fog: background with the froxel grid is refused naming the sky; a fog color with the grid, and background fog without it, are drawn`, () => {
    requireMetal();
    const out = dir();
    const hdr = writeHdr(out, [720, 360], redBluePixel);
    const froxels = { froxels: { cells: [160, 90], slices: 64, range: 100 } };
    const doc = (extra: JsonObject): string => writeJson(out, `froxel-${Object.keys(extra).join('-')}-${JSON.stringify(extra).length}`, { ...fogDoc(hdr.sha, 10, 0.02, extra), budget: { class: 'showpiece' } });
    const call = (extra: JsonObject): JsonObject => view3dCall({ doc: doc(extra), size: FOG_SIZE, targets: ['linear'], assets: { [hdr.sha]: hdr.path } });
    const [refused, colored, plain] = runGpu(bin(), out, [call(froxels), call({ ...froxels, fog: [0.5, 0.5, 0.5, 1] }), call({})]);
    expect(colored!['code'], `a fog color with the froxel grid is drawn: ${shown(colored)}`).toBeUndefined();
    expect(plain!['code'], `background fog without the froxel grid is drawn: ${shown(plain)}`).toBeUndefined();
    expect(typeof refused!['code'], `fog: background with the froxel grid is refused (a reply with a code): ${shown(refused)}`).toBe('string');
    expect(refused!['code'], 'the refusal is not the platform').not.toBe('unsupported_platform');
    const text = Object.entries(refused!).filter(([k]) => k !== 'code').map(([, v]) => JSON.stringify(v)).join(' ');
    expect(/(^|[^A-Za-z0-9_-])sky([^A-Za-z0-9_-]|$)/.test(text), `the refusal names the sky: ${shown(refused)}`).toBe(true);
    expect(refused!['frames'], 'a refused call draws no frame').toBeUndefined();  }, 1_800_000);
});
