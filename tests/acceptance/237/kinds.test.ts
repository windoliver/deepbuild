// #237 AC3 and AC4: resource kinds are lease.kind@1 data. The match forms are closed; a kind's name belongs to the
// plug-in that declared it first; and a plug-in's own kind leases with no change to env-local or the kernel: the
// test plug-in reaches the table only through `declare` and `lease`, and env-local isn't loaded at all.
import { afterEach, describe, expect, it } from 'vitest';
import type { LeaseKind, Plant } from '../../../packages/leases/src/index.ts';
import { cleanup, json, session } from './helpers.ts';
import { as, granted, openWorld, refusedNaming } from './world.ts';

afterEach(cleanup);

const kind = (name: string, match: string): LeaseKind => ({ name, match, cap: 10, cooldown: 0, cost: 0 });
const refusal = (p: Promise<unknown>): Promise<Error | undefined> => p.then(() => undefined, (e: unknown) => (e instanceof Error ? e : Error(String(e))));

async function closedForms(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    // The four forms are declared.
    for (const [name, match] of [['test.exact', 'exact'], ['test.glob', 'glob'], ['test.prefix', 'prefix'], ['test.pool', 'pool(3)']] as const) {
      const e = await refusal(w.table.declare('test-forms', kind(name, match)));
      expect(e?.message, `a kind matched by ${match} is declared`).toBeUndefined();
    }
    // A planted regex is refused when it's declared, naming the form.
    const e = await refusal(w.table.declare('test-planted', kind('test.regex', 'regex')));
    expect(e, 'a kind whose match form is regex is refused when it is declared').toBeInstanceOf(Error);
    expect(e!.message, 'the refusal names the form').toContain('regex');
    expect((await w.table.kinds()).map((k) => k.name), 'the refused kind is not declared').not.toContain('test.regex');
    const leased = await w.table.lease(as(session()), { host: 'local', kind: 'test.regex', key: 'a.*' }, 'exclusive').catch((err: Error) => ({ status: 'threw', message: err.message }));
    expect(leased.status, `a lease on the refused kind: ${json(leased)}`).not.toBe('granted');
  } finally {
    await w.close();
  }
}

async function firstDeclarerHoldsTheName(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    await w.table.declare('test-first', kind('test.dup', 'exact'));
    const e = await refusal(w.table.declare('test-second', kind('test.dup', 'prefix')));
    expect(e, 'a second declaration of test.dup is refused').toBeInstanceOf(Error);
    expect(e!.message, 'the refusal names the plug-in that holds test.dup').toContain('test-first');
    expect((await w.table.kinds()).find((k) => k.name === 'test.dup'), 'test.dup stays the first plug-in\'s').toMatchObject({ plugin: 'test-first', match: 'exact' });
    // The core's own kind is held the same way.
    const core = await refusal(w.table.declare('test-second', kind('cpu.slot', 'exact')));
    expect(core, 'a plug-in declaring cpu.slot again is refused').toBeInstanceOf(Error);
    expect(core!.message, 'the refusal names the core, which holds cpu.slot').toMatch(/\bcore\b/);
  } finally {
    await w.close();
  }
}

describe('AC3 #237.bbccc379 the match forms are closed and a kind name has one owner', () => {
  it('AC3 a lease.kind@1 entry whose match form is a planted regex is refused when it\'s declared, naming the form', async () => {
    await closedForms();
  });
  it('AC3 a second declaration of a kind name already declared is refused, naming the plug-in that holds it', async () => {
    await firstDeclarerHoldsTheName();
  });
  it('AC3 (wrong program) a table that takes any match form declares the regex and fails this test', async () => {
    await expect(closedForms('any-match-form')).rejects.toThrow(/a kind whose match form is regex is refused when it is declared/);
  });
  it('AC3 (wrong program) a table whose later declaration replaces the first fails this test', async () => {
    await expect(firstDeclarerHoldsTheName('redeclare-replaces')).rejects.toThrow(/a second declaration of test.dup is refused/);
  });
});

async function rigs(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    const declared = await refusal(w.table.declare('test-rig', { name: 'device.rig', match: 'exact', cap: 4, cooldown: 0, cost: 0 }));
    if (declared) throw Error(`the first lease of a device.rig can't be had: declaring it was refused: ${declared.message}`);
    const rig = (key: string) => ({ host: 'local', kind: 'device.rig', key });
    const [A, B] = [session(), session()];
    const a = granted(await w.table.lease(as(A), rig('rig-1'), 'exclusive'), 'the first lease of a device.rig, A\'s rig-1');
    refusedNaming(await w.table.lease(as(B), rig('rig-1'), 'exclusive'), a, 'B\'s lease on rig-1 while A holds it');
    granted(await w.table.lease(as(B), rig('rig-2'), 'exclusive'), 'B\'s lease on rig-2');
    // A's session ends, with no process to prove gone: rig-1 goes to the next session.
    await w.endSession(A);
    await w.table.tick();
    granted(await w.table.lease(as(B), rig('rig-1'), 'exclusive'), 'B\'s lease on rig-1 once A has ended');
  } finally {
    await w.close();
  }
}

describe('AC4 #237.64161c59 a plug-in\'s own kind, with no change to env-local or the kernel', () => {
  it('AC4 a test plug-in that declares device.rig as an exact kind gets rigs leased to one session at a time', async () => {
    await rigs();
  });
  it('AC4 (wrong program) a table with a fixed list of resources refuses its first lease and fails this test', async () => {
    await expect(rigs('fixed-kinds')).rejects.toThrow(/the first lease of a device.rig/);
  });
});
