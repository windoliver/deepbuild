// #853.fe931abe: "100,000 sand particles poured onto a box floor at 60 Hz settle into a pile whose height at the
// centre at 5 s matches a seeded run's within 1%; seeking from 10 s back to 2.5 s restores the checkpoint at 2 s and
// steps forward to the same buffer hash as playing to 2.5 s; a planted module that integrates by frame time differs
// between 30 and 144 frames a second and fails, naming the step"
//
// The pour (helpers.ts: pourDoc; judges.ts: POUR) is one `particles.stepped@1` item, `sand`: 100,000 particles 2 cm
// apart, poured over 2 s from a box 1.75 m up into a tray 0.8 m square (the world `pit`: a static floor box whose top
// is y = 0 and four static wall boxes), stepped at 60 Hz. Through #378's `view3d` at 60 frames a second, frame k
// reads step k, with #483's `read` of `sand.buffer` and #252's `carried` row.
//
// The pile. "A seeded run" is the same pour under another document seed (1853 for 853): other grains, the same sand.
// At 5 s (step 300) each run's buffer is a settled pile (judges.ts: pileProblems: all 100,000 live, none through the
// floor box or outside the walls, none left at the emitter, and the height at the centre at least half of what
// 100,000 spheres 2 cm across fill the tray to at their densest, 0.884 m, and under the emitter), the two buffers
// differ, and their heights at the centre differ by at most 1%. "Settle": the first run's height at 5 s is within 1%
// of its height at 10 s. "Poured": 40% to 60% of the particles are live at 1 s.
//
// The seek. The first run plays to 10 s (step 600) and seeks back to 2.5 s (step 150). Its ring's budget is 8 buffers
// (judges.ts: POUR.budget shows the arithmetic), so at step 600 it holds the checkpoint at step 120 (2 s): the sought
// frame reports `restored: {from: 120, steps: 30}` and step 150, and its buffer hashes as the played frame 150's.
// The play's buffer moved between step 120 and step 150, so restoring without stepping can't pass.
//
// The frame rates. The buffer at step 150 is read from three plays, at 60 (frame 150), 30 (frame 75) and 144 frames a
// second (frame 360): one hash, each frame reporting step 150. The planted `particles_step_by_frame_time` advances
// the particles once a frame by the frame's time, so its 30 and 144 plays differ, and the same check fails on it with
// "at step 150 (2.5 s), the pour played at 144 frames a second (frame 360) hashes …, at 30 frames a second (frame
// 75) …". At the base no kind `particles.stepped@1` exists.
import { describe, expect, it } from 'vitest';
import {
  OTHER_SEED, POUR, POUR_SEED, POUR_STEPS, centreHeight, halfPouredProblems, heightProblems, movedCount, pileProblems, rateProblems, seekProblems, type Play,
} from './judges.ts';
import {
  SAND, ac, bufferOn, carriedOn, failsNaming, frameAt, framesNumbered, judgesHold, none, pourDoc, requireGpu, run, useBin, useOut, view3dCall, view3dFrames, writeJson,
  type Planted,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const AT = POUR_STEPS;

/** The buffer at step 150 as plays at 60, 30 and 144 frames a second read it: the problems of the three not being
 * one buffer at one step, each naming the step. */
function ratesProblems(planted?: Planted): string[] {
  const dir = out();
  const doc = writeJson(dir, 'pour.json', pourDoc());
  const rates = [{ fps: 60, frame: AT.sought }, { fps: 30, frame: AT.sought / 2 }, { fps: 144, frame: (AT.sought * 144) / 60 }];
  const replies = run(bin(), dir, rates.map((r) => view3dCall({ doc, fps: r.fps, frames: r.frame + 1, capture: [r.frame], read: [SAND] })), planted);
  const plays: Play[] = rates.map((r, i) => {
    const what = `the pour played at ${r.fps} frames a second`;
    const f = frameAt(view3dFrames(replies[i]!, what), r.frame, what);
    return { fps: r.fps, frame: r.frame, hash: f.read.get(SAND) ?? null, step: f.carried.get(SAND)?.step ?? null };
  });
  return rateProblems(AT.sought, plays);
}

describe(`${ac(1)} 100,000 sand particles poured at 60 Hz settle into a pile, seek as they play, and step the same at any frame rate`, () => {
  it(`${ac(1)} the pile's height at the centre at 5 s matches a seeded run's within 1%, and seeking from 10 s back to 2.5 s restores the checkpoint at 2 s and steps forward to the buffer hash of playing to 2.5 s`, () => {
    judgesHold();
    requireGpu();
    const dir = out();
    const first = 'the pour played to 10 s and sought back to 2.5 s';
    const seeded = 'the seeded run';
    const [played, other] = run(bin(), dir, [
      view3dCall({ doc: writeJson(dir, 'pour.json', pourDoc(POUR_SEED)), frames: AT.tenSeconds + 2, seeks: [{ after: AT.tenSeconds, to: AT.sought }], capture: [AT.halfPoured, AT.checkpoint, AT.sought, AT.fiveSeconds, AT.tenSeconds], read: [SAND] }),
      view3dCall({ doc: writeJson(dir, 'pour-seeded.json', pourDoc(OTHER_SEED)), frames: AT.fiveSeconds + 1, capture: [AT.fiveSeconds], read: [SAND] }),
    ]);
    const frames = view3dFrames(played!, first);
    const buffer = (step: number) => bufferOn(dir, frameAt(frames, step, first), SAND, first);

    // The pile, at 5 s, against the seeded run's.
    const five = buffer(AT.fiveSeconds);
    expect(carriedOn(frameAt(frames, AT.fiveSeconds, first), SAND, first).step, `frame ${AT.fiveSeconds} at 60 frames a second reads the buffer at step ${AT.fiveSeconds}`).toBe(AT.fiveSeconds);
    none(halfPouredProblems(buffer(AT.halfPoured).words, POUR, 'the pour at 1 s'), 'the sand is poured over its 2 s');
    none(pileProblems(five.words, POUR, 'the pour at 5 s'), 'at 5 s the buffer is 100,000 particles settled into a pile on the box floor');
    const theirs = bufferOn(dir, frameAt(view3dFrames(other!, seeded), AT.fiveSeconds, seeded), SAND, seeded);
    none(pileProblems(theirs.words, POUR, 'the seeded run at 5 s'), 'at 5 s the seeded run is a settled pile too');
    expect(theirs.hash, 'the seeded run pours other grains: its buffer at 5 s is another buffer').not.toBe(five.hash);
    const height = centreHeight(five.words, POUR);
    none(heightProblems(height, centreHeight(theirs.words, POUR), 'the pour at 5 s', 'the seeded run\'s'), 'the pile\'s height at the centre at 5 s matches the seeded run\'s within 1%');
    none(heightProblems(height, centreHeight(buffer(AT.tenSeconds).words, POUR), 'the pour at 5 s', 'its own height at 10 s'), 'the pile has settled by 5 s: its height then is its height at 10 s within 1%');

    // The seek, from 10 s back to 2.5 s.
    const [at150, sought] = framesNumbered(frames, AT.sought);
    expect(at150, `the play drew frame ${AT.sought}`).toBeDefined();
    expect(sought, `the seek from step ${AT.tenSeconds} drew frame ${AT.sought} again`).toBeDefined();
    const row = carriedOn(sought!, SAND, 'the seek');
    none(seekProblems({
      held: carriedOn(frameAt(frames, AT.tenSeconds, first), SAND, first).checkpoints,
      step: row.step, restored: row.restored,
      soughtHash: bufferOn(dir, sought!, SAND, 'the seek').hash, playedHash: bufferOn(dir, at150!, SAND, first).hash,
      moved: movedCount(buffer(AT.checkpoint).words, bufferOn(dir, at150!, SAND, first).words, POUR.count),
    }), 'seeking from 10 s back to 2.5 s restores the checkpoint at 2 s and steps forward to the buffer hash of playing to 2.5 s');
  }, 3_600_000);

  it(`${ac(1)} the buffer at 2.5 s is one buffer played at 60, 30 and 144 frames a second; a planted module that integrates by frame time (--planted particles_step_by_frame_time) differs between 30 and 144 frames a second and fails, naming the step`, () => {
    judgesHold();
    requireGpu();
    none(ratesProblems(), `the pour's buffer at step ${AT.sought} is the same played at 60, 30 and 144 frames a second`);
    failsNaming(ratesProblems('particles_step_by_frame_time'), [/^at step 150 \(2\.5 s\), the pour played at 144 frames a second \(frame 360\) hashes [0-9a-f]{64}, at 30 frames a second \(frame 75\) [0-9a-f]{64}$/m], 'the planted particles_step_by_frame_time');
  }, 3_600_000);
});
