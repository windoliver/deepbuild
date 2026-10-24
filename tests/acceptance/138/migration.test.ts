// The migration corpus as release fixtures (criterion 6) and seeded param sets through a migration (22). A
// corpus document is recorded by a build with `test.kit.mig` 1.0.0 (the previous release) and loaded by builds
// with 2.0.0 (a kind one major back), whose migration is right, moves one value, or maps the old max out of
// range. At the base there is no `kit` or `corpus_record` call and no `test-kit-mig-*` feature.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AS_ALPHA, AS_ALPHA_CLI, AS_YOU, FLICKS, PARAM_SETS, WRITER, decide, decided, expectFailure, failuresIn, kit, moduleOf, num, partIn, refusedAsAgent,
  run, scenario, show, str, useBuilds, useEvidence,
  type Build, type JsonObject,
} from './helpers.ts';

const MIG1: Build = { set: 'full', with: ['test-kit-mig-1'] };
const MIG2: Build = { set: 'full', with: ['test-kit-mig-2'] };
const MOVES: Build = { set: 'full', with: ['test-kit-mig-2-moves'] };
const OVERFLOW: Build = { set: 'full', with: ['test-kit-mig-2-overflow'] };
const builds = useBuilds([MIG1, MIG2, MOVES, OVERFLOW]);
const evidence = useEvidence();

let corpus = '';
beforeEach(() => { corpus = mkdtempSync(join(tmpdir(), 'deep-138-corpus-')); });
afterEach(() => { if (corpus) rmSync(corpus, { recursive: true, force: true }); corpus = ''; });

const NAME = 'mig-board';
const TIMES = ['0s', '0.5s', '1s'];
const DOCUMENT: JsonObject = {
  format: 1, profile: 'board', title: 'Migration corpus', size: [320, 200],
  description: 'A board an earlier release saved: one item of a test kind one major back beside a plain rect.',
  requires: { modules: { 'test.kit.mig': '^1' } },
  items: {
    m1: { id: 'm1', kind: 'test.kit.mig@1', name: 'Migrated box', order: 'a0', params: { box: [20, 20, 40, 30], w: 30 } },
    r1: { id: 'r1', kind: 'rect@1', name: 'Plain box', order: 'a1', params: { box: [120, 20, 40, 30], paint: { fill: { role: 'muted' } } } },
  },
};

/** The previous release saves the corpus document with its values and Vello CPU snapshots. */
function recordCorpus(): string {
  const [reply] = run(builds.bin(MIG1), scenario(evidence(), [{ call: 'corpus_record', corpus, name: NAME, document: DOCUMENT, times: TIMES }]));
  const file = str(reply!['file'], 'corpus_record.file');
  expect(existsSync(file), `the corpus file exists: ${file}`).toBe(true);
  return file;
}
const corpusCase = (build: Build): ReturnType<typeof moduleOf> =>
  moduleOf(kit(builds.bin(build), evidence(), { modules: ['test.kit.mig'], parts: ['migration'], corpus, param_sets: 10 }), 'test.kit.mig');

describe('#138.7447bce1 the migration corpus: a document the previous release saved migrates at load and gives what it recorded; a planted twin fails the release; only your decision blesses', () => {
  it('#138.7447bce1 a corpus document with test.kit.mig@1 migrates at load in 2.0.0 and gives its recorded values and Vello CPU snapshots at every sampled time', () => {
    recordCorpus();
    const m = corpusCase(MIG2);
    const p = partIn(m, 'migration');
    const c = p.cases.find((x) => x.case === NAME);
    expect(c, `the migration part ran the corpus document ${NAME}: ${show(p.cases.map((x) => x.case).slice(0, 20))}`).toBeDefined();
    expect(c!.verdict, `the migrated document gives what its release recorded: ${show(c!.raw)}`).toBe('PASS');
    const compared = c!.raw['compared'] as JsonObject;
    expect(compared?.['times'], 'it compared at every sampled time').toEqual([0, FLICKS / 2, FLICKS]);
    expect(num(compared?.['snapshots'], 'compared.snapshots'), 'a Vello CPU snapshot at each time').toBe(TIMES.length);
    expect(num(compared?.['values'], 'compared.values'), 'evaluated values at each time').toBeGreaterThan(0);
    expect(m.verdict).toBe('PASS');
  }, 1_800_000);

  it('#138.7447bce1 a planted migration that moves one value (2w + 1) fails the release, naming the kind, item m1, the width field and the first time that differs', () => {
    recordCorpus();
    const m = corpusCase(MOVES);
    expect(m.verdict, 'the release fails').toBe('FAIL');
    const f = expectFailure(failuresIn(m, 'migration'), 'migration', { item: 'm1' }, 'the moved value');
    expect(str(f['kind'], 'migration.kind'), 'it names the kind').toMatch(/^test\.kit\.mig/);
    expect(str(f['field'], 'migration.field'), 'it names the field').toMatch(/width/);
    expect(f['t'], 'the first time that differs is the first sampled time (the box is still)').toBe(0);
  }, 1_800_000);

  it('#138.7447bce1 an agent\'s attempt to bless the new result is refused; your decision blesses it once for its cause, and the release passes', () => {
    recordCorpus();
    const bin = builds.bin(MOVES);
    const accept = { accept_corpus: { corpus, name: NAME, cause: 'test.kit.mig 2.0.0 widens by one' } };
    const [agent, cli, yours] = run(bin, scenario(evidence(), [decide(AS_ALPHA, accept), decide(AS_ALPHA_CLI, accept), decide(AS_YOU, accept)]));
    refusedAsAgent(agent!, 'alpha\'s accept_corpus over MCP', WRITER.alpha);
    refusedAsAgent(cli!, 'alpha\'s accept_corpus from its process tree', WRITER.alpha);
    decided(yours!, 'your accept_corpus');
    expect(corpusCase(MOVES).verdict, 'after your decision the same corpus passes').toBe('PASS');
  }, 1_800_000);
});

describe(`#138.1df954fa ${PARAM_SETS} seeded param sets per migrated kind pass the new schema and keep IDs`, () => {
  it(`#138.1df954fa test.kit.mig@1 → @2: ${PARAM_SETS} seeded param sets each pass the new schema, keep every ID and give identical bytes twice`, () => {
    const r = kit(builds.bin(MIG2), evidence(), { modules: ['test.kit.mig'], parts: ['migration'] });
    const p = partIn(moduleOf(r, 'test.kit.mig'), 'migration');
    const sets = p.cases.filter((c) => c.raw['kind'] !== undefined && String(c.raw['kind']).startsWith('test.kit.mig'));
    expect(sets.length, `${PARAM_SETS} param-set cases for the migrated kind`).toBe(PARAM_SETS);
    expect([p.declared, p.ran], 'the part declares and runs them all').toEqual([sets.length, sets.length]);
    expect(new Set(sets.map((c) => num(c.raw['seed'], 'case.seed'))).size, 'each set has its own seed').toBe(PARAM_SETS);
    expect(sets.filter((c) => c.verdict !== 'PASS').map((c) => c.raw), 'every set passes').toEqual([]);
    expect(p.verdict).toBe('PASS');
  }, 1_800_000);

  it('#138.1df954fa a planted migration that maps the old max out of range (3w) fails, naming the seed and the param width', () => {
    const r = kit(builds.bin(OVERFLOW), evidence(), { modules: ['test.kit.mig'], parts: ['migration'] });
    const m = moduleOf(r, 'test.kit.mig');
    expect(m.verdict).toBe('FAIL');
    const f = expectFailure(failuresIn(m, 'migration'), 'migration_range', { param: 'width' }, 'the out-of-range migration');
    const seed = num(f['seed'], 'migration_range.seed');
    const c = partIn(m, 'migration').cases.find((x) => x.raw['seed'] === seed);
    expect(c?.verdict, `the param set with seed ${seed} fails`).toBe('FAIL');
  }, 1_800_000);
});
