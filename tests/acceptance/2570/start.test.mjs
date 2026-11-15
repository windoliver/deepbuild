// #2570 criterion 2: with no hub and none exiting, `deep hub start` starts one as today; a hub that never answers
// still fails at 15 s with today's message and exit 3. These pin the base's behavior and pass there.
import { test } from 'node:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AC2, LONG, WAIT_MS, alive, assert, deep, exitingHub, hello, hubPid, hubRuns, launchd, sandbox, serviceCalls, shown } from './helpers.mjs';

/** Today's message, read from the base's startHub (packages/hub/src/service.ts). */
const noHub = (box) => `deep hub start: no hub answered at unix:${box.socket} within 15 s; see ${box.log}\n`;
/** The slack a loaded machine gets past the 15 s. */
const SLACK_MS = 15_000;

async function startsOne(t, kind) {
  const box = sandbox(t, kind);
  assert.equal(await hello(box), undefined, "the scene's own step: no hub may answer before the start");
  const run = await deep(box, ['hub', 'start', ...box.flags]);
  assert.equal(run.status, 0, `${AC2} with no hub and none exiting, deep hub start must exit 0: ${shown(run)}`);
  assert.ok(await hello(box), `${AC2} deep hub start exited 0, and no hub answers on unix:${box.socket}`);
  const pid = await hubPid(box);
  assert.ok(Number.isSafeInteger(pid) && alive(pid), `${AC2} deep hub status must name the started hub's process: ${pid}`);
  if (kind === 'installed') {
    const asks = launchd(box).filter((e) => e.event === 'ask');
    assert.deepEqual(asks.map((e) => [e.running, e.did]), [[null, 'start']], `${AC2} the service manager is asked once, and starts the job`);
    assert.ok(existsSync(asks[0].file), `${AC2} the service manager is handed the login service's definition: ${asks[0].file}`);
    assert.deepEqual(serviceCalls(box), [], 'nothing may call launchctl or systemctl where DEEP_HUB_LAUNCHER names the service manager');
  }
  // As today, a start beside a hub that answers starts nothing and exits 0.
  const again = await deep(box, ['hub', 'start', ...box.flags]);
  assert.equal(again.status, 0, `${AC2} deep hub start beside a hub that answers must exit 0: ${shown(again)}`);
  assert.equal(await hubPid(box), pid, `${AC2} deep hub start beside a hub that answers must leave that hub running`);
  assert.equal(hubRuns(box).filter((e) => e.event === 'run').length, 1, `${AC2} deep hub start beside a hub that answers must start no other`);
}

async function neverAnswers(t, kind) {
  const box = sandbox(t, kind);
  // A hub that never answers: the base's hub refuses to start on a root where a restore didn't finish, and exits 1.
  mkdirSync(box.root, { recursive: true });
  writeFileSync(join(box.root, 'restore.pending'), `${join(box.dir, 'backup')}\n`);
  const run = await deep(box, ['hub', 'start', ...box.flags], WAIT_MS + SLACK_MS + 30_000);
  assert.ok(hubRuns(box).some((e) => e.event === 'run'), `the scene's own step: deep hub start must have started a hub: ${shown(run)}`);
  assert.equal(run.status, 3, `${AC2} deep hub start, when the hub it started never answers, must exit 3: ${shown(run)}`);
  assert.equal(run.stderr, noHub(box), `${AC2} deep hub start must fail with today's message`);
  assert.equal(run.stdout, '', `${AC2} deep hub start prints nothing else`);
  assert.ok(run.ms >= WAIT_MS, `${AC2} deep hub start must wait 15 s for the hub before it fails; it took ${run.ms} ms`);
  assert.ok(run.ms < WAIT_MS + SLACK_MS, `${AC2} deep hub start must fail at 15 s (within ${SLACK_MS / 1000} s more on a loaded machine); it took ${run.ms} ms`);
  assert.equal(await hello(box), undefined, "the scene's own step: no hub answers afterwards");
  if (kind === 'installed') assert.deepEqual(serviceCalls(box), [], 'nothing may call launchctl or systemctl where DEEP_HUB_LAUNCHER names the service manager');
}

test(`${AC2} a dev hub: with no hub and none exiting, deep hub start --root starts one, exit 0`, LONG, (t) => startsOne(t, 'dev'));
test(`${AC2} the installed hub: with no hub and none exiting, deep hub start asks the service manager once and a hub answers, exit 0`, LONG, (t) => startsOne(t, 'installed'));
test(`${AC2} a dev hub that never answers: deep hub start --root fails at 15 s with today's message and exit 3`, LONG, (t) => neverAnswers(t, 'dev'));
test(`${AC2} an installed hub that never answers: deep hub start fails at 15 s with today's message and exit 3`, LONG, (t) => neverAnswers(t, 'installed'));

// My reading where the issue is silent (README: Choices): an old hub that never finishes exiting is a hub that never
// answers, so the start must still end by itself with exit 3, and must leave the old hub alone.
test(`${AC2} beside an old hub that never finishes exiting, deep hub start --root ends by itself with exit 3 and leaves that hub alone`, LONG, async (t) => {
  const box = sandbox(t, 'dev');
  const old = await exitingHub(box);
  const run = await deep(box, ['hub', 'start', ...box.flags], 60_000);
  assert.ok(!run.stopped, `${AC2} deep hub start must end by itself within 60 s while the old hub (pid ${old}) never finishes exiting; the test had to stop it`);
  assert.equal(run.status, 3, `${AC2} deep hub start, with no hub answering, must exit 3: ${shown(run)}`);
  assert.match(run.stderr, /^deep hub start: \S/m, `${AC2} deep hub start must say why it failed, as "deep hub start: ..."`);
  assert.equal(await hello(box), undefined, "the scene's own step: no hub answers while the old one still holds the root");
  assert.ok(alive(old) && !hubRuns(box).some((e) => e.pid === old && (e.event === 'exit' || e.event === 'released')), `${AC2} deep hub start must leave the exiting hub (pid ${old}) alone, never stop it`);
});
