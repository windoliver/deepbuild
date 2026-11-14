// #1632.a3eebb10 A process whose session exited, with its `deep mcp` still connected, still has its session-bound
//   calls refused, naming that session. A hub that binds the call to any live session in the same worktree fails this test.
// Two Claude Code processes work in one worktree: P1 in session X, P2 in session Y. X ends with no successor in P1,
// P1's deep mcp stays connected, and Y, live in the same worktree, holds an unspent PreToolUse stamped for exactly the
// call P1 sends next. A hub that rebinds P1's call to a live session of the worktree, or to any unspent stamp that
// matches the call, files it under Y and fails here. The second test is Scope's "no successor in its own process"
// with a clear: X ends with reason clear, but the next start (source clear) in the worktree comes from P2.

import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { Agent, claimArgs, claimsFor, cleanup, errorOf, events, makeHome, makeWorktree, sleep, startHub, valueOf, word, type Line } from './helpers.ts';

afterEach(cleanup, 30_000);

async function twoProcesses() {
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'work'));
  const p1 = Agent.start(home, wt.path);
  const p2 = Agent.start(home, wt.path);
  const x = p1.session();
  const hub = await startHub(home);
  await p1.establish(hub, x);
  await p1.initialize();
  const status = valueOf(await p1.call('deep_status', {}), `deep_status from P1's deep mcp in X ${x.id}`);
  if (status?.session !== x.id) throw Error(`BLOCKED: P1's deep mcp didn't bind to X ${x.id}: ${JSON.stringify(status)}`);
  return { hub, p1, p2, x };
}

/** P1's deep_claim, deep_ask and deep_open_item, each with Y's matching stamp unspent: each refused unbound naming X; nothing filed. */
async function refusedNamingX(o: Awaited<ReturnType<typeof twoProcesses>> & { y: { id: string; cwd: string; transcript: string } }, how: string): Promise<void> {
  const { hub, p1, p2, x, y } = o;
  const tag = word();
  const calls: [string, Line][] = [
    ['deep_claim', claimArgs()],
    ['deep_ask', { kind: 'taste', question: `Which footer for ${tag}?`, options: [{ id: 'dark', label: 'Dark footer' }, { id: 'light', label: 'Light footer' }], recommended: 'dark' }],
    ['deep_open_item', { text: `the ${tag} footer is still open` }],
  ];
  for (const [tool, args] of calls) {
    await p2.stamp(y, tool, args);
    const refused = errorOf(await p1.call(tool, args, 120_000), `${tool} from P1's deep mcp after X ${x.id} ${how}, with live Y ${y.id}'s matching stamp unspent`);
    expect(refused.code, `${tool} after X ${x.id} ${how} is refused unbound: ${JSON.stringify(refused)}`).toBe('unbound');
    expect(JSON.stringify(refused), `${tool}'s refusal names the session that ended, X ${x.id}`).toContain(x.id);
  }
  await sleep(500);
  const all = await events(hub);
  const filed = [
    ...claimsFor(all, calls[0]![1].task_ref),
    ...all.filter((e) => e.kind === 'ask.created' && e.data?.question === calls[1]![1].question),
    ...all.filter((e) => e.kind === 'open_item.opened' && e.data?.text === calls[2]![1].text),
  ];
  expect(filed.map((e) => `${e.kind} ${e.id} under ${e.session}`), `nothing P1 sent after X ${x.id} ${how} is filed, under Y ${y.id} or anyone`).toEqual([]);
}

test('#1632.a3eebb10 a session that exited keeps its deep mcp\'s session-bound calls refused, naming it, though a live session in its worktree holds a matching stamp', async () => {
  const o = await twoProcesses();
  const y = o.p2.session();
  await o.p2.establish(o.hub, y);
  await o.p1.end(o.hub, o.x, 'prompt_input_exit');
  await refusedNamingX({ ...o, y }, 'exited');
}, 240_000);

test('#1632.a3eebb10 a session cleared with no successor in its own process keeps refusing, naming it, though the next clear start in its worktree is another process\'s', async () => {
  const o = await twoProcesses();
  await o.p1.end(o.hub, o.x, 'clear');
  const y = o.p2.session();
  await o.p2.establish(o.hub, y, 'clear');
  await refusedNamingX({ ...o, y }, 'ended by clear, its next clear start coming from P2');
}, 240_000);
