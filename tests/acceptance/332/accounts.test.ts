// #332 AC2, the account half: test accounts are leased per session. Two agents, each with its own Claude Code
// session in its own worktree of one repo, run `deep env up` through their Bash tool (agents.ts). The environment
// names the account pool (`leases: { SHOP_ACCOUNT: { kind: account, keys: [...] } }`, README); a stack gets its
// session's account in SHOP_ACCOUNT (fixtures/server.mjs, GET /env), and the record holds each account lease
// (lease.acquired@1, resource kind `account`) under its session. With session A holding shop-test-1, session B gets
// another account or is BLOCKED naming A's lease, and its stack never starts with shop-test-1. The cap half is in
// budgets.test.ts.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { namesLease, sessionIn } from './agents.ts';
import {
  cleanup, Client, get, given, holderIs, home, jsonOut, leaseEvents, makeRepo, mustBeReady, READY, serverUp, startHub, stopHub, waitFor, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe('AC2 #332.895dd0e2 with session A holding `shop-test-1`, session B\'s `deep env up` gets another account or is BLOCKED, naming A\'s lease, and never starts with `shop-test-1`', () => {
  it('AC2 with shop-test-1 the only account, session A\'s stack gets it under A\'s lease, and session B\'s deep env up is BLOCKED naming A\'s lease, or comes up with another account, never shop-test-1', async () => {
    const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { SHOP_ACCOUNT: { kind: 'account', keys: ['shop-test-1'] } } });
    const a = t.worktree('wt-a');
    const b = t.worktree('wt-b');
    const hub = await startHub(join(home(), '.deepbuild'));
    const client = await Client.open(hub);
    try {
      const A = await sessionIn(hub, a);
      const upA = mustBeReady(await A.agent.env(hub, A.s, 'up'), a);
      const envA = await given(upA.ports.web as number, 'session A\'s stack');
      expect(envA.SHOP_ACCOUNT, `session A's stack was given its leased account in SHOP_ACCOUNT (${JSON.stringify(envA)})`).toBe('shop-test-1');
      const leaseA = leaseEvents(await client.events(), 'lease.acquired', 'account', 'shop-test-1')[0];
      expect(leaseA, 'the record holds the lease on account shop-test-1 (lease.acquired, resource kind account)').toBeDefined();
      expect(holderIs(leaseA!.data.holder, A.s.id), `the lease on shop-test-1 is session A's (${A.s.id}); holder ${JSON.stringify(leaseA!.data.holder)}`).toBe(true);

      const B = await sessionIn(hub, b);
      const ranB = await B.agent.env(hub, B.s, 'up');
      const outB = jsonOut(ranB);
      if (outB?.status === 'ready') {
        const envB = await given(outB.ports.web as number, 'session B\'s stack');
        expect(envB.SHOP_ACCOUNT, 'session B\'s stack started with shop-test-1, which session A holds').not.toBe('shop-test-1');
        expect(typeof envB.SHOP_ACCOUNT === 'string' && envB.SHOP_ACCOUNT.length > 0, `session B's stack, up, has an account of its own (${JSON.stringify(envB)})`).toBe(true);
      } else {
        expect(outB?.status, `session B's deep env up is BLOCKED (${ranB.stdout} ${ranB.stderr})`).toBe('BLOCKED');
        expect(ranB.code, 'BLOCKED exits 3').toBe(3);
        expect(namesLease(outB?.cause, leaseA, A.s), `the cause names session A's lease on shop-test-1 (cause: ${JSON.stringify(outB?.cause)}; lease ${JSON.stringify(leaseA)})`).toBe(true);
      }
      const events = await client.events();
      const toB = leaseEvents(events, 'lease.acquired', 'account', 'shop-test-1').filter((e) => holderIs(e.data.holder, B.s.id));
      expect(toB.map((e) => e.data), 'shop-test-1 was never leased to session B').toEqual([]);
      expect(leaseEvents(events, 'lease.released', 'account', 'shop-test-1').map((e) => e.data), 'session A\'s lease on shop-test-1 still holds').toEqual([]);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 240_000);

  it('AC2 with two accounts, sessions A and B each get one of their own, each leased to its session, and A\'s down ends only A\'s', async () => {
    const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { SHOP_ACCOUNT: { kind: 'account', keys: ['shop-test-1', 'shop-test-2'] } } });
    const a = t.worktree('wt-a');
    const b = t.worktree('wt-b');
    const hub = await startHub(join(home(), '.deepbuild'));
    const client = await Client.open(hub);
    try {
      const A = await sessionIn(hub, a);
      const B = await sessionIn(hub, b);
      const upA = mustBeReady(await A.agent.env(hub, A.s, 'up'), a);
      const upB = mustBeReady(await B.agent.env(hub, B.s, 'up'), b);
      const accA = (await given(upA.ports.web as number, 'session A\'s stack')).SHOP_ACCOUNT as unknown;
      const accB = (await given(upB.ports.web as number, 'session B\'s stack')).SHOP_ACCOUNT as unknown;
      expect(['shop-test-1', 'shop-test-2'], `session A's stack got an account from the pool in SHOP_ACCOUNT (${JSON.stringify(accA)})`).toContain(accA);
      expect(['shop-test-1', 'shop-test-2'], `session B's stack got an account from the pool in SHOP_ACCOUNT (${JSON.stringify(accB)})`).toContain(accB);
      expect(accB, 'sessions A and B were given the same account').not.toBe(accA);

      // The file's tests share one HOME and hub record, so only this test's sessions' leases are read.
      const ours = (e: Line): boolean => holderIs(e.data.holder, A.s.id) || holderIs(e.data.holder, B.s.id);
      const events = await client.events();
      const leaseOf = (key: string): Line | undefined => leaseEvents(events, 'lease.acquired', 'account', key).find(ours);
      expect(holderIs(leaseOf(accA as string)?.data.holder, A.s.id), `A's account ${String(accA)} is leased to session A (${JSON.stringify(leaseOf(accA as string)?.data)})`).toBe(true);
      expect(holderIs(leaseOf(accB as string)?.data.holder, B.s.id), `B's account ${String(accB)} is leased to session B (${JSON.stringify(leaseOf(accB as string)?.data)})`).toBe(true);

      const downA = await A.agent.env(hub, A.s, 'down');
      expect(downA.code, `session A's deep env down exits 0 (${downA.stdout} ${downA.stderr})`).toBe(0);
      await waitFor(async () => leaseEvents(await client.events(), 'lease.released', 'account', accA as string).filter(ours).length > 0, 15_000, `the lease on ${String(accA)} to end after A's down`);
      expect(leaseEvents(await client.events(), 'lease.released', 'account', accB as string).filter(ours).map((e) => e.data), `session B's lease on ${String(accB)} still holds`).toEqual([]);
      expect((await get(upB.ports.web as number, '/health')).status, 'session B\'s stack still answers').toBe(200);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 240_000);
});
