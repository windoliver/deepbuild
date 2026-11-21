// AC2 #2874.1637d9b1: the pinned digest names the committed bytes on every checkout, whatever its umask: a release
// recorded on a umask 022 checkout passes `node scripts/contract-diff.mjs old-load` on a umask 002 checkout of the same
// files, and one recorded under umask 002 passes under umask 022.
//
// One test per direction. The release is recorded with `record --release R1` on a clone made under one umask, committed
// there as a release is, and the clone of that commit made under the other umask is the checkout of the same files;
// `old-load`, as the criterion writes it (the candidate is the step's default), runs there under its umask. At the base,
// the umask 002 checkout's old-load fails on the fixture's digest and its install, and the umask 002 record fails
// before any old-load (BASE-FAILURE.txt).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE, MINUTES, checkout, commitAll, expectRecorded, failLines, inconclusive, readJson, shown, source, step, type Ran } from './helpers.ts';

/** Asserts old-load passed on a checkout holding R1's release, and called each stable method R1's record lists. */
function expectOldLoadPasses(r: Ran, root: string, what: string): void {
  const release = join(root, 'contracts/releases/R1.json');
  if (!existsSync(release) || !existsSync(join(root, FIXTURE, 'recorded.json'))) inconclusive(`${root} doesn't hold R1's recorded release, so ${what} has nothing to load`);
  const calls: string[] = readJson(release).fixture?.calls ?? [];
  expect(failLines(r), `${what}: no FAIL contracts line\n${shown(r)}`).toEqual([]);
  expect(r.code, `${what}: exits 0\n${shown(r)}`).toBe(0);
  expect(r.out, `${what}: prints a PASS contracts line\n${shown(r)}`).toMatch(/^PASS contracts/m);
  for (const method of calls) expect(r.out, `${what}: R1's fixture called ${method}, a stable method R1 lists\n${shown(r)}`).toContain(method);
}

describe('#2874 a release pinned on a checkout of one umask loads on a checkout of the other', () => {
  it('#2874.1637d9b1 AC2 a release recorded on a umask 022 checkout passes old-load on a umask 002 checkout of the same files', async () => {
    const reference = checkout(source('ac2-from022'), '022', 'ac2-from022-022');
    const recorded = await step('022', ['record', '--release', 'R1'], reference);
    expectRecorded(recorded, 'on the umask 022 checkout');
    commitAll(reference, '022', 'Record R1');
    const spark = checkout(reference, '002', 'ac2-from022-002');
    expectOldLoadPasses(await step('002', ['old-load'], spark), spark, 'old-load on a umask 002 checkout of R1 recorded under umask 022');
  }, 10 * MINUTES);

  it('#2874.1637d9b1 AC2 a release recorded on a umask 002 checkout passes old-load on a umask 022 checkout of the same files', async () => {
    const spark = checkout(source('ac2-from002'), '002', 'ac2-from002-002');
    const recorded = await step('002', ['record', '--release', 'R1'], spark);
    expectRecorded(recorded, 'on the umask 002 checkout');
    commitAll(spark, '002', 'Record R1');
    const reference = checkout(spark, '022', 'ac2-from002-022');
    expectOldLoadPasses(await step('022', ['old-load'], reference), reference, 'old-load on a umask 022 checkout of R1 recorded under umask 002');
  }, 10 * MINUTES);
});
