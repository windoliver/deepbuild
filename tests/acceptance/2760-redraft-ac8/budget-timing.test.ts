// #2760.6dfadd78: "Budget, on the reference Mac in the local preflight, compared with the merge base: 64 live rings on a
// pond that fills half a 1080p frame add under 0.3 ms of GPU"
//
// The blind redraft of this criterion's timing test (README). It draws the pond with 64 live rings and the same pond
// without, and judges what the rings add; the test that reads benchmarks/budgets.json's task is not this file's.
//
// The pond (fixture.ts): a 12 m × 12 m plate `pond` whose material carries `water: {rings: {on: {list:
// "drips.occurrences", kinds: ["drip"]}}}`, every other field its default, seen from 30° above the horizon so that it
// fills half of a 1920 × 1080 frame, each pixel spanning 1 to 3 cm of water. From that height a bent normal changes
// the Fresnel mix, so a ring shows; from straight above it would not, and a pixel spanning much more water would see
// no ring at all (README: What the base does). The logic item `drips` touches the water on 8 of every 15 steps at
// 60 Hz, walking an 8 × 8 grid of 1.5 m cells, so from 2 s on every instant has exactly 64 rings alive, one in each
// cell, of every age from 0 to 2 s. Without: the same document, logic item and all, whose material has no `rings`, as
// the merge base's water has none.
//
// Before anything is timed, the test shows that what it times is what the criterion names, at frames 120, 280, 320
// and 419 of the 300 it times (frames 120 to 419, 2 s to 6.98 s):
// - 64 live rings: with `rings: true`, each of those frames lists exactly 64 rings an occurrence started on `pond`,
//   each alive (0 ≤ t − born < 2 s), one in each of the 64 cells; the pond without lists none.
// - drawn, every one: frames 120, 280 and 320 are 40 steps apart, so every cell's ring is between 0.25 s and 1 s old
//   (its crest 7.5 to 30 cm out, at half strength or more) in one of them; in that frame the picture with rings
//   differs from the picture without in at least 8 pixels within 0.4 m of the cell's centre, which no other cell's
//   ring can reach. So a program that lists rings it does not draw, draws fewer than 64, or draws them somewhere else
//   fails here, naming the cells, and never reaches the timing.
// - a pond that fills half a 1080p frame: the pixels of frame 120's object-ID target that are `pond` are between 49%
//   and 51% of the frame.
// The timed films are those frames: each timed run's pixel hashes at those four frames are the checked pictures'.
//
// The timing, as #166's and #968's suites time theirs: 300 frames with `timings: true`, one process per run drawing the
// two sides, five runs after a warm-up run, judged by the lane's `judgeLimit` (scripts/benchmark.mjs, in a child
// process) with each run's one-minute load average at its start and end: PASS when all five are within 0.3 ms, FAIL
// when all five are over it by more than the margin, else INCONCLUSIVE; off a reference Mac, off mains, in Low Power
// Mode, not thermally nominal, or with the load at a run's start or end above the core count, INCONCLUSIVE, never a
// pass. The machine is read by the same judge before anything is timed, so an unfit machine times nothing. What the
// rings add is the difference of the two sides' median `gpu_ms`, a negative one read as 0.
import { describe, expect, it } from 'vitest';
import {
  FILMIC, type Frame, ID, type Image, type JsonObject, type Load, arr, differs, frameAt, framesOf, gpuMs, inconclusive, judge, loadNow, median, num, obj,
  onPlane, pickAt, pickOf, putAsset, readTarget, requireGpu, runGpu, str, timingProblem, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';
import { CAM, CELLS, FPS, SIZE, SPAN, cellCentre, cellOf, drips, pond } from './fixture.ts';

const bin = useGpu();
const out = useOut();
const LIMIT = 0.3;
/** The timed film: 300 frames from 2 s, when the 64th ring is born. */
const FROM = 120;
const FRAMES = 300;
/** The frames whose rings are read. The first three are 40 steps apart modulo the rings' 120, and are also compared
 * as pictures; the last is the film's last frame. */
const PICTURED = [120, 280, 320];
const LISTED = [...PICTURED, FROM + FRAMES - 1];
/** A ring this old (s) has a crest 7.5 to 30 cm from its centre at half its strength or more. */
const DRAWN_AGE: [number, number] = [0.25, 1];
/** A cell's own patch: the pixels whose rays meet the water at rest within this far (m) of its centre. The rain's
 * crest is 4.5 cm wide each side of its radius, so another cell's ring ends 0.645 m from its own centre, 0.455 m short
 * of this patch; the breeze's waves move where a point of the water is drawn by 0.2 m at most at the base, which
 * leaves a ring of the ages above mostly inside its own patch and every other ring outside it (README: What the base
 * does). */
const PATCH = 0.4;
/** A ring's age is the frame's time less its `born`, each a quotient in s: this much (s) is rounding, not age. */
const ROUNDING = 1e-6;

/** The rings an occurrence started that one frame lists on the pond, by cell: `{part, occurrence, at, born}` read. */
interface Ring { occurrence: number; cell: number; age: number }
function ringsOf(f: Frame, what: string): Ring[] {
  const t = f.frame / FPS;
  return arr(f.raw['rings'], `${what}: frame ${f.frame}'s rings`).map((v, i) => {
    const r = obj(v, `${what}: frame ${f.frame}: rings[${i}]`);
    expect(str(r['part'], `${what}: rings[${i}].part`), `${what}: frame ${f.frame}: rings[${i}] is on the pond`).toBe('pond');
    const at = arr(r['at'], `${what}: rings[${i}].at`);
    return {
      occurrence: num(r['occurrence'], `${what}: frame ${f.frame}: rings[${i}].occurrence`),
      cell: cellOf(num(at[0], `${what}: rings[${i}].at[0]`), num(at[1], `${what}: rings[${i}].at[1]`)),
      age: t - num(r['born'], `${what}: rings[${i}].born`),
    };
  });
}

/** For each cell, how many pixels of its patch differ between two pictures of the frame. */
function changedByCell(a: Image, b: Image): number[] {
  const changed = Array.from({ length: CELLS }, () => 0);
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    if (!differs(a, b, x, y)) continue;
    const [px, pz] = onPlane(CAM, x, y);
    const cell = cellOf(px, pz);
    if (cell < 0) continue;
    const [cx, cz] = cellCentre(cell);
    if (Math.hypot(px - cx, pz - cz) <= PATCH) changed[cell]!++;
  }
  return changed;
}

describe(`${ID} the rings' budget`, () => {
  it(`${ID} 64 live rings, each one drawn, on a pond that fills half a 1080p frame add under 0.3 ms of GPU to the same pond without them, in five runs`, () => {
    requireGpu();
    const dir = out();
    const program = drips();
    const assets = putAsset(dir, program.bytes, 'wasm');
    const sides = [writeJson(dir, 'pond-rings', pond(program, true)), writeJson(dir, 'pond-bare', pond(program, false))] as const;
    const film = { look: FILMIC, size: SIZE, from: FROM, frames: FRAMES, fps: FPS, assets };

    // What is timed is what the criterion names: 64 live rings, each drawn, on a pond that fills half the frame.
    const [withRings, without] = runGpu(bin(), dir, [
      view3d({ doc: sides[0], ...film, capture: LISTED, targets: ['final', 'ids'], rings: true }),
      view3d({ doc: sides[1], ...film, capture: LISTED, targets: ['final'], rings: true }),
    ]);
    const fa = framesOf(withRings!, 'the pond with rings'); const fb = framesOf(without!, 'the pond without');
    for (const n of LISTED) {
      const rings = ringsOf(frameAt(fa, n, 'the pond with rings'), 'the pond with rings');
      expect(rings.length, `frame ${n} (${(n / FPS).toFixed(3)} s) lists 64 rings on the pond`).toBe(CELLS);
      expect(new Set(rings.map((r) => r.occurrence)).size, `frame ${n}: each ring has its own occurrence`).toBe(CELLS);
      const dead = rings.filter((r) => !(r.age > -ROUNDING && r.age < SPAN + ROUNDING)).map((r) => `occurrence ${r.occurrence} at age ${r.age.toFixed(4)} s`);
      expect(dead, `frame ${n}: every listed ring is alive, born at or before t and under ${SPAN} s old`).toEqual([]);
      expect([...new Set(rings.map((r) => r.cell))].sort((p, q) => p - q), `frame ${n}: one ring in each of the 64 cells`).toEqual(Array.from({ length: CELLS }, (_, c) => c));
      expect(arr(frameAt(fb, n, 'the pond without').raw['rings'], `the pond without: frame ${n}'s rings`), `frame ${n}: the pond without lists no ring`).toEqual([]);
    }
    const drawnIn = new Map<number, number>(); const seen: string[] = [];
    for (const n of PICTURED) {
      const a = frameAt(fa, n, 'the pond with rings'); const b = frameAt(fb, n, 'the pond without');
      const changed = changedByCell(readTarget(dir, a, 'final', SIZE, 'the pond with rings'), readTarget(dir, b, 'final', SIZE, 'the pond without'));
      for (const r of ringsOf(a, 'the pond with rings')) {
        if (r.age < DRAWN_AGE[0] || r.age > DRAWN_AGE[1]) continue;
        drawnIn.set(r.cell, Math.max(drawnIn.get(r.cell) ?? 0, changed[r.cell]!));
        seen.push(`cell ${r.cell} frame ${n} age ${r.age.toFixed(3)} s: ${changed[r.cell]!} px`);
      }
    }
    const young = Array.from({ length: CELLS }, (_, c) => c).filter((c) => !drawnIn.has(c));
    expect(young, `every cell's ring is ${DRAWN_AGE[0]} to ${DRAWN_AGE[1]} s old in one of frames ${PICTURED.join(', ')}; cells never that age`).toEqual([]);
    const undrawn = [...drawnIn].filter(([, px]) => px < 8).map(([c, px]) => `cell ${c} at (${cellCentre(c).join(', ')}) m: ${px} px`);
    console.log(`${ID}: the pixels each cell's ring changes within ${PATCH} m of its centre, ${Math.min(...drawnIn.values())} to ${Math.max(...drawnIn.values())}`);
    expect(undrawn, `each of the 64 rings changes at least 8 pixels of the picture within ${PATCH} m of its centre (${seen.slice(0, 6).join('; ')}…); rings listed but not drawn there`).toEqual([]);

    const first = frameAt(fa, FROM, 'the pond with rings');
    const ids = readTarget(dir, first, 'ids', SIZE, 'the pond with rings'); const pick = pickOf(first, 'pond', 'the pond with rings');
    let wet = 0;
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) if (pickAt(ids, x, y) === pick) wet++;
    const share = wet / (SIZE[0] * SIZE[1]);
    console.log(`${ID}: the pond is ${(share * 100).toFixed(2)}% of the 1920 × 1080 frame`);
    expect(Math.abs(share - 0.5), `the pond fills half the frame: ${wet} of its ${SIZE[0] * SIZE[1]} pixels`).toBeLessThanOrEqual(0.01);

    // The machine, read before anything is timed.
    const problem = timingProblem();
    if (problem) inconclusive(`the rings' GPU time counts only on a reference Mac at rest: ${problem}`);

    const hashes = (frames: Frame[], what: string): string[] => LISTED.map((n) => frameAt(frames, n, what).pixel_hash);
    const once = (): { a: number; b: number; load: Load } => {
      const calls: JsonObject[] = sides.map((doc) => view3d({ doc, ...film, timings: true }));
      const start = loadNow();
      const [ra, rb] = runGpu(bin(), dir, calls);
      const end = loadNow();
      const ta = framesOf(ra!, 'the timed pond with rings'); const tb = framesOf(rb!, 'the timed pond without');
      expect([ta.length, tb.length], `each side draws ${FRAMES} frames`).toEqual([FRAMES, FRAMES]);
      expect(hashes(ta, 'the timed pond with rings'), 'the timed film with rings draws the pictures shown to hold 64 drawn rings').toEqual(hashes(fa, 'the pond with rings'));
      expect(hashes(tb, 'the timed pond without'), 'the timed film without draws the pictures they were compared with').toEqual(hashes(fb, 'the pond without'));
      return { a: median(gpuMs(ta, 'the timed pond with rings')), b: median(gpuMs(tb, 'the timed pond without')), load: { start, end } };
    };
    once();
    const runs = Array.from({ length: 5 }, once);
    console.log(`${ID}: median gpu_ms a frame, with rings and without: ${runs.map((r) => `${r.a.toFixed(4)} and ${r.b.toFixed(4)}`).join('; ')}`);
    judge(`${ID} 64 live rings on the pond, added GPU (ms a frame)`, LIMIT, runs.map((r) => Math.max(0, r.a - r.b)), runs.map((r) => r.load));
  });
});
