// #331 AC7: a hub killed between recording a start and the process starting finds the record on restart and reaps
// or reports the process, never leaving it untracked. The hub kills itself at the point the criterion names
// (DEEP_HUB_TEST_CRASH=start-recorded: the start is durable, nothing spawned yet) and just past it
// (DEEP_HUB_TEST_CRASH=spawned: the process exists, not yet tracked). Only the record survives the crash; the
// restarted hub must close each open start. Every PID comes from the files the dev server fixture writes.
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  alive, blocked, cleanup, Client, deep, jsonOut, makeRepo, pidsIn, READY, releasePorts, serverUp, sleep, startHub, stopHub, sub, tempDir,
  waitFor, type Hub, type Line,
} from './helpers.ts';

afterEach(async () => { await releasePorts(); await cleanup(); }, 30_000);

const is = (e: Line, kind: string): boolean => e.kind === kind || e.kind === `${kind}@1`;
const sameRun = (a: unknown, b: unknown): boolean => typeof a === 'string' && typeof b === 'string' && a.replace(/^run:/, '') === b.replace(/^run:/, '');
const stackPids = (dir: string): number[] => Object.values(pidsIn(dir)).flat();

/** `deep env up` on a hub that kills itself at `point`; returns once the hub is gone, or BLOCKED when it didn't crash there. */
async function crashDuringUp(hub: Hub, wt: string, point: string): Promise<void> {
  const up = deep(['env', 'up', '--root', hub.root, '--json'], { cwd: wt, timeoutMs: 60_000 });
  const ended = await Promise.race([hub.exit.then(() => true), up.then(() => sleep(3000)).then(() => !alive(hub.pid))]);
  const ran = await up;
  if (!ended || alive(hub.pid)) {
    if (ran.code === 2 && !jsonOut(ran)) throw Error(`deep env up isn't built at this commit (exit ${ran.code}: ${(ran.stderr || ran.stdout).trim().slice(0, 300)})`);
    blocked(`the hub with DEEP_HUB_TEST_CRASH=${point} didn't kill itself during deep env up (it printed ${ran.stdout.trim().slice(0, 300)})`);
  }
  if (hub.child.signalCode !== 'SIGKILL') blocked(`the hub with DEEP_HUB_TEST_CRASH=${point} ended by ${hub.child.signalCode ?? `exit ${hub.child.exitCode}`}, not SIGKILL: ${hub.stderr().slice(0, 500)}`);
}

/** Leaves only the record (the event log) under the hub's root, so what the restart knows comes from it alone. */
function onlyTheRecord(root: string): void {
  for (const name of readdirSync(root)) if (!/^ledger\.db/.test(name) && name !== 'evidence') rmSync(join(root, name), { recursive: true, force: true });
}

/** The stack's starts the record holds, and each one's cleanup once the restarted hub closes it. */
async function closedStarts(client: Client, point: string): Promise<{ runs: string[]; cleaned: Map<string, Line> }> {
  const events = await client.events();
  const runs = [...new Set(events.filter((e) => is(e, 'process.starting')).map((e) => String(e.data?.run)))];
  if (!runs.length) blocked(`the record holds no process.starting after the hub with DEEP_HUB_TEST_CRASH=${point} was killed, so no start was recorded before the crash`);
  const cleaned = new Map<string, Line>();
  await waitFor(async () => {
    const now = await client.events();
    for (const run of runs) {
      const c = now.find((e) => is(e, 'run.cleaned') && sameRun(e.data?.run, run));
      if (c) cleaned.set(run, c);
    }
    return cleaned.size === runs.length;
  }, 15_000, 'run.cleaned for each start').catch(() => {
    const open = runs.filter((r) => !cleaned.has(r));
    throw Error(`the restarted hub found the start of ${open.join(', ')} in the record and never closed it (no run.cleaned within 15 s), leaving it untracked`);
  });
  return { runs, cleaned };
}

function stack() {
  const dir = tempDir();
  const root = sub(dir, 'root');
  const repo = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20 });
  const wt = repo.worktree('wt');
  return { root, wt, pids: join(wt, '.pids') };
}

describe('AC7 #331.cba94b5d a hub killed between recording a start and the process starting finds the record on restart and reaps or reports the process', () => {
  it('AC7 killed after the start is durable and before the spawn, the restarted hub closes that start from the record, and no process of the stack runs untracked', async () => {
    const { root, wt, pids } = stack();
    const hub = await startHub(root, { DEEP_HUB_TEST_CRASH: 'start-recorded' });
    await crashDuringUp(hub, wt, 'start-recorded');
    await sleep(1000);
    if (stackPids(pids).length) blocked(`a stack process (${stackPids(pids).join(', ')}) started though the hub was to be killed before the spawn`);
    onlyTheRecord(root);
    const again = await startHub(root);
    const client = await Client.open(again);
    try {
      const { runs, cleaned } = await closedStarts(client, 'start-recorded');
      // Nothing started from that record runs unrecorded: any stack process now running is the run's and tracked or reported.
      await sleep(1000);
      const events = await client.events();
      for (const pid of stackPids(pids).filter(alive)) {
        const known = events.some((e) => (is(e, 'process.tracked') && e.data?.pid === pid) || (is(e, 'run.cleaned') && (e.data?.left as unknown[] | undefined)?.includes(`pid:${pid}`)));
        expect(known, `the stack process ${pid} runs after the restart and the record neither tracks nor reports it`).toBe(true);
      }
      for (const run of runs) expect(cleaned.get(run)!.data, `run.cleaned for ${run}`).toEqual(expect.objectContaining({ stopped: expect.any(Array), left: expect.any(Array) }));
    } finally {
      client.close();
      await stopHub(again);
    }
  }, 120_000);

  it('AC7 killed right after the spawn and before the process is tracked, the restarted hub finds the process from the record and stops it or reports it by PID', async () => {
    const { root, wt, pids } = stack();
    const hub = await startHub(root, { DEEP_HUB_TEST_CRASH: 'spawned' });
    await crashDuringUp(hub, wt, 'spawned');
    let server: number;
    try {
      server = await waitFor(() => pidsIn(pids).server?.[0], 10_000, 'the dev server\'s PID file');
    } catch {
      return blocked('the stack\'s process never started after the hub was killed right after the spawn');
    }
    await sleep(500);
    const started = stackPids(pids);
    if (!started.every(alive)) blocked(`the stack's processes (${started.join(', ')}) died with the hub, so there is nothing to reap or report`);
    onlyTheRecord(root);
    const again = await startHub(root);
    const client = await Client.open(again);
    try {
      const { cleaned } = await closedStarts(client, 'spawned');
      const stopped = new Set([...cleaned.values()].flatMap((c) => (c.data?.stopped as number[] | undefined) ?? []));
      const left = new Set([...cleaned.values()].flatMap((c) => (c.data?.left as string[] | undefined) ?? []));
      for (const pid of started) {
        const handled = await waitFor(() => (!alive(pid) && stopped.has(pid)) || (alive(pid) && left.has(`pid:${pid}`)), 15_000, `PID ${pid}`).catch(() => false);
        if (!handled) {
          throw Error(`the stack process ${pid}${pid === server ? ' (the dev server)' : ''}, spawned just before the crash, is ${alive(pid) ? 'still running' : 'gone'}, and the restarted hub neither reaped it (run.cleaned stopped ${JSON.stringify([...stopped])}) nor reported it (left ${JSON.stringify([...left])})`);
        }
      }
    } finally {
      client.close();
      await stopHub(again);
    }
  }, 120_000);
});
