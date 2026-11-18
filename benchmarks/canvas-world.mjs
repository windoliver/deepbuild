// #1868's budgets: a canvas.user cells call on a long record, and deep_status on 200,000 run events, each within 20%
// of its time on a short record, on a reference Mac. node benchmarks/canvas-world.mjs cells|status runs that criterion's
// blind acceptance test (tests/acceptance/1868/), which seeds both records, starts both hubs and judges the five runs
// by scripts/benchmark.mjs's judgeLimit, and prints its verdict as one JSON line, exiting 0 whatever the verdict so the
// budget window can time it. `judge` reads that line on stdin and prints it as the window's target verdict.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TESTS = {
  cells: { file: 'tests/acceptance/1868/canvas-cells.test.mjs', criterion: '#1868.f34f3f9c' },
  status: { file: 'tests/acceptance/1868/status-runs.test.mjs', criterion: '#1868.bf84aa8b' },
};
const CHECKOUT = fileURLToPath(new URL('..', import.meta.url));

/** The test's verdict: PASS when it passed, else the state its failure message opens with; BLOCKED when it opens with none. */
function verdictOf(code, output) {
  if (code === 0) return { status: 'PASS', reason: 'the test passed: all five runs within 1.20 times the short record\'s time on a reference Mac' };
  const message = /AssertionError[^:]*: (.+)/.exec(output)?.[1] ?? /Error: (.+)/.exec(output)?.[1] ?? `the test exited ${code}`;
  const status = /^(PASS|FAIL|INCONCLUSIVE|BLOCKED|INVALID)\b/.exec(message)?.[1];
  // A failure with no state of its own (an assertion on the reply, say) is the change failing the criterion.
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
  const { file, criterion } = TESTS[mode];
  const ran = spawnSync(process.execPath, ['--test', file], { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  console.log(JSON.stringify({ criterion, ...verdictOf(ran.status, `${ran.stdout}\n${ran.stderr}`) }));
} else {
  console.error('use cells, status, or judge (JSON on stdin)');
  process.exitCode = 2;
}
