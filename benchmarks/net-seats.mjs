// #277's budgets (#277.2c9337c4): catch-up of the eight-seat piece recorded as a reading in steps a second, and a match
// whose seats never change doing the merge base's work per step. node benchmarks/net-seats.mjs runs the criterion's
// blind acceptance test (tests/acceptance/277/ac4-budgets.test.ts), which plays both matches in one `deep-show run`
// each and reads them, and prints its verdict and the catch-up reading the test logs as one JSON line, exiting 0
// whatever the verdict so the budget window can time it against the merge base.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CRITERION = '#277.2c9337c4';
const TEST = 'ac4-budgets.test.ts';
const CHECKOUT = fileURLToPath(new URL('..', import.meta.url));

/** The test's verdict: PASS only when its one test passed, else the state its failure opens with. */
function verdictOf(code, output) {
  if (code === 0 && /Tests\s+1 passed/.test(output)) return { status: 'PASS', reason: 'the work per step equals the merge base\'s and the catch-up reading was recorded on a reference Mac' };
  const message = /\b(INCONCLUSIVE|BLOCKED|INVALID)\b[^\n]*/.exec(output)?.[0] ?? /AssertionError[^:]*: (.+)/.exec(output)?.[1] ?? `the test exited ${code}`;
  return { status: /^(INCONCLUSIVE|BLOCKED|INVALID)\b/.exec(message)?.[1] ?? 'FAIL', reason: message.trim() };
}

const { FORCE_COLOR, ...env } = process.env;
const ran = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/277', TEST, '--testTimeout=600000', '--hookTimeout=180000'], {
  cwd: CHECKOUT, env: { ...env, NO_COLOR: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const output = `${ran.stdout}\n${ran.stderr}`;
const reading = /catch-up of the eight-seat piece: [^\n]*/.exec(output)?.[0] ?? null;
console.log(JSON.stringify({ criterion: CRITERION, reading, ...verdictOf(ran.status, output) }));
