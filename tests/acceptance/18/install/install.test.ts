// AC3 #18.183038c2 Existing user hooks keep working after install.
// Your own settings file, with hooks of yours on six events and settings that aren't hooks, goes through `deep
// setup`; then the same session's hooks fire through the Claude Code stand-in before and after the install. Your
// entries must still be in the file as you wrote them, and each must run with the same input and give the same
// output it gave before, while DeepBuild's entries run beside them.

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, FIXTURES, NODE, cleanup, corpusTranscript, corpusTurns, deepEntries, firedShown, jsonLines, makeHome, newSession,
  ours, payload, readSettings, setup, startHub, stopHub, tag, theirs, withoutDeepBuild, writeSettings, type Fired, type Line, type Replayed,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** What of `yours` isn't in `now`: each key of an object, each item of a list (anywhere in it), each other value as it was. */
function missing(yours: unknown, now: unknown, at = ''): string[] {
  if (Array.isArray(yours)) {
    if (!Array.isArray(now)) return [`${at || '/'} is no longer a list`];
    return yours.flatMap((item, i) => (now.some((n) => missing(item, n).length === 0) ? [] : [`${at}/${i} ${JSON.stringify(item)}`]));
  }
  if (typeof yours === 'object' && yours !== null) {
    if (typeof now !== 'object' || now === null || Array.isArray(now)) return [`${at || '/'} is no longer an object`];
    return Object.entries(yours).flatMap(([k, v]) => missing(v, (now as Line)[k], `${at}/${k}`));
  }
  return yours === now ? [] : [`${at || '/'} was ${JSON.stringify(yours)}, now ${JSON.stringify(now)}`];
}

describe('AC3 #18.183038c2 Existing user hooks keep working after install', () => {
  it('AC3 #18.183038c2 after deep setup your hooks are still in ~/.claude/settings.json as you wrote them, and each runs with the same input and the same result as before, beside DeepBuild\'s', async () => {
    const { tmp, home } = makeHome();
    const log = join(tmp, 'yours.jsonl');
    const yours = (name: string): Line => ({ type: 'command', command: `'${NODE}' '${join(FIXTURES, 'user-hook.mjs')}' ${name} '${log}'` });
    const mine: Line = {
      model: 'opus',
      permissions: { allow: ['Bash(npm test:*)'], deny: ['Read(./.env)'] },
      env: { MY_FLAG: '1' },
      myTool: { nested: [1, 2, { keep: true }] },
      hooks: {
        SessionStart: [{ matcher: 'startup', hooks: [yours('start')] }],
        UserPromptSubmit: [{ hooks: [yours('prompt')] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [yours('guard')] }, { matcher: 'Edit|Write', hooks: [{ ...yours('edit-watch'), timeout: 10 }] }],
        PostToolUse: [{ matcher: '*', hooks: [yours('after')] }],
        Stop: [{ hooks: [yours('stop')] }],
        Notification: [{ hooks: [yours('notify')] }],
      },
    };
    writeSettings(home, mine);

    // One session, the same hooks fired twice: before the install, and after it.
    const s = newSession(home);
    const destructive = `rm -rf build-${tag(3)}`;
    const turns: Replayed[] = [
      ...corpusTurns(s),
      { event: 'PreToolUse', payload: payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: destructive }, tool_use_id: 'toolu_01Ac3DestructiveCall0000' }), transcriptLines: 11 },
      { event: 'Notification', payload: payload(s, 'Notification', { message: 'Claude needs your permission', notification_type: 'permission_prompt' }), transcriptLines: 11 },
    ];
    const fire = async (claude: Claude): Promise<Fired[]> => {
      const all: Fired[] = [];
      for (const t of turns) {
        corpusTranscript(s, t.transcriptLines);
        all.push(await claude.hook(t.event, t.payload));
      }
      return all;
    };
    const result = (f: Fired) => theirs(f).map((r) => ({ command: r.command, code: r.code, signal: r.signal, timedOut: r.timedOut, stdout: r.stdout }));

    const before = await fire(Claude.start(home));
    const logBefore = jsonLines(readFileSync(log, 'utf8'));
    expect(logBefore.length, 'the stand-in ran your hooks before the install, one log line per run (the control)').toBe(before.reduce((n, f) => n + theirs(f).length, 0));
    expect(logBefore.length, 'your hooks ran on every hook but the PermissionRequest, which has none of yours (the control)').toBe(turns.length - 1);
    expect(theirs(before.at(-2)!).some((r) => r.stdout.includes('"permissionDecision":"deny"')), 'your guard denies the rm -rf before the install (the control)').toBe(true);

    const hub = await startHub(home);
    await setup(home);
    const after = readSettings(home);

    // In the file: every setting of yours unchanged, and your hooks exactly as you wrote them once DeepBuild's are set aside.
    // Setup may add settings of its own (an allow rule for its tools, say); every value of yours must still be there.
    for (const key of Object.keys(mine).filter((k) => k !== 'hooks')) {
      expect(missing(mine[key], after[key]), `AC3 deep setup must keep your setting "${key}" in ~/.claude/settings.json: ${JSON.stringify(after[key])}`).toEqual([]);
    }
    expect(withoutDeepBuild(after.hooks), 'AC3 deep setup must keep every hook of yours, in its group with its matcher and its fields, as you wrote it').toEqual(mine.hooks);
    expect(deepEntries(after).filter((e) => e.event === 'PreToolUse').length, `AC3 deep setup must add DeepBuild's PreToolUse entry beside yours: ${JSON.stringify(after.hooks)}`).toBeGreaterThan(0);

    // Run: each of your hooks gets the same input and gives the same output, exit code included, as before.
    const fired = await fire(Claude.start(home));
    turns.forEach((t, i) => {
      expect(result(fired[i]!), `AC3 your hooks for ${t.event} (#${i + 1}) must run as before the install: ${firedShown(fired[i]!)}`).toEqual(result(before[i]!));
    });
    const logAfter = jsonLines(readFileSync(log, 'utf8')).slice(logBefore.length);
    expect(logAfter.map((l) => ({ name: l.name, input: l.input })), 'AC3 your hooks must get the same input after the install as before it').toEqual(logBefore.map((l) => ({ name: l.name, input: l.input })));
    expect(theirs(fired.at(-2)!).some((r) => r.stdout.includes('"permissionDecision":"deny"')), 'AC3 your guard must still deny the rm -rf after the install').toBe(true);

    // Beside them, DeepBuild's entries ran, so the install is really there.
    for (const i of [0, 2, 3, 4, turns.length - 2]) {
      const deepRuns = ours(fired[i]!).filter((r) => !r.async);
      expect(deepRuns.length, `AC3 DeepBuild's entry must run for ${turns[i]!.event} beside yours: ${firedShown(fired[i]!)}`).toBeGreaterThan(0);
      for (const r of deepRuns) expect({ code: r.code, timedOut: r.timedOut }, `AC3 DeepBuild's ${turns[i]!.event} entry must exit 0 in time: ${firedShown(fired[i]!)}`).toEqual({ code: 0, timedOut: false });
    }
    await stopHub(hub);
  }, 600_000);
});
