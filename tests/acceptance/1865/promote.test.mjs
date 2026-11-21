// #1865 AC3: `deep hub promote` of a good build still moves the hub to it with no prompt, and a restart asked for with
// the token alone brings the hub back within 60 s (README: The scenes). Two tests, one per half, the same tag.
import { test } from 'node:test';
import { BACK_MS, LANDINGS, LONG, assert, askRestart, asks, backAfter, confirming, current, hello, hubPid, hubStarts, land, launchd, makeBuild, promote, redact, runs, sandbox, sha7, shown, startInstalled, tick, wait, watchStatus, watched } from './helpers.mjs';

/** main watch's run on the watched clone's head, which must pass: the commit a build of it can be promoted from. */
async function passed(box, fx, commit) {
  const run = await tick(box, fx);
  const status = await watchStatus(box, fx);
  assert.ok(new RegExp(`^last clean run: ${commit}$`, 'm').test(status.stdout), `BLOCKED: main watch didn't pass ${sha7(commit)} in the fixture: tick ${shown(run, box)}\nstatus ${shown(status, box)}`);
}

test('#1865.bd65df36 deep hub promote of a good build still moves the installed hub to it, with no prompt', LONG, async (t) => {
  const box = await sandbox(t);
  confirming(box, 'cancelled');
  const fx = watched(box);
  await passed(box, fx, fx.c1);
  const first = await promote(box, fx, makeBuild(box, 'good-c1', fx.c1));
  assert.equal(first.status, 0, `BLOCKED: the first promotion, of a build of ${sha7(fx.c1)} with no hub running yet, failed: ${shown(first, box)}`);
  const before = await hello(box, { ms: 30_000 });
  const pid = await hubPid(box, { ms: 120_000 });
  assert.ok(before && pid, 'BLOCKED: no installed hub answered after the first promotion');

  for (let k = 0; k < LANDINGS; k++) land(box, fx);
  const c2 = fx.landings.at(-1);
  await passed(box, fx, c2);
  const build = makeBuild(box, 'good-c2', c2);
  const asked = asks(box).length;
  const since = Date.now();
  const run = await promote(box, fx, build);

  assert.equal(run.status, 0, `deep hub promote of a good build of ${sha7(c2)}, main watch having passed it and no turn running, must move the installed hub to it with no prompt (the OS confirmation stub cancels any): ${shown(run, box)}`);
  assert.deepEqual(asks(box).slice(asked), [], 'deep hub promote must ask the OS nothing: the promotion runs with no prompt');
  const now = current(box);
  assert.ok(now?.commit === c2 && now.inVersions, `after the promotion ~/.deepbuild/versions/current must name the build of ${sha7(c2)} under versions/; it names ${redact(JSON.stringify(now), box)}`);
  const after = await hello(box, { ms: 30_000 });
  assert.ok(after && after.start !== before.start, `after the promotion the installed hub must be a new one: ${after ? `it still says hello with start ${before.start}` : 'no hub answers'}`);
  const pid2 = await hubPid(box, { ms: 120_000 });
  assert.ok(!runs(pid), `the hub the promotion replaced (PID ${pid}) still runs`);
  assert.ok(hubStarts(box, build.name, since).some((s) => s.pid === pid2), `the installed hub (PID ${pid2}) must be the promoted build's bin/deep hub run, started since the promotion began; that build's hub runs: ${JSON.stringify(hubStarts(box, build.name, since))}`);
  await wait(5000);
  assert.equal((await hello(box, { ms: 10_000 }))?.start, after.start, 'the promoted build\'s hub must stay up');
});

test('#1865.bd65df36 a restart asked for with the control token alone brings the installed hub back within 60 s', LONG, async (t) => {
  const box = await sandbox(t);
  const { hello: before, pid } = await startInstalled(box);
  confirming(box, 'cancelled');
  const asked = asks(box).length;
  const t0 = Date.now();
  const { method, reply } = await askRestart(box);
  assert.ok(typeof reply === 'object' && reply.result && !reply.error, `a restart asked for with the control token alone (${method}) must be served, with no prompt; it got ${redact(JSON.stringify(reply), box)}`);
  const back = await backAfter(box, before.start, BACK_MS + 30_000);
  const starts = launchd(box).filter((e) => e.event === 'start' && e.t >= t0);
  const exits = launchd(box).filter((e) => e.event === 'exit' && e.pid === pid);
  assert.ok(back && back.t - t0 <= BACK_MS, `a restart asked for with the token alone (${method}) must bring the installed hub back within ${BACK_MS / 1000} s; ${back ? `it came back after ${Math.round((back.t - t0) / 1000)} s` : `none came back within ${(BACK_MS + 30_000) / 1000} s`} (the old hub's exit: ${JSON.stringify(exits)}; the login service's starts since: ${starts.length})`);
  assert.ok(!runs(pid), `the restart must replace the hub: the old one (PID ${pid}) still runs`);
  assert.ok(starts.length >= 1, 'the login service must bring the hub back: it started no job since the restart was asked');
  assert.deepEqual(asks(box).slice(asked), [], 'a restart on the token alone asks the OS nothing');
});
