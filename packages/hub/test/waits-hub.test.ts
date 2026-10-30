// The long waits through the real hub (#120): the session's start names its ticker to watch, a call past the time
// the same command took before shows one line while it runs (the FileChanged reply) and tells the agent at its next
// hook, the overrun is recorded, and a command that never ends gets its deadline only where approvals are bypassed.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, reply, withHub } from './hub.js';

const procs: ChildProcess[] = [];
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });
const SESSION = '7c4d5e6f-1111-4222-8333-444455556666';
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const out = (r: { stdout: string }) => (r.stdout ? JSON.parse(r.stdout) as Record<string, unknown> : {});
const specific = (r: { stdout: string }) => (out(r).hookSpecificOutput ?? {}) as Record<string, unknown>;

describe('long waits through the hub', () => {
  it('starts where the last hub left off: a call still running and the time a command took are read from the record', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home, hub) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${SESSION}.jsonl`);
      writeFileSync(transcript, '');
      const payload = (event: string, extra: Record<string, unknown>) => ({ session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra });
      const hook = (event: string, extra: Record<string, unknown> = {}) => reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, payload(event, extra), { ppid: claude.pid }));
      const bash = (event: string, id: string, command: string, extra: Record<string, unknown> = {}) => hook(event, { tool_name: 'Bash', tool_input: { command }, tool_use_id: id, permission_mode: 'default', ...extra });
      await hook('SessionStart', { source: 'startup' });
      await hook('UserPromptSubmit', { prompt: 'run the e2e suite', prompt_id: 'p1' });
      expect(out(await bash('PreToolUse', 'c1', 'npm run e2e'))).toEqual({});
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      const until = Date.now() + 10_000;
      while (Date.now() < until && (db.prepare("SELECT count(*) AS n FROM events WHERE kind = 'tool.before'").get() as { n: number }).n < 1) await sleep(100);
      db.close();
      // Ninety seconds pass: the hub is restarted on the record with its clock moved on.
      await hub.restart({ DEEP_HUB_TEST_CLOCK: String(Date.now() + 90_000) });
      const after = await bash('PostToolUse', 'c1', 'npm run e2e', { tool_response: { stdout: '' } });
      expect(String(out(after).systemMessage), 'the call opened under the last hub overran under this one').toMatch(/^DeepBuild: `npm run e2e` ran (9\d s|2 min), about 1 min was expected$/);
      // The next run of the command is expected to take as long: the chat hears so as it starts.
      const next = await bash('PreToolUse', 'c2', 'npm run e2e');
      expect(String(out(next).systemMessage)).toBe('DeepBuild: waiting on `npm run e2e` · about 2 min expected');
    });
  }, 60_000);

  it('names the ticker at the start, shows one line while a call overruns, tells the agent at its next hook, and attaches a deadline only past approvals', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${SESSION}.jsonl`);
      writeFileSync(transcript, '');
      const payload = (event: string, extra: Record<string, unknown>) => ({ session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra });
      const hook = (event: string, extra: Record<string, unknown> = {}) => reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, payload(event, extra), { ppid: claude.pid }));
      const bash = (event: string, id: string, command: string, extra: Record<string, unknown> = {}) => hook(event, { tool_name: 'Bash', tool_input: { command }, tool_use_id: id, permission_mode: 'default', ...extra });

      const ticker = join(root, 'tickers', SESSION.replace(/[^0-9A-Za-z]/g, ''));
      const start = await hook('SessionStart', { source: 'startup' });
      expect(specific(start).watchPaths, 'the start names the ticker the FileChanged hook watches').toEqual([ticker]);
      await hook('UserPromptSubmit', { prompt: 'run the slow thing', prompt_id: 'p1' });

      // The same command ran once before, in about a second and a half: that is the next run's expected time.
      expect(out(await bash('PreToolUse', 'c1', 'sleep 30'))).toEqual({});
      await sleep(1500);
      expect(out(await bash('PostToolUse', 'c1', 'sleep 30', { tool_response: { stdout: '' } }))).toEqual({});

      expect(out(await bash('PreToolUse', 'c2', 'sleep 30'))).toEqual({});
      // Past the expected time, while the call still runs: the ticker changes, and the FileChanged reply carries the line.
      const until = Date.now() + 8000;
      while (!existsSync(ticker) && Date.now() < until) await sleep(100);
      expect(existsSync(ticker), 'the ticker is written once the call overran').toBe(true);
      expect(readFileSync(ticker, 'utf8')).toContain('still waiting on `sleep 30`');
      const changed = await hook('FileChanged', { file_path: ticker, event: 'change' });
      expect(String(out(changed).systemMessage)).toMatch(/^DeepBuild: still waiting on `sleep 30` · \d+ s so far, about \d+ s was expected$/);
      expect(out(await hook('FileChanged', { file_path: ticker, event: 'change' })), 'the line shows once').toEqual({});
      // At the call's next hook the chat sees the overrun and the agent hears it.
      const after = await bash('PostToolUse', 'c2', 'sleep 30', { tool_response: { stdout: '' } });
      expect(String(out(after).systemMessage)).toMatch(/^DeepBuild: `sleep 30` ran \d+ s, about \d+ s was expected$/);
      expect(String(specific(after).additionalContext)).toContain('read what it did before retrying');
      expect(specific(after).permissionDecision).toBeUndefined();

      // A command that never ends: the deadline is attached only where approvals are bypassed, with no decision.
      const bypass = await bash('PreToolUse', 'c3', 'tail -f app.log', { permission_mode: 'bypassPermissions' });
      expect(specific(bypass).updatedInput, 'no history: the kind\'s expected time is the deadline').toEqual({ command: ": 'DeepBuild: ends after 1 min'; tail -f app.log", timeout: 60_000 });
      expect(specific(bypass).permissionDecision).toBeUndefined();
      expect(out(bypass).decision).toBeUndefined();
      await bash('PostToolUse', 'c3', 'tail -f app.log', { tool_response: { stdout: '' } });
      const asked = await bash('PreToolUse', 'c4', 'tail -f app.log');
      expect(specific(asked).updatedInput).toBeUndefined();
      expect(out(asked).systemMessage).toBeUndefined();
      await bash('PostToolUse', 'c4', 'tail -f app.log', { tool_response: { stdout: '' } });

      // The record has the overrun, naming the call, and the session's row says so.
      const until2 = Date.now() + 5000;
      let rows: { data: string }[] = [];
      while (Date.now() < until2) {
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try {
          rows = db.prepare("SELECT data FROM events WHERE kind = 'call.overrun'").all() as { data: string }[];
        } finally { db.close(); }
        if (rows.length) break;
        await sleep(200);
      }
      expect(rows).toHaveLength(1);
      const overrun = JSON.parse(rows[0]!.data) as Record<string, unknown>;
      expect(overrun).toMatchObject({ call: 'c2', kind: 'shell', command: 'sleep 30', deadline: 'none' });
      expect(Number(overrun.ran_ms)).toBeGreaterThanOrEqual(Number(overrun.expected_ms));
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try {
        const readings = db.prepare("SELECT reading FROM session_readings WHERE session_id = ?").all(SESSION) as { reading: string }[];
        expect(readings.map((r) => r.reading).some((r) => r.includes('still waiting on `sleep 30`'))).toBe(true);
      } finally { db.close(); }
    });
  }, 60_000);
});
