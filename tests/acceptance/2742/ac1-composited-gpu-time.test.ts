// AC1 #2742.f2fad73c: On any Mac, `film2d` at 1920 × 1080, 60 frames at 60 fps, over a document whose one writer layer
// holds a group with `passes` (so the GPU-layer compositor draws the layer) around marks that are heavy for the GPU to
// draw and light for the CPU to encode, followed in draw order by marks that are heavy for the CPU to encode and light
// for the GPU to draw; and over its twin, the same document with the group's `passes` removed, so nothing is
// composited and every mark draws in the frame's own encode. The composited side's median `gpu_ms` is at least 0.9
// times the twin's, since the compositor does all of the twin's GPU work and more. At the base the composited side
// reads under that bound.
//
// The documents are helpers.ts `filmDoc` (README: The fixture): 64 full-frame washes at half opacity inside the group
// `heavy`, then 4,000 specks of 1.5 px radius in a 400 × 160 px corner. The twin draws every wash and speck in the
// frame's own encode, so its `gpu_ms` holds the washes' GPU work. The composited side draws the washes on the
// compositor's own command buffers, then spends its CPU on the specks before the frame's own encode ends; at the base
// the washes are done by then, so its `gpu_ms` reads well under the twin's. A right program times those submissions
// on the GPU and reads at least the twin's work. Each side plays once, in a `deep-gpu run` process of its own, the
// twin first (README: The fixture).
import { describe, expect, it } from 'vitest';
import { AC, FIXTURE, FPS, FRAMES, SIZE, described, filmCall, filmDoc, gpuReadings, median, requireMetal, runGpu, useGpu, useOut } from './helpers.ts';

const bin = useGpu();
const out = useOut();

describe('the composited side and its twin', () => {
  it(`${AC[1]} film2d at ${SIZE[0]} × ${SIZE[1]}, ${FRAMES} frames at ${FPS} fps: the composited side's median gpu_ms is at least 0.9 times its twin's, where nothing is composited`, () => {
    requireMetal();
    const [twin] = runGpu(bin(), out(), [filmCall(filmDoc(false))]);
    const [composited] = runGpu(bin(), out(), [filmCall(filmDoc(true))]);
    const t = gpuReadings(twin!, 'the twin');
    const c = gpuReadings(composited!, 'the composited side');
    const ratio = median(c) / median(t);
    const readings = `the composited side (the group with passes, ${FIXTURE.washes} washes then ${FIXTURE.specks} specks): ${described(c)}\n`
      + `the twin (the group's passes removed): ${described(t)}\n`
      + `ratio of medians ${ratio.toFixed(3)}`;
    expect(median(c), `the composited side's median gpu_ms is at least 0.9 × the twin's (${(0.9 * median(t)).toFixed(3)} ms), since the compositor does all of the twin's GPU work and more; ${readings}`)
      .toBeGreaterThanOrEqual(0.9 * median(t));
  }, 3_600_000);
});
