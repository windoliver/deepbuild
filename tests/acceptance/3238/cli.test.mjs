// #3238 AC4: with the CLI built and no hub, the command holds the throttle's grant and runs once. The script runs in
// place, so it finds the checkout's built CLI (packages/cli/dist/main.js); the sandbox's HOME has no hub and its PATH
// no `deep`. The base runs `deep lease`, which finds no hub and runs the command with no grant.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC4, CHECKOUT, dump, finish, log, running, sandbox, start, startOf, starts, table, when, within } from './helpers.mjs';

const JOB = 'npm-run-build';

test(`${AC4} with the CLI built and no hub, the command scripts/lease runs holds the throttle's build grant and runs once`, async (t) => {
  const cli = join(CHECKOUT, 'packages/cli/dist/main.js');
  if (!existsSync(cli)) throw Error(`BLOCKED: the CLI isn't built at ${cli} (npm run build --workspaces)`);
  const box = sandbox(t);
  const run = start(box, [join(CHECKOUT, 'scripts/lease'), 'node', box.stub, JOB], 'lease');
  const shown = () => dump(box, run);
  const seen = await when(box, () => startOf(box, JOB) || !running(run), 180_000);
  assert.ok(seen && startOf(box, JOB), `the command \`node stub.mjs ${JOB}\` never started\n${shown()}`);

  // While it runs, it holds a build grant that the table holds.
  const token = String(startOf(box, JOB).throttle);
  assert.match(token, /^build:[0-9a-f]+$/, `the command ran under no throttle grant (DEEP_THROTTLE ${token})\n${shown()}`);
  const id = token.slice('build:'.length);
  assert.ok((table(box)?.grants ?? []).some((grant) => grant.id === id && grant.class === 'build'), `the table holds no build grant ${id} while the command runs\n${shown()}`);

  finish(box, JOB);
  const ended = await within(run.done, 120_000);
  assert.ok(ended, `scripts/lease didn't end within 2 min of its command\n${shown()}`);
  assert.equal(starts(box, JOB).length, 1, `the command ran ${starts(box, JOB).length} times\n${shown()}`);
  assert.ok(log(box).some((entry) => entry.event === 'granted' && entry.id === id && entry.class === 'build' && entry.grant === 'top-level'), `the log shows no top-level build grant ${id}\n${shown()}`);
});
