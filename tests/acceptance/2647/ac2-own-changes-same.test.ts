// #2647 AC2 #2647.7c79c9b7: ownChanges returns the same list as the merge base for every case of packages/gate's own
// tests and for 10,000 generated claims. A planted version that keeps one claim's answer for the next claim fails,
// naming the file.
//
// `ownChanges` through @deepbuild/gate's public entry, against the merge base's own copy (reference-own.ts). Every claim
// is a new `changes` object, as the gate runner makes one per claim, and each is asked three times with different files
// a run read, as a stop's verdict reads ask it, all in one process one claim after another, so an answer kept from one
// claim (or from one read of a claim) shows in a later one. Each list must equal the merge base's, in order.
//
// packages/gate's own tests (packages/gate/test/*.test.ts at 6a2b68d44) hold no case of ownChanges: none of them calls
// it. The cases below stand for them (README, Open points 2): one per rule own.ts's comments give, each read against
// the merge base's list. The planted version (twins.json: keeps-answer-across-claims) keeps whether a config names a
// path by the path alone, so a later claim with the same path under other configs reads the first claim's answer; the
// test then fails naming that file.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ownChanges } from '../../../packages/gate/src/index.ts';
import { ownChangesOnBase, type ChangesPlant, type Changes } from './reference-own.ts';

const AC2 = '#2647.7c79c9b7';

interface Claim { name: string; changes: Changes; reads: string[][]; plant?: ChangesPlant }
const claim = (name: string, changed: string[], configs: Record<string, string>, scripts: boolean, reads: string[][], plant?: ChangesPlant): Claim => ({
  name, changes: { changed, configs: new Map(Object.entries(configs)), scripts }, reads, ...(plant ? { plant } : {}),
});

/** One case per rule own.ts states (Whose checks count, #29/#33): what the merge base returns for each is the expectation. */
const RULES: Claim[] = [
  claim('a file under a test folder the run read is own; one it did not read is not', ['test/cart.test.ts', 'tests/other.test.ts'], {}, false, [['test/cart.test.ts'], [], ['tests/other.test.ts', 'test/cart.test.ts']]),
  claim('the code under test is never own, read or not', ['src/cart.ts', 'lib/price.js'], {}, false, [['src/cart.ts', 'lib/price.js'], []]),
  claim('fixtures, snapshots, scripts and spec folders anywhere in the path', ['pkg/__fixtures__/a.json', 'pkg/__snapshots__/b.snap', 'scripts/run.sh', 'spec/x.rb', 'pkg/fixtures/c.txt', 'deep/__tests__/d.ts'], {}, false, [['pkg/__fixtures__/a.json', 'pkg/__snapshots__/b.snap', 'scripts/run.sh', 'spec/x.rb', 'pkg/fixtures/c.txt', 'deep/__tests__/d.ts'], ['scripts/run.sh']]),
  claim('a runner config is own wherever it lies, read or not', ['vitest.config.ts', 'pkg/jest.config.js', 'web/vite.config.mjs', 'vitest.workspace.mts', 'py/conftest.py', 'pytest.ini', 'pkg/vitest.config.cts'], {}, false, [[]]),
  claim('a file a config names is own, with or without its extension, with or without ./', ['test-setup.ts', 'src/setup.ts', 'src/globals.js', 'src/other.ts'], { 'vitest.config.ts': "export default { test: { setupFiles: ['./test-setup.ts', \"src/setup\"], globalSetup: `./src/globals` } };\n" }, false, [[]]),
  claim('a config names only files under its own folder', ['web/setup.ts', 'api/setup.ts', 'setup.ts'], { 'web/vitest.config.ts': "export default { test: { setupFiles: ['./setup.ts'] } };\n" }, false, [[]]),
  claim('a name with regular-expression characters is matched as written', ['a+b.ts', 'aab.ts', 'q(1).js', 'r$.ts', 'mid.dot.ts', 'midxdot.ts'], { 'vitest.config.ts': "setupFiles: ['./a+b.ts', 'q(1)', 'r$.ts', './mid.dot.ts']\n" }, false, [[]]),
  claim('a name not in quotes is not named', ['setup.ts', 'unquoted.ts'], { 'jest.config.js': '// setup.ts is loaded by hand\nmodule.exports = { setupFiles: [unquoted.ts] };\n' }, false, [[]]),
  claim('package.json is own when its scripts changed and the run read it', ['package.json', 'src/a.ts'], {}, true, [['package.json'], [], ['src/a.ts']]),
  claim('package.json is not own when its scripts did not change', ['package.json'], {}, false, [['package.json']]),
  claim('package.json under a folder is not the root one', ['pkg/package.json'], {}, true, [['pkg/package.json']]),
  claim('the edited-check-approved plant counts nothing as own', ['test/a.test.ts', 'vitest.config.ts'], {}, false, [['test/a.test.ts']], 'edited-check-approved'),
  claim('the own-files-test-folders-only plant counts only read files under test folders', ['test/a.test.ts', 'vitest.config.ts', 'setup.ts'], { 'vitest.config.ts': "setupFiles: ['./setup.ts']\n" }, false, [['test/a.test.ts', 'setup.ts']], 'own-files-test-folders-only'),
  claim('the same path under other configs in the next claim (1 of 2): named', ['web/setup.ts', 'test/x.ts'], { 'web/vitest.config.ts': "setupFiles: ['./setup.ts']\n" }, false, [['test/x.ts']]),
  claim('the same path under other configs in the next claim (2 of 2): not named', ['web/setup.ts', 'test/x.ts'], { 'web/vitest.config.ts': "setupFiles: ['./other.ts']\n" }, false, [[]]),
  claim('an empty claim', [], { 'vitest.config.ts': "setupFiles: ['./setup.ts']\n" }, true, [[]]),
];

// ---- Generated claims: paths from a small set, so paths, folders and names meet again across claims.
const DIRS = ['', 'pkg/', 'pkg/sub/', 'test/', 'src/test/', 'scripts/', 'web/', 'web/__tests__/'];
const NAMES = ['a.ts', 'b.js', 'c.mts', 'd.cjs', 'e.tsx', 'setup.ts', 'x+y.ts', 'q(1).js', 'r$.ts', 'mid.dot.ts', 'vitest.config.ts', 'jest.config.js', 'conftest.py', 'pytest.ini', 'package.json', 'README.md'];
const PATHS = DIRS.flatMap((d) => NAMES.map((n) => d + n));
const CONFIG_FILES = ['vitest.config.ts', 'jest.config.js', 'vite.config.mjs', 'vitest.workspace.ts'];
const CONFIG_DIRS = ['', 'pkg/', 'web/', 'pkg/sub/'];
/** What a config may name: paths relative to some folder, with and without extension, and near misses. */
const REFS = [...new Set([...PATHS, ...PATHS.map((p) => p.replace(/\.[cm]?[jt]s$/, '')), ...NAMES, ...NAMES.map((n) => n.replace(/\.[cm]?[jt]s$/, '')), 'sub/a.ts', 'sub/setup', 'test/a', '__tests__/b.js', 'xy.ts', 'q1.js', 'a.tsx'])];
/** A name a config gives: a quote, maybe ./, a name, and a closing mark (a near miss when it isn't a quote). */
const ref = (names: readonly string[]) => fc.record({ open: fc.constantFrom("'", '"', '`', "'", ''), dot: fc.boolean(), name: fc.constantFrom(...names), close: fc.constantFrom("'", '"', '`', "'", 'x') })
  .map(({ open, dot, name, close }) => `${open}${dot ? './' : ''}${name}${close}`);
/** A config in one of the folders, naming files: half the time one the claim changed, relative to the config's folder, with or without its extension. */
const config = (changed: readonly string[]) => fc.record({ dir: fc.constantFrom(...CONFIG_DIRS), file: fc.constantFrom(...CONFIG_FILES), seed: fc.array(fc.nat(), { maxLength: 6 }) }).chain(({ dir, file, seed }) => {
  const own = changed.filter((p) => p.startsWith(dir)).map((p) => p.slice(dir.length));
  const near = [...own, ...own.map((p) => p.replace(/\.[cm]?[jt]s$/, ''))];
  return fc.tuple(...seed.map((n) => ref(near.length && n % 2 === 0 ? near : REFS))).map((refs) => [`${dir}${file}`, `export default { test: { setupFiles: [${refs.join(', ')}] } };\n`] as const);
});
const generated = fc.uniqueArray(fc.constantFrom(...PATHS), { maxLength: 14 }).chain((changed) => fc.record({
  changed: fc.constant(changed),
  configs: fc.array(config(changed), { maxLength: 5 }),
  scripts: fc.boolean(),
  reads: fc.array(fc.uniqueArray(fc.constantFrom(...PATHS, ...changed, ...changed), { maxLength: 10 }), { minLength: 3, maxLength: 3 }),
  plant: fc.constantFrom<ChangesPlant | undefined>(undefined, undefined, undefined, undefined, undefined, undefined, 'edited-check-approved', 'own-files-test-folders-only'),
}));

/** Each read of each claim whose list differs from the merge base's, naming the files the two lists differ on. */
function differences(claims: readonly Claim[]): string[] {
  const out: string[] = [];
  for (const c of claims) {
    c.reads.forEach((read, i) => {
      const want = ownChangesOnBase(c.changes, read, c.plant);
      const got = ownChanges(c.changes, read, c.plant);
      if (JSON.stringify(got) === JSON.stringify(want)) return;
      const files = [...new Set([...got.filter((f) => !want.includes(f)), ...want.filter((f) => !got.includes(f))])];
      out.push(`file ${files.join(', ') || '(same files, other order)'} in ${c.name}, read ${i + 1}: ownChanges returned ${JSON.stringify(got)} where the merge base returns ${JSON.stringify(want)}`);
    });
  }
  return out;
}

describe(`${AC2} ownChanges returns the same list as the merge base for every case of packages/gate's own tests and for 10,000 generated claims; a planted version that keeps one claim's answer for the next claim fails, naming the file`, () => {
  it(`${AC2} one case per rule of whose checks count, one claim after another: the merge base's list for each read`, () => {
    const wrong = differences(RULES);
    expect(wrong, `${wrong.length} reads differ from the merge base: ${wrong.slice(0, 5).join('; ')}`).toEqual([]);
  });

  it(`${AC2} 10,000 generated claims, each read three times with different files read: the merge base's list for each`, () => {
    const samples = fc.sample(generated, { numRuns: 10_000, seed: 2647 });
    const claims: Claim[] = samples.map((s, n) => ({
      name: `generated claim ${n + 1} (changed ${JSON.stringify(s.changed)}, configs ${JSON.stringify(s.configs)}${s.plant ? `, plant ${s.plant}` : ''})`,
      changes: { changed: s.changed, configs: new Map(s.configs), scripts: s.scripts }, reads: s.reads, ...(s.plant ? { plant: s.plant } : {}),
    }));
    if (claims.length !== 10_000) throw Error(`BLOCKED: fast-check gave ${claims.length} claims, not 10,000`);
    // The claims must reach the configs' names, not only test folders and config files.
    const byName = claims.filter((c) => c.plant === undefined && ownChangesOnBase(c.changes, [], undefined).some((p) => !/(^|\/)((vitest|vite|jest)\.config\.[cm]?[jt]s|vitest\.workspace\.[cm]?[jt]s|pytest\.ini|conftest\.py)$/.test(p))).length;
    if (byName < 2_000) throw Error(`BLOCKED: only ${byName} generated claims hold a file a config names; the generator must reach that rule`);
    const wrong = differences(claims);
    expect(wrong, `${wrong.length} of 30,000 reads differ from the merge base: ${wrong.slice(0, 3).join('; ')}`).toEqual([]);
  }, 60_000);
});
