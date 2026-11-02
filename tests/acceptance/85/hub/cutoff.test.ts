// `#85.d3d3e12b` on the real hub: a turn that runs `gh pr create` against a fixture forge and drops its connection before
// PostToolUse continues with that call named as outcome unknown; the forge receives one PR; the identical call is
// denied at PreToolUse. See README: The cut-off turn. The Claude Code stand-in is this file's: hook lines as deep-hook
// writes them, the transcript as Claude Code writes it, and `gh pr create` run as one POST to the forge when, and only
// when, its PreToolUse lets it through.
import { afterEach, describe, expect, it } from 'vitest';
import {
  begin, completedCall, denies, endAgents, events, ghPrCreate, listen, networkStop, newSession, replyWords, SECOND, sleep, startedCall, startForge, stopTurn, typedTurn, until, waiter, wakeTurn,
  withHub, writeClaudeEnv, type Obj,
} from './helpers.ts';

const TAG = '#85.d3d3e12b';
/** The one call of the cut-off turn with no recorded end: the agent's command, the same words both times. */
const PR_CREATE = 'gh pr create --title "Fix the cart total" --body "Closes #7"';
/** A continue reaches the hub's record and the waiter within this (the issue's 10 s, and a margin for load). */
const CONTINUED = 15 * SECOND;

/** A wrong program, planted around the real hub at the test's side: the continue's text as the session hears it, and the hub's reply to the identical call as the agent reads it. */
interface Plant { wake?: (text: string) => string; identicalReply?: (reply: Obj | undefined) => Obj | undefined }

/** The criterion's scenario; `plant` wraps what the session hears and reads. */
async function cutOffTurn(plant: Plant = {}): Promise<void> {
  // The host the session's API calls go to listens, so the drop is the service's (one automatic continue), not a network you must reconnect.
  const api = await listen();
  const forge = await startForge();
  try {
    await withHub((home) => writeClaudeEnv(home, { ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}` }), async (hub) => {
      const s = newSession(hub, 'folder-a');
      // Turn 1 you typed ends normally; Claude Code starts the waiter at its Stop.
      const p1 = await begin(hub, s);
      await stopTurn(hub, s, p1, 'Done.');
      await sleep(300);
      const wait = waiter(hub, s.id);
      let wake: Obj | undefined;
      void wait.woken.then((v) => { wake = v; });
      await sleep(300);
      try {
        // Turn 2 you typed: a read that ran to its end, then `gh pr create`, which runs (the forge gets the PR) and never reaches PostToolUse: the connection drops.
        const p2 = await typedTurn(hub, s, 'Fix the cart total (#7) and open the PR.');
        await completedCall(hub, s, 'Bash', { command: 'git status' }, { stdout: 'On branch fix-cart-total\nnothing to commit\n', stderr: '', interrupted: false, isImage: false });
        const first = await startedCall(hub, s, 'Bash', { command: PR_CREATE });
        expect(denies(first.before.reply), `the first gh pr create is let through: ${replyWords(first.before.reply)}`).toBe(false);
        await ghPrCreate(forge, PR_CREATE);
        expect(forge.pulls.length, 'the forge received the PR').toBe(1);
        await networkStop(hub, s, p2);

        const continued = await until(() => events(hub, 'session.continued', s.id)[0], CONTINUED);
        expect(continued?.data.because, 'the cut-off turn gets its one automatic continue').toBe('transient');
        const woken = await until(() => wake, CONTINUED);
        expect(woken, 'the waiter wakes the session with the continue').toBeDefined();
        const text = plant.wake ? plant.wake(String(woken!.text ?? '')) : String(woken!.text ?? '');
        expect(text, `the continue names the gh pr create call of the cut-off turn, which started with no recorded end: ${JSON.stringify(text)}`).toContain('gh pr create');
        expect(text.toLowerCase(), `marked outcome unknown, to check before acting: ${JSON.stringify(text)}`).toContain('outcome unknown');
        expect(text.split('\n').filter((l) => l.includes('git status') && /outcome unknown/i.test(l)), 'the git status call, which ran to its end, is not marked outcome unknown').toEqual([]);

        // The agent acts on the continue: the wake's turn, and the identical call. It runs only if the hub lets it through.
        await wakeTurn(hub, s, text);
        const again = await startedCall(hub, s, 'Bash', { command: PR_CREATE });
        const reply = plant.identicalReply ? plant.identicalReply(again.before.reply) : again.before.reply;
        if (!denies(reply)) await ghPrCreate(forge, PR_CREATE);
        expect(forge.pulls.length, `the forge receives one PR: a continue that lets the identical gh pr create run opens a second (the hub's reply to it: ${JSON.stringify(reply)})`).toBe(1);
        expect(denies(reply), `the identical gh pr create is denied at PreToolUse: ${JSON.stringify(reply)}`).toBe(true);
        expect(replyWords(reply), 'the denial names the call and its earlier result').toContain('gh pr create');
        expect(events(hub, 'session.continued', s.id), 'the turn continued once').toHaveLength(1);
      } finally {
        wait.end();
      }
    });
  } finally {
    await forge.close();
    await api.close();
  }
}

afterEach(() => endAgents());

describe('a turn cut off before PostToolUse, on the real hub', () => {
  it(`${TAG} continues with the gh pr create call named as outcome unknown; the forge receives one PR; the identical call is denied at PreToolUse`, async () => {
    await cutOffTurn();
  }, 120_000);

  it(`${TAG} fails on a continue that omits the call, naming it, and on one that lets the identical call run, naming the second PR`, async () => {
    await cutOffTurn();
    await expect(cutOffTurn({ wake: (text) => text.split('\n').filter((l) => !l.includes('gh pr create')).join('\n') })).rejects.toThrow(/the continue names the gh pr create call of the cut-off turn/);
    await expect(cutOffTurn({ identicalReply: () => ({ v: 1, exit: 0, stdout: '', stderr: '' }) })).rejects.toThrow(/the forge receives one PR: a continue that lets the identical gh pr create run opens a second/);
  }, 240_000);
});
