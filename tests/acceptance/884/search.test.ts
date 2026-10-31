// #884.2b9cea3f A wiki page holding "提示缓存失效时重新计费" is found by "缓存"; "缓存 billing" finds it only if the page
//               also holds "billing".
// #884.3f957841 "Größe" finds a decision holding "größe" and not one holding "grosse"; "café" finds "Café".
// #884.9b8cbcf7 A query of only punctuation returns no hits and says it had no words to search for.
//
// One fixture record (README: The fixture), searched through `deep_search` from a `deep mcp` bound to no session.
// The wiki claims are written by the shipped wiki (@deepbuild/wiki) into the hub's own ledger before the hub starts, so
// the hub searches them with its default index; the decisions are appended through @deepbuild/record as the core
// appends them. Nothing stands in for the hub, its index or deep_search.

import { afterAll, expect, test } from 'vitest';
import { askData, startHub } from '../26/helpers.ts';
import {
  callTool, CORE, cleanup, handle, hookIn, makeWorld, openWiki, seedDecision, sha256, ulid, unboundMcp, valueOf, withRecord,
  type Candidate, type Line, type Mcp,
} from '../355/helpers.ts';

afterAll(cleanup, 60_000);

/** The three wiki claims of criterion 1, each on a page of its own, each resting on a decision of yours that holds its text. */
const WIKI = {
  cache: { page: 'notes/cache', id: 'zh1', text: '提示缓存失效时重新计费' },
  cacheBilling: { page: 'notes/cache-billing', id: 'zh2', text: '提示缓存失效时重新计费 billing applies' },
  billing: { page: 'notes/billing', id: 'en1', text: 'Nightly billing applies to every invoice' },
} as const;
/** The questions of criterion 2's past decisions; "column" and "Lounge" are the ASCII words that prove each is searchable. */
const ASKED = {
  grosseUmlaut: 'Keep the größe column in the orders table?',
  grosseAscii: 'Keep the grosse column in the invoices table?',
  cafe: 'Rename the Café screen to Lounge?',
} as const;
const PUNCTUATION = '?! … — ,.;:() 「」';

interface Fixture { mcp: Mcp; decision: Record<keyof typeof ASKED, string> }
let fixture: Promise<Fixture> | undefined;
const setUp = (): Promise<Fixture> => (fixture ??= (async () => {
  const w = makeWorld();
  const decision = await withRecord(w, async (o) => {
    // Criterion 1: claims learned by the wiki from your decisions, at scope `all`, so a call bound to no session reads them.
    const candidates: Candidate[] = [];
    for (const c of Object.values(WIKI)) {
      const source = await seedDecision(w, o, c.text, 'all');
      candidates.push({ page: c.page, id: c.id, text: c.text, scope: 'all', sources: [{ at: source, quote: c.text }] });
    }
    const wiki = await openWiki({ record: o.record, folder: w.wiki, now: w.clock.now });
    const learned = await wiki.learn(candidates);
    const want = candidates.map(handle);
    if (want.some((h) => !learned.written.includes(h))) throw Error(`BLOCKED: the wiki didn't write the fixture claims: ${JSON.stringify(learned)}`);

    // Criterion 2: past decisions of a session of the repo shop, each saved from a choice ask, found by its question.
    const session = ulid(w.clock.tick());
    const at = w.clock.tick();
    await o.record.append(hookIn(session, 'shop'), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: w.elsewhere, branch: 'main', thread: session } });
    const core = { ...CORE, session, project: 'shop' };
    const ids = {} as Record<keyof typeof ASKED, string>;
    for (const [name, question] of Object.entries(ASKED) as [keyof typeof ASKED, string][]) {
      const t = w.clock.tick();
      const ask = ulid(t);
      await o.record.append(core, { v: 1, id: ask, kind: 'ask.created', ts: t, data: askData('choice', question, t) });
      const id = ulid(t + 1);
      await o.record.append(core, { v: 1, id, kind: 'decision.created', ts: t + 1, data: { key: sha256(question), scope: 'repo:shop', answer: 'files', ask: `ask:${ask}` } });
      ids[name] = `decision:${id}`;
    }
    return ids;
  });
  await startHub(w.home);
  return { mcp: await unboundMcp(w), decision };
})());

async function hits(m: Mcp, query: string): Promise<Line[]> {
  const value = valueOf(await callTool(m, 'deep_search', { query }), `deep_search "${query}"`);
  expect(Array.isArray(value?.hits), `deep_search "${query}" answers with hits: ${JSON.stringify(value).slice(0, 1500)}`).toBe(true);
  return value.hits as Line[];
}
const sources = (found: Line[]): string[] => found.map((h) => String(h.source));

test('#884.2b9cea3f a Chinese wiki claim is found by a word inside it, and a mixed query needs every word', async () => {
  const { mcp } = await setUp();
  const [cache, cacheBilling, billing] = [handle(WIKI.cache), handle(WIKI.cacheBilling), handle(WIKI.billing)];
  // The twin: the default index holds the claims and finds them by an ASCII word, so missing one below is the query's doing.
  const ascii = sources(await hits(mcp, 'billing'));
  expect(ascii, `"billing" finds ${cacheBilling} and ${billing} through the default index: ${JSON.stringify(ascii)}`).toEqual(expect.arrayContaining([cacheBilling, billing]));

  const byWord = sources(await hits(mcp, '缓存'));
  expect(byWord, `"缓存" finds the page holding "${WIKI.cache.text}" (${cache}) through the default index; it found: ${JSON.stringify(byWord)}`).toContain(cache);
  expect(byWord, `"缓存" finds the page holding "${WIKI.cacheBilling.text}" (${cacheBilling})`).toContain(cacheBilling);
  expect(byWord, `"缓存" doesn't find the page without it (${billing})`).not.toContain(billing);

  const mixed = sources(await hits(mcp, '缓存 billing'));
  expect(mixed, `"缓存 billing" finds the page holding both (${cacheBilling}); it found: ${JSON.stringify(mixed)}`).toContain(cacheBilling);
  expect(mixed, `"缓存 billing" doesn't find the page holding "缓存" but not "billing" (${cache})`).not.toContain(cache);
  expect(mixed, `"缓存 billing" doesn't find the page holding "billing" but not "缓存" (${billing}): "缓存" must not vanish from the query`).not.toContain(billing);
}, 180_000);

test('#884.3f957841 "Größe" finds the decision holding "größe" and not the one holding "grosse"', async () => {
  const { mcp, decision } = await setUp();
  // The twin: both decisions are searchable by an ASCII word they share, so leaving one out below is the query's doing.
  const shared = sources(await hits(mcp, 'column'));
  expect(shared, `"column" finds both decisions: ${JSON.stringify(shared)}`).toEqual(expect.arrayContaining([decision.grosseUmlaut, decision.grosseAscii]));

  const found = await hits(mcp, 'Größe');
  expect(sources(found), `"Größe" finds the decision on "${ASKED.grosseUmlaut}" (${decision.grosseUmlaut}): ${JSON.stringify(found).slice(0, 1500)}`).toContain(decision.grosseUmlaut);
  expect(sources(found), `"Größe" doesn't find the decision on "${ASKED.grosseAscii}" (${decision.grosseAscii})`).not.toContain(decision.grosseAscii);
  expect(JSON.stringify(found), '"Größe" returns nothing holding "grosse"').not.toMatch(/grosse/i);
}, 180_000);

test('#884.3f957841 "café" finds the decision holding "Café"', async () => {
  const { mcp, decision } = await setUp();
  const twin = sources(await hits(mcp, 'Lounge'));
  expect(twin, `"Lounge" finds the decision on "${ASKED.cafe}": ${JSON.stringify(twin)}`).toContain(decision.cafe);
  const found = sources(await hits(mcp, 'café'));
  expect(found, `"café" finds the decision on "${ASKED.cafe}" (${decision.cafe}): ${JSON.stringify(found)}`).toContain(decision.cafe);
}, 180_000);

test('#884.9b8cbcf7 a query of only punctuation returns no hits and says it had no words to search for', async () => {
  const { mcp } = await setUp();
  const out = await callTool(mcp, 'deep_search', { query: PUNCTUATION });
  expect(out.protocolError, `deep_search "${PUNCTUATION}" answers as a tool, not with a JSON-RPC error: ${JSON.stringify(out.reply).slice(0, 1500)}`).toBe(false);
  const found = (out.value?.hits ?? []) as unknown;
  expect(found, `deep_search "${PUNCTUATION}" returns no hits over a record full of them`).toEqual([]);
  // Anywhere in the reply: its value or any text block (README: the wording is this job's invention).
  const said = JSON.stringify(out.reply.result ?? {});
  expect(said, `deep_search "${PUNCTUATION}" says it had no words to search for: ${said.slice(0, 1500)}`).toMatch(/\bno\b(\s+\S+){0,2}\s+words?\b/i);
}, 180_000);
