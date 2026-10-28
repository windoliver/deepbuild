// #488.e8e56351: a test canvas module whose cache is keyed by frame number passes a cold-against-cold
// comparison and fails this one, where playing runs the live transport's warm path at a 144 Hz display
// from 0 to t and seeking is a cold jump from a later time, naming the module and the first frame that
// differs. `test.cache` (feature `test-frame-cache`, README) moves its box by ⌊(t mod Δ) ÷ 490,000⌋ u at
// the document's 60 fps frame Δ, from the exact t, and memoizes that by frame number ⌊t ÷ Δ⌋ across a
// session's frames: on the warm path, a display frame later in the same document frame answers from
// the memo (stale); a cold seek computes it afresh. The wrong programs: the base (no `determinism`
// call, no `test-frame-cache` feature), and a comparison that renders both sides through the same cold
// evaluation (Determinism: INVALID), which the module passes.
import { describe, expect, it } from 'vitest';
import {
  BACK, CACHE, DISPLAY, DOC, FRAME_60, board, determinism, determinismCall, firstFailingFlick, label, presented, rect, requires, run, scenario, seekPlayFailures, show, slide,
  useBuilds, useEvidence, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([CACHE]);
const evidence = useEvidence();

/** A board with a `test.cache@1` item, a rect sliding over 2 s and a label; 3 s long. */
const CACHE_BOARD: JsonObject = board('Frame-cached board', [
  BACK,
  { id: 'cached', kind: 'test.cache@1', name: 'Cached', order: 'a1', params: { box: [16, 40, 40, 30] } },
  rect('mover', [0, 0, 40, 30], 'a2', 'ink', { at: { pos: [16, 100, 0] } }),
  label('l1', 'Keyed by frame', [16, 150], 'a3'),
], { transport: { span: '3s' }, ...slide('mover', 16, 216), ...requires({ 'test.cache': '^1' }) });

/** The first display frame (at 144 Hz) in the document frame (at 60 fps) that holds t, when it is before t: where a frame-number memo was filled. */
function staleFrom(t: number): number | null {
  const n = Math.floor(t / FRAME_60);
  const first = Math.ceil((n * FRAME_60) / DISPLAY) * DISPLAY;
  return first < t ? first : null;
}

describe('#488.e8e56351 a test canvas module cached by frame number passes cold-against-cold and fails warm play at 144 Hz against a cold seek, naming the module and the first frame that differs', () => {
  it('#488.e8e56351 cold against cold (play: "cold", the INVALID comparison) finds no difference on the frame-cached board', () => {
    const replies = run(builds.bin(CACHE), scenario(evidence(), [show(CACHE_BOARD), determinismCall(DOC.a, { play: 'cold' })]));
    presented(replies[0]!, 'the frame-cached board');
    const d = determinism(replies[1]!, 'cold against cold');
    expect(d.frames.length, 'the default set was compared').toBeGreaterThanOrEqual(100);
    expect(seekPlayFailures(d, 'cold against cold'), 'both sides are the same cold evaluation, so the memo never answers').toEqual([]);
  }, 1_800_000);

  it('#488.e8e56351 warm play at 144 Hz against a cold seek from later fails on the frame-cached board, naming test.cache and the first frame that differs', () => {
    const replies = run(builds.bin(CACHE), scenario(evidence(), [show(CACHE_BOARD), determinismCall(DOC.a)]));
    presented(replies[0]!, 'the frame-cached board');
    const d = determinism(replies[1]!, 'warm against cold');
    const failures = seekPlayFailures(d, 'warm against cold');
    expect(failures.length, 'the memo keyed by frame number answers stale values on the warm path').toBeGreaterThan(0);
    expect(failures[0]!, 'the first failure names the module').toContain('test.cache');
    const first = firstFailingFlick(failures);
    expect(first, `the first failure names the flick: ${failures[0]}`).not.toBeNull();
    expect(d.at_times, 'that flick is one of the compared times').toContain(first!);
    expect(staleFrom(first!), `at ${first} flicks an earlier display frame of the same document frame filled the memo`).not.toBeNull();
    // The failures name only the module at fault.
    for (const f of failures) expect(f, 'every failure names test.cache').toContain('test.cache');
  }, 1_800_000);

  it('#488.e8e56351 at the display frames 4,900,000 and 9,800,000 (document frame 0, after its first display frame) the sides differ; at 0, 11,760,000 and 14,700,000 (the first display frame of a document frame) they agree', () => {
    const times = [0, DISPLAY, 2 * DISPLAY, FRAME_60, 3 * DISPLAY];
    expect(times.map(staleFrom), 'the memo is filled before 4,900,000 and 9,800,000 only').toEqual([null, 0, 0, null, null]);
    const replies = run(builds.bin(CACHE), scenario(evidence(), [show(CACHE_BOARD), determinismCall(DOC.a, { at_times: times })]));
    presented(replies[0]!, 'the frame-cached board');
    const d = determinism(replies[1]!, 'warm against cold at five times');
    expect(d.at_times).toEqual(times);
    const differing = d.frames.filter((f) => f.play.pixels !== f.seek.pixels).map((f) => f.t);
    expect(differing, 'exactly the two later display frames of document frame 0 differ').toEqual([DISPLAY, 2 * DISPLAY]);
    const failures = seekPlayFailures(d, 'warm against cold at five times');
    expect(firstFailingFlick(failures), 'the first frame that differs is 4,900,000').toBe(DISPLAY);
    expect(failures[0]!, 'naming test.cache').toContain('test.cache');
  }, 900_000);
});
