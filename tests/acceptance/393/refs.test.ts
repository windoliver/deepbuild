import { describe, expect, it } from 'vitest';
import {
  ALPHA, BRAVO, DOC, PANELS, SESSIONS, ask, board, current, issues, label, outcome, reading, rect, run, snapshots, useEvidence, useShowBinary,
  type JsonObject,
} from './helpers.ts';

useShowBinary();
const evidence = useEvidence();

const ALPHA_ASK = ask(1);
const BRAVO_ASK = ask(2);
const ALPHA_READING = reading(1);
const BRAVO_READING = reading(2);
/** The record's objects and the session each belongs to: two open asks and two readings. */
const RECORD: JsonObject = {
  [ALPHA_ASK]: { session: ALPHA.id, state: 'needs_you' },
  [BRAVO_ASK]: { session: BRAVO.id, state: 'needs_you' },
  [ALPHA_READING]: { session: ALPHA.id, value: 3, as_of: 0 },
  [BRAVO_READING]: { session: BRAVO.id, value: 7, as_of: 0 },
};

/** A status mark bound to an ask's state, and a count bound to a reading. */
function bound(askHandle: string, readingHandle: string): JsonObject {
  return board('Open asks', [320, 120], [
    rect('back', 'Backdrop', [0, 0, 320, 120], 'a0', 'ground'),
    { id: 'gate', kind: 'rect@1', name: 'Ask state', order: 'a1', params: { box: [16, 16, 96, 24] } },
    label('title', 'Title', 'Open asks', [128, 18], 'a2'),
    { id: 'count', kind: 'text@1', name: 'Open asks count', order: 'a3', params: { text: '', font: 'body', size: 13, numerals: 'tabular', widest: '999', box: { w: 160, h: 20 } }, at: { pos: [16, 64, 0] } },
  ], {
    status_bindings: { 'gate-state': { target: 'items/gate/params/paint/fill', source: askHandle } },
    bound_values: { 'open-count': { target: 'items/count/params/text', source: readingHandle } },
  });
}

const show = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC.a, document, size: [320, 120], include: ['issues', 'pixels'] });
const scenario = (calls: JsonObject[]): JsonObject => ({ evidence: evidence(), sessions: SESSIONS, panels: PANELS, record: RECORD, docs: { [DOC.a]: { panel: 'main' } }, calls });

/** The reply is refused with ref_unresolved naming the handle, and carries no snapshot. */
function expectRefusedNaming(reply: JsonObject, handle: string, what: string): void {
  expect(outcome(reply), `${what}: refused`).toBe('refused');
  const named = issues(reply).filter((i) => i.code === 'ref_unresolved' && i.actual === handle);
  expect(named.length, `${what}: a ref_unresolved issue names ${handle} (issues ${JSON.stringify(reply['issues']).slice(0, 800)})`).toBeGreaterThan(0);
  expect(snapshots(reply), `${what}: render-back returns no snapshot of it`).toEqual([]);
}

describe('AC5 a deep_show document that binds a value or a status to a handle its session\'s credential can\'t read is refused with ref_unresolved naming the handle, and render-back returns no snapshot of it', () => {
  it('AC5 bound to its own session\'s open ask and reading, the document is presented with a snapshot', () => {
    const reply = run(scenario([show(bound(ALPHA_ASK, ALPHA_READING))])).replies[0]!;
    expect(outcome(reply), 'presented').toBe('presented');
    expect(issues(reply).filter((i) => i.code === 'ref_unresolved'), 'no handle is unresolved').toEqual([]);
    expect(snapshots(reply).length, 'with a snapshot').toBe(1);
  });

  it('AC5 a status bound to another session\'s open ask is refused with ref_unresolved naming the ask, with no snapshot', () => {
    expectRefusedNaming(run(scenario([show(bound(BRAVO_ASK, ALPHA_READING))])).replies[0]!, BRAVO_ASK, 'a status bound to bravo\'s open ask');
  });

  it('AC5 a value bound to another session\'s reading is refused with ref_unresolved naming the reading, with no snapshot', () => {
    expectRefusedNaming(run(scenario([show(bound(ALPHA_ASK, BRAVO_READING))])).replies[0]!, BRAVO_READING, 'a value bound to bravo\'s reading');
  });

  it('AC5 after a good revision, one that binds another session\'s ask is refused with no snapshot, and the good one stays current', () => {
    const { replies } = run(scenario([show(bound(ALPHA_ASK, ALPHA_READING)), { call: 'revisions', doc: DOC.a }, show(bound(BRAVO_ASK, ALPHA_READING)), { call: 'revisions', doc: DOC.a }]));
    expect(outcome(replies[0]!), 'the good revision is presented').toBe('presented');
    expectRefusedNaming(replies[2]!, BRAVO_ASK, 'the later revision bound to bravo\'s open ask');
    expect(current(replies[3]!).hash, 'the good revision stays current').toBe(current(replies[1]!).hash);
  });
});
