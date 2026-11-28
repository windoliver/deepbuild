// AC7 #3460.7cd4a1ff The reading runs on the fixture with no model and no network. For each search and each of the
//                    three forms it prints the queries found over the queries asked, and each query not found with
//                    the claim it is tied to. Run twice on one commit, it prints the same bytes. A reading that
//                    counts a reply holding any hit as found, whichever claim it holds, fails, naming the query.
//
// The fixture is fixtures/reading.json: six wiki claims and eighteen queries, each tied to the claim that answers it,
// six in each form: the claim's own words as a list (`words`), one word in another form (`form`) and a question
// (`question`). The reading is `node scripts/search-reading.mjs <fixture>` (README: What the implementer builds).
// What it must print is not written here: the test asks the two searches itself, `deep_search` through a `deep mcp`
// bound to no session and `deep find` as the built CLI, over the same claims learned by the shipped wiki, and a
// query counts as found only when the reply holds the claim it is tied to. Two queries are traps: their replies hold
// a hit, of another claim.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'vitest';
import { childEnv, NODE, REPO, run, startHub } from '../26/helpers.ts';
import { cleanup, makeWorld, unboundMcp, withRecord } from '../355/helpers.ts';
import { AC, everySource, find, learn, type Fact } from './helpers.ts';

afterAll(cleanup, 60_000);

const FIXTURE = fileURLToPath(new URL('./fixtures/reading.json', import.meta.url));
const SEARCHES = ['deep_search', 'deep find'] as const;
const FORMS = ['words', 'form', 'question'] as const;
interface Query { form: (typeof FORMS)[number]; query: string; claim: string }
/** A query's length: its words, by deep_search's word rule (runs of letters and digits). */
const length = (query: string): number => query.normalize('NFC').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean).length;

/** The reading's output for what each search found (README: the reading's lines). */
function lines(asked: readonly Query[], found: (search: string, q: Query) => boolean): string {
  const out: string[] = [];
  for (const search of SEARCHES) for (const form of FORMS) {
    const of = asked.filter((q) => q.form === form);
    const by = [...new Set(of.map((q) => length(q.query)))].sort((a, b) => a - b)
      .map((n) => `${n}: ${of.filter((q) => length(q.query) === n && found(search, q)).length} of ${of.filter((q) => length(q.query) === n).length}`);
    out.push(`${search}, ${form}: ${of.filter((q) => found(search, q)).length} of ${of.length} found; by words in the query, ${by.join(', ')}`);
    for (const q of of.filter((x) => !found(search, x))) out.push(`  not found: ${JSON.stringify(q.query)}, tied to ${q.claim}`);
  }
  return `${out.join('\n')}\n`;
}

test(`AC7 ${AC[7]} the reading prints, for each search and each form, the queries found over the queries asked and each query not found with its claim, the same bytes twice, and never counts another claim's hit as found`, async () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { claims: Fact[]; queries: Query[] };
  // What each search returns for each query, asked by the test itself over the same claims.
  const w = makeWorld();
  await withRecord(w, (o) => learn(w, o, fixture.claims));
  await startHub(w.home);
  const mcp = await unboundMcp(w);
  const replies = new Map<string, string[]>();
  for (const q of fixture.queries) {
    replies.set(`deep_search\n${q.query}`, await everySource(mcp, q.query));
    const r = await find(w, [q.query, '--json']);
    if (r.code !== 0) throw Error(`BLOCKED: deep find ${JSON.stringify(q.query)} --json exited ${r.code}: ${r.stderr.slice(0, 800)}`);
    replies.set(`deep find\n${q.query}`, ((JSON.parse(r.stdout) as { hits: { handle: string }[] }).hits).map((h) => h.handle));
  }
  const reply = (search: string, q: Query): string[] => replies.get(`${search}\n${q.query}`)!;
  const found = (search: string, q: Query): boolean => reply(search, q).includes(q.claim);
  const traps = (search: string): Query[] => fixture.queries.filter((q) => !found(search, q) && reply(search, q).length > 0);
  for (const search of SEARCHES) {
    expect(traps(search).map((q) => q.query), `the fixture holds a query whose ${search} reply holds a hit, of another claim than its own`).not.toEqual([]);
    expect(fixture.queries.filter((q) => found(search, q)).map((q) => q.query), `the fixture holds a query ${search} finds its claim by`).not.toEqual([]);
  }

  const command = `node scripts/search-reading.mjs ${FIXTURE.slice(REPO.length)}`;
  const once = (): ReturnType<typeof run> => run(NODE, ['scripts/search-reading.mjs', FIXTURE], { cwd: REPO, env: childEnv(w.home), timeoutMs: 300_000 });
  const first = await once();
  expect(first.code, `${command} exits 0, a reading with no threshold; it exited ${first.code}: ${first.stderr.slice(0, 600)}`).toBe(0);
  for (const search of SEARCHES) for (const q of traps(search)) {
    const line = `  not found: ${JSON.stringify(q.query)}, tied to ${q.claim}`;
    const under = first.stdout.split(`${search}, ${q.form}: `)[1]?.split(/^(?! {2}not found: )/m)[0] ?? '';
    expect(under.split('\n'), `the reading counts ${JSON.stringify(q.query)} as found by ${search}: its reply holds ${JSON.stringify(reply(search, q))} and not ${q.claim}, the claim it is tied to, so the reading names it as not found under "${search}, ${q.form}"`).toContain(line.trimEnd());
  }
  expect(first.stdout, `${command} prints, for each search and each form, the queries found over the queries asked, by words in the query, and each query not found with the claim it is tied to`).toBe(lines(fixture.queries, found));
  const second = await once();
  expect([second.code, second.stdout], `${command}, run twice on one commit, prints the same bytes`).toEqual([0, first.stdout]);
}, 900_000);
