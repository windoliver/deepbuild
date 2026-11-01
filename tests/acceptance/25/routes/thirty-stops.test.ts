// AC12 #25.11b719ba Thirty Stops in one Claude Code session leave one waiter process for that session, under 5 MB; a
// host that starts a waiter at each Stop leaves thirty and fails this test, naming the count.
//
// Claude Code starts DeepBuild's waiter entry at every Stop and, in the desktop app, leaves the earlier ones running
// (#80: "Earlier waiters keep running in the desktop app ... the adapter must end the old waiter itself"); the
// stand-in does the same. One session runs thirty turns, each a prompt you type, the agent's reply and its Stop. Then
// the waiters still running for the session are counted: the stand-in's background asyncRewake runs of DeepBuild's
// entry that haven't exited and still have a live process in their process group. The one left is measured as the
// resident size of every live process in its group, from `ps`.
//
// Amended Oct 29 (#85): Claude Code starts the waiter at a Stop or at a StopFailure, and the hub keeps one live
// waiter per session, the newest; a new one replaces the one before, which exits without waking. So the one left after
// the thirty Stops must be the one started at the thirtieth. And in a session whose fourth turn ends on an API error
// after three that ended in a Stop (Claude Code writes the error's entry, then fires StopFailure and no Stop), the one
// left must be the waiter Claude Code started at that StopFailure, and no earlier waiter may have woken the session on
// its way out. The error is `invalid_request` (helpers' API_ERROR), a cause the design gives no automatic continue and
// no unblock task, so nothing should wake the session and end that waiter. A host that never ends an earlier waiter
// (`waiter-per-stop`) leaves four, and fails naming the count; one that writes no waiter entry under StopFailure (the
// merge base) fails naming that.

import { afterAll, describe, expect, it } from 'vitest';
import {
  API_ERROR, Claude, apiError, assistantSays, cleanup, firedShown, groupOf, isDeepBuild, makeHome, newSession, payload, processes, setup, sleep, startHub, typedPrompt,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'waiter-per-stop';
const STOPS = 30;
/** The live waiters for a session once they have had 15 s to settle to one. */
async function settled(claude: Claude, session: string): Promise<Awaited<ReturnType<Claude['liveWaiters']>>> {
  let live = await claude.liveWaiters(session);
  const deadline = Date.now() + 15_000;
  while (live.length !== 1 && Date.now() < deadline) { await sleep(500); live = await claude.liveWaiters(session); }
  return live;
}

async function scenario(plant?: string): Promise<void> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  await startHub(home, { plant });
  await setup(home, env);
  const s = newSession(home);
  const claude = Claude.start(home, env);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  for (let i = 1; i <= STOPS; i++) {
    const text = `Step ${i}: print the date.`;
    typedPrompt(s, text);
    await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
    assistantSays(s, `Step ${i} done.`);
    const fired = await claude.hook('Stop', payload(s, 'Stop', { last_assistant_message: `Step ${i} done.` }));
    expect(fired.blocked, `stop ${i} of a session with nothing to deliver goes through: ${firedShown(fired)}`).toBeUndefined();
  }
  const started = (await claude.background()).filter((r) => r.asyncRewake && r.session === s.id).length;
  expect(started, 'the control: Claude Code started DeepBuild\'s waiter at each of the thirty Stops').toBe(STOPS);

  // Give the waiters 15 s to settle, then count the ones still running for the session.
  const live = await settled(claude, s.id);
  if (live.length !== 1) throw Error(`AC12 thirty Stops in one session must leave one waiter process for it; they left ${live.length} (pids ${live.map((r) => r.pid).join(', ') || 'none'})`);
  const newest = Math.max(...(await claude.background()).filter((r) => r.asyncRewake && r.session === s.id).map((r) => r.started));
  if (live[0]!.started !== newest) throw Error(`AC12 the one waiter left for the session must be the newest, started at the thirtieth Stop; pid ${live[0]!.pid} was started at ${live[0]!.started}, the newest at ${newest}`);
  await sleep(2000);
  const table = processes();
  const group = groupOf(live[0]!.pid, table);
  const kb = group.reduce((sum, p) => sum + p.rssKb, 0);
  if (kb >= 5 * 1024) throw Error(`AC12 the one waiter left for the session must be under 5 MB; its processes hold ${kb} KB resident: ${JSON.stringify(group.map((p) => ({ pid: p.pid, rssKb: p.rssKb, command: p.command.slice(0, 200) })))}`);
}

/** Three turns that end in a Stop, then a fourth that ends on an API error; what is left of the session's waiters. */
async function failureScenario(plant?: string): Promise<void> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  await startHub(home, { plant });
  await setup(home, env);
  const s = newSession(home);
  const claude = Claude.start(home, env);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  for (let i = 1; i <= 3; i++) {
    const text = `Step ${i}: print the date.`;
    typedPrompt(s, text);
    await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
    assistantSays(s, `Step ${i} done.`);
    const fired = await claude.hook('Stop', payload(s, 'Stop', { last_assistant_message: `Step ${i} done.` }));
    expect(fired.blocked, `stop ${i} of a session with nothing to deliver goes through: ${firedShown(fired)}`).toBeUndefined();
  }
  const text = 'Step 4: print the date.';
  typedPrompt(s, text);
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
  apiError(s);
  const fired = await claude.hook('StopFailure', payload(s, 'StopFailure'));
  const failed = fired.background.filter((r) => r.asyncRewake && isDeepBuild(r.command));
  if (failed.length !== 1) throw Error(`AC12 Claude Code started no waiter at the session's StopFailure (error ${API_ERROR}): DeepBuild's settings hold no waiter entry under StopFailure: ${firedShown(fired)}`);
  const started = (await claude.background()).filter((r) => r.asyncRewake && r.session === s.id);
  expect(started.map((r) => r.event), 'the control: Claude Code started DeepBuild\'s waiter at each of the three Stops and at the StopFailure').toEqual(['Stop', 'Stop', 'Stop', 'StopFailure']);

  // Give the waiters 15 s to settle, then count the ones still running for the session.
  const live = await settled(claude, s.id);
  if (live.length !== 1) throw Error(`AC12 three Stops and a StopFailure in one session must leave one waiter process for it; they left ${live.length} (pids ${live.map((r) => r.pid).join(', ') || 'none'}, started at ${live.map((r) => r.event).join(', ') || 'none'})`);
  if (live[0]!.pid !== failed[0]!.pid) throw Error(`AC12 the one waiter left must be the newest, the one Claude Code started at the StopFailure (pid ${failed[0]!.pid}); the one left is pid ${live[0]!.pid}, started at a ${live[0]!.event}`);
  // A replaced waiter exits without waking: no wake for the session, now or 2 s on.
  await sleep(2000);
  const woke = claude.wakes.filter((w) => w.session === s.id);
  if (woke.length) throw Error(`AC12 a replaced waiter must exit without waking the session; ${woke.length} exited 2 and woke it: ${JSON.stringify(woke.map((w) => ({ pid: w.pid, event: w.event, stderr: w.stderr.slice(0, 300) })))}`);
}

describe('AC12 #25.11b719ba Thirty Stops in one Claude Code session leave one waiter process for that session, under 5 MB; a host that starts a waiter at each Stop leaves thirty and fails this test, naming the count', () => {
  it('AC12 #25.11b719ba thirty Stops in one session leave one waiter process for it, under 5 MB', async () => {
    await scenario();
  }, 900_000);

  it(`AC12 #25.11b719ba (wrong program) a host that keeps the waiter of every Stop (${PLANT}) leaves thirty and fails this test, naming the count`, async () => {
    let failure = '';
    try { await scenario(PLANT); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the one-waiter check must fail on ${PLANT}, naming the count`).toMatch(/AC12 thirty Stops in one session must leave one waiter process for it; they left 30 /);
  }, 900_000);

  it('AC12 #25.11b719ba a turn that ends on an API error (StopFailure) after three Stops leaves one waiter process for the session, the one started at the StopFailure', async () => {
    await failureScenario();
  }, 300_000);

  it(`AC12 #25.11b719ba (wrong program) a host that keeps the waiter of every Stop and StopFailure (${PLANT}) leaves four and fails this test, naming the count`, async () => {
    let failure = '';
    try { await failureScenario(PLANT); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the one-waiter check must fail on ${PLANT}, naming the count`).toMatch(/AC12 three Stops and a StopFailure in one session must leave one waiter process for it; they left 4 /);
  }, 300_000);
});
