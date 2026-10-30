// AC1 #120.7edb0b65: in the Claude Code terminal, through the route #80 found (a FileChanged notification), a command
// running past its expected time shows a line on screen within 10 s while it still runs.
// AC8 #120.af5921ee: a command that never ends on its own gets its deadline attached where the adapter can change it,
// and an overrun reaches the agent at its next hook, never you.
//
// The route (spikes/80/decision.json): at SessionStart the hook's reply names `hookSpecificOutput.watchPaths`; Claude
// Code's terminal fires FileChanged when one changes, and that hook's reply's `systemMessage` shows as a notification
// while the call still runs. The stand-in (fixtures/claude.mjs) does exactly that and nothing more. The expected time
// of a command comes from its history (README: Expected time): three runs of about a second each, then the fourth is
// left running.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC8, allEvents, awaitEvent, bash, begin, chatLines, cleanup, contextOf, deepEntries, firedShown, hasDuration, hubWithSetup, inboxRead, lineOf, makeHome, MINUTE,
  moveOn, newSession, notificationAfter, ran, readSettings, replyOf, sleep, TAIL, updatedInputOf, waitFor, decisionsIn,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const BUILD = 'npm run build';
/** The issue's 10 s past the expected time, plus the history's second and a second of slack for the stand-in's polling. */
const WITHIN_MS = 10_000 + 1000 + 1000;

describe(`${AC1} In the Claude Code terminal, through the route #80 found (a FileChanged notification), a command running past its expected time shows a line on screen within 10 s while it still runs`, () => {
  it(`${AC1} after three runs of about a second, a fourth \`${BUILD}\` left running gets a FileChanged notification within ${WITHIN_MS / 1000} s of its start, naming what it waits on and for how long, while it still runs`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const s = newSession(h);
    const { claude, started } = await begin(h, s, 'Build the project, then stop.');
    // History: the same command three times, each about a second (README: Expected time).
    for (let i = 0; i < 3; i++) {
      const { call } = await claude.open(s, 'Bash', bash(BUILD));
      await sleep(1000);
      await claude.close(s, call, 'Bash', bash(BUILD), ran('built'));
      await awaitEvent(hub, s, (e) => e.kind === 'tool.after' && e.data.call === call, `run ${i + 1}'s tool.after`);
    }
    // The fourth run: it starts and keeps running.
    const t0 = Date.now();
    const { call } = await claude.open(s, 'Bash', bash(BUILD));
    const notice = await waitFor(() => notificationAfter(claude, t0), WITHIN_MS, 'a FileChanged notification').catch(() => undefined);
    const stillRunning = (await allEvents(hub)).every((e) => !(e.session === s.id && e.kind === 'tool.after' && e.data.call === call));
    const entries = deepEntries(readSettings(h)).filter((e) => e.event === 'FileChanged');
    const why = `SessionStart reply ${JSON.stringify(replyOf(started) ?? 'empty')} (watch: ${JSON.stringify(started.watch ?? [])}); FileChanged entries of DeepBuild's in settings: ${entries.length}; FileChanged hooks fired: ${JSON.stringify(claude.fileChanges.map((f) => ({ path: f.path, at: f.at - t0, shown: f.fired?.shown })))}`;
    expect(notice, `${AC1} within ${WITHIN_MS} ms of the call's start a FileChanged hook's reply carried a systemMessage, the notification the terminal shows; ${why}`).toBeDefined();
    const line = notice!.fired!.shown![0]!;
    expect(notice!.at - t0, `${AC1} the notification came within ${WITHIN_MS} ms of the call's start: ${JSON.stringify(line)}`).toBeLessThanOrEqual(WITHIN_MS);
    expect(stillRunning, `${AC1} the call was still running when the notification showed (no tool.after for ${call} yet)`).toBe(true);
    expect(line, `${AC1} the line says what it waits on (the command, \`${BUILD}\`): ${JSON.stringify(line)}`).toMatch(/npm run build|Bash/);
    expect(hasDuration(line), `${AC1} the line says for how long (a duration): ${JSON.stringify(line)}`).toBe(true);
    expect(chatLines(s), `${AC1} the line is in the chat (a hook_system_message attachment)`).toContain(line);
    await claude.close(s, call, 'Bash', bash(BUILD), ran('built'));
    await claude.end();
  }, 60_000);
});

describe(`${AC8} A command that never ends on its own gets its deadline attached where the adapter can change it, and an overrun reaches the agent at its next hook, never you`, () => {
  it(`${AC8} in a Claude Code session that bypasses approvals \`${TAIL}\` is rewritten with its deadline (updatedInput); 30 minutes on, the overrun reaches the agent as context at its next hook, naming the command and how long it ran, and opens no ask for you`, async () => {
    const h = makeHome();
    let hub = await hubWithSetup(h);
    const s = newSession(h, { mode: 'bypassPermissions' });
    const { claude } = await begin(h, s, 'Watch the app log for the error, then stop.');
    const { call, fired } = await claude.open(s, 'Bash', bash(TAIL));
    const reply = replyOf(fired);
    const updated = updatedInputOf(reply);
    expect(updated, `${AC8} the PreToolUse reply attaches the deadline where Claude Code can change the command (hookSpecificOutput.updatedInput): ${firedShown(fired)}`).toBeDefined();
    expect(typeof updated!.command, `${AC8} the rewritten call is a command: ${JSON.stringify(updated)}`).toBe('string');
    expect(updated!.command, `${AC8} the rewritten command still runs the original: ${JSON.stringify(updated)}`).toContain(TAIL);
    expect(updated!.command, `${AC8} the rewritten command differs from the original, carrying its deadline: ${JSON.stringify(updated)}`).not.toBe(TAIL);
    expect(decisionsIn(reply), `${AC8} a Claude Code rewrite carries no permission decision: ${JSON.stringify(reply)}`).toEqual([]);
    await awaitEvent(hub, s, (e) => e.kind === 'tool.before' && e.data.call === call, 'the call\'s tool.before');
    // Thirty minutes pass while the call runs; its deadline, whatever it was, has passed.
    hub = await moveOn(hub, 30 * MINUTE);
    const closed = await claude.close(s, call, 'Bash', bash(TAIL), { stdout: '', stderr: 'Terminated', interrupted: true, isImage: false });
    const next = await claude.open(s, 'Bash', bash('ls'));
    const heard = contextOf(closed) ?? contextOf(next.fired);
    const where = contextOf(closed) ? 'the PostToolUse' : contextOf(next.fired) ? 'the next PreToolUse' : 'neither hook';
    expect(heard, `${AC8} the agent hears the overrun at its next hook (PostToolUse reply: ${firedShown(closed)}; the PreToolUse after it: ${firedShown(next.fired)})`).toBeDefined();
    expect(heard, `${AC8} the overrun names the command (${where}): ${JSON.stringify(heard)}`).toContain('tail -f');
    expect(hasDuration(heard), `${AC8} the overrun says how long it ran (${where}): ${JSON.stringify(heard)}`).toBe(true);
    await claude.close(s, next.call, 'Bash', bash('ls'), ran());
    // Never you: no ask was opened for it, in the record or in your inbox.
    const asks = (await allEvents(hub)).filter((e) => e.session === s.id && (e.kind === 'ask.created' || e.kind === 'user.ask') && JSON.stringify(e.data).includes('tail'));
    expect(asks.map((e) => `${e.kind}: ${JSON.stringify(e.data).slice(0, 200)}`), `${AC8} an overrun never becomes a wait on you: no ask about the command`).toEqual([]);
    const inbox = (await inboxRead(hub)).filter((a) => JSON.stringify(a).includes('tail'));
    expect(inbox, `${AC8} your inbox holds no ask about the overrun`).toEqual([]);
    // The chat line is allowed; it is not a wait on you.
    void lineOf(closed);
    await claude.end();
  }, 90_000);
});
