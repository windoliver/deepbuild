// AC3 (#403.f915741c): "In a build without the logic module, a brief whose check input names
// logic.determinism leaves that requirement BLOCKED with module_missing, naming the kind and the logic
// module, never PASS or INCONCLUSIVE; and a test canvas module that registers a check kind adds it to the
// check input's kinds and to the catalog with its codes"
//
// asserts: in `full,test-leave-out-logic`, whose `registry` holds no `logic` module, alpha's claim on the
// checks board has two requirements: one whose check input is `logic.determinism`, which the verdict lists
// (not skipped) as BLOCKED with a `module_missing` naming `logic.determinism` and module `logic`, never PASS
// or INCONCLUSIVE, the claim neither PASS nor INCONCLUSIVE (`missingKindFailures`); and one of
// `document.validate`, which passes. The planted `missing_kind_inconclusive` fails `missingKindFailures`,
// naming the kind. In `full,test-check-kind`, the test canvas module `test.checks` registers the check
// kind `test.checks.named` with codes `test.checks.todo` and `test.checks.shout`: the manifest's
// `check_kinds` holds the core's eleven kinds and `test.checks.named`, and the catalog lists both codes
// with module `test.checks`, check `test.checks.named`, a meaning and a fix; in `full` neither is there. A
// requirement whose check input names `test.checks.named` runs there (PASS on the clean board, FAIL with
// `test.checks.todo` on the item named TODO), and in `full` it is BLOCKED with module_missing naming the
// kind.

import { describe, expect, it } from 'vitest';
import {
  CHECK_KIND, CORE_CHECK_KINDS, DOC, FULL, NO_LOGIC, WORK_ITEMS, arr, claim, claimId, failsNaming, isObject, missingKindFailures, none, obj,
  rect, requirement, rowOf, run, scenario, storedBoard, strs, useBuilds, useEvidence, verdictOf,
  type Build, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([NO_LOGIC, CHECK_KIND, FULL]);
const evidence = useEvidence();

const LOGIC_KIND = 'logic.determinism';
const TEST_KIND = 'test.checks.named';
const TEST_MODULE = 'test.checks';
const TEST_CODES = ['test.checks.shout', 'test.checks.todo'];

const CLAIM = claimId(3);
const LOGIC_REQ = requirement(3, { kind: LOGIC_KIND, at_times: ['1s'], compare: 'same_machine' });
const VALIDATE_REQ = requirement(4, { kind: 'document.validate' });
const TEST_REQ = requirement(5, { kind: TEST_KIND });
const WORK = storedBoard(WORK_ITEMS);
const TODO = storedBoard([...WORK_ITEMS, rect('you.todo', 'TODO', [80, 310, 60, 30], 'a3')]);

function judge(build: Build, document: JsonObject, requirements: JsonObject[], planted?: string): JsonObject[] {
  return run(builds.bin(build), scenario(evidence(), { [DOC.a]: { panel: 'main', document } }, [
    { call: 'registry' },
    { call: 'verdict', claim: CLAIM },
  ], { claims: { [CLAIM]: claim([DOC.a], requirements) }, ...(planted ? { planted } : {}) }));
}

function lists(build: Build): { kinds: string[]; codes: JsonObject[] } {
  const [manifest, catalog] = run(builds.bin(build), scenario(evidence(), {}, [{ call: 'manifest' }, { call: 'catalog' }]));
  return {
    kinds: strs(manifest!['check_kinds'], 'manifest: check_kinds'),
    codes: arr(catalog!['codes'], 'catalog: codes').filter(isObject),
  };
}

describe('AC3 a check kind no module in the build registers is BLOCKED with module_missing; a module that registers one adds it to the check kinds and the catalog', () => {
  it('#403.f915741c AC3 in a build without the logic module, a requirement whose check input names logic.determinism is BLOCKED with module_missing naming the kind and logic, never PASS or INCONCLUSIVE', () => {
    const [registry, judged] = judge(NO_LOGIC, WORK, [LOGIC_REQ, VALIDATE_REQ]);
    expect(strs(registry!['modules'], 'registry: modules'), 'the build holds no logic module').not.toContain('logic');
    const verdict = verdictOf(judged, 'the verdict on the claim');
    none(missingKindFailures(verdict, String(LOGIC_REQ['id']), LOGIC_KIND, 'logic'), `the ${LOGIC_KIND} requirement`);
    expect(rowOf(verdict, String(VALIDATE_REQ['id']))?.result, `the claim's document.validate requirement on the same board passes: ${JSON.stringify(verdict.raw).slice(0, 1200)}`).toBe('PASS');
  });

  it('#403.f915741c AC3 a planted judge that leaves a check kind no module registers INCONCLUSIVE fails this check, naming logic.determinism', () => {
    const [, judged] = judge(NO_LOGIC, WORK, [LOGIC_REQ, VALIDATE_REQ], 'missing_kind_inconclusive');
    failsNaming(missingKindFailures(verdictOf(judged, 'the planted verdict'), String(LOGIC_REQ['id']), LOGIC_KIND, 'logic'), [LOGIC_KIND], 'the judge that leaves a missing kind INCONCLUSIVE');
  });

  it("#403.f915741c AC3 the test canvas module test.checks adds test.checks.named to the check input's kinds and to the catalog with its codes; the full build has neither", () => {
    const withModule = lists(CHECK_KIND);
    for (const kind of [...CORE_CHECK_KINDS, TEST_KIND]) expect(withModule.kinds, `check_kinds holds ${kind} in full,test-check-kind`).toContain(kind);
    for (const code of TEST_CODES) {
      const rows = withModule.codes.filter((r) => r['code'] === code);
      expect(rows.length, `the catalog lists ${code} once: ${JSON.stringify(rows)}`).toBe(1);
      const row = obj(rows[0], `the catalog row of ${code}`);
      expect(row['module'], `${code} is ${TEST_MODULE}'s`).toBe(TEST_MODULE);
      expect(row['check'], `${code} is emitted by the check kind ${TEST_KIND}`).toBe(TEST_KIND);
      for (const field of ['meaning', 'fix']) expect(typeof row[field] === 'string' && row[field] !== '', `${code} has a ${field}: ${JSON.stringify(row)}`).toBe(true);
    }
    const without = lists(FULL);
    for (const kind of CORE_CHECK_KINDS) expect(without.kinds, `check_kinds holds the core's ${kind} in full`).toContain(kind);
    expect(without.kinds, `check_kinds in full has no ${TEST_KIND}`).not.toContain(TEST_KIND);
    expect(without.codes.filter((r) => TEST_CODES.includes(String(r['code']))), `the catalog in full lists none of ${TEST_MODULE}'s codes`).toEqual([]);
  });

  it('#403.f915741c AC3 a requirement whose check input names test.checks.named runs in the build with the module: PASS on the clean board, FAIL naming the TODO item; in full it is BLOCKED with module_missing naming the kind', () => {
    const clean = verdictOf(judge(CHECK_KIND, WORK, [TEST_REQ])[1], 'the verdict on the clean board');
    expect(rowOf(clean, String(TEST_REQ['id']))?.result, `${TEST_KIND} passes the clean board: ${JSON.stringify(clean.raw).slice(0, 1200)}`).toBe('PASS');
    const todo = verdictOf(judge(CHECK_KIND, TODO, [TEST_REQ])[1], 'the verdict on the board with a TODO item');
    const row = rowOf(todo, String(TEST_REQ['id']));
    expect(row?.result, `${TEST_KIND} fails the board with an item named TODO: ${JSON.stringify(todo.raw).slice(0, 1200)}`).toBe('FAIL');
    expect(row!.issues.some((i) => i.code === 'test.checks.todo' && i.ids.includes('you.todo')), `its issues name test.checks.todo on you.todo: ${JSON.stringify(row!.raw).slice(0, 1200)}`).toBe(true);
    const missing = verdictOf(judge(FULL, WORK, [TEST_REQ])[1], 'the verdict in full');
    none(missingKindFailures(missing, String(TEST_REQ['id']), TEST_KIND, null), `the ${TEST_KIND} requirement in full`);
  });
});
