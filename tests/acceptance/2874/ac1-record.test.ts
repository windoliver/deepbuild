// AC1 #2874.177fc2d6: on a checkout made under umask 002, where git writes contracts/fixtures/R1/* as 664,
// `node scripts/contract-diff.mjs record --release R1` installs and loads R1's fixture package and pins the committed
// digest its deepbuild.json carries, d1:68bb6bf2…, as it does on a umask 022 checkout (644).
//
// Two clones of one scratch repository of this checkout's contract data (helpers.ts `source`), one made under umask 022
// and one under 002, each checked to hold R1's fixture as git writes it there (644, 664). The step runs on each under
// that checkout's umask, as on a machine whose default it is. The committed digest is the `digest` field of the
// fixture's deepbuild.json as checked out, read before the step runs (d1:68bb6bf21e48… at the base). "Loads" is read
// from what the step records of the fixture's calls, contracts/fixtures/R1/recorded.json, which must equal the umask
// 022 checkout's. At the base the umask 002 record fails with the issue's line (BASE-FAILURE.txt).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE, MINUTES, checkout, expectRecorded, pinOf, readIf, readJson, shown, source, step } from './helpers.ts';

describe('#2874 the contract step records R1 on a umask 002 checkout', () => {
  it('#2874.177fc2d6 AC1 on a umask 002 checkout, where git writes R1\'s fixture as 664, record --release R1 installs and loads R1\'s fixture package and pins the committed digest its deepbuild.json carries, as it does on a umask 022 checkout (644)', async () => {
    const repo = source('ac1');
    const reference = checkout(repo, '022', 'ac1-022');
    const spark = checkout(repo, '002', 'ac1-002');
    const committed: string = readJson(join(spark, FIXTURE, 'deepbuild.json')).digest;

    const at022 = await step('022', ['record', '--release', 'R1'], reference);
    expectRecorded(at022, 'on the umask 022 checkout');
    expect(pinOf(reference), `the umask 022 checkout pins the committed digest its deepbuild.json carries\n${shown(at022)}`).toBe(committed);

    const at002 = await step('002', ['record', '--release', 'R1'], spark);
    expectRecorded(at002, 'on the umask 002 checkout');
    expect(pinOf(spark), `the umask 002 checkout pins the committed digest its deepbuild.json carries, ${committed}\n${shown(at002)}`).toBe(committed);
    expect(readIf(join(spark, FIXTURE, 'recorded.json')), 'what R1\'s fixture package returned when loaded on the umask 002 checkout, as on the umask 022 one').toEqual(readIf(join(reference, FIXTURE, 'recorded.json')));
  }, 10 * MINUTES);
});
