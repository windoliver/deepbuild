import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, PANELS, SESSIONS, clone, current, diff, fixture, outcome, removalFailures, revisions, run, sorted, useEvidence, useShowBinary,
  type JsonObject,
} from './helpers.ts';

useShowBinary();
const evidence = useEvidence();

/** The test agent's document: 14 items (seven bars and their labels) and two section markers. */
const FOURTEEN = fixture('fourteen.json');
const ITEMS = sorted(Object.keys(FOURTEEN['items'] as JsonObject));
const MARKERS = sorted(Object.keys(FOURTEEN['markers'] as JsonObject));
/** What /compact leaves the agent with: nine of the fourteen. */
const DROPPED = sorted(['row-3', 'label-3', 'row-6', 'label-6', 'label-7']);
const KEPT = ITEMS.filter((id) => !DROPPED.includes(id));

function without(doc: JsonObject, section: string, ids: readonly string[]): JsonObject {
  const out = clone(doc);
  for (const id of ids) delete (out[section] as JsonObject)[id];
  return out;
}

const show = (document: JsonObject, removes?: string[]): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc: DOC.a, document, ...(removes ? { removes } : {}), include: ['issues'] });
const scenario = (calls: JsonObject[], planted?: string): JsonObject =>
  ({ evidence: evidence(), sessions: SESSIONS, panels: PANELS, docs: { [DOC.a]: { panel: 'main' } }, calls, ...(planted ? { planted } : {}) });
const state: JsonObject = { call: 'revisions', doc: DOC.a };

describe('AC7 a whole revision keeps its items: one that drops IDs it doesn\'t name in removes is refused with unintended_removal, and the reply lists the IDs changed, unchanged, created and removed', () => {
  it('AC7 the 14-item document re-sent as after /compact with 9 of them and no removes is refused with unintended_removal naming exactly the five missing IDs, and the 14-item revision stays current, by hash', () => {
    expect(ITEMS.length, 'the fixture holds 14 items').toBe(14);
    expect(KEPT.length, 'nine are re-sent').toBe(9);
    const nine = without(FOURTEEN, 'items', DROPPED);
    const { replies } = run(scenario([show(FOURTEEN), state, show(nine), state]));
    const [first, before, refused, after] = replies as [JsonObject, JsonObject, JsonObject, JsonObject];
    expect(outcome(first), 'the 14-item revision is presented').toBe('presented');
    expect(diff(first), 'its reply lists all 14 items and both markers as created').toEqual({ changed: [], unchanged: [], created: sorted([...ITEMS, ...MARKERS]), removed: [] });
    const fourteen = current(before);
    expect(removalFailures(refused, DROPPED), 'the 9-item re-send with no removes is refused with unintended_removal naming exactly the five missing IDs').toEqual([]);
    const now = current(after);
    expect([now.rev, now.hash], 'the 14-item revision stays current, by hash').toEqual([fourteen.rev, fourteen.hash]);
    expect(revisions(after).filter((r) => r.hash !== fourteen.hash && r.state === 'current'), 'no other revision became current').toEqual([]);
  });

  it('AC7 the same 9 with those five in removes is presented, its reply listing the five as removed and the nine as unchanged', () => {
    const nine = without(FOURTEEN, 'items', DROPPED);
    const { replies } = run(scenario([show(FOURTEEN), state, show(nine, DROPPED), state]));
    const [, before, presented, after] = replies as [JsonObject, JsonObject, JsonObject, JsonObject];
    expect(outcome(presented), 'the 9-item revision that names the five in removes is presented').toBe('presented');
    // The diff covers every ID the writer's layer holds in every map keyed by ID, so the two markers,
    // kept, are listed as unchanged beside the nine items.
    expect(diff(presented), 'the reply lists the five as removed and the nine (with the two kept markers) as unchanged').toEqual({
      changed: [], unchanged: sorted([...KEPT, ...MARKERS]), created: [], removed: DROPPED,
    });
    expect(current(after).hash, 'the 9-item revision is now current, a new hash').not.toBe(current(before).hash);
  });

  it('AC7 from the 14-item revision, all 14 re-sent with one label\'s text changed reply with that ID as changed and the other 13 as unchanged', () => {
    const edited = clone(FOURTEEN);
    (((edited['items'] as JsonObject)['label-2'] as JsonObject)['params'] as JsonObject)['text'] = 'Bravo, revised';
    const { replies } = run(scenario([show(FOURTEEN), state, show(edited), state]));
    const [, before, presented, after] = replies as [JsonObject, JsonObject, JsonObject, JsonObject];
    expect(outcome(presented), 'the edited revision is presented').toBe('presented');
    expect(diff(presented), 'label-2 is changed; the other 13 items (and both markers) are unchanged').toEqual({
      changed: ['label-2'], unchanged: sorted([...ITEMS.filter((id) => id !== 'label-2'), ...MARKERS]), created: [], removed: [],
    });
    expect(current(after).hash, 'the edited revision is current under a new hash').not.toBe(current(before).hash);
  });

  it('AC7 a planted deep_show that presents the 9-item revision fails this check, naming the five IDs it dropped', () => {
    const nine = without(FOURTEEN, 'items', DROPPED);
    const { replies } = run(scenario([show(FOURTEEN), show(nine)], 'presents_unnamed_removal'));
    const failures = removalFailures(replies[1]!, DROPPED);
    expect(failures.length, 'the check fails on the planted deep_show').toBeGreaterThan(0);
    for (const id of DROPPED) expect(failures.join('\n'), `the failure names ${id}`).toContain(id);
  });

  it('AC7 a re-send that keeps all 14 items but leaves out one of the two markers is refused naming the marker; a planted deep_show that diffs only the items map fails, naming the marker', () => {
    const noReview = without(FOURTEEN, 'markers', ['review']);
    const real = run(scenario([show(FOURTEEN), state, show(noReview), state])).replies;
    expect(removalFailures(real[2]!, ['review']), 'the re-send that drops the review marker is refused with unintended_removal naming it').toEqual([]);
    expect(current(real[3]!).hash, 'and the 14-item revision with both markers stays current').toBe(current(real[1]!).hash);
    const planted = run(scenario([show(FOURTEEN), show(noReview)], 'diffs_items_only')).replies;
    const failures = removalFailures(planted[1]!, ['review']);
    expect(failures.length, 'the check fails on the planted deep_show that diffs only the items map').toBeGreaterThan(0);
    expect(failures.join('\n'), 'naming the marker').toContain('review');
  });
});
