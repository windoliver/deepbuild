// #2897 AC4: "The record of a session says which way its client loaded the tools, and #2688's first criterion reads that
// count. A planted count that charges the whole list to a client that loads by search fails, naming the client and both
// counts"
//
// A Claude Code session bound to a real hub by its hooks, with deep set up in its config and its deep mcp initialized as
// Claude Code. The issue leaves open where in the record the way and the two counts sit (README: Open questions 4), so
// the record is read by what the issue states of it, through events.read, the session's events only: one event says the
// client loaded the tools by search (a value "search"), and the same event holds "both" counts the scope names, in
// tokens: the search way's (at most 800, AC3's bound) and the whole list's ("as #2688 counts today", at least the merge
// base's whole list). The count a reader charges the session is then read as the scope says: a client that loads by
// search is charged the search way's count. The planted count charges it the whole list's instead, and the same check
// must fail naming the client and both counts.
import { afterEach, expect, test } from 'vitest';
import { AC, START_MAX, base, tokens, type Obj } from './helpers.ts';
import { claudeWorld, cleanup, sessionEvents } from './world.ts';

afterEach(cleanup, 60_000);

const CLIENT = 'claude-code';
const BY_SEARCH = /^(by[ _-]?)?search$/i;

/** Every value in `value` with the key it sits under. */
function leaves(value: unknown, key = ''): Array<{ key: string; value: unknown }> {
  if (Array.isArray(value)) return value.flatMap((v) => leaves(v, key));
  if (value && typeof value === 'object') return Object.entries(value as Obj).flatMap(([k, v]) => leaves(v, k));
  return [{ key, value }];
}

/** The check a reader of the count makes: a client that loads by search is charged the search way's count. */
function chargeFailures(client: string, way: string, counts: { search: number; whole: number }, charged: number): string[] {
  if (!BY_SEARCH.test(way) || charged === counts.search) return [];
  return [`${client} loads its tools by search, but is charged ${charged} tokens; its count by search is ${counts.search} and the whole list's is ${counts.whole}`];
}

test(`${AC.recordCount} the record of a Claude Code session says it loaded the tools by search and holds both counts, the search way's charged to it; the same check fails a planted count that charges it the whole list, naming the client and both counts`, { timeout: 600_000 }, async () => {
  const whole = base().servers.deep!.reduce((sum, t) => sum + tokens(t), 0);
  const w = await claudeWorld();
  let found: { kind: string; search: number; whole: number; way: string } | undefined;
  let seen: string[] = [];
  for (const due = Date.now() + 30_000; !found && Date.now() < due; await new Promise((r) => setTimeout(r, 500))) {
    const events = await sessionEvents(w);
    seen = [...new Set(events.map((e) => e.kind))];
    for (const event of events) {
      const all = leaves(event.data);
      const way = all.find((l) => typeof l.value === 'string' && BY_SEARCH.test(l.value));
      if (!way) continue;
      const counts = all.filter((l) => /token/i.test(l.key) && Number.isInteger(l.value)).map((l) => l.value as number);
      const search = counts.find((n) => n > 0 && n <= START_MAX), wide = counts.find((n) => n >= whole);
      if (search !== undefined && wide !== undefined) found = { kind: event.kind, search, whole: wide, way: way.value as string };
    }
  }
  expect(found, `an event of the session says its client loaded the tools by search and holds both counts in tokens, one at most ${START_MAX} and one at least the whole list's ${whole}; the session's events are of kinds ${seen.join(', ')}`).toBeDefined();
  const counts = { search: found!.search, whole: found!.whole };
  expect(chargeFailures(CLIENT, found!.way, counts, counts.search), `the count read for the session (${found!.kind})`).toEqual([]);

  const planted = chargeFailures(CLIENT, found!.way, counts, counts.whole);
  expect(planted.some((line) => line.includes(CLIENT) && line.includes(String(counts.search)) && line.includes(String(counts.whole))),
    `the planted count that charges the whole list fails, naming ${CLIENT} and both counts: ${planted.join(' | ') || 'it passed'}`).toBe(true);
});
