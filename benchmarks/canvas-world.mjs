// #1868's budgets: a canvas.user cells call on a long record, and deep_status on 200,000 run events, each within 20%
// of its time on a short record, on a reference Mac. node benchmarks/canvas-world.mjs <test file> runs that criterion's
// blind acceptance test (tests/acceptance/1868/), which seeds both records, starts both hubs and judges the five runs
// by scripts/benchmark.mjs's judgeLimit, and prints its verdict as one JSON line, exiting 0 whatever the verdict so the
// budget window can time it. The task names the test file so a change the test can see reaches the task. `judge`
// reads that line on stdin and prints it as the window's target verdict. #265's budget (eight logic-moved movers with
// emitters, trails and wakes within the showpiece's 4 ms of frame CPU at p95) is a vitest file, run the same way, as is
// #269's (a 256 × 256 grid image drawn smooth at 512 × 512 px within the data view class's 2 ms of frame GPU at p95).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TESTS = {
  'tests/acceptance/1868/canvas-cells.test.mjs': '#1868.f34f3f9c',
  'tests/acceptance/1868/status-runs.test.mjs': '#1868.bf84aa8b',
  'tests/acceptance/265/ac6-budgets.test.ts': '#265.e3eb2a00',
  'tests/acceptance/269/ac6-budgets.test.ts': '#269.6ad7e180',
};
const CHECKOUT = fileURLToPath(new URL('..', import.meta.url));

/** The test's verdict: PASS only when its one test passed and none failed, else the state its failure opens with. */
function verdictOf(code, output) {
  if (code === 0 && /^ℹ pass 1$/m.test(output) && /^ℹ fail 0$/m.test(output)) return { status: 'PASS', reason: 'the test passed: all five runs within 1.20 times the reference record\'s time (empty for cells, 1,000 run events for deep_status) on a reference Mac' };
  if (code === 0 && /^\s*Tests\s+1 passed/m.test(output)) return { status: 'PASS', reason: 'the test passed: all five runs within its limit on a reference Mac' };
  const message = /AssertionError[^:]*: (.+)/.exec(output)?.[1] ?? /Error: (.+)/.exec(output)?.[1] ?? `the test exited ${code}`;
  // Never PASS here: the test did not pass. A failure with no state of its own (an assertion on the reply, say) is
  // the change failing the criterion.
  const status = /^(FAIL|INCONCLUSIVE|BLOCKED|INVALID)\b/.exec(message)?.[1];
  return { status: status ?? (/AssertionError/.test(output) ? 'FAIL' : 'BLOCKED'), reason: message.trim() };
}

function judge(current) {
  const { status, reason, criterion } = current ?? {};
  if (!['PASS', 'FAIL', 'INCONCLUSIVE', 'BLOCKED', 'INVALID'].includes(status) || typeof reason !== 'string') return { status: 'BLOCKED', targets: {}, reason: 'no verdict in the report' };
  return { status, targets: { [criterion]: { status, reason } }, reason: `${criterion}: ${reason}` };
}

const mode = process.argv[2];
if (mode === 'judge' && process.argv.length === 3) {
  try { console.log(JSON.stringify(judge(JSON.parse(readFileSync(0, 'utf8'))?.current))); }
  catch (error) { console.log(JSON.stringify({ status: 'BLOCKED', targets: {}, reason: `invalid judge input: ${error.message}` })); }
} else if (TESTS[mode] && process.argv.length === 3) {
  // Uncoloured, so the reporter's summary lines read as verdictOf matches them.
  const { FORCE_COLOR, ...env } = process.env;
  const [root, file] = [mode.slice(0, mode.lastIndexOf('/')), mode.slice(mode.lastIndexOf('/') + 1)];
  const args = mode.endsWith('.ts') ? ['node_modules/vitest/vitest.mjs', 'run', '--root', root, file, '--testTimeout=600000'] : ['--test', mode];
  const ran = spawnSync(process.execPath, args, { cwd: CHECKOUT, env: { ...env, NO_COLOR: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  console.log(JSON.stringify({ criterion: TESTS[mode], ...verdictOf(ran.status, `${ran.stdout}\n${ran.stderr}`) }));
} else {
  console.error(`use ${Object.keys(TESTS).join(' or ')}, or judge (JSON on stdin)`);
  process.exitCode = 2;
}
