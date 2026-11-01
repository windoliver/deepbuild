// AC10 #25.3d50cff2 With the cap at 8, in one turn with no tool call between them, eight continuations, a mix of
// held-stop answers and planted send-backs, each go back through the Stop hook, and a ninth goes by the next prompt,
// the session's row saying why; with one tool call after the fourth, all nine go through the Stop hook. A counter that
// never resets sends the ninth of the second run by the next prompt and fails, and one with no counter blocks the
// ninth stop, which Claude Code overrides, and fails this test, naming the turn.
//
// Scope: "A per-turn count of Claude Code's stop-hook continuations, send-backs, completion prompts and held-stop
// answers alike, reset when the agent calls a tool: the one that would pass Claude Code's cap (eight unless set, from
// its facts or your settings) goes by the next prompt instead, and the session's row says why."
//
// Claude Code's side is the stand-in (fixtures/claude.mjs) with its own cap at 8, as #80 recorded: it continues a turn
// on each Stop block up to 8 in a row, overrides the 9th and ends the turn with its reason lost, and resets the count
// at a tool call. A held-stop answer is a stop held while the session's ask is open, answered with `deep inbox answer`
// during the hold. A planted send-back is the test-only `test.send_back` (README: Additions): the hub sends the
// session's next stop back with its reason. Nothing else is set, so the cap is Claude Code's default of 8.
//
// Run 1 is turn 1: four asks (tool calls), then nine stops with no tool call between them: answer, send-back, ...,
// send-back, and a ninth send-back that must go by turn 2's prompt. Run 2 is turn 2: five asks, four stops, one Bash
// call, five stops: all nine go back through the Stop hook.

import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, answer, ask, assistantSays, carries, cleanup, firedShown, makeHome, newSession, payload, said, sendBack, setup, sleep, startHub,
  NO_ASK_WAIT, stopCount, stopsRecorded, tag, typedPrompt, viewTexts, eventually, type Asked, type Fired,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** Words that say why a continuation went by the next prompt: Claude Code's cap of 8 on stop-hook continuations. */
const saysWhy = (text: string) => /\b8\b|eight/i.test(text) && /next prompt/i.test(text) && /continu|in a row|consecutive|cap/i.test(text);

describe('AC10 #25.3d50cff2 With the cap at 8, in one turn with no tool call between them, eight continuations, a mix of held-stop answers and planted send-backs, each go back through the Stop hook, and a ninth goes by the next prompt, the session\'s row saying why; with one tool call after the fourth, all nine go through the Stop hook. A counter that never resets sends the ninth of the second run by the next prompt and fails, and one with no counter blocks the ninth stop, which Claude Code overrides, and fails this test, naming the turn', () => {
  it('AC10 #25.3d50cff2 eight continuations go back through the Stop hook and the ninth by the next prompt, the row saying why; with a tool call after the fourth, all nine go through the Stop hook', async () => {
    const { home } = makeHome();
    const hub = await startHub(home, NO_ASK_WAIT);
    await setup(home);
    const s = newSession(home);
    const claude = await Claude.start(home);
    await claude.hook('SessionStart', payload(s, 'SessionStart'));
    await claude.initialize();

    /** The k-th stop of a turn, continued through the Stop hook with an answer to `asked` or with a send-back. */
    const continued = async (turn: string, k: number, slot: Asked | 'send-back'): Promise<void> => {
      const reason = `Send-back ${k} of ${turn}: the header test still fails (${tag(4)}).`;
      if (slot === 'send-back') await sendBack(hub, s.id, reason);
      const before = await stopCount(hub, s);
      assistantSays(s, `Stop ${k} of ${turn}.`);
      const stopping = claude.hook('Stop', payload(s, 'Stop'));
      if (slot !== 'send-back') {
        await stopsRecorded(hub, s, before + 1);
        await answer(home, slot.handle, slot.pick.id);
      }
      const fired: Fired = await stopping;
      const what = slot === 'send-back' ? `the planted send-back "${reason}"` : `the answer to ${slot.handle} (${slot.pick.label})`;
      const back = (fired.stop?.reasons ?? []).some((r) => (slot === 'send-back' ? r.includes(reason) : carries(r, slot)));
      expect(fired.stop?.overridden, `AC10 ${turn} of session ${s.id}: Claude Code overrode DeepBuild's block at stop ${k} (its ${fired.stop?.count}th in a row past its cap of 8), so ${what} was lost: ${firedShown(fired)}`).toBe(false);
      expect(back && fired.stop?.continued, `AC10 ${turn} of session ${s.id}: continuation ${k}, ${what}, must go back through the Stop hook, DeepBuild's Stop reply blocking with it and Claude Code continuing the turn: ${firedShown(fired)}`).toBe(true);
    };

    // ---- Run 1: turn 1, no tool call between its stops.
    const p1 = typedPrompt(s, 'Make the header test pass.');
    const turn1 = `turn 1 (prompt_id ${p1})`;
    await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Make the header test pass.' }));
    const asks1 = await Promise.all(['one', 'two', 'three', 'four'].map((w) => ask(hub, claude, s, w)));
    await Promise.all(asks1.map((a) => a.reply)); // each tool call ends ("still waiting") before the turn stops
    const plan1: (Asked | 'send-back')[] = [asks1[0]!, 'send-back', asks1[1]!, 'send-back', asks1[2]!, 'send-back', asks1[3]!, 'send-back'];
    for (const [i, slot] of plan1.entries()) await continued(turn1, i + 1, slot);

    // The ninth would pass Claude Code's cap: it goes by the next prompt instead.
    const ninth = `Send-back 9 of ${turn1}: the footer test still fails (${tag(4)}).`;
    await sendBack(hub, s.id, ninth);
    const shownBefore = new Set(await viewTexts(hub, s.id));
    assistantSays(s, `Stop 9 of ${turn1}.`);
    const stop9 = await claude.hook('Stop', payload(s, 'Stop'));
    expect(stop9.stop?.overridden, `AC10 ${turn1} of session ${s.id}: DeepBuild blocked the 9th stop in a row with no tool call between, and Claude Code overrode it (cap 8), so the send-back "${ninth}" was lost; the 9th must go by the next prompt instead: ${firedShown(stop9)}`).toBe(false);
    expect(stop9.stop?.blocked, `AC10 ${turn1} of session ${s.id}: the 9th continuation would pass Claude Code's cap of 8, so DeepBuild's reply to the 9th stop must not block: ${firedShown(stop9)}`).toBe(false);
    const fresh = async () => (await viewTexts(hub, s.id)).filter((text) => !shownBefore.has(text));
    const why = await eventually(async () => (await fresh()).some(saysWhy), 20_000);
    expect(why, `AC10 ${turn1} of session ${s.id}: the session's row must say why the 9th went by the next prompt (Claude Code's cap of 8 stop-hook continuations); what it shows since the 9th stop: ${(await fresh()).join('\n').slice(0, 4000)}`).toBe(true);

    // Turn 2's prompt carries it (or a wake's prompt does, if the session was woken; never both).
    await sleep(3000);
    const p2 = typedPrompt(s, 'Next, the footer.');
    const turn2 = `turn 2 (prompt_id ${p2})`;
    const next = await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Next, the footer.' }));
    const woken = (await claude.wakes()).filter((w) => (w.prompt ?? '').includes(ninth) || w.ran.some((r) => r.stdout.includes(ninth)));
    const routes = [...woken.map(() => 'a wake'), ...(said(next).includes(ninth) ? ['the next prompt'] : [])];
    expect(routes, `AC10 ${turn1} of session ${s.id}: the 9th, "${ninth}", must reach the session once, by the next prompt: ${firedShown(next)}; wakes ${JSON.stringify(woken)}`).toHaveLength(1);
    expect(said(next), `AC10 delivering it must not block your prompt: ${firedShown(next)}`).not.toMatch(/"decision"\s*:\s*"block"/);

    // ---- Run 2: turn 2, one tool call after the fourth: all nine go back through the Stop hook.
    const asks2 = await Promise.all(['five', 'six', 'seven', 'eight', 'nine'].map((w) => ask(hub, claude, s, w)));
    await Promise.all(asks2.map((a) => a.reply));
    const plan2: (Asked | 'send-back')[] = [asks2[0]!, 'send-back', asks2[1]!, 'send-back', asks2[2]!, 'send-back', asks2[3]!, 'send-back', asks2[4]!];
    for (const [i, slot] of plan2.entries()) {
      if (i === 4) await claude.bash(s, 'ls -a'); // the agent calls a tool: Claude Code's count starts again
      await continued(turn2, i + 1, slot);
    }
  }, 1_200_000);
});
