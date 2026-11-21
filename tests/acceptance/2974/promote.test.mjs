// #2974 AC5 (README: The scenes): `deep hub promote` of a good build still moves the hub to it with no prompt, with no
// session started during its drain. A turn runs when the promotion begins and for 40 s after it says it waits for it,
// past a drain's 30 s lapse, so the drain must hold as long as promote renews it; a start is sent each second meanwhile.
import { test } from 'node:test';
import { LAPSE_MS, LONG, assert, asks, current, drained, ended, hello, hubPid, hubStarts, promotedWithTurn, promoting, redact, runs, said, sandbox, served, sha7, shown, start, turnEnds, wait, waitsForTurn } from './helpers.mjs';

const TURN_MS = LAPSE_MS + 10_000;

test('#2974.b18056cd deep hub promote of a good build still moves the hub to it with no prompt, with no session started during its drain', LONG, async (t) => {
  const box = await sandbox(t);
  const { fx, before, pid, build, s } = await promotedWithTurn(box);
  const asked = asks(box).length;
  const since = Date.now();
  const p = promoting(box, fx, build);
  const blocked = await waitsForTurn(box, p);
  if (blocked && p.exitCode !== null) {
    // It ended before it waited: no prompt, and a good build moves the hub, or it fails here.
    const early = await p.done;
    assert.deepEqual(asks(box).slice(asked), [], `deep hub promote must ask the OS nothing: the promotion runs with no prompt (it exited ${early.status} before waiting for the running turn: ${redact(early.stderr.slice(-500), box)})`);
    assert.equal(early.status, 0, `deep hub promote of a good build of ${sha7(build.commit)} must move the hub to it: ${shown(early, box)}`);
  }
  assert.ok(!blocked, blocked);
  const waiting = Date.now();

  // A start each second, from the promotion's wait until the promotion ends.
  const starts = [];
  let polling = true;
  const poll = (async () => {
    while (polling) {
      const st = await start(box);
      if (polling) starts.push(st);
      await wait(Math.max(0, st.t + 1000 - Date.now()));
    }
  })();
  await wait(TURN_MS);
  const ended_ = await turnEnds(box, s);
  assert.equal(ended_.status, 0, `BLOCKED: the turn's Stop hook failed: ${shown(ended_, box)}`);
  const run = await ended(p, 900_000);
  polling = false;
  await poll;

  // While the hub that was in answered, no start was served: every reply a refusal by the drain, or none (the hub going).
  // The promoted build's hub, after the restart, holds no drain of the promotion's.
  const answered = starts.filter((st) => typeof st.reply === 'object' && st.hub === before.start);
  const through = answered.filter((st) => served(st));
  assert.deepEqual(through.map((st) => `${Math.round((st.t - waiting) / 1000)} s into the wait: ${said(st, box)}`), [], `no session may start during the promotion's drain: these starts the hub that was in answered while deep hub promote waited ${Math.round(TURN_MS / 1000)} s for a running turn, and then restarted it, were served`);
  assert.ok(answered.filter((st) => st.t - waiting > LAPSE_MS && drained(st)).length >= 3, `BLOCKED: too few starts were refused by the drain past ${LAPSE_MS / 1000} s into the wait to judge it: ${answered.map((st) => said(st, box)).slice(-5).join('\n')}`);

  assert.equal(run.status, 0, `deep hub promote of a good build of ${sha7(build.commit)}, main watch having passed it, must move the installed hub to it once the running turn ends: ${shown(run, box)}`);
  assert.deepEqual(asks(box).slice(asked), [], 'deep hub promote must ask the OS nothing: the promotion runs with no prompt');
  const now = current(box);
  assert.ok(now?.commit === build.commit && now.inVersions, `after the promotion ~/.deepbuild/versions/current must name the build of ${sha7(build.commit)} under versions/; it names ${redact(JSON.stringify(now), box)}`);
  const after = await hello(box, { ms: 30_000 });
  assert.ok(after && after.start !== before.start, `after the promotion the installed hub must be a new one: ${after ? `it still says hello with start ${before.start}` : 'no hub answers'}`);
  const pid2 = await hubPid(box, { ms: 120_000 });
  assert.ok(!runs(pid), `the hub the promotion replaced (PID ${pid}) still runs`);
  assert.ok(hubStarts(box, build.name, since).some((h) => h.pid === pid2), `the installed hub (PID ${pid2}) must be the promoted build's bin/deep hub run, started since the promotion began; that build's hub runs: ${JSON.stringify(hubStarts(box, build.name, since))}`);
  await wait(5000);
  assert.equal((await hello(box, { ms: 10_000 }))?.start, after.start, 'the promoted build\'s hub must stay up');
});
