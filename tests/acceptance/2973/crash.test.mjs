// #2973 AC4: a hub that crashes (exits on a signal) 7 times leaves the budget unspent (README: The scenes).
import { test } from 'node:test';
import { BACK_MS, LONG, assert, crash, restart, restarted, sandbox, startInstalled, text } from './helpers.mjs';

test('#2973.5462ab8d a hub that crashes 7 times, each on a signal the login service restarts, leaves the budget unspent: the next hub.restart restarts it', LONG, async (t) => {
  const box = await sandbox((cleanup) => t.after(cleanup));
  await startInstalled(box);
  for (let k = 1; k <= 7; k++) {
    const c = await crash(box);
    assert.equal(c.exit?.signal, 'SIGKILL', `BLOCKED: crash ${k}'s hub (PID ${c.pid}) must have exited on the signal; the login service's stand-in logged ${JSON.stringify(c.exit)}`);
  }
  const r = await restart(box);
  assert.ok(restarted(r), `after 7 crashes and no restart, the budget is unspent, so a hub.restart must restart the hub; it got ${text(r.reply, box)}${r.back ? '' : `, and no hub came back with a new start ID within ${BACK_MS / 1000} s`}`);
});
