// AC2 (#3170.4db366cf): with that folder, `cargo test -p deep-hook --test cli --locked` on the Spark passes, the
// copy-on-write half included. The command is the issue's, run by the real runLanes as the unit lane runs a command,
// so it gets whatever the lane and the machine's cargo give a lane's cargo test.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, CLI_TARGET, COW_TEST, elsewhere, MINUTES, PLATFORM, runLane, sandbox, SPARK, tail } from './helpers.mjs';

test('#3170.4db366cf cargo test -p deep-hook --test cli --locked passes on the Spark, the copy-on-write test with it', MINUTES, async (t) => {
  if (PLATFORM !== SPARK) return t.skip(elsewhere('the Spark, Linux on aarch64'));
  const box = sandbox(t);
  const ran = await runLane(box, CHECKOUT, CLI_TARGET);
  const lines = ran.output.split('\n');
  const at = lines.findIndex((line) => line.startsWith('failures:'));
  const why = at >= 0 ? lines.slice(at, at + 40).join('\n') : tail(ran.output);
  assert.equal(lines.find((line) => line.startsWith(`test ${COW_TEST} ... `)), `test ${COW_TEST} ... ok`, `${CLI_TARGET.join(' ')} on ${PLATFORM} runs ${COW_TEST} to a pass:\n${why}`);
  assert.deepEqual(lines.filter((line) => /^test .+ \.\.\. (?!ok$|ignored)/.test(line)), [], `no test of the cli target fails or is unproven:\n${why}`);
  assert.doesNotMatch(ran.output, /^BLOCKED: /m, `nothing in the cli target reads BLOCKED:\n${why}`);
  assert.match(ran.output, /^test result: ok\. [1-9]\d* passed; 0 failed/m, `the cli target's run passes:\n${why}`);
});
