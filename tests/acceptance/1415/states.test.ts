// #1415 AC1, AC2 and AC3 on the canvas core (`deep-show run`): a patch to a frozen session, a patch to a closed session, and the
// walk over the served state table (README: Surface choices, The state table, How the walk reaches each state).

import { describe, expect, it } from 'vitest';
import {
  P, SUCCESS, TABLE, TEST_MS, brief, close, codesOf, currentOf, defaultBinary, frame, patch, play, readTable, revisions, rowsChange,
  rowsOf, sameRows, scenario, set, useBoomBinary, useScratch, walk, type JsonObject,
} from './helpers.ts';

useScratch();
const boom = useBoomBinary();

/** The patch-result `rev` is the revision the patch made, else the current one: a refused patch names the current one or none. */
const revNamed = (reply: JsonObject): number | undefined => (typeof reply['rev'] === 'number' ? reply['rev'] : undefined);

describe('#1415: canvas session states', () => {
  // AC1: "A patch to a frozen session is refused with `session_frozen`, naming the last good revision, and changes no revision"
  it('AC1 a patch to a session an operator panic froze is refused with session_frozen, naming the last good revision (2), and changes no revision', () => {
    const run = play(boom(), scenario([
      patch(P(1), 0, [set('card', 'params/box', [0, 0, 64, 30])]),
      patch(P(2), 1, [set('card', 'params/box', [0, 0, 66, 30])]),
      frame('0s'),
      frame('2s'),
      revisions(),
      patch(P(3), 2, [set('tag', 'params/box', [0, 0, 24, 10])]),
      revisions(),
    ], { fuse: true }));
    expect(run.ok, `deep-show run (the test build with test-boom) answered ${String(run.code)} for the frozen-session scenario`).toBe(true);
    const [p1, p2, at0, at2, before, refused, after] = run.replies as [JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject];
    // The setup: revisions 1 and 2 by alpha, revision 2 evaluated at 0 s, then frozen by test.boom@1's panic at 2 s, as built.
    expect([p1['outcome'], p1['rev'], p2['outcome'], p2['rev']], `alpha's two patches make revisions 1 and 2: ${brief(p1)} ${brief(p2)}`).toEqual(['applied', 1, 'applied', 2]);
    expect(at0['outcome'], `revision 2 evaluates at 0 s: ${brief(at0)}`).toBe('evaluated');
    const froze = at2['outcome'] === 'frozen' || codesOf(at2).some((c) => c === 'session_frozen' || c === 'operator_panic');
    expect(froze, `the frame at 2 s freezes the session (test.boom@1 panics at or after 1 s): ${brief(at2)}`).toBe(true);
    // The criterion.
    expect(codesOf(refused), `the patch to the frozen session is refused with session_frozen: ${brief(refused)}`).toContain('session_frozen');
    expect(refused['outcome'], `the patch to the frozen session answers refused, never a success: ${brief(refused)}`).toBe('refused');
    expect(refused['last_good_rev'], `the refusal names the last good revision, 2, as last_good_rev: ${brief(refused)}`).toBe(2);
    const named = revNamed(refused);
    if (named !== undefined) expect(named, `the refusal's rev is the current revision, 2, not a new one: ${brief(refused)}`).toBe(2);
    expect(sameRows(rowsOf(before), rowsOf(after)), `the refused patch changes no revision: ${rowsChange(rowsOf(before), rowsOf(after))}`).toBe(true);
    expect(currentOf(rowsOf(after) ?? [])?.rev, 'revision 2 is still the current one').toBe(2);
  }, TEST_MS);

  // AC2: "A patch to a closed session is refused with `session_closed`"
  it('AC2 a patch to a session closed with `close` is refused with session_closed and changes no revision', () => {
    const run = play(defaultBinary(), scenario([
      patch(P(1), 0, [set('card', 'params/box', [0, 0, 64, 30])]),
      close(),
      revisions(),
      patch(P(2), 1, [set('tag', 'params/box', [0, 0, 24, 10])]),
      revisions(),
    ]));
    expect(run.ok, `deep-show run answered ${String(run.code)} for the scenario with {"call": "close", "doc"}: no call closes a document session (README: Surface choices, close)`).toBe(true);
    const [p1, closed, before, refused, after] = run.replies as [JsonObject, JsonObject, JsonObject, JsonObject, JsonObject];
    expect([p1['outcome'], p1['rev']], `alpha's patch makes revision 1: ${brief(p1)}`).toEqual(['applied', 1]);
    expect(closed['outcome'], `close answers closed: ${brief(closed)}`).toBe('closed');
    expect(codesOf(refused), `the patch to the closed session is refused with session_closed: ${brief(refused)}`).toContain('session_closed');
    expect(SUCCESS, `the patch to the closed session never answers a success: ${brief(refused)}`).not.toContain(refused['outcome']);
    const named = revNamed(refused);
    if (named !== undefined) expect(named, `the refusal's rev is the current revision, 1, not a new one: ${brief(refused)}`).toBe(1);
    expect(sameRows(rowsOf(before), rowsOf(after)), `the refused patch changes no revision: ${rowsChange(rowsOf(before), rowsOf(after))}`).toBe(true);
  }, TEST_MS);

  // AC3: "Every call in every state either acts or returns a named code: a generated test walks the table"
  it('AC3 the walk: every call in every state of the served state table either acts or answers the code its cell names', () => {
    const served = play(defaultBinary(), scenario([TABLE]));
    expect(served.ok, `deep-show run answers {"call": "session_table"}, the state table served (README: The state table); it answered ${String(served.code)}`).toBe(true);
    const table = readTable(served.replies[0]!);
    expect(table.failures, 'the served table holds every state against every call, each cell acting or naming a code').toEqual([]);
    expect(walk(boom(), table.cells), 'the walk over the table (each failure names its state and call)').toEqual([]);
  }, 3_600_000);
});
