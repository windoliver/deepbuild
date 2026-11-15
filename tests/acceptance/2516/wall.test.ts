// The wall fixture (README: Fixtures and cameras): a floor meeting a wall 20 m long and 4 m high, under uniform ambient
// with no lights, multi_bounce and specular off, strength 1, a floor material with no specular share; radius 0.5 m.
// The reading at d is the floor's linear luminance with ao on ÷ with `ao: none`, averaged along 4 m of the wall
// (|x| ≤ 2 m) over floor pixels within ±0.5 cm of d, read through the depth target and the stated camera.
//
// AC1 "On the wall fixture at radius 0.5 m the reading at 5, 10, 15, 20, 30 and 40 cm from the wall is within 0.05 of the
//     closed form (0.564, 0.626, 0.688, 0.748, 0.858 and 0.948), at 8 and 16 samples, at half and full resolution, and
//     from a second camera 30° around the first. The 0.05 is drafted until the first run. The loop as it is on main,
//     planted, fails, naming the first point and its reading"
// AC2 "At 60 cm and 1 m from the wall the reading is 1 within 0.01. A planted loop that is main's with its strength raised
//     until the 10 cm point passes fails at 5 cm, naming the point and its reading"
//
// On the base the shipped program is main's loop: the issue's CPU model of it reads 0.82 to 0.84 at 10 cm and 0.90 to
// 0.91 at 15 cm, so AC1 fails there on its readings. The plants run through `--planted ao_main_loop`, which the base
// doesn't have (README: Planted).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTING, SETTINGS, WALL_BOXES, WALL_CAMS, WALL_OPEN, WALL_POINTS, aoOn, failsNaming, fixtureDoc, fmt, judge, measure, none,
  requireGpu, settingName, useGpuBin, useOut, wallBin, wallClosed, writeJson, type Cam, type Row,
} from './helpers.ts';

const gpu = useGpuBin();
const out = useOut();
const TOL = 0.05;
const OPEN_TOL = 0.01;
const BINS = [...WALL_POINTS, ...WALL_OPEN].map(wallBin);
const cm = (d: number): string => `${Math.round(d * 100)} cm`;

function wallRows(m: Map<string, number>, points: readonly number[], tol: number, open: boolean): Row[] {
  return points.map((d) => ({ point: cm(d), reading: m.get(cm(d))!, expected: open ? 1 : wallClosed(d), tol, against: open ? 'the open floor\'s' : 'the closed form' }));
}
function wallDoc(dir: string, cam: Cam, tag: string): string {
  return writeJson(dir, `wall-${tag}.json`, fixtureDoc(`wall-2516-${tag}`, WALL_BOXES, cam));
}

/** The shipped program's wall readings at every setting from both cameras, drawn once per file. */
let shipped: Map<string, Map<string, Map<string, number>>> | null = null;
function shippedWall(): Map<string, Map<string, Map<string, number>>> {
  if (shipped) return shipped;
  const dir = mkdtempSync(join(tmpdir(), 'deep-2516-wall-'));
  try {
    const all = new Map<string, Map<string, Map<string, number>>>();
    WALL_CAMS.forEach((cam, k) => {
      const doc = wallDoc(dir, cam, `cam${k}`);
      all.set(cam.name, measure(gpu.bin(), dir, doc, cam, SETTINGS.map((s) => ({ label: settingName(s), ao: aoOn(s) })), BINS));
    });
    for (const [cam, rows] of all) for (const [s, m] of rows) console.log(`#2516 wall, camera ${cam}, ${s}: ${fmt(m)}`);
    shipped = all;
    return all;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('AC1 the wall\'s foot is held to its closed form', () => {
  it('AC1 at 5, 10, 15, 20, 30 and 40 cm the reading is within 0.05 of the closed form, at 8 and 16 samples, half and full resolution, from camera A and from B 30° around it', () => {
    requireGpu();
    const problems: string[] = [];
    for (const [cam, rows] of shippedWall()) for (const [s, m] of rows) problems.push(...judge(`wall, camera ${cam}, ${s}`, wallRows(m, WALL_POINTS, TOL, false)));
    none(problems, 'every wall reading is within 0.05 of its closed form');
  }, 3_600_000);

  it('AC1 the loop as it is on main, planted, fails, naming the first point and its reading', () => {
    requireGpu();
    const cam = WALL_CAMS[0]!;
    const m = measure(gpu.bin(), out(), wallDoc(out(), cam, 'main'), cam, [{ label: settingName(DEFAULT_SETTING), ao: aoOn(DEFAULT_SETTING) }], BINS, 'ao_main_loop').get(settingName(DEFAULT_SETTING))!;
    console.log(`#2516 wall, main's loop (planted), camera ${cam.name}, ${settingName(DEFAULT_SETTING)}: ${fmt(m)}`);
    const problems = judge(`wall, main's loop, camera ${cam.name}, ${settingName(DEFAULT_SETTING)}`, wallRows(m, WALL_POINTS, TOL, false));
    failsNaming(problems, [/at \d+ cm the reading is \d\.\d{3}/], 'main\'s loop on the wall');
    const first = WALL_POINTS.find((d) => Math.abs(m.get(cm(d))! - wallClosed(d)) > TOL)!;
    expect(problems[0], 'the first failure names the first failing point and its reading').toContain(`at ${cm(first)} the reading is ${m.get(cm(first))!.toFixed(3)}`);
  }, 1_800_000);
});

describe('AC2 the open floor past the radius reads 1, and strength can\'t buy the wall\'s foot', () => {
  it('AC2 at 60 cm and 1 m the reading is 1 within 0.01, at every setting from both cameras', () => {
    requireGpu();
    const problems: string[] = [];
    for (const [cam, rows] of shippedWall()) for (const [s, m] of rows) problems.push(...judge(`wall, camera ${cam}, ${s}`, wallRows(m, WALL_OPEN, OPEN_TOL, true)));
    none(problems, 'every open-floor reading is 1 within 0.01');
  }, 3_600_000);

  it('AC2 main\'s loop with its strength raised until the 10 cm point passes fails at 5 cm, naming the point and its reading', () => {
    requireGpu();
    const cam = WALL_CAMS[0]!;
    const doc = wallDoc(out(), cam, 'strong');
    const at = (strengths: number[]): Map<string, Map<string, number>> =>
      measure(gpu.bin(), out(), doc, cam, strengths.map((s) => ({ label: `strength ${s.toFixed(1)}`, ao: aoOn(DEFAULT_SETTING, s) })), BINS, 'ao_main_loop');
    const passes10 = (m: Map<string, number>): boolean => Math.abs(m.get('10 cm')! - wallClosed(0.1)) <= TOL;
    // Coarse ladder 1 to 6 by 0.5, then by 0.1 inside the step the 10 cm reading crossed.
    const coarse = at([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6]);
    for (const [s, m] of coarse) console.log(`#2516 main's loop, ${s}: ${fmt(m)}`);
    let found = [...coarse].find(([, m]) => passes10(m));
    if (!found) {
      const list = [...coarse];
      const k = list.findIndex(([, m]) => m.get('10 cm')! < wallClosed(0.1) - TOL);
      expect(k, `main's loop never reaches the 10 cm point's band at strengths 1 to 6: ${list.map(([s, m]) => `${s}: ${m.get('10 cm')!.toFixed(3)}`).join(', ')}`).toBeGreaterThan(0);
      const from = 1 + 0.5 * (k - 1);
      const fine = at([0.1, 0.2, 0.3, 0.4].map((x) => from + x));
      for (const [s, m] of fine) console.log(`#2516 main's loop, ${s}: ${fmt(m)}`);
      found = [...fine].find(([, m]) => passes10(m));
    }
    expect(found, 'some strength makes main\'s loop pass at 10 cm (the plant the criterion names exists)').toBeDefined();
    const [label, m] = found!;
    const problems = judge(`wall, main's loop at ${label}, camera ${cam.name}, ${settingName(DEFAULT_SETTING)}`, wallRows(m, WALL_POINTS, TOL, false));
    console.log(`#2516 the strengthened plant at ${label}: ${problems.join('; ') || 'no failure'}`);
    failsNaming(problems, [`at 5 cm the reading is ${m.get('5 cm')!.toFixed(3)}`], `main's loop at ${label}`);
  }, 3_600_000);
});
