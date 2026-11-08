// #465.fd08a941: "A mirrored frame reached by seeking equals the played one by pixel hash, and a mirror inside a mirror
// draws its fallback"
//
// The fixture (helpers.ts's `mirrors`, 640 × 360): two mirrors facing each other across a room, the classic infinite mirror.
// The camera stands between them looking at the front mirror `m1` (a plate on the wall at z = −3); the back mirror `m2`
// (a green plate at z = +3) is behind the camera, so the view sees one mirror directly (Material: mirror, "at most one
// per view") and sees `m2` only inside `m1`. A red box slides across the floor between them over 2 s. Each plate's
// material carries `mirror: {strength: 1, blur: 0, plane: <its own part>}`.
//
// Seek: the film played from frame 0 at 30 fps, and frames 17 and 44 each opened cold by a seek (`from`): one pixel hash
// each. It isn't vacuous: m1's mirror changes frame 17 (the same document with m1's `mirror` field removed has another
// hash) and the box moves (frames 17 and 44 differ).
// Fallback: "its fallback" is read as the part drawn by its own material without the `mirror` field (the design names
// no other fallback). So the frame with both mirrors equals, within one code value per channel at every pixel, the frame
// where m2's material has no `mirror`; and m2 really shows inside m1: without m2 at all, at least 1% of the pixels change
// by more than 2 codes. Wrong programs: a mirror that recurses (m2 inside m1 shows m2's own reflection of the room), one
// that draws a mirror inside a mirror as a hole or black, a mirror pass that keeps state from an earlier frame.
import { describe, expect, it } from 'vitest';
import { AC, type Variant, changedShare, frameAt, framesOf, look3d, mirrors, readFinal, requireGpu, runGpu, useGpu, useOut, view3d, writeJson } from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [640, 360];
const LOOK = look3d('mirror-465');

describe(`${AC[1]} a planar mirror seeked equals played, and a mirror inside a mirror draws its fallback`, () => {
  it(`${AC[1]} the mirrored film's frames 17 and 44 reached by seeking have the played frames' pixel hashes, and the mirror and the motion show`, () => {
    requireGpu();
    const dir = out();
    const doc = writeJson(dir, 'both', mirrors('both', SIZE));
    const plain = writeJson(dir, 'm1-plain', mirrors('m1_plain', SIZE));
    const [played, s17, s44, unmirrored] = runGpu(bin(), dir, [
      view3d({ doc, look: LOOK, size: SIZE, frames: 60, fps: 30 }),
      view3d({ doc, look: LOOK, size: SIZE, from: 17, frames: 1, fps: 30 }),
      view3d({ doc, look: LOOK, size: SIZE, from: 44, frames: 1, fps: 30 }),
      view3d({ doc: plain, look: LOOK, size: SIZE, from: 17, frames: 1, fps: 30 }),
    ]);
    const play = framesOf(played!, 'the played film');
    const p17 = frameAt(play, 17, 'played').pixel_hash; const p44 = frameAt(play, 44, 'played').pixel_hash;
    expect(frameAt(framesOf(s17!, 'the seek to 17'), 17, 'seeked').pixel_hash, 'frame 17 seeked equals frame 17 played').toBe(p17);
    expect(frameAt(framesOf(s44!, 'the seek to 44'), 44, 'seeked').pixel_hash, 'frame 44 seeked equals frame 44 played').toBe(p44);
    expect(p17, 'the box moves between frames 17 and 44').not.toBe(p44);
    expect(frameAt(framesOf(unmirrored!, 'm1 without its mirror'), 17, 'unmirrored').pixel_hash, 'm1\'s mirror changes the frame').not.toBe(p17);
  });

  it(`${AC[1]} m2, seen only inside m1, draws its fallback: the frame equals, within one code value, the frame where m2 has no mirror, and m2 shows`, () => {
    requireGpu();
    const dir = out();
    const variants: Variant[] = ['both', 'm2_plain', 'no_m2'];
    const replies = runGpu(bin(), dir, variants.map((v) => view3d({ doc: writeJson(dir, v, mirrors(v, SIZE)), look: LOOK, size: SIZE, frames: 1, capture: [0], targets: ['final'] })));
    const [both, m2Plain, noM2] = replies.map((r, i) => readFinal(dir, frameAt(framesOf(r, variants[i]!), 0, variants[i]!), variants[i]!));
    const worse: string[] = [];
    for (let i = 0; i < both!.rgba.length && worse.length < 8; i += 4) {
      const d = Math.max(...[0, 1, 2].map((c) => Math.abs(both!.rgba[i + c]! - m2Plain!.rgba[i + c]!)));
      if (d > 1) worse.push(`pixel (${(i / 4) % SIZE[0]}, ${Math.floor(i / 4 / SIZE[0])}) differs by ${d} codes`);
    }
    expect(worse, 'with both mirrors, the frame equals the frame where m2 is drawn without its mirror (its fallback), within one code value').toEqual([]);
    const shows = changedShare(m2Plain!, noM2!, 2);
    console.log(`${AC[1]}: m2 inside m1 covers ${(shows * 100).toFixed(2)}% of the frame`);
    expect(shows, 'm2 shows inside m1: without m2, at least 1% of the pixels change by more than 2 codes').toBeGreaterThanOrEqual(0.01);
  });
});
