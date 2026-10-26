// #305.4e03e5e7: a document evaluated in the full build and in a test build without the canvas
// modules it doesn't use hashes the same, and a document that needs a missing canvas module is
// refused with module_missing. The hashes are the revision's (the canonical document) and the
// render-back snapshot's (the evaluated frame, a PNG by sha256); the wrong program is the base,
// which has no build sets and reads requires.modules only for its shape.
import { describe, expect, it } from 'vitest';
import {
  CORE_ONLY, DOC, aItem, board, check, moduleMissing, moduleMissingFailures, outcome, requires, revisionsOf, run, scenario, show, theSnapshot,
  useBuilds, useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const CORE: Build = { set: 'core' };
const CORE_A: Build = { set: 'core', with: ['test-a'] };

const builds = useBuilds([CORE, CORE_A]);
const evidence = useEvidence();

/** A document that needs test.a: it declares the module and draws its kind. */
const NEEDS_A: JsonObject = board('Needs test.a', [aItem('a-1', [40, 40, 120, 80], 'a1', 7)], requires({ 'test.a': '^1' }));


describe('#305.4e03e5e7 a document hashes the same in the full build and in a build without the canvas modules it doesn\'t use, and one that needs a missing canvas module is refused with module_missing', () => {
  it('#305.4e03e5e7 a document that needs test.a is refused with module_missing naming test.a in the core build, with its check BLOCKED, and presented in the core build with test.a', () => {
    const without = run(builds.bin(CORE), scenario(evidence(), [show(NEEDS_A, { pixels: true }), check(NEEDS_A), revisionsOf()])).replies;
    const [shown, checked, revs] = without as [JsonObject, JsonObject, JsonObject];
    expect(moduleMissingFailures(shown, 'test.a', false, 'deep_show without test.a'), 'deep_show refuses the document with module_missing naming test.a').toEqual([]);
    expect(moduleMissingFailures(checked, 'test.a', true, 'deep show --check without test.a'), 'the check is refused the same way and BLOCKED').toEqual([]);
    const named = moduleMissing(shown, 'test.a');
    expect(named.some((i) => i.path === 'requires/modules/test.a' || i.ids.includes('a-1')), `the issue points at the requirement or the item: ${JSON.stringify(named)}`).toBe(true);
    expect((revs['revisions'] as JsonObject[]).filter((r) => r['state'] === 'current'), 'no revision of the refused document is current').toEqual([]);

    const withA = run(builds.bin(CORE_A), scenario(evidence(), [show(NEEDS_A, { pixels: true })])).replies[0]!;
    expect(outcome(withA), `with test.a in the build the same document is presented: ${JSON.stringify(withA['issues'])}`).toBe('presented');
    expect(moduleMissing(withA, 'test.a'), 'and nothing is module_missing').toEqual([]);
    theSnapshot(withA, 'the document with test.a');
  });

  it('#305.4e03e5e7 the refusal is per document: in the core build a core-only document under another doc ID is presented beside the refused one', () => {
    const { replies } = run(builds.bin(CORE), scenario(evidence(), [show(NEEDS_A), show(CORE_ONLY, { doc: DOC.b, pixels: true })]));
    expect(outcome(replies[0]!), 'the document needing test.a is refused').toBe('refused');
    theSnapshot(replies[1]!, 'the core-only document');
  });
});
