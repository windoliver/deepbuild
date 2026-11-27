import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, finish, log, running, startOf, started } from '../2744/helpers.mjs';
import { testLimit } from '../2744-redraft-2833/helpers.mjs';
import { requestOf, until } from '../2902/helpers.mjs';
import { EASED, GRANT_MS, LOADED, WAIT_MS, ask, box3580, grantWithin, names, queued, setReadings } from './helpers.mjs';

const LIMIT = testLimit();
const enough = () => assert.ok(LIMIT >= 2, `scripts/throttle.mjs's test limit here is ${LIMIT}: one held grant leaves no room for another`);

async function headOfLine(t) {
  enough();
  const box = box3580(t, LOADED);
  const holder = ask(box, 'holder');
  await started(box, holder, 'test', GRANT_MS, holder);
  const plain = ask(box, 'plain');
  const request = await queued(box, plain, holder);
  return { box, holder, plain, plainId: request.id };
}

test('#3580.54cd2bff load 25 on 20 cores, 100 GiB available, one test grant held: a run request behind a plain one at the head of the line is granted, and the plain one keeps waiting', { timeout: 300_000 }, async (t) => {
  const { box, holder, plain } = await headOfLine(t);
  const run = ask(box, 'run', { run: true });
  const all = [holder, plain, run];

  const granted = await grantWithin(box, run, GRANT_MS);
  assert.ok(granted, `the run request wasn't granted within ${GRANT_MS / 1000} s: it waits behind the plain request at the head of the line, which only the load holds back\n${dump(box, ...all)}`);
  assert.match(String(granted.throttle), /^test:\S+$/, `the run request ran under no test grant\n${dump(box, ...all)}`);

  // deadline: the plain request keeps waiting; a grant it got would show within the throttle's polls.
  await until(() => startOf(box, 'plain') || !running(plain), WAIT_MS);
  assert.equal(startOf(box, 'plain'), undefined, `the plain request was granted at load 25 on 20 cores\n${dump(box, ...all)}`);
  assert.ok(running(plain) && (await requestOf(box, plain.pid)), `the plain request left the line instead of waiting\n${dump(box, ...all)}`);
});

test('#3580.bd6fae70 the same table, the readings then dropping to load 10: the plain request is granted next, ahead of a run request queued after it', { timeout: 300_000 }, async (t) => {
  const { box, holder, plain } = await headOfLine(t);
  const passed = [];
  let behind = null;
  for (let k = 1; k <= LIMIT && !behind; k++) {
    const next = ask(box, `run-${k}`, { run: true });
    // deadline: a run request the readings admit is granted within the throttle's polls; one that isn't, waits.
    if (await grantWithin(box, next, WAIT_MS)) passed.push(next);
    else behind = next;
  }
  const all = [holder, plain, ...passed, behind].filter(Boolean);
  assert.ok(behind, `every run request was granted, so none waits behind the plain one\n${dump(box, ...all)}`);
  await queued(box, behind, ...all);
  assert.equal(startOf(box, 'plain'), undefined, `the plain request was granted at load 25 on 20 cores\n${dump(box, ...all)}`);

  setReadings(box, EASED);
  // deadline: the throttle's polls read the new readings within this; nothing here needs a grant to happen.
  await until(() => startOf(box, 'plain') || startOf(box, behind.label), WAIT_MS);
  finish(box, 'holder');

  const first = await grantWithin(box, plain, GRANT_MS);
  assert.ok(first, `the plain request wasn't granted within ${GRANT_MS / 1000} s of the load dropping to 10 and a slot freeing\n${dump(box, ...all)}`);
  const overtook = startOf(box, behind.label);
  assert.ok(!overtook || overtook.t > first.t, `${behind.label}, queued after the plain request, was granted ahead of it (at ${overtook?.t}, the plain one at ${first.t})\n${dump(box, ...all)}`);
});

test('#3580.00ead7ac with a timed request waiting, nothing is granted past the plain request: the drain still holds', { timeout: 300_000 }, async (t) => {
  const { box, holder, plain } = await headOfLine(t);
  const timed = ask(box, 'timed', { cls: 'timed' });
  await queued(box, timed, holder, plain);
  const run = ask(box, 'run', { run: true });
  const all = [holder, plain, timed, run];
  await until(async () => (await requestOf(box, run.pid)) || startOf(box, 'run') || !running(run), GRANT_MS);

  // deadline: a grant past the plain request would show within the throttle's polls.
  await until(() => startOf(box, 'run') || startOf(box, 'plain') || !running(run), WAIT_MS);
  assert.equal(startOf(box, 'run'), undefined, `the run request was granted past the plain request while a timed request waited to drain\n${dump(box, ...all)}`);
  assert.equal(startOf(box, 'plain'), undefined, `the plain request was granted at load 25 while a timed request waited\n${dump(box, ...all)}`);
  assert.ok(running(timed) && (await requestOf(box, timed.pid)), `the timed request no longer waits, so no drain was there to hold\n${dump(box, ...all)}`);
  assert.ok(running(run) && (await requestOf(box, run.pid)), `the run request left the line instead of waiting\n${dump(box, ...all)}`);
});

test('#3580.4b48c6a9 when a waiter is passed over, the throttle log has one line naming it, the one granted past it, and the rule that held it (load 25.0 ≥ 20 cores)', { timeout: 300_000 }, async (t) => {
  const { box, holder, plain, plainId } = await headOfLine(t);
  const run = ask(box, 'run', { run: true });
  const all = [holder, plain, run];
  const waiting = await until(async () => (await requestOf(box, run.pid)) || startOf(box, 'run') || !running(run), GRANT_MS);
  const runId = (await requestOf(box, run.pid))?.id ?? startOf(box, 'run')?.throttle?.replace(/^test:/, '');
  assert.ok(waiting && runId, `the run request never reached the table\n${dump(box, ...all)}`);

  await grantWithin(box, run, GRANT_MS);
  // deadline: a log that wrote a pass-over line at every look would show more than one within the throttle's polls.
  await until(() => !running(plain), WAIT_MS);
  const lines = log(box).filter((entry) => names(entry, { pid: plain.pid, id: plainId }) && names(entry, { pid: run.pid, id: runId }) && JSON.stringify(entry).includes('load 25.0 ≥ 20 cores'));
  assert.equal(lines.length, 1, `the log has ${lines.length} lines naming the passed-over plain request (pid ${plain.pid}, ${plainId}), the run request granted past it (pid ${run.pid}, ${runId}) and the rule \`load 25.0 ≥ 20 cores\`, not one; the run request was ${startOf(box, 'run') ? '' : 'never '}granted\n${dump(box, ...all)}`);
});
