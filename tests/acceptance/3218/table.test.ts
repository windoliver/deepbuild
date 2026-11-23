// #3218 AC1, AC2 (a lease that names no units), AC3, AC5 and AC6: a lease on a `pool(n)` kind takes k of its n, on
// the lease table through its public entry. Each scenario runs on the table as it ships and, where the criterion
// names one, on its planted wrong program (README, Wrong programs).
import { describe, expect, it } from 'vitest';
import type { LeaseKind, Plant, Resource } from '@deepbuild/leases';
import { json, session, within } from './helpers.ts';
import { as, granted, holding, MEM, mem, named, openWorld, poolKind, slot, TEST_PLUGIN, unitsOf } from './world.ts';

const AC1 = '#3218.8958c7b7';
const AC2 = '#3218.da893eed';
const AC3 = '#3218.86874d33';
const AC5 = '#3218.94bd049e';
const AC6 = '#3218.d49806d0';

async function thousand(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    await w.declare(TEST_PLUGIN, MEM);
    const [A, B, C] = [session(), session(), session()];
    const a = granted(await w.table.lease(as(A), mem(), 'exclusive', 400), 'the lease of 400 units');
    const b = granted(await w.table.lease(as(B), mem(), 'exclusive', 500), 'the lease of 500 units');
    const c = await w.table.lease(as(C), mem(), 'exclusive', 200);
    expect(c.status, `a third lease of 200 units, with 100 of the 1,000 free, is refused: ${json(c)}`).toBe('refused');
    if (c.status !== 'refused') throw Error('unreachable');
    expect(c.reason, 'refused as the pool has no room for it').toBe('pool');
    expect(c.message, 'the refusal names the pool').toContain('test.mem');
    expect(c.message, 'the refusal names the 100 units free').toMatch(/\b100\b/);
    expect(c.message, 'the refusal says they are free').toMatch(/free/i);
    expect(c.holders.map((l) => l.id).sort(), 'the refusal names the leases that fill the pool').toEqual([a.id, b.id].sort());
    expect([unitsOf(a), unitsOf(b)], 'each lease carries the units it asked for').toEqual([400, 500]);
    expect((await holding(w.table)).map((l) => [l.holder, l.units]), 'the table holds the two, with their units, and nothing for the third')
      .toEqual(expect.arrayContaining([[A, 400], [B, 500]]));
    expect((await holding(w.table)).some((l) => l.holder === C), 'the refused third holds nothing').toBe(false);
    // The 400 ends (its holder's session ended, and it has no process to prove gone): the 200 is granted.
    await w.endSession(A);
    await w.table.tick();
    expect((await holding(w.table)).map((l) => l.id), 'the 400 has ended').not.toContain(a.id);
    const again = granted(await w.table.lease(as(C), mem(), 'exclusive', 200), 'the third, 200 units, once the 400 has ended');
    expect(unitsOf(again), 'it carries its 200 units').toBe(200);
    expect((await holding(w.table)).filter((l) => l.resource.kind === 'test.mem').reduce((sum, l) => sum + (l.units ?? NaN), 0), 'the pool holds 700 of its 1,000').toBe(700);
  } finally {
    await w.close();
  }
}

describe(`AC1 ${AC1} a pool(1000) takes units`, () => {
  it(`AC1 ${AC1} leases of 400 and 500 units are granted, a third of 200 is refused naming the pool and the 100 free, and it is granted once the 400 has ended`, async () => {
    await thousand();
  });
  it(`AC1 ${AC1} (wrong program) a table that counts holders grants all three and fails this test`, async () => {
    await expect(thousand('counts-holders')).rejects.toThrow(/a third lease of 200 units, with 100 of the 1,000 free, is refused/);
  });
  it(`AC1 ${AC1} (wrong program) a table that treats the pool as one key refuses the second and fails this test`, async () => {
    await expect(thousand('pool-as-exact-key')).rejects.toThrow(/the lease of 500 units: expected a grant/);
  });
});

describe(`AC2 ${AC2} a lease that names no units takes 1`, () => {
  it(`AC2 ${AC2} with a pool(3), three leases that name no units are granted with 1 unit each and a fourth is refused; the record's lease.acquired@3 carries units 1; an exact kind's lease carries no units`, async () => {
    const w = await openWorld();
    try {
      const three: LeaseKind = poolKind('test.three', 3);
      await w.declare(TEST_PLUGIN, three);
      await w.declare(TEST_PLUGIN, { name: 'test.exact', match: 'exact', cap: 1000, cooldown: 0, cost: 0 });
      const res: Resource = { host: 'local', kind: 'test.three', key: 'k' };
      const leases = [];
      for (let i = 0; i < 3; i++) leases.push(granted(await w.table.lease(as(session()), res, 'exclusive'), `lease ${i + 1} of three that name no units`));
      expect(leases.map(unitsOf), 'each lease that names no units takes 1').toEqual([1, 1, 1]);
      const fourth = await w.table.lease(as(session()), res, 'exclusive');
      expect(fourth.status === 'refused' && fourth.reason, `a fourth on the pool(3) is refused as the pool is full: ${json(fourth)}`).toBe('pool');
      // An ask that names no units takes 1 too: here on cpu.slot, a pool the core declares.
      const asked = await w.table.ask(as(session()), [{ resource: slot(), mode: 'exclusive' }]);
      expect(asked.status, `an ask for one cpu.slot naming no units: ${json(asked)}`).toBe('granted');
      if (asked.status === 'granted') expect(asked.leases.map(unitsOf), 'it takes 1').toEqual([1]);
      // The event that records a pool's lease gains `units` under a new version.
      const acquired = (await w.events('lease.acquired')).filter((e) => (e.data as { resource?: Resource }).resource?.kind === 'test.three');
      expect(acquired.map((e) => [e.v, (e.data as { units?: number }).units]), `the record's lease.acquired for the three: ${named(acquired)}`).toEqual([[3, 1], [3, 1], [3, 1]]);
      // Units are only on a pool(n) kind's lease.
      const exact = granted(await w.table.lease(as(session()), { host: 'local', kind: 'test.exact', key: 'e1' }, 'exclusive'), 'a lease on an exact kind');
      expect(unitsOf(exact), `a lease on an exact kind carries no units: ${json(exact)}`).toBeUndefined();
    } finally {
      await w.close();
    }
  });
});

/** A call's outcome: granted, or refused / BLOCKED / rejected, with its words. */
async function outcome(p: Promise<{ status: string; message?: string }>): Promise<{ status: string; text: string }> {
  try {
    const r = await p;
    return { status: r.status, text: `${r.message ?? ''} ${json(r)}` };
  } catch (error) {
    return { status: 'rejected', text: (error as Error).message };
  }
}

async function tooBig(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    await w.declare(TEST_PLUGIN, MEM);
    const before = (await w.events()).length;
    const A = session();
    const answer = await within(w.table.lease(as(A), mem(), 'exclusive', 1200), 5000);
    if (answer === 'pending') expect.fail('an ask for 1,200 units of a pool of 1,000 is answered at once: no answer within 5 s');
    expect(answer.status, `an ask for 1,200 units of the pool(1000) is BLOCKED: ${json(answer)}`).toBe('BLOCKED');
    if (answer.status !== 'BLOCKED') throw Error('unreachable');
    expect(answer.reason, 'BLOCKED by the pool\'s size').toBe('size');
    expect(answer.message, 'it names the pool').toContain('test.mem');
    expect(answer.message, 'it names the pool\'s size, 1,000').toMatch(/\b1,?000\b/);
    // The same in an ask for several: BLOCKED whole, naming the pool.
    const several = await within(w.table.ask(as(A), [{ resource: slot(), mode: 'exclusive' }, { resource: mem(), mode: 'exclusive', units: 1200 }]), 5000);
    if (several === 'pending') expect.fail('an ask naming a cpu.slot and 1,200 units of the pool(1000) is answered at once: no answer within 5 s');
    expect(several.status, `an ask naming a cpu.slot and 1,200 units of the pool(1000) is BLOCKED: ${json(several)}`).toBe('BLOCKED');
    if (several.status !== 'BLOCKED') throw Error('unreachable');
    expect(several.reason).toBe('size');
    expect(several.resource, 'it names the pool as what couldn\'t be granted').toEqual(mem());
    expect(several.message).toMatch(/\b1,?000\b/);
    const appended = (await w.events()).slice(before);
    expect(appended, `nothing is appended for either: ${named(appended)}`).toEqual([]);
    expect((await holding(w.table)).filter((l) => l.holder === A), 'and nothing is held').toEqual([]);
  } finally {
    await w.close();
  }
}

describe(`AC3 ${AC3} an ask past the pool's size`, () => {
  it(`AC3 ${AC3} an ask for 1,200 units of the pool(1000) is BLOCKED at once, naming the pool's size`, async () => {
    await tooBig();
  });
  it(`AC3 ${AC3} (wrong program) a table that queues it never answers and fails this test`, async () => {
    await expect(tooBig('queues-past-size')).rejects.toThrow(/is answered at once: no answer within 5 s/);
  });
});

describe(`AC5 ${AC5} units on a kind that isn't a pool`, () => {
  const forms: { kind: LeaseKind; key: string }[] = [
    { kind: { name: 'test.exact', match: 'exact', cap: 1000, cooldown: 0, cost: 0 }, key: 'rig-1' },
    { kind: { name: 'test.glob', match: 'glob', cap: 1000, cooldown: 0, cost: 0 }, key: 'src/**' },
    { kind: { name: 'test.prefix', match: 'prefix', cap: 1000, cooldown: 0, cost: 0 }, key: 'doc.fig' },
  ];
  for (const { kind, key } of forms) {
    it(`AC5 ${AC5} units on ${kind.name}, matched by ${kind.match}, are refused naming the kind, alone and in an ask for several`, async () => {
      const w = await openWorld();
      try {
        await w.declare(TEST_PLUGIN, kind);
        const res: Resource = { host: 'local', kind: kind.name, key };
        const A = session();
        const before = (await w.events()).length;
        const alone = await outcome(w.table.lease(as(A), res, 'exclusive', 2));
        expect(alone.status, `a lease of 2 units on ${kind.name} (${kind.match}) is refused: ${alone.text}`).not.toBe('granted');
        expect(alone.text, `the refusal names the kind ${kind.name}`).toContain(kind.name);
        const inAsk = await outcome(w.table.ask(as(A), [{ resource: slot(), mode: 'exclusive' }, { resource: res, mode: 'exclusive', units: 2 }]));
        expect(inAsk.status, `an ask naming a cpu.slot and 2 units on ${kind.name} is refused whole: ${inAsk.text}`).not.toBe('granted');
        expect(inAsk.text, `the refusal names the kind ${kind.name}`).toContain(kind.name);
        const appended = (await w.events()).slice(before);
        expect(appended, `nothing is appended: ${named(appended)}`).toEqual([]);
        expect((await holding(w.table)).filter((l) => l.holder === A), 'nothing is held').toEqual([]);
        // The same lease naming no units is granted, with none.
        const plain = granted(await w.table.lease(as(A), res, 'exclusive'), `a lease on ${kind.name} naming no units`);
        expect(unitsOf(plain), 'it carries no units').toBeUndefined();
      } finally {
        await w.close();
      }
    });
  }
});

async function twoHosts(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    await w.declare(TEST_PLUGIN, MEM);
    const [A, B, C] = [session(), session(), session()];
    const a = granted(await w.table.lease(as(A), mem('local'), 'exclusive', 1000), '1,000 units on local');
    const b = granted(await w.table.lease(as(B), mem('h2'), 'exclusive', 1000), '1,000 units on h2');
    expect([unitsOf(a), unitsOf(b)], 'each carries its 1,000 units').toEqual([1000, 1000]);
    expect([a.resource.host, b.resource.host]).toEqual(['local', 'h2']);
    for (const [host, holder] of [['local', a], ['h2', b]] as const) {
      const more = await w.table.lease(as(C), mem(host), 'exclusive', 1);
      expect(more.status === 'refused' && more.reason, `one unit more on ${host} is refused as that host's pool is full: ${json(more)}`).toBe('pool');
      if (more.status !== 'refused') throw Error('unreachable');
      expect(more.message, `the refusal names the pool on ${host}`).toContain(host);
      expect(more.holders.map((l) => l.id), `only ${host}'s lease fills ${host}'s pool`).toEqual([holder.id]);
    }
  } finally {
    await w.close();
  }
}

describe(`AC6 ${AC6} a pool counts on each host`, () => {
  it(`AC6 ${AC6} with the pool(1000) on local and on a test host h2, 1,000 units are granted on each`, async () => {
    await twoHosts();
  });
  it(`AC6 ${AC6} (wrong program) a table that sums across hosts refuses the second and fails this test`, async () => {
    await expect(twoHosts('pool-across-hosts')).rejects.toThrow(/1,000 units on h2: expected a grant/);
  });
});
