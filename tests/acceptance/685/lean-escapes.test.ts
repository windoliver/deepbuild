// AC1: on the fixture Lean package, a proved theorem gives PASS through comparator; the same theorem proved with
// `sorry` gives INVALID naming the theorem and `sorryAx`; one closed by a new `axiom cheat` gives INVALID naming
// `cheat`; one closed by `native_decide` gives INVALID naming the axiom it adds; an axiom the check's
// `assumptions` lists passes. A runner that reads `lake build`'s exit status passes the `sorry` case and fails.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkout, cleanup, context, expectVerdictNaming, FIXTURES, judge, lakeBuildRunner, LEAN_TEST, LEAN_VERSION, leanSpec, leanStatement, once,
  plugin, requireLean, runProof,
} from './helpers.ts';

afterAll(cleanup);

const THEOREMS = ['total_append', 'total_example'];
const pass = once(() => runProof(leanSpec(THEOREMS), checkout('lean')));
const sorry = once(() => runProof(leanSpec(THEOREMS), checkout('lean', ['sorry'])));
const cheat = once(() => runProof(leanSpec(THEOREMS), checkout('lean', ['cheat'])));
const native = once(() => runProof(leanSpec(THEOREMS), checkout('lean', ['native'])));
/** The cheat variant again, with `cheat` declared: its statement approved beside the theorems', its name in `assumptions`. */
const assumed = once(() => runProof(leanSpec(THEOREMS, {
  assumptions: ['cheat'],
  statements: [leanStatement('cheat', join(FIXTURES, 'lean-variants', 'cheat')), ...THEOREMS.map((t) => leanStatement(t))],
}), checkout('lean', ['cheat'])));

describe('AC1 a proved Lean theorem passes through comparator, and every escape that makes any theorem check is INVALID, naming it', () => {
  it('AC1 the fixture\'s proved theorems give PASS: a passed run that checked both, judged PASS by the core, its receipt naming comparator and Lean 4.35.0', async () => {
    const r = await pass();
    expect(r.outcome, r.reasons.join(' | ')).toBe('passed');
    expect(r.testsRun, 'one count per theorem comparator checked').toBe(THEOREMS.length);
    expect(r.failures).toEqual([]);
    expect(r.receipt, 'the receipt line names the checker').toMatch(/comparator/);
    expect(r.receipt, 'and the toolchain\'s version').toContain(LEAN_VERSION);
    expect(judge(r).outcome).toBe('PASS');
  }, LEAN_TEST);

  it('AC1 the same theorem proved with `sorry` gives INVALID, naming total_append and sorryAx', async () => {
    expectVerdictNaming(await sorry(), 'INVALID', ['total_append', 'sorryAx'], 'sorry');
  }, LEAN_TEST);

  it('AC1 (wrong program) a runner that reads `lake build`\'s exit status passes the `sorry` case, since Lean builds a `sorry` with a warning, and fails the assertion above', async () => {
    await plugin();
    requireLean();
    expectVerdictNaming(await sorry(), 'INVALID', ['total_append', 'sorryAx'], 'the plug-in');
    const dir = checkout('lean', ['sorry']);
    const wrong = lakeBuildRunner(leanSpec(THEOREMS), context(dir, 0));
    expect(wrong.outcome, `lake build on the sorry variant: ${wrong.receipt}`).toBe('passed');
    expect(judge(wrong).outcome).toBe('PASS');
    expect(() => expectVerdictNaming(wrong, 'INVALID', ['total_append', 'sorryAx'], 'lake build\'s exit')).toThrow(/lake build's exit: the core's verdict/);
  }, LEAN_TEST);

  it('AC1 a proof closed by a new `axiom cheat` gives INVALID, naming cheat', async () => {
    expectVerdictNaming(await cheat(), 'INVALID', ['cheat'], 'axiom cheat');
  }, LEAN_TEST);

  it('AC1 a theorem closed by `native_decide` gives INVALID, naming the axiom it adds (total_example._native.native_decide.ax_1_1 on Lean 4.35.0)', async () => {
    expectVerdictNaming(await native(), 'INVALID', ['total_example._native.native_decide.ax_1_1'], 'native_decide');
  }, LEAN_TEST);

  it('AC1 the cheat variant passes once its axiom is a declared assumption of the check: comparator permits it beside propext, Quot.sound and Classical.choice', async () => {
    const r = await assumed();
    expect(r.outcome, r.reasons.join(' | ')).toBe('passed');
    expect(r.testsRun).toBe(THEOREMS.length);
    expect(judge(r).outcome).toBe('PASS');
    // The same commit, with no assumption declared, is the INVALID above: only the declaration differs.
    expect(judge(await cheat()).outcome).toBe('INVALID');
  }, LEAN_TEST);
});
