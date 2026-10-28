// #488.304e296f: jumping to each time in Determinism's default set gives the same frame, pixel for pixel
// on one machine, as playing to it, for the same document, recorded input track, rendering mode, backend
// and settings, compared on canonical renders, which never read frame history; a planted seek that
// restores the checkpoint nearest in distance fails one flick before the second checkpoint, naming that
// flick. Playing is the live transport's warm path: every display frame from 0 at 144 Hz through the
// session's caches, carried state and checkpoints, then the frame at t; seeking is a cold session jumped
// back to t from 1 s later, which restores the last checkpoint at or before t and steps on (README:
// determinism). The wrong programs: the base (no `determinism` call, no checkpoints, no `test-tick`
// feature), and the planted `checkpoint_nearest_in_distance`, which restores the checkpoint at 0.5 s for
// t = 0.5 s − 1 flick and shows the step at 0.5 s one flick early.
import { describe, expect, it } from 'vitest';
import {
  BACK, DOC, FULL, SLIDING, TICK, board, determinism, determinismCall, firstFailingFlick, label, presented, rect, requires, run, scenario,
  sec, seekPlayFailures, show, slide, useBuilds, useEvidence, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL, TICK]);
const evidence = useEvidence();

/** The checkpoint spacing of `test.tick` (Input track: `checkpoint_every: s = 0.5`). */
const CHECKPOINT = sec(0.5);
/** The tick board's span, and the slide's last key. */
const SPAN = sec(3);
const LAST_KEY = sec(2);
/** One flick before the second checkpoint (the first is at 0): where the planted seek shows the step at 0.5 s early. */
const BEFORE_SECOND_CHECKPOINT = CHECKPOINT - 1;

/** A board with a `test.tick@1` item (60 Hz steps, checkpoints every 0.5 s), a rect sliding over 2 s, and a label; 3 s long. */
const TICK_BOARD: JsonObject = board('Ticking board', [
  BACK,
  { id: 'tick', kind: 'test.tick@1', name: 'Ticker', order: 'a1', params: { box: [16, 40, 40, 30] } },
  rect('mover', [0, 0, 40, 30], 'a2', 'ink', { at: { pos: [16, 100, 0] } }),
  label('l1', 'Seek equals play', [16, 150], 'a3'),
], { transport: { span: '3s' }, ...slide('mover', 16, 216), ...requires({ 'test.tick': '^1' }) });

/**
 * Determinism's default set for the tick board, as far as the design names it: the start; every key
 * flick and the flick before (the keys at 0 and 2 s); every checkpoint flick, the flick before it and
 * the midpoint to the next (checkpoints every 0.5 s from 0); and the span's last flick. The 100 seeded
 * times are the binary's own. The flick before 0 is neither required nor refused.
 */
function namedTimes(): number[] {
  const out = new Set<number>([0, LAST_KEY - 1, LAST_KEY, SPAN - 1]);
  for (let c = 0; c < SPAN; c += CHECKPOINT) {
    if (c > 0) { out.add(c - 1); out.add(c); }
    out.add(c + CHECKPOINT / 2);
  }
  return [...out].sort((a, b) => a - b);
}

describe('#488.304e296f seeking to each time of Determinism\'s default set gives the frame playing to it gives, on canonical renders; a planted nearest-in-distance checkpoint restore fails one flick before the second checkpoint, naming that flick', () => {
  it('#488.304e296f the default set holds the start, the keys and the flick before each, every checkpoint, the flick before it and the midpoint to the next, the span\'s last flick and 100 seeded times, the same on every call', () => {
    const full = run(builds.bin(TICK), scenario(evidence(), [show(TICK_BOARD), determinismCall(DOC.a), determinismCall(DOC.a), determinismCall(DOC.a, { at_times: [0] })]));
    presented(full[0]!, 'the ticking board');
    const first = determinism(full[1]!, 'the first comparison');
    const second = determinism(full[2]!, 'the second comparison');
    const named = namedTimes();
    const missing = named.filter((t) => !first.at_times.includes(t));
    expect(missing, `every named time of the default set is compared (missing: ${missing.join(', ')}); got ${first.at_times.length} times`).toEqual([]);
    const seeded = first.at_times.filter((t) => !named.includes(t));
    expect(seeded.length, `100 times from the check's seed beside the ${named.length} named ones; got ${seeded.length} others`).toBeGreaterThanOrEqual(100);
    expect(second.at_times, 'the set comes from the document and the check\'s seed, so a second call gives the same times').toEqual(first.at_times);
    expect(determinism(full[3]!, 'an explicit set').at_times, 'an explicit at_times is compared as given').toEqual([0]);
  }, 1_800_000);

  it('#488.304e296f on the ticking board (steps, checkpoints and a slide), at every time of the default set the cold seek\'s canonical render and node results equal the warm play\'s', () => {
    const replies = run(builds.bin(TICK), scenario(evidence(), [show(TICK_BOARD), determinismCall(DOC.a)]));
    presented(replies[0]!, 'the ticking board');
    const d = determinism(replies[1]!, 'seek against play');
    expect(d.frames.length, 'at least the named times and 100 seeded ones were compared').toBeGreaterThanOrEqual(namedTimes().length + 100);
    expect(seekPlayFailures(d, 'the ticking board'), 'seek equals play at every time').toEqual([]);
    // The board is not still: the tick's count moves its box, so the frames at 0.5 s − 1 and 0.5 s differ.
    const at = (t: number) => d.frames.find((f) => f.t === t)!;
    expect(at(BEFORE_SECOND_CHECKPOINT).play.pixels, 'the step at 0.5 s changes the frame').not.toBe(at(CHECKPOINT).play.pixels);
  }, 1_800_000);

  it('#488.304e296f on a plain sliding board in the full build (no test module), seek equals play at every time of the default set', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), [show(SLIDING), determinismCall(DOC.a)]));
    presented(replies[0]!, 'the sliding board');
    const d = determinism(replies[1]!, 'seek against play');
    expect(d.at_times, 'the keys at 0 and 2 s, the flick before 2 s, and the span\'s last flick are compared').toEqual(expect.arrayContaining([0, LAST_KEY - 1, LAST_KEY, SPAN - 1]));
    expect(seekPlayFailures(d, 'the sliding board'), 'seek equals play at every time').toEqual([]);
    const at = (t: number) => d.frames.find((f) => f.t === t)!;
    expect(at(0).play.pixels, 'the slide moves the rect between 0 and 2 s − 1').not.toBe(at(LAST_KEY - 1).play.pixels);
    expect(d.frames.filter((f) => f.t > 0 && f.t < LAST_KEY).some((f) => f.play.pixels !== at(0).play.pixels), 'a seeded time inside the slide sees it moving').toBe(true);
  }, 1_800_000);

  it('#488.304e296f a planted seek that restores the checkpoint nearest in distance (checkpoint_nearest_in_distance) fails one flick before the second checkpoint, 352,799,999, naming that flick', () => {
    expect(BEFORE_SECOND_CHECKPOINT).toBe(352_799_999);
    const named = namedTimes();
    const replies = run(builds.bin(TICK), scenario(evidence(), [show(TICK_BOARD), determinismCall(DOC.a, { at_times: named })], { planted: 'checkpoint_nearest_in_distance' }));
    presented(replies[0]!, 'the ticking board');
    const d = determinism(replies[1]!, 'the planted seek against play');
    expect(d.at_times, 'the named times are compared').toEqual(named);
    const failures = seekPlayFailures(d, 'the planted seek');
    expect(failures.length, 'the planted restore fails the comparison').toBeGreaterThan(0);
    expect(firstFailingFlick(failures), `the first failure is one flick before the second checkpoint: ${failures[0]}`).toBe(BEFORE_SECOND_CHECKPOINT);
    expect(failures[0]!, 'the failure names that flick').toContain(`at ${BEFORE_SECOND_CHECKPOINT} flicks`);
    // The warm path never restores, so the play side is the honest frame: the planted side shows the step at 0.5 s one flick early.
    const early = d.frames.find((f) => f.t === BEFORE_SECOND_CHECKPOINT)!;
    const next = d.frames.find((f) => f.t === CHECKPOINT)!;
    expect(early.seek.pixels, 'the planted seek at 0.5 s − 1 shows the frame of 0.5 s').toBe(next.play.pixels);
    // And at the midpoints, the earlier of two equally near checkpoints is restored, so 0.25 s still agrees.
    expect(failures.some((f) => f.includes(`at ${CHECKPOINT / 2} flicks`)), 'no failure at the first midpoint, 0.25 s').toBe(false);
  }, 1_800_000);
});
