// AC3 #493.f2d3692f: A follow-forward camera never moves back at 10,000 random times, and seeking to any of them
// equals playing.
//
// Through `deep-motion eval`: a 2D film whose walker steps forward, back and forward again along x (a channel), and
// shot `track` with `move: {follow_forward: "walker"}` (README: Choices: the follow axis is the document's x). Play is
// the 10,000 seeded times in order on one line; seeking is the same times in a seeded order on one line, and 200 of
// them each alone on its own line. A camera that tracks the walker's raw position moves back while the walker does.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, accepted, camera2d, channel, evalAll, film, none, poseOf, rect, seededTimes, shot, shuffled, useMotion,
} from './helpers.ts';

const motion = useMotion();
const SIZE: [number, number] = [1280, 720];
const DOC = film('follow-forward', [
  camera2d(SIZE),
  rect('ground', [0, 600, 4000, 40], 'muted'),
  rect('walker', [0, 0, 40, 80], 'accent', { at: { pos: [100, 520, 0] } }),
], {
  channels: { walk: channel('items/walker/at/pos/0', [[0, 100], [1, 500], [1.5, 350], [2.5, 800], [3, 700], [4, 1100]]) },
  shots: { track: shot(0, 4, { move: { follow_forward: 'walker' }, frame: { keep: ['walker'] } }) },
}, { span: '4s' }, SIZE);
const TIMES = seededTimes(493_003, 10_000, 0, 4 * FLICKS);

describe(`${AC[3]} a follow-forward camera never moves back, and seeking equals playing`, () => {
  it(`${AC[3]} at 10,000 random times the follow-forward camera's x never decreases, it moves forward with the walker, and seeking to each time equals playing`, () => {
    const order = shuffled(TIMES, 493_103);
    const alone = seededTimes(493_203, 200, 0, TIMES.length).map((i) => TIMES[i]!);
    const answers = evalAll(motion.bin(), [{ doc: DOC, times: TIMES }, { doc: DOC, times: order }, ...alone.map((t) => ({ doc: DOC, times: [t] }))]);
    const play = accepted(answers[0]!, TIMES, 'the play');
    const xs = play.frames.map((f) => poseOf(f, 'cam', 'the play').target[0]);
    const failures: string[] = [];
    for (let i = 1; i < xs.length; i++) if (xs[i]! < xs[i - 1]!) failures.push(`the camera moves back from x ${xs[i - 1]} at ${TIMES[i - 1]} flicks to ${xs[i]} at ${TIMES[i]} flicks`);
    expect(xs[xs.length - 1]! - xs[0]!, 'the camera moves forward with the walker (u)').toBeGreaterThan(300);
    const byTime = new Map(TIMES.map((t, i) => [t, JSON.stringify(play.frames[i]!.cameras['cam'])]));
    const seek = accepted(answers[1]!, order, 'the seek in another order');
    seek.frames.forEach((f, i) => { const a = JSON.stringify(f.cameras['cam']); if (a !== byTime.get(order[i]!)) failures.push(`seeking to ${order[i]} flicks in another order reads ${a.slice(0, 200)}, playing reads ${byTime.get(order[i]!)?.slice(0, 200)}`); });
    alone.forEach((t, i) => {
      const a = JSON.stringify(accepted(answers[i + 2]!, [t], `the seek to ${t}`).frames[0]!.cameras['cam']);
      if (a !== byTime.get(t)) failures.push(`seeking to ${t} flicks alone reads ${a.slice(0, 200)}, playing reads ${byTime.get(t)?.slice(0, 200)}`);
    });
    none(failures, 'the follow-forward camera');
  }, TIMEOUT);
});
