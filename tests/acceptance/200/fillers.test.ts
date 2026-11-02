// AC8 #200.a1b12018: "In a test build the core declares test.shape@1, which test modules a and b fill at the seal: a
// build without b seals, and a's interface digest is byte-identical with and without b, where a planted seal that
// hashes every entry of test.shape@1 into each filler's digest changes a's and fails this; and a test module c that
// declares test.part@1 is refused at the seal when b fills an entry in it, naming test.part@1, c and b, where a
// planted seal that takes b's entry into c's digest seals that build and fails this"
//
// asserts: in test builds the core declares test.shape@1 (owner core); test module test.fill.a fills its entry
// square, test.fill.b its entry circle. `core,test-fill-a` seals and lists square from test.fill.a;
// `core,test-fill-a,test-fill-b` lists square and circle, each from its own module; test.fill.a's digest is the same
// string in both (`digestFailures`). `--planted hashes_every_entry` on both builds fails `digestFailures`, naming
// test.fill.a. `core,test-fill-b-part,test-fill-c` (test.fill.c declares test.part@1; test.fill.b also fills an
// entry wheel in it) is refused (`foreign_entry`) naming test.part@1, test.fill.c and test.fill.b
// (`refusalFailures`); `--planted takes_foreign_entry` seals that build, so the same check fails, naming test.part@1.

import { describe, expect, it } from 'vitest';
import {
  FILL_A, FILL_B, FILL_C, PART, SHAPE, failsNaming, listing, none, refusalFailures, registry, run, scenario, sealFailures, startup, theEntry, theRegistry,
  useBuilds, useEvidence, type Build,
} from './helpers.ts';

const A: Build = { set: 'core', with: ['test-fill-a'] };
const AB: Build = { set: 'core', with: ['test-fill-a', 'test-fill-b'] };
const BC: Build = { set: 'core', with: ['test-fill-b-part', 'test-fill-c'] };
const builds = useBuilds([A, AB, BC]);
const evidence = useEvidence();

const digestOf = (bin: string, module: string, planted?: string): string => {
  const r = registry(run(bin, scenario(evidence(), [{ call: 'registry' }]), planted)[0]!);
  return r.digests[module] ?? `(no digest for ${module})`;
};
/** a's interface digest is byte-identical with and without b. The failure names a. */
function digestFailures(alone: string, withB: string, module: string): string[] {
  return alone === withB ? [] : [`${module}'s interface digest is ${alone} without ${FILL_B} and ${withB} with it`];
}
const foreign = { reasons: ['foreign_entry'], registry: PART, modules: [FILL_C, FILL_B] };

describe('AC8 #200.a1b12018 a registry more than one module fills is the core\'s, and an entry joins only its own module\'s digest', () => {
  it('AC8 the core declares test.shape@1 and a build without b seals; a\'s interface digest is byte-identical with and without b', () => {
    none(sealFailures(startup(builds.bin(A)), 'the build with a and without b'), 'the seal');
    const alone = theRegistry(listing(builds.bin(A), evidence()), SHAPE);
    expect(alone.owner, 'test.shape@1 is the core\'s').toBe('core');
    expect(theEntry(alone, 'square').module, 'a fills square').toBe(FILL_A);
    const both = theRegistry(listing(builds.bin(AB), evidence()), SHAPE);
    expect([theEntry(both, 'square').module, theEntry(both, 'circle').module], 'with b, a fills square and b fills circle').toEqual([FILL_A, FILL_B]);
    none(digestFailures(digestOf(builds.bin(A), FILL_A), digestOf(builds.bin(AB), FILL_A), FILL_A), 'a\'s digest');
  });

  it('AC8 a planted seal that hashes every entry of test.shape@1 into each filler\'s digest changes a\'s and fails this', () => {
    failsNaming(digestFailures(digestOf(builds.bin(A), FILL_A, 'hashes_every_entry'), digestOf(builds.bin(AB), FILL_A, 'hashes_every_entry'), FILL_A), [FILL_A], 'the seal that hashes every entry into each filler');
  });

  it('AC8 a test module c that declares test.part@1 is refused at the seal when b fills an entry in it, naming test.part@1, c and b', () => {
    none(refusalFailures(startup(builds.bin(BC)), foreign), 'b\'s entry in c\'s registry');
  });

  it('AC8 a planted seal that takes b\'s entry into c\'s digest seals that build and fails this', () => {
    const planted = startup(builds.bin(BC), 'takes_foreign_entry');
    expect(planted.status, `the planted seal seals the build: ${planted.stdout.slice(0, 600)}`).toBe(0);
    failsNaming(refusalFailures(planted, foreign), [PART], 'the seal that takes b\'s entry into c\'s digest');
  });
});
