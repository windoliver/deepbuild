// #1413.80fd1f16 and #1413.8ccae236: a build over the device's memory returns out_of_memory naming its writer while
// other views keep drawing; that view draws the placeholder rung on the next frame and its document's check result
// doesn't change. Two writers' views draw a moving scene in one live window; at frame 30 alpha's writer sends a
// revision whose `test.alloc@1` buffer is twice the Mac's unified memory, a real allocation the device refuses
// (README: test.alloc@1). At the base there is no `test-faults` feature, so the binary doesn't build.
import { describe, expect, it } from 'vitest';
import { OVER_MEMORY_BYTES, W, alloc, liveCall, liveReply, run, sceneDoc, sessionOf, useBuild, useDir, viewOf, writeDoc, type Live } from './helpers.ts';

const bin = useBuild();
const dir = useDir();
const REVISE = 30;
const FRAMES = 90;

let memo: Live | null = null;
function oomRun(): Live {
  if (memo) return memo;
  const d = dir();
  const plain = writeDoc(d, 'plain', sceneDoc('Plain'));
  const big = writeDoc(d, 'big', sceneDoc('Over memory', { big: alloc('big', 'oom-buffer', OVER_MEMORY_BYTES) }));
  const { replies } = run(bin(), d, [liveCall({
    frames: FRAMES,
    sessions: [{ session: 'alpha', writer: W.alpha, doc: plain }, { session: 'bravo', writer: W.bravo, doc: plain }],
    events: [{ frame: REVISE, revise: { session: 'alpha', doc: big } }],
    report: ['hashes'],
  })]);
  memo = liveReply(replies[0]!, 'the live call with an allocation over memory');
  return memo;
}

describe('#1413.80fd1f16 a build over the device\'s memory, forced in a test, returns out_of_memory naming the writer; other views keep drawing', () => {
  it('#1413.80fd1f16 alpha\'s revision with a buffer twice the Mac\'s memory returns out_of_memory naming agent:alpha, and bravo draws every frame', () => {
    const live = oomRun();
    const alphaErrors = live.writer_errors.filter((e) => e.session === 'alpha');
    expect(alphaErrors.map((e) => `${e.code} for ${e.writer} at frame ${e.frame}`), 'alpha\'s writer is told one error').toHaveLength(1);
    const e = alphaErrors[0]!;
    expect(e.code, 'the failed build returns out_of_memory').toBe('out_of_memory');
    expect(e.writer, 'the error names the writer').toBe(W.alpha);
    expect(e.frame, 'the error comes from the revision\'s build').toBe(REVISE);
    expect(live.writer_errors.filter((x) => x.session !== 'alpha'), 'no other writer is told an error').toEqual([]);

    const bravo = live.frames.map((f) => viewOf(f, 'bravo'));
    const missed = live.frames.map((f) => [f.frame, viewOf(f, 'bravo')] as const)
      .filter(([, v]) => !v.drawn || v.rung !== 'base' || v.pixel_hash === null).map(([f, v]) => `frame ${f}: drawn ${v.drawn} at ${v.rung}`);
    expect(missed, 'bravo\'s view draws every frame at its base rung, before and after alpha\'s failed build').toEqual([]);
    expect(live.frames.map((f) => f.frame), 'every frame is presented').toEqual(Array.from({ length: FRAMES }, (_, i) => i + 1));
    expect(new Set(bravo.map((v) => v.pixel_hash)).size, 'bravo\'s moving scene draws a new picture each frame').toBe(FRAMES);
  }, 3_600_000);
});

describe('#1413.8ccae236 that view draws Placeholder on the next frame, and the document\'s check result doesn\'t change', () => {
  it('#1413.8ccae236 alpha draws the placeholder rung from frame 31 on, and its revision\'s check result stays a pass with no issue', () => {
    const live = oomRun();
    const before = live.frames.filter((f) => f.frame < REVISE).map((f) => viewOf(f, 'alpha')).filter((v) => !v.drawn || v.rung !== 'base');
    expect(before, 'alpha draws at its base rung before the revision').toEqual([]);
    const wrong = live.frames.filter((f) => f.frame > REVISE).map((f) => [f.frame, viewOf(f, 'alpha').rung] as const).filter(([, rung]) => rung !== 'placeholder');
    expect(wrong.map(([f, r]) => `frame ${f}: ${r}`), `alpha draws the placeholder rung on frame ${REVISE + 1}, the next after the failed build, and on every frame after it`).toEqual([]);

    const alpha = sessionOf(live, 'alpha');
    expect(alpha.state, 'the session stays live, not refused').toBe('live');
    const rev2 = alpha.revisions.find((r) => r.rev === 2);
    expect(rev2, 'the revision with the failed build has a row').toBeDefined();
    expect(rev2!.outcome, 'its check result is not a refusal').not.toBe('refused');
    expect(rev2!.issues, 'its check result is unchanged: the check passed it with no issue, and the failed allocation adds none').toEqual([]);
    expect(alpha.issues.filter((i) => i['code'] === 'out_of_memory'), 'no out_of_memory issue enters the session\'s check result').toEqual([]);
  }, 3_600_000);
});
