// #3238 AC1: on a test's own table with build at 1, no hub, no `deep` on PATH and no built CLI, two `scripts/lease`
// commands started together run one after the other, and the throttle's log shows a top-level `granted` of class
// build for each. The base runs both at once with no grant; a planted script that runs its command directly (the twin
// `runs-directly`, as DEEP_HUB_PLANT=lease-script-runs-directly does) fails here the same way, naming the second.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC1, BUILD_SLOTS, copyScripts, dump, endOf, finish, holdBuild, log, running, sandbox, start, startOf, table, when, within } from './helpers.mjs';

const NAMES = ['build-one', 'build-two'];

test(`${AC1} two scripts/lease commands started together with build at 1, no hub and no built CLI run one after the other, each under a top-level build grant in the log`, async (t) => {
  const box = sandbox(t);
  const lease = copyScripts(box);
  // build is 2 on Linux: a holder takes the other slot, so one is left for the two commands, as on the Mac.
  await holdBuild(box, BUILD_SLOTS - 1);
  const runs = NAMES.map((name) => start(box, [lease, 'node', box.stub, name], name));
  const shown = () => dump(box, ...runs);

  // Both started, or one started while the other's build request waits in the table, or a command ended.
  const seen = await when(box, () => {
    const begun = NAMES.filter((name) => startOf(box, name));
    if (begun.length === 2) return { both: true };
    if (begun.length === 1 && (table(box)?.requests ?? []).some((request) => request.class === 'build')) return { first: begun[0] };
    if (runs.some((run) => !running(run))) return { ended: true };
    return null;
  }, 180_000);
  assert.ok(seen, `neither scripts/lease command started its command, nor waited in the table, within 3 min\n${shown()}`);
  if (seen.both) {
    const [first, second] = [...NAMES].sort((a, b) => startOf(box, a).at - startOf(box, b).at);
    assert.fail(`the second command, \`node stub.mjs ${second}\`, started while the first, \`${first}\`, still ran: two scripts/lease commands ran at once on a table with build at 1\n${shown()}`);
  }
  assert.ok(!seen.ended, `a scripts/lease command ended before both commands had started or one waited\n${shown()}`);

  // The first ends; only then does the second start.
  const first = seen.first;
  const second = NAMES.find((name) => name !== first);
  finish(box, first);
  const next = await when(box, () => startOf(box, second) || !running(runs[NAMES.indexOf(second)]), 180_000);
  assert.ok(next && startOf(box, second), `the second command, \`node stub.mjs ${second}\`, never started once the first had ended\n${shown()}`);
  assert.ok(endOf(box, first) && startOf(box, second).at >= endOf(box, first).at, `the second command, \`node stub.mjs ${second}\`, started before the first, \`${first}\`, ended\n${shown()}`);
  finish(box, second);
  await within(Promise.all(runs.map((run) => run.done)), 120_000);

  // Each ran under a top-level build grant of its own, which the log shows granted.
  const ids = NAMES.map((name) => {
    const token = String(startOf(box, name).throttle);
    assert.match(token, /^build:[0-9a-f]+$/, `\`node stub.mjs ${name}\` ran under no build grant (DEEP_THROTTLE ${token})\n${shown()}`);
    const id = token.slice('build:'.length);
    const granted = log(box).find((entry) => entry.event === 'granted' && entry.id === id);
    assert.ok(granted?.class === 'build' && granted?.grant === 'top-level', `the log shows no top-level granted of class build for \`node stub.mjs ${name}\`'s grant ${id}: ${JSON.stringify(granted)}\n${shown()}`);
    return id;
  });
  assert.notEqual(ids[0], ids[1], `the two commands ran under one grant, ${ids[0]}\n${shown()}`);
});
