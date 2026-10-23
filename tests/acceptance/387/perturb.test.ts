// #387.f46de50b: read-set perturbation over every shipped operator, equal keys giving equal results
// over fuzzed sequences, the planted operator that reads the look's accent role from a static, and a
// read outside the declared set failing a test build. The fixtures are the canvas modules' own
// (`fixtures` call); a perturbed evaluation is clean (every node runs, no cache), so a key that misses
// a read shows as a result that moved under one key (README: Readings). The wrong program is the base,
// which has no `fixtures` or `eval` call, and the two planted modules.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DOC, FIXTURES, REGISTRY, VIEW_INPUTS, arr, board, evalCall, evaluated, isObject, keyConflicts, obj, perturbationFailures, presented, rect, registry,
  requires, run, scenario, show, sorted, str, useBuilds, useEvidence, type Build, type Evaluated, type JsonObject, type JsonValue, type Registry, type Target,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const ACCENT: Build = { set: 'full', with: ['test-accent'] };
const PEEK: Build = { set: 'full', with: ['test-peek'] };
const builds = useBuilds([FULL, ACCENT, PEEK]);
const evidence = useEvidence();

/** The fast-check seed of the fuzzed sequences, recorded so a failure replays. */
const SEED = 387_0001;

interface Fixture { module: string; name: string; document: JsonObject; record?: JsonObject }

function fixturesOf(bin: string): { reg: Registry; fixtures: Fixture[] } {
  const [reg, fx] = run(bin, scenario(evidence(), [REGISTRY, FIXTURES])) as [JsonObject, JsonObject];
  const fixtures = arr(fx['fixtures'], 'fixtures').map((v, i): Fixture => {
    const f = obj(v, `fixtures[${i}]`);
    const out: Fixture = { module: str(f['module'], `fixtures[${i}].module`), name: str(f['name'], `fixtures[${i}].name`), document: obj(f['document'], `fixtures[${i}].document`) };
    if (isObject(f['record'])) out.record = f['record'];
    return out;
  });
  expect(fixtures.length, 'the build registers fixtures').toBeGreaterThan(0);
  return { reg: registry(reg), fixtures };
}

const recordOf = (record: JsonObject | undefined): { record?: JsonObject } => (record ? { record } : {});

/** A document shown, evaluated clean, then evaluated clean once per target the session holds (two processes: the first lists the targets). */
function perturbed(bin: string, document: JsonObject, record?: JsonObject): { base: Evaluated; runs: { target: Target; e: Evaluated }[] } {
  const first = run(bin, scenario(evidence(), [show(document), evalCall(DOC.a, { clean: true })], recordOf(record)));
  presented(first[0]!, 'the document');
  const targets = evaluated(first[1]!, 'the clean evaluation').targets;
  const replies = run(bin, scenario(evidence(), [show(document), evalCall(DOC.a, { clean: true }), ...targets.map((t) => evalCall(DOC.a, { clean: true, perturb: t.target }))], recordOf(record)));
  const base = evaluated(replies[1]!, 'the clean evaluation');
  return { base, runs: targets.map((target, i) => ({ target, e: evaluated(replies[i + 2]!, `the evaluation with ${target.target} perturbed`) })) };
}

const kindOf = (target: string): string => (target === 'seed' ? 'seed' : target.split(':')[0]!);

describe('#387.f46de50b for every shipped operator a change outside its read set leaves its key and result byte-identical; equal keys always give byte-identical results; a planted static accent reader fails naming the operator and the role; an undeclared read fails a test build', () => {
  let cache: { reg: Registry; fixtures: Fixture[]; perturbations: { fixture: Fixture; base: Evaluated; runs: { target: Target; e: Evaluated }[] }[] } | undefined;
  function shipped(): NonNullable<typeof cache> {
    if (cache) return cache;
    const bin = builds.bin(FULL);
    const { reg, fixtures } = fixturesOf(bin);
    cache = { reg, fixtures, perturbations: fixtures.map((fixture) => ({ fixture, ...perturbed(bin, fixture.document, fixture.record) })) };
    return cache;
  }

  it('#387.f46de50b every fixture of the full build is presented and evaluated, and every operator the registry lists has a node in some fixture', () => {
    const { reg, perturbations } = shipped();
    expect(Object.keys(reg.operators).length, 'the full build lists its operators, R1\'s canvas laid out as canvas modules').toBeGreaterThan(0);
    const covered = new Set(perturbations.flatMap((p) => p.base.nodes.map((n) => n.operator)));
    const uncovered = sorted(Object.keys(reg.operators).filter((op) => !covered.has(op)));
    expect(uncovered, 'every shipped operator has a node in some registered fixture, so its perturbation is proved').toEqual([]);
    for (const p of perturbations) {
      for (const n of p.base.nodes) expect(reg.operators[n.operator]?.module, `${p.fixture.module}/${p.fixture.name}: ${n.operator} is a registered operator of module ${n.module}`).toBe(n.module);
    }
  }, 1_800_000);

  it('#387.f46de50b each fixture session lists its perturbation targets: the six view inputs, the seed, its look tokens with accent among them, and every array its nodes write', () => {
    const { reg, perturbations } = shipped();
    for (const { fixture, base } of perturbations) {
      const what = `${fixture.module}/${fixture.name}`;
      const names = base.targets.map((t) => t.target);
      for (const input of VIEW_INPUTS) expect(names, `${what} can perturb the view input ${input}`).toContain(`view:${input}`);
      expect(names, `${what} can perturb the seed`).toContain('seed');
      expect(names, `${what} can perturb the look's accent role`).toContain('look:accent');
      const written = new Set(base.nodes.flatMap((n) => reg.operators[n.operator]?.writes ?? []));
      for (const a of written) expect(names, `${what} can perturb the array ${a}, which its nodes write`).toContain(`array:${a}`);
      for (const t of base.targets) {
        if (t.target.startsWith('view:')) expect(t.term, `${what}: ${t.target}'s term`).toBe(`view(${t.target.slice(5)})`);
        if (t.target.startsWith('array:')) expect(t.term, `${what}: ${t.target}'s term is the array's name`).toBe(t.target.slice(6));
        if (t.target.startsWith('table:')) expect(t.term, `${what}: ${t.target}'s term`).toBe(t.target);
      }
      const lookTerms = new Set(base.targets.filter((t) => t.target.startsWith('look:')).map((t) => t.term));
      expect(lookTerms.size, `${what}: every look token is declared by one term`).toBe(1);
    }
  }, 1_800_000);

  it('#387.f46de50b a change to any one array, table, view input, look token, seed or asset outside an operator\'s read set leaves its key and result byte-identical, for every node of every fixture', () => {
    const { reg, perturbations } = shipped();
    const failures: string[] = [];
    const outsideByKind = new Map<string, number>();
    for (const { fixture, base, runs } of perturbations) {
      for (const { target, e } of runs) {
        const r = perturbationFailures(reg, base, e, target);
        failures.push(...r.failures.map((f) => `${fixture.module}/${fixture.name}: ${f}`));
        outsideByKind.set(kindOf(target.target), (outsideByKind.get(kindOf(target.target)) ?? 0) + r.outside);
      }
    }
    expect(failures, 'no node outside a perturbed input\'s read set moves, and no result moves under one key').toEqual([]);
    for (const kind of ['array', 'view', 'look', 'seed']) {
      expect(outsideByKind.get(kind) ?? 0, `some node lies outside a perturbed ${kind}, so the check of that kind of target isn't empty`).toBeGreaterThan(0);
    }
  }, 1_800_000);

  it(`#387.f46de50b equal keys always give byte-identical results over fuzzed sequences of edits, views and times on the fixtures (fast-check seed ${SEED}, 40 sequences of up to 25 clean evaluations)`, () => {
    const { fixtures } = shipped();
    const bin = builds.bin(FULL);
    const everything: Evaluated[] = [];
    const leaves = (document: JsonObject): string[] => {
      const out: string[] = [];
      const walk = (v: JsonValue, path: string[]): void => {
        if (typeof v === 'number') out.push(path.join('/'));
        else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, String(i)]));
        else if (isObject(v)) for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
      };
      for (const [id, item] of Object.entries(obj(document['items'] ?? {}, 'items'))) {
        const it = obj(item, `items.${id}`);
        if (it['params'] !== undefined) walk(it['params'], ['items', id, 'params']);
        if (it['at'] !== undefined) walk(it['at'], ['items', id, 'at']);
      }
      return out;
    };
    const setAt = (document: JsonObject, path: string, value: number): JsonObject => {
      const copy = JSON.parse(JSON.stringify(document)) as JsonObject;
      const parts = path.split('/');
      let at: JsonValue = copy;
      for (const p of parts.slice(0, -1)) at = (Array.isArray(at) ? at[Number(p)] : (at as JsonObject)[p])!;
      const last = parts[parts.length - 1]!;
      if (Array.isArray(at)) at[Number(last)] = value; else (at as JsonObject)[last] = value;
      return copy;
    };
    const step = fc.record({
      edits: fc.array(fc.record({ pick: fc.nat(), value: fc.constantFrom(0, 1, 2.5, 7, 12, 24, 40, 100) }), { maxLength: 3 }),
      locale: fc.constantFrom('en', 'de', 'fr'),
      reduced_motion: fc.boolean(),
      t: fc.constantFrom('0s', '0.25s', '1s', '2s'),
    });
    const sequence = fc.record({ fixture: fc.nat(), steps: fc.array(step, { minLength: 1, maxLength: 25 }) });
    fc.assert(fc.property(sequence, (s) => {
      const fixture = fixtures[s.fixture % fixtures.length]!;
      let document = fixture.document;
      const calls: JsonObject[] = [];
      for (const st of s.steps) {
        const paths = leaves(document);
        for (const e of st.edits) if (paths.length) document = setAt(document, paths[e.pick % paths.length]!, e.value);
        calls.push(show(document), evalCall(DOC.a, { clean: true, t: st.t, view: { locale: st.locale, reduced_motion: st.reduced_motion } }));
      }
      const replies = run(bin, scenario(evidence(), calls, recordOf(fixture.record)));
      const evals = replies.filter((_, i) => i % 2 === 1 && replies[i - 1]!['outcome'] === 'presented').map((r) => evaluated(r, `${fixture.module}/${fixture.name}: a fuzzed evaluation`));
      everything.push(...evals);
      expect(keyConflicts(evals, `${fixture.module}/${fixture.name}`), 'equal keys give byte-identical results within the sequence').toEqual([]);
    }), { seed: SEED, numRuns: 40, endOnFailure: true });
    expect(keyConflicts(everything, 'across every fuzzed sequence'), 'equal keys give byte-identical results across processes too').toEqual([]);
  }, 3_600_000);

  it('#387.f46de50b a planted operator that reads the look\'s accent role from a static passes perturbation of its declared reads and fails this, naming test.accent.tint and accent', () => {
    const document = board('Accent', [rect('ground', [0, 0, 320, 200], 'a0', 'ground'), { id: 'acc', kind: 'test.accent@1', name: 'Accent box', order: 'a1', params: { box: [40, 40, 120, 80] } }], requires({ 'test.accent': '^1' }));
    const bin = builds.bin(ACCENT);
    const reg = registry(run(bin, scenario(evidence(), [REGISTRY]))[0]!);
    expect(reg.operators['test.accent.tint']?.reads, 'test.accent.tint declares only its item and its base array').toEqual(['self', 'test.accent.base']);
    const { base, runs } = perturbed(bin, document);
    const byTarget = new Map(runs.map((r) => [r.target.target, r]));
    const declared = byTarget.get('array:test.accent.base');
    const accent = byTarget.get('look:accent');
    expect(declared, 'the session can perturb test.accent.base, the planted operator\'s declared read').toBeDefined();
    expect(accent, 'the session can perturb the look\'s accent role').toBeDefined();
    const tint = (e: Evaluated) => e.nodes.find((n) => n.operator === 'test.accent.tint' && n.item === 'acc');
    expect(tint(base), 'test.accent.tint has a node on the accent box').toBeDefined();
    // Its declared read: the key moves with the result, so the check passes it there.
    expect(tint(declared!.e)?.key, 'perturbing its declared read test.accent.base moves its key').not.toBe(tint(base)?.key);
    expect(perturbationFailures(reg, base, declared!.e, declared!.target).failures.filter((f) => f.includes('test.accent.tint')), 'the planted operator passes perturbation of its declared reads').toEqual([]);
    // The accent role, outside its read set, moves its result under the same key: this criterion's check fails it.
    const failures = runs.flatMap((r) => perturbationFailures(reg, base, r.e, r.target).failures);
    const named = failures.filter((f) => f.includes('test.accent.tint') && f.includes('accent'));
    expect(named.length, `the planted operator fails the check, naming test.accent.tint and the role accent; failures: ${JSON.stringify(failures)}`).toBeGreaterThan(0);
  }, 600_000);

  it('#387.f46de50b a read outside the declared set fails a test build: test.peek.out asks for the view\'s locale it didn\'t declare, and the frame fails naming the module, the operator and the read, which the access log shows', () => {
    const document = board('Peek', [rect('ground', [0, 0, 320, 200], 'a0', 'ground'), { id: 'peek', kind: 'test.peek@1', name: 'Peek box', order: 'a1', params: { box: [40, 40, 120, 80] } }], requires({ 'test.peek': '^1' }));
    const replies = run(builds.bin(PEEK), scenario(evidence(), [show(document), evalCall(DOC.a)]));
    const reply = replies[1]!;
    const issues = arr(reply['issues'], 'the eval\'s issues').map((v) => obj(v, 'an issue'));
    const hit = issues.find((i) => i['code'] === 'undeclared_read');
    expect(hit, `the frame fails with undeclared_read: ${JSON.stringify(reply).slice(0, 1500)}`).toBeDefined();
    expect([hit!['severity'], hit!['module'], hit!['operator'], hit!['read']], 'an error naming the canvas module, the operator and the read').toEqual(['error', 'test.peek', 'test.peek.out', 'view(locale)']);
    expect(hit!['ids'], 'on the item').toEqual(['peek']);
    const access = arr(reply['access'], 'a test build\'s access log').map((v) => obj(v, 'an access'));
    expect(access.some((a) => a['operator'] === 'test.peek.out' && a['read'] === 'view(locale)'), 'the access log shows the undeclared read').toBe(true);
  }, 600_000);

  it('#387.f46de50b in a test build every access every shipped operator makes on every fixture is one of its declared reads (or a contribution to one)', () => {
    const bin = builds.bin(PEEK);
    const { reg, fixtures } = fixturesOf(bin);
    const contributors = new Map<string, string[]>();
    for (const [name, a] of Object.entries(reg.arrays)) if (typeof a['contributes_to'] === 'string') contributors.set(a['contributes_to'], [...(contributors.get(a['contributes_to']) ?? []), name]);
    const failures: string[] = [];
    for (const fixture of fixtures) {
      const replies = run(bin, scenario(evidence(), [show(fixture.document), evalCall(DOC.a, { clean: true })], recordOf(fixture.record)));
      const e = evaluated(replies[1]!, `${fixture.module}/${fixture.name}`);
      expect(e.access, `${fixture.module}/${fixture.name}: a test build logs every access`).not.toBeNull();
      expect(e.access!.length, `${fixture.module}/${fixture.name}: the frame's operators read something`).toBeGreaterThan(0);
      for (const a of e.access!) {
        const op = reg.operators[a.operator];
        const allowed = new Set([...(op?.reads ?? []), ...(op?.reads ?? []).flatMap((r) => contributors.get(r) ?? [])]);
        if (!allowed.has(a.read)) failures.push(`${fixture.module}/${fixture.name}: ${a.operator} read ${a.read} on ${a.item ?? 'the document'}, outside its declared reads ${JSON.stringify(op?.reads)}`);
      }
      expect(e.issues.filter((i) => i.code === 'undeclared_read'), `${fixture.module}/${fixture.name}: no shipped operator reads what it didn't declare`).toEqual([]);
    }
    expect(failures).toEqual([]);
  }, 1_800_000);
});
