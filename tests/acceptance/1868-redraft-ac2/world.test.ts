// #1868 criterion 2 (README): a reading recorded after the world was built shows in the next deep_show's world, and an
// ask answered since shows as done; a planted world built once at start reads the old values and fails, naming the
// reading. A real hub; deep_show and deep_query through the board session's own `deep mcp`; the reading recorded by the
// hub itself, as two sessions' claims share a check (#1018's carried-check readings); the ask answered through the
// hub's `ask.answer`. The planted wrong program is the twin `world-built-once` (twins.json).
import { afterEach, describe, expect, it } from 'vitest';
import { STATE_PATH, VALUE_PATH, askBoard, carryOnce, cleanup, eventsOf, hubCall, openWorld, query, readingBoard, show, type JsonObject } from './helpers.ts';

afterEach(cleanup, 60_000);

/** What deep_show's reply says of a board: its outcome and each issue's code, path and words. */
const said = (reply: JsonObject): JsonObject => ({
  outcome: reply['outcome'] ?? null,
  issues: (Array.isArray(reply['issues']) ? reply['issues'] : []).map((i) => {
    const issue = i as JsonObject;
    return { code: issue['code'] ?? null, severity: issue['severity'] ?? null, path: issue['path'] ?? null, what: issue['what'] ?? null };
  }),
});
const brief = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);

describe("#1868.a903f1c6 a reading recorded after the world was built shows in the next deep_show's world, and an ask answered since shows as done; a planted world built once at start reads the old values and fails, naming the reading", () => {
  it("#1868.a903f1c6 after the board's first deep_show, a carried check's reading the hub records and an ask answered through the hub both show in the next deep_show", async () => {
    const o = await openWorld();

    // The world is built: the board session's deep_shows of a status mark bound to each of its asks. The ask answered
    // before the hub started shows how an answered ask reads; the open one reads needs_you.
    const done = said(await show(o, askBoard('Font ask', o.answered), 'deep_show of the ask answered before the hub started'));
    const openBoard = askBoard('Header colour ask', o.open);
    const open = await show(o, openBoard, 'deep_show of the open ask');
    expect(open['outcome'], `the open ask ${o.open}'s status mark is presented: ${brief(open)}`).toBe('presented');
    const before = await query(o, openBoard, [STATE_PATH], "deep_query of the open ask's status mark");
    const state = ((before['values'] as JsonObject | undefined)?.[STATE_PATH] as JsonObject[] | undefined)?.[0];
    expect(state?.['status'], `the open ask ${o.open} reads needs_you in the first deep_show's world: ${brief(before)}`).toBe('needs_you');
    if (JSON.stringify(said(open)) === JSON.stringify(done)) throw Error(`INCONCLUSIVE: an open ask and an answered one read alike through deep_show (${brief(done)}), so this test can't tell an answer`);
    const built = Math.max(...(await eventsOf(o)).map((e) => e.log_pos));

    // Since then: the hub records a reading (a check carried across sessions) and you answer the open ask.
    await carryOnce(o);
    const recorded = (await eventsOf(o)).filter((e) => e.kind === 'reading.recorded' && e.log_pos > built && /^runs saved by carrying across sessions/.test(String(e.data['source'])));
    if (!recorded.length) throw Error(`BLOCKED: the hub recorded no carried check's reading after the world was built (log_pos ${built}); the second claim didn't read the first one's run as carried`);
    const reading = recorded[0]!;
    const handle = String(reading.data['reading']);
    const answered = await hubCall(o.hub, 'ask.answer', { ask: o.open, option: 'green' });
    expect(answered['ask'], `ask.answer answers ${o.open}: ${brief(answered)}`).toBe(o.open);

    // The next deep_show's world holds the reading: a count bound to it is presented, not refused as unreadable.
    const counted = readingBoard('Saved by carrying', handle);
    const shown = await show(o, counted, `deep_show of a count bound to ${handle}`);
    const issues = said(shown)['issues'] as JsonObject[];
    expect({ outcome: shown['outcome'], unresolved: issues.filter((i) => i['code'] === 'ref_unresolved') }, `the reading ${handle} (value ${String(reading.data['value'])} ${String(reading.data['unit'])}, "${String(reading.data['source'])}"), recorded at log_pos ${reading.log_pos} after the world was built at log_pos ${built}, must show in the next deep_show's world; deep_show said ${brief(shown)}`).toEqual({ outcome: 'presented', unresolved: [] });
    const rows = await query(o, counted, [VALUE_PATH], `deep_query of the count bound to ${handle}`);
    expect({ rev: rows['rev'], unresolved: rows['unresolved'] }, `deep_query reads the revision that binds ${handle}, with nothing unresolved: ${brief(rows)}`).toEqual({ rev: shown['rev'], unresolved: [] });

    // And the ask answered since reads as the ask answered before the start does, no longer as it did open.
    const again = said(await show(o, askBoard('Header colour ask, answered', o.open), 'deep_show of the ask answered since'));
    expect(again, `the ask ${o.open}, answered through the hub after the world was built, must show as done in the next deep_show, as ${o.answered} (answered before the start) does${JSON.stringify(again) === JSON.stringify(said(open)) ? '; it still reads as it did open' : ''}`).toEqual(done);
  }, 900_000);
});
