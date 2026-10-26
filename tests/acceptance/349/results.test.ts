// AC1: a check runner can't return a passed run without its results.
//
// Read as (README, Readings: results): a runner's run reaches the core through `host.runCheck`, and a result that
// says passed while it counted no test ran nothing it can vouch for. The core returns no passed run for it: the
// outcome is another of check.kind@1's, and the result names the check kind. A complete passed run, with its tests
// counted and the files it read, goes through unchanged. The runner is fixtures/runner, a first-party package in
// the hub whose runner answers with whatever the file it is pointed at holds.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';
import { COMMAND_SPEC, loadInHub, openWorld, pkg, tempDir } from './helpers.ts';

const KIND = 'ext.test-runner.result';
const complete: CheckResult = { outcome: 'passed', testsRun: 2, failures: [], evidence: [], read: ['spec/cart.test.mjs', 'src/cart.mjs'], mask: null };
const withoutResults: CheckResult = { outcome: 'passed', testsRun: 0, failures: [], evidence: [], read: [], mask: null };

describe('AC1 #349.68572cba a check runner can\'t return a passed run without its results', () => {
  it('AC1 a loaded runner that reports passed with no test counted gets no passed run from the core, which names the kind; the same runner\'s complete passed run goes through unchanged', async () => {
    const w = await openWorld();
    const file = join(tempDir('result'), 'result.json');
    writeFileSync(file, JSON.stringify(withoutResults));
    const host = await loadInHub(w, await pkg('runner', { files: { 'runner.json': JSON.stringify({ file }) } }));
    const ctx = { checkout: tempDir('checkout'), deadline: 30_000 };

    const refused = await host.runCheck(KIND, COMMAND_SPEC(KIND), ctx);
    expect(refused.outcome, `the core returned a passed run with no results: ${JSON.stringify(refused)}`).not.toBe('passed');
    expect(refused.testsRun, 'nothing was counted').toBe(0);
    expect(refused.failures.map((f) => f.message).join('\n'), 'the result names the check kind whose runner reported passed without its results').toContain(KIND);

    writeFileSync(file, JSON.stringify(complete));
    const passed = await host.runCheck(KIND, COMMAND_SPEC(KIND), ctx);
    expect(passed, 'a complete passed run goes through unchanged').toEqual(complete);
  }, 120_000);
});
