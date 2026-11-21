// #2973 AC6, its second half: with 4 restarts spent, the promotion of a build that fails its health check rolls back to
// the last good build and exits 1, with both restarts done (README: The scenes).
import { test } from 'node:test';
import { LONG, MISJUDGES, assert, confirming, current, hubPid, hubStarts, launchd, makeBuild, promote, promotionScene, redact, runs, sandbox, sha7, shown, upNow } from './helpers.mjs';

test('#2973.88dce79f with 4 restarts spent, the promotion of a build that fails its health check rolls back to the last good build and exits 1, with both restarts done', LONG, async (t) => {
  const box = await sandbox((cleanup) => t.after(cleanup), { hook: true });
  confirming(box, 'cancelled');
  const { c1Build, c2, fx } = await promotionScene(box, 4);
  const { pid } = await upNow(box, 'before the promotion');
  const bad = makeBuild(box, 'misjudge-c2', c2, 'misjudge');
  const since = Date.now();
  const run = await promote(box, fx, bad);

  assert.equal(run.status, 1, `with 4 restarts spent, the promotion of a build of ${sha7(c2)} that fails its health check (DEEP_HUB_PLANT=${MISJUDGES}: it judges the fixture claim wrong) must roll back to the last good build and exit 1: ${shown(run, box)}`);
  const now = current(box);
  assert.ok(now?.commit === fx.c1, `after the rollback ~/.deepbuild/versions/current must name the last good build, of ${sha7(fx.c1)}; it names ${redact(JSON.stringify(now), box)}`);
  // Both restarts done: the hub that was in, then the bad build's hub, each exited 75 for the login service to start the next.
  const restarts = launchd(box).filter((e) => e.event === 'exit' && e.t >= since && e.code === 75);
  const badHubs = hubStarts(box, bad.name, since);
  assert.ok(restarts.length === 2 && restarts[0].pid === pid && badHubs.some((s) => s.pid === restarts[1].pid), `with 4 spent the budget has room for both of the promotion's restarts, so both must be done: one to the new build (the hub that was in, PID ${pid}, exiting 75) and one to roll back (the bad build's hub exiting 75). The login service's stand-in logged these exits 75 since the promotion began: ${JSON.stringify(restarts)}; the bad build's hub runs: ${JSON.stringify(badHubs)}`);
  const pid2 = await hubPid(box, { ms: 120_000 });
  assert.ok(pid2 && runs(pid2) && hubStarts(box, c1Build.name, since).some((s) => s.pid === pid2), `after the rollback the installed hub (PID ${pid2}) must be the last good build's bin/deep hub run, started since the promotion began; that build's hub runs since: ${JSON.stringify(hubStarts(box, c1Build.name, since))}`);
});
