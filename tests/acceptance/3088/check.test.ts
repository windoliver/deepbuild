// #3088: the corpus check refuses a platform's own package in a case's installs. Criterion #3088.be450fed:
// "`deep-conformance gate check` refuses a case whose `setup.installs` names a package the lockfile marks with `os` or
// `cpu`, such as `node_modules/fsevents`. It names the case and the install. With no such entry, the shipped manifest
// passes the check."
// The refusals run `gate check --corpus <dir>` on a copy of the shipped corpus (the cases' folders as shipped) whose
// manifest first has every lockfile-marked install taken out, which must pass, then has one such install added to one
// case, which must be refused with a line naming both. "The lockfile" is this checkout's package-lock.json.
import { afterEach, describe, expect, test } from 'vitest';
import { CASES, clean, corpusCopy, kit, lockPackages, platformMarked, readManifest, shown, type Manifest } from './helpers.ts';

const ID = '#3088.be450fed';
const KIT_MS = 2 * 60_000;
const TIMEOUT = 3 * 60_000;
const TARGET = CASES[0]!;

/** The shipped manifest with no lockfile-marked install in any case, and `extra` added to the target case's installs. */
const editedWith = (extra?: string) => (m: Manifest): Manifest => ({
  ...m,
  cases: m.cases.map((c) => {
    if (!c.setup?.installs) return c;
    const installs = c.setup.installs.filter((p) => !platformMarked(p));
    return { ...c, setup: { ...c.setup, installs: c.id === TARGET && extra ? [...installs, extra] : installs } };
  }),
});

async function refuses(install: string): Promise<void> {
  const control = await kit(['check', '--corpus', corpusCopy(editedWith())], KIT_MS);
  expect(control.code, `with no lockfile-marked install, the corpus copy passes the check: ${shown(control)}`).toBe(0);
  const r = await kit(['check', '--corpus', corpusCopy(editedWith(install))], KIT_MS);
  const naming = r.stdout.split('\n').filter((line) => line.includes(TARGET) && line.includes(install));
  expect(naming, `the check prints a line naming the case ${TARGET} and the install ${install}: ${shown(r)}`).not.toEqual([]);
  expect(r.code, `the check refuses the corpus (exit 1, FAIL): ${shown(r)}`).toBe(1);
  expect(r.stdout.trim().split('\n').at(-1), `the check's judgement is FAIL: ${shown(r)}`).toMatch(/^FAIL\b/);
}

describe('deep-conformance gate check refuses a platform package in a case\'s installs', () => {
  afterEach(() => { clean(); });

  test(`${ID} refuses a case whose setup.installs names node_modules/fsevents (the lockfile marks it with os), naming the case and the install`, async () => {
    const p = lockPackages()['node_modules/fsevents'];
    expect(p?.os !== undefined && p?.cpu === undefined, 'the lockfile marks node_modules/fsevents with os only').toBe(true);
    await refuses('node_modules/fsevents');
  }, TIMEOUT);

  test(`${ID} refuses a case whose setup.installs names node_modules/@unrs/resolver-binding-wasm32-wasi (the lockfile marks it with cpu only), naming the case and the install`, async () => {
    const p = lockPackages()['node_modules/@unrs/resolver-binding-wasm32-wasi'];
    expect(p?.cpu !== undefined && p?.os === undefined, 'the lockfile marks node_modules/@unrs/resolver-binding-wasm32-wasi with cpu only').toBe(true);
    await refuses('node_modules/@unrs/resolver-binding-wasm32-wasi');
  }, TIMEOUT);

  test(`${ID} the shipped manifest names no lockfile-marked install and passes the check`, async () => {
    const marked = readManifest().cases.flatMap((c) => (c.setup?.installs ?? []).filter(platformMarked).map((p) => `${c.id}: ${p}`));
    expect(marked, 'no case of the shipped manifest installs a package the lockfile marks with os or cpu').toEqual([]);
    const r = await kit(['check'], KIT_MS);
    expect(r.code, `the shipped corpus passes the check (exit 0): ${shown(r)}`).toBe(0);
    expect(r.stdout.trim().split('\n').at(-1), `the check's judgement is PASS: ${shown(r)}`).toMatch(/^PASS gate@1 corpus: \d+ cases$/);
  }, TIMEOUT);
});
