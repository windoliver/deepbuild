// A Codex session through a real hub and deep-hook (#39), beyond the acceptance suite: a subagent's prompt, a slow
// check's deadline and hold, a resumed thread, a home set by CODEX_HOME, what doctor says of trust, setup that Codex's
// files refuse, undo, readings that come back, a subagent's stop across a restart.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allEvents, answer, childEnv, FIXTURES, NODE, own, asksOf, begin, call, choice, cleanup, codexHook, control, Daemon, deep, doctor, editStopTimeout, finished, git, hookShown, hubWithSetup, inSlowLane, makeHome, MINUTE, newThread, ofSession, patch, rowOf, shown, SLOW_ASK, slowRepo, startHub, stopHub, tag, waitFor, type Home, type Line, type Thread,
} from '../../../tests/acceptance/39/helpers.ts';

afterEach(cleanup, 60_000);
const context = (r: { reply: Line | undefined }) => String(r.reply?.hookSpecificOutput?.additionalContext ?? '');
async function turn(h: Home, cwd: string): Promise<Thread> {
  const t = newThread(h, { cwd });
  await begin(h, t, SLOW_ASK);
  await patch(h, t, 'tax.txt', 'tax');
  return t;
}
const readings = (events: Awaited<ReturnType<typeof allEvents>>, session: string) => ofSession(events, session, 'session.reading').map((e) => String(e.data.reading));
/** The daemon stand-in run as a binary named codex, as a real `codex resume` is. */
function codexDaemon(h: Home, cwd: string): Daemon {
  const exe = join(h.tmp, 'codex-bin', 'codex');
  if (!existsSync(exe)) { mkdirSync(join(h.tmp, 'codex-bin')); symlinkSync(NODE, exe); }
  const child = spawn(exe, [join(FIXTURES, 'daemon.mjs')], { cwd, env: childEnv(h), stdio: ['pipe', 'pipe', 'inherit'] });
  own(child.pid);
  return new (Daemon as unknown as new (c: ChildProcess) => Daemon)(child);
}
/** Its process gone, so a hub can read it as gone. */
async function stopped(d: Daemon): Promise<void> {
  const { child } = d as unknown as { child: ChildProcess };
  const exit = new Promise((done) => child.once('exit', done));
  d.stop();
  await exit;
}
const goalLine = (session: string, id: string, status: string) => [
  { type: 'response_item', payload: { type: 'custom_tool_call', call_id: id, name: 'exec', input: `await tools.update_goal({"status":"${status}"})` } },
  { timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id, output: [{ type: 'input_text', text: JSON.stringify({ goal: { threadId: session, status } }) }] } },
].map((l) => `${JSON.stringify(l)}\n`).join('');

describe('a Codex subagent\'s prompt', () => {
  it('is no ask of yours on the root session: no task, no person', async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    await begin(h, t, 'Say hello.');
    await codexHook(h, t, 'UserPromptSubmit', { prompt: 'Fix the parser so it handles tabs.', agent_id: 'child-1' });
    const asked = ofSession(await allEvents(hub), t.id, 'user.ask').find((e) => e.data.text === 'Fix the parser so it handles tabs.');
    expect(asked?.data.from).toBe('subagent');
    expect(asked?.data.tasks).toEqual([]);
  }, 120_000);
});

describe('a slow check\'s deadline', () => {
  it('ends the run as a FAIL, and that FAIL reaches the agent in the same turn', async () => {
    const h = makeHome();
    const repo = slowRepo(h, { expected_ms: 20 * MINUTE, deadline_ms: 3000, sleepS: 40, exit: 0 });
    const hub = await hubWithSetup(h);
    const t = await turn(h, repo);
    const r = await codexHook(h, t, 'Stop', {}, 120_000);
    expect(r.ran.ms, hookShown(r)).toBeLessThan(25_000);
    expect(r.reply?.decision, hookShown(r)).toBe('block');
    expect(String(r.reply?.reason)).toMatch(/FAIL/);
    const events = await allEvents(hub);
    expect(inSlowLane(events)).toBe(true);
    expect(finished(events).at(-1)?.data.outcome).toBe('overran');
  }, 240_000);

  it('is measured from the stop: one that no longer fits what is left of the hold is not held', async () => {
    const h = makeHome();
    // 6.9 s plus the 5 s margin fits a 12 s timeout from the check's start, but not from the stop.
    const repo = slowRepo(h, { expected_ms: 20 * MINUTE, deadline_ms: 6900, sleepS: 2 });
    const hub = await hubWithSetup(h);
    editStopTimeout(h, 12);
    const t = await turn(h, repo);
    const r = await codexHook(h, t, 'Stop', {}, 60_000);
    expect(r.ran.ms, hookShown(r)).toBeLessThan(5000);
    expect(r.reply?.decision, hookShown(r)).toBeUndefined();
    expect(readings(await allEvents(hub), t.id).join('\n')).toMatch(/This stop isn't held/);
    await waitFor(async () => finished(await allEvents(hub)).length > 0, 60_000, 'the check to end');
    t.turn = randomUUID();
    expect(context(await codexHook(h, t, 'UserPromptSubmit', { prompt: 'What happened?' }))).toMatch(/FAIL/);
  }, 240_000);

  it('a hold that ends with the check still going says why, and the verdict comes with your next message', async () => {
    const h = makeHome();
    // Ignores the deadline's TERM, so the check outlasts the 7 s hold and is killed after it.
    const repo = slowRepo(h, { expected_ms: 20 * MINUTE, deadline_ms: 1000, sleepS: 1 });
    writeFileSync(join(repo, '.deepbuild/checks/slow.sh'), '#!/bin/sh\ntrap "" TERM\ni=0\nwhile [ $i -lt 40 ]; do sleep 1; i=$((i+1)); done\nexit 0\n', { mode: 0o755 });
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'hangs');
    const hub = await hubWithSetup(h);
    editStopTimeout(h, 12);
    const t = await turn(h, repo);
    const r = await codexHook(h, t, 'Stop', {}, 60_000);
    expect(r.reply?.decision, hookShown(r)).toBeUndefined();
    expect(readings(await allEvents(hub), t.id).join('\n')).toMatch(/This stop isn't held/);
    await waitFor(async () => finished(await allEvents(hub)).length > 0, 60_000, 'the check to be killed');
    expect(finished(await allEvents(hub)).at(-1)?.data.outcome).toBe('overran');
    t.turn = randomUUID();
    expect(context(await codexHook(h, t, 'UserPromptSubmit', { prompt: 'What happened?' }))).toMatch(/FAIL/);
  }, 240_000);

  it('an answer waiting before the stop starts no slow check; one that comes during the hold ends the hold', async () => {
    const h = makeHome();
    const repo = slowRepo(h, { expected_ms: 20 * MINUTE, deadline_ms: 20 * MINUTE, sleepS: 45, exit: 0 });
    const hub = await hubWithSetup(h);
    const d = Daemon.start(h, repo);
    try {
      const t = newThread(h, { cwd: repo });
      await d.init();
      await d.begin(t, SLOW_ASK);
      const question = `Which header ${tag(3)}?`;
      void d.ask(t, choice(question)).catch(() => undefined);
      await waitFor(async () => asksOf(await allEvents(hub), question)[0], 30_000, 'the ask');
      await d.hook(t, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'touch a' }, tool_use_id: `call_${tag(4)}`, tool_response: { stdout: '', stderr: '', exit_code: 0 } });
      const stop = d.hook(t, 'Stop');
      await waitFor(async () => inSlowLane(await allEvents(hub)), 60_000, 'the slow check to start');
      const started = Date.now();
      const asked = asksOf(await allEvents(hub), question)[0]!;
      await answer(h, `ask:${asked.id}`, 'green');
      const r = await stop;
      expect(Date.now() - started, hookShown(r)).toBeLessThan(25_000);
      expect(r.reply?.decision, hookShown(r)).toBe('block');
      expect(String(r.reply?.reason)).toMatch(/green|Green/);
    } finally { d.stop(); }
  }, 240_000);

  it('is said once, and its verdict told once, however many stops the claim has', async () => {
    const h = makeHome();
    const repo = slowRepo(h, { expected_ms: 20 * MINUTE, deadline_ms: 60_000, sleepS: 1, exit: 1 });
    const hub = await hubWithSetup(h);
    editStopTimeout(h, 12);
    const t = await turn(h, repo);
    await codexHook(h, t, 'Stop', {}, 60_000);
    await codexHook(h, t, 'Stop', {}, 60_000);
    await waitFor(async () => finished(await allEvents(hub)).length > 0, 60_000, 'the check');
    expect(readings(await allEvents(hub), t.id).filter((r) => r.startsWith('This stop isn\'t held'))).toHaveLength(1);
    t.turn = randomUUID();
    expect(context(await codexHook(h, t, 'UserPromptSubmit', { prompt: 'What happened?' })).match(/sent this claim back/g)).toHaveLength(1);
  }, 240_000);

  it('a held stop\'s verdict line, once delivered, is not repeated at the next prompt', async () => {
    const h = makeHome();
    // Past the 60 s an answer waits, the hold the delivery was measured by.
    const repo = slowRepo(h, { expected_ms: 20 * MINUTE, deadline_ms: 20 * MINUTE, sleepS: 62, exit: 0 });
    await hubWithSetup(h);
    const t = await turn(h, repo);
    const r = await codexHook(h, t, 'Stop', {}, 120_000);
    expect(r.reply?.systemMessage, hookShown(r)).toBeTruthy();
    t.turn = randomUUID();
    expect(context(await codexHook(h, t, 'UserPromptSubmit', { prompt: 'Thanks.' }))).not.toContain(String(r.reply?.systemMessage));
  }, 240_000);
});

describe('a Codex thread resumed in a new process', () => {
  const post = (d: Daemon, t: Thread, id: string) => d.hook(t, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: id, tool_response: { stdout: '', stderr: '', exit_code: 0 } });
  const verifiedOf = async (hub: Awaited<ReturnType<typeof startHub>>, t: Thread, id: string) => ofSession(await allEvents(hub), t.id, 'tool.after').find((e) => e.data.call === id)?.verified !== false;
  it('is its own again from its SessionStart, and not before', async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    const a = Daemon.start(h, t.cwd);
    await a.begin(t, 'Say hello.');
    await stopped(a);
    const b = codexDaemon(h, t.cwd);
    try {
      await post(b, t, 'call_before');
      await b.hook(t, 'SessionStart', { source: 'resume' });
      await post(b, t, 'call_after');
      expect(await verifiedOf(hub, t, 'call_before')).toBe(false);
      expect(await verifiedOf(hub, t, 'call_after')).toBe(true);
    } finally { b.stop(); }
  }, 120_000);
  it('is not taken from a process still running it, nor by anything but a Codex binary resuming it', async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    const a = Daemon.start(h, t.cwd);
    const other = codexDaemon(h, t.cwd);
    const stranger = Daemon.start(h, t.cwd);
    try {
      await a.begin(t, 'Say hello.');
      await other.hook(t, 'SessionStart', { source: 'resume' });
      await post(other, t, 'call_while_running');
      await post(a, t, 'call_own');
      expect(await verifiedOf(hub, t, 'call_while_running')).toBe(false);
      expect(await verifiedOf(hub, t, 'call_own')).toBe(true);
      await stopped(a);
      await stranger.hook(t, 'SessionStart', { source: 'resume' });
      await post(stranger, t, 'call_stranger');
      expect(await verifiedOf(hub, t, 'call_stranger')).toBe(false);
      await other.hook(t, 'SessionStart', { source: 'compact' });
      await post(other, t, 'call_compact');
      expect(await verifiedOf(hub, t, 'call_compact')).toBe(false);
      await other.hook(t, 'SessionStart', { source: 'resume' });
      await post(other, t, 'call_resumed');
      expect(await verifiedOf(hub, t, 'call_resumed')).toBe(true);
    } finally { other.stop(); stranger.stop(); a.stop(); }
  }, 180_000);
});

describe('two Codex threads on one daemon', () => {
  it.each(['compact', 'clear', 'fork'])('stay apart when one starts again by %s: the other\'s answer is not its', async (source) => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const a = newThread(h);
    const b = newThread(h, { cwd: a.cwd });
    const d = Daemon.start(h, a.cwd);
    try {
      await d.begin(a);
      await d.init();
      await d.hook(b, 'SessionStart', { source });
      const question = `Which header for ${tag()}?`;
      void d.ask(a, choice(question));
      const asked = await waitFor(async () => asksOf(await allEvents(hub), question)[0], 30_000, 'the ask');
      await d.hook(a, 'SessionEnd', { reason: 'other' });
      await answer(h, `ask:${asked.id}`, 'green');
      b.turn = randomUUID();
      const prompted = await d.hook(b, 'UserPromptSubmit', { prompt: 'Go on.' });
      expect(prompted.ran.stdout).not.toMatch(/Green header/);
    } finally { d.stop(); }
  }, 180_000);
  it('files each ask under its own thread, though the shared deep mcp met only the first', async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const a = newThread(h);
    const b = newThread(h, { cwd: a.cwd });
    const d = Daemon.start(h, a.cwd);
    try {
      await d.begin(a);
      await d.init();
      await d.mcp('tools/call', { name: 'deep_status', arguments: {} });
      await d.begin(b);
      const question = `Which header for ${tag()}?`;
      void d.ask(b, choice(question));
      const asked = await waitFor(async () => asksOf(await allEvents(hub), question)[0], 30_000, 'the ask');
      expect(asked.session).toBe(b.id);
    } finally { d.stop(); }
  }, 180_000);
});

describe('a Codex subagent\'s hooks under its own turn', () => {
  it('make no ask on the root, and leave the root\'s turn its own', async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    await begin(h, t, 'Say hello.');
    await codexHook(h, t, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'call_child', agent_id: 'child-1', turn_id: randomUUID() });
    await call(h, t, 'ls');
    expect(ofSession(await allEvents(hub), t.id, 'user.ask').map((e) => e.data.text)).toEqual(['Say hello.']);
  }, 120_000);
});

describe('an Interrupt that can\'t be checked against its session', () => {
  it('ends nothing and says nothing', async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    const d = Daemon.start(h, t.cwd);
    try {
      await d.begin(t, 'Say hello.');
      await codexHook(h, t, 'Interrupt', {});
      const mine = await allEvents(hub);
      expect(ofSession(mine, t.id, 'session.attention').filter((e) => e.writer === 'core' && e.data.state === 'finished')).toEqual([]);
      expect(readings(mine, t.id).join('\n')).not.toMatch(/^Interrupt/m);
    } finally { d.stop(); }
  }, 120_000);
});

describe('a Codex heartbeat gone from the automations', () => {
  it('leaves the row at its next stop', async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    const dir = join(h.codexHome, 'automations', 'beat-a');
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    writeFileSync(join(dir, 'automation.toml'), ['version = 1', 'id = "beat-a"', 'kind = "heartbeat"', 'name = "beat-a"', 'prompt = "Check."', 'status = "ACTIVE"', 'rrule = "FREQ=MINUTELY;INTERVAL=15"', `target_thread_id = "${t.id}"`, `created_at = ${now}`, `updated_at = ${now}`, `last_run_at = ${now}`].join('\n'));
    await begin(h, t, 'Say hello.');
    await codexHook(h, t, 'Stop');
    expect(JSON.stringify(await rowOf(hub, t.id))).toContain('beat-a');
    rmSync(dir, { recursive: true });
    t.turn = randomUUID();
    await codexHook(h, t, 'UserPromptSubmit', { prompt: 'Again.' });
    await codexHook(h, t, 'Stop');
    expect(JSON.stringify(await rowOf(hub, t.id))).not.toContain('beat-a');
  }, 120_000);
});

describe('a Codex home set by CODEX_HOME at setup', () => {
  it('has its sessions verified, and its entries read, by a hub without that variable', async () => {
    const h = makeHome();
    const other = join(h.tmp, 'elsewhere');
    mkdirSync(join(other, 'sessions'), { recursive: true });
    const hub = await startHub(h);
    const set = await deep(h, ['setup'], { CODEX_HOME: other });
    expect(set.code, shown(set)).toBe(0);
    expect(existsSync(join(other, 'hooks.json'))).toBe(true);
    const t = newThread(h);
    t.transcript = join(other, 'sessions', `rollout-${t.id}.jsonl`);
    writeFileSync(t.transcript, `${JSON.stringify({ type: 'session_meta', payload: { id: t.id, cwd: t.cwd, cli_version: t.version } })}\n`);
    await begin(h, t);
    await call(h, t, 'ls');
    expect(ofSession(await allEvents(hub), t.id, 'tool.after').at(-1)?.verified).not.toBe(false);
    expect((await control(hub, 'health') as { codex: { readings: string[] } }).codex.readings).toEqual([]);
  }, 120_000);
});

describe('a Codex home set by CODEX_HOME at setup, later', () => {
  async function elsewhere(): Promise<{ h: Home; other: string; hub: Awaited<ReturnType<typeof startHub>> }> {
    const h = makeHome();
    const other = join(h.tmp, 'elsewhere');
    mkdirSync(join(other, 'sessions'), { recursive: true });
    const hub = await startHub(h);
    const set = await deep(h, ['setup'], { CODEX_HOME: other });
    expect(set.code, shown(set)).toBe(0);
    return { h, other, hub };
  }
  it('is the one doctor reads for hooks = false', async () => {
    const { h, other } = await elsewhere();
    writeFileSync(join(other, 'config.toml'), `${readFileSync(join(other, 'config.toml'), 'utf8')}\n[features]\nhooks = false\n`);
    expect((await doctor(h)).stdout).toMatch(/hooks_disabled/);
  }, 120_000);
  it('is the one undo takes DeepBuild out of', async () => {
    const { h, other } = await elsewhere();
    const undone = await deep(h, ['setup', '--undo']);
    expect(undone.code, shown(undone)).toBe(0);
    for (const file of ['hooks.json', 'config.toml']) if (existsSync(join(other, file))) expect(readFileSync(join(other, file), 'utf8'), file).not.toMatch(/deep-hook|mcp_servers\.deep/);
  }, 120_000);
  it('is the one the hub asks Codex for trust in', async () => {
    const { h, other } = await elsewhere();
    const seen = join(h.tmp, 'codex-home-seen');
    writeFileSync(join(h.bin, 'codex'), `#!/bin/sh\nprintf '%s' "$CODEX_HOME" > '${seen}'\necho '[]'\n`, { mode: 0o755 });
    const t = newThread(h);
    await codexHook(h, t, 'SessionStart');
    await waitFor(async () => existsSync(seen) && readFileSync(seen, 'utf8') !== '', 30_000, 'the hub to ask Codex');
    expect(readFileSync(seen, 'utf8')).toBe(other);
  }, 120_000);
});

describe('doctor on Codex\'s trust', () => {
  const entries = (h: Home) => Object.entries((JSON.parse(readFileSync(join(h.root, 'codex-hooks.json'), 'utf8')) as { hooks: Record<string, { hooks: { command: string }[] }> }).hooks).map(([eventName, g]) => ({ command: g.hooks[0]!.command, eventName, trustStatus: 'trusted', enabled: true }));
  const trustItem = async (h: Home) => (await doctor(h)).stdout.split('\n').filter((l) => l.includes('"codex.hooks_trust"')).join('\n');
  it('warns of a disabled entry and of entries missing from the list, and says healthy only of all of them trusted', async () => {
    const h = makeHome();
    await hubWithSetup(h);
    const file = join(h.root, 'codex-trust.json');
    const all = entries(h);
    writeFileSync(file, JSON.stringify(all));
    expect(await trustItem(h)).toMatch(/"healthy"/);
    writeFileSync(file, JSON.stringify(all.map((e, i) => (i ? e : { ...e, enabled: false }))));
    expect(await trustItem(h)).toMatch(/hooks_untrusted.*disabled/);
    writeFileSync(file, JSON.stringify(all.slice(0, 5)));
    expect(await trustItem(h)).toMatch(/hooks_untrusted/);
    writeFileSync(file, '[]');
    expect(await trustItem(h)).toMatch(/hooks_untrusted/);
  }, 120_000);
});

describe('setup with Codex files it can\'t read', () => {
  it('leaves Codex out, says why, and still sets up Claude Code', async () => {
    const h = makeHome();
    await startHub(h);
    writeFileSync(h.configToml, '[a]\n[a]\n');
    const set = await deep(h, ['setup']);
    expect(set.code, shown(set)).toBe(0);
    expect(set.stderr).toMatch(/config\.toml.*repeats the table/);
    expect(existsSync(h.hooksFile)).toBe(false);
    expect(readFileSync(h.configToml, 'utf8')).toBe('[a]\n[a]\n');
    expect(existsSync(join(h.root, 'codex-hooks.json'))).toBe(false);
    expect(readFileSync(join(h.home, '.claude', 'settings.json'), 'utf8')).toMatch(/deep-hook/);
  }, 120_000);
});

describe('deep setup --undo', () => {
  it('takes out what setup kept for Codex, so doctor no longer reads it as removed', async () => {
    const h = makeHome();
    await hubWithSetup(h);
    expect(existsSync(join(h.root, 'codex-hooks.json'))).toBe(true);
    writeFileSync(join(h.root, 'codex-trust.json'), '[]');
    const undone = await deep(h, ['setup', '--undo']);
    expect(undone.code, shown(undone)).toBe(0);
    for (const left of ['codex-hooks.json', 'codex-trust.json', 'bin/deep-hook']) expect(existsSync(join(h.root, left)), left).toBe(false);
  }, 120_000);
  it('finishes with hooks.json turned invalid and config.toml deleted, and says so', async () => {
    const h = makeHome();
    await hubWithSetup(h);
    writeFileSync(h.hooksFile, '{ not json');
    rmSync(h.configToml);
    const undone = await deep(h, ['setup', '--undo']);
    expect(undone.code, shown(undone)).toBe(0);
    expect(undone.stdout).toMatch(/hooks\.json/);
    expect(existsSync(join(h.root, 'setup.json'))).toBe(false);
  }, 120_000);
});

describe('a reading that comes back', () => {
  it('is recorded again and is what the row shows', async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    await begin(h, t, 'Say hello.');
    for (const [i, status] of ['active', 'paused', 'active'].entries()) {
      writeFileSync(t.transcript, goalLine(t.id, `call_${i}`, status), { flag: 'a' });
      await codexHook(h, t, 'Stop', {}, 60_000);
      // Read off the stop's hook after its reply: the next record waits for this one's reading.
      await waitFor(async () => readings(await allEvents(hub), t.id).filter((r) => r.startsWith('Codex goal')).length === i + 1, 10_000, `reading ${i + 1}, ${status}`);
    }
    expect(readings(await allEvents(hub), t.id).filter((r) => r.startsWith('Codex goal')).map((r) => /goal: (\w+)/.exec(r)![1])).toEqual(['active', 'paused', 'active']);
    expect(JSON.stringify(await rowOf(hub, t.id))).toMatch(/Codex goal: active/);
  }, 120_000);
});

describe('a stop not held, on the row', () => {
  it('stops being the row\'s reason once the session goes on', async () => {
    const h = makeHome();
    const repo = slowRepo(h, { expected_ms: 20 * MINUTE, deadline_ms: 20 * MINUTE, sleepS: 1 });
    const hub = await hubWithSetup(h);
    editStopTimeout(h, 300);
    const t = await turn(h, repo);
    await codexHook(h, t, 'Stop', {}, 60_000);
    expect(String((await rowOf(hub, t.id))?.note)).toMatch(/This stop isn't held/);
    t.turn = randomUUID();
    await codexHook(h, t, 'UserPromptSubmit', { prompt: 'Thanks.' });
    expect((await rowOf(hub, t.id))?.note).toBeUndefined();
  }, 120_000);
});

describe('a subagent\'s stop', () => {
  it('is no boundary of the root\'s turn across a hub restart', async () => {
    const h = makeHome();
    let hub = await hubWithSetup(h);
    const t = newThread(h);
    await begin(h, t, 'Fix the cart total, then stop.');
    await call(h, t, 'touch a');
    await codexHook(h, t, 'SubagentStop', { agent_id: 'child-1', agent_type: 'worker', last_assistant_message: 'done', agent_transcript_path: t.transcript, stop_hook_active: false });
    await stopHub(hub);
    hub = await startHub(h);
    await codexHook(h, t, 'Stop', {}, 60_000);
    const stop = ofSession(await allEvents(hub), t.id, 'agent.stop').at(-1)!;
    expect(stop.data.subagent).toBeUndefined();
    expect(stop.data.did_work).toBe(true);
  }, 120_000);

  it('a SubagentStart naming its own rollout, as Codex 0.160 sends it, is the root\'s reading; a rollout that is not its agent\'s is refused', async () => {
    const h = makeHome();
    const hub = await startHub(h);
    const t = newThread(h);
    await begin(h, t);
    const child = randomUUID();
    await codexHook(h, t, 'SubagentStart', { agent_id: child, agent_type: 'default', transcript_path: join(h.codexHome, 'sessions', `rollout-2026-10-31T17-50-13-${child}.jsonl`) });
    await codexHook(h, t, 'SubagentStart', { agent_id: 'forged', agent_type: 'default', transcript_path: join(h.codexHome, 'sessions', `rollout-${child}.jsonl`) });
    await codexHook(h, t, 'Stop', {}, 60_000);
    const said = await waitFor(async () => { const r = readings(await allEvents(hub), t.id).filter((x) => x.startsWith('SubagentStart')); return r.length ? r : undefined; }, 10_000, 'the reading');
    expect(said).toEqual([`SubagentStart: subagent ${child} (default) started`]);
  }, 120_000);
});
