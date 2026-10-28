// AC12 #25.11b719ba Thirty Stops in one Claude Code session leave one waiter process for that session, under 5 MB; a
// host that starts a waiter at each Stop leaves thirty and fails this test, naming the count.
//
// Claude Code starts DeepBuild's waiter entry at every Stop and, in the desktop app, leaves the earlier ones running
// (#80: "Earlier waiters keep running in the desktop app ... the adapter must end the old waiter itself"); the
// stand-in does the same. One session runs thirty turns, each a prompt you type, the agent's reply and its Stop. Then
// the waiters still running for the session are counted: the stand-in's background asyncRewake runs of DeepBuild's
// entry that haven't exited and still have a live process in their process group. The one left is measured as the
// resident size of every live process in its group, from `ps`.

import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, assistantSays, cleanup, firedShown, groupOf, makeHome, newSession, payload, processes, setup, sleep, startHub, typedPrompt,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'waiter-per-stop';
const STOPS = 30;

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
  let live = await claude.liveWaiters(s.id);
  const deadline = Date.now() + 15_000;
  while (live.length !== 1 && Date.now() < deadline) { await sleep(500); live = await claude.liveWaiters(s.id); }
  if (live.length !== 1) throw Error(`AC12 thirty Stops in one session must leave one waiter process for it; they left ${live.length} (pids ${live.map((r) => r.pid).join(', ') || 'none'})`);
  await sleep(2000);
  const table = processes();
  const group = groupOf(live[0]!.pid, table);
  const kb = group.reduce((sum, p) => sum + p.rssKb, 0);
  if (kb >= 5 * 1024) throw Error(`AC12 the one waiter left for the session must be under 5 MB; its processes hold ${kb} KB resident: ${JSON.stringify(group.map((p) => ({ pid: p.pid, rssKb: p.rssKb, command: p.command.slice(0, 200) })))}`);
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
});
