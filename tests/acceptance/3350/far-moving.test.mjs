// #3350: a remote lane's own commands, on the far machine, wait for their grants on the far end's stall bound, not
// lanes.mjs's fixed 30 minutes (docs/parallel-proof.md, sections 6 and 8). The real
// `node scripts/lane-remote.mjs --host <host> unit` runs in a session's worktree through the #1122 fixture far machine:
// `ssh` runs the far end on this machine under the far HOME, whose throttle table is that HOME's own.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, EXIT, exactTree, here, HOST, lanesFolder, laneRemote, ran, recordLine, sandbox, verdictLine, worktree, worst } from '../1122/helpers.mjs';
import { cargoCalls, cargoListing, cargoTest, GATE, grantsIn, movingLine, NOTED, npmCalls, open, reached, readyFar, showLog, SLOTS, STALL, within, wrapCargo } from './helpers.mjs';

const LONG = { timeout: 1_080_000 };

test('#3350.46301a6a a remote lane whose cargo test build grant waits behind a far build queue that keeps moving past the stall bound runs the command and reads the lane\'s own state', LONG, async (t) => {
  const box = sandbox(t);
  const table = readyFar(box);
  wrapCargo(box);
  const session = worktree(box, { files: { ...NOTED, ...GATE } });
  const tree = exactTree(box, session.cwd);
  const running = within(laneRemote(box, session.cwd, ['--host', HOST, 'unit']), 15);

  // Once the far end's install and build are done and the lane's tests are at the gate, the far machine's build queue
  // starts moving, six holders a slot waiting at every moment, each grant held about 2 s, until cargo's listing runs.
  assert.ok(await reached(box, 8), `the lane's tests reached their gate on the far machine within 8 min\nnpm: ${JSON.stringify(npmCalls(box))}\n${showLog(table)}`);
  const line = movingLine(box, { table, home: box.far, stop: join(box.log, 'cargo-list-ran') });
  const ready = await within(line.line(/^READY /), 2);
  open(box);
  assert.ok(ready, `the far machine's build queue moved within 2 min\n${line.output()}\n${showLog(table)}`);

  const run = await running;
  const calls = cargoCalls(box, box.far);
  const all = () => `${run ? dump(run) : 'the near end was still running after 15 min'}\nline:\n${line.output()}\ncargo: ${JSON.stringify(calls)}\n${showLog(table)}`;
  assert.ok(run, `the near end ended\n${all()}`);

  // The lane's cargo test ran on the far machine under a build grant asked on the stall bound, after waiting behind
  // the moving queue for more than twice that bound.
  const command = cargoTest(calls);
  assert.match(String(command?.grant), /^build:[0-9a-f]+$/, `the lane's cargo test ran on the far machine under a build grant\n${all()}`);
  const granted = grantsIn(table).find((entry) => `build:${entry.id}` === command.grant);
  assert.ok(granted, `the far machine's table logged the grant cargo test ran under\n${all()}`);
  assert.ok(Number(granted.stall) === Number(STALL) && granted.wait === undefined, `cargo test's build grant was asked with --stall ${STALL}, the far end's bound, not --wait: ${JSON.stringify(granted)}\n${all()}`);
  const waited = command.above[granted.pid];
  assert.ok(waited >= 2 * Number(STALL) * 60, `cargo test's request waited past twice the bound (${2 * Number(STALL) * 60} s) before its grant: ${waited} s\n${all()}`);
  const holders = new Set(line.granted());
  const since = Date.parse(granted.at) - waited * 1000;
  const ahead = grantsIn(table).filter((entry) => holders.has(`build:${entry.id}`) && Date.parse(entry.at) >= since && Date.parse(entry.at) < Date.parse(granted.at));
  assert.ok(ahead.length >= 3 * SLOTS, `holders' grants changed hands at least ${3 * SLOTS} times while cargo test's request waited; ${ahead.length} did\n${all()}`);
  // Its listing, `cargo test … -- --list`, asked the same way.
  const listing = cargoListing(calls);
  const listed = listing && grantsIn(table).find((entry) => `build:${entry.id}` === listing.grant);
  assert.ok(listed && Number(listed.stall) === Number(STALL) && listed.wait === undefined, `cargo's listing ran under a build grant asked with --stall ${STALL}: ${JSON.stringify(listed)}\n${all()}`);

  // The near end reads the lane's own state: the fetched record's, and no missing grant.
  const path = recordLine(run);
  assert.equal(path, join(lanesFolder(box.home), `${tree}-unit-${here}.json`), `the near end names the fetched record\n${all()}`);
  const found = JSON.parse(readFileSync(path, 'utf8'));
  const shown = `${all()}\nrecord: ${JSON.stringify(found, null, 1)}`;
  const notes = [...(found.findings ?? []).map(({ note }) => note), ...(found.tests ?? []).map(({ note }) => note)].map(String);
  assert.ok(!notes.some((note) => /no grant|no build grant/.test(note)), `no finding or row of the record is a missing grant\n${shown}`);
  const own = process.platform === 'darwin' ? 'PASS' : worst((found.tests ?? []).map(({ state }) => state));
  assert.equal(found.state, own, `the record reads the lane's own state, ${own}\n${shown}`);
  assert.equal(verdictLine(run, 'unit', ` on ${here}`), found.state, `the near end prints "${found.state} unit on ${here}"\n${shown}`);
  assert.equal(run.status, EXIT[found.state], `the near end exits ${EXIT[found.state]} on ${found.state}\n${shown}`);
  assert.ok(ran(box.far).some(({ name }) => name === 'noted'), `the lane's node test, after cargo test, ran on the far machine\n${shown}`);
});
