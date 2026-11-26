// #3433: a captured measureOnce run stopped at its timeout stops every process its command started, those in a process
// group of their own too, and its ETIMEDOUT error names each one it stopped, by PID and command (README).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { alive, CHECKOUT, commandOf, fixtureScripts, GRANDCHILD, names, recorded, sandbox, until } from './helpers.mjs';

const { measureOnce } = await import(pathToFileURL(join(CHECKOUT, 'scripts/benchmark.mjs')).href);

/** A captured run of the lead past a 3 s timeout: what it threw, and the processes it recorded. */
function timedOut(t, name) {
  const box = sandbox(t, name);
  const { lead } = fixtureScripts(box.dir);
  const pids = join(box.dir, 'pids');
  let caught;
  try {
    measureOnce([process.execPath, lead, pids], box.dir, false, 3_000);
  } catch (error) {
    caught = error;
  }
  return { box, caught, procs: recorded(box, pids) };
}

test('#3433.bf4b249a a measureOnce captured run past its timeout, whose command starts a grandchild in a process group of its own and waits, throws ETIMEDOUT, and 2 s later no process the command started is alive', { timeout: 60_000 }, async (t) => {
  const { caught, procs } = timedOut(t, 'measure-tree');
  assert.equal(caught?.code, 'ETIMEDOUT', `the run threw ETIMEDOUT: ${caught?.stack ?? 'it threw nothing'}`);
  assert.deepEqual(procs.map(({ role }) => role).sort(), ['grandchild', 'lead'], 'the lead and its grandchild both started before the timeout');
  await until(() => !procs.some(alive), 2_000, 50);
  const left = procs.filter(alive);
  assert.deepEqual(left.map(({ role, pid }) => `${role} ${pid}`), [], `2 s after ETIMEDOUT these processes the command started still run: ${left.map(({ pid }) => `${pid} (${commandOf(pid)})`).join('; ')}`);
});

test('#3433.0ced7c1d measureOnce\'s ETIMEDOUT error names each process the stop ended, by PID and command', { timeout: 60_000 }, (t) => {
  const { caught, procs } = timedOut(t, 'measure-names');
  assert.equal(caught?.code, 'ETIMEDOUT', `the run threw ETIMEDOUT: ${caught?.stack ?? 'it threw nothing'}`);
  const message = String(caught.message);
  assert.match(message, /ETIMEDOUT/, 'the error still says ETIMEDOUT');
  const byRole = Object.fromEntries(procs.map((proc) => [proc.role, proc]));
  assert.ok(byRole.lead && byRole.grandchild, `the lead and its grandchild both started: ${JSON.stringify(procs)}`);
  for (const [role, word] of [['lead', 'lead-3433.mjs'], ['grandchild', GRANDCHILD]]) {
    assert.ok(names(message, byRole[role].pid, word), `the ETIMEDOUT error names the ${role} it stopped, pid ${byRole[role].pid} with its command (${word}), on one line:\n${message}`);
  }
});
