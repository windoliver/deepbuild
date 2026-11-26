// #3350: a remote lane's own command whose build grant doesn't come within the far end's stall bound leaves the far
// end's record INCONCLUSIVE, naming the holders (docs/parallel-proof.md, sections 6 and 8). The real
// `node scripts/lane-remote.mjs --host <host> unit` runs in a session's worktree through the #1122 fixture far machine:
// `ssh` runs the far end on this machine under the far HOME, whose throttle table is that HOME's own.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, exactTree, here, HOST, lanesFolder, laneRemote, lines, recordLine, sandbox, worktree } from '../1122/helpers.mjs';
import { cargoCalls, cargoTest, GATE, NOTED, npmCalls, open, reached, readyFar, showLog, STALL, stillLine, within, wrapCargo } from './helpers.mjs';

const LONG = { timeout: 1_080_000 };

test('#3350.cd64baa0 a remote lane whose cargo test build grant stalls past the bound leaves the far end\'s record INCONCLUSIVE with a finding naming the holder, and the near end exits 2', LONG, async (t) => {
  const box = sandbox(t);
  const table = readyFar(box);
  wrapCargo(box);
  const session = worktree(box, { files: { ...NOTED, ...GATE } });
  const tree = exactTree(box, session.cwd);
  const running = within(laneRemote(box, session.cwd, ['--host', HOST, 'unit']), 14);

  // Once the far end's install and build are done and the lane's tests are at the gate, every build slot of the far
  // machine is held for ten minutes, past the bound, and nothing else in its table changes hands.
  assert.ok(await reached(box, 8), `the lane's tests reached their gate on the far machine within 8 min\nnpm: ${JSON.stringify(npmCalls(box))}\n${showLog(table)}`);
  const holders = await stillLine(box, { table, home: box.far });
  open(box);
  assert.ok(holders.every(Boolean), `every far holder took its build grant\n${holders.map((holder) => holder?.child.output()).join('\n')}\n${showLog(table)}`);
  const atGate = Date.now();

  const run = await within(running, 6);
  const all = () => `${run ? dump(run) : `the near end was still running 6 min after the far build slots were held (${Math.round((Date.now() - atGate) / 1000)} s)`}\nnpm: ${JSON.stringify(npmCalls(box))}\ncargo: ${JSON.stringify(cargoCalls(box, box.far))}\n${showLog(table)}`;
  assert.ok(run, `the near end ended within 6 minutes of a stall bound of ${STALL} min\n${all()}`);
  assert.ok(lines(run).includes(`INCONCLUSIVE unit on ${here}`), `the near end prints "INCONCLUSIVE unit on ${here}"\n${all()}`);
  assert.equal(run.status, 2, `the near end exits 2 on INCONCLUSIVE\n${all()}`);

  const path = recordLine(run);
  assert.equal(path, join(lanesFolder(box.home), `${tree}-unit-${here}.json`), `the near end names the fetched record\n${all()}`);
  assert.ok(existsSync(path), `the fetched record exists\n${all()}`);
  const found = JSON.parse(readFileSync(path, 'utf8'));
  const shown = `${all()}\nrecord: ${JSON.stringify(found, null, 1)}`;
  assert.equal(found.state, 'INCONCLUSIVE', `the far end's record reads INCONCLUSIVE\n${shown}`);
  const head = `no build grant changed hands within ${STALL} min`;
  const finding = (found.findings ?? []).find(({ note }) => String(note).includes(head));
  assert.ok(finding, `a finding of the record is the missing grant, "…${head}…"\n${shown}`);
  assert.equal(finding.state, 'INCONCLUSIVE', `that finding is INCONCLUSIVE\n${shown}`);
  for (const holder of holders) {
    const named = String(finding.note).match(new RegExp(`; blocked by build grant ${holder.id} held by pid ${holder.pid} since \\S+ \\(([^)]*)\\)`));
    assert.ok(named?.[1].includes(holder.name), `the finding names the holder ${holder.name}: build grant ${holder.id}, pid ${holder.pid} and its command\n${shown}`);
  }

  // It was the lane's own command that got no grant: the far end's install and build ran, the lane's cargo test didn't.
  const npm = npmCalls(box).map(({ args }) => args);
  assert.ok(npm.includes('ci') && npm.some((args) => args.startsWith('run build')), `the far end's npm ci and package build ran before the lane\n${shown}`);
  assert.equal(cargoTest(cargoCalls(box, box.far)), undefined, `the lane's cargo test never ran without its grant\n${shown}`);
});
