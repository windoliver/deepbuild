// AC7 #25.3010b97e An answer to a session that has ended reaches only the same thread at SessionStart (a resume, or
// the thread joined across `/clear` and `/compact`); otherwise it waits on its task's line and in its decision, and the
// next session that works the task reads it, while a new session on other work in the same worktree gets nothing.
//
// Design (Hooks are evidence: Threads, not IDs): "/clear, /compact and forks rotate a session's ID; the session map
// joins them into one thread ... An answer for a session that has ended reaches only the same thread at SessionStart,
// a resume or the thread joined across /clear and /compact; otherwise it waits on its task's line and in its decision,
// where the next session that works the task reads it."
//
// Every session here asks with deep_ask and then ends with nothing left running: you press Esc while it waits (no
// Stop fires, so no stop is held and no waiter runs) and quit, `/clear` or `/compact`. A resume is a new Claude Code
// process run as `claude --resume <id>`, with the same session ID and transcript (Claude Code reuses the ID unless
// --fork-session); `/clear` and `/compact` change the ID inside the same process (README: Threads). A session works a
// task once it claims it with deep_claim's task_ref (README: Working a task). "Reaches" is DeepBuild's reply to that
// hook carrying the answer; "gets nothing" is no DeepBuild reply, and no deep_* result, carrying it.

import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  Claude, NO_ASK_WAIT, answer, ask, carries, cleanup, firedShown, makeHome, newSession, outcomes, payload, said, setup, sleep, startHub, tag,
  typedPrompt, type Asked, type Fired, type Hub, type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const commit = () => tag(20);
/** A session that starts, takes your prompt and asks; returns the ask once its deep_ask has ended "still waiting". */
async function asking(hub: Hub, claude: Claude, s: Session, word: string, task?: string): Promise<Asked> {
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, `Work on the ${word} part.`);
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: `Work on the ${word} part.` }));
  await claude.initialize();
  if (task) {
    const claimed = await claude.deepTool(s, 'deep_claim', { task_ref: task, attempt: 1, commit: commit(), scope: 'session', predictions: null });
    if (!claimed.reply.result || claimed.reply.result.isError) throw Error(`BLOCKED: session ${s.id} must work ${task} by claiming it with deep_claim: ${JSON.stringify(claimed.reply)}`);
  }
  const asked = await ask(hub, claude, s, word);
  await asked.reply;
  return asked;
}
/** Every answer among `asks` that a text carries, by handle. */
const carried = (text: string, asks: Asked[]) => asks.filter((a) => carries(text, a) || text.includes(a.handle)).map((a) => a.handle);

describe('AC7 #25.3010b97e An answer to a session that has ended reaches only the same thread at SessionStart (a resume, or the thread joined across `/clear` and `/compact`); otherwise it waits on its task\'s line and in its decision, and the next session that works the task reads it, while a new session on other work in the same worktree gets nothing', () => {
  it('AC7 #25.3010b97e answers to ended sessions reach the resumed session and the threads joined across /clear and /compact at their SessionStart, each only its own; a new session in the same worktree gets none', async () => {
    const { home, tmp } = makeHome();
    const hub = await startHub(home, NO_ASK_WAIT);
    await setup(home);
    const worktree = join(tmp, 'wt');

    // R ends with you quitting; C1 is cleared into C2; K1 is compacted into K2, which then ends.
    const r = newSession(home, worktree);
    const c1 = newSession(home, worktree);
    const k1 = newSession(home, worktree);
    const [pr, pc, pk] = await Promise.all([Claude.start(home), Claude.start(home), Claude.start(home)]);
    const [ar, ac, ak] = await Promise.all([asking(hub, pr, r, 'resume'), asking(hub, pc, c1, 'clear'), asking(hub, pk, k1, 'compact')]);
    const all = [ar, ac, ak];

    await pr.hook('SessionEnd', payload(r, 'SessionEnd', { reason: 'prompt_input_exit' }));
    await pr.exit();
    await pc.hook('SessionEnd', payload(c1, 'SessionEnd', { reason: 'clear' }));
    const k2 = newSession(home, worktree);
    const compacted = await pk.hook('SessionStart', payload(k2, 'SessionStart', { source: 'compact' }));
    expect(carried(said(compacted), all), `nothing is answered yet when K1 is compacted (the control): ${firedShown(compacted)}`).toEqual([]);
    await pk.hook('SessionEnd', payload(k2, 'SessionEnd', { reason: 'prompt_input_exit' }));
    await pk.exit();

    // You answer all three after their sessions ended.
    for (const a of all) await answer(home, a.handle, a.pick.id);
    await sleep(3000);

    // A new session on other work in the same worktree gets nothing.
    const d = newSession(home, worktree);
    const pd = await Claude.start(home);
    const dHooks: [string, Fired][] = [];
    dHooks.push(['SessionStart', await pd.hook('SessionStart', payload(d, 'SessionStart'))]);
    typedPrompt(d, 'Fix the flaky footer test.');
    dHooks.push(['UserPromptSubmit', await pd.hook('UserPromptSubmit', payload(d, 'UserPromptSubmit', { prompt: 'Fix the flaky footer test.' }))]);
    dHooks.push(['Stop', await pd.hook('Stop', payload(d, 'Stop'))]);
    for (const [event, fired] of dHooks) {
      expect(carried(said(fired), all), `AC7 session ${d.id} is a new session on other work in the same worktree: it gets none of the answers, yet DeepBuild's reply to its ${event} carries some: ${firedShown(fired)}`).toEqual([]);
    }
    await pd.hook('SessionEnd', payload(d, 'SessionEnd', { reason: 'prompt_input_exit' }));
    await pd.exit();

    // /clear: C2 joins C1's thread in the same process, and reads C1's answer at its SessionStart.
    const c2 = newSession(home, worktree);
    const cleared = await pc.hook('SessionStart', payload(c2, 'SessionStart', { source: 'clear' }));
    expect(carried(said(cleared), all), `AC7 session ${c2.id} joins ${c1.id}'s thread across /clear: at its SessionStart it reads the answer to ${ac.handle} (${ac.pick.label}), and only that one: ${firedShown(cleared)}`).toEqual([ac.handle]);

    // A resume: R again, in a new process run as `claude --resume <id>`.
    const pr2 = await Claude.start(home, { args: ['--resume', r.id] });
    const resumed = await pr2.hook('SessionStart', payload(r, 'SessionStart', { source: 'resume' }));
    expect(carried(said(resumed), all), `AC7 session ${r.id} is resumed: at its SessionStart it reads the answer to ${ar.handle} (${ar.pick.label}), and only that one: ${firedShown(resumed)}`).toEqual([ar.handle]);

    // /compact: K2 carries K1's thread; resuming K2 reads K1's answer.
    const pk2 = await Claude.start(home, { args: ['--resume', k2.id] });
    const resumedK = await pk2.hook('SessionStart', payload(k2, 'SessionStart', { source: 'resume' }));
    expect(carried(said(resumedK), all), `AC7 session ${k2.id} carries ${k1.id}'s thread across /compact: resumed, at its SessionStart it reads the answer to ${ak.handle} (${ak.pick.label}), and only that one: ${firedShown(resumedK)}`).toEqual([ak.handle]);

    // Each answer is read once: the next prompts carry none again.
    for (const [claude, s] of [[pc, c2], [pr2, r], [pk2, k2]] as const) {
      typedPrompt(s, 'Carry on.');
      const next = await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Carry on.' }));
      expect(carried(said(next), all), `AC7 an answer is read once: session ${s.id}'s next prompt must carry none again: ${firedShown(next)}`).toEqual([]);
    }
  }, 900_000);

  it('AC7 #25.3010b97e an answer to an ended session waits on its task: a new session on other work in the same worktree gets nothing, and the next session that works the task reads it, once', async () => {
    const { home, tmp } = makeHome();
    const hub = await startHub(home, NO_ASK_WAIT);
    await setup(home);
    const worktree = join(tmp, 'wt');
    const task = `task:T${tag(6)}`;
    const otherTask = `task:O${tag(6)}`;

    // A works the task, asks, and ends.
    const a = newSession(home, worktree);
    const pa = await Claude.start(home);
    const asked = await asking(hub, pa, a, 'tables', task);
    await pa.hook('SessionEnd', payload(a, 'SessionEnd', { reason: 'prompt_input_exit' }));
    await pa.exit();
    await answer(home, asked.handle, asked.pick.id);
    await sleep(3000);

    // A new session on other work in the same worktree gets nothing.
    const d = newSession(home, worktree);
    const pd = await Claude.start(home);
    const seenByD: string[] = [];
    const dStart = await pd.hook('SessionStart', payload(d, 'SessionStart'));
    seenByD.push(`SessionStart: ${said(dStart)}`);
    typedPrompt(d, 'Fix the flaky footer test.');
    seenByD.push(`UserPromptSubmit: ${said(await pd.hook('UserPromptSubmit', payload(d, 'UserPromptSubmit', { prompt: 'Fix the flaky footer test.' })))}`);
    await pd.initialize();
    const dClaim = await pd.deepTool(d, 'deep_claim', { task_ref: otherTask, attempt: 1, commit: commit(), scope: 'session', predictions: null });
    seenByD.push(`deep_claim: ${JSON.stringify(dClaim.reply)}`, `PostToolUse: ${said(dClaim.post)}`);
    seenByD.push(`Stop: ${said(await pd.hook('Stop', payload(d, 'Stop')))}`);
    for (const text of seenByD) {
      expect(carried(text, [asked]), `AC7 session ${d.id} works other work (${otherTask}) in the same worktree: it gets nothing of the answer to ${asked.handle}, yet DeepBuild gave it this: ${text.slice(0, 1500)}`).toEqual([]);
    }
    await pd.hook('SessionEnd', payload(d, 'SessionEnd', { reason: 'prompt_input_exit' }));
    await pd.exit();

    // The answer waits: nothing has delivered it yet.
    expect((await outcomes(hub, asked.handle)).filter((o) => o.outcome === 'delivered'), `AC7 the answer to ${asked.handle} waits for the next session that works ${task}: nothing may have delivered it yet`).toEqual([]);

    // The next session that works the task reads it.
    const c = newSession(home, worktree);
    const pc = await Claude.start(home);
    await pc.hook('SessionStart', payload(c, 'SessionStart'));
    typedPrompt(c, `Pick up ${task}.`);
    await pc.hook('UserPromptSubmit', payload(c, 'UserPromptSubmit', { prompt: `Pick up ${task}.` }));
    await pc.initialize();
    const seenByC: string[] = [];
    const cClaim = await pc.deepTool(c, 'deep_claim', { task_ref: task, attempt: 2, commit: commit(), scope: 'session', predictions: null });
    seenByC.push(`deep_claim: ${JSON.stringify(cClaim.reply)}`, `PostToolUse: ${said(cClaim.post)}`);
    typedPrompt(c, 'Go on.');
    seenByC.push(`UserPromptSubmit: ${said(await pc.hook('UserPromptSubmit', payload(c, 'UserPromptSubmit', { prompt: 'Go on.' })))}`);
    const stop = await pc.hook('Stop', payload(c, 'Stop'));
    seenByC.push(`Stop: ${said(stop)}`);
    const first = seenByC.findIndex((text) => carried(text, [asked]).length > 0);
    expect(first, `AC7 session ${c.id} is the next session that works ${task}: once it works it (deep_claim), it reads your answer to ${asked.handle} (${asked.pick.label}) through DeepBuild; it saw: ${seenByC.join('\n').slice(0, 4000)}`).toBeGreaterThanOrEqual(0);
    expect(seenByC.slice(first + 1).filter((text) => carried(text, [asked]).length > 0), `AC7 session ${c.id} reads the answer to ${asked.handle} once: after ${seenByC[first]!.split(':')[0]} carried it, nothing later may carry it again`).toEqual([]);
  }, 900_000);
});
