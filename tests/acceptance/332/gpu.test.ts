// #332 AC7: a GPU is leased to one session at a time, like a port or a test account. The environment names one GPU
// (`leases: { GPU: { kind: gpu, keys: [gpu-0] } }`, README). Session A's stack gets it in GPU under A's lease;
// session B's `deep env up` is BLOCKED naming A's lease, or comes up without gpu-0, never sharing it; once A's
// stack is down and its lease has ended, B's next up gets gpu-0 under B's lease.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { namesLease, sessionIn } from './agents.ts';
import { cleanup, Client, given, holderIs, home, jsonOut, leaseEvents, makeRepo, mustBeReady, READY, serverUp, startHub, stopHub, waitFor } from './helpers.ts';

afterEach(cleanup, 60_000);

describe('AC7 #332.e24a8c75 a GPU is leased to one session at a time, like a port or a test account', () => {
  it('AC7 with session A holding gpu-0, session B never starts with it; after A\'s down ends A\'s lease, B gets gpu-0 under a lease of its own', async () => {
    const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { GPU: { kind: 'gpu', keys: ['gpu-0'] } } });
    const a = t.worktree('wt-a');
    const b = t.worktree('wt-b');
    const hub = await startHub(join(home(), '.deepbuild'));
    const client = await Client.open(hub);
    try {
      const A = await sessionIn(hub, a);
      const B = await sessionIn(hub, b);
      const upA = mustBeReady(await A.agent.env(hub, A.s, 'up'), a);
      const envA = await given(upA.ports.web as number, 'session A\'s stack');
      expect(envA.GPU, `session A's stack was given its leased GPU in GPU (${JSON.stringify(envA)})`).toBe('gpu-0');
      const leaseA = leaseEvents(await client.events(), 'lease.acquired', 'gpu', 'gpu-0')[0];
      expect(leaseA, 'the record holds the lease on gpu-0 (lease.acquired, resource kind gpu)').toBeDefined();
      expect(holderIs(leaseA!.data.holder, A.s.id), `the lease on gpu-0 is session A's (${A.s.id}); holder ${JSON.stringify(leaseA!.data.holder)}`).toBe(true);

      // B, while A holds it.
      const ranB = await B.agent.env(hub, B.s, 'up');
      const outB = jsonOut(ranB);
      if (outB?.status === 'ready') {
        const envB = await given(outB.ports.web as number, 'session B\'s stack');
        expect(envB.GPU, 'session B\'s stack started with gpu-0 while session A holds it').not.toBe('gpu-0');
        const down = await B.agent.env(hub, B.s, 'down');
        expect(down.code, `session B's deep env down exits 0 (${down.stdout} ${down.stderr})`).toBe(0);
      } else {
        expect(outB?.status, `session B's deep env up is BLOCKED (${ranB.stdout} ${ranB.stderr})`).toBe('BLOCKED');
        expect(namesLease(outB?.cause, leaseA, A.s), `the cause names session A's lease on gpu-0 (cause: ${JSON.stringify(outB?.cause)})`).toBe(true);
      }
      expect(leaseEvents(await client.events(), 'lease.acquired', 'gpu', 'gpu-0').filter((e) => holderIs(e.data.holder, B.s.id)).map((e) => e.data), 'gpu-0 was leased to session B while session A held it').toEqual([]);

      // A lets go; B gets it.
      const downA = await A.agent.env(hub, A.s, 'down');
      expect(downA.code, `session A's deep env down exits 0 (${downA.stdout} ${downA.stderr})`).toBe(0);
      await waitFor(async () => leaseEvents(await client.events(), 'lease.released', 'gpu', 'gpu-0').length > 0, 15_000, 'the lease on gpu-0 to end after A\'s down');
      const upB = mustBeReady(await B.agent.env(hub, B.s, 'up'), b);
      expect((await given(upB.ports.web as number, 'session B\'s stack')).GPU, 'session B\'s stack, after A let go, was given gpu-0').toBe('gpu-0');
      const leases = leaseEvents(await client.events(), 'lease.acquired', 'gpu', 'gpu-0');
      expect(leases.length, 'gpu-0 was leased twice: to A, then to B').toBe(2);
      expect(holderIs(leases[1]!.data.holder, B.s.id), `the second lease on gpu-0 is session B's; holder ${JSON.stringify(leases[1]!.data.holder)}`).toBe(true);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 240_000);
});
