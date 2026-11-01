// #185.da9aab76, redrafted blind for one condition: "with a behavior part of three fixtures with analytic
// answers and tolerances, B passes and seals".
//
// B is `test.sim.b`, the measured, backend_bytes implementation of test.sim@1 (canvas module `test.sim`),
// built alone (`test-sim-b`) with the interface's behavior part (`test-sim-behavior`) into the shipped `full`
// build set. The conformance kit (#138's `{"call":"kit"}`, defaults) runs over every module of that debug
// build and writes its ledger; a release build of the same feature set embeds that ledger (DEEP_KIT_LEDGER at
// build time, crates/deep-show/build.rs), and its seal refuses every module the ledger doesn't show PASS at
// its digest. "Passes" is read from the kit: the part the interface names as `behavior` runs three fixtures,
// each landing every analytic answer within its relative tolerance, and test.sim's record is PASS.
// "Seals" is read from the release build: it starts, and its published plan names test.sim.b as test.sim@1's
// implementation. At the base there is no `test-sim-b` feature, no `interfaces` in the plan and no behavior
// part, so the first build fails.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REGISTRY, SCHEDULE, arr, debugBuild, interfaceIn, kitCall, moduleIn, num, obj, partIn, releaseBuild, run, scenario, show, str,
  strs, useDir, useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const INTERFACE = 'test.sim@1';
const MODULE = 'test.sim';
const A = 'test.sim.a';
const B = 'test.sim.b';
/** B alone, with test.sim@1's behavior part, in the shipped build set. */
const B_WITH_BEHAVIOR: Build = { set: 'full', with: ['test-sim-b', 'test-sim-behavior'] };

const dir = useDir('deep-185-kit-redraft-');
const evidence = useEvidence();

/** The interface as the plan publishes it, checked to be B under an interface that holds a behavior part. */
function bUnderBehavior(schedule: JsonObject, what: string): { digest: string; behavior: string } {
  const iface = interfaceIn(schedule, INTERFACE);
  expect(iface.module, `${what}: test.sim@1 is implemented by the canvas module ${MODULE}`).toBe(MODULE);
  expect(iface.reference, `${what}: test.sim@1's reference implementation is A`).toBe(A);
  expect(iface.implementation.name, `${what}: the build chose B as test.sim@1's implementation`).toBe(B);
  expect(iface.implementation.equivalence, `${what}: B is declared measured`).toBe('measured');
  expect(iface.implementation.state, `${what}: B keeps backend_bytes state`).toBe('backend_bytes');
  expect(iface.behavior, `${what}: test.sim@1 holds a behavior part (not "none"): ${show(iface.raw)}`).not.toBe('none');
  expect(iface.behavior.length, `${what}: the behavior part has a name`).toBeGreaterThan(0);
  return { digest: iface.digest, behavior: iface.behavior };
}

describe('#185.da9aab76 with a behavior part of three fixtures with analytic answers and tolerances, B passes and seals', () => {
  it('#185.da9aab76 B, measured, passes test.sim@1\'s three-fixture behavior part in the kit, and the release build embedding that ledger seals it', () => {
    // 1. The debug build, and the interface as its plan publishes it.
    const debug = debugBuild(B_WITH_BEHAVIOR, dir());
    expect(debug.error, 'the debug build compiles: deep-show with features full,test-sim-b,test-sim-behavior').toBe('');
    const ledger = join(dir(), 'ledger.json');
    const [schedule, reply] = run(debug.bin, scenario(evidence(), [SCHEDULE, kitCall(ledger)]));
    const { digest, behavior } = bUnderBehavior(schedule!, 'the debug build');

    // 2. B passes: the behavior part runs three fixtures, each answer within its tolerance.
    const sim = moduleIn(reply!, MODULE);
    expect(sim['digest'], 'the kit tests test.sim at its interface\'s digest').toBe(digest);
    const part = partIn(sim, behavior);
    const cases = arr(part['cases'], `${behavior}.cases`).map((c, i) => obj(c, `${behavior}.cases[${i}]`));
    expect(num(part['declared'], `${behavior}.declared`), 'the behavior part declares three fixtures').toBe(3);
    expect(num(part['ran'], `${behavior}.ran`), 'the behavior part ran all three').toBe(3);
    expect(cases.length, `the behavior part lists one case per fixture: ${show(cases, 3000)}`).toBe(3);
    const fixtures = cases.map((c, i) => str(c['fixture'], `${behavior}.cases[${i}].fixture`));
    expect(new Set(fixtures).size, `three distinct fixtures: ${fixtures.join(', ')}`).toBe(3);
    for (const [i, c] of cases.entries()) {
      const name = fixtures[i]!;
      const answers = arr(c['answers'], `${name}.answers`).map((a, j) => obj(a, `${name}.answers[${j}]`));
      expect(answers.length, `${name} holds at least one analytic answer`).toBeGreaterThan(0);
      for (const [j, a] of answers.entries()) {
        const answer = str(a['answer'], `${name}.answers[${j}].answer`);
        const expected = num(a['expected'], `${name}.${answer}.expected`);
        const got = num(a['got'], `${name}.${answer}.got`);
        const tolerance = num(a['tolerance'], `${name}.${answer}.tolerance`);
        expect(tolerance, `${name}.${answer}: the interface holds a tolerance above zero`).toBeGreaterThan(0);
        expect(Math.abs(got - expected), `${name}.${answer}: B lands within the relative tolerance (expected ${expected}, got ${got}, tolerance ${tolerance})`)
          .toBeLessThanOrEqual(tolerance * Math.abs(expected));
      }
      expect(c['verdict'], `${name}: the case passes: ${show(c, 1500)}`).toBe('PASS');
    }
    expect(part['verdict'], `the behavior part passes: ${show(part['failures'] ?? [], 1500)}`).toBe('PASS');
    expect(sim['verdict'], `test.sim passes the kit: ${show(sim['failures'] ?? [], 2000)}`).toBe('PASS');

    // 3. The ledger records the pass, and admits every module of the build.
    expect(existsSync(ledger), `the kit wrote its ledger to ${ledger}`).toBe(true);
    const written = obj(JSON.parse(readFileSync(ledger, 'utf8')), 'the ledger');
    const rec = obj(written[MODULE], 'the ledger\'s record of test.sim');
    expect([rec['verdict'], rec['digest']], 'the ledger records test.sim PASS at its digest').toEqual(['PASS', digest]);
    expect(obj(rec['parts'], 'test.sim\'s parts')[behavior], 'the ledger records the behavior part PASS').toBe('PASS');
    const notPassed = Object.entries(written).filter(([, r]) => obj(r, 'a ledger record')['verdict'] !== 'PASS').map(([m]) => m);
    expect(notPassed, 'every module of the build passed the kit, so the release seal judges only B').toEqual([]);

    // 4. B seals: the release build embedding that ledger starts, with B as test.sim@1's implementation.
    const release = releaseBuild(B_WITH_BEHAVIOR, ledger, dir());
    expect(release.error, 'the release build compiles with DEEP_KIT_LEDGER set to the kit\'s ledger').toBe('');
    const [registry, published] = run(release.bin, scenario(evidence(), [REGISTRY, SCHEDULE]));
    expect(strs(registry!['modules'], 'registry.modules'), 'the release build sealed test.sim').toContain(MODULE);
    const sealed = bUnderBehavior(published!, 'the release build');
    expect(sealed.digest, 'the release build seals test.sim@1 at the digest the kit tested').toBe(digest);
  }, 3_600_000);
});
