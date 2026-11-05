// AC2 #1202.d1a1edc6: `deep doctor` and the hub's hook-program check (#993) still find the program each entry runs.
//
// DeepBuild is set up by `deep setup` from a copy of this checkout (README: The copy of the checkout), with a hub
// answering whose clock steps (DEEP_HUB_TEST_CLOCK_STEPS=1), so its entries run the copy's deep-hook, which the test may
// remove. A session opens through the entries, run by the Claude Code stand-in with `/bin/sh -c`. With the program in
// place, neither the doctor nor the hub reads it missing: a check that no longer finds the program in an entry's new
// command (say it reads the command's first word, and that word is now a shell builtin) fails here. With the program
// removed, both must name its path, and the doctor every event whose entry runs it: a check that stopped looking at
// the program at all fails there.

import { existsSync, rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC2, allEvents, CHECK_INTERVAL_MS, Claude, cleanup, doctor, eventually, firedShown, itemsShown, itemText, makeHome, newSession, payload, setUp,
  startHub, stepClock, typedPrompt, type Ev, type Hub,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const CODE = 'hook_program_missing';
const CANT_RUN = /hooks can(?:'|’|no)t run/i;
/** The session's readings that say its hooks can't run. */
const cantRun = async (hub: Hub, session: string): Promise<Ev[]> =>
  (await allEvents(hub)).filter((e) => e.session === session && CANT_RUN.test(JSON.stringify(e.data ?? {})));

describe(`${AC2} deep doctor and the hub's hook-program check still find the program each entry runs`, () => {
  it(`${AC2} with the program each entry deep setup wrote runs in place, neither deep doctor nor the hub reads it missing; once it is removed, deep doctor fails claude.hooks with ${CODE} naming its path and every event whose entry runs it, and the hub's check names it on the open session`, async () => {
    const h = await makeHome();
    const hub = await startHub(h, { DEEP_HUB_TEST_CLOCK_STEPS: '1' });
    const entries = await setUp(h);
    const program = h.copy.deepHook;
    const events = [...new Set(entries.map((e) => e.event))];
    expect(entries.every((e) => e.command.includes(program)), `${AC2} every entry setup wrote runs the copy's deep-hook (${program}): ${JSON.stringify(entries.map((e) => ({ event: e.event, command: e.command })))}`).toBe(true);

    // A session opens through the entries, as Claude Code runs them.
    const claude = Claude.start(h);
    const s = newSession(h);
    try {
      const started = await claude.hook('/bin/sh', 'SessionStart', payload(s, 'SessionStart'));
      typedPrompt(s, 'List the files here.');
      const prompted = await claude.hook('/bin/sh', 'UserPromptSubmit', payload(s, 'UserPromptSubmit'));
      expect([...started.ran, ...prompted.ran].every((r) => r.code === 0), `the session's hooks ran through the entries: ${firedShown(started)} ${firedShown(prompted)}`).toBe(true);
    } finally {
      await claude.exit();
    }
    const opened = await eventually(async () => (await allEvents(hub)).some((e) => e.session === s.id && e.kind === 'session.start'), 30_000);
    expect(opened, 'the session reached the record').toBe(true);

    // With the program in place: the doctor reads no entry's program missing ...
    const before = await doctor(h);
    const hooksBefore = before.items.filter((i) => i.item === 'claude.hooks');
    expect(before.items.filter((i) => i.code === CODE), `${AC2} with ${program} in place, deep doctor must find the program each entry runs; it read:\n${itemsShown(before.items.filter((i) => i.code === CODE))}`).toEqual([]);
    expect(hooksBefore.length, `deep doctor lists claude.hooks:\n${itemsShown(before.items)}`).toBeGreaterThan(0);
    expect(hooksBefore.filter((i) => i.level === 'fail'), `${AC2} with ${program} in place, claude.hooks fails nothing:\n${itemsShown(hooksBefore)}`).toEqual([]);
    // ... and nor does the hub, whose check comes due every 10 minutes on its clock (#993). The hub started before setup
    // wrote any entry, so its check at start saw none: the clock steps one interval on, and the check reads them now.
    await stepClock(hub, CHECK_INTERVAL_MS + 1000);
    let early: Ev[] = [];
    await eventually(async () => (early = await cantRun(hub, s.id)).length > 0, 5000);
    expect(early.map((e) => JSON.stringify(e.data)), `${AC2} with ${program} in place, the hub's hook-program check must find it; it says on the session that hooks can't run`).toEqual([]);

    // The program removed: both name it.
    rmSync(program);
    expect(existsSync(program), 'the program is gone').toBe(false);
    const after = await doctor(h);
    const missing = after.items.filter((i) => i.item === 'claude.hooks' && i.code === CODE);
    expect(missing.length, `${AC2} with ${program} removed, deep doctor must fail claude.hooks with ${CODE}:\n${itemsShown(after.items.filter((i) => i.item === 'claude.hooks'))}`).toBeGreaterThan(0);
    const text = missing.map(itemText).join(' ');
    expect(text, `${AC2} the item names the program's path: ${itemsShown(missing)}`).toContain(program);
    expect(events.filter((e) => !text.includes(e)), `${AC2} the doctor names every event whose entry runs the removed program (each entry's program found): ${itemsShown(missing)}`).toEqual([]);

    await stepClock(hub, CHECK_INTERVAL_MS + 1000);
    let late: Ev[] = [];
    await eventually(async () => (late = await cantRun(hub, s.id)).some((e) => JSON.stringify(e.data).includes(program)), 30_000);
    expect(late.map((e) => JSON.stringify(e.data)).some((t) => t.includes(program)), `${AC2} 10 minutes on the hub's clock after ${program} was removed, the hub's check must say on the open session that its hooks can't run, naming the program; its readings: ${JSON.stringify(late.map((e) => e.data))}`).toBe(true);
  }, 600_000);
});
