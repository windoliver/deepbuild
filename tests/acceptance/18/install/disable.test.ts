// AC8 #18.afa67907 A `hooks` disable written by a recorded agent Edit is put back at the next SessionStart with a
// reading naming the call, and the same flag set by you outside a session stays.
//
// Blind redraft of disable.test.ts (README: Disputes). Claude Code's hooks disable is `"disableAllHooks": true` in
// ~/.claude/settings.json (README: Readings, item 5).
//
// Why this redraft: `deep setup` now installs the shipped guard entries as ~/.deepbuild/rules.json, because the
// fast safety rules apply from the start (design: How it installs). One of them, the fail_closed entry
// `no-agent-config-write`, denies any agent write to ~/.claude/settings.json even with the hub down, so the original
// control (the agent's Edit runs with the hub stopped) fails on a correct program. That denial is required
// behavior. The criterion is about a disable that reaches the file anyway, so this file reads it as: you have taken
// that guard entry out of rules.json yourself (it is your file; the design lets no agent write it, and deep-hook
// applies the fail_closed entries it holds when the hub is down), then the agent's recorded Edit writes the flag
// while the hub is stopped. That keeps every word of the criterion: a recorded agent Edit wrote the flag; it is put
// back at the next SessionStart with a reading naming the call; the same flag set by you stays. Removing the entry
// changes only whether the floor stops the Edit; what the hub must do once the flag is in the file is unchanged.
// Every other check of the original first test is kept, and the second test is the original's, unchanged.
//
// In the first home the Edit's hooks reach the record from deep-hook's spool when the hub starts again, so only the
// next SessionStart's recheck can see the flag. In the second home you write the same flag in an editor, with no
// session open, while the hub runs.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, allEvents, appendTranscript, callId, cleanup, deepEntries, eventually, firedShown, makeHome, newSession, ours, payload, readSettings,
  readingTexts, rootOf, settingsFile, setup, startHub, stopHub, typedPrompt, type Entry, type Line,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** DeepBuild's entries, as a comparable list: event, matcher and the entry itself. */
const ourEntries = (settings: Line) => deepEntries(settings).map((e: Entry) => JSON.stringify({ event: e.event, matcher: e.matcher ?? null, hook: e.hook })).sort();

/** The shipped guard entry that denies an agent's write to ~/.claude/settings.json (crates/deep-hook/default-rules.json). */
const CONFIG_GUARD = 'no-agent-config-write';

/**
 * You take the config-write guard out of ~/.deepbuild/rules.json in an editor. The file's shape is the hub's, so this
 * drops the entry wherever it is: a key of that name, or a list item whose `name` or `id` is that name. A rules.json
 * that still names the entry afterwards is BLOCKED, since the test can't then say the guard is gone. With no
 * rules.json there is no installed entry to remove.
 */
function removeConfigGuard(home: string): void {
  const file = join(rootOf(home), 'rules.json');
  if (!existsSync(file)) return;
  const drop = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.filter((x) => !(x && typeof x === 'object' && [(x as Line).name, (x as Line).id].includes(CONFIG_GUARD))).map(drop);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Line).filter(([k]) => k !== CONFIG_GUARD).map(([k, x]) => [k, drop(x)]));
    return v;
  };
  const text = readFileSync(file, 'utf8');
  const kept = JSON.stringify(drop(JSON.parse(text)), null, 2);
  if (kept.includes(CONFIG_GUARD)) throw Error(`BLOCKED: can't take ${CONFIG_GUARD} out of ${file} as you would in an editor: ${text.slice(0, 600)}`);
  writeFileSync(file, `${kept}\n`);
}

describe('AC8 #18.afa67907 A `hooks` disable written by a recorded agent Edit is put back at the next SessionStart with a reading naming the call, and the same flag set by you outside a session stays', () => {
  it('AC8 #18.afa67907 an agent\'s Edit that writes disableAllHooks (your config-write guard taken out of rules.json) is put back at the next SessionStart, with a reading naming that Edit', async () => {
    const { home } = makeHome();
    let hub = await startHub(home);
    await setup(home);
    const installed = readSettings(home);
    expect(ourEntries(installed).length, 'setup installed DeepBuild\'s entries (the control)').toBeGreaterThan(0);

    // The agent's session starts while the hub runs.
    const s = newSession(home);
    const claude = Claude.start(home);
    for (const r of ours(await claude.hook('SessionStart', payload(s, 'SessionStart')))) expect(r.code, 'DeepBuild\'s SessionStart entry ran (the control)').toBe(0);
    typedPrompt(s, 'Tidy up my Claude Code settings.');
    await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Tidy up my Claude Code settings.' }));
    await eventually(async () => (await allEvents(hub)).some((e) => e.kind === 'session.start' && e.session === s.id), 20_000);

    // The hub stops. You take the config-write guard out of your rules.json; then the agent's Edit writes the disable
    // flag into the settings file, its hooks spooled by deep-hook.
    await stopHub(hub);
    removeConfigGuard(home);
    const file = settingsFile(home);
    const text = readFileSync(file, 'utf8');
    const old = /"hooks"\s*:\s*\{/.exec(text)?.[0];
    if (!old) throw Error(`BLOCKED: no "hooks" object in ${file}: ${text.slice(0, 400)}`);
    const edit = { file_path: file, old_string: old, new_string: `"disableAllHooks": true, ${old}`, replace_all: false };
    const id = callId();
    appendTranscript(s, { type: 'assistant', message: { role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id, name: 'Edit', input: edit }] } });
    const pre = await claude.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'Edit', tool_input: edit, tool_use_id: id }));
    for (const r of ours(pre)) {
      expect(r.code, `DeepBuild's PreToolUse entry let the Edit run with the hub stopped and ${CONFIG_GUARD} taken out of rules.json (the control): ${firedShown(pre)}`).toBe(0);
      expect(/"permissionDecision"\s*:\s*"deny"|"decision"\s*:\s*"block"/.test(r.stdout), `DeepBuild's PreToolUse entry did not deny the Edit once you took ${CONFIG_GUARD} out of rules.json (the control): ${firedShown(pre)}`).toBe(false);
    }
    writeFileSync(file, text.replace(old, edit.new_string));
    expect(readSettings(home).disableAllHooks, 'the agent\'s Edit wrote the flag (the control)').toBe(true);
    appendTranscript(s, { type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: `The file ${file} has been updated successfully.` }] } });
    await claude.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: 'Edit', tool_input: edit, tool_use_id: id, tool_response: { filePath: file, oldString: old, newString: edit.new_string, replaceAll: false } }));

    // The hub starts again; then the next session starts.
    hub = await startHub(home);
    const next = newSession(home);
    await Claude.start(home).hook('SessionStart', payload(next, 'SessionStart'));
    const putBack = await eventually(() => {
      const now = readSettings(home);
      return now.disableAllHooks !== true && JSON.stringify(ourEntries(now)) === JSON.stringify(ourEntries(installed));
    }, 30_000);
    const now = readSettings(home);
    expect({ disableAllHooks: now.disableAllHooks ?? null, entriesAsInstalled: JSON.stringify(ourEntries(now)) === JSON.stringify(ourEntries(installed)) },
      `AC8 the disable flag the agent's Edit (${id}) wrote must be put back by the next SessionStart, with DeepBuild's entries as setup wrote them: ${JSON.stringify(now).slice(0, 1500)}`)
      .toEqual({ disableAllHooks: null, entriesAsInstalled: true });
    expect(putBack).toBe(true);

    // A reading names the call: the Edit's tool_use_id, or the record's ID of its PreToolUse or PostToolUse event.
    const events = await allEvents(hub);
    const editEvents = events.filter((e) => e.session === s.id && ['tool.before', 'tool.after'].includes(e.kind) && JSON.stringify(e.data).includes(file));
    expect(editEvents.length, `the agent's Edit of ${file} is in the record, from the spool: ${events.filter((e) => e.session === s.id).map((e) => e.kind).join(', ')}`).toBeGreaterThan(0);
    const names = [id, ...editEvents.map((e) => e.id)];
    const named = await eventually(async () => (await readingTexts(hub)).some((t) => names.some((n) => t.includes(n))), 20_000);
    expect(named, `AC8 health must show a reading that names the agent's Edit (${names.join(' or ')}) as what disabled the hooks`).toBe(true);
  }, 600_000);

  it('AC8 #18.afa67907 the same disableAllHooks flag set by you outside a session stays, through the hub\'s watch and the next SessionStart', async () => {
    const { home } = makeHome();
    const hub = await startHub(home);
    await setup(home);
    // You, in an editor, with no session open: no recorded agent call wrote it.
    const settings = readSettings(home);
    writeFileSync(settingsFile(home), `${JSON.stringify({ disableAllHooks: true, ...settings }, null, 2)}\n`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const s = newSession(home);
    await Claude.start(home).hook('SessionStart', payload(s, 'SessionStart'));
    await eventually(async () => (await allEvents(hub)).some((e) => e.kind === 'session.start' && e.session === s.id), 20_000);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(readSettings(home).disableAllHooks, 'AC8 a disableAllHooks you set outside a session is yours: the next SessionStart and the hub\'s watch must leave it').toBe(true);
  }, 600_000);
});
