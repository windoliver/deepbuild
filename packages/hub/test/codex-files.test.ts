// Codex's files and records as DeepBuild reads them (#39): config.toml's tables, a written file's mode, a corrupt trust
// file, a goal record joined to its tool call, a store row newer than the rollout, a row's readings, the row's reason,
// a stale slow check beside a failed one.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { writeThrough } from '../src/agent-files.js';
import { codexReadings, heartbeatsGone, rowReadings, standingReadings } from '../src/codex-loops.js';
import { readTrust, tomlTables, withoutServer, withServer } from '../src/codex-settings.js';
import { GateRunner } from '../src/gate-runner.js';
import { answerWaitMs } from '../src/mcp.js';
import { render } from '../src/status.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const temp = (): string => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'codex-files-'))); dirs.push(d); return d; };
const tables = (text: string) => {
  const read = tomlTables(text);
  if ('refused' in read) throw Error(read.refused);
  return read.tables;
};
const SESSION = '019f0000-0000-7000-8000-000000000001';

describe('config.toml as TOML reads it', () => {
  it('reads dotted keys into the table they name', () => {
    expect(tables('features.hooks = false\n').get('features')?.get('hooks')).toBe('false');
    expect(tables('[mcp_servers]\ndeep.tool_timeout_sec = 8\n').get('mcp_servers.deep')?.get('tool_timeout_sec')).toBe('8');
    expect(tables('[features]\n"hooks" = false # off\n').get('features')?.get('hooks')).toBe('false');
    expect(tables('a."b" = 1\n').get('a')?.get('b')).toBe('1');
  });
  it('keeps comment and bracket characters inside strings from ending a value or opening one', () => {
    const t = tables('notify = ["sh", "-c", "echo a # b"]\npath = "a]["\nmany = [\n  "x", # one [\n  "y",\n]\n[features]\nhooks = false\n');
    expect(t.get('features')?.get('hooks')).toBe('false');
    expect(t.get('')?.get('path')).toBe('"a]["');
  });
  it('reads no table from inside a multi-line string, with an escaped quote or a quote run in it', () => {
    const t = tables('text = """\n[mcp_servers.deep]\n\\""" still in\n"""\nraw = \'\'\'\n[features]\n\'\'\'\nend = "\\"]"\n');
    expect(t.has('mcp_servers.deep')).toBe(false);
    expect(t.has('features')).toBe(false);
  });
  it('lets an array of tables and its subtables repeat, and keeps them out of the plain tables', () => {
    const t = tables('[[a]]\nx = 1\n[a.b]\ny = 1\n[[a]]\nx = 2\n[a.b]\ny = 2\n[features]\nhooks = false\n');
    expect(t.has('a')).toBe(false);
    expect(t.has('a.b')).toBe(false);
    expect(t.get('features')?.get('hooks')).toBe('false');
  });
  it('reads an inline table as its table', () => {
    expect(tables('mcp_servers = { deep = { tool_timeout_sec = 9, args = ["a,b}"] } }\n').get('mcp_servers.deep')?.get('tool_timeout_sec')).toBe('9');
  });
  it('refuses what TOML refuses, with its line', () => {
    expect(tomlTables('a = 1\na = 2\n')).toMatchObject({ refused: expect.stringMatching(/repeats the key a on line 2/) });
    expect(tomlTables('[a]\n[a]\n')).toMatchObject({ refused: expect.stringMatching(/repeats the table \[a\] on line 2/) });
    expect(tomlTables('a.b = 1\n[a]\nb = 2\n')).toMatchObject({ refused: expect.stringMatching(/repeats the key b on line 3/) });
    expect(tomlTables('a = "open\nb = 1\n')).toMatchObject({ refused: expect.stringMatching(/line 1/) });
    expect(tomlTables('a = [1,\n')).toMatchObject({ refused: expect.stringMatching(/line 1/) });
  });
  it('adds no second server however the first is spelled', () => {
    for (const text of ['[mcp_servers."deep"]\ncommand = "x"\n', 'mcp_servers.deep.command = "x"\n', '[mcp_servers]\ndeep = { command = "x" }\n', 'notify = ["a # b"]\n[mcp_servers.deep]\ncommand = "x"\n']) expect(withServer(text, '/n', '/c')).toBe(text);
    expect(withServer('[mcp_servers.other]\ncommand = "x"\n', '/n', '/c')).toContain('[mcp_servers.deep]');
  });
});

describe('taking our server out', () => {
  const ours = '[mcp_servers.deep]\ncommand = "/n"\nargs = ["/c","mcp"]\n';
  it('takes what you added to its table, and no other table', () => {
    expect(withoutServer(`a = 1\n\n${ours}tool_timeout_sec = 900\n[mcp_servers.deep.env]\nX = "1"\n\n[other]\nb = 2\n`, '/n', '/c')).toBe('a = 1\n\n[other]\nb = 2\n');
    expect(withoutServer(`[other]\nb = 2\n\n${ours}`, '/n', '/c')).toBe('[other]\nb = 2\n\n');
  });
  it('leaves a server that isn\'t the one setup recorded', () => {
    const yours = '[mcp_servers.deep]\ncommand = "/yours"\nargs = ["/c","mcp"]\n[other]\nb = 2\n';
    expect(withoutServer(yours, '/n', '/c')).toBe(yours);
    expect(withoutServer('[mcp_servers.deep_two]\ncommand = "/n"\nargs = ["/c","mcp"]\n', '/n', '/c')).toContain('deep_two');
  });
});

describe('a file written through', () => {
  it('keeps the mode of the file it replaces, and a new one is yours alone', () => {
    const d = temp();
    const kept = join(d, 'config.toml');
    writeFileSync(kept, 'a = 1\n', { mode: 0o600 });
    writeThrough(kept, 'a = 2\n');
    expect(statSync(kept).mode & 0o777).toBe(0o600);
    const open = join(d, 'open.toml');
    writeFileSync(open, 'a = 1\n', { mode: 0o640 });
    writeThrough(open, 'a = 2\n');
    expect(statSync(open).mode & 0o777).toBe(0o640);
    const made = join(d, 'made.toml');
    writeThrough(made, 'a = 1\n');
    expect(statSync(made).mode & 0o777).toBe(0o600);
  });
});

describe('a corrupt trust file', () => {
  it('reads as no list, never a throw', () => {
    const root = temp();
    writeFileSync(join(root, 'codex-trust.json'), '[{"comm');
    expect(readTrust(root)).toBeUndefined();
  });
});

const line = (o: object) => `${JSON.stringify(o)}\n`;
const at = (ms: number) => new Date(ms).toISOString();
const goalOutput = (id: string, status: string, ms = 1_000) => line({ timestamp: at(ms), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id, output: [{ type: 'input_text', text: 'Script completed' }, { type: 'input_text', text: JSON.stringify({ goal: { threadId: SESSION, status } }) }] } });
const goalCall = (id: string, tool = 'update_goal') => line({ timestamp: at(900), type: 'response_item', payload: { type: 'custom_tool_call', call_id: id, name: 'exec', input: `await tools.${tool}({"status":"x"})` } });
function rollout(body: string): { home: string; transcript: string } {
  const home = temp();
  mkdirSync(join(home, 'sessions'));
  const transcript = join(home, 'sessions', 'rollout.jsonl');
  writeFileSync(transcript, line({ type: 'session_meta', payload: { id: SESSION, cli_version: '0.160.0' } }) + body);
  return { home, transcript };
}
const goalOf = async (transcript: string) => (await codexReadings(SESSION, transcript, undefined, false)).readings.find((r) => r.startsWith('Codex goal'));

describe('a goal record', () => {
  it('counts only as a goal tool\'s own output', async () => {
    const { transcript } = rollout(goalCall('call_1') + goalOutput('call_1', 'active') + line({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'call_2', name: 'other', input: 'cat notes' } }) + goalOutput('call_2', 'complete') + goalOutput('call_none', 'complete'));
    expect(await goalOf(transcript)).toMatch(/Codex goal: active/);
  });
  it('counts only with a status the facts list', async () => {
    const { transcript } = rollout(goalCall('call_1') + goalOutput('call_1', 'active') + goalCall('call_2') + goalOutput('call_2', 'run rm -rf /'));
    expect(await goalOf(transcript)).toMatch(/Codex goal: active/);
  });
  const store = (home: string, status: string, updated: number) => {
    const db = new DatabaseSync(join(home, 'goals_1.sqlite'));
    db.exec('CREATE TABLE thread_goals (thread_id TEXT PRIMARY KEY, status TEXT, updated_at_ms INTEGER)');
    db.prepare('INSERT INTO thread_goals VALUES (?, ?, ?)').run(SESSION, status, updated);
    db.close();
  };
  it('gives way to a store row newer than it, as a goal Codex itself moved leaves no rollout record', async () => {
    const { home, transcript } = rollout(goalCall('call_1') + goalOutput('call_1', 'active', 1_000));
    store(home, 'budget_limited', 2_000);
    expect(await goalOf(transcript)).toMatch(/Codex goal: budget_limited/);
  });
  it('stands over a store row older than it, and alone when there is no store', async () => {
    const older = rollout(goalCall('call_1') + goalOutput('call_1', 'active', 5_000));
    store(older.home, 'paused', 2_000);
    expect(await goalOf(older.transcript)).toMatch(/Codex goal: active/);
    expect(await goalOf(rollout(goalCall('call_1') + goalOutput('call_1', 'paused')).transcript)).toMatch(/Codex goal: paused/);
  });
});

describe('a row\'s readings', () => {
  const row = (...readings: string[]) => rowReadings(async () => readings.map((reading) => ({ session_id: 's', reading })), ['s'], 0, () => '0 s').then((m) => m.get('s'));
  it('drops a heartbeat gone from the automations, and only that one', async () => {
    const a = 'Codex heartbeat: a, next automatic prompt due x';
    const b = 'Codex heartbeat: b, next automatic prompt due y';
    const gone = heartbeatsGone(standingReadings([a, b]), [a]);
    expect(await row(a, b, ...gone)).toEqual([a]);
    expect(heartbeatsGone(standingReadings([a, b]), [a, b])).toEqual([]);
    expect(await row('Codex heartbeat: no automatic prompt left', ...heartbeatsGone(standingReadings(['Codex heartbeat: no automatic prompt left']), ['Codex goal: active, looping']))).toEqual([]);
  });
  it('says no automatic prompt is left only when no goal goes on', async () => {
    const going = rollout(goalCall('call_1') + goalOutput('call_1', 'active'));
    expect((await codexReadings(SESSION, going.transcript, undefined, true)).readings.join('\n')).not.toMatch(/no automatic prompt left/);
    expect((await codexReadings(SESSION, rollout('').transcript, undefined, true)).readings.join('\n')).toMatch(/no automatic prompt left/);
  });
  it('keeps a heartbeat per automation', async () => {
    expect(await row('Codex heartbeat: a, next automatic prompt due x', 'Codex heartbeat: b, next automatic prompt due y')).toEqual(['Codex heartbeat: a, next automatic prompt due x', 'Codex heartbeat: b, next automatic prompt due y']);
  });
  it('clears them when no automatic prompt is left, and that when one comes back', async () => {
    expect(await row('Codex heartbeat: a, next automatic prompt due x', 'Codex heartbeat: no automatic prompt left')).toEqual(['Codex heartbeat: no automatic prompt left']);
    expect(await row('Codex heartbeat: no automatic prompt left', 'Codex heartbeat: a, next automatic prompt due x')).toEqual(['Codex heartbeat: a, next automatic prompt due x']);
  });
});

describe('the status text', () => {
  it('shows why a stop was not held', () => {
    const text = render([{ id: 'abcdefgh', repo: 'r', agent: 'codex', state: 'needs you', why: 'w', note: 'This stop isn\'t held: slow has no deadline' }], 'from');
    expect(text).toContain('This stop isn\'t held: slow has no deadline');
  });
});

describe('a slow check that can\'t start', () => {
  it('is BLOCKED, never pending, and the next one still runs', async () => {
    const repo = temp();
    const git = (...a: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo });
    git('init', '-q');
    writeFileSync(join(repo, 'f'), '1\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const gate = new GateRunner({
      raw: async () => [], now: Date.now, append: async () => undefined, core: undefined as never,
      start: async (r) => { if (r.check === 'x') throw Error('no start'); return `run:${r.check}`; }, ended: async () => 'passed', slots: () => ({ free: 1 }), budget_ms: 0, hold_ms: 1000,
    });
    const check = (name: string) => ({ check: name, approved: name, on_base: 'fails' as const, expected_ms: 60_000 });
    await gate.stop({ session: 's', claim: 'claim:a', cwd: repo, checks: [check('x'), check('y')], stopAt: Date.now() });
    await gate.turnEnded('claim:a');
    await new Promise((done) => setTimeout(done, 50));
    expect(gate.slowStanding('claim:a')).toEqual({ pending: false, failed: ['x BLOCKED'] });
  });
});

describe('a stale slow check', () => {
  it('neither keeps its claim pending nor hides its sibling\'s FAIL', async () => {
    const repo = temp();
    const git = (...a: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo });
    git('init', '-q');
    writeFileSync(join(repo, 'f'), '1\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    let free = 0;
    const gate = new GateRunner({
      raw: async () => [], now: Date.now, append: async () => undefined, core: undefined as never,
      start: async (r) => `run:${r.check}`, ended: async () => 'failed', slots: () => ({ free }), budget_ms: 0, hold_ms: 1000,
    });
    const check = (name: string) => ({ check: name, approved: name, on_base: 'fails' as const, expected_ms: 60_000 });
    await gate.stop({ session: 's', claim: 'claim:a', cwd: repo, checks: [check('x'), check('y')], stopAt: Date.now() });
    await gate.turnEnded('claim:a');
    await gate.stop({ session: 's', claim: 'claim:b', cwd: repo, checks: [check('x')], stopAt: Date.now() });
    free = 1;
    // The newer claim's x stays out of the queue, so only y of the older claim runs.
    await gate.turnEnded('claim:a');
    await new Promise((done) => setTimeout(done, 50));
    expect(gate.slowStanding('claim:a')).toEqual({ pending: false, failed: ['y FAIL'] });
  });
});

describe('how long deep mcp waits for the hub', () => {
  it('stretches to Codex\'s tool timeout for Codex alone', () => {
    expect(answerWaitMs('codex', () => 600)).toBe(600_000);
    expect(answerWaitMs('codex-mcp-client', () => 10)).toBe(55_000);
    expect(answerWaitMs('claude-code', () => 600)).toBe(55_000);
    expect(answerWaitMs(undefined, () => 600)).toBe(55_000);
  });
});
