// #2074: only the issue-permitted checkout service is planted. The core, gate, record, stop reply and MCP are real.
// Entry: actual createCore build (it starts sibling worker files); rebuild packages after an implementation change.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import type { Core } from '../../../packages/hub/src/core.ts';
import type { Checkouts } from '@deepbuild/gate';

const temp = mkdtempSync(join(tmpdir(), 'deep-2074-'));
const saved = { ...process.env };
for (const k of Object.keys(process.env)) if (/^(DEEP_|GH_|GITHUB_|CLAUDE_|CODEX_)/.test(k)) delete process.env[k];
process.env.HOME = temp;
// Keep the inherited toolchains, but no personal agent executables or config homes.
process.env.PATH = saved.PATH!.split(':').filter((p) => !p.startsWith('/Users/') && !p.startsWith('/home/')).join(':');
process.env.CLAUDE_CONFIG_DIR = join(temp, '.claude');
process.env.CODEX_HOME = join(temp, '.codex');
process.env.GH_CONFIG_DIR = join(temp, '.gh');
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.XDG_CONFIG_HOME = join(temp, '.config');
const { createCore } = await import(new URL('../../../packages/hub/dist/hub-runtime.js', import.meta.url).href) as typeof import('../../../packages/hub/src/hub-runtime.ts');
const { OverBudget } = await import('@deepbuild/gate');
const { ulid } = await import('@deepbuild/record');
const { readFacts } = await import('@deepbuild/adapters');
const version = readFacts<{ versions: string[] }>('claude-code.facts.json').versions.at(-1)!;
const cores: Core[] = [];
afterAll(async () => {
  await sleep(200);
  for (const c of cores) await c.stop('test');
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  rmSync(temp, { recursive: true, force: true });
}, 60_000);
type Ev = { id: string; kind: string; session?: string; data: Record<string, unknown> };
type Status = { claims: { claim: string; verdict: { outcome: string } | null }[] };
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function fixture(mode: 'snapshot' | 'checkout' | 'budget') {
  const id = randomUUID();
  const repo = join(temp, id, 'repo');
  const root = join(temp, id, 'deepbuild');
  mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  writeFileSync(join(repo, 'f'), 'before\n');
  writeFileSync(join(repo, '.deepbuild/done.yaml'), 'checks:\n  unit:\n    type: command\n    run: node --test unit.test.js\n');
  writeFileSync(join(repo, 'unit.test.js'), "require('node:test')('fixture', () => require('node:assert/strict').equal(1, 1));\n");
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base');
  if (mode === 'budget') for (let n = 0; n < 37; n++) writeFileSync(join(repo, `untracked-${n}`), 'fixture\n');
  writeFileSync(join(temp, '.claude.json'), JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }));
  const transcript = join(temp, '.claude/projects', id, `${id}.jsonl`);
  mkdirSync(join(temp, '.claude/projects', id), { recursive: true });
  writeFileSync(transcript, '');
  const core = createCore({ root, clock: { start: Date.now(), real: Date.now() }, held: [] }, () => {});
  cores.push(core);
  await core.started();
  // Only the checkout service is planted; all its other operations delegate to the real service.
  const slot = core as unknown as { checkouts: Checkouts };
  const real = slot.checkouts;
  let hits = 0;
  slot.checkouts = { ...real,
    snapshot: async (...args) => {
      if (mode !== 'checkout') { hits++; throw mode === 'budget' ? new OverBudget(`snapshot over budget: ${git('ls-files', '--others', '--exclude-standard').split('\n').length} untracked files`) : Error("can't read the index"); }
      return real.snapshot(...args);
    },
    checkout: async (...args) => { if (mode === 'checkout') { hits++; throw Error("can't copy node_modules into the checkout"); } return real.checkout(...args); },
  };
  const events = async (): Promise<Ev[]> => {
    const page = await core.call('events.read', { after: 0, limit: 1000 }, { role: 'cli' }) as { events: string };
    return JSON.parse(page.events);
  };
  const wait = async (condition: (events: Ev[]) => boolean) => {
    let all: Ev[] = [];
    for (const end = Date.now() + 15_000; Date.now() < end; await sleep(25)) { all = await events(); if (condition(all)) break; }
    return all;
  };
  let prompt: string | undefined;
  const entry = (value: object) => appendFileSync(transcript, `${JSON.stringify({ uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: id, cwd: repo, version, isSidechain: false, ...value })}\n`);
  const hook = async (event: string, kind: string, data: Record<string, unknown>, fields: Record<string, string> = {}, extra: object = {}) => {
    const ts = Date.now(); const eventId = ulid(ts);
    const meta = { id: eventId, seq: String(BigInt(ts) * 1_000_000n), agent: 'claude-code', event, session: id, cwd: repo, transcript, pid: process.pid, ppid: process.pid, matched: [], version, fields: { ...(prompt ? { prompt_id: prompt } : {}), ...fields }, ...extra };
    // The parser-to-core hook seam named by core.ts: input drafts only, no claim/verdict/state injected.
    const v = kind === 'session.start' ? 3 : kind === 'agent.stop' ? 5 : kind === 'tool.after' ? 2 : 1;
    const fill = kind === 'session.start' ? 'loads' as const : kind === 'user.ask' ? 'msg' as const : kind === 'agent.stop' ? 'turn' as const : undefined;
    await core.hook([{ kind, v, id: eventId, ts, seq: meta.seq, ...(kind === 'agent.stop' ? { subject: `session:${id.replaceAll('-', '')}` } : {}), data, ...(fill ? { fill } : {}) }], meta, 'hook');
    return meta;
  };
  await hook('SessionStart', 'session.start', { agent: 'claude-code', worktree: repo, branch: null, thread: id, loads: [] }, { source: 'startup' });
  prompt = randomUUID();
  const ask = 'Change the fixture file to say after.';
  entry({ type: 'user', promptId: prompt, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', message: { role: 'user', content: ask } });
  await hook('UserPromptSubmit', 'user.ask', { msg: 0, text: ask, tasks: [], from: 'person' }, { prompt: ask });
  const file = join(repo, 'f'); writeFileSync(file, 'after\n');
  await hook('PostToolUse', 'tool.after', { kind: 'write', paths: [file], command: null, outcome: 'ok' }, {}, { call: { mode: 'default', tool: 'Write', input: { file_path: file, content: 'after\n' }, suggestions: [] } });
  const stop = async () => {
    const words = 'Updated the fixture file.';
    entry({ type: 'assistant', promptId: prompt, message: { role: 'assistant', content: [{ type: 'text', text: words }], stop_reason: 'end_turn' } });
    const meta = await hook('Stop', 'agent.stop', { turn: 0, did_work: false, claim: false, outcome: 'finished', cause: 'unknown', usage: null }, { last_assistant_message: words });
    return core.hookReply(meta, Date.now() + 10_000);
  };
  const monitor = async (end = false) => {
    const ts = Date.now();
    const payload = { session_id: id, cwd: repo, transcript_path: transcript, hook_event_name: 'PostToolUse', prompt_id: prompt,
      tool_use_id: randomUUID(), tool_name: end ? 'TaskStop' : 'Monitor',
      tool_input: end ? { task_id: 'watch2074' } : { command: 'tail -F fixture.log', description: 'fixture log', timeout_ms: 1_800_000 },
      tool_response: end ? { task_id: 'watch2074' } : { taskId: 'watch2074', timeoutMs: 1_800_000, persistent: false } };
    mkdirSync(join(root, 'spool'), { recursive: true });
    appendFileSync(join(root, 'spool/spool.jsonl'), `${JSON.stringify({ v: 1, agent: 'claude-code', event: 'PostToolUse', seq: String(BigInt(ts) * 1_000_000n), id: ulid(ts), pid: process.pid, ppid: process.pid, matched: [], payload })}\n`);
    // A subsequent hook makes the core consume the spool first, through its real parser/adapter.
    await core.hook([], { id: ulid(Date.now()), agent: 'claude-code', event: 'Notification', session: id, cwd: repo, transcript, pid: process.pid, ppid: process.pid, matched: [] }, 'hook');
  };
  const status = () => core.call('mcp.call', { tool: 'deep_status', arguments: {} }, { role: 'mcp', session: id }) as Promise<Status>;
  return { id, events, wait, stop, monitor, status, hits: () => hits };
}
async function observed(h: Awaited<ReturnType<typeof fixture>>) {
  const all = await h.wait((all) => all.some((e) => e.kind === 'verdict.made'));
  const made = all.filter((e) => e.kind === 'claim.made' && e.session === h.id);
  expect(made, `session ${h.id}: the real stop rule made exactly one claim`).toHaveLength(1);
  const claim = `claim:${made[0]!.id}`;
  expect(h.hits(), `${claim}: the claim reached the planted checkout service`).toBe(1);
  return { all, claim, task: made[0]!.data.task_ref, verdict: all.findLast((e) => e.kind === 'verdict.made' && e.data.claim === claim)?.data };
}
function blocked(o: Awaited<ReturnType<typeof observed>>, cause: string) {
  expect.soft(o.verdict?.outcome, `${o.claim}: a lane that could not start is BLOCKED, not a budget overrun`).toBe('BLOCKED');
  expect.soft(JSON.stringify(o.verdict?.reasons), `${o.claim}: the verdict names the original cause`).toContain(cause);
  expect.soft(JSON.stringify({ reasons: o.verdict?.reasons, why: o.verdict?.why, owner: o.verdict?.owner }), `${o.claim}: the verdict names you as owner of the missing prerequisite`).toMatch(/\byou\b/);
}
it('AC1 #2074.f6cc7fe2 snapshot failure: recorded BLOCKED, actual stop chat reply and deep_status; actionable open item', async () => {
  const h = await fixture('snapshot');
  const reply = await h.stop(); // Keep the actual reply; never synthesize it from a verdict formatter.
  const o = await observed(h);
  blocked(o, "can't read the index");
  expect.soft([reply.message, reply.block, reply.context].filter(Boolean).join('\n'), `${o.claim}: the judged stop's chat line reads BLOCKED`).toMatch(/\bBLOCKED\b/);
  const status = await h.status();
  expect.soft(status.claims.find((c) => c.claim === o.claim)?.verdict?.outcome, `${o.claim}: deep_status exposes BLOCKED from the record`).toBe('BLOCKED');
  const items = o.all.filter((e) => e.kind === 'open_item.opened' && e.data.task_ref === o.task && JSON.stringify(e.data).includes("can't read the index"));
  expect.soft(items.length, `${o.claim}: its cause has a recorded open item on its task`).toBeGreaterThan(0);
  const text = items.map((e) => String(e.data.text)).join('\n').replaceAll("can't read the index", '');
  // Semantic actions, not an invented exact sentence. An error repeated alone is not a closure requirement.
  expect.soft(text, `${o.claim}: the open item names the action/evidence that would close it, beyond repeating the error`).toMatch(/\b(?:rerun|re-run|retry|run again|unblock|restore|resolve|repair|fix|clear|remove|provide|succeed|successful|needs?|requires?|waits? for)\b/i);
}, 60_000);
it('AC2 #2074.5acbc1c9 monitor watch ends after the stop has replied: the deferred claim is BLOCKED', async () => {
  const h = await fixture('snapshot');
  await h.monitor();
  await h.stop();
  expect((await h.events()).filter((e) => e.kind === 'claim.made'), 'watch still running: no claim yet').toEqual([]);
  expect(h.hits(), 'watch still running: no snapshot yet').toBe(0);
  await h.monitor(true); // Real TaskStop spool event; no second Stop and no held hookReply.
  const o = await observed(h);
  expect(o.all.filter((e) => e.kind === 'agent.stop'), `${o.claim}: no later stop caused this verdict`).toHaveLength(1);
  blocked(o, "can't read the index");
}, 60_000);
it('scope: checkout copy failure after a real snapshot records BLOCKED with cause and owner', async () => {
  const h = await fixture('checkout');
  await h.stop();
  blocked(await observed(h), "can't copy node_modules into the checkout");
}, 60_000);
it('AC3 #2074.f387c8cd regression twin: OverBudget remains INCONCLUSIVE with 37 untracked files', async () => {
  const h = await fixture('budget');
  const reply = await h.stop();
  const o = await observed(h);
  expect(o.verdict?.outcome, `${o.claim}: OverBudget remains INCONCLUSIVE`).toBe('INCONCLUSIVE');
  expect(JSON.stringify(o.verdict?.reasons), `${o.claim}: the budget reason retains its untracked-file count`).toContain('37 untracked files');
  expect(reply.message, `${o.claim}: the actual stop reply remains INCONCLUSIVE`).toMatch(/\bINCONCLUSIVE\b/);
}, 60_000);
