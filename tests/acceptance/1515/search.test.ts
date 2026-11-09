// #1515: a working session searches past sessions. One fixture record of 500 sessions in two repos (README: The
// fixture), written through the real record and evidence store while no hub runs; then the hub (`deep hub run`) runs
// on it with no seams set. `deep_search` is called as an MCP client calls it, from the `deep mcp` of a Codex session
// of repo A or repo B, bound to it by its hooks (the agent stand-in of tests/acceptance/26 runs both as its children);
// `deep find` is the built CLI, run by you in repo A's folder. Criterion 7 (budgets) is in budgets.test.ts.
//
// AC1 #1515.50f29297 deep_search for an error string from a Claude Code session of repo A, called from a Codex
//                    session of repo A, returns that message's handle and its agent.
// AC2 #1515.82f04bac The same call from a session of repo B returns no hit from repo A.
// AC3 #1515.c41b7667 deep find --file src/retry.ts lists only sessions that touched that file, by the record's tool events.
// AC4 #1515.c5a02456 A hit whose file changed at a later commit says so. One whose file is unchanged doesn't.
// AC5 #1515.c84a0fbf A hit from a tool result that fetched a page reads as outside content, never your words.
// AC6 #1515.adbdb642 Deleting the index and rebuilding it from the evidence returns the same hits, in the same order.
// AC8 #1515.03d88b61 deep find returns the same hits as today's scan, for part of a word and Greek and Chinese queries.

import { readFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import {
  AC, AGENT_WORD, CHANGED_WORD, cleanup, COMMON_WORD, ERR, FILE, find, findPage, handleOf, idOf, makeWorld, QUERIES,
  sessionOf, UNCHANGED_FILE, WHOSE_WORD, dropIndex, type CodexSession, type Line, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);

let world: Promise<World> | undefined;
const setUp = (): Promise<World> => (world ??= makeWorld());

/**
 * Waits, at most 60 s, until the surface returns criterion 1's hit, so a hub that builds its index after its start
 * is searched once it has (README: Readings). Fails naming what never came.
 */
async function until(what: string, probe: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw Error(`in 60 s ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
const searchReady = new Map<CodexSession, Promise<void>>();
/** A Codex session of `repo`, once deep_search from repo A's own session returns criterion 1's hit. */
async function searching(w: World, repo: 'a' | 'b'): Promise<CodexSession> {
  const a = await w.codex('a');
  if (!searchReady.has(a)) searchReady.set(a, until(`deep_search "${ERR}" from Codex session ${a.handleId} of repo A never returned ${handleOf('E1', 'merr')}`, async () => (await a.past(ERR)).hits.some((h) => h.source === handleOf('E1', 'merr'))));
  await searchReady.get(a);
  return w.codex(repo);
}
let findReady: Promise<void> | undefined;
/** Once `deep find` returns criterion 1's message. */
const finding = (w: World): Promise<void> => (findReady ??= until(`deep find "${ERR}" never returned ${handleOf('E1', 'merr')}`, async () => (await find(w, [ERR])).hits.some((h) => h.handle === handleOf('E1', 'merr'))));

const sources = (hits: readonly Line[]): string[] => hits.map((h) => String(h.source));
const shown = (value: unknown): string => JSON.stringify(value).slice(0, 2000);

test(`AC1 ${AC[1]} deep_search from a Codex session of repo A returns the error string's message in a Claude Code session of repo A, with its handle and its agent`, async () => {
  const w = await setUp();
  const a = await searching(w, 'a');
  const want = handleOf('E1', 'merr');
  const { hits } = await a.past(ERR);
  const hit = hits.find((h) => h.source === want);
  expect(hit, `deep_search "${ERR}" from Codex session ${a.handleId} of repo A returns ${want}, the Bash result holding it in Claude Code session ${idOf('E1')}: ${shown(hits)}`).toBeDefined();
  expect(hit!.agent, `the hit ${want} names its session's agent: ${shown(hit)}`).toBe('claude-code');
  // The agent is read from the record: the same word in a Claude Code session and a Codex session of repo A.
  const word = (await a.past(AGENT_WORD)).hits;
  const claude = word.find((h) => h.source === handleOf('C1', 'mword'));
  const codex = word.find((h) => sessionOf(h.source) === idOf('X1'));
  expect(claude?.agent, `deep_search "${AGENT_WORD}" returns ${handleOf('C1', 'mword')} as Claude Code's: ${shown(word)}`).toBe('claude-code');
  expect(codex?.agent, `deep_search "${AGENT_WORD}" returns the message of Codex session ${idOf('X1')} as Codex's: ${shown(word)}`).toBe('codex');
}, 600_000);

test(`AC2 ${AC[2]} the same call from a Codex session of repo B returns no hit from repo A`, async () => {
  const w = await setUp();
  const b = await searching(w, 'b');
  const ofA = new Set(w.sessions.filter((s) => s.repo === 'a').map((s) => s.id));
  const { hits } = await b.past(ERR);
  for (const h of hits) expect(ofA.has(sessionOf(h.source)), `deep_search "${ERR}" from Codex session ${b.handleId} of repo B returned ${h.source}, from session ${sessionOf(h.source)} of repo A`).toBe(false);
  // The twin: B's own session holding the same string is found, so the empty side above is the scope's doing.
  expect(sources(hits), `deep_search "${ERR}" from repo B returns ${handleOf('BE1', 'merr')}, repo B's own message holding it: ${shown(hits)}`).toContain(handleOf('BE1', 'merr'));
}, 600_000);

test(`AC3 ${AC[3]} deep find --file ${FILE} lists only the sessions whose tool events touched it`, async () => {
  const w = await setUp();
  await finding(w);
  const touched = w.sessions.filter((s) => s.repo === 'a' && s.msgs.some((m) => (m.from === 'read' || m.from === 'edit') && m.path === FILE)).map((s) => s.id);
  expect(touched.sort(), 'the fixture: T1 read it, T2 (Codex) and S1 edited it').toEqual([idOf('T1'), idOf('T2'), idOf('S1')].sort());
  const { hits } = await find(w, ['--file', FILE]);
  const listed = [...new Set(hits.map((h) => sessionOf(h.handle)))];
  for (const id of listed) {
    const why = id === idOf('N1') ? `which only named ${FILE} in a message` : 'which never touched it';
    expect(touched, `deep find --file ${FILE} listed session ${id}, ${why}`).toContain(id);
  }
  for (const id of touched) expect(listed, `deep find --file ${FILE} lists session ${id}, whose tool events touched it: ${shown(hits)}`).toContain(id);
}, 600_000);

test(`AC4 ${AC[4]} the hit of a session whose file changed at a later commit says so; the one whose file is unchanged doesn't`, async () => {
  const w = await setUp();
  const a = await searching(w, 'a');
  const { hits } = await a.past(CHANGED_WORD);
  const changed = hits.find((h) => h.source === handleOf('S1', 'mnote'));
  const unchanged = hits.find((h) => h.source === handleOf('S2', 'mnote'));
  expect(changed, `deep_search "${CHANGED_WORD}" returns ${handleOf('S1', 'mnote')}: ${shown(hits)}`).toBeDefined();
  expect(unchanged, `deep_search "${CHANGED_WORD}" returns ${handleOf('S2', 'mnote')}: ${shown(hits)}`).toBeDefined();
  const named = (h: Line): string[] => (Array.isArray(h.changed) ? h.changed : []).map((c: unknown) => JSON.stringify(c));
  expect(named(changed!).some((c) => c.includes(FILE)), `the hit of session ${idOf('S1')} says ${FILE} changed since (its commit ${w.repos.a.commits[1]}, the head ${w.repos.a.commits[3]}): ${shown(changed)}`).toBe(true);
  expect(named(unchanged!).some((c) => c.includes(UNCHANGED_FILE)), `the hit of session ${idOf('S2')} says nothing of ${UNCHANGED_FILE} changing, unchanged since its commit ${w.repos.a.commits[2]}: ${shown(unchanged)}`).toBe(false);
}, 600_000);

test(`AC5 ${AC[5]} the hit from a page WebFetch returned reads as outside content, never your words`, async () => {
  const w = await setUp();
  const a = await searching(w, 'a');
  const { hits } = await a.past(WHOSE_WORD);
  const of = (message: string): Line | undefined => hits.find((h) => h.source === handleOf('F1', message));
  for (const m of ['mfetch', 'myou', 'magent']) expect(of(m), `deep_search "${WHOSE_WORD}" returns ${handleOf('F1', m)}: ${shown(hits)}`).toBeDefined();
  expect(of('mfetch')!.from, `the hit quoting the page WebFetch returned (${handleOf('F1', 'mfetch')}) reads as outside content: ${shown(of('mfetch'))}`).toBe('outside');
  // Whose words are read from the record: your message and the agent's, in the same session, read as theirs.
  expect(of('myou')!.from, `your own message (${handleOf('F1', 'myou')}) reads as your words`).toBe('you');
  expect(of('magent')!.from, `the agent's message (${handleOf('F1', 'magent')}) reads as the agent's`).toBe('agent');
}, 600_000);

test(`AC8 ${AC[8]} deep find returns today's hits for part of a word, a Greek and a Chinese query`, async () => {
  const w = await setUp();
  await finding(w);
  const today = (JSON.parse(readFileSync(new URL('./fixtures/today.json', import.meta.url), 'utf8')) as { queries: Record<string, string[]> }).queries;
  for (const [name, query] of Object.entries(QUERIES)) {
    const want = today[query];
    if (!want?.length) throw Error(`BLOCKED: fixtures/today.json holds no hits of today's scan for "${query}"`);
    const { hits } = await find(w, [query]);
    const got = [...new Set(hits.map((h) => String(h.handle)))].sort();
    expect(got, `deep find "${query}" (${name}) returns the hits today's scan returns`).toEqual([...want].sort());
  }
}, 600_000);

test(`AC6 ${AC[6]} deleting the index and rebuilding it from the evidence returns the same hits, in the same order`, async () => {
  const w = await setUp();
  await searching(w, 'a');
  await finding(w);
  const snapshot = async (a: CodexSession) => {
    const search: [string, unknown[][]][] = [];
    for (const q of [ERR, WHOSE_WORD, COMMON_WORD]) search.push([q, (await a.past(q)).hits.map((h) => [h.source, h.quote])]);
    const found: [string, unknown[][]][] = [];
    for (const args of [['--file', FILE], [COMMON_WORD], [QUERIES.greek]]) found.push([args.join(' '), ((await findPage(w, args)).hits as Line[]).map((h) => [h.handle, h.context])]);
    return { search, find: found };
  };
  const before = await snapshot(await w.codex('a'));
  expect(before.search[0]![1].map(([s]) => s), `before: deep_search "${ERR}" returns ${handleOf('E1', 'merr')}`).toContain(handleOf('E1', 'merr'));
  expect(before.search[2]![1].length, `before: deep_search "${COMMON_WORD}" returns several hits, so their order is tested`).toBeGreaterThan(1);
  let dropped: string[] = [];
  await w.restart(() => { dropped = dropIndex(w.root); });
  expect(dropped, 'ledger.db holds the index as tables named archive_* (README: Readings), dropped with the hub stopped').not.toEqual([]);
  const a = await w.codex('a');
  await until(`after the index was dropped, deep_search "${ERR}" never returned ${handleOf('E1', 'merr')}`, async () => (await a.past(ERR)).hits.some((h) => h.source === handleOf('E1', 'merr')));
  const after = await snapshot(a);
  for (const [i, [q, hits]] of before.search.entries()) expect(after.search[i]![1], `deep_search "${q}" after the rebuild returns the same hits in the same order`).toEqual(hits);
  for (const [i, [q, hits]] of before.find.entries()) expect(after.find[i]![1], `deep find ${q} after the rebuild returns the same hits in the same order`).toEqual(hits);
}, 900_000);
