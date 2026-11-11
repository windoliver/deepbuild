// #1399.34aa835f: "Two matching frames of one flat light grey (luma 0.94) read BLOCKED, reason blank, where the
// dark-frame guard on main alone passes them; two matching black frames still read BLOCKED"
//
// The golden comparison is `deep-gpu run`'s `golden` call (#380; crates/deep-gpu-layer/src/golden.rs) with a PNG
// snapshot, after your `decide` blessed the same frame as the fixture's golden, on the noop backend so the run reads no
// GPU (the fingerprint is the same for the blessing and the comparison). Its reply is `{verdict, reason, …}`. The
// frames are 64 × 64 PNGs written at test time. One test, in this order:
//   - two matching frames of one flat light grey, sRGB 240 in every channel (luma (0.2126 R + 0.7152 G + 0.0722 B) ÷
//     255 = 0.941, the 8-bit grey nearest 0.94): one color, no pixel off the modal color, so BLOCKED, reason blank;
//   - two matching black frames: still BLOCKED, reason blank (the dark-frame guard's case, kept);
//   - the control: two matching frames of 64 colors in 8 × 8 tiles (every color 1/64 of the pixels, so 63/64 of them
//     off the modal color, and none dark) are compared, and read PASS: the guard leaves a real frame to the oracle.
// At the base only the dark-frame guard stands before the oracle: the grey pair is compared and reads PASS.

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { bless, golden, type JsonObject, runGpu, show, sub, useBinary, useTemp, writePng } from './helpers.ts';

const AC = '#1399.34aa835f';
const bin = useBinary('deep-gpu');
const temp = useTemp();

const SIZE = 64;
const GREY = 240;

describe(`${AC} a golden comparison counts only when both frames hold 32 colors and 5% of pixels off the modal color`, () => {
  it(`${AC} two matching flat light grey frames read BLOCKED, reason blank; two matching black frames still read BLOCKED`, () => {
    const out = temp();
    const store = sub(out, 'goldens');
    const frames = sub(out, 'frames');
    const grey = writePng(join(frames, 'grey.png'), SIZE, SIZE, () => [GREY, GREY, GREY]);
    const black = writePng(join(frames, 'black.png'), SIZE, SIZE, () => [0, 0, 0]);
    // 64 colors, one per 8 × 8 tile: red and green step with the tile's column and row, blue stays light.
    const tiles = writePng(join(frames, 'tiles.png'), SIZE, SIZE, (x, y) => [96 + 16 * Math.floor(x / 8), 96 + 16 * Math.floor(y / 8), 200]);
    const replies = runGpu(bin(), out, [
      bless(store, 'grey', grey), golden(store, 'grey', grey),
      bless(store, 'black', black), golden(store, 'black', black),
      bless(store, 'tiles', tiles), golden(store, 'tiles', tiles),
    ]);
    const [blessedGrey, greyReply, blessedBlack, blackReply, blessedTiles, tilesReply] = replies as [JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject];
    for (const [b, name] of [[blessedGrey, 'grey'], [blessedBlack, 'black'], [blessedTiles, 'tiles']] as const) {
      expect(b['outcome'], `your decision blesses the ${name} frame as its golden: ${show(b)}`).toBe('decided');
    }

    expect(greyReply['verdict'], `two matching flat light grey frames (luma 0.94) are no comparison: ${show(greyReply)}`).toBe('BLOCKED');
    expect(greyReply['reason'], `the grey pair reads reason blank: ${show(greyReply)}`).toBe('blank');

    expect(blackReply['verdict'], `two matching black frames still read BLOCKED: ${show(blackReply)}`).toBe('BLOCKED');
    expect(blackReply['reason'], `the black pair reads reason blank: ${show(blackReply)}`).toBe('blank');

    expect(tilesReply['verdict'], `the control: two matching frames of 64 colors, 63/64 of their pixels off the modal color, are compared and pass: ${show(tilesReply)}`).toBe('PASS');
  });
});
