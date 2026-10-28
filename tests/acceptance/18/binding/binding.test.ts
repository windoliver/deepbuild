// AC9 #18.7f5b2ce8: A `deep_ask` from a session's MCP process is filed under that session, and a call from a
// process whose parent matches no session can read only what belongs to no session, such as the wiki, and can't ask
// or claim; a hub that shows it another session's open items fails this test.
//
// Session A is a Claude Code stand-in (fixtures/agent.mjs) whose hooks are the real deep-hook binary and whose
// `deep mcp` is its child. Each of A's deep_* calls is preceded by the PreToolUse Claude Code fires for it
// (`mcp__deep__<tool>`), sent through deep-hook. A records an open item, a claim and an ask.
// Two processes whose parent matches no session then call the same tools:
//   - a `deep mcp` started by hand from this test process, in A's own worktree, racing an unspent PreToolUse that A
//     stamped for exactly the arguments of its deep_ask;
//   - the `deep mcp` of a second agent process that ran no hooks, so no session's hooks came from it.
// The wiki holds one claim at scope `all`, learned before the hub starts, which both must find. Neither may see A's
// open item, claim or session, and neither may ask or claim.

import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { Agent, callTool, cleanup, events, eventsMatching, initialize, makeHome, makeWorktree, McpProcess, seedWiki, sleep, startHub, word, type Ev, type Line, type Mcp, type Outcome } from './helpers.ts';

afterEach(cleanup, 30_000);

const TAG = 'AC9 #18.7f5b2ce8';
/** What every search asks for: words both the wiki's claim and A's open item hold. */
const QUERY = 'kestrel ledger';
const WIKI = { page: 'setup', id: 'kestrel-ledger', text: 'The kestrel ledger is rebuilt every Sunday night' };
const WIKI_HIT = `wiki:${WIKI.page}#${WIKI.id}`;

const taste = (question: string) => ({ kind: 'taste', question, options: [{ id: 'blue', label: 'Blue' }, { id: 'green', label: 'Green' }], recommended: 'blue' });
const claimArgs = (ref: string) => ({ task_ref: ref, attempt: 1, commit: 'ab'.repeat(20), scope: 'session' });

interface Probe { who: string; search: Outcome; status: Outcome; ask: Outcome; question: string; claim: Outcome; ref: string }
interface Seen {
  plant: string | undefined;
  a: string;
  item: string;
  itemEvents: Ev[];
  claimRef: string;
  claimEvents: Ev[];
  question: string;
  asked: Ev[];
  own: Outcome;
  probes: Probe[];
  all: Ev[];
}

/** One stamped call from A: the PreToolUse through deep-hook, then the call on A's own deep mcp. */
async function fromA(agent: Agent, s: { id: string; cwd: string; transcript: string }, tool: string, args: Line): Promise<Outcome> {
  await agent.stamp(s, tool, args);
  return callTool(agent, tool, args);
}

/** The reads and writes a process bound to no session tries. */
async function probe(m: Mcp, who: string, question: string, ref: string): Promise<Probe> {
  const search = await callTool(m, 'deep_search', { query: QUERY });
  const status = await callTool(m, 'deep_status', {});
  const ask = await callTool(m, 'deep_ask', taste(question), 60_000);
  const claim = await callTool(m, 'deep_claim', claimArgs(ref));
  return { who, search, status, ask, question, claim, ref };
}

async function scenario(plant?: string): Promise<Seen> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { tmp, home } = makeHome();
  const wa = makeWorktree(join(tmp, 'a'));
  const wc = makeWorktree(join(tmp, 'c'));
  await seedWiki(home, WIKI);
  const hub = await startHub(home, plant);

  // Session A: its deep mcp starts with the agent, as Claude Code starts its MCP servers, then its hooks run.
  const agent = await Agent.start(home, wa, env);
  await initialize(agent);
  const s = agent.session();
  await agent.establish(hub, s);

  const tag = word();
  const item = `kestrel ledger retry budget for ${tag} is still open`;
  const claimRef = `task:${tag}A`;
  const question = `Which colour for the ${tag} header?`;
  const raceQuestion = `Ship the ${tag} release tonight?`;

  const opened = await fromA(agent, s, 'deep_open_item', { text: item });
  if (opened.isError) throw Error(`BLOCKED: session A's deep_open_item was refused: ${JSON.stringify(opened.reply).slice(0, 1500)}`);
  const itemEvents = await eventsMatching(hub, (e) => e.kind === 'open_item.opened' && e.data?.text === item);
  const claimed = await fromA(agent, s, 'deep_claim', claimArgs(claimRef));
  if (claimed.isError) throw Error(`BLOCKED: session A's deep_claim was refused: ${JSON.stringify(claimed.reply).slice(0, 1500)}`);
  const claimEvents = await eventsMatching(hub, (e) => e.kind === 'claim.made' && e.data?.task_ref === claimRef);
  const own = await fromA(agent, s, 'deep_search', { query: QUERY });

  // A's deep_ask waits for an answer nobody gives; what's checked is where it was filed while it waits.
  const askArgs = taste(question);
  await agent.stamp(s, 'deep_ask', askArgs);
  void callTool(agent, 'deep_ask', askArgs).catch(() => undefined);
  const asked = await eventsMatching(hub, (e) => e.kind === 'ask.created' && e.data?.question === question, 20_000);

  // By hand, in A's own worktree. A's PreToolUse for a deep_ask with these very arguments is unspent when it calls.
  const hand = McpProcess.start(home, wa, env);
  await initialize(hand);
  await agent.stamp(s, 'deep_ask', taste(raceQuestion));
  const byHand = await probe(hand, `the deep mcp started by hand in session A's worktree (pid ${hand.pid}, parent this test process)`, raceQuestion, `task:${tag}H`);

  // A second agent process that ran no hooks: its deep mcp's parent is a real process, but no session's.
  const other = await Agent.start(home, wc, env);
  await initialize(other);
  const byOther = await probe(other, `the deep mcp of agent process ${other.pid}, which ran no hooks`, `Which font for the ${tag} footer?`, `task:${tag}C`);

  await sleep(1000);
  return { plant, a: s.id, item, itemEvents, claimRef, claimEvents, question, asked, own, probes: [byHand, byOther], all: await events(hub) };
}

const shown = (o: Outcome): string => JSON.stringify(o.reply).slice(0, 1200);

/** Everything this criterion forbids or requires, as sentences naming what went wrong; empty when it holds. */
function problems(o: Seen): string[] {
  const out: string[] = [];
  // Setup that the rest reads from: A's own records, under A.
  if (o.itemEvents.length !== 1 || o.itemEvents[0]!.session !== o.a) out.push(`session A's (${o.a}) open item "${o.item}" was recorded ${o.itemEvents.length} times, under ${o.itemEvents.map((e) => e.session).join(', ') || 'none'}`);
  if (o.claimEvents.length !== 1 || o.claimEvents[0]!.session !== o.a) out.push(`session A's (${o.a}) claim ${o.claimRef} was recorded ${o.claimEvents.length} times, under ${o.claimEvents.map((e) => e.session).join(', ') || 'none'}`);
  const ownHits = (o.own.value?.hits ?? []) as Line[];
  if (o.own.isError || !ownHits.some((h) => String(h.quote ?? '').includes(o.item))) out.push(`session A's own deep_search "${QUERY}" doesn't find its open item "${o.item}", so a leak couldn't be seen: ${shown(o.own)}`);

  // A deep_ask from a session's MCP process is filed under that session.
  if (o.asked.length !== 1 || o.asked[0]!.session !== o.a) out.push(`the deep_ask "${o.question}" from session A's deep mcp was filed ${o.asked.length} times, under ${o.asked.map((e) => e.session ?? 'no session').join(', ') || 'none'}, not once under session A (${o.a})`);

  for (const p of o.probes) {
    // It can read what belongs to no session, such as the wiki.
    const hits = (p.search.value?.hits ?? []) as Line[];
    if (p.search.isError) out.push(`${p.who}: deep_search was refused, though a call bound to no session reads the wiki: ${shown(p.search)}`);
    else if (!hits.some((h) => h.source === WIKI_HIT)) out.push(`${p.who}: deep_search "${QUERY}" doesn't find the wiki's claim ${WIKI_HIT} ("${WIKI.text}"): ${shown(p.search)}`);
    if (!p.status.isError && p.status.value?.session != null) out.push(`${p.who}: deep_status names session ${JSON.stringify(p.status.value.session)}, though its parent matches no session`);
    // And nothing of another session's: its open item, its claim, its session.
    for (const [tool, outcome] of [['deep_search', p.search], ['deep_status', p.status]] as const) {
      const text = JSON.stringify(outcome.value ?? null);
      if (text.includes(o.item)) out.push(`${p.who}, bound to no session, was shown session A's (${o.a}) open item "${o.item}" by ${tool}: ${text.slice(0, 1200)}`);
      if (text.includes(o.claimRef)) out.push(`${p.who}, bound to no session, was shown session A's (${o.a}) claim ${o.claimRef} by ${tool}: ${text.slice(0, 1200)}`);
      if (text.includes(o.a)) out.push(`${p.who}, bound to no session, was shown session A's ID ${o.a} by ${tool}: ${text.slice(0, 1200)}`);
    }
    // It can't ask or claim: refused, and nothing filed under any session.
    if (!p.ask.isError) out.push(`${p.who}: deep_ask "${p.question}" was not refused: ${shown(p.ask)}`);
    const filed = o.all.filter((e) => e.kind === 'ask.created' && e.data?.question === p.question);
    if (filed.length) out.push(`${p.who}: deep_ask "${p.question}" was filed, under ${filed.map((e) => e.session ?? 'no session').join(', ')}`);
    if (!p.claim.isError) out.push(`${p.who}: deep_claim ${p.ref} was not refused: ${shown(p.claim)}`);
    const claims = o.all.filter((e) => e.kind === 'claim.made' && e.data?.task_ref === p.ref);
    if (claims.length) out.push(`${p.who}: deep_claim ${p.ref} was filed, under ${claims.map((e) => e.session ?? 'no session').join(', ')}`);
  }
  return out;
}

function holds(o: Seen): void {
  const found = problems(o);
  if (found.length) throw Error(`${TAG}${o.plant ? ` (DEEP_HUB_PLANT=${o.plant})` : ''}:\n- ${found.join('\n- ')}`);
}

test(`${TAG} a deep_ask from a session's deep mcp is filed under that session; a process whose parent matches no session reads the wiki but no session's items, and can't ask or claim`, async () => {
  holds(await scenario());
}, 180_000);

test(`${TAG} (wrong program unbound-reads-all) a hub that shows a call bound to no session another session's open items fails this test, naming the open item`, async () => {
  const o = await scenario('unbound-reads-all');
  let failure = '';
  try { holds(o); } catch (error) { failure = (error as Error).message; }
  expect(failure, 'the criterion fails on the planted hub').not.toBe('');
  expect(failure, 'the failure names session A\'s open item').toContain(`open item "${o.item}"`);
}, 180_000);
