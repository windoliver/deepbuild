// #2973 AC7: with 5 restarts spent, `deep hub promote` exits 1 before draining, naming the budget, with `current` and the
// running hub unchanged (README: The scenes).
import { test } from 'node:test';
import { LONG, assert, call, confirming, current, hello, hubStarts, launchd, makeBuild, namesBudget, promote, promotionScene, redact, runs, sandbox, sha7, shown, text, upNow, wait } from './helpers.mjs';

test('#2973.ff5ebbbe with 5 restarts spent, deep hub promote exits 1 before draining, naming the budget, with current and the running hub unchanged', LONG, async (t) => {
  const box = await sandbox((cleanup) => t.after(cleanup), { hook: true });
  confirming(box, 'cancelled');
  const { c2, fx } = await promotionScene(box, 5);
  const { hello: before, pid } = await upNow(box, 'before the promotion');
  const was = current(box);
  const build = makeBuild(box, 'good-c2', c2);
  const since = Date.now();
  const run = await promote(box, fx, build);

  assert.equal(run.status, 1, `with 5 restarts spent the budget has room for 1 restart, not the promotion's 2, so deep hub promote of a good build of ${sha7(c2)} must exit 1 before draining: ${shown(run, box)}`);
  const words = redact(`${run.stdout}\n${run.stderr}`, box);
  const budget = namesBudget(words);
  assert.ok(!budget, `the refused promotion must name the budget, 6 restarts in 60 minutes: ${budget}. It printed ${words}`);
  assert.deepEqual(current(box), was, `a promotion refused for the budget must leave ~/.deepbuild/versions/current as it was: it named ${redact(JSON.stringify(was), box)}, now ${redact(JSON.stringify(current(box)), box)}`);
  await wait(2000);
  const now = await hello(box, { ms: 10_000 });
  const started = launchd(box).filter((e) => e.event === 'start' && e.t >= since);
  assert.ok(now?.start === before.start && runs(pid) && started.length === 0 && hubStarts(box, build.name).length === 0, `a promotion refused for the budget must leave the running hub as it was (start ${before.start}, PID ${pid}): it says hello with ${now ? now.start : 'nothing'}, its process ${runs(pid) ? 'runs' : 'is gone'}, the login service started ${started.length} job(s) since, the build's hub ran ${hubStarts(box, build.name).length} time(s)`);
  // Not drained: the hub still serves session starts, which a drain refuses until the hub restarts on the new build.
  const startReply = await call(box, 'start.session', {});
  assert.ok(!/drain/i.test(text(startReply, box)), `a promotion refused for the budget must refuse before draining: the hub still refuses session starts as drained: ${text(startReply, box)}`);
});
