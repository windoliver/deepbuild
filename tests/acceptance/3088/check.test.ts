// #3088 AC4: `deep-conformance gate check` refuses a case whose setup.installs names a package the lockfile marks
// with `os` or `cpu`, naming the case and the install; with no such entry the shipped manifest passes. The refused
// corpus is the shipped one copied to a temp folder (`gate check --corpus <dir>`, the CLI's own flag) with one
// install added to one case; the lockfile is this checkout's package-lock.json, as the shipped corpus's is.
import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { CORPUS, kit, platformMarked, readManifest, remove, shown, tempDir } from './helpers.ts';

const ID = '#3088.be450fed';
const TIMEOUT = 120_000;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) remove(d); });

/** The shipped corpus, copied, with `install` added to the setup.installs of the case `id`. */
function plantedCorpus(id: string, install: string): string {
  const dir = tempDir('b3088-c-');
  dirs.push(dir);
  cpSync(CORPUS, dir, { recursive: true });
  const m = readManifest(dir);
  const c = m.cases.find((x) => x.id === id)!;
  c.setup = { ...(c.setup ?? {}), installs: [...(c.setup?.installs ?? []), install] };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
  return dir;
}

async function expectRefused(id: string, install: string): Promise<void> {
  expect(platformMarked().has(install), `the lockfile marks ${install} with os or cpu`).toBe(true);
  expect(readManifest().cases.some((c) => c.id === id), `the shipped corpus has the case ${id}`).toBe(true);
  const r = await kit(['check', '--corpus', plantedCorpus(id, install)], TIMEOUT - 10_000);
  const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  expect(lines.filter((l) => /^FAIL\b/.test(l) && l.includes(id) && l.includes(install)), `gate check prints a FAIL line naming the case ${id} and the install ${install}: ${shown(r)}`).not.toEqual([]);
  expect(r.code, `gate check refuses the corpus, exit 1: ${shown(r)}`).toBe(1);
}

describe("gate check refuses a case's install that the lockfile marks with os or cpu", () => {
  test(`${ID} gate check refuses a case whose setup.installs names node_modules/fsevents (os: darwin), naming the case and the install`, async () => {
    await expectRefused('seeded-bug', 'node_modules/fsevents');
  }, TIMEOUT);

  test(`${ID} gate check refuses a case whose setup.installs names node_modules/@rolldown/binding-win32-x64-msvc (os and cpu, installed on no machine here), naming the case and the install`, async () => {
    await expectRefused('reporting-vitest-setup', 'node_modules/@rolldown/binding-win32-x64-msvc');
  }, TIMEOUT);

  test(`${ID} with no such entry, the shipped manifest passes gate check`, async () => {
    const marked = platformMarked();
    const named = readManifest().cases.flatMap((c) => (c.setup?.installs ?? []).filter((p) => marked.has(p)).map((p) => `${c.id}: ${p}`));
    expect(named, "the shipped manifest's cases name no install the lockfile marks with os or cpu").toEqual([]);
    const r = await kit(['check'], TIMEOUT - 10_000);
    expect(r.code, `gate check on the shipped corpus passes, exit 0: ${shown(r)}`).toBe(0);
    expect(r.stdout.trim().split('\n').at(-1), 'its last line is the PASS judgement').toMatch(/^PASS gate@1 corpus: \d+ cases$/);
  }, TIMEOUT);
});
