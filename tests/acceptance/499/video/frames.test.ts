// AC3 #499.65f30d78: A 30 fps recording placed as an image with start 2 s, in 1 s and rate 2 shows source frame 90 at
// 3 s and frame 120 at 3.5 s by decoded-frame hash, whether played or seeked; a crop channel that runs from the full
// frame to its top-left quarter over 1 s shows exactly that quarter at its end; and a 2D shot that pushes 2× onto the
// recording keeps a cursor ring keyed at a recorded click's image anchor within 0.5 px of the click's pixel through
// the whole push.
//
// Through `deep-show run`: the recording (README: Fixtures) is put in the evidence store and placed as an image@1 in a
// film. Played and seeked are #488's `determinism` sides (play: every display frame from 0 in order; seek: a jump back
// from t + 1 s); each side's `video` block gives the SHA-256 of the decoded planes the item shows, compared with
// ffmpeg's own decode of the same file. The crop and the push are read from the canonical snapshots `eval` draws.
// The criterion names no wrong program; the base fails every part (BASE-FAILURE.txt).
// The push clause's test is the blind redraft in redraft/push-redraft.test.ts, swapped in at the owner's word on
// 2026-11-09 (redraft/DISPUTE.md); this file keeps the frames and the crop.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FLICKS, REC, TIMEOUT, asset, camera2d, compared, determinismCall, documentOf, evalCall, evaluated, fl, i420Rgb, nameFrame,
  none, pixel, present, presented, putEvidence, recordingMp4, referenceFrames, runShow, scenario, secs, sha256, snapshotPicture,
  useBinary, useTemp, videoItem, type Image,
} from './helpers.ts';

const showBin = useBinary('deep-show');
const temp = useTemp('frames');
const FRAME = FLICKS / 30;

/** The recording made, put in a fresh evidence store, and ffmpeg's decode of every frame. */
function setUp(): { evidence: string; sha: string; refs: Buffer[]; hashes: string[] } {
  const dir = temp();
  const path = join(dir, 'recording.mp4');
  recordingMp4(path);
  const evidence = temp();
  const sha = putEvidence(evidence, readFileSync(path));
  const refs = referenceFrames(path, REC.w, REC.h, REC.count);
  const hashes = refs.map((f) => sha256(f));
  // The hashes can tell the frames around 90 and 120 apart, so an off-by-one fails.
  for (const k of [89, 90, 91, 119, 120, 121]) expect(hashes.indexOf(hashes[k]!), `fixture: source frame ${k} differs from every other`).toBe(k);
  return { evidence, sha, refs, hashes };
}

describe(`${AC[3]} a recording's frames on image@1: retimed frames, a crop channel and a 2D push that keeps a ring on a click`, () => {
  it(`${AC[3]} start 2 s, in 1 s, rate 2: source frame 90 at 3 s and 120 at 3.5 s by decoded-frame hash, played and seeked; the crop channel shows exactly the top-left quarter at its end`, () => {
    const { evidence, sha, refs, hashes } = setUp();
    const size: [number, number] = [REC.w / 2, REC.h / 2];
    const doc = documentOf('frames', 'film', size, [
      camera2d(size),
      videoItem('rec', sha, [0, 0, size[0], size[1]], { start: '2s', in: fl(1), rate: [2, 1] }, { crop: [0, 0, REC.w, REC.h], sampling: 'nearest' }),
    ], { rec: asset(sha) }, {
      channels: {
        crop_w: { target: 'items/rec/params/crop/2', type: 'f32', keys: { k0: { t: '2s', value: REC.w, interp: 'linear' }, k1: { t: '3s', value: REC.w / 2, interp: 'linear' } } },
        crop_h: { target: 'items/rec/params/crop/3', type: 'f32', keys: { k0: { t: '2s', value: REC.h, interp: 'linear' }, k1: { t: '3s', value: REC.h / 2, interp: 'linear' } } },
      },
    }, { span: '5s', frame_rate: [30, 1] });
    const replies = runShow(showBin(), scenario(evidence, [present(DOC.a, doc), determinismCall(DOC.a, [fl(3), fl(3.5)]), evalCall(DOC.a, fl(3), { pixels: true })]), 'the retimed recording');
    presented(replies[0]!, 'the film with the recording');

    // Played and seeked: source time = in + (t − start) × rate = 1 + (3 − 2) × 2 = 3 s → frame 90, and 4 s → frame 120.
    const failures: string[] = [];
    const sides = compared(replies[1]!, 'rec', 'determinism at 3 s and 3.5 s');
    expect(sides.map((s) => s.t), 'determinism answers 3 s and 3.5 s').toEqual([fl(3), fl(3.5)]);
    for (const [s, want] of sides.map((x, i) => [x, [90, 120][i]!] as const)) {
      for (const side of ['play', 'seek'] as const) {
        const got = s[side].planes;
        if (got !== hashes[want]) failures.push(`${side === 'play' ? 'played' : 'seeked'} to ${secs(s.t)}: the item shows ${nameFrame(hashes, got)}, not source frame ${want}`);
      }
    }
    none(failures, 'source frames 90 and 120 by decoded-frame hash, played and seeked');

    // The crop's end, 3 s: the top-left 160 × 120 of source frame 90, drawn 1:1, pixel for pixel within 6 code values
    // (under half the 16 between neighbouring block levels, so a shift, a scale or another frame fails).
    const img = snapshotPicture(evidence, evaluated(replies[2]!, 'eval at 3 s'), 'eval at 3 s');
    expect([img.width, img.height], 'the snapshot is the document\'s size').toEqual(size);
    const off = (pic: Image, dx: number, dy: number): string[] => {
      const bad: string[] = [];
      for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
        const want = i420Rgb(refs[90]!, REC.w, REC.h, x + dx, y + dy);
        const got = pixel(pic, x, y);
        const d = Math.max(...got.map((v, c) => Math.abs(v - want[c]!)));
        if (d > 6) bad.push(`(${x}, ${y}) is (${got.join(', ')}), source frame 90's (${x + dx}, ${y + dy}) is (${want.join(', ')})`);
      }
      return bad;
    };
    const bad = off(img, 0, 0);
    none(bad.length ? [`the crop at its end shows other than source frame 90's top-left quarter at ${bad.length} of ${size[0] * size[1]} pixels: ${bad.slice(0, 4).join('; ')}`] : [], 'the crop channel at its end');
    // The check's power: the same quarter one pixel to the right fails it at many pixels.
    const shifted: Image = { width: size[0], height: size[1], rgba: new Uint8Array(size[0] * size[1] * 4) };
    for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
      const c = i420Rgb(refs[90]!, REC.w, REC.h, x + 1, y);
      shifted.rgba.set([c[0], c[1], c[2], 255], (y * size[0] + x) * 4);
    }
    expect(off(shifted, 0, 0).length, 'a quarter shifted by one pixel fails the crop check').toBeGreaterThan(500);
  }, TIMEOUT);
});
