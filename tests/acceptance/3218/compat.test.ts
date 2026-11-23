// #3218 AC2, its second and third sentences: #237's acceptance tests pass unchanged, and a record written on the
// merge base folds with each lease at 1. (Its first sentence, a lease that names no units takes 1, is table.test.ts.)
//
// "Unchanged": tests/acceptance/237 is the merge base's, with nothing added. "Pass": that suite, run as it is, with
// its own README's command, exits 0 (its timing test reads INCONCLUSIVE as a skip off the reference Mac, as it always
// has). "A record written on the merge base": the merge base's own lease table (helpers.ts, baseTree) grants leases
// into a record, which is closed; the table as it ships opens that file, as the hub does at its start.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRecord } from '@deepbuild/record';
import type { Resource } from '@deepbuild/leases';
import { git, home, json, makeClock, mergeBase, NODE, REPO, session, tempDir } from './helpers.ts';
import { as, granted, holding, named, openBaseTable, openWorld, poolKind, readAll, slot, TEST_PLUGIN, unitsOf } from './world.ts';

const AC2 = '#3218.da893eed';

describe(`AC2 ${AC2} #237's tests pass unchanged, and a record written on the merge base folds with each lease at 1`, () => {
  it(`AC2 ${AC2} tests/acceptance/237 is unchanged from the merge base`, () => {
    const base = mergeBase();
    const changed = git('diff', '--name-only', base, '--', 'tests/acceptance/237').trim();
    const added = git('ls-files', '--others', '--exclude-standard', '--', 'tests/acceptance/237').trim();
    expect(changed, `files of #237's suite changed since the merge base ${base.slice(0, 9)}`).toBe('');
    expect(added, 'files added to #237\'s suite').toBe('');
  });

  it(`AC2 ${AC2} #237's acceptance tests pass, run as they are`, () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && !key.startsWith('GIT_')));
    const r = spawnSync(NODE, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', 'tests/acceptance/237', '--no-file-parallelism'], {
      cwd: REPO, env: { ...env, HOME: home(), NODE_ENV: 'test' }, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 1 << 28,
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replaceAll(home(), '~');
    console.log(`#237's suite (exit ${r.status ?? r.signal}): ${out.split('\n').filter((l) => /^\s*(Test Files|Tests)\s/.test(l)).map((l) => l.trim()).join('; ')}`);
    expect(r.status, `#237's suite exits 0; it exited ${r.status ?? r.signal}:\n${out.split('\n').slice(-80).join('\n')}`).toBe(0);
  }, 1_800_000);

  it(`AC2 ${AC2} a record written on the merge base's table folds with each lease at 1: a pool(4) holding three of its leases has room for one unit, not two`, async () => {
    const dir = tempDir();
    const clock = makeClock();
    const record = await openRecord({ path: join(dir, 'ledger.db'), now: clock.now });
    const four: Resource = { host: 'local', kind: 'test.four', key: 'k' };
    const written: string[] = [];
    try {
      const old = await openBaseTable(record, clock.now);
      await old.declare(TEST_PLUGIN, poolKind('test.four', 4));
      for (let i = 0; i < 3; i++) written.push(granted(await old.lease(as(session()), four, 'exclusive'), `the merge base's lease ${i + 1} on the pool(4)`).id);
      written.push(granted(await old.lease(as(session()), slot(), 'exclusive'), 'the merge base\'s lease on cpu.slot').id);
      const acquired = await readAll(record, 'lease.acquired');
      expect(acquired.map((e) => e.v), `the merge base wrote its version of lease.acquired, with no units: ${named(acquired)}`).toEqual([2, 2, 2, 2]);
    } finally {
      await record.close();
    }
    const w = await openWorld({ dir, clock });
    try {
      await w.declare(TEST_PLUGIN, poolKind('test.four', 4));
      const held = await holding(w.table);
      expect(held.map((l) => l.id).sort(), 'the table holds every lease the merge base wrote').toEqual([...written].sort());
      expect(held.map((l) => [l.resource.kind, l.units]), `each folds with 1 unit: ${json(held)}`).toEqual(held.map((l) => [l.resource.kind, 1]));
      const two = await w.table.lease(as(session()), four, 'exclusive', 2);
      expect(two.status === 'refused' && two.reason, `with three of the pool(4) held, 2 units are refused: ${json(two)}`).toBe('pool');
      if (two.status === 'refused') expect(two.holders.map((l) => l.id).sort(), 'naming the merge base\'s three leases').toEqual(written.slice(0, 3).sort());
      const one = granted(await w.table.lease(as(session()), four, 'exclusive', 1), 'with three of the pool(4) held, 1 unit');
      expect(unitsOf(one)).toBe(1);
    } finally {
      await w.close();
    }
  });
});
