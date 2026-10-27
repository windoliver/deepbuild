// AC9 #18.7f5b2ce8 A `deep_ask` from a session's MCP process is filed under that session, and a call from a process
//   whose parent matches no session can read only what belongs to no session, such as the wiki, and can't ask or
//   claim; a hub that shows it another session's open items fails this test.
//
// The session is a Claude Code stand-in (fixtures/agent.mjs) whose hooks are the real deep-hook binary and whose
// `deep mcp` is its child, so the hub binds that `deep mcp` by its parent process and the parent's start time. The
// session's own deep_ask is sent with no PreToolUse stamped for it, so only the parent binding can file it. "A process
// whose parent matches no session" is a `deep mcp` this test process starts itself (README: AC9).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, expect, test } from 'vitest';
import {
  Agent, brief, buildDeepHook, callTool, cleanup, Conn, events, eventsUntil, HandMcp, initialize, makeHome, makeWorktree, newestCovered, newSession,
  payload, pending, rootOf, shown, sleep, startHub, turn, ulid, word, type Ev, type Line, type Outcome,
} from './helpers.ts';

beforeAll(buildDeepHook, 900_000);
afterEach(cleanup, 30_000);

const taste = (question: string): Line => ({ kind: 'taste', question, options: [{ id: 'blue', label: 'Blue' }, { id: 'green', label: 'Green' }], recommended: 'blue', steps: null, where: null, why: null, check: null });
const claimArgs = (): Line => ({ task_ref: `task:${ulid()}`, attempt: 1, commit: 'a'.repeat(40), scope: 'session', predictions: null });
const said = (o: Outcome | string): string => (typeof o === 'string' ? o : JSON.stringify(o.reply).slice(0, 1200));

interface Seen {
  session: string; openText: string; openWord: string; wikiWord: string; question: string; handQuestion: string; claimRef: string; agentPid: number;
  opened: Outcome; filed: Ev | undefined; handSearchOpen: Outcome; handSearchWiki: Outcome; handStatus: Outcome; handAsk: Outcome | string;
  handClaim: Outcome; forged: Line | undefined; all: Ev[];
}

async function scenario(plant?: string): Promise<Seen> {
  const { tmp, home } = makeHome();
  const wikiWord = word('wiki');
  const openWord = word('open');
  // A wiki page: what belongs to no session.
  mkdirSync(join(rootOf(home), 'wiki'), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(home), 'wiki', 'shop.md'), `# Shop\n\nThe ${wikiWord} runbook starts the stack with make up.\n`);
  const wt = makeWorktree(join(tmp, 'a'));
  const hub = await startHub(home, { plant });

  // The session: its hooks through deep-hook, children of the agent.
  const agent = Agent.start(home, wt, plant);
  const s = newSession(home, wt, newestCovered());
  const t = turn(s, 'Note what is still open, then ask me about the header.', 'true');
  for (const body of [payload(s, 'SessionStart'), t.prompt]) {
    const r = await agent.hook(s, body);
    expect(r.code, `${body.hook_event_name} through deep-hook, run by the agent: ${shown(r)}`).toBe(0);
  }
  await eventsUntil(hub, (all) => all.some((e) => e.session === s.id && e.kind === 'user.ask'));

  // The session's own deep mcp: an open item, then an ask, with no PreToolUse stamped for either.
  await initialize(agent);
  const openText = `the ${openWord} migration is still open`;
  const opened = await callTool(agent, 'deep_open_item', { text: openText });
  const question = `Which header colour for ${openWord}?`;
  void pending(callTool(agent, 'deep_ask', taste(question)));
  const afterAsk = await eventsUntil(hub, (all) => all.some((e) => e.kind === 'ask.created' && e.data?.question === question));
  const filed = afterAsk.find((e) => e.kind === 'ask.created' && e.data?.question === question);

  // A deep mcp started by hand, in the session's own worktree: its parent is this test process, which no session's hooks came from.
  const hand = new HandMcp(home, wt, plant);
  await initialize(hand);
  const handSearchOpen = await callTool(hand, 'deep_search', { query: openWord });
  const handSearchWiki = await callTool(hand, 'deep_search', { query: wikiWord });
  const handStatus = await callTool(hand, 'deep_status', {});
  const handQuestion = `Which footer colour for ${openWord}?`;
  // An ask that was filed would wait for its answer; one refused comes back at once.
  const handAsk = await Promise.race([callTool(hand, 'deep_ask', taste(handQuestion)), sleep(20_000).then(() => 'still waiting after 20 s, as a filed ask does')]);
  const claim = claimArgs();
  const handClaim = await callTool(hand, 'deep_claim', claim);

  // The parent's start time decides, never its PID alone: the agent's PID with a start time that isn't its own binds
  // to nothing (the hub's mcp hello, tests/acceptance/16/README.md), though the PID is a live session's parent.
  const lie = await Conn.open(hub.socket, { hello: 'mcp', parent: { pid: agent.pid, start: 'Thu Jan  1 00:00:00 1970' } });
  lie.conn.close();
  await sleep(500);
  return {
    session: s.id, openText, openWord, wikiWord, question, handQuestion, claimRef: claim.task_ref as string, agentPid: agent.pid,
    opened, filed, handSearchOpen, handSearchWiki, handStatus, handAsk, handClaim, forged: lie.answer, all: await events(hub),
  };
}

const hits = (o: Outcome): Line[] => (Array.isArray(o.value?.hits) ? (o.value.hits as Line[]) : []);

function holds(o: Seen): void {
  // The session's deep mcp acts for its session.
  expect(o.opened.isError, `deep_open_item from session ${o.session}'s deep mcp: ${said(o.opened)}`).toBe(false);
  const item = o.all.find((e) => e.kind === 'open_item.opened' && e.data?.text === o.openText);
  expect(item?.session, `the open item "${o.openText}" is filed under session ${o.session}: ${item ? brief(item) : 'none recorded'}`).toBe(o.session);
  expect(o.filed?.session, `the deep_ask "${o.question}" from session ${o.session}'s deep mcp, bound by its parent process ${o.agentPid}, is filed under that session: ${o.filed ? brief(o.filed) : 'nothing filed'}`).toBe(o.session);

  // The deep mcp whose parent matches no session reads what belongs to no session ...
  expect(o.handSearchWiki.isError, `deep_search from a deep mcp started by hand reads the wiki: ${said(o.handSearchWiki)}`).toBe(false);
  expect(hits(o.handSearchWiki).some((h) => String(h.source).startsWith('wiki:') && String(h.quote).includes(o.wikiWord)), `the wiki page holding ${o.wikiWord} is a hit: ${said(o.handSearchWiki)}`).toBe(true);
  // ... and nothing of the session's.
  expect(o.handSearchOpen.isError, `deep_search for ${o.openWord} from a deep mcp started by hand runs, finding only what belongs to no session: ${said(o.handSearchOpen)}`).toBe(false);
  const leaked = hits(o.handSearchOpen).filter((h) => String(h.quote).includes(o.openWord));
  expect(leaked.map((h) => `${h.quote} (${h.source})`), `a deep mcp whose parent matches no session is shown session ${o.session}'s open item "${o.openText}"`).toEqual([]);
  expect(o.handStatus.value?.session ?? null, `deep_status from a deep mcp started by hand names no session: ${said(o.handStatus)}`).toBeNull();
  expect(JSON.stringify(o.handStatus.value ?? null).includes(o.session), `deep_status from a deep mcp started by hand shows nothing of session ${o.session}: ${said(o.handStatus)}`).toBe(false);

  // It can't ask or claim.
  expect(typeof o.handAsk !== 'string' && o.handAsk.isError, `deep_ask from a deep mcp started by hand is refused: ${said(o.handAsk)}`).toBe(true);
  expect(o.all.filter((e) => e.kind === 'ask.created' && e.data?.question === o.handQuestion).map(brief), 'no ask is filed for a deep mcp whose parent matches no session').toEqual([]);
  expect(o.handClaim.isError, `deep_claim from a deep mcp started by hand is refused: ${said(o.handClaim)}`).toBe(true);
  expect(o.all.filter((e) => e.kind === 'claim.made' && e.data?.task_ref === o.claimRef).map(brief), 'no claim is made for a deep mcp whose parent matches no session').toEqual([]);

  // The agent's PID with a start time that isn't its own binds to no session.
  expect(o.forged !== undefined && (o.forged.role === 'mcp' || 'error' in o.forged), `a deep mcp presenting the agent's PID ${o.agentPid} with another start time binds to no session (role mcp, or refused), never to ${o.session}: ${JSON.stringify(o.forged)}`).toBe(true);
}

test('AC9 #18.7f5b2ce8 deep_ask from a session\'s deep mcp is filed under it; a deep mcp whose parent matches no session reads the wiki only, and can\'t ask or claim', async () => {
  holds(await scenario());
}, 300_000);

test('AC9 #18.7f5b2ce8 (wrong program) a hub that shows a deep mcp bound to no session another session\'s open items fails, naming the item', async () => {
  // DEEP_HUB_PLANT=unbound-reads-all: an unbound deep_search reads every session's open items (README: Wrong programs).
  const o = await scenario('unbound-reads-all');
  let failure = '';
  try { holds(o); } catch (error) { failure = (error as Error).message; }
  expect(failure, 'the scenario fails on the planted hub').not.toBe('');
  expect(failure).toContain(o.openText);
  expect(failure).toContain(o.session);
}, 300_000);
