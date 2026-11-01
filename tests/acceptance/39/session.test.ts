// AC1, AC2, AC3, AC5, AC7, AC8, AC16: a Codex session on the hub, through deep-hook and a stand-in for the shared daemon.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, allEvents, answer, asksOf, begin, call, choice, cleanup, codexHook, Daemon, git, hookShown, hubWithSetup, makeHome, newThread, ofSession, ourEntries, PAST_FACTS, rowOf, sleep, tag, waitFor, type Ev,
} from './helpers.ts';

afterEach(cleanup, 60_000);
const said = (events: readonly Ev[]) => events.map((e) => e.kind).join(', ');

describe(`${AC[1]} A Codex session's tool calls and commits are recorded`, () => {
  it(`${AC[1]} setup's entries in ~/.codex/hooks.json run deep-hook; a shell call and a real git commit in a Codex turn are recorded under the session`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const events = ourEntries(h).map((e) => e.event);
    expect(events, `${AC[1]} setup installs Codex's hooks in ${h.hooksFile}; it holds: ${JSON.stringify(events)}`).toEqual(expect.arrayContaining(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop']));
    const t = newThread(h);
    git(t.cwd, 'init', '-q', '-b', 'main');
    writeFileSync(join(t.cwd, 'a.txt'), 'a\n');
    await begin(h, t);
    const id = await call(h, t, 'git add a.txt && git commit -q -m "Add a"', () => { git(t.cwd, 'add', 'a.txt'); git(t.cwd, 'commit', '-q', '-m', 'Add a'); });
    const sha = git(t.cwd, 'rev-parse', 'HEAD');
    await codexHook(h, t, 'Stop');
    const mine = await waitFor(async () => { const e = ofSession(await allEvents(hub), t.id); return e.some((x) => x.kind.startsWith('commit.') && x.data?.sha === sha) && e; }, 15_000, 'the commit').catch(async () => ofSession(await allEvents(hub), t.id));
    expect(mine.filter((e) => e.kind === 'tool.before' && e.data?.call === id).length, `${AC[1]} the call's tool.before: ${said(mine)}`).toBe(1);
    expect(mine.filter((e) => e.kind === 'tool.after' && e.data?.call === id).length, `${AC[1]} the call's tool.after: ${said(mine)}`).toBe(1);
    expect(mine.filter((e) => e.kind.startsWith('commit.') && e.data?.sha === sha).length, `${AC[1]} the commit ${sha} once: ${said(mine)}`).toBe(1);
  }, 180_000);
});

describe(`${AC[2]} A held stop continues with the answer`, () => {
  it(`${AC[2]} a Codex stop with an open ask is held; your answer comes back as decision: block carrying it, on a reply Codex's Stop schema allows, and setup's Stop entry is what runs it`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    expect(ourEntries(h).some((e) => e.event === 'Stop'), `${AC[2]} setup's Stop entry in ${h.hooksFile} is the hold's route`).toBe(true);
    const t = newThread(h);
    const d = Daemon.start(h, t.cwd);
    await d.begin(t);
    await d.init();
    const question = `Which header for ${tag()}?`;
    void d.ask(t, choice(question));
    const asked = await waitFor(async () => asksOf(await allEvents(hub), question)[0], 30_000, 'the ask');
    const stopping = codexHook(h, t, 'Stop');
    await sleep(1500);
    await answer(h, `ask:${asked.id}`, 'green');
    const r = await stopping;
    expect(r.reply?.decision, `${AC[2]} the stop's reply continues the turn: ${hookShown(r)}`).toBe('block');
    expect(String(r.reply?.reason), `${AC[2]} with your answer`).toMatch(/Green header|green/);
    expect(Object.keys(r.reply ?? {}).filter((k) => !['decision', 'reason', 'continue', 'stopReason', 'suppressOutput', 'systemMessage'].includes(k)), `${AC[2]} no other field`).toEqual([]);
    d.stop();
  }, 180_000);
});

describe(`${AC[3]} An idle Codex session receives the answer on the next message`, () => {
  it(`${AC[3]} an answer after the stop ended starts nothing; the next UserPromptSubmit's additionalContext carries it, once`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    expect(ourEntries(h).some((e) => e.event === 'UserPromptSubmit'), `${AC[3]} setup's UserPromptSubmit entry is the fallback's route`).toBe(true);
    const t = newThread(h);
    const d = Daemon.start(h, t.cwd);
    await d.begin(t);
    await d.init();
    const question = `Which header for ${tag()}?`;
    void d.ask(t, choice(question));
    const asked = await waitFor(async () => asksOf(await allEvents(hub), question)[0], 30_000, 'the ask');
    await codexHook(h, t, 'Stop', {}, 80_000);
    await answer(h, `ask:${asked.id}`, 'green');
    t.turn = crypto.randomUUID();
    const first = await codexHook(h, t, 'UserPromptSubmit', { prompt: 'Anything from you?' });
    const context = String(first.reply?.hookSpecificOutput?.additionalContext ?? '');
    expect(context, `${AC[3]} the next message carries the answer: ${hookShown(first)}`).toMatch(/Green header|green/);
    const second = await codexHook(h, t, 'UserPromptSubmit', { prompt: 'And now?' });
    expect(String(second.reply?.hookSpecificOutput?.additionalContext ?? ''), `${AC[3]} delivered once`).not.toMatch(/Green header/);
    d.stop();
  }, 180_000);
});

describe(`${AC[5]} Two Codex threads on one daemon each call deep_ask, and each ask is filed under its own session`, () => {
  it(`${AC[5]} two threads whose hooks and one deep mcp share a parent process: each deep_ask binds to the PreToolUse stamped for it, in either order`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const a = newThread(h);
    const b = newThread(h);
    const d = Daemon.start(h, a.cwd);
    for (const t of [a, b]) { t.turn = crypto.randomUUID(); await d.hook(t, 'SessionStart'); await d.hook(t, 'UserPromptSubmit', { prompt: 'Pick a colour.' }); }
    await d.init();
    const qa = `Thread A ${tag()}?`;
    const qb = `Thread B ${tag()}?`;
    void d.ask(b, choice(qb));
    void d.ask(a, choice(qa));
    const events = await waitFor(async () => { const e = await allEvents(hub); return asksOf(e, qa).length && asksOf(e, qb).length ? e : undefined; }, 30_000, 'both asks').catch(async () => allEvents(hub));
    expect(asksOf(events, qa).map((e) => e.session), `${AC[5]} thread A's ask under A (${a.id}): ${said(events)}`).toEqual([a.id]);
    expect(asksOf(events, qb).map((e) => e.session), `${AC[5]} thread B's ask under B (${b.id})`).toEqual([b.id]);
    d.stop();
  }, 180_000);
});

describe(`${AC[7]} An answer to a Codex session that has ended reaches only the same thread when it resumes, and otherwise waits on its task`, () => {
  it(`${AC[7]} after SessionEnd your answer reaches no new thread on the daemon; a SessionStart resume of the same thread gets it, and until then it waits`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    const d = Daemon.start(h, t.cwd);
    await d.begin(t);
    await d.init();
    const question = `Which header for ${tag()}?`;
    void d.ask(t, choice(question));
    const asked = await waitFor(async () => asksOf(await allEvents(hub), question)[0], 30_000, 'the ask');
    await codexHook(h, t, 'SessionEnd', { reason: 'other' });
    await answer(h, `ask:${asked.id}`, 'green');
    const other = newThread(h, { cwd: t.cwd });
    const start = await codexHook(h, other, 'SessionStart');
    const prompted = await codexHook(h, other, 'UserPromptSubmit', { prompt: 'New thread.' });
    expect(`${start.ran.stdout}${prompted.ran.stdout}`, `${AC[7]} another thread in the same folder doesn't hear it`).not.toMatch(/Green header/);
    const outcomes = (await allEvents(hub)).filter((e) => e.kind === 'delivery.outcome' && String(e.subject ?? '').includes(asked.id));
    expect(JSON.stringify(outcomes), `${AC[7]} it waits on its task: the answer's delivery outcome says so`).toMatch(/wait|task/i);
    const resumed = await codexHook(h, t, 'SessionStart', { source: 'resume' });
    expect(String(resumed.reply?.hookSpecificOutput?.additionalContext ?? ''), `${AC[7]} the same thread hears it at its resume: ${hookShown(resumed)}`).toMatch(/Green header|green/);
    d.stop();
  }, 180_000);
});

describe(`${AC[8]} A session on a Codex version past its facts is recorded with its holds watch-only and one health reading`, () => {
  it(`${AC[8]} a rollout naming ${PAST_FACTS}: its events are recorded unverified, its stop isn't held, and exactly one reading names the version`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    expect(ourEntries(h).length, `${AC[8]} setup's entries are what sessions run`).toBeGreaterThan(0);
    const t = newThread(h, { version: PAST_FACTS });
    await begin(h, t);
    await codexHook(h, t, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `call_${tag()}` });
    const r = await codexHook(h, t, 'Stop');
    expect(r.reply?.decision, `${AC[8]} a stop of an uncovered version is never held or sent back: ${hookShown(r)}`).toBeUndefined();
    const mine = ofSession(await allEvents(hub), t.id);
    expect(mine.some((e) => e.kind === 'tool.before'), `${AC[8]} still recorded: ${said(mine)}`).toBe(true);
    expect(mine.filter((e) => e.kind !== 'session.reading').every((e) => e.verified === false), `${AC[8]} its events are unverified`).toBe(true);
    const readings = mine.filter((e) => e.kind === 'session.reading' && JSON.stringify(e.data).includes(PAST_FACTS));
    expect(readings.length, `${AC[8]} one health reading names ${PAST_FACTS}: ${said(mine)}`).toBe(1);
    expect(JSON.stringify(await rowOf(hub, t.id)), `${AC[8]} the session's row says watch-only`).toMatch(/watch-only/i);
  }, 180_000);
});

describe(`${AC[16]} A turn you interrupt records an Interrupt event and reads as interrupted, never as a stop or a claim, and a subagent's SubagentStop never holds or judges the parent's stop`, () => {
  it(`${AC[16]} Interrupt records an interrupted turn with no agent.stop and no claim; the row reads interrupted`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    await begin(h, t);
    await call(h, t, 'ls');
    const r = await codexHook(h, t, 'Interrupt', {});
    expect(r.ran.code, hookShown(r)).toBe(0);
    await sleep(1000);
    const mine = ofSession(await allEvents(hub), t.id);
    expect(mine.filter((e) => /interrupt/i.test(e.kind) || /"interrupted"|Interrupt/.test(JSON.stringify(e.data))).length, `${AC[16]} an Interrupt event: ${said(mine)}`).toBeGreaterThan(0);
    expect(mine.filter((e) => e.kind === 'agent.stop' && e.data.outcome !== 'interrupted').length, `${AC[16]} never a stop: ${said(mine)}`).toBe(0);
    expect(mine.filter((e) => e.kind === 'claim.made').length, `${AC[16]} never a claim`).toBe(0);
    expect(JSON.stringify(await rowOf(hub, t.id)), `${AC[16]} reads as interrupted`).toMatch(/interrupted/i);
  }, 120_000);
  it(`${AC[16]} SubagentStart and SubagentStop carrying the root's session ID and an agent_id: answered at once, recorded as the child's, and the parent's stop is neither held nor judged by them`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    await begin(h, t);
    const child = { agent_id: `agent-${tag()}`, agent_type: 'worker' };
    await codexHook(h, t, 'SubagentStart', child);
    await codexHook(h, t, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `call_${tag()}`, ...child });
    const stop = await codexHook(h, t, 'SubagentStop', { ...child, stop_hook_active: false, last_assistant_message: 'Child done.', agent_transcript_path: null });
    expect(stop.ran.ms, `${AC[16]} never held`).toBeLessThan(10_000);
    expect(stop.reply?.decision, `${AC[16]} never sent back: ${hookShown(stop)}`).toBeUndefined();
    await sleep(1000);
    const mine = ofSession(await allEvents(hub), t.id);
    const stops = mine.filter((e) => e.kind === 'agent.stop');
    expect(stops.length, `${AC[16]} the child's stop is recorded: ${said(mine)}`).toBe(1);
    expect(stops[0]!.data.subagent, `${AC[16]} as the child's`).toBe(child.agent_id);
    expect(mine.filter((e) => e.kind === 'claim.made').length, `${AC[16]} no claim for the parent`).toBe(0);
    expect(mine.filter((e) => e.kind === 'session.start').length, `${AC[16]} no second session`).toBe(1);
  }, 120_000);
});
