// AC8: "A kind with `deprecated_since` still loads, with a `deprecated` notice naming its `replaced_by`; a check
// that loads it silently fails this test, naming the kind"
//
// Blind redraft of `deprecated.test.ts` (REDRAFT-AC8.md). The board declares the canvas module whose kind it
// uses (`requires.modules: {"test.deprecated": "^1"}`), as the Document section says every document does
// ("A document declares the canvas modules its kinds need") and as #305's suite sends it, so nothing but
// deprecation separates a right program from a wrong one.
//
// asserts: in the build with the test canvas module `test.deprecated` 1.0.0 (feature `test-deprecated`), whose
// kind `test.old@1` has `deprecated_since` and `replaced_by: test.new@1`, an agent's board holding a `test.old@1`
// item is presented with no error, the item neither skipped nor refused (no `unknown_kind` or `module_missing`
// names it), and becomes the current revision; its reply's `notices` hold a `deprecated` notice naming the item
// and `replaced_by: "test.new@1"` (`deprecatedFailures`). The planted `loads_deprecated_silently` still
// presents the board, and fails `deprecatedFailures`, naming `test.old@1`.

import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, board, current, deprecatedFailures, errors, failsNaming, issues, isObject, none, num, outcome, run, scenario, show,
  useBuilds, useEvidence,
  type Build, type JsonObject,
} from './helpers.ts';

const DEPRECATED: Build = { with: 'test-deprecated' };
const builds = useBuilds([DEPRECATED]);
const evidence = useEvidence();

const MODULE = 'test.deprecated';
const KIND = 'test.old@1';
const REPLACED_BY = 'test.new@1';
const ITEM = 'old';
const doc: JsonObject = board('Old kind', [200, 120], [
  { id: ITEM, kind: KIND, name: 'Old box', order: 'a0', params: { box: [16, 16, 80, 40] } },
], { requires: { modules: { [MODULE]: '^1' } } });

function play(planted?: string): JsonObject[] {
  return run(builds.bin(DEPRECATED), scenario(evidence(), { [DOC.a]: 'main' }, [
    show(ALPHA.id, DOC.a, doc),
    { call: 'revisions', doc: DOC.a },
  ], planted ? { planted } : {}));
}

/** The item loaded: no error in the reply, and no issue or notice saying it was skipped or its module is absent. */
function loadedFailures(reply: JsonObject): string[] {
  const failures = errors(issues(reply)).map((i) => `error ${i.code} at ${i.path || '(no path)'} on ${i.ids.join(', ') || 'the document'}`);
  const notices = (Array.isArray(reply['notices']) ? reply['notices'] : []).filter(isObject);
  for (const n of [...issues(reply).map((i) => i.raw), ...notices]) {
    const ids = Array.isArray(n['ids']) ? n['ids'] : [];
    if ((n['code'] === 'unknown_kind' || n['code'] === 'module_missing') && ids.includes(ITEM)) failures.push(`${String(n['code'])} names ${ITEM}: ${KIND} didn't load`);
  }
  return failures;
}

describe('AC8 a kind with deprecated_since still loads, with a deprecated notice naming its replaced_by', () => {
  it('AC8 a document declaring test.deprecated and using test.old@1 loads and becomes current, its reply carrying a deprecated notice naming test.new@1', () => {
    const [reply, revs] = play();
    none(loadedFailures(reply!), `the board using ${KIND}, declaring ${MODULE}`);
    none(deprecatedFailures(reply!, KIND, ITEM, REPLACED_BY), `the board using ${KIND}`);
    expect(current(revs!).rev, 'the revision that uses the deprecated kind is current').toBe(num(reply!['rev'], 'the reply\'s rev'));
  });

  it('AC8 a planted check that loads the deprecated kind silently fails this test, naming the kind', () => {
    const [reply] = play('loads_deprecated_silently');
    expect(outcome(reply!), 'the planted check still loads the document').toBe('presented');
    none(loadedFailures(reply!), 'the planted check loads the item');
    failsNaming(deprecatedFailures(reply!, KIND, ITEM, REPLACED_BY), [KIND], 'the check that loads a deprecated kind silently');
  });
});
