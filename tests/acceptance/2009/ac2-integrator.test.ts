// #2009.67d10d73: free fall and rest on the ground match the pinned integrator's discrete solution within 1e-5 m
// (½·g·h²·N(N+1), h = 1/480 s, N = 480 substeps: 4.9152 m after 1 s); restitution, a pendulum chain and a hanging spring
// match the continuous curves within the behavior kit's tolerances (the first bounce within 3% of e²h, the spring's
// period within 1% of 1 ÷ hz, the chain's energy never more than 1% a second above its start over 10 s).
import { describe, expect, it } from 'vitest';
import {
  AC, G, RAD, TIMEOUT, bake, box, dynamic, floor, none, physics, prebuild, sphere, statesOf, world, type JsonObject, type State,
} from './helpers.ts';

prebuild();

const RATE = 120;
const SUBSTEPS = 4;
const H = 1 / (RATE * SUBSTEPS); // 1/480 s
/** The discrete solution after n substeps: each substep adds g·h to the speed, then moves the body by it. */
const discreteDrop = (n: number): number => 0.5 * G * H * H * n * (n + 1);
const MATERIAL = { plain: { friction: 0.5, restitution: 0, density: 1000 } };

describe(`${AC[2]} free fall and rest match the discrete solution; bounce, spring and chain match the kit's tolerances`, () => {
  it(`${AC[2]} free fall: every step within 1e-5 m of ½·g·h²·N(N+1), 4.9152 m after 1 s; a box resting on the ground stays within 1e-5 m`, () => {
    expect(Number(discreteDrop(RATE * SUBSTEPS).toFixed(4)), 'the issue\'s figure').toBe(4.9152);
    const fall = world({
      contact_materials: MATERIAL,
      shapes: { ball: sphere(0.1) },
      bodies: { ball: dynamic('ball', 'plain', [0, 0, 0], { mass: 1 }) },
    });
    const rest = world({
      contact_materials: MATERIAL,
      shapes: { floor: box([30, 0.1, 30]), cube: box([0.5, 0.5, 0.5]) },
      bodies: { floor: floor('plain'), cube: dynamic('cube', 'plain', [0, 0.5, 0], { mass: 1 }) },
    });
    const [falling, resting] = physics([bake(fall, RATE, { read: ['ball'] }), bake(rest, 2 * RATE, { read: ['cube'] })]);
    const f = statesOf(falling!, 'ball', RATE + 1, 'free fall');
    const off: string[] = [];
    f.forEach((s, k) => {
      const drop = f[0]!.pos[1] - s.pos[1];
      const want = discreteDrop(SUBSTEPS * k);
      if (Math.abs(drop - want) > 1e-5) off.push(`step ${k}: dropped ${drop.toFixed(7)} m, discrete ${want.toFixed(7)} m`);
    });
    none(off, 'free fall over 1 s matches ½·g·h²·N(N+1) at every step within 1e-5 m');
    const r = statesOf(resting!, 'cube', 2 * RATE + 1, 'rest on the ground');
    const settled = r[RATE]!.pos[1];
    expect(Math.abs(settled - 0.5), `the box rests on the floor at 1 s (centre ${settled.toFixed(7)} m, built at 0.5 m)`).toBeLessThan(0.001);
    const moved = r.slice(RATE).flatMap((s, i) => (Math.abs(s.pos[1] - settled) > 1e-5 ? [`step ${RATE + i}: height ${s.pos[1].toFixed(7)} m, at 1 s ${settled.toFixed(7)} m`] : []));
    none(moved, 'at rest on the ground the box doesn\'t move (the discrete solution): from 1 s to 2 s its height stays within 1e-5 m of its height at 1 s');
  }, TIMEOUT);

  it(`${AC[2]} restitution 0.5 against 0.9 dropped 1 m: the first bounce within 3% of e²h under each combine rule`, () => {
    const R = 0.1;
    // e under each rule (canvas primitives: Physics: behavior kit): max 0.9, min 0.5, average 0.7, geometric √0.45, multiply 0.45.
    const rules: Record<string, number> = { max: 0.9, min: 0.5, average: 0.7, geometric: Math.sqrt(0.45), multiply: 0.45 };
    const names = Object.keys(rules);
    const worlds = names.map((rule) => world({
      combine: { friction: 'geometric', restitution: rule },
      contact_materials: { ball: { friction: 0.5, restitution: 0.5, density: 1000 }, ground: { friction: 0.5, restitution: 0.9, density: 1000 } },
      shapes: { floor: box([30, 0.1, 30]), ball: sphere(R) },
      bodies: { floor: floor('ground'), ball: dynamic('ball', 'ball', [0, 1 + R, 0], { mass: 1 }) },
    }));
    const steps = 2 * RATE;
    const replies = physics(worlds.map((w) => bake(w, steps, { read: ['ball'] })));
    const off: string[] = [];
    names.forEach((rule, i) => {
      const s = statesOf(replies[i]!, 'ball', steps + 1, `combine ${rule}`);
      const up = s.findIndex((x, k) => k > 0 && x.linear[1] > 0);
      if (up < 0) { off.push(`${rule}: the ball never bounces`); return; }
      let apex = -Infinity;
      for (let k = up; k < s.length && s[k]!.linear[1] > 0; k++) apex = Math.max(apex, s[k]!.pos[1] - R);
      const want = rules[rule]! ** 2 * 1;
      if (Math.abs(apex - want) > 0.03 * want) off.push(`${rule}: first bounce ${apex.toFixed(4)} m, e²h ${want.toFixed(4)} m (3%: ±${(0.03 * want).toFixed(4)})`);
    });
    none(off, 'each combine rule\'s first bounce is within 3% of e²h');
  }, TIMEOUT);

  it(`${AC[2]} a hanging spring (hz 2, damping_ratio 0, 4 kg): its period within 1% of 1 ÷ hz`, () => {
    const hz = 2;
    const w = world({
      contact_materials: MATERIAL,
      shapes: { bob: sphere(0.1) },
      bodies: { bob: dynamic('bob', 'plain', [0, -1, 0], { mass: 4 }) },
      joints: { spring: { kind: 'distance', a: 'world', b: 'bob', frame_a: { anchor: [0, 0, 0] }, frame_b: { anchor: [0, 0, 0] }, spring: { hz, damping_ratio: 0, rest: 1 } } },
    });
    const steps = 5 * RATE;
    const [reply] = physics([bake(w, steps, { read: ['bob'] })]);
    const y = statesOf(reply!, 'bob', steps + 1, 'the hanging spring').map((s) => s.pos[1]);
    const mean = y.reduce((a, b) => a + b, 0) / y.length;
    const ups: number[] = [];
    for (let k = 1; k < y.length; k++) {
      const a = y[k - 1]! - mean; const b = y[k]! - mean;
      if (a < 0 && b >= 0) ups.push((k - 1 + a / (a - b)) / RATE);
    }
    expect(ups.length, `the bob oscillates about its mean (${mean.toFixed(4)} m): upward crossings ${ups.map((t) => t.toFixed(3)).join(', ')}`).toBeGreaterThanOrEqual(8);
    const period = (ups[ups.length - 1]! - ups[0]!) / (ups.length - 1);
    expect(Math.abs(period - 1 / hz) / (1 / hz), `period ${period.toFixed(5)} s, 1 ÷ hz = ${(1 / hz).toFixed(5)} s, within 1%`).toBeLessThanOrEqual(0.01);
  }, TIMEOUT);

  it(`${AC[2]} a pendulum chain of 5 ball-jointed links released level: its energy never more than 1% a second above its start over 10 s`, () => {
    const LINKS = 5; const L = 0.5; const M = 1; const R = 0.05; const I = 0.4 * M * R * R;
    const bodies: JsonObject = {}; const joints: JsonObject = {};
    for (let i = 1; i <= LINKS; i++) {
      bodies[`l${i}`] = dynamic('link', 'plain', [L * i, 0, 0], { mass: M });
      joints[`j${i}`] = { kind: 'ball', a: i === 1 ? 'world' : `l${i - 1}`, b: `l${i}`, frame_a: { anchor: [0, 0, 0] }, frame_b: { anchor: [-L, 0, 0] } };
    }
    const w = world({ contact_materials: MATERIAL, shapes: { link: sphere(R) }, bodies, joints });
    const steps = 10 * RATE;
    const ids = Object.keys(bodies);
    const [reply] = physics([bake(w, steps, { read: ids })]);
    const series = ids.map((id) => statesOf(reply!, id, steps + 1, `link ${id}`));
    // Energy above the chain's rest (every link hanging straight down from the pivot), from the bodies' states.
    const energy = (k: number): number => series.reduce((e, s, i) => {
      const x: State = s[k]!; const spin = x.angular.map((d) => d * RAD); // deg/s to rad/s
      return e + 0.5 * M * (x.linear[0] ** 2 + x.linear[1] ** 2 + x.linear[2] ** 2) + 0.5 * I * (spin[0]! ** 2 + spin[1]! ** 2 + spin[2]! ** 2) + M * G * (x.pos[1] + L * (i + 1));
    }, 0);
    const e0 = energy(0);
    expect(e0, 'the level chain starts with Σ m·g·L·i above its rest').toBeCloseTo(M * G * L * 15, 3);
    const over: string[] = []; let fastest = 0;
    for (let k = 1; k <= steps; k++) {
      const e = energy(k); const t = k / RATE;
      if (!Number.isFinite(e) || e > e0 * (1 + 0.01 * t)) over.push(`t ${t.toFixed(3)} s: energy ${e.toFixed(4)} J, start ${e0.toFixed(4)} J, limit ${(e0 * (1 + 0.01 * t)).toFixed(4)} J`);
      for (const s of series) fastest = Math.max(fastest, Math.hypot(...s[k]!.linear));
    }
    expect(fastest, 'the chain swings (a link passes 1 m/s)').toBeGreaterThan(1);
    none(over, 'the chain\'s energy stays at or below its start plus 1% a second');
  }, TIMEOUT);
});
