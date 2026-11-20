// #1993.7a269d05: "4,096 points under softened gravity keep total momentum within 1e-5 of the summed momentum
// magnitudes over 1,000 steps on one machine, in under 2 ms of GPU a step on the reference Mac, or the budget part
// reads INCONCLUSIVE. A planted step that reads positions this step already wrote, in place of the previous step's,
// drifts and fails the momentum line"
//
// The points (helpers.ts: bodiesOps) are 4,096 of equal mass in a plane, stepped 60 times a second: their two fields
// are the carried storage outputs `position` and `velocity` of the one stepped operator `bodies`, and a step moves
// each point, adds to each the softened pull of all 4,095 others, taken between the places the previous step left
// (six operators of 3 others a fetch group), and keeps the two fields. Through #378's `view3d` at 60 frames a
// second, so frame k shows step k, with #483's `read` of the two fields.
//
// The momentum line. The pull of j on i is the exact opposite of the pull of i on j, so the pulls change no total
// momentum. With the points' equal mass taken as 1, at steps 1, 250, 500, 750 and 1,000 the total momentum (the sum
// of the velocities, in f64) is within 1e-5 × the summed momentum magnitudes (the sum of the speeds) of the total at
// step 0. The state is a disc that turns and has moved: 8,192 finite words a field, speeds summing past 0, and
// positions at step 1,000 that aren't those of step 0.
//
// The budget part. One step's GPU time is what the frame that runs it reports for the step's operators (#380's
// `timings`: `passes_ms["op.<operator>"]`, summed over the step's nine operators; the base reports a whole step
// under its first operator's name). A run plays steps 1 to 1,000 and its value is their 95th percentile; the
// design's judge takes five runs after a warm-up one on a reference Mac, PASS when all five are within 2 ms, FAIL
// when all five are over by more than the margin on a machine that isn't loaded, otherwise INCONCLUSIVE; off a
// reference Mac it reads INCONCLUSIVE.
//
// The planted step is a wrong document, not a wrong binary: the same operators, except that the pulls read the
// other points' positions from `bodies_move.moved`, which this step already wrote, in place of the `position` field
// as the previous step left it (helpers.ts: bodiesOps, othersThisStep). A point is then pulled toward where the
// others have moved to from where it was, the two pulls of a pair no longer cancel, and the momentum line fails on
// it, naming the first step past the bound and the drift.
import { describe, expect, it } from 'vitest';
import {
  AC, BODIES, BODY_FIELDS, BODY_RATE, BODY_STEP_OPS, BODY_WORDS, checks, bodiesOps, inconclusive, judge, momentum, refusal, refusals, requireGpu, requireReferenceMac, run,
  sceneDoc, useBin, useOut, view3dCall, view3dFrames, withEstimates, wordsOf, writeJson, type JsonObject, type V3Frame, type Words,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const STEPS = 1000;
const READ_AT = [0, 1, 250, 500, 750, STEPS];
/** "Within 1e-5 of the summed momentum magnitudes". */
const BOUND = 1e-5;
/** "Under 2 ms of GPU a step". */
const STEP_MS = 2;

interface State { position: Words; velocity: Words }
interface Played { refused: string[]; drew: string; frames: V3Frame[]; states: Map<number, State> }

/** The points' document under `dir`, or the check's refusals. */
function document(dir: string, name: string, othersThisStep: boolean): { refused: string[]; doc: string } {
  const ops = bodiesOps({ othersThisStep });
  const replies = checks(bin(), dir, ops);
  const refused = refusals(ops, replies);
  return { refused, doc: refused.length > 0 ? '' : writeJson(dir, `${name}.json`, sceneDoc(`${name}-1993`, withEstimates(ops, replies))) };
}
/** The points played to step 1,000 at one frame a step, their two fields read at READ_AT. */
function play(name: string, othersThisStep: boolean): Played {
  const dir = out();
  const { refused, doc } = document(dir, name, othersThisStep);
  if (refused.length > 0) return { refused, drew: '', frames: [], states: new Map() };
  const [reply] = run(bin(), dir, [view3dCall({ doc, fps: BODY_RATE, frames: STEPS + 1, capture: READ_AT, read: Object.values(BODY_FIELDS) })]);
  const frames = view3dFrames(reply!, name);
  if (frames.length === 0) return { refused, drew: refusal(reply!), frames, states: new Map() };
  const states = new Map<number, State>();
  for (const k of READ_AT) {
    const f = frames.find((x) => x.frame === k);
    if (f) states.set(k, { position: wordsOf(dir, f, BODY_FIELDS.position, name), velocity: wordsOf(dir, f, BODY_FIELDS.velocity, name) });
  }
  return { refused, drew: '', frames, states };
}

/** The state is 4,096 moving points: each problem as a sentence. */
function stateProblems(p: Played): string[] {
  const problems: string[] = [];
  for (const k of READ_AT) {
    const s = p.states.get(k);
    if (!s) { problems.push(`no frame shows step ${k}`); continue; }
    if (s.position.f32.length !== BODY_WORDS || s.velocity.f32.length !== BODY_WORDS) { problems.push(`at step ${k} the fields hold ${s.position.f32.length} and ${s.velocity.f32.length} words, not ${BODY_WORDS} each`); continue; }
    if (!s.position.f32.every(Number.isFinite) || !s.velocity.f32.every(Number.isFinite)) problems.push(`at step ${k} a position or a velocity isn't finite`);
    if (!(momentum(s.velocity.f32).magnitudes > 0)) problems.push(`at step ${k} no point moves: the summed momentum magnitudes are ${momentum(s.velocity.f32).magnitudes}`);
    const step = p.frames.find((f) => f.frame === k)?.carried.get(BODY_FIELDS.velocity)?.step;
    if (step !== k) problems.push(`frame ${k} shows the points at step ${String(step)}`);
  }
  const [first, last] = [p.states.get(0), p.states.get(STEPS)];
  if (first && last && first.position.hash === last.position.hash) problems.push(`the points are at step ${STEPS} where they were at step 0`);
  return problems;
}
/** The momentum line: at each step read, the total momentum is within 1e-5 × the summed magnitudes of step 0's. Each problem names the step and the drift. */
function momentumProblems(p: Played): string[] {
  const start = p.states.get(0);
  if (!start) return ['no frame shows step 0'];
  const p0 = momentum(start.velocity.f32).total;
  return READ_AT.slice(1).flatMap((k) => {
    const s = p.states.get(k);
    if (!s) return [`no frame shows step ${k}`];
    const m = momentum(s.velocity.f32);
    const drift = Math.hypot(m.total[0] - p0[0], m.total[1] - p0[1]) / m.magnitudes;
    return drift <= BOUND ? [] : [`at step ${k} total momentum has drifted ${drift.toExponential(3)} of the summed momentum magnitudes (${m.magnitudes}), past ${BOUND}`];
  });
}
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)]!;

describe(`${AC[6]} 4,096 points under softened gravity keep their total momentum`, () => {
  it(`${AC[6]} over 1,000 steps total momentum stays within 1e-5 of the summed momentum magnitudes; a planted step that reads positions this step already wrote, in place of the previous step's, drifts and fails the momentum line`, () => {
    requireGpu();
    const points = play('bodies', false);
    expect(points.refused, `the ${BODIES} points' nine operators check`).toEqual([]);
    expect(points.drew, 'view3d drew the points').toBe('');
    expect(stateProblems(points), 'the state is 4,096 moving points at each step read').toEqual([]);
    expect(momentumProblems(points), 'the momentum line: total momentum within 1e-5 of the summed momentum magnitudes over 1,000 steps').toEqual([]);

    // The planted step: the pulls read the others' positions as this step already wrote them.
    const planted = play('bodies-others-this-step', true);
    expect(planted.refused, 'the planted points\' operators check').toEqual([]);
    expect(planted.drew, 'view3d drew the planted points').toBe('');
    expect(stateProblems(planted), 'the planted state is 4,096 moving points at each step read').toEqual([]);
    const failed = momentumProblems(planted).join('\n');
    expect(failed, 'the planted step drifts and fails the momentum line, naming the step and the drift').toMatch(/at step \d+ total momentum has drifted [0-9.e+-]+ of the summed momentum magnitudes \([0-9.e+-]+\), past 0\.00001/);
  }, 3_600_000);

  it(`${AC[6]} one step takes under ${STEP_MS} ms of GPU on the reference Mac (five runs of 1,000 steps after a warm-up), or the budget part reads INCONCLUSIVE`, () => {
    requireReferenceMac();
    const dir = out();
    const { refused, doc } = document(dir, 'bodies', false);
    expect(refused, `the ${BODIES} points' nine operators check`).toEqual([]);
    const call: JsonObject = view3dCall({ doc, fps: BODY_RATE, frames: STEPS + 1, timings: true });
    const replies = run(bin(), dir, Array.from({ length: 6 }, () => call));
    const runs = replies.map((reply, n) => {
      const frames = view3dFrames(reply, `timed run ${n}`);
      expect(frames.length, `timed run ${n} drew ${STEPS + 1} frames (${refusal(reply)})`).toBe(STEPS + 1);
      const steps = frames.filter((f) => f.frame >= 1).map((f) => {
        const ms = BODY_STEP_OPS.map((id) => f.passesMs?.get(`op.${id}`)).filter((v): v is number => v !== undefined);
        expect(ms.length, `timed run ${n}, frame ${f.frame}: passes_ms reports the step's operators' GPU time`).toBeGreaterThan(0);
        expect(f.carried.get(BODY_FIELDS.velocity)?.step, `timed run ${n}: frame ${f.frame} ran step ${f.frame}`).toBe(f.frame);
        return ms.reduce((a, b) => a + b, 0);
      });
      return p95(steps);
    });
    const verdict = judge('4,096 points under softened gravity, GPU ms a step (p95 of 1,000 steps)', runs.slice(1), STEP_MS);
    if (verdict.verdict === 'INCONCLUSIVE') inconclusive(verdict.line);
    expect(verdict.verdict, verdict.line).toBe('PASS');
  }, 3_600_000);
});
