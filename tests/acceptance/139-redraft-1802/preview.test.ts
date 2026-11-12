// #139.607ef4f7 (AC3 in the frozen suite): "A planted preview method reshaped between two releases passes the contract
// diff with no break file, …; a stable method that no shipped piece of its release calls fails the preflight, naming
// it; a contract step that diffs preview entries, or lets the stable package call one, fails this test"
// #139.b9c5c209 (AC13 in the frozen suite): "A preview entry with no tracking issue fails the preflight, naming it; …"
// #1802.1c4f47ee: "A preview entry with no `decide_by`, or one more than 3 releases after its `preview_since`, fails the
// preflight, naming the entry"
//
// Blind redraft of four tests of tests/acceptance/139/preview.test.ts after #1802 (REDRAFT.md). Each scene, assertion
// and failure message is the original's. One thing changes: every preview entry a scene publishes carries, beside its
// tracking issue, the two fields #1802 puts on a preview entry's published row: `preview_since`, the release it
// arrived in, and `decide_by`, R3. Without them a correct contract step fails each scene for a reason its criterion
// doesn't name.
//
// asserts: deep.preview, a preview since R1 to be decided by R3, recorded in R1 and then reshaped (its `type` field
// retyped from a string to an integer), passes `check --release R2` with no break file: exit 0, a PASS line, no FAIL
// line. The planted step that diffs preview entries fails the same scene, and the scenario throws what the criterion
// names. deep.orphan, stable since R2 and called by no shipped piece, fails `check --release R2` in one FAIL line that
// names it and "no shipped piece"; called by a shipped piece it passes; called by none and published as a preview
// since R2 to be decided by R3, it passes. deep.untracked, a preview since R2 to be decided by R3 that names no
// tracking issue, fails in one FAIL line that names it and "tracking"; the same entry with its tracking issue passes.

import { describe, expect, it } from 'vitest';
import { addApi, apiEntry, check, expectFailNaming, expectPass, record, reshapeApi, scratch, shown, type Json, type StepPlant } from '../139/helpers.ts';

/**
 * The release every preview entry here is decided by. Each scene's candidate is R2, and R3 is the release after it:
 * no entry is due in the candidate (#1802's second criterion), and R3 is 2 releases after R1 and 1 after R2, inside
 * the cap of 3 (its first).
 */
const DECIDE_BY = 'R3';

/** #139's preview entry, tracked by #139, as #1802 has it published: with `preview_since`, the release it arrived in, and `decide_by`. */
const dated = (method: string, since: 'R1' | 'R2'): Json => ({ ...apiEntry(method, { since, stability: 'preview', tracking: '#139' }), preview_since: since, decide_by: DECIDE_BY });

const retype = (params: { properties: { type: unknown } }): void => { params.properties.type = { type: 'integer' }; };

/** A preview method reshaped between R1 and R2, with no break file. Throws what the criterion names when the step asks for one. */
function previewReshaped(plant?: StepPlant): void {
  const t = scratch();
  addApi(t, dated('deep.preview', 'R1'));
  record(t, 'R1');
  reshapeApi(t, 'deep.preview', retype);
  const r = check(t, 'R2', { plant });
  if (r.code !== 0) throw Error(`a contract step that diffs preview entries failed the reshaped preview method deep.preview with no break file: ${shown(r)}`);
  expectPass(r, 'a reshaped preview method');
}

describe('#139.607ef4f7 a preview method reshaped passes the diff; a stable package that calls it is refused at install; the same method stable fails; a stable method no shipped piece calls fails', () => {
  it('#139.607ef4f7 AC3 a preview method reshaped between two releases passes the contract diff with no break file (redraft 1802)', () => {
    previewReshaped();
  }, 120_000);

  it('#139.607ef4f7 AC3 (wrong program) a contract step that diffs preview entries asks for a break file, and this test fails it (redraft 1802)', () => {
    expect(() => previewReshaped('diff-preview')).toThrow(/a contract step that diffs preview entries failed the reshaped preview method deep\.preview/);
  }, 120_000);

  it('#139.607ef4f7 AC3 a stable method that no shipped piece of its release calls fails the preflight, naming it; called by a shipped piece, or published as preview, it passes (redraft 1802)', () => {
    const t = scratch();
    record(t, 'R1');
    addApi(t, apiEntry('deep.orphan', { since: 'R2' }), { orphan: true });
    expectFailNaming(check(t, 'R2'), 'a stable method nobody calls', 'deep.orphan', /no shipped piece/);
    const called = scratch();
    record(called, 'R1');
    addApi(called, apiEntry('deep.orphan', { since: 'R2' }));
    expectPass(check(called, 'R2'), 'the same method called by a shipped piece');
    const preview = scratch();
    record(preview, 'R1');
    addApi(preview, dated('deep.orphan', 'R2'), { orphan: true });
    expectPass(check(preview, 'R2'), 'the same method published as preview');
  }, 120_000);
});

describe('#139.b9c5c209 a preview entry names its tracking issue, and is used only by name: a package or a document lists it in requires.preview, or it is refused with preview_unrequested', () => {
  it('#139.b9c5c209 AC13 a preview entry with no tracking issue fails the preflight, naming it; with one it passes (redraft 1802)', () => {
    const t = scratch();
    record(t, 'R1');
    const bare = dated('deep.untracked', 'R2');
    delete (bare as { tracking?: string }).tracking;
    addApi(t, bare);
    expectFailNaming(check(t, 'R2'), 'a preview entry with no tracking issue', 'deep.untracked', /tracking/);
    const fixed = scratch();
    record(fixed, 'R1');
    addApi(fixed, dated('deep.untracked', 'R2'));
    expectPass(check(fixed, 'R2'), 'the same preview entry with its tracking issue');
  }, 120_000);
});
