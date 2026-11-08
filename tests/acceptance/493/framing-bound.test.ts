// AC10 #493.0704e790: A kept 0.2 m box whose y a driver sets to sin(30πt) m, in a 2 s shot framed at fill 0.6, frames
// to a union that holds y from −1.1 to 1.1 m and is at most 1% taller, and stays inside the safe frame at every 60 fps
// frame, t = 1/60 s included, where it reaches y = 1 m; a planted framer that samples 30 times a second sees the box
// only at y = 0 and loses it from the safe frame at t = 1/60 s.
//
// Through `deep-motion eval` with `project: ["bob"]`: the answer's `shots.s.union` is the kept items' union bound the
// framing used, and each frame's `projected.bob.box` is the box's projected bounds in px, held to the safe frame (24 u
// in from each edge of 1920 × 1080). The plant is `framer_samples_30hz`.
import { describe, expect, it } from 'vitest';
import {
  AC, F60, TIMEOUT, arr, box3d, camera3d, evalOk, evalPlanted, failsNaming, film, frames60, itemPos, none, num, obj, projOf, safeFrame, shot, useMotion, type Accepted,
} from './helpers.ts';

const motion = useMotion();
const DOC = film('bob', [camera3d({ orbit: { azimuth: 0, elevation: 0, distance: 10 } }), box3d('bob', [0, 0, 0], 0.2)], {
  drivers: { wave: { target: 'items/bob/at/pos/1', expr: 'sin(30 * pi * t)', vars: { t: 'time' } } },
  shots: { s: shot(0, 2, { frame: { keep: ['bob'], fill: 0.6 } }) },
}, { span: '2s' });
const TIMES = frames60(0, 2);
const SAFE = safeFrame(DOC);

/** The union the framing used, as [lo, hi] in y. */
function unionY(a: Accepted, what: string): [number, number] {
  const u = obj(obj(a.shots['s'], `${what}: shots.s`)['union'], `${what}: shots.s.union`);
  return [num(arr(u['lo'], 'union.lo')[1], 'union.lo[1]'), num(arr(u['hi'], 'union.hi')[1], 'union.hi[1]')];
}
/** The criterion's frame check: the box's projected bounds inside the safe frame at every frame; a failure names the box and the frame. */
function safeFailures(a: Accepted, what: string): string[] {
  return a.frames.flatMap((f, k) => {
    const b = projOf(f, 'bob', what).box;
    return b[0] >= SAFE[0] && b[1] >= SAFE[1] && b[2] <= SAFE[2] && b[3] <= SAFE[3] ? [] : [`bob leaves the safe frame at frame ${k} (t = ${k}/60 s): its box ${JSON.stringify(b)} against ${JSON.stringify(SAFE)}`];
  });
}

describe(`${AC[10]} framing fits a bound over the whole shot, not its samples`, () => {
  it(`${AC[10]} a 0.2 m box riding sin(30πt) frames to a union holding y from −1.1 to 1.1 m, at most 1% taller, and stays in the safe frame at every 60 fps frame, reaching y = 1 m at t = 1/60 s`, () => {
    const a = evalOk(motion.bin(), { doc: DOC, times: TIMES, project: ['bob'] }, 'the bobbing box');
    const [lo, hi] = unionY(a, 'the bobbing box');
    const failures: string[] = [];
    if (!(lo <= -1.1 + 1e-9 && hi >= 1.1 - 1e-9)) failures.push(`the union holds y [${lo}, ${hi}], not [−1.1, 1.1]`);
    if (!(hi - lo <= 2.2 * 1.01)) failures.push(`the union is ${hi - lo} m tall, more than 1% over 2.2 m`);
    const y1 = itemPos(a.frames[1]!, 'bob', 'at 1/60 s')[1];
    if (!(Math.abs(y1 - 1) <= 1e-9)) failures.push(`at t = 1/60 s the box is at y ${y1}, not 1 m`);
    failures.push(...safeFailures(a, 'the bobbing box'));
    expect(a.frames[1]!.t, 'frame 1 is t = 1/60 s').toBe(F60);
    none(failures, 'the framing bound');
  }, TIMEOUT);

  it(`${AC[10]} a planted framer that samples 30 times a second sees the box only at y = 0 and loses it from the safe frame at t = 1/60 s`, () => {
    const a = evalPlanted(motion.bin(), { doc: DOC, times: TIMES, project: ['bob'], planted: 'framer_samples_30hz' }, 'the planted framer');
    const [lo, hi] = unionY(a, 'the planted framer');
    expect(lo >= -0.1 - 1e-9 && hi <= 0.1 + 1e-9, `the plant's union [${lo}, ${hi}] sees the box only at y = 0`).toBe(true);
    failsNaming(safeFailures(a, 'the planted framer'), ['bob', 'frame 1 '], 'the safe-frame check on the plant');
  }, TIMEOUT);
});
