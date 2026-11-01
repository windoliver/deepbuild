// The claim halves of #30's criteria: each ends in a claim's verdict (INVALID, FAIL, INCONCLUSIVE or "counts"),
// which the gate (#29) makes from its checks' runs with the verdict engine (#28). Every run here is a real command
// run of the fixture through @deepbuild/checks-command, as in the file named beside each criterion; the claim is
// then judged through @deepbuild/gate's claimVerdict (README, The claim's surface). The words asserted are the
// criteria's: "ran nothing", "exit status masked by `|| true`", src/cart.test.ts:30, "settles the order", out.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAddedTests, runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { claimVerdict } from '../../../packages/gate/src/index.ts';
import type { NumericContract, Verdict } from '../../../packages/verdicts/src/index.ts';
import { claimOf, command, DAY, needPnpm, openWorld, outputOf, policiesCheck, project, REQ, VITEST, waitFor, type World } from './helpers.ts';
import { countsFromPrintedOutput, everySeededTableAStandIn, scrubsEveryPassedValue, silentReportAsComplete } from './wrong.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const reasons = (v: Verdict): string => v.reasons.join('\n');
const requirement = (v: Verdict) => {
  const q = v.requirements.find((r) => r.req === REQ);
  if (!q) throw Error(`the verdict has no outcome for ${REQ}: ${JSON.stringify(v.requirements)}`);
  return q;
};

describe('AC2 #30.5f9be4a0 a suite that runs zero tests is INVALID (the claim\'s half; the run\'s is in record.test.ts)', () => {
  it('AC2 a claim whose check\'s run ran zero tests is INVALID, naming the check and that it ran nothing, never PASS', async () => {
    const r = await runCommandCheck(command(world.sup, project('skipped'), VITEST));
    const v = claimVerdict(claimOf({ check: 'skipped-suite', command: VITEST, runs: [r] }));
    expect(v.outcome, `the claim on a run of ${r.testsRun} tests (${r.outcome}): ${reasons(v)}`).toBe('INVALID');
    expect(v.checks.find((c) => c.check === 'skipped-suite')?.outcome, 'the check itself is INVALID').toBe('INVALID');
    expect(v.reasons.some((why) => why.includes('skipped-suite') && /ran nothing/.test(why)), `a reason names the check and that it ran nothing: ${reasons(v)}`).toBe(true);
  }, 180_000);
});

describe('AC7 #30.b213a878 an overrun counts as a failed run; a run a hub restart cuts short is INCONCLUSIVE, never PASS or FAIL (the claim\'s half; the runs are in ending.test.ts)', () => {
  it('AC7 a check whose only run overran its deadline is FAIL in the claim\'s verdict, naming the overrun; a crash of its own is a failed run too', async () => {
    const overran = await runCommandCheck(command(world.sup, project('slow'), VITEST, { deadline: 25_000 }));
    expect(overran.outcome, outputOf(overran).slice(0, 800)).toBe('overran');
    const v = claimVerdict(claimOf({ check: 'slow-suite', command: VITEST, deadline: '25 s', runs: [overran] }));
    expect(v.outcome, `an overran run counts as a failed run: ${reasons(v)}`).toBe('FAIL');
    expect(v.checks.find((c) => c.check === 'slow-suite')?.outcome).toBe('FAIL');
    expect(reasons(v), 'the FAIL names the overrun').toMatch(/overran/);

    const crashed = await runCommandCheck(command(world.sup, project('crash'), VITEST));
    expect(crashed.outcome, outputOf(crashed).slice(0, 800)).toBe('failed');
    const c = claimVerdict(claimOf({ check: 'crash-suite', command: VITEST, runs: [crashed] }));
    expect(c.outcome, `a crash of what the check runs is a failed run: ${reasons(c)}`).toBe('FAIL');
  }, 180_000);

  it('AC7 a check run that a hub restart cuts short (its stop signalled as the hub goes down) is kept as stopped and makes the claim INCONCLUSIVE, never PASS or FAIL', async () => {
    const checkout = project('slow');
    const stop = new AbortController();
    const running = runCommandCheck(command(world.sup, checkout, VITEST, { deadline: 120_000, stop: stop.signal }));
    const marker = join(checkout, 'progress/second.done');
    await waitFor(() => (existsSync(marker) ? readFileSync(marker, 'utf8') : undefined), 60_000, 'the slow suite\'s second test (its progress marker in the checkout)');
    stop.abort();
    const stopped = await running;
    expect(stopped.outcome, outputOf(stopped).slice(0, 800)).toBe('stopped');
    const v = claimVerdict(claimOf({ check: 'slow-suite', command: VITEST, runs: [stopped] }));
    expect(v.outcome, `a stopped run makes its check INCONCLUSIVE: ${reasons(v)}`).toBe('INCONCLUSIVE');
    expect(v.checks.find((c) => c.check === 'slow-suite')?.outcome).toBe('INCONCLUSIVE');
    expect(reasons(v), 'the reason names the stopped run').toMatch(/stopped/);
  }, 180_000);
});

describe('AC8 #30.626ffab8 a stand-in can\'t pass a requirement about what real users get (the claim\'s half; the marking is in standin.test.ts)', () => {
  const claim = (r: CommandRun) => claimOf({ check: 'policies', command: VITEST, inputs: ['src/**', 'test/**', 'scripts/**'], runs: [r] }, { real_users: true });
  /** The criterion's assertion on the twin's claim: its check isn't a stand-in, so the requirement about real users passes. */
  function twinPasses(r: CommandRun, v: Verdict): void {
    expect(v.outcome, `the twin's claim passes; its run seeded ${JSON.stringify(r.seeded)}; reasons: ${reasons(v)}`).toBe('PASS');
    expect(requirement(v).outcome).toBe('PASS');
  }

  it('AC8 a requirement about what real users get, covered by the stand-in check, stays INCONCLUSIVE, naming policies and the script that seeds it', async () => {
    const r = await runCommandCheck(policiesCheck(world.sup, false));
    expect(r.seeded, 'the run marks the stand-in').toContainEqual({ name: 'policies', by: 'scripts/seed.ts', standIn: true });
    const v = claimVerdict(claim(r));
    expect(v.outcome, reasons(v)).toBe('INCONCLUSIVE');
    expect(requirement(v).outcome, 'the requirement about what real users get').toBe('INCONCLUSIVE');
    expect(reasons(v), 'the reason names the table').toMatch(/policies/);
    expect(reasons(v), 'and the file that seeds it').toMatch(/scripts\/seed\.ts/);
  }, 180_000);

  it('AC8 covered by its twin, where src/ inserts into policies, the same requirement can pass', async () => {
    const r = await runCommandCheck(policiesCheck(world.sup, true));
    twinPasses(r, claimVerdict(claim(r)));
  }, 180_000);

  it('AC8 (wrong program) a rule that marks every seeded table a stand-in leaves the twin\'s requirement INCONCLUSIVE and fails this test, naming policies', async () => {
    const r = await runCommandCheck(policiesCheck(world.sup, true));
    const wrong = everySeededTableAStandIn(r);
    // The verdict is made outside the expectation: a claim that can't be made (a run that never started) is BLOCKED, never a match.
    const v = claimVerdict(claim(wrong));
    expect(() => twinPasses(wrong, v)).toThrow(/policies/);
  }, 180_000);
});

describe('AC9 #30.506a2ee0 a failure in any of the six runs while another passes makes the claim INCONCLUSIVE; a test that fails every run is FAIL (the claim\'s half; the runs are in added.test.ts)', () => {
  const ADDED = 'test/trial.test.ts';
  const TEST = 'the trial is still open';
  const trial = (extra: Record<string, string> = {}) => project('trial', { 'test/trial.json': JSON.stringify({ ends: Date.now() + 14 * DAY }), ...extra });
  const claim = (runs: CommandRun[]) => claimOf({ check: 'trial-suite', command: VITEST, inputs: ['test/**'], runs });

  it(`AC9 the claim that adds the test failing only a month ahead is INCONCLUSIVE, naming "${TEST}", counting all six runs and keeping the failing run's output as evidence`, async () => {
    const runs = await runAddedTests(command(world.sup, trial(), VITEST, { inputs: ['test/**'] }), [ADDED]);
    expect(runs.map((r) => r.outcome), 'five passes and the month-ahead failure').toEqual(['passed', 'passed', 'passed', 'passed', 'passed', 'failed']);
    const month = runs[5]!;
    const v = claimVerdict(claim(runs));
    expect(v.outcome, reasons(v)).toBe('INCONCLUSIVE');
    expect(reasons(v), 'the reason names the test').toMatch(new RegExp(TEST));
    const q = requirement(v);
    expect(q.outcome).toBe('INCONCLUSIVE');
    expect([...q.runs.counted].sort(), 'every one of the six runs is counted').toEqual(runs.map((r) => r.run).sort());
    expect(q.evidence, 'the failing run\'s output is kept as the requirement\'s evidence').toContain(month.output.sha256.stdout);
  }, 600_000);

  it(`AC9 the claim whose added test fails every run is FAIL, naming "${TEST}"`, async () => {
    const always = `import { expect, test } from 'vitest';

test('${TEST}', () => {
  console.log(\`NOW \${Date.now()}\`);
  expect('closed').toBe('open');
});
`;
    const runs = await runAddedTests(command(world.sup, trial({ [ADDED]: always }), VITEST, { inputs: ['test/**'] }), [ADDED]);
    expect(runs.map((r) => r.outcome)).toEqual(Array<string>(6).fill('failed'));
    const v = claimVerdict(claim(runs));
    expect(v.outcome, reasons(v)).toBe('FAIL');
    expect(v.smallest ?? '', 'the smallest failing case names the test').toMatch(new RegExp(TEST));
    expect(requirement(v).outcome).toBe('FAIL');
  }, 600_000);
});

/** AC10: the claim's INVALID names the mask in the criterion's words, never PASS. */
function invalidNamingTheMask(v: Verdict, check: string): void {
  expect(v.outcome, `the claim on the masked check is INVALID, naming "exit status masked by \`|| true\`" (reasons: ${reasons(v)})`).toBe('INVALID');
  expect(v.checks.find((c) => c.check === check)?.outcome).toBe('INVALID');
  expect(reasons(v), 'the phrase').toMatch(/exit status masked by `\|\| true`/);
}
for (const tool of ['pnpm', 'npm'] as const) {
  const gate = tool === 'pnpm' ? needPnpm : () => undefined;
  describe(`AC10 #30.9c363cec \`${tool} test || true\` is INVALID naming "exit status masked by \`|| true\`", never PASS; the bare \`${tool} test\` is FAIL (the claim's half; the runs are in mask.test.ts)`, () => {
    const check = `${tool}-script`;
    it(`AC10 the claim on \`${tool} test || true\` over a suite with one failing test is INVALID, naming "exit status masked by \`|| true\`"`, async () => {
      gate();
      const masked = `${tool} test || true`;
      const r = await runCommandCheck(command(world.sup, project('npm-script'), masked));
      expect(r.outcome, 'a masked check never passes').not.toBe('passed');
      invalidNamingTheMask(claimVerdict(claimOf({ check, command: masked, runs: [r] })), check);
    }, 180_000);

    it(`AC10 the claim on the bare \`${tool} test\` is FAIL on the failing test`, async () => {
      gate();
      const bare = `${tool} test`;
      const r = await runCommandCheck(command(world.sup, project('npm-script'), bare));
      const v = claimVerdict(claimOf({ check, command: bare, runs: [r] }));
      expect(v.outcome, reasons(v)).toBe('FAIL');
      expect(v.smallest ?? '', 'the smallest failing case names the failing test').toMatch(/applies the discount/);
    }, 180_000);

    it(`AC10 (wrong program) a gate that judges only the exit code passes the claim on \`${tool} test || true\` and fails this test, naming the phrase`, async () => {
      gate();
      const masked = `${tool} test || true`;
      const r = await runCommandCheck(command(world.sup, project('npm-script'), masked, { plant: 'exit-code-only' }));
      if (r.exit?.code !== 0) throw Error(`BLOCKED: the planted runner didn't run the masked command to a clean exit (exit ${JSON.stringify(r.exit)}), so the wrong program wasn't shown`);
      const v = claimVerdict(claimOf({ check, command: masked, runs: [r] }), { plant: 'exit-code-only' });
      expect(v.outcome, 'the planted gate passes the masked check').toBe('PASS');
      expect(() => invalidNamingTheMask(v, check)).toThrow(/exit status masked/);
    }, 180_000);
  });
}

describe('AC14 #30.4df04268 the FAIL names src/cart.test.ts and line 30 (the claim\'s half; the stored output and the failure\'s place are in privacy.test.ts)', () => {
  const passed = { NODE_ENV: 'test', PORT: '3000' };
  const claim = (r: CommandRun) => claimOf({ check: 'cart-suite', command: VITEST, inputs: ['src/**'], runs: [r] });
  /** The criterion's assertion: the FAIL points to src/cart.test.ts:30. */
  function namesTheLine(v: Verdict): void {
    expect(v.outcome, reasons(v)).toBe('FAIL');
    const frames = v.points_to?.frames ?? [];
    expect(frames.includes('src/cart.test.ts:30'), `the FAIL points to src/cart.test.ts:30 (it points to ${frames.join(', ') || 'nothing'})`).toBe(true);
    expect(requirement(v).points_to ?? '', 'the requirement\'s outcome names the line too').toContain('src/cart.test.ts:30');
  }

  it('AC14 the claim\'s FAIL from the cart check, run with NODE_ENV=test and PORT=3000, names src/cart.test.ts:30 and the failing test', async () => {
    const r = await runCommandCheck(command(world.sup, project('cart'), VITEST, { env: passed, inputs: ['src/**'] }));
    const v = claimVerdict(claim(r));
    namesTheLine(v);
    expect(v.smallest ?? '', 'the smallest failing case names the test').toMatch(/totals the prices/);
  }, 180_000);

  it('AC14 (wrong program) a scrub of every passed value leaves the FAIL pointing to src/cart.[redacted].ts:30, and fails this test, naming the line', async () => {
    const r = await runCommandCheck(command(world.sup, project('cart'), VITEST, { env: passed, inputs: ['src/**'] }));
    const wrong = scrubsEveryPassedValue(r, passed);
    expect(wrong.failures.map((f) => f.file), 'the scrubbed record places its failures in src/cart.[redacted].ts').toContain('src/cart.[redacted].ts');
    const v = claimVerdict(claim(wrong));
    expect(() => namesTheLine(v)).toThrow(/src\/cart\.test\.ts:30/);
  }, 180_000);
});

describe('AC17 #30.a06dc35a a test that fails and then passes on its retry is a pass and a fail on that commit, so its check is INCONCLUSIVE naming the test (the claim\'s half; the attempts are in retries.test.ts)', () => {
  const TEST = 'settles the order';
  const claim = (r: CommandRun) => claimOf({ check: 'retry-suite', command: VITEST, runs: [r] });
  /**
   * The criterion's assertion on the claim: with the tool's report listing both attempts, the check is INCONCLUSIVE
   * naming the test; with the tool's retries turned off (retries.test.ts's other reading), the run failed on the
   * test and the claim is FAIL naming it. Either way the test is named and the claim never passes.
   */
  function namesTheTest(r: CommandRun, v: Verdict): void {
    expect(v.outcome, `the retried test is a pass and a fail on this commit (retries ${JSON.stringify(r.retries)}; reasons: ${reasons(v)})`).toBe(r.retries === null ? 'INCONCLUSIVE' : 'FAIL');
    expect(reasons(v), `the reason names "${TEST}"`).toMatch(new RegExp(TEST));
  }

  it(`AC17 the claim on the retry suite's check is INCONCLUSIVE, naming "${TEST}"`, async () => {
    const r = await runCommandCheck(command(world.sup, project('retry'), VITEST));
    namesTheTest(r, claimVerdict(claim(r)));
  }, 180_000);

  it(`AC17 (wrong program) a runner that reads only each test's last attempt passes the claim on the suite, and fails this test, naming "${TEST}"`, async () => {
    const r = await runCommandCheck(command(world.sup, project('retry'), VITEST, { plant: 'last-attempt-only' }));
    if (r.outcome !== 'passed') throw Error(`BLOCKED: the planted runner didn't pass the retried test (outcome ${r.outcome}), so the wrong program wasn't shown: ${outputOf(r).slice(0, 800)}`);
    const v = claimVerdict(claim(r));
    expect(v.outcome, `the planted runner's run passes the claim: ${reasons(v)}`).toBe('PASS');
    expect(() => namesTheTest(r, v)).toThrow(new RegExp(TEST));
  }, 180_000);
});

describe('AC19 #30.aebc2446 the sample check is INVALID naming the output and its twin counts (the claim\'s half; the counts are in contract.test.ts; the timing check\'s half is in timing.test.ts)', () => {
  const SIZE = 4_096_000;
  const CONTRACT: NumericContract = {
    reference: { precision: 'fp64' },
    accumulate: 'fp32',
    tolerances: [{ output: 'out', size: SIZE, atol: 1e-3, rtol: 1e-4, unit: '1' }],
    twin: { accumulate: 'fp16' },
    assert: 'matmul matches the reference',
  };
  type Mode = 'sample' | 'full' | 'silent';
  const contractRun = (mode: Mode): Promise<CommandRun> =>
    runCommandCheck(command(world.sup, project('contract'), VITEST, { env: { CONTRACT_MODE: mode }, contract: CONTRACT }));
  const claim = (r: CommandRun) => claimOf({ check: 'matmul', command: VITEST, contract: CONTRACT, runs: [r] }, { numbers: true });
  /** The criterion's assertion on one claim: INVALID naming out when the report's count is below the size or missing; counts when every element was compared. */
  function judged(v: Verdict, r: CommandRun, mode: Mode): void {
    const counts = r.contract?.find((c) => c.output === 'out');
    if (mode === 'full') {
      expect(v.outcome, `the twin, which compared all ${SIZE} (record: ${JSON.stringify(counts)}), counts: ${reasons(v)}`).toBe('PASS');
      expect(requirement(v).outcome, 'the requirement about computed numbers passes on it').toBe('PASS');
    } else {
      expect(v.outcome, `output out: the claim is INVALID (record: ${JSON.stringify(counts)}; reasons: ${reasons(v)})`).toBe('INVALID');
      expect(v.checks.find((c) => c.check === 'matmul')?.outcome).toBe('INVALID');
      expect(reasons(v), 'the INVALID names output out').toMatch(/output out/);
    }
  }

  it('AC19 the claim on the check that compared 40,960 of out\'s 4,096,000 elements is INVALID, naming out', async () => {
    const r = await contractRun('sample');
    judged(claimVerdict(claim(r)), r, 'sample');
  }, 180_000);

  it('AC19 the claim on its twin, which compared all 4,096,000, counts it', async () => {
    const r = await contractRun('full');
    judged(claimVerdict(claim(r)), r, 'full');
  }, 180_000);

  it('AC19 the claim on a check whose report gives no count for out is INVALID, naming out: missing is never complete', async () => {
    const r = await contractRun('silent');
    judged(claimVerdict(claim(r)), r, 'silent');
  }, 180_000);

  it('AC19 (wrong program) a runner that reads the counts from the test\'s printed output lets the sample claim count, and fails this test, naming out', async () => {
    const wrong = countsFromPrintedOutput(await contractRun('sample'));
    const v = claimVerdict(claim(wrong));
    expect(() => judged(v, wrong, 'sample')).toThrow(/output out/);
  }, 180_000);

  it('AC19 (wrong program) a runner that takes a silent report as complete lets that claim count, and fails this test, naming out', async () => {
    const wrong = silentReportAsComplete(await contractRun('silent'));
    const v = claimVerdict(claim(wrong));
    expect(() => judged(v, wrong, 'silent')).toThrow(/output out/);
  }, 180_000);
});
