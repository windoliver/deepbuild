// AC11 (#139): the contract step classifies each change against the previous release. A minor may only add: an optional
// field, a code or a member of an extensible set pass with no break file; a field removed, retyped or made required, a
// member added to an exhaustive set, or a field that can deny, block, answer or lower a verdict (marked `x-acts` in
// the schema) fails, naming the entry and the field, unless the entry takes a new major (a new numbered name).
// The entry is the published API method `deep.shape`, recorded in R1 with this shape; each case edits a copy of the
// R1 tree and runs the step for R2.
import { describe, expect, it } from 'vitest';
import { addApi, apiEntry, check, expectFailNaming, expectPass, fork, record, reshapeApi, scratch, shown, type Json, type StepPlant, type Tree } from './helpers.ts';

const closure = (mark: 'extensible' | 'exhaustive') => ({ closed: 'the members this release lists', reopens: mark === 'extensible' ? 'a minor that adds a code' : 'a new major', mark });
const SHAPE = {
  type: 'object',
  properties: {
    type: { type: 'string', minLength: 1 },
    mode: { type: 'string', enum: ['a'], 'x-closure': closure('extensible') },
    phase: { type: 'string', enum: ['x'], 'x-closure': closure('exhaustive') },
  },
  required: ['type'],
  additionalProperties: false,
};
let base: Tree | undefined;
/** A fork of the R1 tree: `deep.shape` published and recorded. */
function r1(): Tree {
  if (!base) {
    base = scratch('classify');
    addApi(base, apiEntry('deep.shape', { params: structuredClone(SHAPE) }));
    record(base, 'R1');
  }
  return fork(base);
}
const reshape = (t: Tree, fn: (params: Json) => void): Tree => { reshapeApi(t, 'deep.shape', fn); return t; };

const PASSING: [string, (p: Json) => void][] = [
  ['an optional field added', (p) => { p.properties.note = { type: 'string' }; }],
  ['a member added to an extensible set (a code)', (p) => { p.properties.mode.enum.push('b'); }],
];
const FAILING: [string, string, (p: Json) => void][] = [
  ['a field removed', 'mode', (p) => { delete p.properties.mode; }],
  ['a field retyped', 'type', (p) => { p.properties.type = { type: 'integer' }; }],
  ['a field made required', 'mode', (p) => { p.required.push('mode'); }],
  ['a member added to an exhaustive set', 'phase', (p) => { p.properties.phase.enum.push('y'); }],
  ['an optional field that can deny added', 'deny', (p) => { p.properties.deny = { type: 'string', 'x-acts': 'deny' }; }],
];

/** The planted `deny` field in a minor. Throws what the criterion names when the step passes it. */
function denyInAMinor(plant?: StepPlant): void {
  const t = reshape(r1(), (p) => { p.properties.deny = { type: 'string', 'x-acts': 'deny' }; });
  const r = check(t, 'R2', { plant });
  if (r.code === 0) throw Error(`a step that passes every additive change let the planted deny field through: ${shown(r)}`);
  expectFailNaming(r, 'the planted deny field', 'deep.shape', 'deny');
}

describe('#139.f86cd0ad the contract step classifies each change against the previous release', () => {
  it('AC11 the unchanged entry passes (the pass side of the cases below)', () => {
    expectPass(check(r1(), 'R2'), 'the entry as it was');
  }, 120_000);

  for (const [what, fn] of PASSING) {
    it(`AC11 ${what} in a minor passes with no break file`, () => {
      expectPass(check(reshape(r1(), fn), 'R2'), what);
    }, 120_000);
  }

  for (const [what, field, fn] of FAILING) {
    it(`AC11 ${what} in a minor fails, naming the entry and the field ${field}`, () => {
      expectFailNaming(check(reshape(r1(), fn), 'R2'), what, 'deep.shape', field);
    }, 120_000);
  }

  it('AC11 the same reshaping under a new numbered name, the old name kept as it was, passes: the entry took a new major', () => {
    const t = r1();
    addApi(t, apiEntry('deep.shape2', { since: 'R2', params: (() => { const p = structuredClone(SHAPE) as Json; delete p.properties.mode; return p; })() }));
    expectPass(check(t, 'R2'), 'a removed field under deep.shape2');
  }, 120_000);

  it('AC11 (wrong program) a step that passes every additive change lets the planted deny field through, and this test fails it', () => {
    expect(() => denyInAMinor('pass-every-additive')).toThrow(/a step that passes every additive change let the planted deny field through/);
  }, 120_000);

  it('AC11 the real step fails the planted deny field (the test above passes the wrong program through this same assertion)', () => {
    denyInAMinor();
  }, 120_000);
});
