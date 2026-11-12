// AC4 #173.52d132b9: A 1 px wire fence turning at 10° a second flickers, by the flicker check's measure over 120 moving
// frames, at most a quarter as much as at one sample without history; and at scale 0.5 with upscale, a resolution chart
// keeps at least 80% of the full-resolution render's contrast at 1 px detail once the window fills, against under 50%
// for the spatial upscale.
//
// The fence (helpers: `fenceDoc`): grey wires 1 px thick (0.015 m at 10 m, 67 px/m) on a black sky, the camera's orbit
// turning 10° a second, drawn by `view3d` for frames 0–127 at 60 fps with frame history on (antialias, window 8, the
// look's default rejection) and with history off at one sample. "Flickers, by the flicker check's measure" is the
// check's own change rule (crates/deep-canvas/src/film_audit.rs): a pixel changes from one frame to the next when its
// relative luminance moves by more than 0.1 with the darker frame below 0.80; how much the view flickers is the count of
// such pixel changes over the 120 moving frames 8–127. With history it is at most a quarter of the count without; the
// count without is at least 1,000, so the fence does flicker at one sample.
// The chart (helpers: `chartDoc`): 100 white bars 1 px wide on black, one on each even column, the camera panning along
// them so the view moves and each bar keeps its column. Frame 16 at 30 fps (the window of 8 filled) is drawn three
// ways: at full resolution with history off (scale 1); with `history: {mode: upscale}` at the look's `scale: 0.5`,
// played from frame 0; and with history off through #386's spatial upscale at internal scale 0.5 (edge adaptive,
// sharpen 0.2). Contrast at 1 px detail is the mean relative luminance of the bars' columns less that of the columns
// between them, over rows 40–259. The temporal upscale keeps at least 80% of the full-resolution contrast; the spatial
// one under 50%. The temporal leg reports drawing through `upscale: temporal` at internal scale 0.5.
// Wrong programs: the base (no history: the fence flickers as much with it on; no temporal upscale); a resolve that
// reads one frame; an upscale that rebuilds nothing from the window.
import { describe, expect, it } from 'vitest';
import {
  AC, CHART, FENCE, HISTORY_OFF, HISTORY_ON, HISTORY_UPSCALE, barContrast, chartDoc, fenceDoc, flickerChanges, frameAt, framesOf, look, lumaOf, readPng,
  requireMetal, runGpu, surfaceOf, useDir, useGpu, view3dCall, writeJson,
} from './helpers.ts';

const ID = AC[4];
const bin = useGpu();
const dir = useDir();
const J = CHART.judged;

describe(`${ID} frame history steadies a turning wire fence and rebuilds 1 px detail from half resolution`, () => {
  it(`${ID} the fence flickers at most a quarter as much with history as at one sample without, and the chart upscaled from 0.5 keeps at least 80% of full-resolution contrast against under 50% spatially`, () => {
    requireMetal();
    const out = dir();
    // The fence.
    const fence = writeJson(out, 'fence', fenceDoc());
    const fenceCall = (history: typeof HISTORY_ON) => view3dCall({ doc: fence, look: look({ history }), size: FENCE.size, fps: FENCE.fps, frames: FENCE.frames, capture: 'every', targets: ['final'] });
    const [on, off] = runGpu(bin(), out, [fenceCall(HISTORY_ON), fenceCall(HISTORY_OFF)]).map((r, i) => framesOf(r, ['the fence with history', 'the fence at one sample without history'][i]!));
    const judged = Array.from({ length: FENCE.frames - FENCE.judgedFrom }, (_, i) => FENCE.judgedFrom + i);
    for (const n of judged) {
      const h = frameAt(on!, n, 'the fence with history').history;
      expect(h, `the fence with history: frame ${n} reports its frame history`).not.toBeNull();
      expect(h!.mode, `the fence with history: frame ${n}, moving, drew with history`).toBe('antialias');
    }
    const luma = (frames: typeof on, what: string): Float32Array[] => judged.map((n) => lumaOf(readPng(out, frameAt(frames!, n, what).final, `${what}: frame ${n}`)));
    const withHistory = flickerChanges(luma(on, 'the fence with history'));
    const without = flickerChanges(luma(off, 'the fence without history'));
    console.log(`${ID}: the fence over frames ${judged[0]}–${judged.at(-1)}: ${withHistory} pixel changes with history, ${without} at one sample without (${(withHistory / Math.max(without, 1)).toFixed(3)}×)`);
    expect(without, 'the fence flickers at one sample without history (at least 1,000 pixel changes over the 120 frames)').toBeGreaterThanOrEqual(1000);
    expect(withHistory, `with history the fence flickers at most a quarter as much as at one sample without (${withHistory} against ${without})`).toBeLessThanOrEqual(without / 4);

    // The chart.
    const chart = writeJson(out, 'chart', chartDoc());
    const common = { doc: chart, size: CHART.size, fps: CHART.fps, capture: [J], targets: ['final' as const] };
    const names = ['the chart at full resolution', 'the chart upscaled from 0.5 by frame history', 'the chart through the spatial upscale at 0.5'];
    const replies = runGpu(bin(), out, [
      view3dCall({ ...common, look: look({ history: HISTORY_OFF }), from: J, frames: 1 }),
      view3dCall({ ...common, look: look({ history: HISTORY_UPSCALE, scale: 0.5 }), frames: J + 1 }),
      view3dCall({ ...common, look: look({ history: HISTORY_OFF }), from: J, frames: 1, surface: { internal_scale: 0.5, upscale: 'edge_adaptive', sharpen: 0.2 } }),
    ]);
    const [full, temporal, spatial] = replies.map((r, i) => frameAt(framesOf(r, names[i]!), J, names[i]!));
    const h = temporal!.history;
    expect(h, `${names[1]}: frame ${J} reports its frame history`).not.toBeNull();
    expect(h!.mode, `${names[1]}: frame ${J} drew with the temporal upscale`).toBe('upscale');
    expect(h!.window.length, `${names[1]}: frame ${J}'s window is full (8 grid frames)`).toBe(8);
    expect(surfaceOf(replies[1]!), `${names[1]}: it drew through the temporal upscale at internal scale 0.5`).toEqual({ internal_scale: 0.5, upscale: 'temporal' });
    const [cFull, cTemporal, cSpatial] = [full!, temporal!, spatial!].map((f, i) => barContrast(readPng(out, f.final, names[i]!)));
    console.log(`${ID}: the chart's 1 px contrast: full ${cFull!.toFixed(4)}, temporal ${cTemporal!.toFixed(4)} (${(cTemporal! / cFull!).toFixed(3)}), spatial ${cSpatial!.toFixed(4)} (${(cSpatial! / cFull!).toFixed(3)})`);
    expect(cFull, 'the full-resolution render resolves the 1 px bars (contrast at least 0.9)').toBeGreaterThanOrEqual(0.9);
    expect(cTemporal! / cFull!, 'the temporal upscale from 0.5 keeps at least 80% of the full-resolution contrast at 1 px detail').toBeGreaterThanOrEqual(0.8);
    expect(cSpatial! / cFull!, 'the spatial upscale from 0.5 keeps under 50% of it').toBeLessThan(0.5);
  }, 3_600_000);
});
