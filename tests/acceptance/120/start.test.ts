// AC6 #120.67021934: a wait expected to take over a minute shows what it waits on and its expected time in the chat
// when it starts.
//
// A command's expected time comes from how long the same command took before (design: Commands end). Two earlier
// runs of `npm run e2e` each took 90 s of hub time (README: Time: the hub's test clock is moved on between the call's
// PreToolUse and its PostToolUse), so the third is expected to take over a minute, and its PreToolUse reply carries the
// line the chat shows (`systemMessage`): the command and its expected time. A command with no history gets no such
// line at its start (its expectation is under a minute or unknown), which is the control.
import { afterAll, describe, expect, it } from 'vitest';
import { AC6, awaitEvent, bash, begin, chatLines, cleanup, firedShown, hasDuration, hubWithSetup, lineOf, makeHome, moveOn, newSession, ran } from './helpers.ts';

afterAll(cleanup, 60_000);

const E2E = 'npm run e2e';
const TOOK_MS = 90_000;

describe(`${AC6} A wait expected to take over a minute shows what it waits on and its expected time in the chat when it starts`, () => {
  it(`${AC6} after two runs of \`${E2E}\` that took 90 s each, the third's PreToolUse reply shows a line naming the command and its expected time (over a minute); a command with no history shows none at its start`, async () => {
    const h = makeHome();
    let hub = await hubWithSetup(h);
    const s = newSession(h);
    const { claude } = await begin(h, s, 'Run the e2e suite, then stop.');
    // Control: a first-ever command starts with no line about its expected time.
    const control = await claude.open(s, 'Bash', bash('ls'));
    expect(lineOf(control.fired), `${AC6} a command with no history shows no expected-time line when it starts: ${firedShown(control.fired)}`).toBeUndefined();
    await claude.close(s, control.call, 'Bash', bash('ls'), ran());
    // History: two runs of 90 s of hub time each.
    for (let i = 0; i < 2; i++) {
      const { call } = await claude.open(s, 'Bash', bash(E2E));
      await awaitEvent(hub, s, (e) => e.kind === 'tool.before' && e.data.call === call, `run ${i + 1}'s tool.before`);
      hub = await moveOn(hub, TOOK_MS);
      await claude.close(s, call, 'Bash', bash(E2E), ran('42 passed'));
      await awaitEvent(hub, s, (e) => e.kind === 'tool.after' && e.data.call === call, `run ${i + 1}'s tool.after`);
    }
    // The third run starts: the chat shows what it waits on and for how long it is expected to take.
    const third = await claude.open(s, 'Bash', bash(E2E));
    const line = lineOf(third.fired);
    expect(line, `${AC6} the PreToolUse reply of a wait expected to take over a minute carries the line the chat shows (systemMessage): ${firedShown(third.fired)}`).toBeDefined();
    expect(line, `${AC6} the line says what it waits on, \`${E2E}\`: ${JSON.stringify(line)}`).toContain('e2e');
    expect(hasDuration(line), `${AC6} the line says its expected time (a duration): ${JSON.stringify(line)}`).toBe(true);
    expect(chatLines(s), `${AC6} the chat shows the line (a hook_system_message attachment)`).toContain(line);
    await claude.close(s, third.call, 'Bash', bash(E2E), ran('42 passed'));
    await claude.end();
  }, 120_000);
});
