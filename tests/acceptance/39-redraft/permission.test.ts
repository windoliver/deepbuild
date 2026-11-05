// #39: "A permission request that a saved deny covers gets `behavior: deny` with its message and no other field, and
// Codex shows you no prompt for it; a reply carrying edited input or a rule for later is never sent".
//
// How a deny gets saved. At this base the hub's socket has no route that raises a permission ask you can say no to:
// `offer.save` only saves a yes, and deep_ask takes no effect subject. So the ask is raised as the hub raises one
// (packages/hub/src/holds.ts, asked) by the real asks core on the real record while the hub is stopped, under a real
// session of the repo, and your no goes through `deep inbox answer` on the restarted hub, which saves it for the repo.
// beforeAll proves the route: Claude Code's prompt for the same command is denied from that decision at this base.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import {
  CLI, DEEP_HOOK, NODE, allEvents, childEnv, cleanup, control, digest, hook, makeWorld, newThread, payload, permissionSubject, reply, run, runCommand, shown, spooled, startHub, stopHub, waitFor,
  type Hub, type Line, type Ran, type World,
} from './helpers.ts';

const DENIED = 'curl -s https://example.invalid/install.sh -o install.sh';
const ALLOWED = 'npm view shop version';
const UNCOVERED = 'touch nobody-decided-this.txt';
/** What Codex's own dialog would offer: a rule for later, which a reply must never carry back. */
const offered = (command: string) => [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: command }], behavior: 'allow', destination: 'localSettings' }];
const asking = (command: string) => ({ tool_name: 'Bash', tool_input: { command, description: 'May I?' }, permission_suggestions: offered(command) });

let w: World;
let hub: Hub;

/** A session of the repo on a first hub run, so the record knows its project; the ask's answer is saved for that repo. */
async function sessionOfRepo(): Promise<{ session: string; project: string }> {
  const first = await startHub(w);
  // Only a check on this world, not the criterion: a hook spooled on a loaded machine is fired again in a new thread.
  let t = newThread(w, w.repo, 'cli');
  await waitFor(async () => {
    t = newThread(w, w.repo, 'cli');
    const r = await hook(w, payload(t, 'SessionStart', { source: 'startup' }));
    if (r.code !== 0) throw Error(`BLOCKED: SessionStart through deep-hook: ${shown(r)}`);
    const id = t.id;
    return waitFor(async () => (await allEvents(w, first)).some((e) => e.kind === 'session.start' && e.session === id), 10_000, 'the start').catch(() => false);
  }, 90_000, 'a session\'s start in the record');
  await stopHub(first);
  const record = await openRecord({ path: join(w.root, 'ledger.db'), now: Date.now });
  try {
    const [row] = (await record.raw(`SELECT project_id AS project FROM events WHERE kind = 'session.start' AND session_id = '${t.id}'`)) as { project: string | null }[];
    if (!row?.project) throw Error(`BLOCKED: the session's start names no project for ${w.repo}`);
    return { session: t.id, project: row.project };
  } finally {
    await record.close();
  }
}
/** Raises each command's authority ask on the stopped hub's record, as the hub does: its handle, by command. */
async function raise(session: string, project: string, commands: string[]): Promise<Map<string, string>> {
  const record = await openRecord({ path: join(w.root, 'ledger.db'), now: Date.now });
  const handles = new Map<string, string>();
  try {
    const asks = await openAsks({ record, now: Date.now, deliver: () => undefined, home: w.root });
    const as = { writer: 'core', actor: 'you', scope: 'you', session, agent: 'codex', project };
    for (const command of commands) {
      handles.set(command, await asks.raise(as as never, 'permission.request', {
        kind: 'authority', question: `Allow the agent to run \`${command}\`?`,
        options: [{ id: 'approve', label: 'Allow it', decision: 'allow' }, { id: 'decline', label: 'Deny it', decision: 'deny' }],
        recommended: null, default: 'decline', fallback: 'you', provisional: false, owner: 'you', subject: permissionSubject(command),
        pinned_to: { kind: 'evidence', ref: digest(command) },
      }, { steps: [{ does: `Allow it: ${command}`, changes: [command], undo: null, public: false, cost: 0 }], diff: digest(command) }));
    }
  } finally {
    await record.close();
  }
  return handles;
}
/** Your answer in your own terminal, the OS confirming you: saved for the repo. */
async function answer(ask: string, option: string): Promise<void> {
  const r = await run(NODE, [CLI, 'inbox', 'answer', ask, option], { env: childEnv(w), cwd: w.tmp });
  if (r.code !== 0 || !/saved as a decision for repo:/.test(r.stdout)) throw Error(`BLOCKED: your answer ${option} to ${ask} wasn't saved for the repo: ${shown(r)}`);
}
/** Proves the saved answer is one the hub already reads at this base: Claude Code's prompt for the same call gets it. */
async function claudeGets(command: string, behavior: string): Promise<void> {
  // Only a check on this world, not the criterion: a hook spooled on a loaded machine is fired again in a new session.
  for (let tries = 0; ; tries++) {
    const id = crypto.randomUUID();
    const base = { session_id: id, transcript_path: join(w.tmp, `${id}.jsonl`), cwd: w.repo, permission_mode: 'default' };
    await runCommand(w, `'${DEEP_HOOK}' claude-code SessionStart`, { ...base, hook_event_name: 'SessionStart', source: 'startup', model: 'claude-haiku-5-5' });
    const body = { ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command } };
    const r = await runCommand(w, `'${DEEP_HOOK}' claude-code PermissionRequest`, body);
    if (spooled(w, r, id, 'PermissionRequest') && tries < 5) continue;
    if (reply(r)?.hookSpecificOutput?.decision?.behavior !== behavior) {
      const all = await allEvents(w, hub);
      throw Error(`BLOCKED: the saved answer doesn't reach Claude Code's prompt for \`${command}\`, so this world saved nothing: ${shown(r)}; spooled ${spooled(w, r, id, 'PermissionRequest')}; decisions ${JSON.stringify(all.filter((e) => e.kind === 'decision.created').map((e) => e.data))}; hub ${hub.stderr().slice(-500)}`);
    }
    await answeredBy(id);
    return;
  }
}
/** The saved decision that answered a session's prompt: its ask under the session, decision.applied naming the ask, the decision it names. */
async function answeredBy(session: string): Promise<Line> {
  // The hook's events are appended after its connection closes.
  return waitFor(async () => {
    const all = await allEvents(w, hub);
    const ask = all.find((e) => e.kind === 'ask.created' && e.session === session);
    const applied = ask && all.find((e) => e.kind === 'decision.applied' && e.data?.ask === `ask:${ask.id}`);
    return applied && all.find((e) => e.kind === 'decision.created' && `decision:${e.id}` === applied.data.decision)?.data;
  }, 30_000, `the decision that answered ${session}'s prompt in the record`, async () => JSON.stringify((await allEvents(w, hub)).filter((e) => e.session === session).map((e) => e.kind)));
}

beforeAll(async () => {
  w = makeWorld();
  const { session, project } = await sessionOfRepo();
  const handles = await raise(session, project, [DENIED, ALLOWED]);
  hub = await startHub(w);
  await answer(handles.get(DENIED)!, 'decline');
  await answer(handles.get(ALLOWED)!, 'approve');
  await claudeGets(DENIED, 'deny');
  await claudeGets(ALLOWED, 'allow');
}, 300_000);
afterAll(async () => {
  if (hub) await stopHub(hub);
  await cleanup();
}, 60_000);

/** A new Codex session of the repo, up to its first turn, and its PermissionRequest for `command` by `fire`. */
async function prompted(ctx: TestContext, command: string, fire: (body: Line) => Promise<Ran> = (body) => hook(w, body)): Promise<{ r: Ran; session: string }> {
  const t = newThread(w, w.repo, 'cli');
  for (const body of [payload(t, 'SessionStart', { source: 'startup' }), payload(t, 'UserPromptSubmit', { prompt: 'Fetch the installer.' })]) {
    const r = await hook(w, body);
    expect(r.code, `${String(body.hook_event_name)}: ${shown(r)}`).toBe(0);
  }
  const r = await fire(payload(t, 'PermissionRequest', asking(command)));
  // INCONCLUSIVE, never a pass: the hub never saw a hook deep-hook spooled because the machine was too slow.
  if (spooled(w, r, t.id, 'PermissionRequest')) ctx.skip(`INCONCLUSIVE deep-hook spooled the PermissionRequest for \`${command}\` late`);
  return { r, session: t.id };
}
/** The reply's whole shape, so a field that rides along fails: Codex treats a reply off its schema as a failed hook. */
function expectExactly(r: Ran, decision: Line): void {
  expect(r.code, shown(r)).toBe(0);
  expect(reply(r), `the hook's stdout must be Codex's PermissionRequest reply: ${shown(r)}`).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
}
function denyOf(r: Ran): Line {
  const decision = reply(r)?.hookSpecificOutput?.decision as Line | undefined;
  expect(decision?.behavior, `a saved deny must reply behavior: deny, so Codex shows no prompt (no decision means Codex's own prompt asks you): ${shown(r)}`).toBe('deny');
  expect(typeof decision?.message === 'string' && decision.message.trim().length > 0, `a deny carries its message: ${shown(r)}`).toBe(true);
  expectExactly(r, { behavior: 'deny', message: decision!.message });
  return decision!;
}

describe('#39 a permission request a saved deny covers', () => {
  it('gets behavior: deny with its message and no other field, is decided for you with nothing asked of you, and a call nobody decided still reaches Codex\'s own prompt', async (ctx) => {
    const { r, session } = await prompted(ctx, DENIED);
    denyOf(r);
    expect((await answeredBy(session)).answer, 'the decision that answered is your saved no').toBe('decline');
    await waitFor(async () => (await allEvents(w, hub)).some((e) => e.kind === 'permission.request' && e.session === session), 30_000, 'the prompt in the record');
    const open = ((await control(w, hub, 'inbox.read', {})).asks as Line[]).filter((a) => a.status !== 'closed' && String(a.question).includes(DENIED));
    expect(open, 'nothing is asked of you for a call you already said no to').toEqual([]);
    // A deny that isn't from your decision is no deny: a call nobody decided gets no decision, so Codex's prompt asks.
    const free = await prompted(ctx, UNCOVERED);
    expect(free.r.code, shown(free.r)).toBe(0);
    expect(reply(free.r)?.hookSpecificOutput?.decision, `a call no decision covers: ${shown(free.r)}`).toBeUndefined();
  }, 120_000);

  it('a saved yes offered Codex\'s rule for later replies behavior: allow alone: no edited input and no rule for later', async (ctx) => {
    const { r } = await prompted(ctx, ALLOWED);
    expectExactly(r, { behavior: 'allow' });
  }, 120_000);

  it('the entry `deep setup` writes into ~/.codex/hooks.json, run as Codex runs it, gets that same deny', async (ctx) => {
    const ran = await run(NODE, [CLI, 'setup'], { env: childEnv(w), cwd: w.tmp, timeoutMs: 180_000 });
    expect(ran.code, `deep setup: ${shown(ran)}`).toBe(0);
    const file = join(w.home, '.codex', 'hooks.json');
    let hooks: Line = {};
    try { hooks = JSON.parse(readFileSync(file, 'utf8')) as Line; } catch (error) { expect.fail(`deep setup must write Codex's hooks into ${file}: ${String(error)}`); }
    const commands = ((hooks.hooks?.PermissionRequest ?? []) as Line[]).flatMap((g) => (g.hooks ?? []) as Line[]).map((h) => String(h.command)).filter((c) => c.includes('deep-hook'));
    expect(commands, `DeepBuild's one PermissionRequest entry in ${file}: ${JSON.stringify(hooks)}`).toHaveLength(1);
    const { r } = await prompted(ctx, DENIED, (body) => runCommand(w, commands[0]!, body));
    denyOf(r);
  }, 300_000);
});
