// A Codex session through a real hub and deep-hook (#39), beyond the acceptance suite: a subagent's prompt, a slow
// check's deadline and hold, a resumed thread, a home set by CODEX_HOME, what doctor says of trust, setup that Codex's
// files refuse, undo, readings that come back, a subagent's stop across a restart.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allEvents, answer, asksOf, begin, call, choice, cleanup, codexHook, control, Daemon, deep, doctor, editStopTimeout, finished, git, hookShown, hubWithSetup, inSlowLane, makeHome, MINUTE, newThread, ofSession, patch, rowOf, shown, SLOW_ASK, slowRepo, startHub, stopHub, tag, waitFor, type Home, type Line, type Thread,
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
  it('is its own again from its SessionStart, and not before', async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    const a = Daemon.start(h, t.cwd);
    await a.begin(t, 'Say hello.');
    a.stop();
    const b = Daemon.start(h, t.cwd);
    try {
      const post = (id: string) => b.hook(t, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: id, tool_response: { stdout: '', stderr: '', exit_code: 0 } });
      await post('call_before');
      await b.hook(t, 'SessionStart', { source: 'resume' });
      await post('call_after');
      const after = ofSession(await allEvents(hub), t.id, 'tool.after');
      expect(after.find((e) => e.data.call === 'call_before')?.verified).toBe(false);
      expect(after.find((e) => e.data.call === 'call_after')?.verified).not.toBe(false);
    } finally { b.stop(); }
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
});
