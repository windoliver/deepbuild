// #2760.c3014951: "From t = 3 s on, nothing of the first touch remains: each frame equals the frame of the same document
// with that occurrence filtered out, byte for byte"
//
// The fixture (helpers.ts `pondDoc`, 480 × 270): criterion 1's still pond and its three touches at the centre at 1, 1.5
// and 2 s, with `rings` at its defaults, so the first touch's ring lives from 1 s until its span of 2 s ends at 3 s. "The
// same document with that occurrence filtered out" is the same pond, logic item and list with `on.where: "n > 1"`, an
// expression over the touch's declared field `n` (1, 2, 3), which keeps the second and third touches (README: `on`).
//
// Each of the 31 frames from 3 s to 4.5 s (frames 60 to 90 at 20 fps, each session opened at frame 60) has the same
// final target in both documents, byte for byte: the PNG files the renderer wrote are equal. Its `rings` rows list no
// ring of the first touch, and list the second and third until their own spans end (3.5 s and 4 s).
// Not vacuous: at 2.25 s the two documents differ (the unfiltered rows list the first touch's ring, the filtered rows
// don't, and the pixel hashes differ, so the filter removes a ring that was drawn), and at 3 s the pond still draws
// rings (its frame differs from the same pond with `rings: "none"`). Wrong programs: a ring that outlives its span or
// fades to something other than nothing, a `where` that isn't read, rings kept from frame to frame.
import { describe, expect, it } from 'vitest';
import {
  AC, STILL, TAPS, TAPS_LIST, TAP_RINGS, type JsonObject, type Row, type Water, alive, finalOf, frameAt, framesOf, hashAt, logicItem, look3d, none, pondDoc, putAsset,
  requireGpu, ringFailures, ringsOf, runGpu, threeTouches, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [480, 270];
const LOOK = look3d('span-2760');
const FPS = 20;
const BEFORE = 45; // 2.25 s
const FROM = 60; // 3 s
const FRAMES = 31; // to 4.5 s
const second = (r: Row): boolean => r.index > 0;

describe(`${AC[2]} a ring fades to nothing at its span`, () => {
  it(`${AC[2]} from t = 3 s on, each frame equals the frame of the same document with the first touch filtered out, byte for byte`, () => {
    requireGpu();
    const dir = out();
    const taps = threeTouches();
    const assets = putAsset(dir, taps.program);
    const logic: Record<string, JsonObject> = { [TAPS]: logicItem(taps) };
    const pond = (name: string, water: Water): string => writeJson(dir, name, pondDoc(name, SIZE, water, logic));
    const whole = pond('whole', { ...STILL, rings: TAP_RINGS });
    const filtered = pond('filtered', { ...STILL, rings: { on: { list: TAPS_LIST, kinds: ['touch'], where: 'n > 1' } } });
    const bare = pond('bare', { ...STILL, rings: 'none' });
    const at = (doc: string, from: number, frames: number) => view3d({ doc, look: LOOK, size: SIZE, from, frames, fps: FPS, capture: 'every', targets: ['final'], rings: true, assets });
    const [w0, f0, w, f, b] = runGpu(bin(), dir, [
      at(whole, BEFORE, 1), at(filtered, BEFORE, 1), at(whole, FROM, FRAMES), at(filtered, FROM, FRAMES),
      view3d({ doc: bare, look: LOOK, size: SIZE, from: FROM, frames: 1, fps: FPS, assets }),
    ]);

    // Before 3 s the filter removes a ring that is drawn.
    const T0 = BEFORE / FPS;
    const before = (reply: JsonObject, what: string) => frameAt(framesOf(reply, what), BEFORE, what);
    none(ringFailures(ringsOf(before(w0!, 'the pond at 2.25 s'), 'the pond at 2.25 s'), alive(taps.rows, T0), T0, TAPS_LIST), 'at 2.25 s the pond lists all three touches\' rings');
    none(ringFailures(ringsOf(before(f0!, 'the filtered pond at 2.25 s'), 'the filtered pond at 2.25 s'), alive(taps.rows, T0, second), T0, TAPS_LIST), 'at 2.25 s the pond with the first touch filtered out lists the second and third touches\' rings alone');
    expect(before(f0!, 'the filtered pond at 2.25 s').pixel_hash, 'before 3 s the first touch\'s ring is drawn: filtering it out changes frame 45').not.toBe(before(w0!, 'the pond at 2.25 s').pixel_hash);

    // From 3 s on, nothing of it remains.
    const wf = framesOf(w!, 'the pond from 3 s'); const ff = framesOf(f!, 'the filtered pond from 3 s');
    expect([wf.length, ff.length], 'each session draws the 31 frames from 3 s to 4.5 s').toEqual([FRAMES, FRAMES]);
    const failures: string[] = [];
    for (let n = FROM; n < FROM + FRAMES; n++) {
      const t = n / FPS;
      const a = frameAt(wf, n, 'the pond from 3 s'); const c = frameAt(ff, n, 'the filtered pond from 3 s');
      if (!finalOf(dir, a, 'the pond').equals(finalOf(dir, c, 'the filtered pond'))) failures.push(`frame ${n} (${t} s): the final target differs from the same document's with the first touch filtered out`);
      failures.push(...ringFailures(ringsOf(a, 'the pond from 3 s'), alive(taps.rows, t), t, TAPS_LIST).map((x) => `frame ${n}: ${x}`));
      failures.push(...ringFailures(ringsOf(c, 'the filtered pond from 3 s'), alive(taps.rows, t, second), t, TAPS_LIST).map((x) => `frame ${n}, filtered: ${x}`));
    }
    none(failures, 'from 3 s on nothing of the first touch remains');
    expect(hashAt(b!, FROM, 'the pond with rings: none'), 'at 3 s the second and third touches\' rings are still drawn: the pond with rings: none has another frame 60').not.toBe(frameAt(wf, FROM, 'the pond from 3 s').pixel_hash);
  });
});
