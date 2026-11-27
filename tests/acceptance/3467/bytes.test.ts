// AC5 #3467.1a19a5d4: A 3840 × 2160 fixture encoded as the first is, played in a 640 × 360 player: frame bytes held
// by the app and the worker together stay under 8 MB, the bound #395 states (drafted). A planted worker that keeps
// every picture it decodes fails, naming the bytes.
//
// The recording (fixtures.ts, `REORDERED_4K`: criterion 1's encode at 3840 × 2160) is one image@1 in a 640 × 360 box
// at zoom 1, so the player decodes at 640 × 360, where a frame is 345,600 bytes. One `deep-canvas-render session`
// presents each of its 250 frames once, in order. The item's `players` entry carries `frame_bytes: {app, worker}`,
// the most bytes of decoded frames each side held at one time; their sum must be under 8,000,000, and each side must
// count at least one frame (the app holds the frame on screen, the worker a picture kept ahead of its turn). The
// same session with `planted: "keeps_every_picture"` must fail the same check, naming the bytes.

import { describe, expect, it } from 'vitest';
import { REORDERED_4K, frameTime } from './fixtures.ts';
import { ITEM, TIMEOUT, board, makeFixture, plantedRan, render, sessionLine, stored, useBinary, useTemp } from './helpers.ts';
import { frameBytesOf, judgeBytes, type JsonObject } from './judges.ts';

const renderBin = useBinary('deep-canvas-render');
const temp = useTemp('bytes');
const FRAMES = REORDERED_4K.frames;
const PLAYER: [number, number] = [640, 360];
/** One NV12 frame at the player's size: 1.5 bytes a pixel. */
const FRAME_BYTES = (PLAYER[0] * PLAYER[1] * 3) / 2;
/** 8 MB, decimal: the design writes MiB where it means 2^20 bytes. */
const LIMIT = 8_000_000;
const PLANTED = 'keeps_every_picture';
const TIMES = Array.from({ length: FRAMES }, (_, k) => frameTime(k));

let made: { doc: JsonObject; store: string } | undefined;
function fixture(): { doc: JsonObject; store: string } {
  if (made === undefined) {
    const dir = temp();
    const { store, sha } = stored(dir, makeFixture(REORDERED_4K, dir));
    made = { doc: board('bytes', sha, PLAYER, 12), store };
  }
  return made;
}

describe('AC5 #3467.1a19a5d4 a 4K recording in a 640 × 360 player holds under 8 MB of frames', () => {
  it('AC5 #3467.1a19a5d4 played through, the frame bytes the app and the worker hold together stay under 8 MB', () => {
    const bin = renderBin();
    const { doc, store } = fixture();
    const [answer] = render(bin, 'session', [sessionLine(doc, store, TIMES)], 'session playing the 4K recording in a 640 × 360 player');
    console.log(`AC5 #3467.1a19a5d4 frame bytes held: ${JSON.stringify(frameBytesOf(answer, ITEM, 'session'))}`);
    expect(judgeBytes(answer, ITEM, FRAMES, LIMIT, FRAME_BYTES), 'the app and the worker together hold under 8,000,000 bytes of frames').toBeNull();
  }, TIMEOUT);

  it('AC5 #3467.1a19a5d4 a planted worker that keeps every picture it decodes fails the same check, naming the bytes', () => {
    const bin = renderBin();
    const { doc, store } = fixture();
    const [answer] = render(bin, 'session', [sessionLine(doc, store, TIMES, PLANTED)], `session playing the 4K recording, planted ${PLANTED}`);
    plantedRan(answer, PLANTED);
    const failure = judgeBytes(answer, ITEM, FRAMES, LIMIT, FRAME_BYTES);
    expect(failure ?? 'no failure: the planted worker passed the check', 'the check fails on the planted worker, naming the bytes').toMatch(/together held \d+ bytes of frames .+, not under 8000000/);
    const held = frameBytesOf(answer, ITEM, 'session');
    console.log(`AC5 #3467.1a19a5d4 planted ${PLANTED}: frame bytes held: ${JSON.stringify(held)}`);
    expect(typeof held !== 'string' && held.worker >= LIMIT, `the planted worker alone holds 8 MB or more: ${JSON.stringify(held)}`).toBe(true);
  }, TIMEOUT);
});
