// AC19 #18.a57c35bb With another tool's hooks in the same settings file, both hook sets run, and a permission
// prompt answered by typing is recorded as answered with no ask.
// Another tool, as a terminal multiplexer that installs hooks of its own does, has entries on every event in
// ~/.claude/settings.json; `deep setup` installs beside them. The recorded "tools" session of Claude Code 2.1.304
// (#47's corpus) is replayed through the Claude Code stand-in: a Bash call, then a Write whose permission prompt the
// person answered by typing in the terminal, with no hook answering it.

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, FIXTURES, NODE, allEvents, cleanup, corpusTranscript, corpusTurns, eventually, firedShown, inbox, jsonLines, makeHome, newSession, ours,
  readSettings, sessions, setup, startHub, theirs, withoutDeepBuild, writeSettings, type Ev, type Fired, type Line,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd', 'Notification'];
const TOOL_EVENTS = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure']);

describe('AC19 #18.a57c35bb With another tool\'s hooks in the same settings file, both hook sets run, and a permission prompt answered by typing is recorded as answered with no ask', () => {
  it('AC19 #18.a57c35bb another tool\'s hooks and DeepBuild\'s both run on every hook of a recorded session, and the Write prompt typed yes to reads waiting, then working, with no ask', async () => {
    const { tmp, home } = makeHome();
    const log = join(tmp, 'mux.jsonl');
    const mux: Line = Object.fromEntries(EVENTS.map((event) => [event, [{ ...(TOOL_EVENTS.has(event) ? { matcher: '*' } : {}), hooks: [{ type: 'command', command: `'${NODE}' '${join(FIXTURES, 'user-hook.mjs')}' mux-${event} '${log}'`, timeout: 5 }] }]]));
    writeSettings(home, { hooks: mux, statusLine: { type: 'command', command: 'echo mux' } });
    const hub = await startHub(home);
    await setup(home);
    expect(withoutDeepBuild(readSettings(home).hooks), 'AC19 deep setup must keep the other tool\'s entries in the file as they were').toEqual(mux);

    const s = newSession(home);
    const claude = Claude.start(home);
    const turns = corpusTurns(s);
    const permission = turns.findIndex((t) => t.event === 'PermissionRequest');
    const written = turns.findIndex((t, i) => i > permission && t.event === 'PostToolUse');
    const write = turns[permission]!.payload.tool_input as Line;
    const statusOf = async () => (await sessions(hub)).find((row) => row.id === s.id)?.status as string | undefined;
    const fired: Fired[] = [];
    let waiting: string | undefined;
    let answered: string | undefined;
    for (const [i, t] of turns.entries()) {
      corpusTranscript(s, t.transcriptLines);
      fired.push(await claude.hook(t.event, t.payload));
      // Claude Code shows its own prompt now, since no hook answered; the person reads it and types yes.
      if (i === permission) await eventually(async () => (waiting = await statusOf()) === 'waiting', 15_000);
      if (i === written) await eventually(async () => (answered = await statusOf()) === 'working', 15_000);
    }

    // Both hook sets ran on every hook: the other tool got each payload, and DeepBuild's entry ran and exited 0.
    const got = jsonLines(readFileSync(log, 'utf8'));
    expect(got.map((l) => `${l.input.hook_event_name} ${l.input.session_id}`), 'AC19 the other tool\'s hook must run for every hook of the session, with its payload').toEqual(turns.map((t) => `${t.event} ${s.id}`));
    turns.forEach((t, i) => {
      expect(theirs(fired[i]!).length, `AC19 the other tool's entry must run for ${t.event} (#${i + 1})`).toBe(1);
      const deepRuns = ours(fired[i]!);
      expect(deepRuns.length, `AC19 DeepBuild's entry must run for ${t.event} (#${i + 1}) beside the other tool's: ${firedShown(fired[i]!)}`).toBeGreaterThan(0);
      for (const r of deepRuns.filter((d) => !d.async)) expect({ code: r.code, timedOut: r.timedOut }, `AC19 DeepBuild's ${t.event} entry must exit 0 in time: ${firedShown(fired[i]!)}`).toEqual({ code: 0, timedOut: false });
    });

    // DeepBuild recorded the session, the prompt and its answer.
    let events: Ev[] = [];
    const mine = (e: Ev) => e.session === s.id;
    await eventually(async () => (events = (await allEvents(hub)).filter(mine)).filter((e) => e.kind === 'tool.after').length >= 2 && events.some((e) => e.kind === 'agent.stop'), 30_000);
    const kinds = events.map((e) => e.kind);
    for (const kind of ['session.start', 'tool.before', 'permission.request', 'tool.after', 'agent.stop']) {
      expect(kinds, `AC19 the record must hold the session's ${kind} with the other tool's hooks in the same file: ${kinds.join(', ')}`).toContain(kind);
    }
    expect(events.some((e) => e.kind === 'permission.request' && JSON.stringify(e.data).includes(String(write.file_path))), `AC19 the record must hold the Write's permission request for ${write.file_path}`).toBe(true);
    expect(waiting, `AC19 while Claude Code's own prompt for the Write was open, the session must read waiting (sessions.read): ${waiting}`).toBe('waiting');
    expect(answered, `AC19 once the Write ran after the person typed yes, the prompt is answered and the session must read working again (sessions.read): ${answered}`).toBe('working');

    // With no ask: the person answered in the terminal, so DeepBuild never asked them.
    const all = await allEvents(hub);
    expect(all.filter((e) => e.kind.startsWith('ask.')).map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 200)}`), 'AC19 a permission prompt answered by typing must open no ask').toEqual([]);
    expect((await inbox(hub)).filter((row) => row.session === s.id), 'AC19 the inbox must hold no ask for the typed answer').toEqual([]);
  }, 600_000);
});
