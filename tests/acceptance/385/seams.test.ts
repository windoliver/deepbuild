// Criterion 8: eight sectors of one color that tile a disc, over a white ground, leave every pixel on their shared
// edges within 1 code value of the disc's color in GPUI, Vello GPU and Vello CPU, and still do while the sectors move
// apart and back by channels; a planted renderer that composites each sector source-over leaves a seam over 20 code
// values lighter and fails, naming the edge.
//
// The figure (helpers.ts `sectorsDoc`) puts the disc's centre on a pixel centre, so every shared edge cuts the pixels it
// crosses, and moves each sector out along its bisector by channels and back (0 at t = 0, 8 u at 1 s, 0 at 2 s). Each
// renderer draws t = 0, 0.5 s, 1 s and 2 s in one process, in that order: Vello CPU through `raster`; GPUI and Vello
// GPU through `deep-gpu run`'s `layers` (README). At 0 and 2 s the sectors tile the disc and every edge pixel is
// checked; at 1 s they must be apart (the channels move them). The wrong program is `planted: "sectors_source_over"` on
// `raster` and `--planted sectors_source_over` on `deep-gpu`: each sector composited source-over on its own.
// At the base `deep-gpu` has no `layers` call and the planted programs don't exist.
import { describe, expect, it } from 'vitest';
import {
  DEEP_GPU, FLICKS, LOOK, RENDER, answers, drawLine, gpuReplies, layersCall, needsMac, readDrawn, readLayers, sectorsApart, sectorsDoc, seamProblems,
  sideOf, useBuilds, useDir, type Image,
} from './helpers.ts';

const builds = useBuilds([RENDER, DEEP_GPU]);
const dir = useDir('deep-385-seams-');
const TIMES = [0, FLICKS / 2, FLICKS, 2 * FLICKS];
const TOGETHER = [0, 3];

/** Vello CPU's frames at TIMES, drawn by one `raster` process. */
function cpuFrames(planted?: string): Image[] {
  const d = dir();
  const lines = TIMES.map((t) => drawLine(d, sectorsDoc(), LOOK, { t, ...(planted ? { planted } : {}) }));
  return answers(builds.bin(RENDER), ['raster'], lines).map((a, i) => readDrawn(lines[i]!, a, `Vello CPU at t = ${TIMES[i]! / FLICKS} s`).image);
}
/** GPUI's and Vello GPU's frames at TIMES, drawn by one `deep-gpu run`. */
function liveFrames(planted?: string): { gpui: Image[]; gpu: Image[] } {
  const out = dir();
  const replies = gpuReplies(builds.bin(DEEP_GPU), out, TIMES.map((t) => layersCall(sectorsDoc(), LOOK, ['gpui', 'gpu_layer'], { t })), planted ? ['--planted', planted] : []);
  const mains = replies.map((r, i) => readLayers(out, r, `sectors at t = ${TIMES[i]! / FLICKS} s`).get('main'));
  return {
    gpui: mains.map((m, i) => sideOf(m, 'gpui', `GPUI at t = ${TIMES[i]! / FLICKS} s`).image),
    gpu: mains.map((m, i) => sideOf(m, 'gpu_layer', `Vello GPU at t = ${TIMES[i]! / FLICKS} s`).image),
  };
}
/** Every seam problem of a renderer's frames: the tiled frames' edges, and the apart frame showing the channels moved the sectors. */
function frameProblems(frames: Image[], who: string): string[] {
  const p: string[] = [];
  for (const i of TOGETHER) {
    const r = seamProblems(frames[i]!, `${who} at t = ${TIMES[i]! / FLICKS} s`);
    if (r.counted < 8 * 100) p.push(`${who} at t = ${TIMES[i]! / FLICKS} s: only ${r.counted} edge pixels checked`);
    p.push(...r.problems);
  }
  if (!sectorsApart(frames[2]!)) p.push(`${who} at t = 1 s: the sectors are not apart, so the channels did not move them`);
  return p;
}

describe('C8 no conflation seams: eight sectors of one color tile a disc', () => {
  it('C8 every pixel on the shared edges is within one code value of the disc\'s color in Vello CPU, GPUI and Vello GPU, before and after the sectors move apart and back', () => {
    const found = frameProblems(cpuFrames(), 'Vello CPU');
    needsMac();
    const live = liveFrames();
    found.push(...frameProblems(live.gpui, 'GPUI'), ...frameProblems(live.gpu, 'Vello GPU'));
    expect(found, 'the shared edges hold the disc\'s color').toEqual([]);
  }, 1_800_000);

  it('C8 a planted renderer that composites each sector source-over leaves a seam over 20 code values lighter and fails, naming the edge, in each renderer', () => {
    const check = (frames: Image[], who: string): void => {
      const r = seamProblems(frames[0]!, `${who} (planted) at t = 0 s`);
      expect(r.lightest, `${who}: the planted seam is over 20 code values lighter than the disc`).toBeGreaterThan(20);
      expect(r.problems.some((s) => /edge s\d\|s\d: \d+ pixels more than one code value/.test(s)), `${who}: the check fails, naming an edge: ${JSON.stringify(r.problems)}`).toBe(true);
    };
    check(cpuFrames('sectors_source_over'), 'Vello CPU');
    needsMac();
    const live = liveFrames('sectors_source_over');
    check(live.gpui, 'GPUI');
    check(live.gpu, 'Vello GPU');
  }, 1_800_000);
});
