import { describe, expect, it } from 'vitest';
import {
  DOC, bItem, board, check, moduleMissing, operators, requires, run, scenario, sealed, show,
  sorted, startOutcome, startupRefusal, theSnapshot, useBuilds, useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const CORE_B: Build = { set: 'core', with: ['test-b'] };
const CORE_AB: Build = { set: 'core', with: ['test-a', 'test-b'] };
const CORE_B_REQUIRES_A: Build = { set: 'core', with: ['test-b-requires-a'] };
const builds = useBuilds([CORE_B, CORE_AB, CORE_B_REQUIRES_A]);
const evidence = useEvidence();

const B_BOX = [40, 40, 120, 80];
/** The same item with `echo` set: the feature `test.b.echo`, which reads `test.a.value`, evaluates. */
const B_ECHO = board('Module b, echoing a', [bItem('b-1', B_BOX, 'a0', 3)], requires({ 'test.b': '^1' }));

// Alpha's deep_show calls go on DOC.a in one layer (the plain and echo boards' first draft is replaced
// by optional-redraft.test.ts, #388). `deep show --check`
// is another writer (your shell), so its revisions go on DOC.b.
const CHECK = (document: JsonObject): JsonObject => check(document, { doc: DOC.b });

describe('#305.a15bd49b a test canvas module b marking a optional seals without a, its operator that reads a left out; a document using that feature is refused with module_missing naming a and its checks are BLOCKED, one that doesn\'t draws; b marking a required is refused at startup naming a and b; a planted seal that treats every dependency as required refuses the first build', () => {
  it('#305.a15bd49b core,test-b seals without test.a, with test.b.echo left out of the plan, while core,test-a,test-b holds both modules, the operator and a\'s array under another digest', () => {
    const without = sealed(builds.bin(CORE_B), evidence());
    expect(without.build_set, 'the build set is core').toBe('core');
    expect(without.modules, 'the sealed set holds test.b').toContain('test.b');
    expect(without.modules, 'and not test.a').not.toContain('test.a');
    expect(operators(without), 'the operator that reads test.a.value, test.b.echo, is left out of the plan').not.toContain('test.b.echo');
    expect(Object.keys(without.arrays), 'no array test.a.value is registered').not.toContain('test.a.value');
    expect(Object.values(without.arrays).map((a) => a['owner']), 'no array is owned by test.a').not.toContain('test.a');

    const both = sealed(builds.bin(CORE_AB), evidence());
    expect(both.modules.filter((m) => m === 'test.a' || m === 'test.b'), 'core,test-a,test-b holds test.a and test.b').toEqual(['test.a', 'test.b']);
    expect(both.plan['items'] ?? [], 'with test.b.echo in the items phase of the plan').toContain('test.b.echo');
    expect(both.arrays['test.a.value']?.['owner'], 'and the array test.a.value owned by test.a').toBe('test.a');
    expect(both.core, 'the core is the same').toBe(without.core);
    expect(both.set_digest, 'the module-set digest is another one with test.a in the build').not.toBe(without.set_digest);
  }, 120_000);

  it('#305.a15bd49b in core,test-a,test-b the same document with echo set is presented, with a snapshot', () => {
    const { replies } = run(builds.bin(CORE_AB), scenario(evidence(), [show(B_ECHO, { pixels: true }), CHECK(B_ECHO)]));
    theSnapshot(replies[0]!, 'the echo board in the build that holds test.a');
    expect(moduleMissing(replies[0]!, 'test.a'), 'nothing is missing').toEqual([]);
    expect(replies[1]!['result'], 'and its check passes').toBe('PASS');
  }, 120_000);

  it('#305.a15bd49b the same b marking a required is refused at startup in the build without a, naming test.a and test.b', () => {
    const refusal = startupRefusal(builds.bin(CORE_B_REQUIRES_A));
    expect(refusal.reason, 'the seal refuses for a missing dependency').toBe('missing_dependency');
    expect(sorted(refusal.modules), 'naming test.a and test.b').toEqual(['test.a', 'test.b']);
    expect(refusal.arrays, 'and no array').toEqual([]);
  }, 120_000);

  it('#305.a15bd49b a planted seal that treats every dependency as required refuses core,test-b at startup, naming test.a and test.b, which fails the first test\'s "seals without a"', () => {
    const bin = builds.bin(CORE_B);
    expect(startOutcome(bin).started, 'core,test-b starts with the real seal').toBe(true);
    const planted = startOutcome(bin, 'treats_every_dependency_required');
    expect(planted.started, 'the planted seal that treats the optional dependency as required refuses the build that must seal: the first test fails on it').toBe(false);
    const refusal = startupRefusal(bin, 'treats_every_dependency_required');
    expect(refusal.reason, 'its refusal reads the optional dependency as a missing required one').toBe('missing_dependency');
    expect(sorted(refusal.modules), 'naming test.a and test.b').toEqual(['test.a', 'test.b']);
  }, 120_000);
});
