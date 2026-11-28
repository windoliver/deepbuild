// AC6 #3460.deebb776 `deep find "port api"` over the same record prints one sentence saying it looked for the query as
//                    one run of characters, exits as today, and with `--json` prints empty `hits` and the note.
//                    `deep find port`, which finds the claim, prints what the merge base prints, byte for byte.
//
// The record is note.test.ts's (README: The fixture), read by `deep find` as the built CLI, run by you with `--root`
// and no hub running. What the merge base prints is written out below from the fixture, and was read off the base
// (BASE-FAILURE.txt): one line a hit, `<handle>  <context>`: the decision the claim rests on, then the claim on the
// wiki's own question page for its repo ("How does api start?", a view the shipped wiki writes), then the claim.

import { afterAll, expect, test } from 'vitest';
import { cleanup, handle, makeWorld, withRecord, type World } from '../355/helpers.ts';
import { AC, API, CACHE, find, learn, lookedForAsOneRun, nothingHolds } from './helpers.ts';

afterAll(cleanup, 60_000);

/** The claim as the wiki's standing question for its repo's page lists it. */
const VIEW = `wiki:questions/api/start#${API.id}`;

let fixture: Promise<{ w: World; source: string }> | undefined;
const setUp = (): Promise<{ w: World; source: string }> => (fixture ??= (async () => {
  const w = makeWorld();
  const sources = await withRecord(w, (o) => learn(w, o, [API, CACHE]));
  return { w, source: sources.get(handle(API))! };
})());

test(`AC6 ${AC[6]} deep find "port api" prints one sentence saying it looked for the query as one run of characters, exits as today, and with --json prints empty hits and the note`, async () => {
  const { w } = await setUp();
  const query = 'port api';
  const said = await find(w, [query]);
  expect(said.code, `deep find "${query}" exits 0, as today: ${said.stderr.slice(0, 800)}`).toBe(0);
  expect(said.stdout, `deep find "${query}" finds nothing ("port" and "api" are in ${handle(API)}, never as the one run "${query}") and prints one sentence saying it looked for the query as one run of characters`).toBe(`${lookedForAsOneRun(query)}\n`);
  const json = await find(w, [query, '--json']);
  expect(json.code, `deep find "${query}" --json exits 0, as today: ${json.stderr.slice(0, 800)}`).toBe(0);
  let value: unknown;
  try { value = JSON.parse(json.stdout); } catch { value = json.stdout; }
  expect(value, `deep find "${query}" --json prints empty hits and the same words as a note`).toEqual({ hits: [], note: lookedForAsOneRun(query) });
}, 240_000);

test(`AC6 ${AC[6]} deep find port, which finds the claim, prints what the merge base prints, byte for byte, and one word that finds nothing keeps today's sentence`, async () => {
  const { w, source } = await setUp();
  const found = await find(w, ['port']);
  expect(found.code, `deep find port exits 0: ${found.stderr.slice(0, 800)}`).toBe(0);
  const hits = [source, VIEW, handle(API)].map((h) => ({ handle: h, context: API.text }));
  expect(found.stdout, 'deep find port prints the merge base\'s bytes: the decision the claim rests on, the claim on the wiki\'s question page and the claim, each with its context').toBe(hits.map((h) => `${h.handle}  ${h.context}\n`).join(''));
  const json = await find(w, ['port', '--json']);
  expect(json.stdout, 'deep find port --json prints the merge base\'s bytes: its hits and no note').toBe(`${JSON.stringify({ hits })}\n`);
  // The sentence for two or more words is not one word's: a one-word query that finds nothing reads as today.
  const none = await find(w, ['ports']);
  expect([none.code, none.stdout], 'deep find ports finds nothing and prints today\'s sentence, byte for byte').toEqual([0, `${nothingHolds('ports')}\n`]);
}, 240_000);
