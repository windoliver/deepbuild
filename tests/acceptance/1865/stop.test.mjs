// #1865 AC1: a raw `hub.stop()` on the installed hub's socket, with the control token and the OS confirmation
// cancelled, leaves the hub running and gets a refusal naming the confirmation. And the Scope line on a dev hub
// started with --root, which stays exempt (README: The scenes).
import { test } from 'node:test';
import { join } from 'node:path';
import { CLIENT, LONG, NODE, assert, asks, confirming, deep, ended, hello, hubPid, launch, redact, runs, sandbox, shown, startInstalled, until, wait } from './helpers.mjs';

/** The client run as a process of its own, a command's child holding the token: its reply line. */
async function rawStop(box, { peer, socket = box.socket } = {}) {
  const run = await ended(launch(box, [NODE, CLIENT, socket, join(socket, '..', 'control.token'), 'hub.stop', '{}', ...(peer ? ['--peer'] : [])]), 180_000);
  let out;
  try { out = JSON.parse(run.stdout.trim().split('\n').at(-1)); } catch { assert.fail(`BLOCKED: the token holder printed no reply: ${shown(run, box)}`); }
  return out.reply;
}
/** Whether the installed hub that said `before` and runs as `pid` still does, `settle` ms after a call. */
async function stillUp(box, before, pid, settle = 5000) {
  await wait(settle);
  const now = await hello(box, { ms: 10_000 });
  return { up: !!now && now.start === before.start && runs(pid), now };
}

test('#1865.c16bc3be a token holder\'s raw hub.stop(), with the OS confirmation cancelled, leaves the installed hub running and gets a refusal naming the confirmation', LONG, async (t) => {
  const box = await sandbox(t);
  const { hello: before, pid } = await startInstalled(box);
  confirming(box, 'cancelled');

  // A command's child, which runs as you: it names its own process, as a deep command does, so the hub can ask the OS.
  const asked = asks(box).length;
  const reply = await rawStop(box, { peer: true });
  const first = await stillUp(box, before, pid);
  assert.ok(first.up, `hub.stop sent straight to the installed hub's socket with the control token, the OS confirmation cancelled, stopped the hub: hub.stop answered ${redact(JSON.stringify(reply), box)}, and the hub ${first.now ? `now says hello with start ${first.now.start}, not ${before.start}` : 'no longer answers'}. The installed hub must stop only once the OS confirms you inside the hub, as gates.off does, never on the control token alone`);
  assert.ok(typeof reply === 'object' && reply.error && !('result' in reply), `hub.stop on the token alone, the OS confirmation cancelled, must get a refusal; it got ${redact(JSON.stringify(reply), box)}`);
  assert.match(JSON.stringify(reply.error), /confirm/i, `hub.stop's refusal must name the confirmation; it reads ${redact(JSON.stringify(reply.error), box)}`);
  assert.ok(asks(box).length > asked, `the installed hub must ask the OS to confirm you for hub.stop (the stub of that prompt saw no ask); it refused with ${redact(JSON.stringify(reply.error), box)}`);

  // The same holder naming no process: refused too, and the hub still runs.
  const bare = await rawStop(box, { peer: false });
  const second = await stillUp(box, before, pid);
  assert.ok(second.up, `hub.stop with the control token alone, naming no process, stopped the installed hub: hub.stop answered ${redact(JSON.stringify(bare), box)}`);
  assert.ok(typeof bare === 'object' && bare.error && !('result' in bare), `hub.stop with the control token alone, naming no process, must get a refusal; it got ${redact(JSON.stringify(bare), box)}`);
});

test('Scope: a dev hub started with --root stays exempt: a raw hub.stop() with its token stops it, with no confirmation asked', LONG, async (t) => {
  const box = await sandbox(t);
  confirming(box, 'cancelled');
  const dev = join(box.dir, 'dev');
  const socket = join(dev, 'hub.sock');
  const run = await deep(box, ['hub', 'start', '--root', dev]);
  assert.equal(run.status, 0, `BLOCKED: deep hub start --root didn't start a dev hub: ${shown(run, box)}`);
  const pid = await hubPid(box, { socket, ms: 120_000 });
  assert.ok(pid, 'BLOCKED: the dev hub never answered hub.health');
  box.devHubs = [pid];
  const asked = asks(box).length;
  const reply = await rawStop(box, { socket });
  const gone = await until(async () => !(await hello(box, { socket, ms: 2000 })) && !runs(pid), 60_000);
  assert.ok(typeof reply === 'object' && reply.result, `a dev hub's hub.stop on its token must be served; it got ${redact(JSON.stringify(reply), box)}`);
  assert.ok(gone, 'a dev hub started with --root must stop on hub.stop with its token; it still runs a minute later');
  assert.equal(asks(box).length, asked, 'a dev hub\'s stop asks the OS nothing');
});
