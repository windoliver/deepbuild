// The cube fixture (README: Fixtures and cameras): a cube 0.2 m on a side standing on a floor, an occluder smaller than
// the radius, under uniform ambient with no lights, multi_bounce and specular off, strength 1, a floor material with no
// specular share; radius 0.5 m. The reading at d is the floor's linear luminance with ao on ÷ with `ao: none`, averaged
// along the middle 10 cm of the front face (|x| ≤ 0.05 m) over floor pixels within ±0.5 cm of d in front of it.
//
// AC4 "On the cube fixture at radius 0.5 m the reading on the floor 5 and 10 cm in front of the middle of a face is within
//     0.1 of a CPU reference in f64 of 4,096 cosine-weighted rays out to the radius (0.68 and 0.81), from a camera facing
//     that face and from one 90° around it. The 0.1 is drafted until the first run. A planted loop that puts every one of
//     main's points at the full radius passes the wall fixture, reads above 0.99 here and fails, naming the camera"
//
// The CPU reference is `cubeReference` (helpers.ts), qualified in reference.test.ts against the issue's numbers with its
// even-weighted twin failing; it is computed here over the same middle 10 cm. Read at every setting.
import { describe, expect, it } from 'vitest';
import {
  CUBE_BOXES, CUBE_CAMS, CUBE_POINTS, DEFAULT_SETTING, SETTINGS, WALL_BOXES, WALL_CAMS, WALL_POINTS, aoOn, cubeBin, cubeReference,
  failsNaming, fixtureDoc, fmt, judge, measure, none, requireGpu, settingName, useGpuBin, useOut, wallBin, wallClosed, writeJson,
  type Cam, type Plant, type Row, type Setting,
} from './helpers.ts';

const gpu = useGpuBin();
const out = useOut();
const TOL = 0.1;
const WALL_TOL = 0.05;
const REF = new Map(CUBE_POINTS.map((d) => [`${Math.round(d * 100)} cm`, cubeReference(d)]));

function cube(cam: Cam, k: number, settings: Setting[], plant?: Plant): Map<string, Map<string, number>> {
  const doc = writeJson(out(), `cube-${k}-${plant ?? 'shipped'}.json`, fixtureDoc(`cube-2516-${k}`, CUBE_BOXES, cam));
  const m = measure(gpu.bin(), out(), doc, cam, settings.map((s) => ({ label: settingName(s), ao: aoOn(s) })), CUBE_POINTS.map(cubeBin), plant);
  for (const [s, row] of m) console.log(`#2516 cube, camera ${cam.name}${plant ? ` (--planted ${plant})` : ''}, ${s}: ${fmt(row)}; CPU reference ${fmt(REF)}`);
  return m;
}
const rows = (m: Map<string, number>): Row[] => [...REF].map(([point, ref]) => ({ point, reading: m.get(point)!, expected: ref, tol: TOL, against: 'the CPU reference' }));

describe('AC4 an occluder smaller than the radius is held to the CPU reference', () => {
  it('AC4 5 and 10 cm in front of the middle of a face the reading is within 0.1 of the 4,096-ray CPU reference, from a camera facing the face and from one 90° around it, at every setting', () => {
    requireGpu();
    const problems: string[] = [];
    CUBE_CAMS.forEach((cam, k) => {
      for (const [s, m] of cube(cam, k, SETTINGS)) problems.push(...judge(`cube, camera ${cam.name}, ${s}`, rows(m)));
    });
    none(problems, 'every cube reading is within 0.1 of the CPU reference');
  }, 3_600_000);

  it('AC4 a loop that puts every one of main\'s points at the full radius passes the wall fixture, reads above 0.99 on the cube and fails, naming the camera', () => {
    requireGpu();
    // It passes the wall fixture, at every setting from both cameras: the wall alone can't tell it apart.
    const wallProblems: string[] = [];
    WALL_CAMS.forEach((cam, k) => {
      const doc = writeJson(out(), `wall-full-radius-${k}.json`, fixtureDoc(`wall-2516-full-radius-${k}`, WALL_BOXES, cam));
      const m = measure(gpu.bin(), out(), doc, cam, SETTINGS.map((s) => ({ label: settingName(s), ao: aoOn(s) })), WALL_POINTS.map(wallBin), 'ao_full_radius');
      for (const [s, row] of m) {
        console.log(`#2516 wall, camera ${cam.name} (--planted ao_full_radius), ${s}: ${fmt(row)}`);
        wallProblems.push(...judge(`wall, full-radius loop, camera ${cam.name}, ${s}`, WALL_POINTS.map((d) => ({ point: `${Math.round(d * 100)} cm`, reading: row.get(`${Math.round(d * 100)} cm`)!, expected: wallClosed(d), tol: WALL_TOL, against: 'the closed form' }))));
      }
    });
    none(wallProblems, 'the full-radius plant passes the wall fixture, as the criterion names it');
    // Here it reads above 0.99 and fails, naming the camera.
    CUBE_CAMS.forEach((cam, k) => {
      const m = cube(cam, k, [DEFAULT_SETTING], 'ao_full_radius').get(settingName(DEFAULT_SETTING))!;
      for (const [point, r] of m) expect(r, `the full-radius loop reads above 0.99 at ${point} from camera ${cam.name}`).toBeGreaterThan(0.99);
      failsNaming(judge(`cube, full-radius loop, camera ${cam.name}, ${settingName(DEFAULT_SETTING)}`, rows(m)), [`camera ${cam.name}`], `the full-radius loop from camera ${cam.name}`);
    });
  }, 3_600_000);
});
