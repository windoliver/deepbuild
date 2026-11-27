// Blind redraft under #3549 of tests/acceptance/3588/granted.test.mjs (REDRAFT.md): the original line for line; only its
// helpers' runScene counts the holders of every build slot by the LIMITS-read build limit.
// #3588, criterion 2: the same scene, the untimed file passing, and the holders letting go 20 s after the run's timed
// phase began waiting: the rebuild is granted, the timed file runs and reads PASS, and the run exits 0. Regression
// protection: it holds on the merge base too. The wrong program is the planted twin `skips-the-rebuild`, an affected.mjs
// whose timed phase builds nothing again before the timed job (twins/README.md).
import assert from 'node:assert/strict';
import test from 'node:test';
import { BINARY, BOUND_MIN, dump, EXIT_MS, LET_GO_MS, letGo, passedCount, pause, PRINTS, record, runScene, sandbox, scene, SCENE, summary, throttleLog, TIMED, UNTIMED, until, waiting } from './helpers.mjs';

const C2 = '#3588.704a8c75';
const STATE = /^(?:PASS|FAIL|NEW FAIL|KNOWN|BLOCKED|INCONCLUSIVE|INVALID|NO NEW FAILURES)\b/;

test(`${C2} with every build slot held from before the timed phase, and the holders letting go 20 s after the timed phase began waiting, the rebuild is granted, the timed file runs and reads PASS, and the run exits 0`, SCENE, async (t) => {
  const box = sandbox(t);
  const fx = scene(box, { fails: false });
  const played = await runScene(box, fx);
  let exited = false;
  played.done.then(() => { exited = true; });
  // The timed phase began waiting: a request of the run's own for a build or a timed grant is in the table.
  let began = null;
  if (played.held) {
    // deadline: the run's own limit bounds a run that never asks.
    await until(() => { if (waiting(box, played.holders).length) began = Date.now(); return began !== null || exited; }, EXIT_MS);
    // deadline: the criterion's own 20 s, the scene's schedule: the holders let go 20 s after the wait began.
    if (began !== null) await pause(LET_GO_MS);
  }
  const asked = began !== null ? waiting(box, played.holders) : [];
  letGo(played.holders);
  const run = await played.done;
  const all = () => `${dump(box, fx, played, run)}\nthe run's requests when the holders let go: ${JSON.stringify(asked)}`;

  assert.ok(played.gaveBack, `the run never gave back its own build grant, so no holder took the build slots after it\n${all()}`);
  assert.ok(played.held, `the holders didn't take every build slot of the table before the run's timed phase\n${all()}`);
  assert.ok(record(fx).find((entry) => entry.event === 'deleted')?.gone, `the untimed file didn't remove ${BINARY} from DEEP_BIN_DIR, so nothing needed building again\n${all()}`);
  assert.ok(began !== null, `the run's timed phase never waited in the table for a build or a timed grant behind the holders\n${all()}`);

  // The rebuild is granted: a build grant of the run's, given once the holders let go.
  const log = throttleLog(box);
  const gone = log.findIndex((entry) => entry.event === 'released' && entry.class === 'build' && played.holders.includes(entry.pid));
  assert.ok(gone >= 0, `the holders never gave their build grants back\n${all()}`);
  assert.ok(log.slice(gone).some((entry) => entry.event === 'granted' && entry.class === 'build' && !played.holders.includes(entry.pid)), `no build grant was granted to the run once the holders let go: nothing was built again of what the cleanup removed\n${all()}`);

  // The timed file runs, finding the binary built again, and reads PASS.
  const ran = record(fx).find((entry) => entry.event === 'timed-ran');
  assert.ok(ran, `the timed file's test never ran\n${all()}`);
  assert.ok(ran.there && ran.stdout === PRINTS, `the timed file found no working ${BINARY} in DEEP_BIN_DIR: the rebuild didn't put back what the cleanup removed\n${all()}`);
  assert.ok(!run.limited, `affected.mjs was still running ${(run.limit / 1000).toFixed(0)} s after its start, at a bound of ${BOUND_MIN} min\n${all()}`);
  const named = run.stdout.split('\n').filter((line) => STATE.test(line) && (line.includes(TIMED) || line.includes(UNTIMED)));
  assert.deepEqual(named, [], `a line reads the timed or the untimed file other than as passed\n${all()}`);
  assert.match(summary(run.stdout), /^PASS affected: /, `the run's summary doesn't read PASS\n${all()}`);
  assert.equal(passedCount(run.stdout), 2, `the summary doesn't count the untimed file's test and the timed file's as passed\n${all()}`);
  assert.equal(run.status, 0, `the run exited ${run.status}${run.signal ? ` (${run.signal})` : ''}, not 0\n${all()}`);
});
