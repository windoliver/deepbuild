// AC3 #213.b4f8dc3a: "A step that writes 257 ray requests with max_per_step 256 traps services, naming physics.cast@1
// and 257, and the item's arrays keep the last good step's; and each answered request adds 4,000 fuel to the next step
// in the bake"
//
// Through `deep-show run`'s `logic` call (README): its `traps` (#531's LogicTrap with this suite's `service` and
// `count`) and each step's `fuel`. `flood` writes a count of 257 at step 20; `meter` does the same work every step and
// asks k mod 4 rays at step k, so step k's fuel less step 0's is 4,000 × ((k − 1) mod 4).

import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DOC, TIMEOUT, arr, binOf, handleOf, int, isObject, logicCall, none, one, perItem, presented, runShow, scenario, show, showCall,
  showSteps, useBuilds, useTemp, type JsonObject, type JsonValue,
} from './helpers.ts';
import { RANGE, castParams, probeHandles, rangeScene } from './fixtures.ts';
import { flood, meter } from './programs.ts';

const ID = CRITERIA[3];
useBuilds(['show']);
const temp = useTemp();

const N_WRITES: JsonObject = { n: { type: 'i32' } };

describe(`${ID} services are bounded and paid for: a count past max_per_step traps, and each request costs the next step its fuel`, () => {
  it(`${ID} flood's step 20 writes 257 requests with max_per_step 256: one services trap naming physics.cast@1 and 257 at step 20, and flood.n keeps step 19's value from step 20 on`, () => {
    const evidence = temp();
    const doc = DOC(31);
    const scene = rangeScene(evidence, { flood: { program: flood(), params: castParams(256, { writes: N_WRITES }) } });
    const steps = 30;
    const [shown, ran] = runShow(binOf('show'), scenario(evidence, [doc], [showCall(doc, scene), logicCall(doc, steps)]), 'the flood');
    presented(shown, 'the flood');
    const records = showSteps(ran, steps, 'the flood');
    const traps = arr(ran!['traps'], 'the flood: traps').filter(isObject).filter((t) => t['item'] === 'flood');
    expect(traps.length, `one trap of flood: ${show(ran!['traps'])}`).toBe(1);
    const t = traps[0]!;
    expect({ step: t['step'], kind: t['kind'], service: t['service'], count: t['count'] }, `the trap names the service and the count: ${show(t)}`)
      .toEqual({ step: 20, kind: 'services', service: 'physics.cast@1', count: 257 });
    const fails: string[] = [];
    records.forEach((r, k) => {
      const n = one(r, 'flood.n', 'the flood');
      const want = k < 20 ? k : 19;
      if (n !== want) fails.push(`step ${k}: flood.n is ${n}, not ${want}${k >= 20 ? ' (the last good step\'s, 19)' : ''}`);
    });
    none(fails, 'flood\'s arrays');
  }, TIMEOUT);

  it(`${ID} meter asks k mod 4 rays at step k with the same work every step: step k's fuel is step 0's plus 4,000 for each request step k − 1 asked`, () => {
    const bin = binOf('show');
    const evidence = temp();
    const h = probeHandles(bin, evidence, (logic) => rangeScene(evidence, logic), 'the meter');
    const doc = DOC(32);
    const scene = rangeScene(evidence, { meter: { program: meter(handleOf(h, RANGE, null, 'the meter')), params: castParams(4, { writes: N_WRITES }) } });
    const steps = 41;
    const [shown, ran] = runShow(bin, scenario(evidence, [doc], [showCall(doc, scene), logicCall(doc, steps)]), 'the meter');
    presented(shown, 'the meter');
    const records = showSteps(ran, steps, 'the meter');
    expect(arr(ran!['traps'] ?? [], 'the meter: traps'), 'the meter never traps').toEqual([]);
    const fuel = records.map((r) => int(perItem(r, 'fuel', 'meter', 'the meter'), `the meter: step ${String(r['step'])}'s fuel.meter`));
    expect(fuel[0], 'step 0 runs the program and pays its own fuel').toBeGreaterThan(0);
    const fails: string[] = [];
    for (let k = 1; k < steps; k++) {
      const asked = (k - 1) % 4;
      if (fuel[k]! - fuel[0]! !== 4000 * asked) fails.push(`step ${k}: fuel ${fuel[k]} is step 0's ${fuel[0]} plus ${fuel[k]! - fuel[0]!}, not plus 4,000 × the ${asked} requests step ${k - 1} asked`);
    }
    none(fails, `the meter's fuel, step by step: ${show(fuel as unknown as JsonValue)}`);
  }, TIMEOUT);
});
