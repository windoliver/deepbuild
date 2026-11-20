// AC1 (README: Criteria to tests): the 200-frame 512 × 512 GIF played through all of its frames by `frames` at
// 60 Hz, what it holds read at every vsync, and the planted decoder that holds every frame.

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BIG, BIG_DELAYS, BIG_FRAME_BYTES, LOOK, ONCE, PERIOD, animDoc, animItem, barsShown, bigGif, decodePng, frameAt, one, put, sampled,
  scratch, useRender, vsyncsOf, type JsonObject, type Vsync,
} from './helpers.ts';

const render = useRender();
const dir = scratch('memory');
const store = join(dir, 'store');
let made: string | undefined;
/** The GIF, put in the store once (a few seconds to encode); its hash. */
const asset = (): string => (made ??= put(store, bigGif()));

/** 4 s at 60 Hz: the GIF's 200 frames of 20 ms show between vsyncs 0 and 239. */
const VSYNCS = 240;
/** The vsyncs captured, each inside one frame's 20 ms rather than at its edge: frames 0, 20, 40 … 180 and 198. */
const CAPTURED = [1, 25, 49, 73, 97, 121, 145, 169, 193, 217, 238];
/** "Under 3 frames of pixels": at most three of its 512 × 512 frames, 3,145,728 B; and "under 4 MB", under 4,000,000 B. */
const THREE_FRAMES = 3 * BIG_FRAME_BYTES;
const FOUR_MB = 4_000_000;

function request(hash: string, o: { captures?: string; planted?: string } = {}): JsonObject {
  const doc = animDoc('big-1489', [BIG.side, BIG.side], [animItem('gif', 0, hash, [0, 0, BIG.side, BIG.side], ONCE)]);
  const out: JsonObject = { doc, look: LOOK, store, view: { zoom: 1 }, refresh_hz: 60, vsyncs: VSYNCS };
  if (o.captures !== undefined) {
    mkdirSync(o.captures, { recursive: true });
    out['captures'] = CAPTURED.map((vsync) => ({ vsync, out: join(o.captures!, `${vsync}.png`) }));
  }
  if (o.planted !== undefined) out['planted'] = o.planted;
  return out;
}

/** The play: every vsync shows the frame the GIF's delays give at its t, so each of the 200 frames shows in turn. */
function playProblems(vsyncs: readonly Vsync[]): string[] {
  const out: string[] = [];
  for (const v of vsyncs) {
    const want = frameAt(BIG_DELAYS, v.t, false);
    const gif = v.animations.get('gif')!;
    if (gif.drawn !== want) out.push(`vsync ${v.k} (t ${v.t}) shows frame ${String(gif.drawn)} of the GIF, not frame ${want}, the one its delays give at t`);
  }
  const shown = new Set(vsyncs.map((v) => v.animations.get('gif')!.drawn));
  if (shown.size !== BIG.frames) out.push(`the run showed ${shown.size} of the GIF's ${BIG.frames} frames`);
  return out;
}

/** The captured vsyncs read from their pixels: each shows, in its eight bars, the frame its delays give at t. */
function pixelProblems(captures: string): string[] {
  return CAPTURED.flatMap((k) => {
    const want = frameAt(BIG_DELAYS, k * PERIOD, false);
    const got = barsShown(decodePng(readFileSync(join(captures, `${k}.png`))));
    return got === want ? [] : [`vsync ${k}'s capture shows ${typeof got === 'number' ? `frame ${got}` : got}, not frame ${want}`];
  });
}

/** AC1's check, at every vsync: the GIF holds at most three frames of its pixels, and under 4 MB. Each vsync that holds more is named. */
function heldProblems(vsyncs: readonly Vsync[]): string[] {
  return vsyncs
    .filter((v) => { const held = v.animations.get('gif')!.held; return held > THREE_FRAMES || held >= FOUR_MB; })
    .map((v) => `vsync ${v.k} (t ${v.t}): the GIF holds ${v.animations.get('gif')!.held} B of pixels, over three of its 512 × 512 frames (${THREE_FRAMES} B) or 4 MB`);
}

const most = (vsyncs: readonly Vsync[]): number => Math.max(...vsyncs.map((v) => v.animations.get('gif')!.held));

// Names are plain literals, so the trace lane reads them, and the criterion's ID, unrun.
describe('AC1 #1489.c22ffe3a A 200-frame 512 × 512 GIF holds under 3 frames of pixels, under 4 MB. A planted decoder that holds all frames takes 200 MB and fails', () => {
  it('AC1 #1489.c22ffe3a the 200-frame 512 × 512 GIF drawn 1:1 and played through all its frames by frames at 60 Hz: every vsync shows the frame its delays give at t, and at every vsync the GIF holds at most 3 frames of pixels (3,145,728 B), under 4 MB', () => {
    const bin = render();
    const captures = join(dir, 'honest');
    const vsyncs = vsyncsOf(one(bin, 'frames', request(asset(), { captures }), 1_800_000), 'frames', VSYNCS, 60, ['gif']);
    expect(playProblems(vsyncs), 'the GIF plays at its own delays: each vsync shows the frame they give at t').toEqual([]);
    expect(pixelProblems(captures), 'the captured vsyncs show those frames, read from their pixels').toEqual([]);
    console.log(`AC1: the most the GIF held at one vsync: ${most(vsyncs)} B (three frames: ${THREE_FRAMES} B)`);
    expect(heldProblems(vsyncs), 'at every vsync the GIF holds under 3 frames of pixels, under 4 MB').toEqual([]);
  });

  it(`AC1 #1489.c22ffe3a planted decoder_holds_all_frames: a decoder that holds all 200 frames takes 200 MB, by its own reading and by its processes' resident memory above the honest run's, and the same check fails on it, naming the vsync`, async () => {
    const bin = render();
    const honest = await sampled(bin, 'frames', request(asset()), 1_800_000);
    const planted = await sampled(bin, 'frames', request(asset(), { planted: 'decoder_holds_all_frames' }), 1_800_000);
    const hv = vsyncsOf(honest.answer, 'frames', VSYNCS, 60, ['gif']);
    const pv = vsyncsOf(planted.answer, 'frames, planted decoder_holds_all_frames', VSYNCS, 60, ['gif']);
    console.log(`AC1: resident at its most, the honest run's processes ${honest.peak} B (${honest.samples} readings), the planted run's ${planted.peak} B (${planted.samples} readings); held at one vsync at most, honest ${most(hv)} B, planted ${most(pv)} B`);
    expect(playProblems(hv), 'the honest run plays the GIF at its own delays').toEqual([]);
    expect(heldProblems(hv), 'the honest run, which the planted one is compared with, holds under 3 frames').toEqual([]);
    expect(playProblems(pv), 'the planted decoder plays the GIF as the honest one does: what it holds is its only wrong').toEqual([]);
    expect(most(pv), 'the planted decoder holds all 200 frames: 200 MB by its own reading').toBeGreaterThanOrEqual(200_000_000);
    expect(planted.peak - honest.peak, 'and its processes hold 200 MB more than the honest run\'s (5% allowed for the two processes\' differences), so the reading is what the memory holds').toBeGreaterThanOrEqual(190_000_000);
    const problems = heldProblems(pv);
    expect(problems.length, 'AC1\'s check fails on the planted decoder').toBeGreaterThan(0);
    expect(problems[0], 'naming the vsync and what it held').toMatch(/^vsync \d+ \(t \d+\): the GIF holds \d+ B/);
  });
});
