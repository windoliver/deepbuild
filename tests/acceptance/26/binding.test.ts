// #26.1ca7aee5 Two sessions' `deep mcp` processes each file a `deep_ask` under their own session, and a process
//   started by hand with no matching parent can search but its `deep_claim` is refused.
// #26.11e88ca6 After SessionEnd, a call from the old process is refused, and a new session in the same worktree
//   gets a new binding.
// #26.bf6dc81a On one shared daemon, an agent in session A runs `deep-hook` by hand to stamp a PreToolUse event for
//   session B with the tool name and argument digest of A's next `deep_claim`; that call matches two unspent
//   events, binds to none, and its claim is refused, and no stamped event ever binds two calls; a hub that binds a
//   call to the first event it matches files the claim under B and fails this test, naming both sessions.
// The agents are fixtures/agent.mjs processes: their hooks and their deep mcp are their children, so the hub binds
// by a true process tree. "By hand" is a deep mcp this test process starts itself.

import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  Agent, agentWorld, callTool, claimArgs, claimsFor, cleanup, errorOf, eventMatching, events, filedWhileWaiting, initialize, makeHome, makeWorktree,
  McpProcess, pending, sleep, startHub, valueOf, word, type Line,
} from './helpers.ts';

afterEach(cleanup, 30_000);

const taste = (question: string) => ({ kind: 'taste', question, options: [{ id: 'blue', label: 'Blue' }, { id: 'green', label: 'Green' }], recommended: 'blue' });

test('#26.1ca7aee5 two sessions\' deep mcp each file a deep_ask under their own session; one started by hand searches, and its deep_claim is refused', async () => {
  const { tmp, home } = makeHome();
  const one = makeWorktree(join(tmp, 'one'));
  const two = makeWorktree(join(tmp, 'two'));
  const a = Agent.start(home, one.path);
  const b = Agent.start(home, two.path);
  const sa = a.session();
  const sb = b.session();
  const hub = await startHub(home);
  await a.establish(hub, sa);
  await b.establish(hub, sb);
  await initialize(a);
  await initialize(b);
  const tag = word();
  // Each deep_ask waits for an answer; what's checked is where each ask was filed.
  for (const [agent, s, question] of [[a, sa, `A's header for ${tag}?`], [b, sb, `B's header for ${tag}?`]] as const) {
    const filed = await filedWhileWaiting(pending(callTool(agent, 'deep_ask', taste(question))), hub, (e) => e.kind === 'ask.created' && e.data?.question === question, `deep_ask "${question}"`);
    expect(filed.session, `"${question}" is filed under its own agent's session ${s.id}`).toBe(s.id);
  }

  // By hand: a deep mcp whose parent is this test process, which no session's hooks came from.
  const hand = McpProcess.start(home, one.path);
  await initialize(hand);
  valueOf(await callTool(hand, 'deep_search', { query: `header ${tag}` }), 'deep_search from a deep mcp started by hand');
  const args = claimArgs();
  errorOf(await callTool(hand, 'deep_claim', args), 'deep_claim from a deep mcp started by hand, with no matching parent');
  await sleep(500);
  expect(claimsFor(await events(hub), args.task_ref).map((e) => `claim.made ${e.id} under ${e.session}`), 'the hand-started process\'s claim is filed under no session').toEqual([]);
}, 120_000);

test('#26.11e88ca6 after SessionEnd the old process\'s calls are refused, and a new session in the same worktree gets its own binding', async () => {
  const { hub, agent: old, session: s1, wt, home } = await agentWorld();
  const before = claimArgs();
  valueOf(await callTool(old, 'deep_claim', before), 'deep_claim while the session runs');
  const bound = await eventMatching(hub, (e) => e.kind === 'claim.made' && e.data?.task_ref === before.task_ref);
  expect(bound?.session, 'before SessionEnd the deep mcp acts for its session').toBe(s1.id);

  await old.end(hub, s1);
  const afterEnd = claimArgs();
  errorOf(await callTool(old, 'deep_claim', afterEnd), `deep_claim from session ${s1.id}'s deep mcp after its SessionEnd`);

  // A new session in the same worktree: a new agent process there, its hooks, its own deep mcp.
  const next = Agent.start(home, wt.path);
  const s2 = next.session();
  await next.establish(hub, s2);
  await initialize(next);
  const fresh = claimArgs();
  valueOf(await callTool(next, 'deep_claim', fresh), 'deep_claim from the new session\'s deep mcp');
  const rebound = await eventMatching(hub, (e) => e.kind === 'claim.made' && e.data?.task_ref === fresh.task_ref);
  expect(rebound?.session, `the new session ${s2.id} in the same worktree gets a binding of its own`).toBe(s2.id);

  // The successor never inherits the old process's binding.
  const late = claimArgs();
  errorOf(await callTool(old, 'deep_claim', late), `deep_claim from the ended session ${s1.id}'s deep mcp, once ${s2.id} runs in its worktree`);
  await sleep(500);
  const all = await events(hub);
  for (const args of [afterEnd, late]) {
    expect(claimsFor(all, args.task_ref).map((e) => `claim.made ${e.id} under ${e.session}`), `no claim from the old process after SessionEnd (${s1.id} ended; ${s2.id} is new)`).toEqual([]);
  }
}, 120_000);

interface Daemon { a: string; b: string; ambiguous: { refused: boolean; filed: string[] }; twice: string[]; single: string[] }
/** One daemon process D serving sessions A and B: both sessions' hooks are D's children, and so is the one deep mcp. */
async function sharedDaemon(plant?: string): Promise<Daemon> {
  const { tmp, home } = makeHome();
  const wa = makeWorktree(join(tmp, 'a'));
  const wb = makeWorktree(join(tmp, 'b'));
  const d = Agent.start(home, wa.path, plant ? { DEEP_HUB_PLANT: plant } : {});
  const a = d.session(wa.path);
  const b = d.session(wb.path);
  const hub = await startHub(home, { plant });
  await d.establish(hub, a);
  await d.establish(hub, b);
  await initialize(d);

  // The twin first: a call A's own PreToolUse stamped binds to A.
  const plain = claimArgs();
  await d.stamp(hub, a, 'deep_claim', plain);
  await callTool(d, 'deep_claim', plain);
  // In session A the agent runs deep-hook by hand: a PreToolUse for B, with the tool name and arguments of A's next
  // deep_claim. A shell that execs its last command leaves it a child of D, as D's own hooks are (README: Readings).
  const next = claimArgs();
  await d.stamp(hub, b, 'deep_claim', next);
  await d.stamp(hub, a, 'deep_claim', next);
  const ambiguous = await callTool(d, 'deep_claim', next);
  // One stamp, two calls: the second finds it spent.
  const once = claimArgs();
  await d.stamp(hub, a, 'deep_claim', once);
  await callTool(d, 'deep_claim', once);
  await callTool(d, 'deep_claim', once);
  await sleep(500);
  const all = await events(hub);
  const sessions = (args: Line) => claimsFor(all, args.task_ref).map((e) => String(e.session));
  return { a: a.id, b: b.id, ambiguous: { refused: ambiguous.isError, filed: sessions(next) }, twice: sessions(once), single: sessions(plain) };
}
function holds(o: Daemon): void {
  expect(o.single, `a deep_claim A's own PreToolUse stamped binds to A (${o.a})`).toEqual([o.a]);
  expect(o.ambiguous.filed, `the deep_claim two unspent stamps match, A's (${o.a}) and the one stamped by hand for B (${o.b}), binds to no session; it was filed under ${o.ambiguous.filed.join(', ') || 'none'}`).toEqual([]);
  expect(o.ambiguous.refused, `the deep_claim two unspent stamps match (A ${o.a}, B ${o.b}) is refused`).toBe(true);
  expect(o.twice, `one stamped event binds at most one call: the same deep_claim sent twice after one PreToolUse of A (${o.a}) is filed once`).toEqual([o.a]);
}

test('#26.bf6dc81a on one shared daemon, a PreToolUse stamped by hand for B makes A\'s matching deep_claim bind to none; no stamp binds two calls', async () => {
  holds(await sharedDaemon());
}, 120_000);

test('#26.bf6dc81a (wrong program) a hub that binds a call to the first event it matches files the claim under B and fails, naming both sessions', async () => {
  const o = await sharedDaemon('binds-first-stamp');
  let failure = '';
  try { holds(o); } catch (error) { failure = (error as Error).message; }
  expect(failure, 'the scenario fails on the planted hub').not.toBe('');
  expect(failure).toContain(o.a);
  expect(failure).toContain(o.b);
}, 120_000);
