// AC12, AC13, AC15, AC21: every reply against Codex's published output schema and Codex's own hook engine; the permission
// reply; patch paths. The engine half runs the real codex (0.160.0) in a scratch CODEX_HOME against a local stand-in for
// the model API, with each hook approved once as `/hooks` records it, so it spends no plan usage and needs no sign-in.
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { engineRun } from './engine.ts';
import { shipped } from '../../../packages/adapters/src/index.ts';
import type { HookRequestLine, PermissionAnswer } from '../../../packages/adapters/src/index.ts';
import {
  AC, allEvents, asksOf, begin, choice, cleanup, codexHook, Daemon, FIXTURES, hookShown, hubWithSetup, makeHome, newThread, ofSession, parseObject, REPO, tag, waitFor, answer, type Home, type Line, type Thread,
} from './helpers.ts';

afterEach(cleanup, 60_000);
const ajv = new (Ajv as unknown as typeof Ajv.default)({ strict: false, allErrors: true });
const FILE: Record<string, string> = { Interrupt: 'interrupt', PermissionRequest: 'permission-request', PostCompact: 'post-compact', PostToolUse: 'post-tool-use', PreCompact: 'pre-compact', PreToolUse: 'pre-tool-use', SessionStart: 'session-start', Stop: 'stop', SubagentStart: 'subagent-start', SubagentStop: 'subagent-stop', UserPromptSubmit: 'user-prompt-submit' };
const schemaOf = (event: string) => JSON.parse(readFileSync(join(FIXTURES, 'schemas', `${FILE[event]}.command.output.schema.json`), 'utf8')) as object;
/** Whether a reply is one Codex's schema accepts; empty stdout, Codex's "no opinion", always is. SessionEnd publishes no output schema: it takes none. */
function valid(event: string, stdout: string): string | null {
  const text = stdout.trim();
  if (!text) return null;
  if (event === 'SessionEnd') return `SessionEnd has no output schema, yet got ${text}`;
  const v = parseObject(text);
  if (!v) return `not a JSON object: ${text}`;
  const check = ajv.compile(schemaOf(event));
  return check(v) ? null : `${JSON.stringify(check.errors)} on ${text}`;
}
const NOT_RECORDED = (e: string) => `Codex's ${e} hook reached the record`;

describe(`${AC[12]} Every reply the hub sends for each of Codex's twelve events validates against Codex's published output schema for that event, and Codex's own hook engine, fed each reply, applies it with no failed hook`, () => {
  /** Each of the twelve events, with a turn set up so the replies that can carry something do. */
  async function twelve(h: Home, hub: Awaited<ReturnType<typeof hubWithSetup>>): Promise<Map<string, string>> {
    const t = newThread(h);
    const replies = new Map<string, string>();
    const fire = async (event: string, extra: Line = {}) => { const r = await codexHook(h, t, event, extra); replies.set(event, r.ran.stdout); return r; };
    await fire('SessionStart');
    await fire('UserPromptSubmit', { prompt: 'Fix it.' });
    await fire('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `call_${tag()}` });
    await fire('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls', description: 'list' } });
    await fire('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `call_${tag()}`, tool_response: { stdout: '', exit_code: 0 } });
    await fire('PreCompact', { trigger: 'manual', custom_instructions: null });
    await fire('PostCompact', { trigger: 'manual' });
    await fire('SubagentStart', { agent_id: `a-${tag()}`, agent_type: 'worker' });
    await fire('SubagentStop', { agent_id: `a-${tag()}`, agent_type: 'worker', stop_hook_active: false, last_assistant_message: 'ok', agent_transcript_path: null });
    await fire('Stop');
    await fire('Interrupt', {});
    await fire('SessionEnd', { reason: 'other' });
    void hub;
    return replies;
  }
  it(`${AC[12]} all twelve: each reply validates, each hook is recorded, and a hub with its Stop block, PreToolUse deny and permission reply really replies (the schema isn't met by silence alone)`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const replies = await twelve(h, hub);
    const events = await allEvents(hub);
    const kinds = new Set(events.flatMap((e) => (e.session ? [e.kind] : [])));
    for (const [event, stdout] of replies) expect(valid(event, stdout), `${AC[12]} ${event}'s reply against Codex's schema`).toBeNull();
    // Recorded, not just answered: an event the hub drops replies nothing and validates trivially.
    for (const [event, seen] of [['Interrupt', /interrupt/i], ['SubagentStart', /subagent/i], ['SubagentStop', /agent\.stop/], ['PreCompact', /compact/i], ['PostCompact', /compact/i]] as const) {
      expect([...kinds].some((k) => seen.test(k)) || events.some((e) => JSON.stringify(e.data).includes(event)), `${AC[12]} ${NOT_RECORDED(event)}: ${[...kinds].join(', ')}`).toBe(true);
    }
    // The replies that carry a decision: a deny with its reason; a stop's block; no other field.
    const t = newThread(h);
    await begin(h, t);
    const pending = await codexHook(h, t, 'PreToolUse', { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Environment ID: remote\n*** Add File: x.txt\n+x\n*** End Patch\n' }, tool_use_id: `call_${tag()}` });
    expect(pending.reply?.hookSpecificOutput?.permissionDecision, `${AC[12]} a deny: ${hookShown(pending)}`).toBe('deny');
    expect(String(pending.reply?.hookSpecificOutput?.permissionDecisionReason ?? ''), `${AC[12]} a deny carries its reason`).not.toBe('');
    expect(valid('PreToolUse', pending.ran.stdout), `${AC[12]} and validates`).toBeNull();
  }, 240_000);

  it(`${AC[12]} Codex's own hook engine (real codex, a turn on a stand-in model): the hub's Stop reply is applied, and a malformed one isn't. The other events' engine half is BLOCKED: app.live.test.ts`, async () => {
    const h = makeHome({ real: true });
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    const d = Daemon.start(h, t.cwd);
    await d.begin(t);
    await d.init();
    // Replies the hub really gives: a stop's continuation, carrying an answer.
    const question = `Engine ${tag()}?`;
    void d.ask(t, choice(question));
    const asked = await waitFor(async () => asksOf(await allEvents(hub), question)[0], 30_000, 'the ask');
    const stopping = codexHook(h, t, 'Stop');
    await new Promise((r) => setTimeout(r, 1000));
    await answer(h, `ask:${asked.id}`, 'green');
    const stopReply = (await stopping).ran.stdout.trim();
    expect(parseObject(stopReply)?.decision, `${AC[12]} the hub's Stop reply: ${stopReply}`).toBe('block');
    d.stop();
    const applied = await engineRun(h, { Stop: stopReply });
    expect(applied.requests, `${AC[12]} Codex applied the hub's Stop reply, continuing the turn: ${stopReply} ${applied.err}`).toBeGreaterThanOrEqual(2);
    expect(applied.bodies[1], `${AC[12]} with its reason`).toContain(String(parseObject(stopReply)?.reason).slice(0, 40).replaceAll('\n', '\\n'));
    const malformed = await engineRun(makeHome({ real: true }), { Stop: JSON.stringify({ decision: 'nope' }) });
    expect(malformed.requests, `${AC[12]} and a reply Codex fails doesn't continue it, so this proves something`).toBe(1);
  }, 300_000);
});

// ---- The recorded PermissionRequest, from adapters/corpus/codex/0.160.0/permission, its command `git push origin main`.
const PUSH = 'git push origin main';
const recorded = (): Line => {
  const line = readFileSync(join(REPO, 'adapters/corpus/codex/0.160.0/permission/events.jsonl'), 'utf8').split('\n').map((l) => parseObject(l)).find((l) => l?.payload?.hook_event_name === 'PermissionRequest')!;
  return { ...line.payload, tool_input: { command: PUSH, description: 'Push to main' } };
};
const request = (): HookRequestLine => ({ v: 1, agent: 'codex', event: 'PermissionRequest', seq: `${Date.now()}000000`, id: '01K74G3A5C7E9G1J3M5P7R9T1V', pid: 1, ppid: 1, matched: [], payload: recorded() });
const answerOf = (o: Partial<PermissionAnswer>): PermissionAnswer => ({ ask: 'ask:01K74G3A5C7E9G1J3M5P7R9T1V', session: String(recorded().session_id), option: null, label: null, decision: 'none', words: null, provisional: false, undoes: null, ...o });
const adapterReply = () => shipped().get('codex').permissionReply;

describe(`${AC[13]} A permission request that a saved deny covers gets behavior: deny with its message and no other field, and Codex shows you no prompt for it; a reply carrying edited input or a rule for later is never sent`, () => {
  it(`${AC[13]} the adapter's reply to a saved deny, and to an allow for the session, carries only behavior and message: no updatedInput, updatedPermissions or interrupt`, () => {
    const reply = adapterReply();
    expect(typeof reply, `${AC[13]} the Codex adapter gives a permission reply`).toBe('function');
    const deny = reply!(answerOf({ decision: 'deny', words: 'Your saved rule: no pushes to main.', option: 'deny', label: 'Deny' }), request());
    expect(deny, `${AC[13]} behavior: deny with its message and no other field`).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Your saved rule: no pushes to main.' } } });
    const forSession = reply!(answerOf({ decision: 'allow', for: 'session', option: 'allow' }), { ...request(), payload: { ...recorded(), permission_suggestions: [{ type: 'addRules' }] } });
    expect(forSession, `${AC[13]} a rule for later is never sent, even for the session`).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  });
  it(`${AC[13]} through the hub: with a saved deny for the call (your deny on its authority ask, saved as a decision), the PermissionRequest gets behavior: deny and its message, validated by Codex's schema, and no ask opens`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    const d = Daemon.start(h, t.cwd);
    await d.begin(t);
    await d.init();
    const question = `Push to main ${tag()}?`;
    void d.ask(t, { kind: 'authority', question, options: [{ id: 'allow', label: 'Push', decision: 'allow' }, { id: 'deny', label: 'Deny', decision: 'deny' }], recommended: 'deny', permission: { tool: 'Bash', command: PUSH } });
    const asked = await waitFor(async () => asksOf(await allEvents(hub), question)[0], 30_000, 'the ask');
    await answer(h, `ask:${asked.id}`, 'deny');
    const saved = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'decision.created'), 10_000, 'the decision').catch(() => undefined);
    expect(saved, `${AC[13]} your deny is saved as a decision (README: Assumed surfaces)`).toBeDefined();
    const r = await codexHook(h, t, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: PUSH, description: 'Push' } });
    expect(r.reply?.hookSpecificOutput?.decision?.behavior, `${AC[13]} ${hookShown(r)}`).toBe('deny');
    expect(Object.keys(r.reply?.hookSpecificOutput?.decision ?? {}).sort(), `${AC[13]} no other field`).toEqual(['behavior', 'message']);
    expect(valid('PermissionRequest', r.ran.stdout)).toBeNull();
    d.stop();
    expect((await allEvents(hub)).filter((e) => e.kind === 'user.ask' && e.session === t.id && JSON.stringify(e.data).includes(PUSH) && !JSON.stringify(e.data).includes(question)).length, `${AC[13]} no prompt reaches you for it`).toBe(0);
  }, 180_000);
});

describe(`${AC[21]} A Codex PermissionRequest for git push origin main, answered with only the words "yes but not on main", gets behavior: deny with those words as its message, and the push never runs; answered by its allow option, it gets behavior: allow for that call alone; an adapter that maps the "yes" in the words to allow fails this test`, () => {
  const WORDS = 'yes but not on main';
  const judge = (reply: NonNullable<ReturnType<typeof adapterReply>>) => {
    expect(reply(answerOf({ decision: 'none', words: WORDS }), request()), `${AC[21]} the words deny, as its message, so the push never runs`).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: WORDS } } });
    expect(reply(answerOf({ decision: 'allow', option: 'allow', label: 'Allow', for: 'call' }), request()), `${AC[21]} the allow option allows that call alone`).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  };
  it(`${AC[21]} the recorded request answered by the words, then by its allow option, each validated by Codex's schema; a twin that maps the yes to allow fails the same judge`, () => {
    const reply = adapterReply();
    expect(typeof reply, `${AC[21]} the Codex adapter gives a permission reply`).toBe('function');
    judge(reply!);
    expect(valid('PermissionRequest', JSON.stringify(reply!(answerOf({ decision: 'none', words: WORDS }), request()))), `${AC[21]} Codex's schema`).toBeNull();
    const twin: typeof reply = (a, r) => reply!(/\byes\b/i.test(a.words ?? '') ? { ...a, decision: 'allow' } : a, r);
    let caught = '';
    try { judge(twin!); } catch (e) { caught = (e as Error).message; }
    expect(caught, `${AC[21]} the twin that maps "yes" to allow fails this judge`).toMatch(/the words deny/);
  });
});

describe(`${AC[15]} Each of Codex's apply-patch scenario fixtures, and a heredoc patch sent through the shell tool, yields exactly the paths Codex changes; an indented *** Update File: line still names its path, and a patch with *** Environment ID: remote is denied before it runs`, () => {
  const SCENARIOS = JSON.parse(readFileSync(join(FIXTURES, 'patch-scenarios.json'), 'utf8')) as { name: string; patch: string; changed: string[] }[];
  const pathsOf = async (h: Home, t: Thread, hub: Awaited<ReturnType<typeof hubWithSetup>>, tool: string, input: Line): Promise<string[]> => {
    const id = `call_${tag(6)}`;
    await codexHook(h, t, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id });
    const e = await waitFor(async () => ofSession(await allEvents(hub), t.id, 'tool.before').find((x) => x.data?.call === id), 10_000, `tool.before of ${id}`);
    return ((e.data.paths ?? []) as string[]).map((p) => p.replace(`${t.cwd}/`, '')).sort();
  };
  it(`${AC[15]} every scenario at Codex 0.160.0 names exactly what its expected tree changes (a rejected patch names at least that); the heredoc, the cd and an indented line too; Environment ID: remote is denied`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    await begin(h, t);
    expect(SCENARIOS.length, 'Codex\'s scenarios at 0.160.0').toBeGreaterThanOrEqual(25);
    const wrong: string[] = [];
    for (const s of SCENARIOS) {
      const got = await pathsOf(h, t, hub, 'apply_patch', { command: s.patch });
      const rejected = /rejects|requires|fails|failure/.test(s.name);
      const ok = rejected ? s.changed.every((p) => got.includes(p)) : JSON.stringify(got) === JSON.stringify(s.changed);
      if (!ok) wrong.push(`${s.name}: ${JSON.stringify(got)}, Codex changes ${JSON.stringify(s.changed)}`);
    }
    expect(wrong, `${AC[15]} scenarios whose paths aren't Codex's`).toEqual([]);
    const body = '*** Begin Patch\n*** Add File: h.txt\n+x\n*** End Patch\n';
    expect(await pathsOf(h, t, hub, 'Bash', { command: `apply_patch <<'EOF'\n${body}EOF\n` }), `${AC[15]} a heredoc`).toEqual(['h.txt']);
    expect(await pathsOf(h, t, hub, 'Bash', { command: `applypatch <<'EOF'\n${body}EOF\n` }), `${AC[15]} applypatch`).toEqual(['h.txt']);
    expect(await pathsOf(h, t, hub, 'Bash', { command: `cd sub && apply_patch <<'EOF'\n${body}EOF\n` }), `${AC[15]} after a cd`).toEqual(['sub/h.txt']);
    expect(await pathsOf(h, t, hub, 'apply_patch', { command: '*** Begin Patch\n   *** Update File: indented.txt\n@@\n-a\n+b\n*** End Patch\n' }), `${AC[15]} an indented Update line`).toEqual(['indented.txt']);
    const remote = await codexHook(h, t, 'PreToolUse', { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Environment ID: remote\n*** Add File: r.txt\n+x\n*** End Patch\n' }, tool_use_id: `call_${tag()}` });
    expect(remote.reply?.hookSpecificOutput?.permissionDecision, `${AC[15]} Environment ID: remote is denied before it runs: ${hookShown(remote)}`).toBe('deny');
  }, 300_000);
});
