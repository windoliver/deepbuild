// #2869, criterion 3: any other error still ends the request BLOCKED, as before: `BLOCKED throttle: <the error's
// message>` and exit 2, its command never run. This one passes on the base, which ends every error so; it guards the
// fix against waiting on every error instead of on ENOSPC alone.
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, fill, holdAll, queued, running, sandbox, startOf, throttle, within } from './helpers.mjs';

const ID = '#2869.fd8c32fe';

for (const [code, how] of [['EIO', 'an I/O error on the write'], ['EACCES', 'permission refused at the open']]) {
  test(`${ID} a waiting request whose table write fails with ${code} (${how}) still ends BLOCKED throttle, exit 2, its command never run`, { timeout: 180_000 }, async (t) => {
    const box = sandbox(t);
    const holders = await holdAll(box);
    const waiter = throttle(box, ['test', '--wait', '1'], 'waiter', ['exit'], { disk: { code, scope: 'all' } });
    await queued(box, waiter, ...holders);
    const all = () => dump(box, waiter, ...holders);
    fill(box);
    // Well inside its 1 min wait.
    const ran = await within(waiter.done, 40_000);
    assert.ok(ran, `the waiter went on waiting 40 s after its table writes began to fail with ${code}\n${all()}`);
    assert.equal(ran.status, 2, `the waiter exited ${ran.status}, not 2 (BLOCKED)\n${all()}`);
    assert.match(ran.stdout, new RegExp(`^BLOCKED throttle: .*${code}`, 'm'), all());
    assert.equal(startOf(box, 'waiter'), undefined, all());
    assert.ok(holders.every(running), all());
  });
}
