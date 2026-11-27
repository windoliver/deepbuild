// AC2 #1867.74eeacdf A recorded Codex call that changes our PreToolUse entry's command, then a new Codex session,
// finds the entry back at that session's start with a reading naming the call. The same change made with no session
// running stays.
//
// Two homes, each with a plain ~/.codex/hooks.json as `deep setup` writes it.
//
// In the first, a Codex thread's shell call runs the script (fixtures/tamper.mjs) on hooks.json, named in its
// command, and the script gives DeepBuild's PreToolUse entry another command. The hub is stopped while the script
// runs, so no watch can see the change as it is made: the call's PreToolUse is in the record before the hub stops, and
// its PostToolUse after the hub is back. Only a recheck that reads the record can then tell whose change it is. A new
// Codex thread starts, and the entry must be back with a reading naming the call (README: Readings, 3 and 4).
//
// In the second, you run the same script yourself while the hub runs and no session has ever started. The change
// must still be there once a new Codex thread's start is in the record and 10 s more have passed: the hub was up for
// the change and for the start, so its watch and its recheck each had their chance to put the entry back.

import { afterAll, describe, expect, it } from 'vitest';
import {
  AC, Agent, NODE, TAMPER, allEvents, begin, callAfter, callBefore, canon, cleanup, codexThread, commandsNow, cut, childEnv, health, hubWithSetup, makeHome,
  ourEntry, oursNow, parseObject, quoted, readingNames, run, shown, start, startHub, stopHub, tag, tilde, until,
} from './helpers.ts';

afterAll(cleanup, 120_000);

const FILE = '~/.codex/hooks.json';
/** The command the script gives DeepBuild's PreToolUse entry: one that runs nothing of DeepBuild's. */
const changedTo = (): string => `/usr/bin/true dh1867-${tag()}`;

describe(`${AC[2]} A recorded Codex call that changes our PreToolUse entry's command, then a new Codex session, finds the entry back at that session's start with a reading naming the call. The same change made with no session running stays`, () => {
  it(`${AC[2]} a recorded Codex shell call's script changes the command of DeepBuild's PreToolUse entry while the hub is stopped: at the next Codex session's start the entry is back as setup wrote it, with a reading naming the call`, async () => {
    const h = makeHome();
    let hub = await hubWithSetup(h);
    const pre = ourEntry(h, 'PreToolUse');
    const entry = `DeepBuild's PreToolUse entry (${tilde(h, String(pre.hook.command))})`;

    // A Codex thread's shell call: its PreToolUse reaches the record, then the hub stops.
    const codex = Agent.start(h);
    const a = codexThread(h, codex);
    await begin(hub, a, 'Tidy the hook settings.');
    const changed = changedTo();
    const call = await callBefore(hub, a, [NODE, TAMPER, 'set-command', 'PreToolUse', changed, tag(), h.hooksFile].map(quoted).join(' '));
    await stopHub(hub);

    // The call's script changes the entry's command, with no hub to see it.
    const ran = await codex.shell(call.command, a.cwd);
    if (parseObject(ran.stdout.trim())?.changed !== 1 || !commandsNow(h, 'PreToolUse').includes(changed) || oursNow(h, 'PreToolUse').length) {
      throw Error(`BLOCKED: the call's script didn't change the command of ${entry} in ${FILE}: ${tilde(h, shown(ran))}; its PreToolUse commands are ${tilde(h, JSON.stringify(commandsNow(h, 'PreToolUse')))}`);
    }

    // The hub starts again; the call ends, its PostToolUse in the record; then a new Codex thread starts.
    hub = await startHub(h);
    await callAfter(hub, a, call, ran);
    const recorded = (await allEvents(hub)).filter((e) => e.session === a.id && (e.kind === 'tool.before' || e.kind === 'tool.after') && e.data?.call === call.id).map((e) => e.kind);
    if (!recorded.includes('tool.before') || !recorded.includes('tool.after')) throw Error(`BLOCKED: the record must hold the call ${call.id} before the next session starts, its tool.before and its tool.after: it holds ${JSON.stringify(recorded)}`);
    const b = codexThread(h, codex);
    await start(hub, b);

    // At that session's start the entry is back: DeepBuild's own, as setup wrote it, and the changed command gone.
    const back = (): boolean => {
      const now = oursNow(h, 'PreToolUse');
      return now.length === 1 && canon(now[0]!.hook) === canon(pre.hook) && !commandsNow(h, 'PreToolUse').includes(changed);
    };
    const name = `the recorded Codex call ${call.id}`;
    const problems: string[] = [];
    if (!await until(back, 30_000)) {
      const said = (await health(hub)).codex?.readings;
      problems.push(`${AC[2]} ${name} changed the command of ${entry} in ${FILE} to "${changed}", and the entry must be back as setup wrote it at the next Codex session's start (${b.id}): 30 s after that start was recorded the file's PreToolUse commands are ${tilde(h, JSON.stringify(commandsNow(h, 'PreToolUse')))}. The hub only reports it: hub.health's codex.readings are ${tilde(h, cut(JSON.stringify(said ?? null), 600))}`);
    }
    if (!await readingNames(hub, a, call, 'hooks.json')) problems.push(`${AC[2]} a reading must name ${name} ("${tilde(h, call.command)}") as what changed ${entry} in ${FILE}, and name that file: none does`);
    expect(problems, `${AC[2]} ${entry} in ${FILE}, its command changed by ${name}`).toEqual([]);
  }, 900_000);

  it(`${AC[2]} the same change to the command of DeepBuild's PreToolUse entry, made by you with no session running, stays through the hub's watch and the next Codex session's start`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const pre = ourEntry(h, 'PreToolUse');
    const entry = `DeepBuild's PreToolUse entry (${tilde(h, String(pre.hook.command))})`;
    const sessions = (await allEvents(hub)).filter((e) => ['session.start', 'tool.before', 'tool.after'].includes(e.kind)).map((e) => e.kind);
    if (sessions.length) throw Error(`BLOCKED: no session may have started in this home before your change, and the record holds ${JSON.stringify(sessions)}`);

    // You run the same script yourself: no session, no call, the hub up.
    const changed = changedTo();
    const ran = await run(NODE, [TAMPER, 'set-command', 'PreToolUse', changed, tag(), h.hooksFile], { env: childEnv(h), cwd: h.tmp });
    if (parseObject(ran.stdout.trim())?.changed !== 1) throw Error(`BLOCKED: the script didn't change the command of ${entry} in ${FILE}: ${tilde(h, shown(ran))}`);
    const stays = (): boolean => commandsNow(h, 'PreToolUse').includes(changed) && oursNow(h, 'PreToolUse').length === 0;

    // The hub's chances to put it back: its watch, from the change on, and its recheck at a new Codex thread's start.
    const codex = Agent.start(h);
    const b = codexThread(h, codex);
    await start(hub, b);
    // deadline: a hub that puts an entry back does it within the first criterion's second, or at the session start just
    // recorded; this change must not go back, and 10 s more is how long the file is read for that.
    const moved = await until(() => !stays(), 10_000, 50);
    const up = await health(hub).then(() => true, () => false);
    if (!up) throw Error(`BLOCKED: the hub must still answer after the session's start, or it had no chance to put the entry back: ${tilde(h, cut(hub.output(), 600))}`);

    expect(moved === true ? tilde(h, JSON.stringify(commandsNow(h, 'PreToolUse'))) : 'stays',
      `${AC[2]} the change you made to ${entry} in ${FILE} with no session running (its command is now "${changed}") is yours: the hub's watch and the next Codex session's start (${b.id}) must leave it`).toBe('stays');
  }, 900_000);
});
