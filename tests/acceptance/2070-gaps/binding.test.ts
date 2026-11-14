// #2070's Scope, past its criteria: "After the change, a process outside a session's own agent process tree can't act as
// that session over deep mcp", on the per-call route a shared agent process's calls take ("the connection binds per
// call, by the PreToolUse stamped for it"). One agent process runs two sessions, so no hello binds to either and each
// call binds by its stamp. A process this test starts names that agent's process as its parent, by PID and start time,
// and sends exactly the arguments the agent's hook just stamped for session A. The merge base takes the parent from the
// hello, so the call spends A's stamp and files a claim under A; this test fails there, naming A.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { Agent, callTool, claimArgs, claimsFor, cleanup, events, initialize, makeHome, makeWorktree, sleep, startHub, type Line } from '../26/helpers.ts';
import { Proc, paseoSession } from '../2070/helpers.ts';

afterEach(cleanup, 30_000);

test('#2070 gap: a process outside a shared agent\'s tree that names it as its parent can\'t spend a PreToolUse stamped for that agent\'s call', async () => {
  const { tmp, home } = makeHome();
  const wa = makeWorktree(join(tmp, 'a'));
  const wb = makeWorktree(join(tmp, 'b'));
  const agent = Agent.start(home, wa.path);
  const a = agent.session(wa.path);
  const b = agent.session(wb.path);
  const hub = await startHub(home);
  await agent.establish(hub, a);
  await agent.establish(hub, b);

  // The twin: the agent's own deep mcp, its child, spends the stamp cut for its own call.
  await initialize(agent);
  const own = claimArgs();
  await agent.stamp(hub, a, 'deep_claim', own);
  await callTool(agent, 'deep_claim', own);

  // The outsider names the agent's process as its parent and sends the arguments A's next stamp was cut for.
  const outsider = Proc.start(home, wa.path);
  const { answer } = await outsider.hello(hub, { parent: { pid: agent.pid, start: agent.start() } });
  const theirs = claimArgs();
  await agent.stamp(hub, a, 'deep_claim', theirs);
  const reply = await outsider.call('mcp.call', { tool: 'deep_claim', arguments: theirs });
  await sleep(500);
  const all = await events(hub);
  const filed = (args: Line) => claimsFor(all, args.task_ref).map((e) => String(e.session));

  expect(filed(own), `the twin: session ${a.id}'s own deep mcp spends the stamp cut for its call, and its claim is filed under ${a.id}`).toEqual([a.id]);
  const who = `process ${outsider.pid}, outside agent process ${agent.pid}'s tree, whose hello names it as its parent`;
  expect(answer?.role, `${who} binds to none at hello: ${JSON.stringify(answer)}`).toBe('mcp');
  expect(filed(theirs), `${who} can't spend session ${a.id}'s stamp: its deep_claim was filed under ${filed(theirs).join(', ') || 'no session'}`).toEqual([]);
  expect(reply.error?.code, `${who}'s deep_claim is refused as unbound: ${JSON.stringify(reply)}`).toBe('unbound');
}, 180_000);

// The pi package runs inside pi: its lines carry pi's own process as their parent, and it says hello from that same
// process. The process at the socket's other end is then the session's agent process itself, not a child of it, and it
// still binds to its session. A hub that only takes the peer's parent binds it to none and fails this test, naming it.
test('#2070 gap: a session\'s agent process saying hello as mcp itself, as the pi package does inside pi, binds to its own session', async () => {
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'work'));
  const hub = await startHub(home);
  const agent = Proc.start(home, wt.path);
  const s = await paseoSession(agent, hub, wt.path);
  const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(agent.pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
  const { answer } = await agent.hello(hub, { parent: { pid: agent.pid, start } });
  const args = claimArgs();
  const reply = await agent.call('mcp.call', { tool: 'deep_claim', arguments: args });
  await sleep(500);
  const filed = claimsFor(await events(hub), args.task_ref).map((e) => String(e.session));

  const who = `agent process ${agent.pid}, whose own line established session ${s.id}, saying hello from itself`;
  expect(answer?.role, `${who} binds to ${s.id}: ${JSON.stringify(answer)}`).toBe(`mcp:${s.id}`);
  expect(filed, `${who} files its deep_claim under ${s.id}: ${JSON.stringify(reply)}`).toEqual([s.id]);
}, 180_000);
