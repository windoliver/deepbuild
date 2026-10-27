// AC5 #18.9702095f A session on a Claude Code version past its facts is recorded, its holds turn watch-only and
//   health shows one reading; after the smoke test widens the range, the next session is gated again.
//
// The gate here is a guard entry in block mode (fail_closed false) that the session's Bash call matches: deep-hook
// matches it and the hub decides, so on a gated session the call is blocked, and on a watch-only one it runs and is
// only recorded (README: AC5). A session's version is the `version` its transcript's entries carry (README: The
// session's version); the range widens through DEEP_HUB_TEST_FACTS (README: Seams).

import { join } from 'node:path';
import { afterEach, beforeAll, expect, test } from 'vitest';
import {
  blocked, brief, buildDeepHook, cleanup, eventsUntil, hook, makeHome, makeWorktree, newestCovered, newSession, parse, pastFacts, payload, shown,
  startHub, stopHub, turn, widenedFacts, word, writeRules, type Ev, type Hub, type Session,
} from './helpers.ts';

beforeAll(buildDeepHook, 900_000);
afterEach(cleanup, 30_000);

/** The hook events a session's hooks map to, each of which must be recorded. */
const KINDS = ['session.start', 'user.ask', 'tool.before', 'tool.after', 'agent.stop'];
const of = (all: Ev[], s: Session) => all.filter((e) => e.session === s.id);
const hookEvents = (all: Ev[], s: Session) => of(all, s).filter((e) => KINDS.includes(e.kind));
/** Readings about the session that name the version: session.reading, the kind the hub's readings of a session take. */
const versionReadings = (all: Ev[], s: Session, version: string) => of(all, s).filter((e) => e.kind === 'session.reading' && JSON.stringify(e.data).includes(version));

/** One session's start and two turns, each running a Bash command the guard matches; the calls' replies. */
async function session(home: string, s: Session, tag: string): Promise<{ calls: Awaited<ReturnType<typeof hook>>[]; stop: Awaited<ReturnType<typeof hook>> }> {
  const started = await hook(home, s, payload(s, 'SessionStart', { source: 'resume' }));
  expect(started.code, `SessionStart of ${s.id} (Claude Code ${s.version}): ${shown(started)}`).toBe(0);
  const calls = [];
  let stop = started;
  for (const n of ['one', 'two']) {
    const t = turn(s, `Run the ${n} command.`, `echo ${tag}-${n}`);
    const prompted = await hook(home, s, t.prompt);
    expect(prompted.code, `UserPromptSubmit of ${s.id}: ${shown(prompted)}`).toBe(0);
    calls.push(await hook(home, s, t.pre));
    await hook(home, s, t.post);
    stop = await hook(home, s, t.stop);
  }
  return { calls, stop };
}

test('AC5 #18.9702095f a session past its facts is recorded unverified, its blocks go watch-only with one health reading; after the range widens the next session is gated again', async () => {
  const { tmp, home } = makeHome();
  const tag = word('g');
  writeRules(home, {
    [`deep18-${tag}`]: { match: `shell:echo ${tag}-*`, scope: 'all_repos', mode: 'block', reason: `The ${tag} commands are guarded in this test.`, next_step: 'Leave them.', fail_closed: false },
  });
  const wt = makeWorktree(join(tmp, 'wt'));
  const covered = newestCovered();
  const past = pastFacts();
  let hub: Hub = await startHub(home);

  // A session on a version past the facts.
  const s1 = newSession(home, wt, past);
  const one = await session(home, s1, tag);
  one.calls.forEach((r, i) => expect(blocked(r), `call ${i + 1} of session ${s1.id}, on Claude Code ${past} (past the facts, which cover up to ${covered}), matched a block entry and must run watch-only, not be blocked: ${shown(r)}`).toBe(false));
  const stopOut = parse(one.stop.stdout.trim());
  expect(one.stop.code === 0 && stopOut?.decision === undefined && stopOut?.continue !== false, `the stop of ${s1.id} (Claude Code ${past}) is watch-only, never held or blocked: ${shown(one.stop)}`).toBe(true);
  expect(one.stop.ms, `the stop of ${s1.id} is let through at once, never held: ${shown(one.stop)}`).toBeLessThan(20_000);

  // A session on a covered version, on the same hub, after it: still gated, so only the uncovered session went watch-only.
  const s0 = newSession(home, wt, covered);
  const zero = await session(home, s0, tag);
  zero.calls.forEach((r, i) => expect(blocked(r), `call ${i + 1} of session ${s0.id}, on Claude Code ${covered} (covered), matched a block entry and is blocked: ${shown(r)}`).toBe(true));

  let all = await eventsUntil(hub, (a) => KINDS.every((k) => of(a, s1).some((e) => e.kind === k)) && versionReadings(a, s1, past).length > 0);
  const recorded = hookEvents(all, s1);
  expect(KINDS.filter((k) => !recorded.some((e) => e.kind === k)), `session ${s1.id} on Claude Code ${past} is still recorded, every hook event; it has: ${recorded.map(brief).join('; ')}`).toEqual([]);
  expect(recorded.filter((e) => e.verified !== false).map(brief), `every event of session ${s1.id} on Claude Code ${past} is marked unverified`).toEqual([]);
  expect(recorded.some((e) => e.kind === 'tool.before' && JSON.stringify(e.data).includes(`${tag}-one`)), `the watch-only call echo ${tag}-one is recorded as a tool.before: ${recorded.map(brief).join('; ')}`).toBe(true);
  const readings = versionReadings(all, s1, past);
  expect(readings.map(brief), `health shows one reading for session ${s1.id} naming Claude Code ${past}, however many of its hooks arrive`).toHaveLength(1);
  const coveredEvents = hookEvents(all, s0);
  expect(coveredEvents.length, `session ${s0.id} on Claude Code ${covered} is recorded`).toBeGreaterThan(0);
  expect(coveredEvents.filter((e) => e.verified === false).map(brief), `the events of session ${s0.id} on a covered version are verified`).toEqual([]);

  // The live smoke test widens the range to the version: the next session on it is gated again.
  await stopHub(hub);
  hub = await startHub(home, { facts: widenedFacts(join(tmp, 'facts'), past) });
  const s2 = newSession(home, wt, past);
  const two = await session(home, s2, tag);
  two.calls.forEach((r, i) => expect(blocked(r), `call ${i + 1} of session ${s2.id}, on Claude Code ${past} after the range widened to it, matched a block entry and is blocked again: ${shown(r)}`).toBe(true));
  all = await eventsUntil(hub, (a) => KINDS.every((k) => of(a, s2).some((e) => e.kind === k)));
  const next = hookEvents(all, s2);
  expect(KINDS.filter((k) => !next.some((e) => e.kind === k)), `session ${s2.id} is recorded, every hook event: ${next.map(brief).join('; ')}`).toEqual([]);
  expect(next.filter((e) => e.verified === false).map(brief), `once the range covers ${past}, the events of session ${s2.id} are verified`).toEqual([]);
  expect(versionReadings(all, s2, past).map(brief), `session ${s2.id} on a covered ${past} gets no version reading`).toEqual([]);
}, 600_000);
