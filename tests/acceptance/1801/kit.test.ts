// AC6: A test canvas module that names an item ID in a field it didn't declare as a reference fails its kit, naming
// the field; with the declaration added, `refs_to` lists it.
//
// The test canvas module `test.kit.pointer` (README: The test canvas module) comes in two builds of deep-show: under
// `test-kit-pointer` its kind's `points_to` holds an item ID and isn't declared a reference; under
// `test-kit-pointer-declared` it is declared one, of kind `target`. The kit runs its `references` part over the
// module (#138's `kit` call); refs_to runs on a board where a pointer names a rect.
import { describe, expect, it } from 'vitest';
import {
  DECLARED, DOC, POINTER, arr, brief, isObject, kitCall, none, obj, pointerBoard, presented, refsFailures, refsTo, rows, run, scenario, show, useBuilds, useEvidence,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([POINTER, DECLARED]);
const evidence = useEvidence();
const MODULE = 'test.kit.pointer';
const FIELD = 'test.kit.pointer@1/params/points_to';

/** The kit's references part over the module in a build: the whole report and the module's result. */
function kit(features: readonly string[]): { report: JsonObject; module: JsonObject } {
  const [report] = run(builds.bin(features), scenario(evidence(), {}, [kitCall(MODULE)]));
  const modules = arr(report!['modules'], `the kit's report's modules (${brief(report, 800)})`).filter(isObject);
  const module = modules.find((m) => m['module'] === MODULE);
  expect(module, `the kit's report holds ${MODULE}: ${brief(report, 1500)}`).toBeDefined();
  return { report: report!, module: module! };
}
/** Every failure a module's result names: the module's own, each part's, and each case's (#138's report). */
function failuresIn(module: JsonObject): JsonObject[] {
  const parts = (Array.isArray(module['parts']) ? module['parts'] : []).filter(isObject);
  return [
    ...(Array.isArray(module['failures']) ? module['failures'] : []),
    ...parts.flatMap((p) => [...(Array.isArray(p['failures']) ? p['failures'] : []), ...(Array.isArray(p['cases']) ? p['cases'] : []).flatMap((c) => (isObject(c) && isObject(c['failure']) ? [c['failure']] : []))]),
  ].filter(isObject);
}

describe('AC6 a field that names an ID is a reference its module declares, or the kit fails the module', () => {
  it('AC6 test.kit.pointer, whose points_to names an item without being declared a reference, fails its kit, naming the field', () => {
    const { report, module } = kit(POINTER);
    expect(report['verdict'], `the kit fails: ${brief(report, 1500)}`).toBe('FAIL');
    expect(module['verdict'], `${MODULE} fails its kit`).toBe('FAIL');
    const named = failuresIn(module).filter((f) => f['code'] === 'undeclared_reference' && f['field'] === FIELD);
    expect(named.length, `a failure undeclared_reference names the field ${FIELD}: ${brief(failuresIn(module), 1500)}`).toBeGreaterThan(0);
  });

  it('AC6 with points_to declared a reference the module passes its kit\'s references part, and refs_to the rect lists the pointer\'s field', () => {
    const { module } = kit(DECLARED);
    const part = arr(module['parts'], `${MODULE}'s parts`).filter(isObject).find((p) => p['part'] === 'references');
    expect(part?.['verdict'], `${MODULE} passes the references part: ${brief(module, 1500)}`).toBe('PASS');
    expect(module['verdict'], `${MODULE} passes its kit`).toBe('PASS');

    const [shown, reply] = run(builds.bin(DECLARED), scenario(evidence(), { [DOC.pointer]: null }, [show(DOC.pointer, pointerBoard()), refsTo(DOC.pointer, 't1')]));
    presented(shown, 'the pointer board');
    none(refsFailures('t1', rows(reply, 'refs_to t1'), [{ path: 'items/p1/params/points_to', kind: 'target' }]), 'refs_to t1 lists the pointer\'s declared field');
    expect(obj(reply!['coverage'], 'refs_to t1: coverage'), 'the coverage block: the one row, nothing cut').toMatchObject({ complete: true, rows_total: 1, rows_shown: 1, cut: [] });
  });
});
