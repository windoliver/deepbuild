// #1413.52a90d72 and #1413.4cf20a59: a failed resize frees its slot and retries at the next frame. #377's
// surface-handoff scene with `resize` on changes size at frame 50 (1936 × 1584 to 1452 × 1188); the planted
// allocator (`fail_resize`, README) fails the next n slot allocations at a new size. The merge base's resize returns
// from `reallocate` without abandoning the slot, so it stays Rendering; `--planted resize_leaves_rendering` is that
// program. At the base there is no `test-faults` feature, so the binary doesn't build.
import { describe, expect, it } from 'vitest';
import { RESIZE_FAILURES, SURFACE, answered, framesCall, framesReply, run, sizeAt, slotProblems, start, surfaceReply, requireMetal, useBuild, useDir } from './helpers.ts';

const bin = useBuild();
const dir = useDir();
const RESIZE = 50;

describe('#1413.52a90d72 a planted allocator failing a resize leaves the slot Free, keeps the last frame shown and reads rebuilds 0; the merge base leaves it Rendering and fails', () => {
  it('#1413.52a90d72 one failed allocation at frame 50\'s new size leaves no slot rendering, frame 49 shown and rebuilds 0', () => {
    const { replies } = run(bin(), dir(), [framesCall({ count: RESIZE + 1, resize: true, fail_resize: 1 }), SURFACE]);
    const r = framesReply(replies[0]!, 'the frames with one failed resize');
    expect(r.frames.map((f) => f.frame), 'every frame is presented').toEqual(Array.from({ length: RESIZE + 1 }, (_, i) => i));
    expect(r.frames.filter((f) => f.frame < RESIZE && !f.drawn).map((f) => f.frame), 'frames 0 to 49 draw').toEqual([]);
    const failed = r.frames.find((f) => f.frame === RESIZE)!;
    expect(failed.drawn, 'frame 50, whose allocation failed, draws nothing').toBe(false);
    expect(failed.shown_frame, 'the view keeps showing the last frame drawn, 49').toBe(RESIZE - 1);
    expect(r.device_losses, 'a failed resize on a healthy device isn\'t a device loss').toBe(0);
    expect(slotProblems(surfaceReply(replies[1]!, 'the surface after the failed resize')), 'the failed slot is freed, and nothing was rebuilt').toEqual([]);
  }, 3_600_000);

  it('#1413.52a90d72 the merge base\'s resize (--planted resize_leaves_rendering) leaves the slot rendering, and the check fails it', () => {
    requireMetal();
    const s = start(bin(), dir(), [framesCall({ count: RESIZE + 1, resize: true, fail_resize: 1 }), SURFACE], { planted: 'resize_leaves_rendering' });
    expect(s.status, `the planted run exits 0: ${s.stderr.slice(-2000)}`).toBe(0);
    expect(s.replies, `the planted run answers its scenario: ${s.stdout.slice(0, 1500)}`).not.toBeNull();
    const problems = slotProblems(surfaceReply(answered(s.replies![1]!, 'the planted surface'), 'the planted surface'));
    expect(problems.join('\n'), 'the planted resize leaves a slot rendering, and the check names it').toMatch(/slot \d+ is left rendering/);
  }, 3_600_000);
});

describe('#1413.4cf20a59 ten failures in a row leave the view able to draw when the failure clears, at the new size, with one retry a frame at most', () => {
  it('#1413.4cf20a59 ten failed allocations take frames 50 to 59, one a frame, and frame 60 draws at 1452 × 1188 as a fresh start does', () => {
    const d = dir();
    const { replies } = run(bin(), d, [framesCall({ count: RESIZE + RESIZE_FAILURES + 1, resize: true, fail_resize: RESIZE_FAILURES }), SURFACE]);
    const fresh = framesReply(run(bin(), d, [framesCall({ from: RESIZE + RESIZE_FAILURES, count: 1, resize: true })]).replies[0]!, 'a fresh start at frame 60').frames[0]!;
    const r = framesReply(replies[0]!, 'the frames with ten failed resizes');
    const failing = r.frames.filter((f) => f.frame >= RESIZE && f.frame < RESIZE + RESIZE_FAILURES);
    // Each failed frame spends one allocation: with ten to fail, a frame that tried twice would draw before frame 60,
    // and one that didn't try would leave frame 60 failing.
    expect(failing.map((f) => [f.frame, f.drawn, f.shown_frame]), 'frames 50 to 59 each fail their one retry and keep frame 49 shown')
      .toEqual(Array.from({ length: RESIZE_FAILURES }, (_, i) => [RESIZE + i, false, RESIZE - 1]));
    const back = r.frames.find((f) => f.frame === RESIZE + RESIZE_FAILURES);
    expect(back?.drawn, 'frame 60 draws once the failure clears').toBe(true);
    expect(back!.size, 'at the new size').toEqual(sizeAt(RESIZE + RESIZE_FAILURES));
    expect(fresh.pixel_hash, 'a fresh start draws frame 60').not.toBeNull();
    expect(back!.pixel_hash, 'frame 60\'s pixels are a fresh start\'s').toBe(fresh.pixel_hash);
    expect(r.device_losses, 'no device loss').toBe(0);
    expect(slotProblems(surfaceReply(replies[1]!, 'the surface after the failures')), 'no slot is left rendering, and nothing was rebuilt').toEqual([]);
  }, 3_600_000);
});
