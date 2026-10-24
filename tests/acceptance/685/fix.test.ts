// AC6: for a fix on the Kani fixture, the merge base, whose target breaks the harness's assertion, fails there with a
// counterexample, which replays as a Rust test, and that proves the fix. A planted fix whose harness calls a function
// only the fix adds fails on the base before its obligation and makes the check INVALID, naming "failed on the base
// before its obligation".
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ProofBase, ProofResult } from '../../../packages/proof/src/index.ts';
import {
  checkout, cleanup, context, FIXTURES, judge, KANI_DEADLINE, KANI_TEST, kaniSpec, once, plugin, replay, requireKani, runProof,
} from './helpers.ts';

afterAll(cleanup);

const APPEND = 'proofs::total_append';
const WIDE = 'proofs::total_wide_append';
const fixSpec = kaniSpec([APPEND]);
/** The planted fix's approved harness is the one its own proof file holds. */
const plantedSpec = kaniSpec([WIDE], {}, join(FIXTURES, 'kani-variants', 'planted-fix'));

async function runBase(spec: typeof fixSpec, dir: string): Promise<ProofBase> {
  const p = await plugin();
  requireKani();
  return await p.runBase(spec, context(dir, KANI_DEADLINE));
}
// The fix: the claim's commit is the fixture; its merge base sums in a u32 (kani-variants/base). The base checkout
// holds the merge base's code and the claim's proof files, as the core builds it.
const head = once(() => runProof(fixSpec, checkout('kani')));
const base = once(() => runBase(fixSpec, checkout('kani', ['base'])));
// The planted fix adds total_wide and a harness that calls it; on the base, that harness can't even build.
const plantedHead = once(() => runProof(plantedSpec, checkout('kani', ['planted-fix'])));
const plantedBase = once(() => runBase(plantedSpec, checkout('kani', ['planted-fix', 'base'])));

/** The fix's requirement is new behavior, so its check must fail on the base at the obligation its harness states. */
const fix = { requirement: { on_base: 'fails' as const } };
/** The criterion's INVALID for a base run that never reached the obligation, held for the plug-in and a wrong reading alike. */
function expectNotProven(headRun: ProofResult, b: ProofBase, label: string): void {
  expect(judge(headRun, { ...fix, base: b.base }).outcome, `${label}: the core's verdict with that base run (${b.reason})`).toBe('INVALID');
  expect(b.reason, `${label}: the base run names why`).toMatch(/failed on the base before its obligation/);
}

describe('AC6 a fix is proved only when the merge base fails at the harness\'s own assertion, with a counterexample that replays', () => {
  it('AC6 the merge base fails at the harness\'s assertion: a failed base run, on its assertion, naming the harness', async () => {
    const b = await base();
    expect(b.base.outcome, b.reason).toBe('failed');
    expect(b.base.on_assertion, `failed at the harness's own assertion: ${b.reason}`).toBe(true);
    expect(b.base.failed_tests).toContain(APPEND);
    expect(b.reason).not.toMatch(/before its obligation/);
  }, KANI_TEST);

  it('AC6 its counterexample is Kani\'s concrete-playback test for the failed assertion, the smallest failing case', async () => {
    const b = await base();
    expect(b.smallest, 'a counterexample').not.toBeNull();
    expect(b.smallest!).toMatch(/#\[test\]/);
    expect(b.smallest!).toMatch(/kani::concrete_playback_run\(\s*concrete_vals,\s*total_append\s*\)/);
    // That it is the assertion's counterexample, not the cover's (Kani prints one for each), the replay below shows.
  }, KANI_TEST);

  it('AC6 the counterexample replays as a Rust test: it fails on the merge base at the harness\'s assertion and passes on the fix', async () => {
    const b = await base();
    const onBase = replay(checkout('kani', ['base']), b.smallest!);
    expect(onBase.status, `the replay of ${onBase.name} on the base: ${onBase.output.slice(-2000)}`).not.toBe(0);
    expect(onBase.output).toMatch(/panicked at src\/proofs\.rs:14/);
    const onFix = replay(checkout('kani'), b.smallest!);
    expect(onFix.status, `the replay of ${onFix.name} on the fix: ${onFix.output.slice(-2000)}`).toBe(0);
  }, KANI_TEST);

  it('AC6 that proves the fix: the head run passes, and with that base run the core\'s verdict is PASS', async () => {
    const h = await head();
    expect(h.outcome, h.reasons.join(' | ')).toBe('passed');
    expect(judge(h, { ...fix, base: (await base()).base }).outcome).toBe('PASS');
  }, KANI_TEST);

  it('AC6 a planted fix whose harness calls a function only the fix adds passes on its own commit and fails on the base before its obligation: INVALID, naming it', async () => {
    const h = await plantedHead();
    expect(h.outcome, h.reasons.join(' | ')).toBe('passed');
    const b = await plantedBase();
    expect(b.base.outcome).toBe('failed');
    expect(b.base.on_assertion, 'the base never reached the harness\'s assertion').toBe(false);
    expectNotProven(h, b, 'planted fix');
  }, KANI_TEST);

  it('AC6 (wrong program) a base reading that takes any failure on the base as the fix\'s proof passes the planted fix and fails the assertion above', async () => {
    const h = await plantedHead();
    const b = await plantedBase();
    expectNotProven(h, b, 'the plug-in');
    const wrong: ProofBase = { ...b, base: { ...b.base, on_assertion: b.base.outcome === 'failed', failed_tests: [WIDE] }, reason: `${WIDE} failed on the base` };
    expect(judge(h, { ...fix, base: wrong.base }).outcome).toBe('PASS');
    expect(() => expectNotProven(h, wrong, 'any failure')).toThrow(/any failure: the core's verdict/);
  }, KANI_TEST);
});
