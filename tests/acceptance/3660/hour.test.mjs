import assert from 'node:assert/strict';
import { existsSync, renameSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { hold, holding, inGroup, readings, start } from '../3567/helpers.mjs';
import { BINARY, BOUND_MIN, dump, EXIT_MS, PLANTED, record, sandbox, scene, SCENE, stateLines, summary, throttleLog, throttleTable, TIMED, UNTIMED, until } from '../3588/helpers.mjs';

const GRACE_MS = 20_000;
const WIDE = { memory: 1024 * 2 ** 30, load: 0, cores: 64 };
const ONE = { ...WIDE, cores: 2 };
const STATE = /^(?:PASS|FAIL|NEW FAIL|KNOWN|BLOCKED|INCONCLUSIVE|INVALID|NO NEW FAILURES)\b/;
const JOB = /scripts\/throttle\.mjs (?:build|test|timed) --wait 30 -- \S*scripts\/lease /;

function reread(box, value) {
  const file = box.env.DEEP_THROTTLE_READINGS;
  writeFileSync(`${file}.next`, JSON.stringify(value));
  renameSync(`${file}.next`, file);
}

function untimedAlone(box, run) {
  const jobs = inGroup(run.pid).filter(({ command }) => JOB.test(command));
  if (jobs.length !== 1 || !jobs[0].command.includes(UNTIMED)) return false;
  const { grants = [], requests = [] } = throttleTable(box);
  return grants.some((grant) => grant.class === 'turn' && grant.pid === jobs[0].pid) && !requests.some((request) => request.class === 'turn');
}

test(`#3660.e8808b70 in #3588's fixture on a pool of one token, a stub build holding it from before the timed phase while build slots stay free, the run's rebuild before the timed job is admitted and waits for its turn at most the time left: the run exits 1 within 4 minutes, its untimed file FAIL, its timed file INCONCLUSIVE not started at its bound of 3 min, the binary still absent`, SCENE, async (t) => {
  const box = sandbox(t);
  readings(box, WIDE);
  const fx = scene(box, { fails: true });
  const run = start(box, fx, ['--timed', UNTIMED, TIMED], { limit: EXIT_MS + GRACE_MS });
  let exited = false;
  const done = run.done.then((result) => { exited = true; return result; });
  const played = { holder: null, alone: false, admitted: false, early: false, watching: null, appeared: [] };

  played.alone = await until(() => exited || untimedAlone(box, run), EXIT_MS) && !exited;
  if (played.alone) {
    reread(box, ONE);
    played.holder = hold(box, fx, 'build');
    played.admitted = await until(() => exited || throttleLog(box).some((e) => e.event === 'granted' && e.class === 'build' && e.pid === played.holder), 60_000) && !exited;
    played.early = holding(box) > 0;
    writeFileSync(fx.go, '');
    await until(() => record(fx).some((entry) => entry.event === 'deleted') || exited, EXIT_MS);
    const deleted = record(fx).find((entry) => entry.event === 'deleted');
    if (deleted?.dir && existsSync(deleted.dir)) {
      played.watching = deleted.dir;
      const watcher = watch(deleted.dir, (_, name) => { if (name === BINARY) played.appeared.push(Date.now()); });
      done.finally(() => watcher.close());
      if (existsSync(join(deleted.dir, BINARY))) played.appeared.push(Date.now());
    }
  }
  const result = await done;
  const log = throttleLog(box);
  const show = () => `${dump(box, fx, { holders: played.holder ? [played.holder] : [], appeared: played.appeared, watching: played.watching }, result)}\nthe readings gave a pool of one token from the moment the untimed file's job ran alone: ${played.alone}; the holder admitted before the go: ${played.admitted}`;

  assert.ok(played.alone, `the run's untimed file never held its turn alone, every other job of the run ended, before the run ended\n${show()}`);
  assert.ok(played.admitted, `the stub build ${played.holder} was never admitted while build slots were free\n${show()}`);
  assert.ok(!played.early, `the stub build's command started while the untimed file's job held the pool's one token: the pool wasn't one token\n${show()}`);
  assert.ok(record(fx).find((entry) => entry.event === 'read')?.there, `the untimed file found no ${BINARY} in DEEP_BIN_DIR, so there was nothing for a cleanup to remove\n${show()}`);
  assert.ok(record(fx).find((entry) => entry.event === 'deleted')?.gone, `the untimed file didn't remove ${BINARY} from DEEP_BIN_DIR, so nothing needed building again\n${show()}`);
  assert.equal(holding(box), 1, `the stub build never held the pool's one token once the untimed file's job gave it back\n${show()}`);
  const gaveBack = log.findIndex((e) => e.event === 'released' && e.class === 'test');
  assert.ok(gaveBack >= 0, `the run never gave back its test grant before its timed phase\n${show()}`);
  const rebuild = log.slice(gaveBack).find((e) => e.event === 'granted' && e.class === 'build' && e.pid === log[gaveBack].pid);
  assert.ok(rebuild, `the run's rebuild before the timed job was never admitted once it gave back its test grant, so it never waited for its turn\n${show()}`);

  assert.ok(!result.limited, `affected.mjs was still running ${(result.limit / 1000).toFixed(0)} s after its start, past the 4 minutes it must exit within at a bound of ${BOUND_MIN} min: its rebuild, admitted, was still waiting for its turn of the pool behind the stub build\n${show()}`);
  assert.ok(result.ms <= EXIT_MS, `affected.mjs exited ${(result.ms / 1000).toFixed(1)} s after its start, not within 4 minutes (${EXIT_MS / 1000} s)\n${show()}`);
  assert.ok(stateLines(result.stdout, UNTIMED).some((line) => /^(?:NEW )?FAIL /.test(line) && line.includes(PLANTED)), `no FAIL line names the untimed file's failed test ${UNTIMED} › ${PLANTED}\n${show()}`);
  const said = `not started: the run reached its bound of ${BOUND_MIN} min`;
  const timedLines = result.stdout.split('\n').filter((line) => STATE.test(line) && line.includes(TIMED));
  assert.ok(timedLines.some((line) => line.startsWith('INCONCLUSIVE') && line.includes(said)), `no INCONCLUSIVE line names the timed file ${TIMED} with "${said}"\n${show()}`);
  assert.deepEqual(timedLines.filter((line) => !line.startsWith('INCONCLUSIVE')), [], `a line with a state other than INCONCLUSIVE names the timed file, which never started\n${show()}`);
  assert.equal(record(fx).find((entry) => entry.event === 'timed-ran'), undefined, `the timed file's test ran, though its rebuild never had a turn before the bound\n${show()}`);
  assert.ok(played.watching, `the untimed file's DEEP_BIN_DIR was gone before it could be watched\n${show()}`);
  assert.deepEqual(played.appeared, [], `${BINARY} was put back into DEEP_BIN_DIR after the cleanup, though the rebuild never had a turn before the bound\n${show()}`);
  assert.ok(!existsSync(join(played.watching, BINARY)), `${BINARY} is in DEEP_BIN_DIR again after the run\n${show()}`);
  assert.match(summary(result.stdout), /^FAIL affected: /, `the run's summary doesn't read FAIL\n${show()}`);
  assert.equal(result.status, 1, `the run exited ${result.status}${result.signal ? ` (${result.signal})` : ''}, not 1, a FAIL's exit\n${show()}`);
});
