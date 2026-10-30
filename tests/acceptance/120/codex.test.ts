// AC4 #120.5568c5c4: where the adapter can't wake an idle session, as in Codex, whose hooks never start a turn, a
// wake-up that comes due starts nothing: the session's row shows it due from its time, and the session's next prompt or
// stop carries the promised check with its quote and due time; the route comes from the adapter's flags, never the
// agent's name.
//
// Codex's hooks run as Codex runs DeepBuild's entry (`deep-hook codex <event>`). The promise is the Stop payload's
// last_assistant_message (Codex's adapter reads payloads first). Time moves on with the hub's test clock (README: Time).
// The session's row is `status.read`, what `deep status` prints (README: The session's row). The flags are
// adapter.caps@1, read through the adapters package's public entry (`shipped()`): Codex's wakeIdle and startTurn are
// false, Claude Code's wakeIdle is true, as AC2 needs.
import { shipped } from '@deepbuild/adapters';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC4, allEvents, awaitEvent, cleanup, codexBegin, codexCall, codexContextOf, codexHook, codexShown, evShown, hasTime, hubWithSetup, makeHome, MINUTE, moveOn, newSession, PROMISE_MS, QUOTE,
  sleep, statusRows, waitFor, wakeupEvents,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC4} Where the adapter can't wake an idle session, as in Codex, whose hooks never start a turn, a wake-up that comes due starts nothing: the session's row shows it due from its time, and the session's next prompt or stop carries the promised check with its quote and due time; the route comes from the adapter's flags, never the agent's name`, () => {
  it(`${AC4} a Codex session that promised ${JSON.stringify(QUOTE)} and stopped: 21 minutes on nothing starts, its row reads due with the time, and its next prompt's reply carries the check with its quote and due time`, async () => {
    const h = makeHome();
    let hub = await hubWithSetup(h);
    const s = newSession(h, { agent: 'codex' });
    await codexBegin(h, s, 'Deploy the fix and make sure it is up.');
    await codexCall(h, s, 'npm run deploy');
    const stopped = await codexHook(h, s, 'Stop', { last_assistant_message: QUOTE });
    expect(stopped.ran.code, `${AC4} the Codex stop goes through: ${codexShown(stopped)}`).toBe(0);
    const stopEv = await awaitEvent(hub, s, (e) => e.kind === 'agent.stop', 'the stop');
    const wakeup = await waitFor(async () => wakeupEvents(await allEvents(hub), s.id)[0], 15_000, 'the wake-up recorded with the quote').catch(() => undefined);
    expect(wakeup, `${AC4} the promise is recorded as a wake-up (an event carrying its quote); the session's events: ${(await allEvents(hub)).filter((e) => e.session === s.id).map((e) => e.kind).join(', ')}`).toBeDefined();
    const seen = (await allEvents(hub)).length;
    // Its time comes; a Codex session can't be woken, so nothing starts.
    hub = await moveOn(hub, PROMISE_MS + MINUTE);
    await sleep(3000);
    const since = (await allEvents(hub)).filter((e) => e.session === s.id && e.log_pos > seen);
    const started = since.filter((e) => e.kind === 'user.ask' || e.kind === 'tool.before' || (e.kind === 'session.attention' && e.data.state === 'working'));
    expect(started.map(evShown), `${AC4} a due wake-up starts nothing in a Codex session: no prompt, call or working state since its due time`).toEqual([]);
    // The session's row shows it due from its time.
    const row = (await statusRows(hub)).find((r) => r.id === s.id);
    expect(row, `${AC4} the session has a row in deep status (status.read): ${JSON.stringify(await statusRows(hub)).slice(0, 600)}`).toBeDefined();
    const rowText = JSON.stringify(row);
    expect(rowText, `${AC4} the row says the promised check is due: ${rowText}`).toMatch(/\bdue\b/i);
    expect(hasTime(rowText), `${AC4} the row shows the time it was due from: ${rowText}`).toBe(true);
    // The next prompt carries the promised check.
    const next = await codexHook(h, s, 'UserPromptSubmit', { prompt: 'Anything from the deploy?' });
    const context = codexContextOf(next);
    expect(context, `${AC4} the next prompt's reply carries the promised check: ${codexShown(next)}`).toBeDefined();
    expect(context, `${AC4} it carries the quote: ${JSON.stringify(context)}`).toContain('check the deploy again');
    expect(hasTime(context), `${AC4} it carries the due time: ${JSON.stringify(context)}`).toBe(true);
    void stopEv;
  }, 120_000);

  it(`${AC4} the route is the adapter's flags (adapter.caps@1): Codex can neither wake an idle session nor start a turn, and Claude Code can wake one`, () => {
    const reg = shipped();
    const codex = reg.get('codex').caps;
    expect(codex.wakeIdle, `${AC4} Codex's wakeIdle flag is false: ${JSON.stringify(codex)}`).toBe(false);
    expect(codex.startTurn, `${AC4} Codex's startTurn flag is false: ${JSON.stringify(codex)}`).toBe(false);
    const claudeName = reg.names().find((n) => /claude/.test(n));
    expect(claudeName, `${AC4} the shipped adapters include Claude Code's: ${JSON.stringify(reg.names())}`).toBeDefined();
    const claude = reg.get(claudeName!).caps;
    expect(claude.wakeIdle, `${AC4} Claude Code's wakeIdle flag is true, the route AC2's wake takes: ${JSON.stringify(claude)}`).toBe(true);
  });
});
