// AC3 #2874.a254fb4c: a fixture file git records as executable (755, written 775 under umask 002) is pinned as 755:
// the same digest under either umask, and a different one than the same bytes not executable.
//
// Two scratch repositories of this checkout's contract data: one with R1's fixture as committed (every file 100644),
// one with the same bytes and its index.ts committed executable (100755), deepbuild.json stamped as a build stamps a
// package: the extension host's `packageDigest` (its public entry) of the folder at the modes git records. The
// executable one is recorded on a clone made under umask 022 (index.ts 755) and on one made under 002 (775); the other
// on a clone made under 002 (664). "Pinned as 755" is the pin equal to that stamp. At the base the umask 002 record of
// the executable one fails, its files digested at 664 and 775 (BASE-FAILURE.txt); a program that drops the execute
// bit pins both repositories at one digest (twins.json, exec-bit-dropped).
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageDigest } from '../../../packages/extension-host/src/index.ts';
import { FIXTURE, MINUTES, checkout, expectRecorded, fixtureFiles, gitModes, inconclusive, pinOf, readJson, shown, source, step } from './helpers.ts';

const INDEX = `${FIXTURE}/index.ts`;
/**
 * Makes R1's index.ts executable, every other fixture file at the mode git records for it, and stamps deepbuild.json
 * with the host's digest of the folder at those modes; the digest leaves deepbuild.json's own `digest` field out, so
 * the stamp changes nothing it counts. Returns the stamp.
 */
function executableIndex(root: string): string {
  const dir = join(root, FIXTURE);
  gitModes(dir);
  chmodSync(join(root, INDEX), 0o755);
  const manifest = readJson(join(dir, 'deepbuild.json'));
  manifest.digest = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest.digest;
}

describe('#2874 a fixture file git records as executable is pinned as 755', () => {
  it('#2874.a254fb4c AC3 a fixture file git records as executable (755, written 775 under umask 002) is pinned as 755: the same digest under either umask, and a different one than the same bytes not executable', async () => {
    let stamp = '';
    const executable = source('ac3-x', (root) => { stamp = executableIndex(root); });
    const plain = source('ac3-plain');
    const reference = checkout(executable, '022', 'ac3-x-022');
    const spark = checkout(executable, '002', 'ac3-x-002');
    const sparkPlain = checkout(plain, '002', 'ac3-plain-002');
    const recorded = (root: string): string | undefined => fixtureFiles(root).find((f) => f.path === INDEX)?.recorded;
    if (recorded(spark) !== '100755' || recorded(sparkPlain) !== '100644') inconclusive(`git records ${INDEX} as ${recorded(spark)}, and not executable as ${recorded(sparkPlain)}`);
    const committed: string = readJson(join(sparkPlain, FIXTURE, 'deepbuild.json')).digest;

    const at022 = await step('022', ['record', '--release', 'R1'], reference);
    expectRecorded(at022, 'on the umask 022 checkout, index.ts written 755');
    expect(pinOf(reference), `pinned as 755: the digest its deepbuild.json carries, of its bytes with index.ts at 755\n${shown(at022)}`).toBe(stamp);

    const at002 = await step('002', ['record', '--release', 'R1'], spark);
    expectRecorded(at002, 'on the umask 002 checkout, index.ts written 775');
    expect(pinOf(spark), `the same digest under umask 002, index.ts written 775, as under umask 022\n${shown(at002)}`).toBe(pinOf(reference));

    const notExecutable = await step('002', ['record', '--release', 'R1'], sparkPlain);
    expectRecorded(notExecutable, 'on the umask 002 checkout of the same bytes, index.ts not executable (664)');
    expect(pinOf(sparkPlain), `the same bytes not executable are pinned at the digest their deepbuild.json carries\n${shown(notExecutable)}`).toBe(committed);
    expect(pinOf(reference), `index.ts executable is pinned at a different digest than the same bytes not executable, ${committed}`).not.toBe(pinOf(sparkPlain));
  }, 15 * MINUTES);
});
