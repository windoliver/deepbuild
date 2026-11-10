// AC2 and AC8: back and forward. ⌘[ and ⌘] walk the addresses you opened; a session the record removes leaves that list;
// opening from the middle drops the forward side; a focused terminal keeps the keys. Each test is one replica on the
// fixture, its keys pressed as a keyboard presses them (deep_drive's `act press`), the address read from the window's
// page node after each step (README, Pinned 2). A session is removed by the record's own event for it, `session.archived`,
// fed as the hub's stream delivers it (README, Pinned 6). Each failure names the step it stopped at.
import { describe, expect, it } from 'vitest';
import { addressFailures, driveBinary, ID, MIN, Replica, SESSIONS, sessionAt } from './helpers.ts';

const { A, B, C, D, E, F } = SESSIONS;
const at = (s: { id: string }): string => sessionAt(s.id);

describe(`AC2 ${ID.walk} ⌘[ and ⌘] walk five opened pages and back. A removed session leaves the list, and opening from the middle drops the forward side`, () => {
  it(`AC2 ${ID.walk} five sessions opened by address; ⌘[ walks back to the first and ⌘] forward to the fifth; the third, removed, is skipped both ways; opening from the second leaves no forward step`, async () => {
    const r = await Replica.on(await driveBinary());
    const failures: string[] = [];
    const step = async (what: string, want: { id: string }): Promise<boolean> => {
      const wrong = await addressFailures(r, at(want), what);
      failures.push(...wrong);
      return wrong.length === 0;
    };
    try {
      const five = [A, B, C, D, E];
      for (const s of five) await r.open(at(s));
      if (await step('opening A, B, C, D and E', E)) {
        let ok = true;
        for (let i = 3; ok && i >= 0; i--) { await r.press('cmd-['); ok = await step(`⌘[ ${4 - i} time${i === 3 ? '' : 's'} from E`, five[i]!); }
        for (let i = 1; ok && i <= 4; i++) { await r.press('cmd-]'); ok = await step(`⌘] ${i} time${i === 1 ? '' : 's'} from A`, five[i]!); }
        if (ok) {
          await r.feed(C.id, { v: 1, id: '01KB1460RM0000000000000001', kind: 'session.archived', writer: 'core', actor: 'you', scope: 'you', subject: `session:${C.id}`, data: { transcript: '/tmp/archived/c.jsonl' } });
          ok = await step('removing C while E shows', E);
          for (const [keys, want, what] of [['cmd-[', D, '⌘[ from E'], ['cmd-[', B, '⌘[ from D, with C removed'], ['cmd-[', A, '⌘[ from B'], ['cmd-]', B, '⌘] from A'], ['cmd-]', D, '⌘] from B, with C removed']] as const) {
            if (!ok) break;
            await r.press(keys);
            ok = await step(what, want);
          }
          if (ok) {
            await r.press('cmd-[');
            ok = await step('⌘[ from D, back to the middle', B);
          }
          if (ok) {
            await r.open(at(F));
            ok = await step('opening F from B, in the middle', F);
            if (ok) { await r.press('cmd-]'); ok = await step('⌘] after opening F from the middle: the forward side, D and E, is gone', F); }
            if (ok) { await r.press('cmd-['); await step('⌘[ from F', B); }
          }
        }
      }
    } finally {
      await r.stop();
    }
    expect(failures).toEqual([]);
  }, 20 * MIN);
});

describe(`AC8 ${ID.terminal} Opening sessions A, B and C, then ⌘[ twice, shows A; opening D then leaves no forward step; with the terminal tab focused, ⌘[ reaches the terminal and the page stays`, () => {
  it(`AC8 ${ID.terminal} A, B and C opened by their rows; ⌘[ twice shows A; D's row then leaves ⌘] nowhere to go and ⌘[ going to A; on D's page with its Terminal tab focused, ⌘[ stays with the terminal and D's page stays`, async () => {
    const r = await Replica.on(await driveBinary());
    const failures: string[] = [];
    const step = async (what: string, want: { id: string }): Promise<boolean> => {
      const wrong = await addressFailures(r, at(want), what);
      failures.push(...wrong);
      return wrong.length === 0;
    };
    try {
      for (const s of [A, B, C]) await r.click(`session:${s.id}`, `the click on ${s.title}'s row`);
      let ok = await step('clicking the rows of A, B and C', C);
      if (ok) { await r.press('cmd-['); await r.press('cmd-['); ok = await step('⌘[ twice from C', A); }
      if (ok) { await r.click(`session:${D.id}`, `the click on ${D.title}'s row`); ok = await step('clicking D\'s row from A', D); }
      if (ok) { await r.press('cmd-]'); ok = await step('⌘] after opening D from A: no forward step is left', D); }
      if (ok) { await r.press('cmd-['); ok = await step('⌘[ from D: B and C were the forward side, so back is A', A); }
      if (ok) { await r.press('cmd-]'); ok = await step('⌘] from A', D); }
      if (ok) {
        await r.click('session-terminal', 'the click on D\'s Terminal tab');
        const focus = await r.focus();
        if (focus !== 'terminal') failures.push(`the Terminal tab, clicked, doesn't hold the keyboard: the snapshot's focus is ${JSON.stringify(focus)}, not "terminal" (README, Pinned 7)`);
        else {
          await r.press('cmd-[');
          const after = await r.focus();
          if (after !== 'terminal') failures.push(`⌘[ with the terminal focused didn't reach the terminal: the keyboard moved to ${JSON.stringify(after)}`);
          await step('⌘[ with the terminal tab focused: the page stays', D);
        }
      }
    } catch (error) {
      failures.push((error as Error).message);
    } finally {
      await r.stop();
    }
    expect(failures).toEqual([]);
  }, 20 * MIN);
});
