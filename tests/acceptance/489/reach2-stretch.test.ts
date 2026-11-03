// Criterion 9: "reach2 with stretch: cartoon scales both bones by max(1, d ÷ (l1 + l2)) exactly, never iterates, and
// keeps no bend side from an earlier frame"
//
// Oracle: Unreal's TwoBoneIK.cpp (396c9f0599, vendored in doneright/oracles), "formula" use: no upstream test; it
// solves the bend by the law of cosines with no iteration and, stretching from ratio 1, scales both bones by
// d ÷ (l1 + l2) once the target is out of reach. Ported here as that formula, held against our output.
//
// Through `deep-motion eval`. A 2D chain of three items: `upper` at the root (100, 100), `lower` its child at
// (60, 0) in its space (l1 = 60), `end` the child of `lower` at (40, 0) (l2 = 40); constraint `{owner: "upper",
// kind: "reach2", chain: ["upper", "lower", "end"], target: "goal", bend: 1 | -1, stretch: "cartoon"}`. `goal` is
// keyed through reach, out of reach, and across the root's line in hold jumps. Read: the items' evaluated world
// positions (the elbow is `lower`'s, the tip `end`'s) and the frame's `constraints.<id>: {ops, scale}` (README:
// Choices where the issue is open). The reference is computed here: s = max(1, d ÷ (l1 + l2)); the tip on the goal;
// the elbow s·l1 from the root and s·l2 from the tip, on the bend's side of the root → goal line.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, constraintAt, evalOk, film, fl, int, itemAt, keyed, none, num, rect, seekPlayFailures, seededTimes, useMotion,
  type Frame, type JsonObject,
} from './helpers.ts';

const motion = useMotion();

const ROOT: [number, number] = [100, 100];
const L1 = 60; const L2 = 40;
/** The goal's track: [seconds, x, y, interp], hold keys jumping across the root's line, linear ones sweeping out of reach. */
const GOAL: [number, number, number, string][] = [
  [0, 160, 130, 'linear'], [1, 150, 40, 'hold'], [2, 150, 160, 'linear'], [3, 280, 100, 'linear'], [4, 100, 240, 'hold'],
  [5, 60, 110, 'linear'], [6, 20, 60, 'hold'], [7, 140, 100, 'linear'], [8, 140, 100, 'hold'],
];
function chainDoc(id: string, bend: number): JsonObject {
  const track = (k: 1 | 2): JsonObject => keyed(`items/goal/at/pos/${k - 1}`, Object.fromEntries(GOAL.map(([s, x, y, interp], i) => [`g${i}`, { t: `${s}s`, value: k === 1 ? x : y, interp }])));
  return film(id, [rect('upper', ROOT), rect('lower', [L1, 0], { parent: 'upper' }), rect('end', [L2, 0], { parent: 'lower' }), rect('goal', [GOAL[0]![1], GOAL[0]![2]])], {
    channels: { gx: track(1), gy: track(2) },
    constraints: { arm: { owner: 'upper', kind: 'reach2', chain: ['upper', 'lower', 'end'], target: 'goal', bend, stretch: 'cartoon' } },
  }, { span: '8s' });
}
const BEND_UP = chainDoc('reach-bend-1', 1);
const BEND_DOWN = chainDoc('reach-bend-minus-1', -1);
const TIMES = seededTimes(489_09, 400, 0, fl(8));

const sub = (a: number[], b: number[]): [number, number] => [a[0]! - b[0]!, a[1]! - b[1]!];
const len = (v: [number, number]): number => Math.hypot(v[0], v[1]);
const cross = (a: [number, number], b: [number, number]): number => a[0] * b[1] - a[1] * b[0];

interface Pose { goal: [number, number]; elbow: [number, number]; tip: [number, number]; ops: number; scale: number }
function poseOf(f: Frame): Pose {
  const g = itemAt(f, 'goal', 'pos'); const e = itemAt(f, 'lower', 'pos'); const t = itemAt(f, 'end', 'pos');
  const c = constraintAt(f, 'arm');
  return { goal: [g[0], g[1]], elbow: [e[0], e[1]], tip: [t[0], t[1]], ops: int(c['ops'], `frame ${f.t}: constraints.arm.ops`), scale: num(c['scale'], `frame ${f.t}: constraints.arm.scale`) };
}

describe('criterion 9: reach2 with stretch: cartoon, in closed form', () => {
  it('criterion 9: at 400 random times both bones scale by max(1, d ÷ (l1 + l2)): the scale within 1e-12, the tip on the goal and the joints s·l1 and s·l2 apart within 1e-9', () => {
    const a = evalOk(motion.bin(), { doc: BEND_UP, times: TIMES }, 'the stretching chain');
    const failures: string[] = [];
    let stretched = 0; let bent = 0;
    for (const f of a.frames) {
      const p = poseOf(f);
      const d = len(sub(p.goal, ROOT));
      const s = Math.max(1, d / (L1 + L2));
      if (s > 1) stretched++; else if (d < L1 + L2 - 1) bent++;
      if (Math.abs(p.scale - s) > 1e-12 * s) failures.push(`at ${f.t} flicks (d ${d}) the bones scale by ${p.scale}, not max(1, d ÷ 100) = ${s}`);
      if (len(sub(p.tip, p.goal)) > 1e-9) failures.push(`at ${f.t} flicks the tip is at (${p.tip}), not on the goal (${p.goal})`);
      if (Math.abs(len(sub(p.elbow, ROOT)) - s * L1) > 1e-9) failures.push(`at ${f.t} flicks the upper bone is ${len(sub(p.elbow, ROOT))} long, not s·l1 = ${s * L1}`);
      if (Math.abs(len(sub(p.tip, p.elbow)) - s * L2) > 1e-9) failures.push(`at ${f.t} flicks the lower bone is ${len(sub(p.tip, p.elbow))} long, not s·l2 = ${s * L2}`);
    }
    none(failures, 'cartoon stretch');
    expect(stretched, 'the goal leaves the chain\'s reach at some sampled times').toBeGreaterThan(20);
    expect(bent, 'the goal is within reach at some sampled times').toBeGreaterThan(20);
  }, TIMEOUT);

  it('criterion 9: it never iterates: its op count is the same at every time, in reach or out of it', () => {
    const a = evalOk(motion.bin(), { doc: BEND_UP, times: TIMES }, 'the stretching chain');
    const counts = new Set(a.frames.map((f) => poseOf(f).ops));
    expect([...counts], 'one op count at every time').toHaveLength(1);
    expect([...counts][0], 'the solve counts its ops').toBeGreaterThan(0);
  }, TIMEOUT);

  it('criterion 9: it keeps no bend side from an earlier frame: the elbow lies on its bend sign\'s side at every time, mirrored by the opposite sign, and every time reads the same seeked and played', () => {
    const bin = motion.bin();
    const up = evalOk(bin, { doc: BEND_UP, times: TIMES }, 'bend 1');
    const down = evalOk(bin, { doc: BEND_DOWN, times: TIMES }, 'bend −1');
    const failures: string[] = [];
    let side = 0;
    up.frames.forEach((f, i) => {
      const p = poseOf(f); const q = poseOf(down.frames[i]!);
      const d = len(sub(p.goal, ROOT));
      if (d >= L1 + L2 - 1) return;
      const sideUp = Math.sign(cross(sub(p.goal, ROOT), sub(p.elbow, ROOT)));
      const sideDown = Math.sign(cross(sub(q.goal, ROOT), sub(q.elbow, ROOT)));
      if (side === 0) side = sideUp;
      if (sideUp !== side) failures.push(`bend 1: at ${f.t} flicks the elbow is on the ${sideUp > 0 ? 'left' : 'right'} of root → goal, on the other side from earlier times`);
      if (sideDown !== -side) failures.push(`bend −1: at ${f.t} flicks the elbow is on the same side as bend 1's`);
    });
    none(failures, 'the bend side comes from the bend sign alone');
    expect(side, 'the elbow is off the root → goal line').not.toBe(0);
    none([...seekPlayFailures(bin, BEND_UP, TIMES.filter((_, i) => i % 8 === 0), 'bend 1'), ...seekPlayFailures(bin, BEND_DOWN, TIMES.filter((_, i) => i % 8 === 4), 'bend −1')], 'seek equals play across the hold jumps');
  }, TIMEOUT);
});
