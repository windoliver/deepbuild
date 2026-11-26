// #3033.485e37d6: "No vertex moves further than the summed amplitude of the waves the vertex stage draws, and 20 sampled
// times hash the same seeked and played"
//
// Drawn on this machine's Metal GPU; without one both tests read BLOCKED, never PASS.
//
// The sea: a plate 400 m × 400 m of 256 × 256 cells whose material `sea-water` carries `water: {waves: {sea: {wind: 10,
// direction: 90, spread: 30, seed: 3033}}}`, every other field its default, under a day sky and a sun. The film runs
// at 10 fps; the 20 sampled times are 20 frames drawn without repeat from frames 1 to 199 (0.1 to 19.9 s) by a
// generator seeded 3033.
//
// The vertices (test 1). The reply's `receipt.water.waves` lists the sea's waves, each row saying with `vertex: true |
// false` whether the vertex stage sums it (README: Surface choices); the bound is the sum of the amplitudes of the rows
// with `vertex: true`. The sea is seen straight down from 150 m (fov 110° at 512 × 512: 428 m of the plane, so the
// whole plate with 14 m around it), played from frame 0, and at each sampled frame the `depth` target (#166's linear
// depth readback) gives, at each pixel where the sea is drawn, the surface point its centre ray meets: 150 m less the
// depth up, and the ray's slope times the depth across. A surface point lies between the plate's vertices, and a
// vertex that moves at most the bound from its rest place stays within the bound of the plate at rest. So no such
// point may stand higher or lower than the bound (+ 1 mm for f32), nor lie further outside the plate's rest rectangle
// than the bound (+ one pixel's 0.84 m of water, the edge's cover). Not vacuous: the sea covers over four fifths of
// every frame, and the heights read span more than a quarter of the bound, so a flat plate, or a bound far above what
// the vertex stage draws, fails.
//
// Seek against play (test 2), as #166's seek.test.ts holds its lake: the same sea with a white tower standing in it,
// seen from a low camera at 480 × 270, played from frame 0 to frame 199; each of the 20 sampled frames is then opened
// cold by a seek (`from`) and must have the played frame's pixel hash. The film is of a sea: its receipt lists the
// sea's wave table. Not vacuous: the 20 played frames have 20 different hashes, so the sea moves.
import { describe, expect, it } from 'vitest';
import {
  AC, LOOK, Lcg, type Size, TOWER, camera, depthOf, frameAt, framesOf, hashAt, none, requireGpu, runGpu, sea, seaDoc, useGpu, useOut, view3d, waveTable,
  writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const PLATE: [number, number] = [400, 400];
const GRID: [number, number] = [256, 256];
const FPS = 10;
/** The 20 sampled times: 20 frames of 1 to 199, without repeat, in order. */
const TIMES: number[] = (() => {
  const rng = new Lcg(3033); const drawn = new Set<number>();
  while (drawn.size < 20) drawn.add(1 + Math.floor(rng.next() * 199));
  return [...drawn].sort((a, b) => a - b);
})();
const LAST = TIMES[TIMES.length - 1]!;

describe(`${AC[4]} the sea's vertices stay within their waves' summed amplitude, and the sea is a closed form of t`, () => {
  it(`${AC[4]} no vertex moves further than the summed amplitude of the waves the vertex stage draws: at 20 sampled times no point of the drawn surface stands outside it`, () => {
    requireGpu();
    const dir = out();
    const SIZE: Size = [512, 512]; const EYE = 150; const FOV = 110;
    const doc = writeJson(dir, 'sea-above', seaDoc('sea-above', SIZE, camera([0, EYE, 0], [0, 0, 0], FOV), sea(10), PLATE, GRID));
    const [film] = runGpu(bin(), dir, [view3d({ doc, look: LOOK, size: SIZE, frames: LAST + 1, fps: FPS, capture: TIMES, targets: ['depth'], receipt: true })]);
    const rows = waveTable(film!, 'the sea seen from above');
    expect(rows, 'the receipt lists the sea\'s wave table, receipt.water.waves').not.toBeNull();
    expect(rows!.filter((w) => w.vertex === null).length, 'every row of the table says whether the vertex stage sums it: vertex: true | false').toBe(0);
    const bound = rows!.filter((w) => w.vertex).reduce((a, w) => a + w.amplitude, 0);
    expect(bound, 'the vertex stage draws waves: the summed amplitude of the rows with vertex: true, in m').toBeGreaterThan(0);

    const frames = framesOf(film!, 'the sea seen from above');
    const focal = SIZE[0] / 2 / Math.tan((FOV * Math.PI) / 360);
    const pixel = EYE / focal;
    const failures: string[] = []; let outside = 0; let drawn = 0; let low = Infinity; let high = -Infinity;
    for (const n of TIMES) {
      const depth = depthOf(dir, frameAt(frames, n, 'the sea seen from above'), SIZE, 'the sea seen from above');
      for (let j = 0; j < SIZE[1]; j++) for (let i = 0; i < SIZE[0]; i++) {
        const d = depth[j * SIZE[0] + i]!;
        if (d === Infinity) continue;
        drawn++;
        const y = EYE - d; const x = ((i + 0.5 - SIZE[0] / 2) / focal) * d; const z = ((j + 0.5 - SIZE[1] / 2) / focal) * d;
        const off = Math.max(Math.abs(x) - PLATE[0] / 2, Math.abs(z) - PLATE[1] / 2, 0);
        if (Number.isFinite(d)) { low = Math.min(low, y); high = Math.max(high, y); }
        if (Math.abs(y) <= bound + 0.001 && off <= bound + pixel) continue;
        outside++;
        if (failures.length < 8) failures.push(`at ${n / FPS} s pixel (${i}, ${j}) shows the surface ${y.toFixed(4)} m up and ${off.toFixed(4)} m outside the plate at rest; the vertex stage's waves sum to ${bound.toFixed(4)} m`);
      }
    }
    console.log(`${AC[4]}: the vertex stage's ${rows!.filter((w) => w.vertex).length} of ${rows!.length} waves sum to ${bound.toFixed(4)} m; over ${TIMES.length} times the drawn surface stands from ${low.toFixed(4)} to ${high.toFixed(4)} m; ${outside} of ${drawn} points outside the bound`);
    expect(drawn / (TIMES.length * SIZE[0] * SIZE[1]), 'the sea is drawn over more than four fifths of the sampled frames').toBeGreaterThan(0.8);
    expect(high - low, 'the vertices move: the heights read span more than a quarter of the summed amplitude').toBeGreaterThan(bound / 4);
    none(failures, `no point of the drawn surface stands further than the summed amplitude from the plate at rest (${outside} do)`);
  });

  it(`${AC[4]} 20 sampled times hash the same seeked and played`, () => {
    requireGpu();
    const dir = out();
    const SIZE: Size = [480, 270];
    const doc = writeJson(dir, 'sea-film', seaDoc('sea-film', SIZE, camera([0, 9, 150], [0, 2, 0], 50), sea(10), PLATE, GRID, TOWER));
    const [played, ...seeked] = runGpu(bin(), dir, [
      view3d({ doc, look: LOOK, size: SIZE, frames: LAST + 1, fps: FPS, receipt: true }),
      ...TIMES.map((n) => view3d({ doc, look: LOOK, size: SIZE, from: n, frames: 1, fps: FPS })),
    ]);
    expect(waveTable(played!, 'the sea film'), 'the film is of a sea: its receipt lists the sea\'s wave table, receipt.water.waves').not.toBeNull();
    const p = TIMES.map((n) => hashAt(played!, n, 'the played film'));
    const failures = TIMES.flatMap((n, k) => {
      const s = hashAt(seeked[k]!, n, `the seek to frame ${n}`);
      return s === p[k] ? [] : [`at ${n / FPS} s (frame ${n}) the seeked frame's pixel hash ${s.slice(0, 12)} differs from the played one's ${p[k]!.slice(0, 12)}`];
    });
    expect(new Set(p).size, 'the sea moves: the 20 sampled times are 20 different frames').toBe(TIMES.length);
    none(failures, 'each of the 20 sampled times has one pixel hash, seeked and played');
  });
});
