// #3460: an empty deep_search reply says why. One fixture record (README: The fixture): a wiki whose one claim about
// ports is "`api` starts on port 3000" and whose one claim holding redis is "The cache is redis 7", written by the
// shipped wiki into the hub's own ledger before the hub starts, then searched through `deep_search` from a `deep mcp`
// bound to no session, on the hub's default index.
//
// AC1 #3460.67d53f5f `api ports` returns no hit and a note that names `ports` and not `api`.
// AC2 #3460.74f4978c `port redis` returns no hit and a note saying no one source holds every word, naming no word.
// AC4 #3460.fd277010 A query of 40 words that no source holds: the note names its first 16 and says 24 were left unread.
// AC5 #3460.c0d74b68 A query with no word still gets today's note, word for word, and a query with hits gets no note.

import { afterAll, expect, test } from 'vitest';
import { startHub } from '../26/helpers.ts';
import { cleanup, handle, makeWorld, unboundMcp, withRecord, type Mcp } from '../355/helpers.ts';
import { AC, API, CACHE, learn, namedIn, NO_ONE_SOURCE, NO_WORDS, noSourceHolds, READ, search } from './helpers.ts';

afterAll(cleanup, 60_000);

let fixture: Promise<Mcp> | undefined;
const setUp = (): Promise<Mcp> => (fixture ??= (async () => {
  const w = makeWorld();
  await withRecord(w, (o) => learn(w, o, [API, CACHE]));
  await startHub(w.home);
  return unboundMcp(w);
})());
const shown = (value: unknown): string => JSON.stringify(value).slice(0, 1500);
/** The twin of every empty reply below: the claim is in the index and one of its words finds it. */
async function finds(mcp: Mcp, query: string, claim: string): Promise<void> {
  const { value } = await search(mcp, query);
  expect(value.hits.map((h) => h.source), `deep_search "${query}" finds ${claim} through the default index, so an empty reply below is the query's doing: ${shown(value)}`).toContain(claim);
}

test(`AC1 ${AC[1]} deep_search for "api ports" over the one claim about ports returns no hit and a note that names ports and not api`, async () => {
  const mcp = await setUp();
  await finds(mcp, 'api port', handle(API));
  const query = 'api ports';
  const { value } = await search(mcp, query);
  expect(value.hits, `deep_search "${query}" returns no hit: no claim holds "ports" as a word`).toEqual([]);
  expect(typeof value.note, `deep_search "${query}" returns no hit and says nothing of why: its reply ${shown(value)} carries no note`).toBe('string');
  expect(namedIn(value.note), `deep_search "${query}": the note names "ports", which no source holds: ${shown(value.note)}`).toContain('ports');
  expect(namedIn(value.note), `deep_search "${query}": the note names "api" as held by nothing, though ${handle(API)} ("${API.text}") holds it: ${shown(value.note)}`).not.toContain('api');
  expect(value.note, `deep_search "${query}": the note, word for word`).toBe(noSourceHolds(['ports']));
}, 240_000);

test(`AC2 ${AC[2]} deep_search for "port redis", each held by its own claim, returns no hit and a note saying no one source holds every word, naming no word`, async () => {
  const mcp = await setUp();
  await finds(mcp, 'port', handle(API));
  await finds(mcp, 'redis', handle(CACHE));
  const query = 'port redis';
  const { value } = await search(mcp, query);
  expect(value.hits, `deep_search "${query}" returns no hit: no one claim holds both words`).toEqual([]);
  expect(typeof value.note, `deep_search "${query}" returns no hit and says nothing of why: its reply ${shown(value)} carries no note`).toBe('string');
  for (const [word, holder] of [['port', API], ['redis', CACHE]] as const) {
    expect(namedIn(value.note), `deep_search "${query}": the note names "${word}" as missing, though ${handle(holder)} ("${holder.text}") holds it: ${shown(value.note)}`).not.toContain(word);
  }
  expect(value.note, `deep_search "${query}": the note says no one source holds every word, word for word`).toBe(NO_ONE_SOURCE);
}, 240_000);

/** Forty words no source holds, each a word of letters, in a fixed order. */
const FORTY = Array.from({ length: 40 }, (_, i) => `zq${'abcdefghij'[Math.floor(i / 10)]}${'klmnopqrst'[i % 10]}unheld`);
/** The smallest cap any client is held to (#2896): a fifth under Codex's 10,000 tokens, and a token is at least a character. */
const SMALLEST_CAP = 8_000;

test(`AC4 ${AC[4]} a query of 40 words that no source holds gets a note naming its first 16 and saying 24 were left unread, under its client's cap`, async () => {
  const mcp = await setUp();
  await finds(mcp, 'port', handle(API));
  const query = FORTY.join(' ');
  const { value, result } = await search(mcp, query);
  expect(value.hits, 'deep_search for 40 words no source holds returns no hit').toEqual([]);
  expect(typeof value.note, `deep_search for 40 words no source holds returns no hit and says nothing of why: its reply ${shown(value)} carries no note`).toBe('string');
  expect(namedIn(value.note), `the note names the query's first ${READ} words, in the query's order, and no other: ${shown(value.note)}`).toEqual(FORTY.slice(0, READ));
  expect(String(value.note), `the note says 24 words were left unread: ${shown(value.note)}`).toMatch(/\b24\b/);
  expect(value.note, 'the note, word for word').toBe(noSourceHolds(FORTY.slice(0, READ), 40 - READ));
  const size = JSON.stringify(result).length;
  expect(size, `the reply, ${size} characters as its client receives it, stays under the smallest cap a client is held to, ${SMALLEST_CAP} tokens`).toBeLessThanOrEqual(SMALLEST_CAP);
}, 240_000);

test(`AC5 ${AC[5]} a query with no word still gets today's note, word for word, and a query with hits gets no note`, async () => {
  const mcp = await setUp();
  const none = '?! … — ,.;:()';
  const empty = (await search(mcp, none)).value;
  expect(empty.hits, `deep_search "${none}" returns no hit`).toEqual([]);
  expect(empty.note, `deep_search "${none}", a query with no word, gets today's note word for word`).toBe(NO_WORDS);
  for (const query of ['api port', 'redis']) {
    const { value } = await search(mcp, query);
    expect(value.hits.length, `deep_search "${query}" finds a hit: ${shown(value)}`).toBeGreaterThan(0);
    expect('note' in value, `deep_search "${query}" has hits, so its reply carries no note: ${shown(value)}`).toBe(false);
  }
}, 240_000);
