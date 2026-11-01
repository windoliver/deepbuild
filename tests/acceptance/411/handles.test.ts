// AC5: deep_query returns no value read through a handle the calling session can't read: a document that binds
// another session's open ask answers ref_unresolved for that item, never its value.
//
// The document is one you share (your layer, stored as a release stores it), whose gate's fill a status binding
// reads from bravo's open ask. Bravo may read its own ask, so its query gets the value; alpha may not, so its query
// gets ref_unresolved for the gate and nothing of the ask's state anywhere in the reply.
import { describe, expect, it } from 'vitest';
import { ALPHA, BRAVO, DOC, FULL, GATE_FILL, arr, askHandle, brief, gateBoard, isObject, obj, query, rows, run, scenario, useBuilds, useEvidence, values } from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

const BRAVO_ASK = askHandle(2);
const RECORD = { [BRAVO_ASK]: { session: BRAVO.id, state: 'needs_you' } };

describe('AC5 deep_query returns no value read through a handle the calling session can\'t read', () => {
  it('AC5 a document that binds another session\'s open ask answers ref_unresolved for that item, never its value', () => {
    const ask = { items: ['gate'], paths: [GATE_FILL], at: ['0s'] };
    const [bravo, alpha] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: { document: gateBoard(BRAVO_ASK) } }, [
      query(DOC.a, ask, BRAVO.id),
      query(DOC.a, ask, ALPHA.id),
    ], { record: RECORD }));

    // Bravo reads its own ask: the gate's fill has a value.
    const value = values(bravo!, GATE_FILL)[0];
    expect(value === null || value === undefined, `bravo, whose ask it is, reads the gate's fill (${brief(bravo, 1500)})`).toBe(false);

    // Alpha can't: ref_unresolved for the gate, and no value.
    expect(values(alpha!, GATE_FILL), `alpha gets no value for the gate's fill (${brief(alpha, 1500)})`).toEqual([null]);
    const unresolved = arr(alpha!['unresolved'], 'alpha\'s unresolved list').map((u) => obj(u, 'an unresolved entry'));
    expect(unresolved.some((u) => u['path'] === GATE_FILL && u['code'] === 'ref_unresolved'), `ref_unresolved for ${GATE_FILL} (${brief(unresolved)})`).toBe(true);
    const gate = rows(alpha!).find((r) => r['id'] === 'gate');
    expect(gate?.['code'], `the gate's row answers ref_unresolved (${brief(gate)})`).toBe('ref_unresolved');
    const text = JSON.stringify(alpha);
    expect(text, 'nothing of the ask\'s state reaches alpha').not.toContain('needs_you');
    if (isObject(value) || (typeof value === 'string' && value.length >= 4)) {
      expect(text, 'bravo\'s value appears nowhere in alpha\'s reply').not.toContain(JSON.stringify(value));
    }
  });
});
