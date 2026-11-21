// #2973 AC6, its first half: within the budget, with 4 restarts spent, `deep hub promote` of a good build moves the
// installed hub to it with no prompt and exits 0 (README: The scenes).
import { test } from 'node:test';
import { LONG, assert, asks, confirming, current, hello, hubPid, hubStarts, makeBuild, promote, promotionScene, redact, runs, sandbox, sha7, shown, upNow, wait } from './helpers.mjs';

test('#2973.88dce79f with 4 restarts spent, deep hub promote of a good build moves the installed hub to it with no prompt and exits 0', LONG, async (t) => {
  const box = await sandbox((cleanup) => t.after(cleanup), { hook: true });
  confirming(box, 'cancelled');
  const { c2, fx } = await promotionScene(box, 4);
  const { hello: before, pid } = await upNow(box, 'before the promotion');
  const build = makeBuild(box, 'good-c2', c2);
  const asked = asks(box).length;
  const since = Date.now();
  const run = await promote(box, fx, build);

  assert.equal(run.status, 0, `with 4 restarts spent the budget has room for the promotion's 2, so deep hub promote of a good build of ${sha7(c2)} must move the installed hub to it and exit 0: ${shown(run, box)}`);
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
