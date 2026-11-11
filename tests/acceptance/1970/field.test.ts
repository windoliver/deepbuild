// AC1: "An item of `test.dot@1` (params `radius`, `fill`) that sets `w`, which `test.rect@1` defines, is refused with
// `unknown_field` whose fix names `test.rect@1` before any close name; on the merge base the fix names no kind and this
// fails, naming the field"
//
// asserts: through the document check (`deep-canvas check`) and a patch (`deep-canvas apply`), the two ways the
// issue's scope names: a document whose one item, `d`, is a test.dot@1 with radius and fill checks clean; the same
// item setting `w` is refused (`ok` false) with unknown_field at items/d/params/w; and a patch that sets
// items/d/params/w on the clean document is refused with the same issue. In each, the issue's fix names test.rect@1
// ahead of any close name: in its fix (its text, its ops or another remediation field it carries) or as the first of
// its close names, with no name by spelling before it (`kindFirstFailures`). The document holds no test.rect@1 item,
// so the kind can come only from the build. Every failure names the field w.

import { describe, expect, it } from 'vitest';
import { canvas, issuesOf, kindFirstFailures, show, useBinary, type JsonObject } from './helpers.ts';

const bin = useBinary('deep-canvas');

const DOC_ID = 'doc-1970-dot';
const WRITER = 'agent-a';
const dot = (params: JsonObject): JsonObject => ({
  format: 1, id: DOC_ID, profile: 'figure', title: 'A dot', description: 'One test.dot@1, drawn by a test agent for the #1970 suite.', size: [320, 200],
  layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } },
  items: { d: { id: 'd', kind: 'test.dot@1', layer: 'main', name: 'Dot', order: 'a0', params, at: { pos: [0, 0, 0] } } },
});
const CLEAN = dot({ radius: 1, fill: [1, 2, 3] });
const WITH_W = dot({ radius: 1, fill: [1, 2, 3], w: 10 });
/** A ULID: Crockford base 32, 26 characters. */
const PATCH_ID = `01JD1970PA${'0'.repeat(15)}1`;
const SET_W: JsonObject = { patch: PATCH_ID, doc: DOC_ID, base: 0, reason: 'give the dot a width', ops: [{ op: 'set', id: 'd', path: 'items/d/params/w', value: 10 }] };
const WANT = { id: 'd', field: 'w', kind: 'test.rect@1' };

describe('AC1 a field set on the wrong kind names the kind in the build that defines it', () => {
  it('AC1 test.dot@1 setting w is refused with unknown_field whose fix names test.rect@1 before any close name, by the check and by a patch', () => {
    const b = bin();
    const clean = canvas(b, 'check', { doc: CLEAN });
    expect(clean['ok'], `the test.dot@1 with radius and fill alone checks clean: ${show(issuesOf(clean))}`).toBe(true);

    const checked = canvas(b, 'check', { doc: WITH_W });
    expect.soft(checked['ok'], `field w on test.dot@1: the document check refuses it: ${show(checked, 2500)}`).toBe(false);
    expect.soft(kindFirstFailures(checked, { ...WANT, where: 'test.dot@1, by the document check' }), 'the document check').toEqual([]);

    const patched = canvas(b, 'apply', { doc: CLEAN, writer: WRITER, patches: [SET_W] });
    expect.soft(patched['outcome'], `field w on test.dot@1: the patch that sets it is refused: ${show(patched, 2500)}`).toBe('refused');
    expect.soft(kindFirstFailures(patched, { ...WANT, where: 'test.dot@1, by a patch' }), 'the patch').toEqual([]);
  }, 3_600_000);
});
