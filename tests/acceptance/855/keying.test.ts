// #855.6df0cf9c, third part: keying a 10,000-item revision takes under half its hash@1 time.
//
// The `keys` call (README: `keys`) computes every content key of the session's current revision afresh,
// `runs` times, under the process's hash, timing each pass by the binary's clock. On the release build
// (the optimized build the product runs), six pairs of fresh processes, one keyed with hash@1 (the
// scenario's `hash`) and one with hash@2, each give the median of 7 passes; the first pair is a warm-up,
// and the other five ratios hash@2 / hash@1 are judged against 0.5 by the design's rule for timing
// results: PASS when all are under, FAIL when all are over by more than the margin, else INCONCLUSIVE.
// Off a reference Mac, on battery, in Low Power Mode, with a thermal warning or loaded, the reading is
// printed and the test skips as INCONCLUSIVE; it never passes there. The wrong programs: the base (no
// `keys`, no hash@2); a hash@2 no faster than hash@1.
import { describe, expect, it } from 'vitest';
import {
  DOC, HASH1, HASH2, arr, environmentProblem, judge, keysCall, median, mixed, num, obj, presented, run, scenario, show, str, useBuilds, useTemp,
  type Build,
} from './helpers.ts';

const ID = '#855.6df0cf9c';
const RELEASE: Build = { set: 'full', release: true };
const builds = useBuilds([RELEASE]);
const temp = useTemp();
const BIG = mixed('Ten thousand, keyed', 10_000);
const RUNS = 7;
const PAIRS = 6;
const LIMIT = 0.5;

/** One fresh process keying BIG `RUNS` times under `hash`: the median ns of a pass, and how many keys a pass makes. */
function keying(hash: string | undefined): { ns: number; nodes: number; hash: string } {
  const [shown, reply] = run(builds.bin(RELEASE), scenario(temp(), [show(BIG), keysCall(DOC.a, RUNS)], hash ? { hash } : {}));
  presented(shown!, 'the 10,000-item board');
  const r = obj(reply, 'the keys reply');
  const passes = arr(r['ns'], 'the keys reply\'s ns').map((v, i) => num(v, `ns[${i}]`));
  expect(passes.length, `the keys call times ${RUNS} passes`).toBe(RUNS);
  for (const p of passes) expect(p, 'a pass takes time').toBeGreaterThan(0);
  return { ns: median(passes), nodes: num(r['nodes'], 'the keys reply\'s nodes'), hash: str(r['hash'], 'the keys reply\'s hash') };
}

describe(`${ID} keying a 10,000-item revision takes under half its hash@1 time`, () => {
  it(`${ID} keying the 10,000-item board with hash@2 takes under ${LIMIT} of its hash@1 time (five pairs of fresh release processes after a warm-up pair, judged by the design's rule)`, (ctx) => {
    const ratios: number[] = [];
    for (let p = 0; p < PAIRS; p++) {
      const one = keying(HASH1);
      const two = keying(undefined);
      expect(one.hash, 'the hash@1 process keys with hash@1').toBe(HASH1);
      expect(two.hash, 'the default process keys with hash@2').toBe(HASH2);
      expect(two.nodes, 'both key the same nodes').toBe(one.nodes);
      expect(one.nodes, 'a pass keys at least one node per item of the revision').toBeGreaterThanOrEqual(10_000);
      console.log(`${ID} pair ${p}${p === 0 ? ' (warm-up, discarded)' : ''}: hash@1 ${(one.ns / 1e6).toFixed(3)} ms, hash@2 ${(two.ns / 1e6).toFixed(3)} ms for ${one.nodes} keys`);
      if (p > 0) ratios.push(two.ns / one.ns);
    }
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}; hash@2 / hash@1 ratios ${ratios.map((r) => r.toFixed(3)).join(', ')}`);
    judge(ctx, `${ID} hash@2 / hash@1 keying time, 10,000 items`, ratios, LIMIT);
  }, 3_600_000);
});
