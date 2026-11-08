// #1501 AC1: with the hub up, a Claude Code session whose transcript names 9.9.9 (a version the facts don't list) is
// watch-only, yet an Edit of .deepbuild/done.yaml, a Write of ~/.claude/settings.json, `deep off` and
// `rm -rf "$X"/*` are each denied by the hub, naming the fail_closed guard in its own words. On the base the hub
// records each and lets it run, and this test fails naming the call. Scope: the session's health reading says the
// floor still holds. Every decision is the real deep-hook's, taken only when it printed the real hub's own reply
// (helpers.ts, hubDecides); no planted call runs.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  UNLISTED, ac1Calls, assertUnlisted, brief, buildDeepHook, cleanup, decision, eventsUntil, floorNamed, hubDecides,
  readingText, shown, startSession, versionReadings, who, world,
} from './helpers.ts';

beforeAll(buildDeepHook, 900_000);
afterEach(cleanup, 60_000);

describe('AC1 #1501.840c5fe8 with the hub up, in a session whose transcript names a version the facts don\'t list, an Edit of .deepbuild/done.yaml, a write of ~/.claude/settings.json, deep off and rm -rf "$X"/* are each denied, naming the guard', () => {
  it(`AC1 a session on Claude Code ${UNLISTED}, hub up: the hub denies each of the four calls, naming a fail_closed guard with its reason`, async () => {
    assertUnlisted();
    const w = await world();
    const s = await startSession(w, UNLISTED);
    const failures: string[] = [];
    for (const call of ac1Calls(w)) {
      const { ran } = await hubDecides(w, s, call);
      const at = `\`${call.label}\` with the hub up, ${who(s)} (a version the facts don't list)`;
      if (decision(ran) !== 'deny') failures.push(`${at} must be denied by the floor; the hub let it run: ${shown(ran)}`);
      else if (!floorNamed(ran, w.rules).length) failures.push(`${at}: the denial names no fail_closed guard ("guard <name>") with that entry's reason: ${shown(ran)}`);
    }
    expect(failures, 'every call AC1 names is denied by the hub, naming its guard').toEqual([]);
  }, 600_000);

  it(`AC1 (scope) the health reading of a session on Claude Code ${UNLISTED} says the floor still holds`, async () => {
    const w = await world();
    const s = await startSession(w, UNLISTED);
    // A call that matches an entry makes the hub read the session's version (the floor's Edit of the spec).
    await hubDecides(w, s, ac1Calls(w)[0]!);
    const all = await eventsUntil(w.home, (a) => versionReadings(a, s).length > 0);
    const readings = versionReadings(all, s);
    expect(readings.map(brief), `${who(s)} gets its one health reading naming ${UNLISTED}`).not.toEqual([]);
    // Wording-tolerant: the reading names the floor, or the fail_closed entries, as still holding.
    const FLOOR = /\b(floor|fail[_ -]?closed)\b/i;
    expect(readings.filter((e) => FLOOR.test(readingText(e))).map(brief), `the health reading of ${who(s)} says the floor (the fail_closed entries) still holds: ${readings.map(readingText).join(' | ')}`).not.toEqual([]);
  }, 600_000);
});
