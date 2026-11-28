// AC9 #3460.e44187b3 For every query in #26's, #884's and #1515's suites that finds a hit today, the set of hits is the
//                    one the merge base returns, and any leftover delta is listed.
//
// Each of the three suites' fixtures is built as that suite builds it, and each of its queries that finds a hit on the
// merge base is asked again, every page: the set of hits must be the merge base's, and a failure lists the hits gained
// and the hits lost, by query (README: The merge base's hits). #884's and #26's sets are written out below by what
// each hit is (their decisions' IDs are minted per run); #1515's fixture has fixed handles, so its sets are
// fixtures/base-hits.json, which the last test here writes, only when asked and only on the base commit, as #1515's
// own oracle is written. The implementer never runs that one (AGENTS.md: never re-record goldens).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { fixtures } from '../../../packages/contracts/src/index.ts';
import { agentWorld, askData, callTool, deep, eventMatching, initialize, McpProcess, REPO, startHub, ulid as ulid26, valueOf, type Line } from '../26/helpers.ts';
import { CORE, cleanup, handle, hookIn, makeWorld, sha256, ulid, unboundMcp, withRecord, type Mcp } from '../355/helpers.ts';
import {
  AGENT_WORD, CHANGED_WORD, cleanup as cleanup1515, COMMON_WORD, ERR, FILE, find as find1515, makeWorld as makeWorld1515, QUERIES, WHOSE_WORD, type CodexSession,
} from '../1515/helpers.ts';
import { AC, delta, everySource, learn } from './helpers.ts';

afterAll(async () => { await cleanup(); await cleanup1515(); }, 120_000);

/** Fails listing every query whose set of hits moved, with what it gained and lost. */
function sameSets(suite: string, got: Record<string, string[]>, want: Record<string, string[]>): void {
  const moved = Object.keys(want).filter((q) => JSON.stringify([...(got[q] ?? [])].sort()) !== JSON.stringify([...want[q]!].sort()));
  expect(moved.map((q) => `${q}: ${delta(got[q] ?? [], want[q]!)}`), `#${suite}'s queries whose set of hits is not the merge base's, each with its delta`).toEqual([]);
}

// ---- #884's fixture (tests/acceptance/884/search.test.ts): three wiki claims and three decisions found by their questions.
const WIKI = {
  zh1: { page: 'notes/cache', id: 'zh1', text: '提示缓存失效时重新计费' },
  zh2: { page: 'notes/cache-billing', id: 'zh2', text: '提示缓存失效时重新计费 billing applies' },
  en1: { page: 'notes/billing', id: 'en1', text: 'Nightly billing applies to every invoice' },
} as const;
const ASKED = { umlaut: 'Keep the größe column in the orders table?', ascii: 'Keep the grosse column in the invoices table?', cafe: 'Rename the Café screen to Lounge?' } as const;
/** #884's queries that find a hit on the merge base, each with the hits the merge base returns. */
const BASE_884: Record<string, string[]> = {
  billing: [handle(WIKI.zh2), handle(WIKI.en1)],
  缓存: [handle(WIKI.zh1), handle(WIKI.zh2)],
  '缓存 billing': [handle(WIKI.zh2)],
  column: ['decision umlaut', 'decision ascii'],
  Größe: ['decision umlaut'],
  Lounge: ['decision cafe'],
  café: ['decision cafe'],
};

test(`AC9 ${AC[9]} every query of #884's suite that finds a hit returns the merge base's set of hits`, async () => {
  const w = makeWorld();
  const named = new Map<string, string>();
  await withRecord(w, async (o) => {
    await learn(w, o, Object.values(WIKI));
    const session = ulid(w.clock.tick());
    const at = w.clock.tick();
    await o.record.append(hookIn(session, 'shop'), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: w.elsewhere, branch: 'main', thread: session } });
    const core = { ...CORE, session, project: 'shop' };
    for (const [name, question] of Object.entries(ASKED)) {
      const t = w.clock.tick();
      const ask = ulid(t);
      await o.record.append(core, { v: 1, id: ask, kind: 'ask.created', ts: t, data: askData('choice', question, t) });
      const id = ulid(t + 1);
      await o.record.append(core, { v: 1, id, kind: 'decision.created', ts: t + 1, data: { key: sha256(question), scope: 'repo:shop', answer: 'files', ask: `ask:${ask}` } });
      named.set(`decision:${id}`, `decision ${name}`);
    }
  });
  await startHub(w.home);
  const mcp = await unboundMcp(w);
  const got: Record<string, string[]> = {};
  for (const query of Object.keys(BASE_884)) got[query] = (await everySource(mcp, query)).map((s) => named.get(s) ?? s);
  sameSets('884', got, BASE_884);
}, 480_000);

// ---- #26's fixture (tests/acceptance/26/search.test.ts): one term in the wiki's stand-in, a decision, the spec, the
// session's open item and verdict, and its transcript, each with a marker of its own.
const TERM = 'qkestrelterm';
const MARK = { wiki: 'wikiqmarka', decision: 'decisionqmarkb', spec: 'specqmarkc', item: 'openitemqmarkd', verdict: 'verdictqmarke', transcript: 'transcriptqmarkf' } as const;
/** What a hit of #26's fixture is: the marker its text holds; else its source, so a hit of no marker shows in the delta. */
const what = (h: Line): string => Object.entries(MARK).find(([, mark]) => JSON.stringify(h).includes(mark))?.[0] ?? String(h.source);
/** The term's hits on the merge base: from the session's own call, and from a call bound to no session. */
const BASE_26: Record<string, string[]> = {
  [`${TERM}, from the session`]: ['wiki', 'spec', 'item', 'verdict', 'decision'],
  [`${TERM}, bound to no session`]: ['wiki', 'spec', 'decision'],
};

test(`AC9 ${AC[9]} every query of #26's search suite that finds a hit returns the merge base's set of hits`, async () => {
  let asked = '';
  const w = await agentWorld({
    prompt: `fix the ${TERM} ${MARK.transcript} bug`,
    checks: [`smoke: { type: command, run: "echo ${TERM} ${MARK.spec}" }`],
    wiki: [{ id: 'c1', page: 'repos/shop', source: 'wiki/repos/shop.md', text: `The shop deploy runs ${TERM} ${MARK.wiki} first.` }],
    seeded: async (s, session, worktree) => {
      await s.start('S0past', worktree);
      asked = await s.raise('S0past', 'choice', `Keep ${TERM} ${MARK.decision} on SQLite or plain files?`);
      const verdict = structuredClone(fixtures('verdict.made@1')[0]) as Line;
      Object.assign(verdict.data, { reasons: [`${TERM} ${MARK.verdict} failed`], smallest: `${TERM} ${MARK.verdict}`, verdict: `verdict:${ulid26()}` });
      await s.record.append({ writer: 'core', actor: 'you', scope: 'you', session: session.id }, { v: 1, id: ulid26(s.now()), kind: 'verdict.made', ts: s.now(), data: verdict.data });
    },
  });
  const answered = await deep(w.home, ['inbox', 'answer', asked, 'files']);
  if (answered.code !== 0) throw Error(`BLOCKED: deep inbox answer ${asked} files exited ${answered.code}: ${answered.stdout}${answered.stderr}`);
  valueOf(await callTool(w.agent, 'deep_open_item', { text: `${TERM} ${MARK.item} is still open` }), 'deep_open_item from the session');
  await eventMatching(w.hub, (e) => e.kind === 'decision.created' && e.data?.ask === asked, 10_000);
  await eventMatching(w.hub, (e) => e.kind === 'open_item.opened' && String(e.data?.text).includes(MARK.item), 10_000);
  const hand = McpProcess.start(w.home, w.wt.path);
  await initialize(hand);
  const every = async (m: Mcp): Promise<string[]> => {
    const out: string[] = [];
    for (let cursor: string | undefined; ;) {
      const value = valueOf(await callTool(m, 'deep_search', { query: TERM, ...(cursor !== undefined ? { cursor } : {}) }), `deep_search "${TERM}"`);
      out.push(...((value?.hits ?? []) as Line[]).map(what));
      cursor = typeof value?.next === 'string' ? value.next : undefined;
      if (cursor === undefined) return out;
    }
  };
  sameSets('26', { [`${TERM}, from the session`]: await every(w.agent), [`${TERM}, bound to no session`]: await every(hand) }, BASE_26);
}, 480_000);

// ---- #1515's fixture (tests/acceptance/1515/helpers.ts: 500 sessions in two repos, fixed handles).
const GOLDEN = new URL('./fixtures/base-hits.json', import.meta.url);
const BASE = 'b134dd38f';
/** #1515's queries: deep_search from a Codex session of repo A or B, every page, and `deep find` in repo A's folder. */
const SEARCHES: ['a' | 'b', string][] = [['a', ERR], ['b', ERR], ['a', AGENT_WORD], ['a', WHOSE_WORD], ['a', CHANGED_WORD], ['a', COMMON_WORD]];
const FINDS: string[][] = [[ERR], [QUERIES.part], [QUERIES.greek], [QUERIES.chinese], [COMMON_WORD], ['--file', FILE]];
async function hits1515(): Promise<Record<string, string[]>> {
  const w = await makeWorld1515();
  const got: Record<string, string[]> = {};
  const every = async (s: CodexSession, query: string): Promise<string[]> => {
    const out: string[] = [];
    for (let cursor: string | undefined; ;) {
      const value = valueOf(await s.call('deep_search', { query, ...(cursor !== undefined ? { cursor } : {}) }), `deep_search "${query}"`);
      out.push(...((value?.hits ?? []) as Line[]).map((h) => String(h.source)));
      cursor = typeof value?.next === 'string' ? value.next : undefined;
      if (cursor === undefined) return out;
    }
  };
  // The hub builds the archive's index after its start: searched once it returns the error string's message.
  const a = await w.codex('a');
  for (const deadline = Date.now() + 120_000; !(await every(a, ERR)).length;) {
    if (Date.now() > deadline) throw Error(`BLOCKED: in 120 s deep_search "${ERR}" from repo A's session never returned a hit`);
    await new Promise((r) => setTimeout(r, 500));
  }
  for (const [repo, query] of SEARCHES) got[`deep_search from repo ${repo.toUpperCase()}: ${query}`] = await every(await w.codex(repo), query);
  for (const args of FINDS) got[`deep find ${args.join(' ')}`] = (await find1515(w, args)).hits.map((h) => String(h.handle));
  return got;
}

test(`AC9 ${AC[9]} every query of #1515's suite that finds a hit returns the merge base's set of hits`, async () => {
  const want = (JSON.parse(readFileSync(GOLDEN, 'utf8')) as { queries: Record<string, string[]> }).queries;
  const empty = Object.keys(want).filter((q) => !want[q]!.length);
  if (Object.keys(want).length !== SEARCHES.length + FINDS.length || empty.length) throw Error(`BLOCKED: fixtures/base-hits.json holds the merge base's hits for ${Object.keys(want).length} of ${SEARCHES.length + FINDS.length} queries, ${empty.length} of them empty`);
  sameSets('1515', await hits1515(), want);
}, 1_800_000);

test.runIf(process.env.DH3460_GOLDEN === 'write')(`records the merge base's hits on #1515's fixture at ${BASE}`, async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  expect(git('rev-parse', 'HEAD').startsWith(BASE), `the golden is written only at the base commit ${BASE}`).toBe(true);
  expect(git('status', '--porcelain', '--', 'packages'), 'the golden is written only with packages/ as the base has them').toBe('');
  const queries = await hits1515();
  for (const [query, hits] of Object.entries(queries)) expect(hits, `the merge base finds a hit for ${query}`).not.toEqual([]);
  writeFileSync(GOLDEN, `${JSON.stringify({ base: git('rev-parse', 'HEAD'), queries }, null, 1)}\n`);
}, 1_800_000);
