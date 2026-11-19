// #1993.1cdd279a: "The same grid with speed 2 m/s gives a ratio of 3.33 and is refused at check, naming the operator
// and 3.33. At 0.24 m/s it checks, and the largest height over 3,600 steps stays under twice the drop's. A planted
// check that skips the bound accepts the 3.33 document and fails the refusal line"
//
// The same grid is criterion 1's water (helpers.ts: waterOp): 128 × 128 cells of 1 cm, 60 steps a second, its height
// and rate of change in two carried textures, with `stepped.bound: {speed, cell: 0.01}` and `max` left at its default
// 0.5. The check computes speed × (1 ÷ rate) ÷ cell (the issue's Scope): 2 × (1 ÷ 60) ÷ 0.01 = 3.33 at 2 m/s, and
// 0.24 × (1 ÷ 60) ÷ 0.01 = 0.4 at 0.24 m/s.
//
// The refusal line. #429's `check_operator` on the 2 m/s operator answers `outcome: "refused"`, one of its issues'
// messages names the operator (`water`) and the ratio (`3.33`), and the reply's `reached` holds nothing true: the
// check refused before anything ran (Scope), so it needs no GPU.
//
// At 0.24 m/s the operator checks (`outcome: "accepted"`), and its document plays 3,600 steps through #378's
// `view3d` at 60 frames a second, the height read at every frame (#483's `read`), so frame k shows step k. The drop's
// height is step 0's largest, 1; the largest height of any cell at any of steps 1 to 3,600, above or below the still
// surface, is under 2.
//
// The planted check lives in the binary, reachable only as `deep-gpu run --planted check_skips_bound`: a check that
// never computes the bound. It accepts the 3.33 document, and the refusal line fails on it.
//
// At the base (9550dc0f) the check reads past `stepped.bound` and accepts the 2 m/s operator, a stepped operator
// that writes a texture doesn't run, and no planted program is named check_skips_bound.
import { describe, expect, it } from 'vitest';
import {
  AC, DROP_HEIGHT, HEIGHT, REFUSED_SPEED, SPEED, WATER, checkCall, checked, dropProblems, heights, largest, play, ratio, refusalProblems, requireGpu, run, useBin, useOut,
  waterOp, type JsonObject, type Planted,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const STEPS = 3600;

/** The check's reply on the water at `speed`, or why the binary gave none. */
function check(speed: number, planted?: Planted): { failed: string; reply: JsonObject } {
  const exe = bin();
  if (exe.unbuilt !== '') return { failed: `the binary didn't build: ${exe.unbuilt}`, reply: {} };
  const ran = run(exe.bin, out(), [checkCall(waterOp({ speed }))], planted);
  return { failed: ran.failed, reply: ran.replies[0] ?? {} };
}

describe(`${AC[2]} the check enforces a stepped operator's stability bound`, () => {
  it(`${AC[2]} at 2 m/s the ratio is 3.33 and the operator is refused at check, before anything runs, naming the operator and 3.33`, () => {
    expect(ratio(REFUSED_SPEED).toFixed(2), 'speed × (1 ÷ rate) ÷ cell for 2 m/s, 60 steps a second and 1 cm cells').toBe('3.33');
    const { failed, reply } = check(REFUSED_SPEED);
    expect(failed, 'deep-gpu run answered the check').toBe('');
    expect(refusalProblems(reply, WATER, REFUSED_SPEED), 'the refusal line: the check refuses the 3.33 document, naming the operator and 3.33').toEqual([]);
  }, 1_200_000);

  it(`${AC[2]} at 0.24 m/s it checks, and the largest height over 3,600 steps stays under twice the drop's`, () => {
    requireGpu();
    expect(ratio(SPEED), 'speed × (1 ÷ rate) ÷ cell for 0.24 m/s is under the default max, 0.5').toBeLessThan(0.5);
    const { failed, reply } = check(SPEED);
    expect(failed, 'deep-gpu run answered the check').toBe('');
    expect(checked(reply).accepted, `at 0.24 m/s the operator checks: ${checked(reply).said}`).toBe(true);

    const dir = out();
    const { problem, frames } = play(bin(), dir, 'water', waterOp({ speed: SPEED }), { frames: STEPS + 1, capture: 'every', read: [HEIGHT] });
    expect(problem, 'view3d draws the water').toBe('');
    expect(frames.length, `view3d drew frames 0 to ${STEPS}`).toBe(STEPS + 1);
    expect(frames.filter((f) => f.step !== f.frame).slice(0, 5).map((f) => `frame ${f.frame} shows step ${String(f.step)}`), `each frame k shows the carried height (${HEIGHT}) at step k`).toEqual([]);

    const start = heights(dir, frames[0], 'step 0');
    expect(typeof start === 'string' ? [start] : dropProblems(start), 'step 0 is the drop').toEqual([]);
    const drop = largest(start as Float32Array);
    expect(drop, "the drop's height is step 0's largest, 1").toBeCloseTo(DROP_HEIGHT, 5);

    // The largest height of any cell at any of steps 1 to 3,600; a height that isn't finite ends the search as NaN.
    let most = 0;
    let at = 0;
    let last = 0;
    const unread: string[] = [];
    for (const f of frames.slice(1)) {
      const h = heights(dir, f, `step ${f.frame}`);
      if (typeof h === 'string') { unread.push(h); break; }
      last = largest(h);
      if (!(last <= most)) { most = last; at = f.frame; }
      if (Number.isNaN(last)) break;
    }
    expect(unread, `the height is read at each of steps 1 to ${STEPS}`).toEqual([]);
    expect(most, `the largest height over ${STEPS} steps (${most}, at step ${at}) stays under twice the drop's (${drop})`).toBeLessThan(2 * drop);
    expect(last, `the water still moves at step ${STEPS}: its largest height there is above 0`).toBeGreaterThan(0);
  }, 1_200_000);

  it(`${AC[2]} a planted check that skips the bound (--planted check_skips_bound) accepts the 3.33 document and fails the refusal line`, () => {
    requireGpu();
    const { failed, reply } = check(REFUSED_SPEED, 'check_skips_bound');
    expect(failed, 'deep-gpu run --planted check_skips_bound answered the check').toBe('');
    expect(checked(reply).accepted, `the planted check accepts the 3.33 document: ${checked(reply).said}`).toBe(true);
    expect(refusalProblems(reply, WATER, REFUSED_SPEED).join('\n'), 'the planted check fails the refusal line, which names the operator and 3.33').toMatch(/^the check didn't refuse water at a ratio of 3\.33 \(.*\): its outcome is accepted$/);
  }, 1_200_000);
});
