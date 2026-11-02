// #907 AC3: background work holds a claim's slow checks at most 30 minutes from each stop. The scheduler on a virtual
// clock (a tick is a millisecond): a green stop with `npm run e2e` still running in the background (the session's loop
// facts, `LoopFacts.background`, README) holds the 300 s journey for 30 minutes, then the journey starts and its row, the
// held place's record, names the command. In the twin, the command's end notice wakes the agent, which reruns it in the
// background and stops again 20 minutes after the first stop: that stop gets 30 minutes of its own.
import { describe, expect, it } from 'vitest';
import { simulate, type SchedulerPlant, type ScriptEvent } from '../../../packages/gate/src/index.ts';
import { edit, mustFail, prompt, runsOf, script, stop, stopOf } from '../29/helpers.ts';
import { journey, unit } from '../29/h-c.ts';
import { AC3, E2E, J, MINUTE, running } from './helpers.ts';

const LIMIT = 30 * MINUTE;
/** The wrong program AC3 names: background work holds slow checks with no limit (README, Plants). */
const NO_LIMIT = 'holds-background-without-limit' as SchedulerPlant;
const run = (events: ScriptEvent[], plant?: SchedulerPlant) =>
  simulate({ config: { slots: 2 }, sessions: [script('B', 'claude', [unit(), journey()], events)] }, plant ? { plant } : {});
const shownRuns = (t: ReturnType<typeof run>) => runsOf(t, J).map((r) => `${r.snapshot} ${r.lane} lane, started ${r.started_at} ms (${(r.started_at / MINUTE).toFixed(2)} min)`).join('; ') || 'none';

// ---- A command that never ends.
function neverEnds(plant?: SchedulerPlant): void {
  const t = run([prompt(0, 'human'), running(500, [E2E]), edit(1000, 'S1'), stop(2000, 'S1', { id: 'green' })], plant);
  const s = stopOf(t, 'B', 1);
  console.log(`AC3 ${plant ?? 'as built'}, a command that never ends: stop at ${s.at}, ${s.kind}, replied ${s.reply_at}, line "${s.line}"; ${J}: ${shownRuns(t)}; held ${JSON.stringify(t.held.filter((h) => h.check === J))}`);
  expect(s.kind, 'the stop is green and ends the turn').toBe('ends_turn');
  expect(s.slow, `the 300 s ${J} is a slow-lane check`).toContain(J);
  const runs = runsOf(t, J, 'S1');
  expect(runs.filter((r) => r.started_at < s.at + LIMIT).map((r) => `started at ${r.started_at} ms`), `${E2E} still runs in the background, so ${J} is held for 30 minutes from the stop`).toEqual([]);
  expect(runs.length, `${J} is still pending past 30 minutes from the stop with ${E2E} still running: background work holds slow checks at most 30 minutes`).toBe(1);
  expect(runs[0]!.started_at, `${J} starts 30 minutes from the stop (${s.at + LIMIT} ms, or from its reply, ${s.reply_at + LIMIT} ms)`).toBeGreaterThanOrEqual(s.at + LIMIT);
  expect(runs[0]!.started_at).toBeLessThanOrEqual(s.reply_at + LIMIT);
  const held = t.held.find((h) => h.check === J && h.snapshot === 'S1');
  expect(held, `${J}'s held place on the stop's snapshot is recorded`).toBeDefined();
  expect(held!.started_at, 'the held place records when it started').toBe(runs[0]!.started_at);
  expect(held!.reason, `${J}'s row names the command still running`).toContain(E2E);
}

// ---- The end notice wakes the agent; it reruns the command in the background and stops 20 minutes after the first stop.
const SECOND = 2000 + 20 * MINUTE;
function ownThirty(plant?: SchedulerPlant): void {
  const notice = 18 * MINUTE;
  const t = run([
    prompt(0, 'human'), running(500, [E2E]), edit(1000, 'S1'), stop(2000, 'S1', { id: 'first' }),
    prompt(notice, 'subagent'), running(notice, []),
    edit(notice + MINUTE, 'S2'), running(19 * MINUTE, [E2E]), stop(SECOND, 'S2', { id: 'second' }),
  ], plant);
  const [first, second] = [stopOf(t, 'B', 1), stopOf(t, 'B', 2)];
  console.log(`AC3 ${plant ?? 'as built'}, a stop 20 minutes later: stops at ${first.at} and ${second.at} (replied ${second.reply_at}); ${J}: ${shownRuns(t)}; held ${JSON.stringify(t.held.filter((h) => h.check === J))}`);
  expect(second.kind, 'the second stop is green and ends the turn').toBe('ends_turn');
  expect(runsOf(t, J, 'S1').map((r) => `started at ${r.started_at} ms`), `the first stop's ${J} never starts: the agent's next turn changed its inputs while ${E2E} held it`).toEqual([]);
  expect(t.held.find((h) => h.check === J && h.snapshot === 'S1')?.replaced_by, 'the second stop takes the held place').toBe('S2');
  const runs = runsOf(t, J, 'S2');
  expect(runs.filter((r) => r.started_at < second.at + LIMIT).map((r) => `started at ${r.started_at} ms`), `the stop 20 minutes later, with ${E2E} rerun in the background, gets 30 minutes of its own: nothing starts 30 minutes from the first stop`).toEqual([]);
  expect(runs.length, `${J} starts once the second stop's 30 minutes end`).toBe(1);
  expect(runs[0]!.started_at, `30 minutes from the second stop (${second.at + LIMIT} ms, or from its reply, ${second.reply_at + LIMIT} ms)`).toBeGreaterThanOrEqual(second.at + LIMIT);
  expect(runs[0]!.started_at).toBeLessThanOrEqual(second.reply_at + LIMIT);
  expect(t.held.find((h) => h.check === J && h.snapshot === 'S2')?.reason, `${J}'s row names the command still running`).toContain(E2E);
}

describe(`${AC3} background work holds the journey at most 30 minutes from each stop`, () => {
  it(`${AC3} a green stop with \`npm run e2e\` still running holds the journey for 30 minutes, then the journey starts and the row names the command`, () => neverEnds());
  it(`${AC3} a stop 20 minutes later, after the end notice woke the agent and it reran the command in the background, gets 30 minutes of its own`, () => ownThirty());
  it(`${AC3} (wrong program) a runner with no limit (simulate plant holds-background-without-limit) leaves the journey pending past 30 minutes and fails this test`, () =>
    mustFail(NO_LIMIT, () => neverEnds(NO_LIMIT), [J, 'pending past 30 minutes']));
});
