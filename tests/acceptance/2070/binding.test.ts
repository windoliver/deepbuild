// #2070.e45923ea A bind token named only by a line the hub couldn't check binds no connection: a hello as `mcp` with
//   it binds to none, a deep_claim on it is refused as unbound, and the record holds the line as unverified.
// #2070.b951fb7f A process outside every agent's process tree that says hello as `mcp`, naming a live session's agent
//   process as its parent, binds to none.
// #2070.f489755d A token bound to one session and named again by a line for another session stays with the first.
// #2070.21673a03 The twins: a deep mcp the session's own agent started, and one paseo's plugin started with its token,
//   still bind to their sessions, and their deep_ask calls work as before.
// The merge base makes each of the three wrong bindings, so it is the wrong program of AC1 to AC3 (BASE-FAILURE.txt).
// Every process here is real and stands where the criterion puts it (README, The processes): the Claude Code agent is
// #26's stand-in, whose hooks and `deep mcp` are its children; paseo's daemon and the outsider are fixtures/proc.mjs
// processes this test starts, so the outsider is in no agent's process tree.

import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  Agent, callTool, claimArgs, claimsFor, cleanup, deep, events, filedWhileWaiting, initialize, makeHome, makeWorktree, pending, sleep, startHub,
  valueOf, word, type Hub, type Mcp,
} from '../26/helpers.ts';
import { Proc, brief, head, paseoLine, paseoSession, recorded, token, yourAskSettings, type Recorded } from './helpers.ts';

afterEach(cleanup, 30_000);

/** The sessions a deep_claim for this task was filed under, half a second after the call. */
async function filedUnder(hub: Hub, taskRef: string): Promise<string[]> {
  await sleep(500);
  return claimsFor(await events(hub), taskRef).map((e) => String(e.session));
}

test('#2070.e45923ea AC1 a bind token only an unchecked line named binds no connection: its hello binds to none, its deep_claim is refused as unbound, and the line is recorded unverified', async () => {
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'work'));
  const hub = await startHub(home);
  // paseo's daemon runs one agent, session S, established by the session's own line carrying its own token.
  const daemon = Proc.start(home, wt.path);
  const s = await paseoSession(daemon, hub, wt.path);

  // A process outside every agent's process tree sends a line of paseo's shape naming S, with a token of its own, then
  // says hello as `mcp` with that token and files a claim on the connection.
  const outsider = Proc.start(home, wt.path);
  const theirs = token();
  const sent = await outsider.line(hub, paseoLine(s, theirs));
  const line = await recorded(hub, sent.id);
  const { answer } = await outsider.hello(hub, { paseo: theirs });
  const args = claimArgs();
  const reply = await outsider.call('mcp.call', { tool: 'deep_claim', arguments: args });
  const filed = await filedUnder(hub, args.task_ref);

  const who = `the token only process ${outsider.pid}'s unchecked line ${sent.id} named, for session ${s.id}`;
  expect(answer?.role, `a hello as mcp with ${who} binds to none; it bound as ${answer?.role ?? JSON.stringify(answer)}, and its deep_claim was filed under ${filed.join(', ') || 'no session'}`).toBe('mcp');
  expect(reply.error?.code, `a deep_claim on the connection holding ${who} is refused as unbound: ${JSON.stringify(reply)}`).toBe('unbound');
  expect(filed, `no claim is filed under session ${s.id} (or any) through ${who}`).toEqual([]);
  expect(line.length, `the record holds line ${sent.id}, which names session ${s.id}`).toBeGreaterThan(0);
  expect(line.map(brief), `the record holds line ${sent.id}, which names session ${s.id}, as unverified`).toEqual(line.map((e) => brief({ ...e, verified: false })));
}, 180_000);

test('#2070.b951fb7f AC2 a process outside every agent\'s process tree that names a live session\'s agent process as its parent binds to none', async () => {
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'work'));
  const agent = Agent.start(home, wt.path);
  const s = agent.session();
  const hub = await startHub(home);
  await agent.establish(hub, s);

  // Started by this test, so its parent is this test process: it names the agent's process, by PID and start time.
  const outsider = Proc.start(home, wt.path);
  const named = { pid: agent.pid, start: agent.start() };
  const { answer } = await outsider.hello(hub, { parent: named });
  const args = claimArgs();
  const reply = await outsider.call('mcp.call', { tool: 'deep_claim', arguments: args });
  const filed = await filedUnder(hub, args.task_ref);

  const who = `process ${outsider.pid}, outside every agent's process tree, whose hello names session ${s.id}'s agent process ${agent.pid} as its parent`;
  expect(answer?.role, `${who} binds to none; it bound as ${answer?.role ?? JSON.stringify(answer)}, and its deep_claim was filed under ${filed.join(', ') || 'no session'}`).toBe('mcp');
  expect(reply.error?.code, `a deep_claim from ${who} is refused as unbound: ${JSON.stringify(reply)}`).toBe('unbound');
  expect(filed, `no claim is filed under session ${s.id} (or any) by ${who}`).toEqual([]);
}, 180_000);

test('#2070.f489755d AC3 a token bound to one session and named again by a line for another session stays with the first', async () => {
  const { tmp, home } = makeHome();
  const one = makeWorktree(join(tmp, 'one'));
  const two = makeWorktree(join(tmp, 'two'));
  const hub = await startHub(home);
  // One paseo daemon runs two agents: sessions A and B, each established by its own line carrying its own token.
  const daemon = Proc.start(home, one.path);
  const a = await paseoSession(daemon, hub, one.path);
  const b = await paseoSession(daemon, hub, two.path);

  // A later line for B names A's token.
  const before = await head(hub);
  const sent = await daemon.line(hub, paseoLine(b, a.bind));
  const line = await recorded(hub, sent.id);
  // The MCP server paseo's plugin started for A's agent, with A's token, files a claim.
  const server = daemon.server(a.bind, one.path);
  await initialize(server);
  const args = claimArgs();
  const out = await callTool(server, 'deep_claim', args);
  const filed = await filedUnder(hub, args.task_ref);
  const naming = ((await events(hub)) as Recorded[]).filter((e) => e.log_pos > before && JSON.stringify(e).includes(a.id) && JSON.stringify(e).includes(b.id));

  const both = `session ${a.id}'s token, named again by line ${sent.id} for session ${b.id}`;
  expect(filed, `${both}, stays with ${a.id}: the deep_claim through the server holding it was filed under ${filed.join(', ') || 'no session'} (${JSON.stringify(out.value)})`).toEqual([a.id]);
  expect(line.length, `the record holds line ${sent.id} for session ${b.id}, which names session ${a.id}'s token`).toBeGreaterThan(0);
  expect(line.map(brief), `the record holds line ${sent.id} for session ${b.id}, naming session ${a.id}'s token, as unverified`).toEqual(line.map((e) => brief({ ...e, verified: false })));
  expect(naming.map(brief), `the record names both sessions, ${a.id} and ${b.id}, for line ${sent.id}`).not.toEqual([]);
}, 180_000);

const OPTIONS = [{ id: 'blue', label: 'Blue header' }, { id: 'green', label: 'Green header' }];
/**
 * A deep_ask through `server` is filed under `session` while it waits, and returns the answer you give with deep inbox
 * answer. It recommends nothing, so it waits for you (one with a recommendation goes on with it at once, provisionally).
 */
async function asks(hub: Hub, home: string, server: Mcp, session: string, who: string): Promise<void> {
  const question = `Which header colour for ${word()}?`;
  const asked = pending(callTool(server, 'deep_ask', { kind: 'taste', question, options: OPTIONS, recommended: null }));
  const created = await filedWhileWaiting(asked, hub, (e) => e.kind === 'ask.created' && e.data?.question === question, `${who}'s deep_ask`);
  expect(created.session, `${who} binds to its own session ${session}: its deep_ask is filed there`).toBe(session);
  const handle = `ask:${created.id}`;
  await sleep(1000);
  const answered = await deep(home, ['inbox', 'answer', handle, 'green']);
  expect(answered.code, `you answer ${handle} with green in your terminal: ${answered.stdout}${answered.stderr}`).toBe(0);
  const out = await asked;
  if (!out.returned) throw Error(`${who}'s deep_ask failed: ${out.failed}`);
  const value = valueOf(out.returned, `${who}'s deep_ask, answered while it waits`);
  expect({ ask: value?.ask, status: value?.status, answer: value?.answer }, `${who}'s deep_ask returns your answer: ${JSON.stringify(value)}`).toEqual({ ask: handle, status: 'answered', answer: 'green' });
}

test('#2070.21673a03 AC4 the twins: a deep mcp the session\'s own agent started, and one paseo\'s plugin started with its token, bind to their sessions and their deep_ask works', async () => {
  const { tmp, home } = makeHome();
  const claude = makeWorktree(join(tmp, 'claude'));
  const paseo = makeWorktree(join(tmp, 'paseo'));
  const agent = Agent.start(home, claude.path);
  const s = agent.session();
  yourAskSettings(home);
  const hub = await startHub(home);
  await agent.establish(hub, s);
  const daemon = Proc.start(home, paseo.path);
  const p = await paseoSession(daemon, hub, paseo.path);

  // The deep mcp the Claude Code session's own agent started: the agent process's child.
  await initialize(agent);
  await asks(hub, home, agent, s.id, `the deep mcp session ${s.id}'s own agent (pid ${agent.pid}) started`);
  // The deep mcp paseo's plugin started for its agent with the session's token: its parent is the agent's CLI.
  const server = daemon.server(p.bind, paseo.path);
  await initialize(server);
  await asks(hub, home, server, p.id, `the deep mcp paseo's plugin started with paseo session ${p.id}'s token`);
}, 240_000);
