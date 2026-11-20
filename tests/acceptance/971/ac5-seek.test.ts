// AC5 #971.8fcd3c09: A frame reached by seeking to 12 s equals the one played to 12 s by pixel hash, and a frame
// rendered alone equals the same frame in a sequence.
//
// The temple with its cloud sliding in (helpers.ts `templeDoc`, at 960 × 540 and 30 fps, under filmic and
// `local: {strength: 0.5}`) is drawn in one process:
//   played   frames 0 to 360, the sequence: 12 s is frame 360
//   sought   a session opened at 13 s (frame 390) that seeks to 12 s in the same session (`seeks`, #484's)
//   alone    frame 360 alone and frame 150 (5 s) alone, each a session opened at that frame that draws one frame
//   plain    frame 360 alone under the same look without `local`
// The sought frame 360 and both frames drawn alone must have the played sequence's pixel hashes.
//
// A renderer that keeps a history would only show where the frames differ, so the test holds that they do: frame 360 is
// not frame 0, 359 or 390, and frame 150 is not frame 149. And a program that leaves the frame alone has no history to
// keep, so `local` must draw: frame 360 with `local` is not the frame drawn without it. At the base the look's `local`
// is read by nothing and that guard fails.
import { describe, expect, it } from 'vitest';
import { writeJson } from '../418/helpers.ts';
import { AC, HALF, TIMEOUT, drawn, frame, lookWith, requireGpu, runGpu, templeDoc, useGpu, useOut, view3d, type Size } from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: Size = [960, 540];
const FPS = 30;
const AT_12S = 12 * FPS;
const AT_13S = 13 * FPS;
const AT_5S = 5 * FPS;

describe(`${AC[5]} local keeps no history`, () => {
  it(`${AC[5]} the frame at 12 s reached by a seek has the pixel hash of the one played to, and frames drawn alone have the hashes they have in the sequence`, () => {
    requireGpu();
    const doc = writeJson(out(), 'temple.json', templeDoc('temple-seek', { cloud: true }));
    const call = (extra: { from?: number; frames: number; seeks?: { after: number; to: number }[] }, local = true) =>
      view3d({ doc, look: lookWith('filmic', local ? HALF : undefined), size: SIZE, fps: FPS, ...extra });
    const [playedReply, soughtReply, alone12Reply, alone5Reply, plainReply] = runGpu(bin(), out(), [
      call({ from: 0, frames: AT_12S + 1 }),
      call({ from: AT_13S, frames: 2, seeks: [{ after: AT_13S, to: AT_12S }] }),
      call({ from: AT_12S, frames: 1 }),
      call({ from: AT_5S, frames: 1 }),
      call({ from: AT_12S, frames: 1 }, false),
    ]);
    const played = drawn(playedReply!, 'the temple played to 12 s');
    expect(played.map((f) => f.frame), 'the sequence draws frames 0 to 360 in order').toEqual(Array.from({ length: AT_12S + 1 }, (_, n) => n));
    const at = (n: number): string => frame(played, n, 'the temple played to 12 s').pixel_hash;
    const sought = drawn(soughtReply!, 'the temple sought from 13 s to 12 s');
    expect(sought.map((f) => f.frame), 'the seeking session draws frame 390, then frame 360').toEqual([AT_13S, AT_12S]);
    const alone12 = frame(drawn(alone12Reply!, 'frame 360 alone'), AT_12S, 'frame 360 alone').pixel_hash;
    const alone5 = frame(drawn(alone5Reply!, 'frame 150 alone'), AT_5S, 'frame 150 alone').pixel_hash;
    const plain = frame(drawn(plainReply!, 'frame 360 alone without local'), AT_12S, 'frame 360 alone without local').pixel_hash;

    expect(alone12, 'the guard: local {strength: 0.5} draws at 12 s, so its frame is not the one drawn without local').not.toBe(plain);
    expect(at(AT_12S), 'the guard: the frame changes over time, so frame 360 is not frame 0').not.toBe(at(0));
    expect(at(AT_12S), 'the guard: the frame changes over time, so frame 360 is not frame 359').not.toBe(at(AT_12S - 1));
    expect(sought[0]!.pixel_hash, 'the guard: the frame the seek leaves, at 13 s, is not the frame at 12 s').not.toBe(at(AT_12S));
    expect(at(AT_5S), 'the guard: the frame changes over time, so frame 150 is not frame 149').not.toBe(at(AT_5S - 1));

    expect(sought[1]!.pixel_hash, 'the frame reached by seeking to 12 s has the pixel hash of the one played to 12 s').toBe(at(AT_12S));
    expect(alone12, 'frame 360 rendered alone has its pixel hash in the sequence').toBe(at(AT_12S));
    expect(alone5, 'frame 150 rendered alone has its pixel hash in the sequence').toBe(at(AT_5S));
  }, TIMEOUT);
});
