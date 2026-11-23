// #3171 (and #3100's third criterion): a libtest test that panics saying why it proved nothing reads that state, with
// its reason; any other panic still reads FAIL.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cargoResults } from '../scripts/lanes.mjs';

const workspace = [{ targets: [{ key: 'deep_gpu src/lib.rs', rerun: '-p deep-gpu --lib' }] }];
const run = (name, message, thread = ` (2216290)`) => [
  '     Running unittests src/lib.rs (target/debug/deps/deep_gpu-0123456789abcdef)',
  `test ${name} ... FAILED`,
  'test spans::tests::spans_cover_their_union ... ok',
  '',
  'failures:',
  '',
  `---- ${name} stdout ----`,
  "trial 0: 153.5 ms covered, the passes' own 13.5",
  '',
  `thread '${name}'${thread} panicked at crates/deep-gpu/src/spans.rs:540:13:`,
  message,
  'note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace',
  '',
  'failures:',
  `    ${name}`,
  '',
  'test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 1.21s',
  '',
  'error: test failed, to rerun pass `-p deep-gpu --lib`',
].join('\n');

test('a libtest panic starting INCONCLUSIVE:, BLOCKED: or INVALID: reads that state, with its reason', () => {
  const name = 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it';
  for (const state of ['INCONCLUSIVE', 'BLOCKED', 'INVALID']) {
    const reason = `${state}: the GPU was shared, so the gap can't be told apart`;
    // Rust 1.99 names the thread's id after its name; older ones didn't.
    for (const thread of [' (2216290)', '']) {
      const { failures, passed } = cargoResults(run(name, reason, thread), 101, workspace);
      assert.deepEqual(failures, [{ id: `cargo -p deep-gpu --lib › ${name}`, state, message: reason }]);
      assert.deepEqual(passed, ['cargo -p deep-gpu --lib › spans::tests::spans_cover_their_union']);
    }
  }
});

test('any other libtest panic still reads FAIL: the word later in its message, or with no colon after it', () => {
  const name = 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it';
  for (const message of ["trial 0: 153.5 ms covered, the passes' own 13.5: the gap counted", 'assertion failed: INCONCLUSIVE: no', 'BLOCKED by the output it compared', 'INVALID plain words', 'Error: BLOCKED: a wrapped error']) {
    const { failures } = cargoResults(run(name, message), 101, workspace);
    assert.deepEqual(failures.map(({ id, state }) => [id, state]), [[`cargo -p deep-gpu --lib › ${name}`, 'FAIL']]);
  }
});
