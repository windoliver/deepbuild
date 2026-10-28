// AC4: "A board with a source opens as a view of the record and a patch to it is refused with record_view,
// while the same board without a source opens as a work product that a patch edits"
//
// asserts: the board stored with `source` opens as a view of the record, which has no revisions
// (`revisions` is empty); your patch and an agent's patch to it are each refused with a `record_view` issue,
// and the board reads back unchanged. The same board without `source` opens as a work product with
// revision 0 current; your patch is applied as revision 1, current, and the board reads back edited.

import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, FULL, YOU_PEER, clone, errors, fixture, issues, obj, outcome, patchId, revisions, run, scenario, str, useBuilds, useEvidence,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** The checks board as stored, as a work product (no source) or as a view of the record (with one). */
const work = fixture('checks-board.json');
const view: JsonObject = { ...clone(work), source: { projections: ['tasks'], append: 'none' } };

const rename = (doc: string, n: number): JsonObject => ({
  patch: patchId(n), doc, base: 0, reason: 'rename the y axis',
  ops: [{ op: 'set', id: 'you.y-label', path: 'items/you.y-label/params/text', value: 'Checks run' }],
});
const labelText = (read: JsonObject): string =>
  str(obj(obj(obj(obj(read['document'], 'read: document')['items'], 'read: items')['you.y-label'], 'read: you.y-label')['params'], 'params')['text'], 'the y label\'s text');

describe('AC4 a board with a source is a view of the record that refuses patches with record_view; without one it is a work product a patch edits', () => {
  it('AC4 a board with a source opens as a view of the record: it has no revisions, and patches to it are refused with record_view', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: { panel: 'main', document: view } }, [
      { call: 'revisions', doc: DOC.a },
      { call: 'read', doc: DOC.a },
      { call: 'deep show', peer: YOU_PEER, doc: DOC.a, patch: rename(DOC.a, 1) },
      { call: 'deep_show', session: ALPHA.id, doc: DOC.a, patch: rename(DOC.a, 2) },
      { call: 'read', doc: DOC.a },
      { call: 'revisions', doc: DOC.a },
    ]));
    expect(revisions(replies[0]!), 'a view of the record has no revisions: it is rebuilt from the record').toEqual([]);
    for (const [i, who] of [[2, 'your patch'], [3, "alpha's patch"]] as const) {
      const reply = replies[i]!;
      expect(outcome(reply), `${who} to the view is refused: ${JSON.stringify(reply).slice(0, 1200)}`).toBe('refused');
      expect(errors(issues(reply)).map((x) => x.code), `${who} is refused with record_view`).toContain('record_view');
    }
    expect(labelText(replies[4]!), 'the view reads back unchanged').toBe('Checks');
    expect(replies[4]!['document'], 'the view reads back as it opened').toEqual(replies[1]!['document']);
    expect(revisions(replies[5]!), 'still no revisions after the refused patches').toEqual([]);
  });

  it('AC4 the same board without a source opens as a work product: your patch edits it as a new current revision', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: { panel: 'main', document: work } }, [
      { call: 'revisions', doc: DOC.a },
      { call: 'deep show', peer: YOU_PEER, doc: DOC.a, patch: rename(DOC.a, 3) },
      { call: 'read', doc: DOC.a },
      { call: 'revisions', doc: DOC.a },
    ]));
    const opened = revisions(replies[0]!);
    expect(opened.map((r) => [r.rev, r.state]), 'the work product opens as revision 0, current').toEqual([[0, 'current']]);
    expect(outcome(replies[1]!), `your patch to the work product applies: ${JSON.stringify(replies[1]).slice(0, 1200)}`).toBe('applied');
    expect(errors(issues(replies[1]!)).map((x) => x.code), 'no record_view on a work product').not.toContain('record_view');
    expect(labelText(replies[2]!), 'the board reads back edited').toBe('Checks run');
    const after = revisions(replies[3]!);
    expect(after.filter((r) => r.state === 'current').map((r) => r.rev), 'the patch made revision 1 current').toEqual([1]);
  });
});
