// Blind redraft under #3549 of tests/acceptance/3588/bound.test.mjs (REDRAFT.md): the original line for line; only its
// helpers' runScene counts the holders of every build slot by the LIMITS-read build limit.
// #3588, criterion 1: a rebuild before a timed job, which every build slot keeps waiting, waits at most the time left to
// the bound and at the bound builds nothing. The run ends within 4 minutes of its start, its untimed file's FAIL read
// before the bound standing, its timed file INCONCLUSIVE as never started, and the binary the cleanup removed not built
// again. The merge base is the wrong program: its rebuild waits 30 minutes for a build grant, so at 4 minutes it is
// still waiting (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { BINARY, BOUND_MIN, dump, EXIT_MS, PLANTED, record, runScene, sandbox, scene, SCENE, stateLines, summary, TIMED, UNTIMED } from './helpers.mjs';

const C1 = '#3588.7a8aaa71';
const STATE = /^(?:PASS|FAIL|NEW FAIL|KNOWN|BLOCKED|INCONCLUSIVE|INVALID|NO NEW FAILURES)\b/;

test(`${C1} with every build slot held from before the timed phase, the rebuild before the timed job waits at most the time left and at the bound builds nothing: the run exits 1 within 4 minutes, its untimed file FAIL, its timed file INCONCLUSIVE as not started`, SCENE, async (t) => {
  const box = sandbox(t);
  const fx = scene(box, { fails: true });
  const played = await runScene(box, fx);
  const run = await played.done;
  const all = () => dump(box, fx, played, run);

  // The scene as the criterion orders it, so the run proves what it says.
  assert.ok(played.gaveBack, `the run never gave back its own build grant, so no holder took the build slots after it\n${all()}`);
  assert.ok(played.held, `the holders didn't take every build slot of the table before the run's timed phase\n${all()}`);
  const deleted = record(fx).find((entry) => entry.event === 'deleted');
  assert.ok(record(fx).find((entry) => entry.event === 'read')?.there, `the untimed file found no ${BINARY} in DEEP_BIN_DIR, so there was nothing for a cleanup to remove\n${all()}`);
  assert.ok(deleted?.gone, `the untimed file didn't remove ${BINARY} from DEEP_BIN_DIR, so nothing needed building again\n${all()}`);

  // "The run exits within 4 minutes of its start."
  assert.ok(!run.limited, `affected.mjs was still running ${(run.limit / 1000).toFixed(0)} s after its start, past the 4 minutes it must exit within at a bound of ${BOUND_MIN} min: its rebuild before the timed job was still waiting for a build grant behind the holders\n${all()}`);
  // deadline: the criterion's own limit, 4 minutes from the run's start to its exit.
  assert.ok(run.ms <= EXIT_MS, `affected.mjs exited ${(run.ms / 1000).toFixed(1)} s after its start, not within 4 minutes (${EXIT_MS / 1000} s)\n${all()}`);

  // Its output: the untimed file FAIL, read before the bound, and the timed file INCONCLUSIVE, not started.
  const untimedLines = stateLines(run.stdout, UNTIMED);
  assert.ok(untimedLines.some((line) => /^(?:NEW )?FAIL /.test(line) && line.includes(PLANTED)), `no FAIL line names the untimed file's failed test ${UNTIMED} › ${PLANTED}: a FAIL read before the bound must stand\n${all()}`);
  const said = `not started: the run reached its bound of ${BOUND_MIN} min`;
  const timedLines = run.stdout.split('\n').filter((line) => STATE.test(line) && line.includes(TIMED));
  assert.ok(timedLines.some((line) => line.startsWith('INCONCLUSIVE') && line.includes(said)), `no INCONCLUSIVE line names the timed file ${TIMED} with "${said}"\n${all()}`);
  assert.deepEqual(timedLines.filter((line) => !line.startsWith('INCONCLUSIVE')), [], `a line with a state other than INCONCLUSIVE names the timed file, which never started\n${all()}`);
  assert.equal(record(fx).find((entry) => entry.event === 'timed-ran'), undefined, `the timed file's test ran, though the run had reached its bound\n${all()}`);

  // Nothing was built after the bound: the binary never came back into DEEP_BIN_DIR while the run lived.
  assert.ok(played.watching, `the untimed file's DEEP_BIN_DIR was gone before it could be watched\n${all()}`);
  assert.deepEqual(played.appeared, [], `${BINARY} was put back into DEEP_BIN_DIR after the cleanup, though no build grant came before the bound\n${all()}`);

  assert.match(summary(run.stdout), /^FAIL affected: /, `the run's summary doesn't read FAIL\n${all()}`);
  assert.equal(run.status, 1, `the run exited ${run.status}${run.signal ? ` (${run.signal})` : ''}, not 1, a FAIL's exit\n${all()}`);
});
