// AC7 #173.5e002fc0: In the combined envelope (#99), with frame history on beside every other pass, the scene holds the
// envelope's totals on the reference Mac, with the window's memory counted in its GPU memory and the window a seek
// renders again in its seek rebuild.
//
// #1903's `envelope` call on this reference Mac's own GPU (the shipped build, no stub): the every-pass scene's stand-in
// is the orbiting scene (helpers: `orbitDoc`, a showpiece whose camera turns 15° a second about six boxes under a
// casting sun) as its writer's payload, full screen on this Mac's display, for the design's run of 60 s, in a look with
// frame history on (antialias, window 8) beside the sun's shadows. The scene's row holds the envelope's totals: its frame
// time PASS against the showpiece class's 10 ms by the five-run rule, and its GPU memory PASS against 256 MB. The
// window's memory is counted in that GPU memory: the row's `gpu_memory.history_bytes` (the window's frames as the device
// reports them inside `peak_bytes`) is at least 4 B per pixel per window frame at a quarter of the display (scale 0.5,
// the lowest a live view takes), and within `peak_bytes`. The window is rendered again in the seek rebuild: the reply's
// `seek_rebuild` gives the window the scene played with (2 to 8 frames: full screen, its memory may shorten it, GPU
// surface) and the window frames its seek rendered before the rebuilt frame showed, the same number, and its `ms` is the
// `seek_rebuild` calibration metric's measured value.
// Off a reference Mac in its conditions, or a five-run INCONCLUSIVE, this is INCONCLUSIVE, never PASS.
// Wrong programs: the base (no `history_bytes`, no `seek_rebuild` report); an envelope that leaves the window out of
// its GPU memory, or a seek rebuild that reuses the window it held.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, AGENT, HISTORY_ON, arr, inconclusive, isObject, look, num, obj, orbitDoc, payload, requireReferenceMac, runGpu, shown, useDir, useGpu, writeJson,
} from './helpers.ts';

const ID = AC[7];
const bin = useGpu();
const dir = useDir();
const SECONDS = 60;
const SHOWPIECE_GPU_MS = 10;
const SHOWPIECE_BYTES = 256_000_000;

describe(`${ID} the combined envelope with frame history on`, () => {
  it(`${ID} with frame history beside every other pass, the scene holds the envelope's frame time and GPU memory on this reference Mac, counting the window's memory, and its seek rebuild renders the window again`, async () => {
    const display = await requireReferenceMac('the combined envelope');
    const out = dir();
    const scene = writeJson(out, 'scene', payload(orbitDoc(display, true, SECONDS)));
    const [reply] = runGpu(bin(), out, [{
      call: 'envelope', look: look({ history: HISTORY_ON }), writer: AGENT, store: join(out, 'store'), scene, render: { seconds: SECONDS, pixels: display },
    }]);
    expect(reply!['code'], `the envelope was answered, not refused: ${shown(reply)}`).toBeUndefined();
    const row = arr(reply!['fixtures'], 'the envelope: fixtures').map((f, i) => obj(f, `fixtures[${i}]`)).find((f) => f['fixture'] === 'scene');
    expect(row, 'the envelope reports the scene').toBeDefined();
    const memory = obj(row!['gpu_memory'], 'the scene: gpu_memory');
    const seek = isObject(reply!['seek_rebuild']) ? reply!['seek_rebuild'] : null;
    expect(memory['history_bytes'], `the scene's GPU memory counts the window's (gpu_memory.history_bytes): ${shown(memory)}`).toBeDefined();
    expect(seek, `the envelope reports its seek rebuild (seek_rebuild): ${shown(reply, 600)}`).not.toBeNull();
    const peak = num(memory['peak_bytes'], 'the scene: gpu_memory.peak_bytes');
    const window = num(memory['history_bytes'], 'the scene: gpu_memory.history_bytes');
    console.log(`${ID}: GPU memory peak ${(peak / 1e6).toFixed(1)} MB with the window's ${(window / 1e6).toFixed(1)} MB; seek rebuild ${shown(seek)}`);
    const frames = num(seek!['window'], 'seek_rebuild.window');
    expect(frames, 'the scene played with a window of 2 to 8 frames').toBeGreaterThanOrEqual(2);
    expect(frames, 'the scene played with a window of 2 to 8 frames').toBeLessThanOrEqual(8);
    expect(window, `the window's frames are counted: at least 4 B a pixel for each of its ${frames} frames at a quarter of the display`).toBeGreaterThanOrEqual(4 * frames * (display[0] * display[1]) / 4);
    expect(window, 'the window\'s memory lies within the GPU memory peak').toBeLessThanOrEqual(peak);
    expect(num(seek!['rendered'], 'seek_rebuild.rendered'), `the seek rebuild renders the whole window of ${frames} again`).toBe(frames);
    const metric = arr(reply!['calibration'], 'the envelope: calibration').map((m, i) => obj(m, `calibration[${i}]`)).find((m) => m['metric'] === 'seek_rebuild');
    expect(num(seek!['ms'], 'seek_rebuild.ms'), 'the seek rebuild\'s time is the seek_rebuild metric\'s measured value').toBe(num(metric?.['measured'], 'the seek_rebuild metric: measured'));

    const time = obj(row!['frame_time'], 'the scene: frame_time');
    expect(num(time['limit_ms'], 'frame_time.limit_ms'), 'the scene is held to the showpiece class\'s 10 ms').toBe(SHOWPIECE_GPU_MS);
    expect(num(memory['limit_bytes'], 'gpu_memory.limit_bytes'), 'and to its 256 MB').toBe(SHOWPIECE_BYTES);
    const runs = arr(time['runs'], 'frame_time.runs').map((r) => shown(r, 200)).join(', ');
    console.log(`${ID}: frame time ${String(time['verdict'])} (${runs}); GPU memory ${String(memory['verdict'])}`);
    expect([time['verdict'], memory['verdict']], `the scene's frame time and GPU memory are judged: ${shown(row)}`).not.toContain('FAIL');
    if (time['verdict'] === 'INCONCLUSIVE' || memory['verdict'] === 'INCONCLUSIVE') inconclusive(`the envelope reads frame time ${String(time['verdict'])}, GPU memory ${String(memory['verdict'])}: ${shown(row)}`);
    expect(time['verdict'], 'with frame history on, the scene holds the showpiece class\'s frame time by the five-run rule').toBe('PASS');
    expect(memory['verdict'], 'with the window counted, the scene holds the showpiece class\'s GPU memory').toBe('PASS');
  }, 3_600_000);
});
