// AC1 #1810.eebcb4a2, the app's part: with two asks answered and one open, `deep` and the app's list say 1 at the same log
// position, and the app's list holds the open ask's row alone. One session, three asks; two answered through the real
// `deep inbox answer` against the real hub; the app's list is the real `deep-drive`'s `see` over a copy of that hub's
// record. Off macOS the replica can't draw, so the test is BLOCKED there, never a pass.
import { afterAll, describe, expect, test } from 'vitest';
import {
  allEventsOf, appList, cleanup, deep, drawnFailures, driveBinaries, jsonRows, makeWorld, quiet, shown, textRowFailures,
} from '../../1463/helpers.ts';
import { ANSWERED, askIds, countsIn, ID, ONE_SESSION, OPEN, oneFailures, otherOption, type Reading } from './helpers.ts';

afterAll(cleanup, 60_000);

describe(ID, () => {
  test(`${ID}: with two asks answered and one open, deep and the app's list say 1 at the same log position`, async () => {
    driveBinaries(); // BLOCKED off macOS, before any hub starts; on macOS, builds deep-drive and deep-hook.
    const w = await makeWorld(ONE_SESSION);
    expect(w.sessions.length, 'the fixture is one session').toBe(1);
    expect(w.asks.map((a) => a.question).sort(), 'the fixture raised three asks in that session').toEqual([...ANSWERED, OPEN].sort());
    const handle = (q: string): string => w.asks.find((a) => a.question === q)!.handle;
    const open = handle(OPEN);
    const answered = ANSWERED.map(handle);

    for (const q of ANSWERED) {
      const r = await deep(w, ['inbox', 'answer', handle(q), otherOption(q)]);
      expect(r.code, `deep inbox answer ${handle(q)} exits 0, once the OS confirms you: ${shown(r)}`).toBe(0);
    }
    const events = await allEventsOf(w);
    for (const q of ANSWERED) {
      const got = events.filter((e) => e.subject === handle(q) && e.kind === 'ask.answered').map((e) => e.data.answer);
      expect(got, `the record holds ${handle(q)} ("${q}") answered once, with ${otherOption(q)}`).toEqual([otherOption(q)]);
    }
    const closedOpen = events.filter((e) => e.subject === open && /^ask\.(answered|defaulted|decided|escalated|cancelled|moot|superseded)$/.test(e.kind));
    expect(closedOpen.map((e) => e.kind), `the record leaves ${open} ("${OPEN}") open`).toEqual([]);

    // One log position: deep status --json before and after bracket deep and the app's copy of the record.
    await quiet(w.hub, 5000, 60_000);
    const before = await jsonRows(w, 'status');
    const d = await deep(w, []);
    const app = await appList(w);
    const after = await jsonRows(w, 'status');
    console.log(`deep status --json at ${before.log_pos} and ${after.log_pos}; the app's list at ${String(app.log_pos)}: ${JSON.stringify(app.rows?.map((r) => [r.id, r.title, r.word]))}; its window's counts ${JSON.stringify(app.count)}\ndeep:\n${d.stdout}`);
    expect(d.code, `deep exits 0: ${shown(d)}`).toBe(0);
    if (app.rows === undefined || app.log_pos === undefined) expect.fail(`deep_drive's see must answer the list's rows and their log_pos beside its snapshot; it answered rows ${String(app.rows)} and log_pos ${String(app.log_pos)}`);

    const readings: Reading[] = [
      { who: "the app's list", log_pos: app.log_pos, counts: app.count, asks: askIds(app.rows) },
      { who: `deep (run between deep status --json at ${before.log_pos} and at ${after.log_pos})`, log_pos: before.log_pos === after.log_pos ? before.log_pos : undefined, counts: countsIn(d.stdout), asks: undefined },
      { who: 'deep status --json before', log_pos: before.log_pos, counts: undefined, asks: askIds(before.rows) },
      { who: 'deep status --json after', log_pos: after.log_pos, counts: undefined, asks: askIds(after.rows) },
    ];
    const openRows = app.rows.filter((r) => r.id === open);
    expect([
      ...oneFailures(readings, open, answered),
      ...drawnFailures(app.snapshot, openRows),
      ...textRowFailures(d.stdout, openRows, 'deep'),
    ], `deep and the app's list with ${answered.join(' and ')} answered and ${open} open`).toEqual([]);
  }, 1_800_000);
});
