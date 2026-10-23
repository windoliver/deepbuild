// AC4: on the fixture Rust crate, a verified Kani harness gives PASS with a receipt line that says bounded and
// names the bounds; a drafted harness whose assumption no input satisfies gives INVALID, naming the harness and its
// unsatisfied cover (a runner that reads only `VERIFICATION:- SUCCESSFUL` passes it and fails this test); an
// agent's `kani::assume(false)` in the target, and an agent's `#[kani::stub]` on a function it calls, each give
// INVALID naming the file and line.
// AC5: a harness whose loop needs more than its approved unwind bound gives INCONCLUSIVE, naming the loop and the
// bound, never PASS.
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkout, cleanup, context, expectVerdictNaming, judge, KANI_TEST, KANI_VERSION, kaniSpec, lineOf, naming, once, plugin, requireKani, runProof,
  successLineRunner,
} from './helpers.ts';

afterAll(cleanup);

const APPEND = 'proofs::total_append';
const NEVER = 'proofs::total_append_never';
const SHORT = 'proofs::total_append_short';
const pass = once(() => runProof(kaniSpec([APPEND]), checkout('kani')));
const never = once(() => runProof(kaniSpec([NEVER]), checkout('kani')));
const assumed = once(async () => { const dir = checkout('kani', ['assume']); return { dir, result: await runProof(kaniSpec([APPEND]), dir) }; });
const stubbed = once(async () => { const dir = checkout('kani', ['stub']); return { dir, result: await runProof(kaniSpec([APPEND]), dir) }; });
const short = once(() => runProof(kaniSpec([SHORT]), checkout('kani')));

/** `src/lib.rs:<n>` or `src/lib.rs line <n>`: the file and line, as a reason may write them. */
const place = (file: string, line: number): RegExp => new RegExp(`${file.replace(/[./]/g, '\\$&')}(:| line )${line}\\b`);

describe('AC4 a verified Kani harness passes, bounded; a harness no input reaches and an agent\'s assume or stub are INVALID, named', () => {
  it('AC4 the verified harness gives PASS: a passed run of one harness, judged PASS by the core', async () => {
    const r = await pass();
    expect(r.outcome, r.reasons.join(' | ')).toBe('passed');
    expect(r.testsRun, 'one count per harness Kani checked').toBe(1);
    expect(r.failures).toEqual([]);
    expect(judge(r).outcome).toBe('PASS');
  }, KANI_TEST);

  it('AC4 the PASS\'s receipt line says bounded and names the bounds: the unwind bound 5 and the assumption split <= 4, with Kani 0.68.0', async () => {
    const r = await pass();
    expect(r.receipt).toMatch(/\bbounded\b/i);
    expect(r.receipt, 'the harness\'s #[kani::unwind(5)]').toMatch(/unwind\D{0,3}5\b/);
    expect(r.receipt, 'the harness\'s kani::assume(split <= 4)').toContain('split <= 4');
    expect(r.receipt).toContain(KANI_VERSION);
  }, KANI_TEST);

  it('AC4 a drafted harness whose assumption no input satisfies gives INVALID, naming the harness and its unsatisfied cover', async () => {
    expectVerdictNaming(await never(), 'INVALID', ['total_append_never', /a split the assumption admits|src\/proofs\.rs:35\b/], 'unsatisfiable assumption');
  }, KANI_TEST);

  it('AC4 (wrong program) a runner that reads only `VERIFICATION:- SUCCESSFUL` passes that harness, since Kani reports it SUCCESSFUL, and fails the assertion above', async () => {
    await plugin();
    requireKani();
    expectVerdictNaming(await never(), 'INVALID', ['total_append_never', /a split the assumption admits|src\/proofs\.rs:35\b/], 'the plug-in');
    const wrong = successLineRunner(kaniSpec([NEVER]), context(checkout('kani'), 0));
    expect(wrong.outcome, wrong.receipt).toBe('passed');
    expect(() => expectVerdictNaming(wrong, 'INVALID', ['total_append_never', /a split the assumption admits|src\/proofs\.rs:35\b/], 'the success line'))
      .toThrow(/the success line: the core's verdict/);
  }, KANI_TEST);

  it('AC4 an agent\'s `kani::assume(false)` in the target gives INVALID, naming src/lib.rs and its line', async () => {
    const { dir, result } = await assumed();
    const line = lineOf(dir, 'src/lib.rs', 'kani::assume(false)');
    expectVerdictNaming(result, 'INVALID', [place('src/lib.rs', line)], 'assume in the target');
  }, KANI_TEST);

  it('AC4 an agent\'s `#[kani::stub]` on a function the target calls gives INVALID, naming src/lib.rs and its line, though Kani verifies the approved harness', async () => {
    const { dir, result } = await stubbed();
    const line = lineOf(dir, 'src/lib.rs', '#[kani::stub(');
    expectVerdictNaming(result, 'INVALID', [place('src/lib.rs', line)], 'stub outside the harness files');
  }, KANI_TEST);
});

describe('AC5 a loop that needs more than the approved unwind bound is INCONCLUSIVE, naming the loop and the bound, never PASS', () => {
  it('AC5 the harness with #[kani::unwind(3)] over eight readings gives INCONCLUSIVE, naming the loop in total (src/lib.rs:14) and the bound 3', async () => {
    const r = await short();
    const v = judge(r);
    expect(v.outcome, `the core's verdict (run ${r.outcome}; ${r.reasons.join(' | ')})`).toBe('INCONCLUSIVE');
    expect(naming(r, [/src\/lib\.rs:14\b|total\.unwind\.0/, /\b3\b/]), `a reason names the loop and the bound: ${r.reasons.join(' | ')}`).toBeDefined();
  }, KANI_TEST);

  it('AC5 never PASS: the run is not a pass, and the core\'s verdict on it is not PASS', async () => {
    const r = await short();
    expect(r.outcome).not.toBe('passed');
    expect(judge(r).outcome).not.toBe('PASS');
  }, KANI_TEST);
});
