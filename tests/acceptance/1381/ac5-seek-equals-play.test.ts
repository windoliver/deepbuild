// AC5 #1381.1451e92c: "Seek equals play by pixel hash at sunset"
//
// Fixture (helpers.ts `ridgeDoc`, README: Fixtures): criterion 4's sunset, the sun sinking from 15° at 0 s to 3° at 3 s
// over the ridge plate with its horizon, the cascades ending 300 m out and the valley's far floor shaded by the horizon
// past them. One process plays it by `view3d` at 640 × 360, 10 frames a second, frames 0 to 30, capturing frames 10
// (the sun at 11°), 25 (5°, the issue's sunset) and 30 (3°); a second process seeks each of the three, one call each
// (`from` the frame, one frame), so nothing the play drew is there to read. Each call also reads `ground_points` at
// (−224, 0), 800 m east of the crest, past the last cascade (README: Assumed surfaces 3).
//
// Asserted: each sought frame's pixel hash equals the played one's, and its reading at the point equals the played one's.
// So the comparison sees the sunset: the three played frames differ by pixel hash; each passes #1399's blank guard (32
// colors, 5% off its modal color, under 98% dark); and the horizon shades them, the point lit at 11° (at least 0.95) and
// in the ridge's shadow at 5° and 3° (at most 0.05; the crest stands 7.13° there).
//
// Catches: the base (no `horizon`, no readings); a horizon baked or refined over frames, or a visibility or occlusion
// carried from an earlier frame, which a seek can't reach.
import { describe, expect, it } from 'vitest';
import {
  AC, CREST_X, PLAIN, SMALL, SUNSET_FPS, SUNSET_FRAMES, blankReason, decodePng, framesOf, groundPoints, groundRows, pixelHash, readNamed,
  requireMetal, ridgeDoc, runGpu, sunsetElevation, useGpu, useOut, writeJson, type JsonObject, type Xz,
} from './helpers.ts';

const ID = AC[5];
const NAME = `AC5 ${ID}`;
const bin = useGpu();
const out = useOut();
const FAR: Xz = [CREST_X + 800, 0];
const SEEKS = [10, 25, 30] as const;

describe(`${NAME} a seek at sunset draws what playing draws`, () => {
  it(`${NAME} frames 10, 25 and 30 of the sunset, each sought in a fresh process, equal the played frames by pixel hash`, () => {
    requireMetal();
    const dir = out();
    const doc = writeJson(dir, 'sunset', ridgeDoc({ size: SMALL, sun: 'sunset', view: 'sunset' }));
    const call = (from: number, frames: number): JsonObject => ({
      call: 'view3d', doc, look: PLAIN, size: [...SMALL], fps: SUNSET_FPS, from, frames, capture: [...SEEKS], targets: ['final'], ground_points: groundPoints([FAR]),
    });
    const [played] = runGpu(bin(), dir, [call(0, SUNSET_FRAMES)]);
    const play = framesOf(played!, SUNSET_FRAMES, 'the sunset, played');
    const sought = runGpu(bin(), dir, SEEKS.map((n) => call(n, 1))).map((r, i) => framesOf(r, 1, `the sunset, sought to frame ${SEEKS[i]}`, SEEKS[i])[0]!);

    const differ: string[] = [];
    const hashes = new Set<string>();
    SEEKS.forEach((n, i) => {
      const at = `frame ${n} (the sun at ${sunsetElevation(n / SUNSET_FPS).toFixed(1)}°)`;
      const p = play[n]!; const s = sought[i]!;
      const ph = pixelHash(p, `${at}, played`);
      hashes.add(ph);
      const blank = blankReason(decodePng(readNamed(dir, p['final'], 'png', `${at}, played: final`)));
      expect(blank, `${at}, played, isn't blank by #1399's guard`).toBe('');
      const sh = pixelHash(s, `${at}, sought`);
      if (sh !== ph) differ.push(`${at}: seeking draws pixel hash ${sh}, playing ${ph}`);
      const [pr] = groundRows(p, [FAR], `${at}, played`); const [sr] = groundRows(s, [FAR], `${at}, sought`);
      if (pr!.sun !== sr!.sun || pr!.occlusion !== sr!.occlusion) differ.push(`${at}: seeking reads (${FAR.join(', ')}) as sun_visibility ${sr!.sun}, occlusion ${sr!.occlusion}; playing ${pr!.sun}, ${pr!.occlusion}`);
    });
    expect(differ, 'each sought frame equals the played one').toEqual([]);
    expect(hashes.size, 'the three played frames draw other pixels: the sun moves').toBe(SEEKS.length);
    const reading = (n: number): number => groundRows(play[n]!, [FAR], `frame ${n}, played`)[0]!.sun;
    expect(reading(10), `at frame 10 (the sun at 11°) the point (${FAR.join(', ')}) is lit`).toBeGreaterThanOrEqual(0.95);
    expect(reading(25), `at frame 25 (the sun at 5°) the point (${FAR.join(', ')}) is in the ridge's shadow, past the last cascade`).toBeLessThanOrEqual(0.05);
    expect(reading(30), `at frame 30 (the sun at 3°) the point (${FAR.join(', ')}) is in the ridge's shadow, past the last cascade`).toBeLessThanOrEqual(0.05);
  }, 3_600_000);
});
