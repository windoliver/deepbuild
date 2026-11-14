// AC1: `deep run --result` prints the worst verdict by the design's precedence line,
// FAIL > INVALID > BLOCKED > INCONCLUSIVE > PASS. A result that is both INVALID and BLOCKED prints INVALID.
// The built CLI is run on a result file; the codes are the ones the published schemas list.
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import { judge } from '../../../packages/conformance/src/index.ts';
import { CLI, CLI_SRC, deepRun, filesUnder, result } from './helpers.ts';

let dir = '';
beforeAll(() => {
  expect(existsSync(CLI), `precondition: ${CLI} is built (npm run build -w @deepbuild/conformance -w @deepbuild/cli)`).toBe(true);
  const built = statSync(CLI).mtimeMs;
  const newer = filesUnder(CLI_SRC).filter((file) => statSync(join(CLI_SRC, file)).mtimeMs > built);
  expect(newer, 'precondition: packages/cli/dist/main.js is as new as packages/cli/src; build the CLI again').toEqual([]);
  dir = mkdtempSync(join(tmpdir(), 'deep-1882-'));
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

let count = 0;
/** Writes the result, holds it to run.finished@1 and to the code table's reading of each code, and runs the CLI on it. */
function ran(outcome: [code: string, reads: string], findings: [code: string, reads: string][]) {
  const event = result(outcome[0], findings.map(([code]) => code));
  const held = validate('run.finished@1', event);
  expect(held.ok, `precondition: the result is a valid run.finished@1 event: ${JSON.stringify(held)}`).toBe(true);
  const run = judge('run', outcome[0]);
  expect([run.listed, run.verdict], `precondition: run.finished@1 lists the outcome ${outcome[0]} and the code table reads it ${outcome[1]}`).toEqual([true, outcome[1]]);
  for (const [code, reads] of findings) {
    const check = judge('check', code);
    expect([check.listed, check.verdict], `precondition: check.code@1 lists ${code} and the code table reads it ${reads}`).toEqual([true, reads]);
  }
  const file = join(dir, `result-${count += 1}.json`);
  writeFileSync(file, JSON.stringify(event));
  return deepRun(file);
}
/** The verdict the CLI printed: the first word of its output. */
const printed = (out: { stdout: string }): string => /^\S*/.exec(out.stdout)![0];

// The outcome `missing` is the only listed code a result can carry that reads BLOCKED (no check code does), so
// the BLOCKED judgement is the result's outcome and the INVALID one is a finding's check code.
const INVALID_CHECKS = ['exit_masked', 'no_tests_ran', 'crashed_before_first_assertion', 'type_error_as_assertion'];

describe('AC1 a result that judges one INVALID and one BLOCKED prints INVALID from deep run --result', () => {
  it.each(INVALID_CHECKS)('AC1 outcome missing (BLOCKED) with the finding %s (INVALID) prints INVALID, never BLOCKED, and exits 3', (code) => {
    const out = ran(['missing', 'BLOCKED'], [[code, 'INVALID']]);
    expect(printed(out), `AC1: a result that is both INVALID (${code}) and BLOCKED (missing) prints INVALID; deep run --result printed: ${out.stdout.trim()}${out.stderr.trim()}`).toBe('INVALID');
    expect(out.stdout, 'AC1: one verdict line').toMatch(/^INVALID [^\n]*\n$/);
    expect(out.status, 'the exit table: 3 for a result not decided').toBe(3);
  });

  it.each([
    { name: 'the INVALID finding before an INCONCLUSIVE one', findings: [['exit_masked', 'INVALID'], ['output_dropped', 'INCONCLUSIVE']] },
    { name: 'the INVALID finding after an INCONCLUSIVE one', findings: [['output_dropped', 'INCONCLUSIVE'], ['exit_masked', 'INVALID']] },
    { name: 'two INVALID findings', findings: [['no_tests_ran', 'INVALID'], ['exit_masked', 'INVALID']] },
  ] as { name: string; findings: [string, string][] }[])('AC1 outcome missing (BLOCKED) with $name prints INVALID and exits 3', ({ findings }) => {
    const out = ran(['missing', 'BLOCKED'], findings);
    expect(printed(out), `AC1: INVALID is above BLOCKED wherever its finding stands; deep run --result printed: ${out.stdout.trim()}${out.stderr.trim()}`).toBe('INVALID');
    expect(out.status, 'the exit table: 3 for a result not decided').toBe(3);
  });
});

describe('the rest of the precedence line holds through deep run --result', () => {
  it.each([
    { higher: 'FAIL', lower: 'INVALID', outcome: ['failed', 'FAIL'], findings: [['exit_masked', 'INVALID']], exit: 1 },
    { higher: 'FAIL', lower: 'INCONCLUSIVE', outcome: ['failed', 'FAIL'], findings: [['output_dropped', 'INCONCLUSIVE']], exit: 1 },
    { higher: 'INVALID', lower: 'INCONCLUSIVE', outcome: ['ran_nothing', 'INVALID'], findings: [['reported_after_deadline', 'INCONCLUSIVE']], exit: 3 },
    { higher: 'INVALID', lower: 'INCONCLUSIVE', outcome: ['overran', 'INCONCLUSIVE'], findings: [['no_tests_ran', 'INVALID']], exit: 3 },
    { higher: 'BLOCKED', lower: 'INCONCLUSIVE', outcome: ['missing', 'BLOCKED'], findings: [['output_dropped', 'INCONCLUSIVE']], exit: 3 },
    { higher: 'INCONCLUSIVE', lower: 'PASS', outcome: ['passed', 'PASS'], findings: [['output_dropped', 'INCONCLUSIVE']], exit: 3 },
    { higher: 'INVALID', lower: 'PASS', outcome: ['passed', 'PASS'], findings: [['exit_masked', 'INVALID']], exit: 3 },
  ] as { higher: string; lower: string; outcome: [string, string]; findings: [string, string][]; exit: number }[])(
    '$higher above $lower: outcome $outcome.0 with the finding $findings.0.0 prints $higher and exits $exit', ({ higher, outcome, findings, exit }) => {
      const out = ran(outcome, findings);
      expect(printed(out), `deep run --result printed: ${out.stdout.trim()}${out.stderr.trim()}`).toBe(higher);
      expect(out.status).toBe(exit);
    });
});
