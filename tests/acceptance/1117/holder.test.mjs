// AC5: lock holder death releases the bay. Every pair on the machine is held; one holder is killed by its PID with
// SIGKILL, so it can release nothing itself; the next claim gets that holder's pair.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PAIRS, bays, claimOf, finished, holding, inBay, machineRepo, probe, records, sandbox, show, until } from './helpers.mjs';

test('#1117.a9ce2b57 lock holder death releases the bay: with every pair held, a holder killed by SIGKILL frees its pair for the next claim', { timeout: 600_000 }, async (t) => {
  const box = sandbox(t);
  const { worktree, bays: script } = machineRepo(box);
  box.pids = [];
  const holders = [];
  for (let n = 0; n < PAIRS; n++) {
    const holder = bays(box, { script, cwd: worktree, steps: [{ do: 'hold' }] });
    holders.push(holder);
    const seen = await holding(holder);
    box.pids.push(seen.pid);
    const claim = records(holder.stdoutNow()).find((record) => record.event === 'claim');
    assert.ok(claim, `holder ${n + 1} of ${PAIRS} holds no claim record\n${holder.stdoutNow()}`);
    holder.index = claim.index;
  }
  assert.equal(new Set(holders.map((holder) => holder.index)).size, PAIRS, `the ${PAIRS} holders don't hold ${PAIRS} different pairs: ${holders.map((holder) => holder.index)}`);

  // The lock holder dies; its command, now orphaned, is stopped by its own PID too.
  const victim = holders.at(-1);
  process.kill(victim.pid, 'SIGKILL');
  await until(() => victim.exitCode !== null || victim.signalCode !== null, 10_000);
  try { process.kill(probe(victim).pid, 'SIGKILL'); } catch {}
  await victim.done;
  for (const holder of holders.slice(0, -1)) assert.equal(holder.exitCode, null, 'another holder ended: the test no longer holds every other pair');

  const next = bays(box, { script, cwd: worktree, steps: [] });
  const result = await finished(next, 120_000);
  const claim = claimOf(result);
  assert.ok(claim, `the next claim got no bay after the holder died\n${show(result)}`);
  inBay(box, result, next);
  assert.equal(claim.index, victim.index, `the next claim got pair ${claim.index}, not the dead holder's pair ${victim.index}`);
});
