// One verdict workload per run, for the perf lane's budgets (issue #28): node benchmarks/verdicts.mjs <task>.
import { createHash } from 'node:crypto';
import { verdict } from '../packages/verdicts/dist/index.js';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const commitOf = (name) => sha256(`commit ${name}`).slice(0, 40);
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const DAY = 86_400_000;
const ENV = { os: 'darwin-arm64', locale: 'en-US', tz: 'UTC' };
const TOOLS = { node: '24.22.0', vitest: '5.0.5' };
const DEF = 'req:01K74G0A1B2C3D4E5F6G7H8J9K';
const reqId = (n) => `${DEF}#R${n}`;
const CLAIM = 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H';

const check = (id, covers, inputs) => ({
  check: id, digest: `d1:${sha256(`check ${id}`)}`, source: 'definition', depth: 'unit', proof: 'test_run', covers, inputs,
  environment: { ...ENV }, tools: { ...TOOLS }, accept: '10%',
});
let n = 0;
const run = (c, commit, outcome) => {
  n++;
  const test = `t${c.check.slice(5)}.test.ts › holds`;
  const failures = outcome === 'failed' ? [{
    test, message: `expected 1800 to be 1801 in ${test}`, cause: 'change:c1',
    frames: [{ file: 'src/total.ts', line: 42 }], covers: ['src/total.ts'], case: `${test} with total 18.00`,
  }] : [];
  return {
    run: `run:R${n}${c.check}`, check: c.check, claim: CLAIM, commit, digest: c.digest, environment: { ...ENV }, tools: { ...TOOLS },
    outcome, ended: T0 + n, tests_run: 12, reads: ['src/a.ts'], failures,
    evidence: [{ slot: 'report', state: 'captured', sha256: sha256(`report ${n}`) }], kept: true,
  };
};

/** The claim that AC22 times: 20 checks and 1,000 runs among them, carried runs and two flaky checks. */
function bigClaim() {
  const D = commitOf('D'), C = commitOf('budget-C');
  const checks = [], runs = [];
  for (let i = 0; i < 20; i++) {
    const c = check(`check${i}`, [reqId(1 + (i % 5))], [i % 2 ? 'src/**' : 'docs/**']);
    checks.push(c);
    for (let k = 0; k < 50; k++) {
      const outcome = (i === 3 && k === 7) || (i === 5 && k < 3) ? 'failed' : 'passed';
      runs.push(run(c, k % 3 ? D : C, outcome));
    }
  }
  return {
    claim: CLAIM, agent: 'session:01K74FQ8S1T2V3W4X5Y6Z7A8B9', repo: 'shop', task: 'task:01K74FX2B4D6F8H0K2M4P6R8T0', commit: D,
    requirements: [1, 2, 3, 4, 5].map((k) => ({ req: reqId(k), depth: 'unit', oracle: 'code', on_base: 'passes' })),
    checks, runs, changes: [{ from: C, paths: ['docs/guide.md'] }], waivers: [], now: T0 + 10 * DAY,
  };
}

const workloads = {
  // 200 verdicts of the 1,000-run claim, each from a fresh selection, as the issue's 10 ms budget counts one.
  'verdict-1000-runs'() {
    const c = bigClaim();
    if (c.runs.length !== 1000) throw Error(`expected 1,000 runs, built ${c.runs.length}`);
    // Two checks each failed one real run and passed others, so the claim is INCONCLUSIVE, never PASS or FAIL.
    const outcomes = new Set();
    for (let i = 0; i < 200; i++) outcomes.add(verdict(c).outcome);
    if (outcomes.size !== 1 || !outcomes.has('INCONCLUSIVE')) throw Error(`expected INCONCLUSIVE 200 times, got ${[...outcomes].join(', ')}`);
  },
};

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
workloads[task]();
