// The check catalog (criterion 7) and fixes given as patch ops (29). A module whose check can emit a code the
// catalog doesn't list fails the kit, naming the code; every catalog code has a planted fixture that raises it
// with its meaning and fix; an ops fix is applied on each kit fixture raising its code and the second check
// must return that fixture's other codes and nothing else. At the base there is no `kit` or `catalog` call,
// no `fix_ops` and no `test-kit-rogue*` or `test-kit-fixer*` feature.
import { describe, expect, it } from 'vitest';
import {
  CATALOG, MANIFEST, arr, failuresIn, kit, moduleOf, obj, partIn, run, scenario, show, sorted, str, strs, useBuilds, useEvidence,
  type Build, type Case,
} from './helpers.ts';

// The first drafts of three tests here were replaced by their blind redrafts in catalog-redraft.test.ts (README).
const ROGUE_LISTED: Build = { set: 'full', with: ['test-kit-rogue-listed'] };
const FIXER: Build = { set: 'full', with: ['test-kit-fixer'] };
const builds = useBuilds([ROGUE_LISTED, FIXER]);
const evidence = useEvidence();

interface Entry { code: string; module: string; meaning: string; fix: string; fix_ops: boolean; fixture: string }
function catalogOf(build: Build): Entry[] {
  const [reply] = run(builds.bin(build), scenario(evidence(), [CATALOG]));
  return arr(reply!['codes'], 'catalog.codes').map((c, i) => {
    const o = obj(c, `catalog.codes[${i}]`);
    return {
      code: str(o['code'], 'code'), module: str(o['module'], 'module'), meaning: str(o['meaning'], 'meaning'), fix: str(o['fix'], 'fix'),
      fix_ops: o['fix_ops'] === true, fixture: str(o['fixture'], 'fixture'),
    };
  });
}

describe('#138.9e9940d1 a code the catalog doesn\'t list fails the kit; every catalog code has a planted fixture that emits it with its meaning and fix', () => {
  it('#138.9e9940d1 the same module with the code in the catalog (test-kit-rogue-listed) passes, and the catalog names its module, meaning and fix', () => {
    const r = kit(builds.bin(ROGUE_LISTED), evidence(), { modules: ['test.kit.rogue'], parts: ['catalog'] });
    expect(partIn(moduleOf(r, 'test.kit.rogue'), 'catalog').verdict, `${show(failuresIn(moduleOf(r, 'test.kit.rogue')))}`).toBe('PASS');
    const entry = catalogOf(ROGUE_LISTED).find((e) => e.code === 'test.kit.rogue.unlisted');
    expect(entry, 'the catalog lists the code').toBeDefined();
    expect(entry!.module).toBe('test.kit.rogue');
  }, 1_800_000);

  it('#138.9e9940d1 every code in the catalog has its module, meaning, fix and a planted fixture whose case raises exactly it, with the catalog\'s fix', () => {
    const entries = catalogOf(FIXER);
    expect(entries.length, 'the catalog lists codes').toBeGreaterThan(0);
    expect(new Set(entries.map((e) => e.code)).size, 'each code once').toBe(entries.length);
    for (const want of ['test.kit.fixer.y_over', 'test.kit.fixer.x_odd', 'ref_unresolved', 'out_of_range']) expect(entries.map((e) => e.code), `the catalog lists ${want}`).toContain(want);
    const [manifest] = run(builds.bin(FIXER), scenario(evidence(), [MANIFEST]));
    const names = new Set(arr(manifest!['fixtures'], 'manifest.fixtures').map((f) => str(obj(f, 'fixture')['name'], 'name')));
    const r = kit(builds.bin(FIXER), evidence(), { parts: ['catalog'] });
    const cases: Case[] = r.modules.flatMap((m) => (m.parts.find((p) => p.part === 'catalog')?.cases ?? []));
    for (const e of entries) {
      expect(e.meaning.trim().length, `${e.code}: its meaning`).toBeGreaterThan(0);
      expect(e.fix.trim().length, `${e.code}: its fix`).toBeGreaterThan(0);
      expect(names.has(e.fixture), `${e.code}: its planted fixture ${e.fixture} is in the manifest`).toBe(true);
      const c = cases.find((x) => x.raw['code'] === e.code && x.fixture === e.fixture);
      expect(c, `${e.code}: the kit's catalog part ran its planted fixture`).toBeDefined();
      expect(c!.verdict, `${e.code}: its fixture emits it: ${show(c!.raw)}`).toBe('PASS');
      expect(c!.expected_codes, `${e.code}: its fixture names it`).toContain(e.code);
      expect(sorted(c!.raised_codes ?? []), `${e.code}: its fixture raised exactly what it names`).toEqual(sorted(c!.expected_codes ?? []));
      const issue = obj(c!.raw['issue'], `${e.code}: the issue its fixture raised`);
      expect(issue['code']).toBe(e.code);
      expect(issue['fix'], `${e.code}: the raised issue carries the catalog's fix`).toBe(e.fix);
    }
  }, 1_800_000);
});

describe('#138.c7f79e24 a fix given as patch ops is applied on each kit fixture raising its code, and the second check returns only that fixture\'s other codes', () => {
  it('#138.c7f79e24 test.kit.fixer\'s ops fix for y_over is applied on its fixture and the second check returns nothing else; its text fix for x_odd needs no fixture', () => {
    const r = kit(builds.bin(FIXER), evidence(), { modules: ['test.kit.fixer'], parts: ['catalog'] });
    const p = partIn(moduleOf(r, 'test.kit.fixer'), 'catalog');
    expect(p.verdict, show(p.failures)).toBe('PASS');
    const applied = p.cases.filter((c) => c.raw['fix_of'] !== undefined);
    expect(applied.map((c) => c.raw['fix_of']), 'only the ops fix was applied').toEqual(['test.kit.fixer.y_over']);
    const c = applied[0]!;
    expect(c.fixture, 'on the fixture that raises its code').toBe('parity/framework/fixer-y-over.board');
    expect(strs(c.raw['second_check'], 'second_check'), 'the second check returns the fixture\'s other codes: none').toEqual([]);
    expect(c.verdict).toBe('PASS');
    expect(catalogOf(FIXER).find((e) => e.code === 'test.kit.fixer.x_odd')?.fix_ops, 'x_odd\'s fix is text').toBe(false);
  }, 1_800_000);
});
