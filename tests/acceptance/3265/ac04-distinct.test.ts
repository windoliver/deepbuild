// AC4 #3265.db483311: "The result's `distinct` equals the count of distinct floor hashes at each depth, and the design's
// Result line lists it"
//
// The generator `mixed` (programs.ts): its 20 runs give 2 distinct floors at depth 1 and 4 at depth 2 (two of them depth
// 1's own grids), and the 11 runs that go to depth 3 give 11. This suite counts them itself, by its own hash of the grids
// its own plays recorded. Under differ 0.9 the result's distinct holds those counts, as do the hashes its floors list;
// and each depth under the share fails grid.same with exactly those numbers (depths 1 and 2), depth 3 doesn't.
// The design: the Result line of docs/canvas-primitives.md, Check input: `grid.reach`, lists `distinct: {depth → floors}`.
// The wrong programs: the base, which fails no depth and whose design lists no distinct; a report that counts runs
// (20, 20, 11), floors (20, 20, 11), or distinct floors across depths (depth 2's two grids seen before at depth 1), a
// check that judges the floors of all depths together, or only the first.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from '../556/helpers.ts';
import { AC, DIFFER, TIMEOUT, bench, counted, keep, reachOf, reachSpec, runCheck, sameWrong, told } from './helpers.ts';
import { RUNS, SEED, playtest, reach } from './programs.ts';

describe(`${AC[4]} the result's distinct is the count of distinct floor hashes at each depth`, () => {
  it(`${AC[4]} distinct equals this suite's own count at each depth, and each depth under the share fails with its counts`, async () => {
    const { pool, hub, play } = await bench();
    const mixed = keep('mixed');
    const mine = await counted(pool, mixed, SEED.plain);
    expect(mine, 'the floors this suite\'s own plays of the 20 runs record').toEqual({ 1: { runs: RUNS, floors: 2 }, 2: { runs: RUNS, floors: 4 }, 3: { runs: 11, floors: 11 } });
    const r = await runCheck(hub, reachSpec(reach(DIFFER, [1, 2, 3]), playtest(mixed, play, SEED.plain)));
    const x = reachOf(r);
    expect(x.distinct, `distinct is the count at each depth: ${told(r)}`).toEqual(Object.fromEntries(Object.entries(mine).map(([d, c]) => [d, c.floors])));
    expect(x.coverage, 'and coverage the runs that generated it').toEqual(Object.fromEntries(Object.entries(mine).map(([d, c]) => [d, c.runs])));
    for (const d of Object.keys(mine)) {
      expect(new Set(x.floors.filter((f) => String(f.depth) === d).map((f) => f.hash)).size, `depth ${d}: as many distinct hashes among the floors listed`).toBe(mine[d]!.floors);
    }
    expect([...sameWrong(r, 1, RUNS, 2), ...sameWrong(r, 2, RUNS, 4)], 'depths 1 and 2 fail grid.same with those counts').toEqual([]);
    expect(r.failures.length, `and nothing else fails, depth 3's 11 floors being distinct: ${told(r)}`).toBe(2);
  }, TIMEOUT);

  it(`${AC[4]} the design's Result line lists distinct: {depth → floors}`, () => {
    const doc = readFileSync(join(REPO, 'docs', 'canvas-primitives.md'), 'utf8');
    const section = doc.split('#### Check input: `grid.reach`')[1]?.split(/^#{1,4} /m)[0] ?? '';
    const line = section.split('\n').find((l) => l.startsWith('- Result:')) ?? '';
    expect(line.replace(/\s+/g, ' '), 'docs/canvas-primitives.md, Check input: `grid.reach`, the Result line').toMatch(/\bdistinct: ?\{ ?depth → floors ?\}/);
  });
});
