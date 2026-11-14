// AC2: "A spark bounces off its declared planes at their closed-form times and never off anything else"
//
// The sparks fixture (helpers.ts: sparksDoc): 64 sparks burst from the origin at 0 s up a cone at 2 to 4 m/s under
// gravity, bouncing off two declared planes, a floor y = −0.5 m and a wall x = 1.2 m (restitution 0.5, friction 0,
// at most 3 bounces, then each dies), with an undeclared 0.6 m box in the way of some. From each spark's own birth
// point and launch velocity, as the `particles` call's CPU closed form reports them, this test solves its path itself:
// each next bounce is the earliest quadratic root at which it meets a declared plane moving against its normal, and it
// leaves with v − (1 + e)(v · n) n. The CPU's bounces must be those, plane for plane, each time within 1e-9 s and
// place within 1e-9 m, its death at its third, and its position at 20 random times within 1e-9 m (none once it has
// died). Guards: every spark meets the floor, some meet the wall, and some pass through the box's volume, where a
// bounce off anything else would show. The criterion names no planted program.

import { describe, expect, it } from 'vitest';
import {
  OBSTACLE, SPARK_BOUNCE, SPARK_PLANES, TIMEOUT, ac, bouncePath, fmt, fmtV, gap, none, particlesCall, passed, randomFlicks,
  reading, runGpu, secondsOf, sparksDoc, useBins, useDir, writeJson, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const G: V3 = [0, -9.81, 0];
const TOL = 1e-9;

describe(`${ac(2)} a spark bounces off its declared planes at their closed-form times and never off anything else`, () => {
  it(`${ac(2)} 64 sparks under gravity bounce off a floor and a wall at the quadratic roots this test solves, within 1e-9 s and m, die at their third bounce, and pass through an undeclared box`, () => {
    const times = randomFlicks(4492, 20, 0, 3);
    const call = particlesCall({ doc: writeJson(dir(), 'sparks.json', sparksDoc()), t: times });
    const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop' });
    const r = reading(passed(reply!, call, 'the sparks'), 'sparks', 'the sparks');
    expect(r.particles.length, 'the burst gives 64 sparks').toBe(64);

    const fails: string[] = [];
    let walls = 0;
    let through = 0;
    const lo = OBSTACLE.pos.map((c, k) => c - OBSTACLE.size[k]! / 2);
    const hi = OBSTACLE.pos.map((c, k) => c + OBSTACLE.size[k]! / 2);
    for (const p of r.particles) {
      const name = `spark row ${p.row}`;
      const path = bouncePath(p.born, p.from, p.velocity, G, SPARK_PLANES, SPARK_BOUNCE.restitution, SPARK_BOUNCE.max, SPARK_BOUNCE.life, 'die');
      if (!path.hits.some((h) => h.plane === 0)) fails.push(`${name}: the fixture expects it to meet the floor, but its solved path doesn't`);
      if (path.hits.some((h) => h.plane === 1)) walls++;
      for (let k = 0; k <= 400; k++) {
        const q = path.at(p.born + (k / 400) * (path.ends - p.born));
        if (q && [0, 1, 2].every((a) => q[a]! > lo[a]! && q[a]! < hi[a]!)) { through++; break; }
      }
      const got = p.hits.map((h) => `${h.plane === null ? 'land' : `plane ${h.plane}`} at ${fmt(h.t, 9)} s`).join(', ') || 'none';
      const want = path.hits.map((h) => `plane ${h.plane} at ${fmt(h.t, 9)} s`).join(', ') || 'none';
      if (p.hits.length !== path.hits.length || p.hits.some((h, k) => h.plane !== path.hits[k]!.plane || Math.abs(h.t - path.hits[k]!.t) > TOL || gap(h.at, path.hits[k]!.at) > TOL)) {
        fails.push(`${name}: bounces ${got}; its closed form's are ${want}`);
      }
      if (Math.abs(p.ends - path.ends) > TOL) fails.push(`${name}: ends at ${fmt(p.ends, 9)} s; it dies at its third bounce, ${fmt(path.ends, 9)} s`);
      for (const s of r.at) {
        const t = secondsOf(s.t);
        const want3 = path.at(t);
        const got3 = s.cpu[p.row] ?? null;
        if ((want3 === null) !== (got3 === null) || (want3 && got3 && gap(want3, got3) > TOL)) {
          fails.push(`${name} at t = ${fmt(t, 6)} s: the CPU places it at ${fmtV(got3, 9)}, its closed form at ${fmtV(want3, 9)}`);
        }
      }
    }
    none(fails, 'each spark against its closed-form bounces');
    expect(walls, 'some sparks meet the wall (the fixture spreads them so)').toBeGreaterThan(0);
    expect(through, 'some sparks pass through the undeclared box, which they must not bounce off').toBeGreaterThan(0);
  }, TIMEOUT);
});
