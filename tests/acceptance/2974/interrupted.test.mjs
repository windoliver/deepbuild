// #2974 AC4 (README: The scenes): `deep hub promote` interrupted (SIGINT, as Ctrl-C sends it) while it waits for a
// running turn leaves no drain: start.session is served again within 1 s of its exit, with the hub still on the build
// that was in.
import { test } from 'node:test';
import { AFTER_EXIT_MS, LONG, assert, current, drained, hello, hubPid, promotedWithTurn, promoting, redact, runs, said, sandbox, servedAfter, sha7, start, waitsForTurn } from './helpers.mjs';

test('#2974.b5722acf deep hub promote interrupted with SIGINT while it waits for a running turn leaves no drain: start.session is served within 1 s of its exit, the hub still on the build that was in', LONG, async (t) => {
  const box = await sandbox(t);
  const { fx, before, pid, build } = await promotedWithTurn(box);
  const p = promoting(box, fx, build);
  const blocked = await waitsForTurn(box, p);
  assert.ok(!blocked, blocked);
  const under = await start(box);
  assert.ok(drained(under), `BLOCKED: while deep hub promote waits for the running turn, a start wasn't paused by its drain: ${said(under, box)}`);

  process.kill(-p.pid, 'SIGINT');
  const exit = await Promise.race([p.exited, new Promise((done) => setTimeout(() => done(undefined), 120_000))]);
  assert.ok(exit, `deep hub promote didn't exit within 120 s of SIGINT: ${redact(p.out + p.err, box)}`);
  const { got, sent } = await servedAfter(box, exit, AFTER_EXIT_MS);
  const run = await p.done;
  assert.ok(got && got.t <= exit + AFTER_EXIT_MS, `deep hub promote interrupted with SIGINT while it waited for a running turn left its hub.drain holding: no start.session sent within ${AFTER_EXIT_MS / 1000} s of its exit was served (${sent.length} sent; the last: ${said(sent.at(-1), box)}). It must lift its own drain when it is stopped before the hub stops. Its exit: ${run.status ?? run.signal}, ${redact(run.stderr.slice(-500), box)}`);

  const now = await hello(box, { ms: 10_000 });
  assert.equal(now?.start, before.start, 'an interrupted promotion must leave the hub that was in: the installed hub\'s start ID changed');
  assert.ok(runs(pid) && (await hubPid(box, { ms: 60_000 })) === pid, `an interrupted promotion must leave the hub that was in (PID ${pid}) running`);
  assert.equal(current(box)?.commit, fx.c1, `an interrupted promotion must leave ~/.deepbuild/versions/current on the build that was in, ${sha7(fx.c1)}; it names ${redact(JSON.stringify(current(box)), box)}`);
});
