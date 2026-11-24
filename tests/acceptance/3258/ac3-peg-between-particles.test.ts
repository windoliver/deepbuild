// #3258.e4187366: "On that build, the rope's two ends ride kinematic bodies down past a static peg 4 mm across that stands
// between two of its particles: the audit fails, naming that edge and the peg, though no particle comes within 2 cm of the
// peg. Lowered beside the peg, it passes"
//
// The peg is a cylinder 4 mm across lying along z, midway between particles 10 and 11 (x = 25 mm) and 0.3 m below the rope;
// the two ends go down at 1 m/s on their bodies' channels while the rope between them falls. Read back from the same
// build's bake: no particle's straight moves come within 2 cm of the peg, and of the 20 edges only 10–11 sweeps the peg's
// axis, in one step (30), from over 5 mm above the peg to over 5 mm below it, so no state of the run shows the two
// touching. One edge and one peg pass each other once, so the audit's `through` reads 1.
//
// Beside it the same rope goes down with the peg 0.1 m aside along z, its near end 5 cm off. The other rules are set wide
// (the edges by the ends stretch as the ends go ahead), so the verdicts are `through`'s.
import { describe, expect, it } from 'vitest';
import {
  AC, PEG, PEG_RADIUS, PEG_X, PEG_Y, ROPE, TIMEOUT, WIDE, audit, bakes, cleanBuilds, edgeOf, failFailures, full, none, passFailures, pathsOf,
  peggedRope, readOf, show, swapped, told, useFailures, type V3,
} from './helpers.ts';

cleanBuilds();
const ID = AC[3];
const STEPS = 40;
const WHAT = 'the rope lowered past the peg';
const EDGE = full(ROPE, ['10', '11']);

/** The least distance from a particle's straight move between two states to the peg's surface, in the plane the rope moves in (no particle leaves it). */
function clearance(a: V3, b: V3): number {
  const [dx, dy, ex, ey] = [b[0] - a[0], b[1] - a[1], PEG_X - a[0], PEG_Y - a[1]];
  const l = dx * dx + dy * dy;
  const t = l === 0 ? 0 : Math.min(1, Math.max(0, (ex * dx + ey * dy) / l));
  return Math.hypot(ex - t * dx, ey - t * dy) - PEG_RADIUS;
}
/** The height over the peg's axis of the edge from `p` to `q` where it stands over the axis, or null where it doesn't. */
function over(p: V3, q: V3): number | null {
  const [lo, hi] = p[0] < q[0] ? [p, q] : [q, p];
  if (PEG_X < lo[0] || PEG_X > hi[0]) return null;
  return lo[1] + ((PEG_X - lo[0]) / (hi[0] - lo[0])) * (hi[1] - lo[1]) - PEG_Y;
}

describe(`${ID} a peg that passes between two particles of a rope fails the audit`, () => {
  it(`${ID} the rope's ends ride down past a peg 4 mm across between two of its particles: the audit fails, naming that edge and the peg, though no particle comes within 2 cm of it`, () => {
    const w = peggedRope(false);
    const [baked, reply] = swapped([bakes(w, STEPS), audit(w, STEPS, WIDE)]);
    const path = pathsOf(baked, ROPE, STEPS, WHAT);
    expect(path.flat().filter((p) => p[2] !== 0).length, 'the fixture: the rope moves in the plane z = 0').toBe(0);
    const near = path.slice(1).flatMap((s, k) => s.map((b, i) => clearance(path[k]![i]!, b)));
    expect(Math.min(...near), 'the fixture: no particle comes within 2 cm of the peg').toBeGreaterThan(0.02);
    const sweeps = path.slice(1).flatMap((s, k) => Array.from({ length: 20 }, (_, i) => {
      const [was, is] = [over(path[k]![i]!, path[k]![i + 1]!), over(s[i]!, s[i + 1]!)];
      return was !== null && is !== null && was > 0 && is <= 0 ? { edge: i, step: k + 1, was, is } : null;
    }).filter((x) => x !== null));
    console.log(`${WHAT}: least clearance ${(1000 * Math.min(...near)).toFixed(2)} mm; edges that sweep the peg's axis ${show(sweeps)}`);
    expect(sweeps.map((s) => s.edge), 'the fixture: only the edge from particle 10 to 11 sweeps the peg, once').toEqual([10]);
    const pass = sweeps[0]!;
    expect([pass.was > 0.005, pass.is < -0.005], 'the fixture: it is over 5 mm above the peg\'s axis before that step and over 5 mm below it after').toEqual([true, true]);

    const r = readOf(reply, WHAT);
    console.log(`${WHAT}: ${told(r)}`);
    const failures = failFailures(r, STEPS, WHAT);
    for (const f of r.rows) {
      if (JSON.stringify(edgeOf(f)) !== JSON.stringify(EDGE)) failures.push(`${WHAT}: a failure names the edge ${show(edgeOf(f))}, not ${EDGE.join(' to ')}: ${show(f)}`);
      if (f['step'] !== pass.step) failures.push(`${WHAT}: the edge is named at step ${show(f['step'])}, not ${pass.step}, when it passes the peg`);
      failures.push(...useFailures(f, PEG, WHAT));
    }
    if (r.through !== 1) failures.push(`${WHAT}: readings.through is ${show(r.through)}, not 1: one edge passes the peg once, and no particle passes anything`);
    none(failures, 'the audit of the rope lowered past the peg');
  }, 2 * TIMEOUT);

  it(`${ID} lowered beside the peg, the rope passes the audit`, () => {
    const what = 'the rope lowered beside the peg';
    const r = readOf(swapped([audit(peggedRope(true), STEPS, WIDE)])[0], what);
    console.log(`${what}: ${told(r)}`);
    none(passFailures(r, what), 'the audit of the rope lowered beside the peg');
  }, 2 * TIMEOUT);
});
