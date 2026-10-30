// #331's AC9, the session half: a child session (an agent another agent started, in a worktree of its own; #18 records
// it as session.child_started@1 naming parent and child) asking for its stack through `deep_env` in `deep mcp` (#26)
// gets none of the ports its parent session leased, its stack comes up on a port of its own while the parent's keeps
// answering, the record holds both leases under different holders, and taking its own stack down leaves the
// parent's lease and stack alone. The worktree half, through `deep env up`, is in stacks.test.ts. Blind redraft of
// blocked.test.ts, October 28, 2026 (README, header and AC9).
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent, type Outcome } from './agents.ts';
import { cleanup, Client, health, home, makeRepo, portEvents, proc, READY, releasePorts, serverUp, startHub, stopHub, waitFor, type Line } from './helpers.ts';

afterEach(async () => { await releasePorts(); await cleanup(); }, 60_000);

/** The stack answers its health route on the port, from the folder named. */
async function serves(port: number, folder: string, what: string): Promise<void> {
  const h = await health(port);
  expect(h.status, `${what}: GET /health on 127.0.0.1:${port} answers 200 (${h.error ?? h.status})`).toBe(200);
  expect(h.body?.cwd, `${what}: the stack on ${port} was started in ${folder}`).toBe(folder);
}
/** A `deep_env` up that must come up: not an error, status ready, in the worktree, with a port for web. */
function ready(o: Outcome, worktree: string, what: string): Line {
  expect(o.isError, `${what}: deep_env up succeeds: ${JSON.stringify(o.reply).slice(0, 1500)}`).toBe(false);
  const v = o.value as Line;
  expect(v?.status, `${what}: deep_env up reports ready: ${JSON.stringify(v)}`).toBe('ready');
  expect(v?.worktree, `${what}: the stack is the session's worktree's`).toBe(worktree);
  expect(Number.isInteger(v?.ports?.web), `${what}: it names the port it leased for web (${JSON.stringify(v?.ports)})`).toBe(true);
  return v;
}
/** Whether a session: handle names the session (Claude Code's IDs are UUIDs; a handle's ID may drop their dashes). */
const names = (handle: unknown, id: string): boolean => typeof handle === 'string' && handle.replace(/-/g, '') === `session:${id.replace(/-/g, '')}`;

describe('AC9 #331.b23ec100 a child agent in its own worktree can\'t use a port its parent leased', () => {
  it('AC9 a child session started in its own worktree, calling deep_env through deep mcp, gets none of the ports its parent session leased: its stack comes up on a port of its own while the parent\'s still answers, the record holds both leases under different holders, and its down leaves the parent\'s lease held', async () => {
    const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20 });
    const a = t.worktree('parent');
    // The hub at the home's default root, where the agents' `deep mcp` finds it.
    const hub = await startHub(join(home(), '.deepbuild'));
    const client = await Client.open(hub);
    const parent = Agent.start(a);
    try {
      // The parent: a Claude Code session in worktree A, its deep mcp its child.
      const sa = parent.session(a);
      await parent.establish(hub, sa);
      await parent.initialize();
      const tools = await parent.tools();
      expect(tools, `deep mcp lists deep_env, the Environment and lease block's tool (tools: ${tools.join(', ')})`).toContain('deep_env');
      const upA = ready(await parent.deepEnv(hub, sa, { action: 'up' }), a, 'the parent');
      const portA = upA.ports.web as number;
      const parentPorts = Object.values(upA.ports as Record<string, number>);
      await serves(portA, a, 'the parent\'s stack');

      // The child: an agent the parent's process starts, in a worktree of its own made after the parent's stack came up.
      const b = t.worktree('child');
      const child = await parent.spawnChild(b);
      const tree = proc(child.pid);
      if (tree?.ppid !== parent.pid) throw Error(`BLOCKED: the child agent ${child.pid} isn't a child process of the parent agent ${parent.pid} (${JSON.stringify(tree)})`);
      const sb = child.session(b);
      await child.establish(hub, sb);
      const linked = await waitFor(async () => (await client.events('session.child_started')).find((e) => names(e.data?.parent, sa.id) && names(e.data?.child, sb.id)), 15_000, `session.child_started naming parent ${sa.id} and child ${sb.id}`).catch(() => undefined);
      expect(linked, `the record links the child session ${sb.id} to its parent ${sa.id} (session.child_started@1 with parent and child); found: ${JSON.stringify((await client.events('session.child_started')).map((e) => e.data))}`).toBeDefined();
      await child.initialize();

      // The child's deep_env: a port of its own, never one of the parent's, and both stacks answer.
      const upB = ready(await child.deepEnv(hub, sb, { action: 'up' }), b, 'the child');
      const portB = upB.ports.web as number;
      for (const port of Object.values(upB.ports as Record<string, number>)) {
        expect(parentPorts, `the child session was leased ${port}, a port its parent session leased (parent ${JSON.stringify(upA.ports)}, child ${JSON.stringify(upB.ports)})`).not.toContain(port);
      }
      expect(upB.run, 'the child\'s stack is a run of its own').not.toBe(upA.run);
      await serves(portB, b, 'the child\'s stack');
      await serves(portA, a, 'the parent\'s stack, with the child\'s up');

      // The record: both leases, each under its own holder.
      const acquired = await client.events('lease.acquired');
      const leaseA = portEvents(acquired, 'lease.acquired', portA)[0];
      const leaseB = portEvents(acquired, 'lease.acquired', portB)[0];
      expect(leaseA, `the lease table recorded the parent's port ${portA} (lease.acquired, resource kind port)`).toBeDefined();
      expect(leaseB, `the lease table recorded the child's port ${portB} (lease.acquired, resource kind port)`).toBeDefined();
      expect(leaseA!.data.holder, 'the parent\'s lease names a holder').toBeTruthy();
      expect(leaseB!.data.holder, 'the child\'s lease names a holder').toBeTruthy();
      expect(leaseB!.data.holder, `the child's lease on ${portB} has its parent's holder (${JSON.stringify(leaseA!.data.holder)}): a child in a worktree of its own takes its own leases`).not.toEqual(leaseA!.data.holder);

      // The child's down takes its own stack and nothing of the parent's.
      const downB = await child.deepEnv(hub, sb, { action: 'down' });
      expect(downB.isError, `the child's deep_env down succeeds: ${JSON.stringify(downB.reply).slice(0, 1500)}`).toBe(false);
      await waitFor(async () => (await health(portB)).status === null, 10_000, `the child's stack on ${portB} to be gone`);
      await serves(portA, a, 'the parent\'s stack, after the child\'s down');
      expect(portEvents(await client.events('lease.released'), 'lease.released', portA).map((e) => e.data), `the parent's lease on ${portA} ended with the child's down`).toEqual([]);

      // The parent's own down ends it.
      const downA = await parent.deepEnv(hub, sa, { action: 'down' });
      expect(downA.isError, `the parent's deep_env down succeeds: ${JSON.stringify(downA.reply).slice(0, 1500)}`).toBe(false);
      await waitFor(async () => (await health(portA)).status === null, 10_000, `the parent's stack on ${portA} to be gone`);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 240_000);
});
