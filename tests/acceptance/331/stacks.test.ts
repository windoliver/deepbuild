// #331 through `deep env up` and `deep env down` against a dev hub: AC1, two worktrees on different leased ports,
// both up at once; AC2, teardown stops only what it started, with a look-alike decoy left running; AC6, a port
// another program already listens on is never leased; AC9's half that has a surface now, a child's worktree never
// getting the port its parent's worktree leased (the session-bound half is in blocked.test.ts).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  alive, childEnv, cleanup, Client, envDown, firstFreeFrom, hasRunToken, health, holdPort, makeRepo, NODE, own, ownPidDir, pidOf, pidsIn, portEvents,
  READY, releasePorts, serverUp, startHub, stopHub, sub, SERVER, tempDir, upReady, waitFor, type Line,
} from './helpers.ts';

afterEach(async () => { await releasePorts(); await cleanup(); }, 60_000);

/** The stack answers its health route on the port, from the folder named. */
async function serves(port: number, folder: string, what: string): Promise<void> {
  const h = await health(port);
  expect(h.status, `${what}: GET /health on 127.0.0.1:${port} answers 200 (${h.error ?? h.status})`).toBe(200);
  expect(h.body?.cwd, `${what}: the stack on ${port} was started in ${folder}`).toBe(folder);
}

describe('AC1 #331.cc7309c3 two worktrees get different ports and both stacks come up', () => {
  it('AC1 `deep env up` in two worktrees of one repo at once leases each a different port, and both stacks answer their health route from their own worktree', async () => {
    const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20 });
    const a = t.worktree('wt-a');
    const b = t.worktree('wt-b');
    const hub = await startHub(sub(tempDir(), 'root'));
    const client = await Client.open(hub);
    try {
      const [upA, upB] = await Promise.all([upReady(hub, a), upReady(hub, b)]);
      expect(upA.ports.web, `the two worktrees got different ports (${upA.ports.web}, ${upB.ports.web})`).not.toBe(upB.ports.web);
      expect(upA.run).not.toBe(upB.run);
      await serves(upA.ports.web, a, 'wt-a');
      await serves(upB.ports.web, b, 'wt-b');
      const acquired = await client.events('lease.acquired');
      for (const [name, up] of [['wt-a', upA], ['wt-b', upB]] as const) {
        expect(portEvents(acquired, 'lease.acquired', up.ports.web).length, `the hub's lease table recorded ${name}'s port ${up.ports.web} (lease.acquired, resource kind port)`).toBeGreaterThan(0);
      }
      expect((await envDown(hub, a)).ran.code).toBe(0);
      expect((await envDown(hub, b)).ran.code).toBe(0);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 180_000);
});

describe('AC2 #331.86737f8a teardown stops only processes it started', () => {
  it('AC2 `deep env down` stops the stack\'s server and the child it started, and leaves a look-alike started by hand in the same worktree running', async () => {
    const t = makeRepo({ up: serverUp('--child'), ports: ['web'], ready: READY, within: 20 });
    const wt = t.worktree('wt-a');
    const hub = await startHub(sub(tempDir(), 'root'));
    try {
      const up = await upReady(hub, wt);
      const pids = join(wt, '.pids');
      const server = await pidOf(pids, 'server');
      const child = await pidOf(pids, 'child');
      expect(hasRunToken(server) && hasRunToken(child), 'the stack\'s processes carry the run token (scenario)').toBe(true);
      // The decoy: the same program, the same flags, in the same worktree, on a port of its own, with no run token.
      const decoys = ownPidDir(join(wt, '.decoy'));
      const port = await firstFreeFrom(up.ports.web + 50);
      const decoy = spawn(NODE, [SERVER, '--pid-dir', '.decoy', '--child'], { cwd: wt, env: childEnv({ web: String(port) }), stdio: 'ignore', detached: true });
      own(decoy.pid);
      const decoyServer = await pidOf(decoys, 'server');
      const decoyChild = await pidOf(decoys, 'child');
      await waitFor(async () => (await health(port)).status === 200, 10_000, 'the decoy to answer');
      const down = await envDown(hub, wt);
      expect(down.ran.code, `deep env down exits 0 (${down.ran.stdout} ${down.ran.stderr})`).toBe(0);
      await waitFor(() => !alive(server) && !alive(child), 5000, `the stack's server ${server} and child ${child} to be gone`);
      expect(alive(decoyServer), `the decoy's server ${decoyServer}, which deep didn't start, was stopped`).toBe(true);
      expect(alive(decoyChild), `the decoy's child ${decoyChild}, which deep didn't start, was stopped`).toBe(true);
      expect((await health(port)).status, 'the decoy still answers').toBe(200);
      const stopped = (down.out?.stopped ?? []) as number[];
      expect(stopped, 'down names what it stopped').toEqual(expect.arrayContaining([server]));
      expect(stopped, 'down stopped no process of the decoy').not.toEqual(expect.arrayContaining([decoyServer]));
      expect(stopped).not.toEqual(expect.arrayContaining([decoyChild]));
      expect(Object.keys(pidsIn(decoys)).sort()).toEqual(['child', 'server']);
    } finally {
      await stopHub(hub);
    }
  }, 120_000);
});

describe('AC6 #331.6e85fa63 a port another program already listens on is never leased', () => {
  it.each(['127.0.0.1', '0.0.0.0', '::'])('AC6 with another program listening on %s at the port the hub would lease first, `deep env up` leases another port and its stack comes up there', async (host) => {
    const taken = await firstFreeFrom(3000);
    await holdPort(taken, host);
    const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20 });
    const wt = t.worktree('wt-a');
    const hub = await startHub(sub(tempDir(), 'root'));
    const client = await Client.open(hub);
    try {
      const up = await upReady(hub, wt);
      expect(up.ports.web, `deep env up leased ${taken}, where another program already listens on ${host}`).not.toBe(taken);
      await serves(up.ports.web, wt, 'the stack');
      const acquired: Line[] = portEvents(await client.events('lease.acquired'), 'lease.acquired', taken);
      expect(acquired.map((e) => e.data), `the lease table holds a lease on the taken port ${taken}`).toEqual([]);
      await envDown(hub, wt);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 120_000);
});

describe('AC9 #331.b23ec100 a child agent in its own worktree can\'t use a port its parent leased', () => {
  it('AC9 with the parent\'s stack up on its leased port, `deep env up` in a child\'s own worktree gets another port, and the parent\'s stack still answers on its own', async () => {
    const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20 });
    const parent = t.worktree('parent');
    const hub = await startHub(sub(tempDir(), 'root'));
    try {
      const up = await upReady(hub, parent);
      const child = t.worktree('child');
      const mine = await upReady(hub, child);
      expect(mine.ports.web, `the child's worktree got its parent's port ${up.ports.web}`).not.toBe(up.ports.web);
      await serves(up.ports.web, parent, 'the parent\'s stack');
      await serves(mine.ports.web, child, 'the child\'s stack');
    } finally {
      await stopHub(hub);
    }
  }, 120_000);
});
