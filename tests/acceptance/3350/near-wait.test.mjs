// #3350: a lane run started any other way than by lane-remote.mjs's far end keeps section 6's fixed `--wait 30` for
// its commands' grants. The real unit lane of a scratch worktree's lanes.mjs runs whole through the real runLanes, by
// #1122's driver, on a throttle table of the test's own.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, fullRun, LONG, sandbox, worktree } from '../1122/helpers.mjs';
import { cargoCalls, cargoListing, cargoTest, NOTED, notedGrants, showLog, STALL, tableLog, within, wrapCargo } from './helpers.mjs';

test('#3350.48bfd705 a lane run outside a far end asks for each of its commands\' grants with --wait 30, even with the far end\'s stall bound set', LONG, async (t) => {
  const box = sandbox(t);
  wrapCargo(box);
  const table = join(box.dir, 'table');
  mkdirSync(table);
  // The test's own table; and the far end's bound set in the session's environment, as a person's shell might hold it.
  box.env.DEEP_THROTTLE_TABLE = table;
  box.env.DEEP_LANE_REMOTE_STALL_MIN = STALL;
  const session = worktree(box, { files: NOTED });

  const run = await within(fullRun(box, session.cwd), 12);
  const calls = cargoCalls(box, box.home);
  const all = () => `${run ? dump(run) : 'the lane was still running after 12 min'}\ncargo: ${JSON.stringify(calls)}\nnoted: ${JSON.stringify(notedGrants(box.home))}\n${showLog(table)}`;
  assert.ok(run, `the lane run ended\n${all()}`);

  // The grants the lane's own commands ran under: its cargo test and cargo's listing (build), and its vitest block
  // and node --test command (test), each as the table logged it.
  const granted = tableLog(table).filter((entry) => entry.event === 'granted');
  const own = [
    ['cargo test', cargoTest(calls)?.grant],
    ["cargo's listing", cargoListing(calls)?.grant],
    ['the vitest block', notedGrants(box.home).find(({ runner }) => runner === 'vitest')?.grant],
    ['node --test', notedGrants(box.home).find(({ runner }) => runner === 'node')?.grant],
  ];
  for (const [what, grant] of own) {
    const entry = granted.find(({ class: cls, id }) => `${cls}:${id}` === grant);
    assert.ok(entry, `${what} ran under a grant the test's own table logged (${grant})\n${all()}`);
    assert.ok(Number(entry.wait) === 30 && entry.stall === undefined, `${what}'s grant was asked with --wait 30, not --stall: ${JSON.stringify(entry)}\n${all()}`);
  }
});
