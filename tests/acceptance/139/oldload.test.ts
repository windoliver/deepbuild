// AC4 (#139): the previous release's shipped fixture package, pinned by envelope digest, loads in the candidate and
// calls every stable method that release lists, each result equal to the one recorded at that release. A shim that
// answers an old method `unsupported`, or a fixture rebuilt from today's SDK, fails, naming the method.
// No release is cut at the base, so the previous release is a record this test makes the way a release does:
// `contract-diff.mjs record --release R1` writes contracts/releases/R1.json (the contracts, with the fixture's pinned
// envelope digest) and contracts/fixtures/R1/recorded.json (each stable method's result) from the fixture folder
// contracts/fixtures/R1/ (README: the previous release's fixture). `old-load --release R2` is the step the preflight runs.
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  apiEntry, at, edit, expectFailNaming, expectPass, failLines, fork, host, readJson, record, scratch, shown, step, writeJson, API_FILE, type Json, type Tree,
} from './helpers.ts';
import { join } from 'node:path';

const FIXTURE = 'contracts/fixtures/R1';
const index = (extra = '') => `export default async function (deep: any): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  results['deep.registerCheck'] = (await deep.registerCheck('ext.oldfix.check', async () => ({ outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [], mask: null }))) ?? null;
${extra}  return results;
}
`;
const CONFIG = `  results['deep.config.get'] = (await deep.config.get('oldfix.missing')) ?? null;\n`;

/** Writes the fixture package into the tree, its manifest stamped with the host's own envelope digest. */
async function fixtureAt(t: Tree, source: string): Promise<void> {
  const dir = at(t, FIXTURE);
  rmSync(dir, { recursive: true, force: true });
  writeJson(join(dir, 'deepbuild.json'), { id: 'deepbuild/oldfix', version: '1.0.0', digest: `d1:${'0'.repeat(64)}`, checks: ['ext.oldfix.check'] });
  writeFileSync(join(dir, 'index.ts'), source);
  const { packageDigest } = await host();
  const manifest = readJson(join(dir, 'deepbuild.json'));
  manifest.digest = packageDigest(dir);
  writeJson(join(dir, 'deepbuild.json'), manifest);
}

/** R1 as this suite cuts it: two stable methods and a preview one, the fixture calling both stable ones, recorded. */
async function cutR1(source = index(CONFIG), recordIt = true): Promise<Tree> {
  const t = scratch('oldload');
  edit(t, API_FILE, (api: Json[]) => {
    const keep = api.filter((e) => ['deep.registerCheck', 'deep.config.get'].includes(e.method));
    // Both are stable in R1 whatever the repo's own marks say: this scene states it.
    for (const e of keep) { e.stability = 'stable'; e.since = 'R1'; delete e.tracking; }
    api.splice(0, api.length, ...keep, apiEntry('deep.preview', { stability: 'preview', tracking: '#139' }));
  });
  edit(t, 'contracts/shipped.json', (s) => { s.pieces = [{ piece: 'scratch/fixture', calls: ['deep.registerCheck', 'deep.config.get'] }]; });
  await fixtureAt(t, source);
  if (recordIt) record(t, 'R1');
  return t;
}
const oldLoad = (t: Tree, plant?: string) => step(['old-load', '--release', 'R2'], { root: t.root, plant, timeoutMs: 300_000 });

describe('#139.09f0df5f the previous release\'s fixture package, pinned by envelope digest, loads and calls every stable method that release lists, and each result equals the recorded one', () => {
  it('AC4 the record pins the fixture\'s envelope digest and holds one result per stable method, none for the preview one', async () => {
    const t = await cutR1();
    const release = readJson(at(t, 'contracts/releases/R1.json'));
    const manifest = readJson(at(t, `${FIXTURE}/deepbuild.json`));
    expect(JSON.stringify(release), 'R1.json pins the fixture by its envelope digest').toContain(manifest.digest);
    const recorded = readJson(at(t, `${FIXTURE}/recorded.json`));
    expect(Object.keys(recorded.results ?? recorded).sort(), 'one recorded result per stable method R1 lists').toEqual(['deep.config.get', 'deep.registerCheck']);
  }, 180_000);

  it('AC4 the fixture loads in the candidate and calls both stable methods, each result equal to the recorded one: PASS', async () => {
    const t = await cutR1();
    const r = oldLoad(t);
    expectPass(r, 'the previous release\'s fixture');
    for (const method of ['deep.registerCheck', 'deep.config.get']) expect(r.out, `old-load reports the call of ${method}`).toContain(method);
    expect(r.out, 'the preview method is not called').not.toContain('deep.preview');
  }, 300_000);

  it('AC4 a shim that answers deep.registerCheck unsupported fails, naming the method and unsupported', async () => {
    const t = await cutR1();
    expectFailNaming(oldLoad(t, 'unsupported-shim:deep.registerCheck'), 'a shim answering unsupported', 'deep.registerCheck', 'unsupported');
  }, 300_000);

  it('AC4 a result that differs from the recorded one fails, naming the method: the recorded value of deep.config.get is changed', async () => {
    const t = await cutR1();
    const file = at(t, `${FIXTURE}/recorded.json`);
    const recorded = readJson(file);
    (recorded.results ?? recorded)['deep.config.get'] = { changed: true };
    writeJson(file, recorded);
    expectFailNaming(oldLoad(t), 'a result unlike the recorded one', 'deep.config.get');
  }, 300_000);

  it('AC4 a fixture rebuilt from today\'s SDK fails: its envelope digest is not the pinned one, and the method whose result changed is named', async () => {
    const t = await cutR1();
    const rebuilt = fork(t);
    // Today's SDK registers the check and answers with a handle object of its own, where R1's answered null.
    await fixtureAt(rebuilt, index(CONFIG).replace(/results\['deep.registerCheck'\] = .*\n/, "await deep.registerCheck('ext.oldfix.check', async () => ({ outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [], mask: null }));\n  results['deep.registerCheck'] = { handle: 'check:ext.oldfix.check' };\n"));
    cpSync(at(t, `${FIXTURE}/recorded.json`), at(rebuilt, `${FIXTURE}/recorded.json`));
    const r = oldLoad(rebuilt);
    expectFailNaming(r, 'a rebuilt fixture', /digest/);
    expectFailNaming(r, 'a rebuilt fixture', 'deep.registerCheck');
  }, 300_000);

  it('AC4 a fixture that calls only one of the two stable methods R1 lists fails, naming the other', async () => {
    const t = await cutR1(index(''), false);
    // A release refuses to record such a fixture, or the old-load step after it does: either way the method is named.
    const recorded = step(['record', '--release', 'R1'], { root: t.root });
    const r = recorded.code !== 0 ? recorded : oldLoad(t);
    expectFailNaming(r, 'a fixture that skips a stable method', 'deep.config.get');
    expect(failLines(r).join('\n'), shown(r)).not.toContain('deep.preview');
  }, 300_000);
});
