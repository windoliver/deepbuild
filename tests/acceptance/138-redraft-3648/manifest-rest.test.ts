import { describe, expect, it } from 'vitest';
import {
  FIXTURES, MANIFEST, REGISTRY, arr, expectFailure, failuresIn, kit, moduleOf, obj, partIn, run, scenario, str, strs,
  useBuilds, useEvidence,
  type Build, type JsonObject,
} from '../138/helpers.ts';

const FULL: Build = { set: 'full' };
const FORMULA: Build = { set: 'full', with: ['test-kit-formula'] };
const builds = useBuilds([FULL, FORMULA]);
const evidence = useEvidence();

function manifest(build: Build): { m: JsonObject; reg: JsonObject; listed: JsonObject } {
  const [reg, m, listed] = run(builds.bin(build), scenario(evidence(), [REGISTRY, MANIFEST, FIXTURES]));
  return { m: m!, reg: reg!, listed: listed! };
}

describe('#138.230a6b92 every fixture is a document with a sidecar of existing check kinds and named oracles, and no sidecar holds a formula or code', () => {
  it('#138.230a6b92 one category list of 21 and one naming scheme, parity/<category>/<name>.<profile>, covering every module\'s fixtures and the issue\'s three scenes', () => {
    const { m, reg, listed } = manifest(FULL);
    const categories = strs(m['categories'], 'manifest.categories');
    expect(categories.length, 'the category list has 21 categories').toBe(21);
    expect(new Set(categories).size, 'each once').toBe(21);
    for (const c of categories) expect(c, 'a category is a lowercase name').toMatch(/^[a-z][a-z0-9-]*$/);
    for (const c of ['kernel', 'framework', 'scene']) expect(categories, `the list holds ${c}`).toContain(c);
    const fixtures = arr(m['fixtures'], 'manifest.fixtures').map((f, i) => obj(f, `fixtures[${i}]`));
    const names = fixtures.map((f) => str(f['name'], 'fixture.name'));
    expect(new Set(names).size, 'every fixture name is unique').toBe(names.length);
    for (const f of fixtures) {
      const name = str(f['name'], 'name');
      const parts = /^parity\/([a-z][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/.exec(name);
      expect(parts, `${name} is parity/<category>/<name>.<profile>`).not.toBeNull();
      expect(categories, `${name}'s category is on the list`).toContain(parts![1]);
      expect(f['category'], `${name}: its category field`).toBe(parts![1]);
      expect(f['profile'], `${name}: its profile field`).toBe(parts![3]);
      if (parts![3] !== 'scene') expect(obj(f['document'], `${name}: document`)['profile'], `${name}: the name's profile is its document's`).toBe(parts![3]);
    }
    for (const scene of ['parity/kernel/clean-rebuild-fuzz.scene', 'parity/kernel/patch-fuzz.scene', 'parity/framework/repair-loop.scene', 'parity/framework/agent-decision.scene']) {
      expect(names, `the manifest lists ${scene}`).toContain(scene);
    }
    const modules = new Set(fixtures.map((f) => str(f['module'], 'fixture.module')));
    for (const mod of strs(reg['modules'], 'registry.modules')) expect(modules.has(mod), `the manifest lists ${mod}'s fixtures`).toBe(true);
    const registered = arr(listed['fixtures'], 'fixtures call').map((f) => obj(f, 'fixture'));
    for (const f of registered) {
      const doc = JSON.stringify(f['document']);
      expect(fixtures.some((x) => x['module'] === f['module'] && JSON.stringify(x['document']) === doc), `the manifest lists ${String(f['module'])}'s fixture ${String(f['name'])} with its document`).toBe(true);
    }
  }, 600_000);

  it('#138.230a6b92 the kit fails a sidecar with a formula, one with a check kind no registry holds and one with an oracle off the list, naming each fixture', () => {
    const r = kit(builds.bin(FORMULA), evidence(), { modules: ['test.kit.formula'], parts: ['fixtures'] });
    const m = moduleOf(r, 'test.kit.formula');
    expect(m.verdict).toBe('FAIL');
    const failures = failuresIn(m, 'fixtures');
    const f = expectFailure(failures, 'formula', { fixture: 'parity/kernel/formula-expect.board' }, 'the formula in a sidecar');
    expect(str(f['path'], 'formula.path'), 'naming where in the sidecar').toMatch(/expect/);
    expectFailure(failures, 'check_kind', { fixture: 'parity/kernel/formula-kind.board', kind: 'test.kit.formula.made_up' }, 'the unknown check kind');
    expectFailure(failures, 'oracle', { fixture: 'parity/kernel/formula-oracle.board', oracle: 'eyeball' }, 'the unlisted oracle');
  }, 1_800_000);

  it('#138.230a6b92 the shipped build\'s fixtures pass the same part', () => {
    const r = kit(builds.bin(FULL), evidence(), { parts: ['fixtures'] });
    for (const m of r.modules) {
      const bad = failuresIn(m, 'fixtures').filter((f) => ['formula', 'check_kind', 'oracle'].includes(f.code));
      expect(bad, `${m.module}: no sidecar fault`).toEqual([]);
      expect(partIn(m, 'fixtures').ran, `${m.module}: its fixtures ran`).toBeGreaterThan(0);
    }
  }, 1_800_000);
});
