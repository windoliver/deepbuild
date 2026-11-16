// #2330: a detached fixture must exit normally before its measurement finishes, so child counters can report.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { builder } from './acceptance/2330-redraft/run.mjs';

test('the never-ready detached peer has a normal exit record after scenario cleanup', { timeout: 60_000 }, async (t) => {
  const fixture = builder();
  t.after(() => fixture.close());
  await fixture.sample('never'); // Functional timeout/cleanup only, no timing-budget judgement.
  const dir = join(fixture.folder, '1', 'events');
  const events = readdirSync(dir).flatMap(name => readFileSync(join(dir, name), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
  const spawned = events.find(row => row.kind === 'spawn');
  assert.ok(spawned, 'the real CLI spawned a detached peer');
  const ended = events.find(row => row.kind === 'exit' && row.pid === spawned.child);
  assert.ok(ended, 'normal exit must be recorded; SIGKILL loses the descendant counter');
  assert.equal(ended.code, 0);
  assert.throws(() => process.kill(spawned.child, 0), { code: 'ESRCH' }, 'cleanup waits until its own child is gone');
});
