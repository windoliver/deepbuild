// #305.4e03e5e7: a document evaluated in the full build and in a test build without the canvas
// modules it doesn't use hashes the same, and a document that needs a missing canvas module is
// refused with module_missing. The hashes are the revision's (the canonical document) and the
// render-back snapshot's (the evaluated frame, a PNG by sha256); the wrong program is the base,
// which has no build sets and reads requires.modules only for its shape.
import { describe, expect, it } from 'vitest';
import {
  CORE_ONLY, DOC, aItem, board, check, currentHash, moduleMissing, moduleMissingFailures, outcome, requires, revisionsOf, run, scenario, show, theSnapshot,
  useBuilds, useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const CORE: Build = { set: 'core' };
const FULL_A: Build = { set: 'full', with: ['test-a'] };
const CORE_A: Build = { set: 'core', with: ['test-a'] };

const builds = useBuilds([FULL, CORE, FULL_A, CORE_A]);
const evidence = useEvidence();

/** A document that needs test.a: it declares the module and draws its kind. */
const NEEDS_A: JsonObject = board('Needs test.a', [aItem('a-1', [40, 40, 120, 80], 'a1', 7)], requires({ 'test.a': '^1' }));

/** The revision hash and the snapshot hash of `document` evaluated by `bin`. */
function evaluated(bin: string, document: JsonObject): { revision: string; snapshot: string; set_digest: string } {
  const { replies } = run(bin, scenario(evidence(), [show(document, { pixels: true }), revisionsOf()]));
  const [shown, revs] = replies as [JsonObject, JsonObject];
  const snapshot = theSnapshot(shown, 'the document shown with pixels');
  return { revision: currentHash(revs), snapshot: snapshot.sha256, set_digest: String(shown['set_digest']) };
}

describe('#305.4e03e5e7 a document hashes the same in the full build and in a build without the canvas modules it doesn\'t use, and one that needs a missing canvas module is refused with module_missing', () => {
  it('#305.4e03e5e7 a document of core kinds alone, evaluated in the full build and in the core build, has the same revision hash and the same snapshot hash', () => {
    const full = evaluated(builds.bin(FULL), CORE_ONLY);
    const core = evaluated(builds.bin(CORE), CORE_ONLY);
    expect(core.revision, 'the revision hash is the same in both builds').toBe(full.revision);
    expect(core.snapshot, 'the evaluated frame (the snapshot PNG, by sha256) is the same in both builds').toBe(full.snapshot);
  });

  it('#305.4e03e5e7 a document that uses test.a, evaluated in the full build with test.a and in the core build with test.a, hashes the same, and the two builds\' module-set digests differ', () => {
    const full = evaluated(builds.bin(FULL_A), NEEDS_A);
    const core = evaluated(builds.bin(CORE_A), NEEDS_A);
    expect(core.revision, 'the revision hash is the same in both builds').toBe(full.revision);
    expect(core.snapshot, 'the evaluated frame is the same in both builds').toBe(full.snapshot);
    // Not a criterion by itself: a reading that the two are different builds, kept for the record.
    console.log(`#305.4e03e5e7 set digests: full+test-a ${full.set_digest}, core+test-a ${core.set_digest}`);
  });

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
