// #2256 AC1, the blind redraft for #2047's sweep: benchmarks/canvas.mjs parses, and its judge prints a judged line.
// Both tests run this checkout's own bench by the commands the criterion writes, from the checkout's root:
// `node --check benchmarks/canvas.mjs`, and `node benchmarks/canvas.mjs judge` with the issue's report on stdin.
// Nothing imports the bench, and nothing is written (README: The surface).
// Run: node --test tests/acceptance/2256-redraft-2047/ac1-canvas.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const BENCH = 'benchmarks/canvas.mjs';
// The report the criterion pipes in, as its `echo` writes it: the line, then a newline.
const REPORT = '{"current":{"task":"canvas-look-frames","fingerprint":{"build":{"profile":"release"}},"runs":[]},"base":null}\n';
// The five verdicts (design: How runs become one of five verdicts).
const VERDICTS = ['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'];
// Each command is bounded at two minutes; one that can't start, overruns or is killed by a signal fails INCONCLUSIVE,
// never at an assertion.
const BOUND_MS = 120_000;

/** `node <args>` from the checkout's root, by the Node that runs this suite, with none of the test runner's variables. */
function node(args, input) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, args, { cwd: CHECKOUT, env, input, encoding: 'utf8', timeout: BOUND_MS, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw new Error(`INCONCLUSIVE: node ${args.join(' ')} didn't run to its end (bounded at ${BOUND_MS / 1000} s): ${run.error.message}`);
  if (run.signal) throw new Error(`INCONCLUSIVE: node ${args.join(' ')} was killed by ${run.signal}`);
  return run;
}

/**
 * What a message quotes of an output: its last 3,000 characters, the checkout's path as <checkout>, and no line that
 * reads as a stack frame, since the proof lane places a failure by the first frame in its stack, message included.
 */
const quoted = (text) => text.replaceAll(pathToFileURL(CHECKOUT).href, '<checkout>').replaceAll(CHECKOUT, '<checkout>')
  .split('\n').filter((line) => !/^\s*at /.test(line)).join('\n').trim().slice(-3000) || '(nothing)';

test('AC1 #2256.6bb42fca node --check benchmarks/canvas.mjs exits 0', () => {
  const run = node(['--check', BENCH]);
  assert.equal(run.status, 0, `node --check ${BENCH} exits ${run.status}, not 0. Its stderr:\n${quoted(run.stderr)}`);
});

test("AC1 #2256.6bb42fca the issue's canvas-look-frames report piped to node benchmarks/canvas.mjs judge prints a judged line instead of a SyntaxError", () => {
  const run = node([BENCH, 'judge'], REPORT);
  const last = run.stdout.split('\n').filter((line) => line.trim() !== '').at(-1);
  let line;
  try {
    line = JSON.parse(last);
  } catch {
    line = undefined;
  }
  const verdict = line !== null && typeof line === 'object' && !Array.isArray(line) ? line.status : undefined;
  assert.ok(run.status === 0 && VERDICTS.includes(verdict),
    `node ${BENCH} judge printed no judged line (an exit of 0, its last stdout line a JSON object whose status is one of `
    + `${VERDICTS.join(', ')}): it exited ${run.status}, its last stdout line ${last === undefined ? '(none)' : quoted(last)}. `
    + `Its stderr:\n${quoted(run.stderr)}`);
});
