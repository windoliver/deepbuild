// #138.230a6b92: every fixture is a document with a sidecar of existing check kinds and named oracles, and no
// sidecar holds a formula or code; one category list of 21 and one naming scheme, parity/<category>/<name>.<profile>,
// in one manifest. `test.kit.formula` plants a sidecar with a formula, one with a check kind no registry holds
// and one with an oracle off the closed list. At the base there is no `manifest` or `kit` call and no
// `test-kit-formula` feature.
import { describe, expect, it } from 'vitest';
import {
  FIXTURES, MANIFEST, REGISTRY, arr, expectFailure, failuresIn, isObject, kit, moduleOf, obj, partIn, run, scenario, show, str, strs,
  useBuilds, useEvidence,
  type Build, type JsonObject, type JsonValue,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const FORMULA: Build = { set: 'full', with: ['test-kit-formula'] };
const builds = useBuilds([FULL, FORMULA]);
const evidence = useEvidence();

const SIDECAR_KEYS = ['checks', 'oracles', 'covers', 'codes', 'twin', 'expected_from', 'criteria', 'inputs', 'at_times'];
const CHECK_KEYS = ['kind', 'probe', 'at_times', 'expect', 'tolerance', 'except', 'render', 'sweeps', 'declared_cuts'];
const EXPECTED_FROM = ['analytic', 'upstream', 'issue', 'second_implementation'];
/** What a formula or code looks like in a string: operators, calls, blocks, assignments, keywords. */
const FORMULA_TEXT = /[(){};=^*+]|=>|\b(fn|function|return|let|const|var|lambda)\b/;
/** Prose fields a reader writes for people; the formula scan skips them. */
const PROSE = new Set(['reason', 'what', 'description', 'title', 'name']);

/** Every string in a sidecar outside prose fields, with its path. */
function strings(value: JsonValue, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}/${i}`, out));
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) if (!PROSE.has(k)) strings(v, `${path}/${k}`, out);
  return out;
}

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

  it('#138.230a6b92 each fixture holds a document and a sidecar of known keys, existing check kinds and listed oracles, no formula or code, and none is marked may-fail', () => {
    const { m } = manifest(FULL);
    const kinds = new Set(strs(m['check_kinds'], 'manifest.check_kinds'));
    const oracles = new Set(strs(m['oracles'], 'manifest.oracles'));
    for (const o of ['analytic', 'cpu_reference', 'golden', 'reftest']) expect(oracles.has(o), `the closed oracle list names ${o}`).toBe(true);
    for (const k of ['document.validate', 'document.budget', 'kind_rules']) expect(kinds.has(k), `the check kinds hold the core's ${k}`).toBe(true);
    const problems: string[] = [];
    for (const f of arr(m['fixtures'], 'manifest.fixtures').map((x, i) => obj(x, `fixtures[${i}]`))) {
      const name = str(f['name'], 'name');
      const profile = String(f['profile']);
      if (profile !== 'scene') {
        const d = obj(f['document'], `${name}: document`);
        if (typeof d['format'] !== 'number' || !isObject(d['items'])) problems.push(`${name}: its document has no format or items`);
      }
      const sidecar = obj(f['sidecar'], `${name}: sidecar`);
      for (const k of Object.keys(sidecar)) if (!SIDECAR_KEYS.includes(k)) problems.push(`${name}: sidecar key ${k} (may-fail or anything else unknown)`);
      for (const [i, c] of arr(sidecar['checks'] ?? [], `${name}: checks`).entries()) {
        const check = obj(c, `${name}: checks[${i}]`);
        for (const k of Object.keys(check)) if (!CHECK_KEYS.includes(k)) problems.push(`${name}: checks[${i}] key ${k}`);
        if (!kinds.has(String(check['kind']))) problems.push(`${name}: checks[${i}] kind ${String(check['kind'])} is no existing check kind`);
      }
      const named = strs(sidecar['oracles'] ?? [], `${name}: oracles`);
      for (const o of named) if (!oracles.has(o)) problems.push(`${name}: oracle ${o} is off the closed list`);
      if (sidecar['expected_from'] !== undefined && !EXPECTED_FROM.includes(String(sidecar['expected_from']))) problems.push(`${name}: expected_from ${String(sidecar['expected_from'])}`);
      for (const [path, text] of strings(sidecar, '')) if (FORMULA_TEXT.test(text)) problems.push(`${name}: sidecar${path} holds a formula or code: ${JSON.stringify(text)}`);
    }
    expect(problems, show(problems, 4000)).toEqual([]);
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
