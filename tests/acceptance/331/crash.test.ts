// #331 AC7: a hub killed between recording a start and the process starting finds the record on restart and
// reaps or reports the process, never leaving it untracked. The fault is injected at two points of one start of a
// stack's process (README, The hub's test-only variables): right after `process.starting@1` is durable and before
// the spawn (`start-recorded`), and right after the spawn and before `process.tracked@1` (`spawned`). The hub
// kills itself with SIGKILL there; the test restarts it on the same root, with nothing but its files.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { alive, blocked, cleanup, Client, envUp, makeRepo, pidsIn, portEvents, READY, serverUp, sleep, startHub, stopHub, sub, tempDir, waitFor, type Line } from './helpers.ts';

afterEach(cleanup, 60_000);

/** The stack's run whose start was recorded, read from the record after the crash: process.starting with no process.tracked. */
async function crashed(point: 'start-recorded' | 'spawned') {
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20 });
  const wt = t.worktree('wt-a');
  const root = sub(tempDir(), 'root');
  const hub = await startHub(root, { DEEP_HUB_TEST_CRASH: point });
  const up = await envUp(hub, wt, 60_000);
  await Promise.race([hub.exit, sleep(10_000)]);
  if (alive(hub.pid)) {
    await stopHub(hub);
    blocked(`the hub didn't crash at ${point} (DEEP_HUB_TEST_CRASH=${point}); deep env up said: ${up.ran.stdout} ${up.ran.stderr}`);
  }
  const again = await startHub(root);
  const client = await Client.open(again);
  const events = await client.events();
  const starting = events.filter((e) => e.kind === 'process.starting');
  if (!starting.length) blocked(`the hub crashed at ${point} before it recorded the start (no process.starting@1 in the record)`);
  const run = starting[starting.length - 1]!.data.run as string;
  return { wt, again, client, run, events };
}
const cleaned = async (client: Client, run: string): Promise<Line> =>
  waitFor(async () => (await client.events('run.cleaned')).find((e) => e.data?.run === run), 15_000, `run.cleaned for ${run} after the restart`);

describe('AC7 #331.cba94b5d a hub killed between recording a start and the process starting reaps or reports it on restart', () => {
  it('AC7 killed after the start is recorded and before the spawn, the restarted hub finds the record and closes the start: run.cleaned for its run, its lease ended, and no process started late', async () => {
    const { wt, again, client, run, events } = await crashed('start-recorded');
    try {
      expect(events.filter((e) => e.kind === 'process.tracked' && e.data.run === run).length, 'the crash came before the process was tracked (scenario)').toBe(0);
      const done = await cleaned(client, run);
      expect(done.data.left, `nothing is left of ${run}`).toEqual([]);
      // The only run this hub had: every lease it took for it has ended.
      const now = await client.events();
      for (const l of portEvents(now, 'lease.acquired')) expect(portEvents(now, 'lease.released', Number(l.data.resource.key)).length, `the lease on port ${l.data.resource.key} ended`).toBeGreaterThan(0);
      await sleep(1000);
      expect(pidsIn(join(wt, '.pids')), 'the restarted hub started the recorded process after all').toEqual({});
    } finally {
      client.close();
      await stopHub(again);
    }
  }, 120_000);

  it('AC7 killed after the spawn and before the process is tracked, the restarted hub reaps the process the record names only as starting, or reports it by PID; it never stays untracked', async () => {
    const { wt, again, client, run, events } = await crashed('spawned');
    try {
      expect(events.filter((e) => e.kind === 'process.tracked' && e.data.run === run).length, 'the crash came before the process was tracked (scenario)').toBe(0);
      const server = await waitFor(() => pidsIn(join(wt, '.pids')).server?.[0], 10_000, 'the spawned server\'s PID file').catch(() => blocked('the process the hub spawned before its crash never ran, so there is nothing to find'));
      const done = await cleaned(client, run);
      const stopped = (done.data.stopped ?? []) as number[];
      const left = (done.data.left ?? []) as string[];
      await waitFor(() => !alive(server) || left.includes(`pid:${server}`), 15_000, `server ${server} reaped or reported`).catch(() => undefined);
      const reaped = !alive(server) && stopped.includes(server);
      const reported = alive(server) && left.includes(`pid:${server}`);
      expect(reaped || reported, `the process ${server} the crash left is neither reaped (stopped ${JSON.stringify(stopped)}, alive ${alive(server)}) nor reported (left ${JSON.stringify(left)})`).toBe(true);
    } finally {
      client.close();
      await stopHub(again);
    }
  }, 120_000);
});
