// A held stop's fast-lane check takes the next free `cpu.slot` ahead of every queued slow run (#907): while one waits,
// slow runs and heavy commands ask the lease table for no slot, so the slot that frees goes to it. The real lease table
// on the real record at 4 cores (a pool of 2).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRecord } from '../../record/src/index.ts';
import { openLeases, type LeaseTable } from '../../leases/src/index.ts';
import { slot } from '../src/index.ts';
import { tempDir907 } from '../../../tests/acceptance/907/helpers.ts';

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

describe('#907 a fast-lane check takes the next free slot ahead of queued slow runs', () => {
  it('while a fast-lane check waits, a waiting slow run asks for no slot, and the slot that frees goes to the fast one', async () => {
    const record = await openRecord({ path: join(tempDir907(), 'ledger.db'), now: Date.now });
    const real = await openLeases({ record, now: Date.now, cores: 4 });
    // Each request the table sees, by holder and when.
    const asked: { holder: string; at: number }[] = [];
    const table: LeaseTable = new Proxy(real, {
      get: (target, key) => (key === 'lease' ? (...args: Parameters<LeaseTable['lease']>) => { asked.push({ holder: args[0].holder, at: Date.now() }); return target.lease(...args); } : Reflect.get(target, key)),
    });
    try {
      // The pool of 2 is full: a slow journey holds the one slow work may, a fast-lane check the one kept for it.
      const journey = await slot(table, 'session:journey', 'run:J', 'slow');
      const quick = await slot(table, 'session:quick', 'run:Q', 'fast');
      const slowWaits = slot(table, 'session:e2e', 'run:E', 'slow');
      await sleep(200);
      const fastWaits = slot(table, 'session:typecheck', 'run:T', 'fast');
      const waiting = Date.now();
      await sleep(400);
      // A request the slow run had in flight as the fast one began waiting is allowed for; none after it.
      const slowAsked = asked.filter((a) => a.holder === 'session:e2e' && a.at > waiting + 60);
      expect(slowAsked.length, `the waiting slow run asked for a slot ${slowAsked.length} times while the fast-lane check waited; it must ask for none, so the next free slot goes to the fast one`).toBe(0);
      await real.release(journey.id, []);
      const typecheck = await Promise.race([fastWaits, sleep(3000).then(() => null)]);
      expect(typecheck?.holder, 'the slot that freed went to the fast-lane check').toBe('session:typecheck');
      // Once no fast-lane check waits, the slow run takes the next slot that frees.
      await real.release(quick.id, []);
      const e2e = await Promise.race([slowWaits, sleep(3000).then(() => null)]);
      expect(e2e?.holder, 'then the slow run gets its slot').toBe('session:e2e');
    } finally {
      await record.close();
    }
  }, 30_000);
});
