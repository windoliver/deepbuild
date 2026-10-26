// AC1, AC3, AC7 and Proof, over one corpus world: the wiki writes its pages from the fixture claims
// (fixtures/corpus.json), then two hubs run on the same home, one after the other, each searched by a deep mcp
// bound to no session: the first with the default index, the second with a second index (the conformance
// package's reference index@1 fill, through DEEP_HUB_TEST_INDEX), which the hub rebuilds from the pages.
//
// AC1   Every line in the wiki resolves to its source and quote, and a claim whose quote is missing is never written.
// AC3   Over the 20 fixture queries, a second index rebuilt from the pages returns the same set of pages and quotes
//       per query as the default, and a link with `?token=` is stored without its query and never fetched.
// AC7   Each claim shows how many sources agree.
// Proof Pages written from fixture claims, a deep_search hit with its source, and a second index rebuilt from the
//       pages giving the same hit.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  claimLines, cleanup, countingServer, filesUnder, handle, lineOf, makeRepo, makeWorld, openWiki, pageFiles, pageOfHit, quoteProblem, seedDecision,
  seedSession, stripQueries, trustProject, unboundMcp, wikiHits, withHub, withRecord, writeSecondIndex, type Candidate, type Learned, type Line, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);

interface Fixture { page: string; id: string; text: string }
const corpus = JSON.parse(readFileSync(new URL('./fixtures/corpus.json', import.meta.url), 'utf8')) as {
  you: Fixture[]; special: Record<string, Fixture & { quote?: string; answer?: string; said?: string }>; queries: string[];
};
const S = corpus.special;

interface Written { w: World; learned: Learned; kept: Candidate[]; dropped: Candidate[]; link: string; requests: () => string[] }
let writing: Promise<Written> | undefined;
/** The corpus world, its sessions and decision seeded through the record, and the pages the wiki writes from the fixture claims. */
function written(): Promise<Written> {
  return (writing ??= (async () => {
    const w = makeWorld();
    const server = await countingServer();
    const link = `http://127.0.0.1:${server.port}/setup?token=opensesame&from=wiki`;
    const api = makeRepo(join(w.tmp, 'api'), [
      { Procfile: 'api: node server.js --port 3001\n', 'docs/notes.md': '# Notes\n\nNothing here yet.\n' },
      { 'docs/notes.md': '# Notes\n\nApi quokka jobs run hourly\n' },
    ]);
    const web = makeRepo(join(w.tmp, 'web'), [{ 'package.json': '{ "name": "web" }\n' }]);
    return withRecord(w, async (o) => {
      await trustProject(w, o, api.dir);
      const remember = (f: Fixture) => `Remember this: ${f.text}. Thanks.`;
      const youMsgs = corpus.you.map((f, i) => ({ id: `c${i + 1}`, from: 'you' as const, text: remember(f) }));
      const X = await seedSession(w, o, 'api', api.dir, [
        ...youMsgs,
        { id: 'link', from: 'you', text: `${S.link!.text.replace('{link}', link)} before you start.` },
        { id: 'p3', from: 'you', text: remember(S.proof3!) },
        { id: 'p1', from: 'you', text: remember(S.proof1!) },
        { id: 'drop', from: 'you', text: `Remember this: ${S.dropMessage!.said}.` },
      ]);
      const W = await seedSession(w, o, 'web', web.dir, [...youMsgs, { id: 'p3', from: 'you', text: remember(S.proof3!) }]);
      const W2 = await seedSession(w, o, 'web', web.dir, [{ id: 'p3', from: 'you', text: `Again: ${S.proof3!.text}.` }]);
      const decision = await seedDecision(w, o, S.decision!.answer!, 'all');
      const at = (session: string, message: string, quote: string) => ({ at: `session:${session}#${message}`, quote });
      const kept: Candidate[] = [
        ...corpus.you.map((f, i) => ({ page: f.page, id: f.id, text: f.text, scope: 'all', sources: [at(X, `c${i + 1}`, f.text), at(W, `c${i + 1}`, f.text)] })),
        { ...S.procfile!, scope: 'repo:api', sources: [{ repo: api.dir, path: 'Procfile', commit: api.commits[0]!, quote: S.procfile!.quote! }] },
        { ...S.decision!, scope: 'all', sources: [{ at: decision, quote: S.decision!.text }] },
        { ...S.link!, text: S.link!.text.replace('{link}', link), scope: 'repo:api', sources: [at(X, 'link', S.link!.text.replace('{link}', link))] },
        { ...S.proof3!, scope: 'all', sources: [at(X, 'p3', S.proof3!.text), at(W, 'p3', S.proof3!.text), at(W2, 'p3', S.proof3!.text), at(X, 'p3', S.proof3!.text)] },
        { ...S.proof1!, scope: 'repo:api', sources: [at(X, 'p1', S.proof1!.text)] },
      ].map(({ page, id, text, scope, sources }) => ({ page, id, text, scope, sources }));
      const dropped: Candidate[] = [
        { page: S.dropMessage!.page, id: S.dropMessage!.id, text: S.dropMessage!.text, scope: 'repo:api', sources: [at(X, 'drop', S.dropMessage!.text)] },
        { page: S.dropCommit!.page, id: S.dropCommit!.id, text: S.dropCommit!.text, scope: 'repo:api', sources: [{ repo: api.dir, path: 'docs/notes.md', commit: api.commits[0]!, quote: S.dropCommit!.text }] },
      ];
      const wiki = await openWiki({ record: o.record, folder: w.wiki, now: w.clock.now });
      const learned = await wiki.learn([...kept.slice(0, 8), ...dropped, ...kept.slice(8)]);
      return { w, learned, kept, dropped, link, requests: server.requests };
    });
  })());
}

/** A wiki hit as the criterion compares them: its page and its quote. */
const pageAndQuote = (h: Line): string => `${pageOfHit(h)} | ${String(h.quote)}`;
interface Searched { byDefault: Map<string, Line[]>; bySecond: Map<string, Line[]> }
let searching: Promise<Searched> | undefined;
/** The 20 queries through deep_search, bound to no session: first on the default index, then on the second index. */
function searched(): Promise<Searched> {
  return (searching ??= (async () => {
    const { w } = await written();
    const run = (index?: string) => withHub(w, index ? { index } : {}, async () => {
      const m = await unboundMcp(w);
      const out = new Map<string, Line[]>();
      for (const q of corpus.queries) out.set(q, await wikiHits(m, q, index ? 'the hub on the second index' : 'the hub on the default index'));
      return out;
    });
    const byDefault = await run();
    const bySecond = await run(writeSecondIndex(w));
    return { byDefault, bySecond };
  })());
}

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const holdsAll = (text: string, query: string): boolean => { const have = new Set(words(text)); return words(query).every((q) => have.has(q)); };

describe('AC1 every line in the wiki resolves to its source and quote, and a claim whose quote is missing is never written', () => {
  it('AC1 every line of every page is a claim whose every source holds its quote; each written fixture claim is one line; the two whose quote is missing are dropped and appear nowhere', async () => {
    const { w, learned, kept, dropped } = await written();
    const pages = pageFiles(w);
    expect(pages.map((p) => p.page).sort(), 'the wiki wrote a page for each page the fixture claims name').toEqual(expect.arrayContaining(['repos/api', 'repos/web', 'setup', 'you']));
    for (const p of pages) {
      const nonBlank = p.lines.map((raw, i) => ({ raw, line: i + 1 })).filter((l) => l.raw.trim() !== '');
      const others = nonBlank.filter((l) => !l.raw.startsWith('#') && !claimLines(w).some((c) => c.file === p.file && c.line === l.line));
      // The one generated line that says what the page doesn't establish ends the page; every other line is a claim.
      const loose = others.filter((l) => l !== nonBlank[nonBlank.length - 1]);
      expect(loose.map((l) => `${p.page}.md:${l.line}: ${l.raw}`), `every line of ${p.page}.md but its headings and its closing line is a claim with its source`).toEqual([]);
    }
    for (const c of claimLines(w)) {
      const sources = Array.isArray(c.record.sources) ? (c.record.sources as Line[]) : [];
      expect(sources.length, `wiki:${c.page}#${String(c.record.id)} (${c.page}.md:${c.line}) names its sources`).toBeGreaterThan(0);
      for (const s of sources) expect(quoteProblem(w, s), `wiki:${c.page}#${String(c.record.id)} (${c.page}.md:${c.line}) resolves to its source and quote`).toBeUndefined();
    }
    for (const k of kept) {
      expect(learned.written, `the wiki wrote ${handle(k)}`).toContain(handle(k));
      expect(lineOf(w, handle(k)).text, `${handle(k)}'s line on its page`).toContain(stripQueries(k.text));
    }
    const [noQuote, wrongCommit] = dropped as [Candidate, Candidate];
    const reasons = new Map(learned.dropped.map((d) => [d.claim, d.reason]));
    expect(learned.written, 'a claim whose quote is missing is never written').not.toEqual(expect.arrayContaining([handle(noQuote)]));
    expect(learned.written, 'a claim whose quote is only in a later commit than the one it cites is never written').not.toEqual(expect.arrayContaining([handle(wrongCommit)]));
    expect(reasons.get(handle(noQuote)) ?? '', `${handle(noQuote)} is dropped, naming the message its quote isn't in`).toContain((noQuote.sources[0] as { at: string }).at);
    expect(reasons.get(handle(wrongCommit)) ?? '', `${handle(wrongCommit)} is dropped, naming the file at the commit its quote isn't in`).toContain('docs/notes.md');
    for (const marker of ['zanzibar', 'quokka']) {
      expect(filesUnder(w.wiki).filter((f) => f.text.toLowerCase().includes(marker)).map((f) => f.file), `the dropped claim's "${marker}" is on no page`).toEqual([]);
    }
  }, 120_000);
});

describe('AC7 each claim shows how many sources agree', () => {
  it('AC7 three agreeing sources (one cited twice) show 3, two show 2, one shows 1, on the page and in the deep_search hit', async () => {
    const { w } = await written();
    const count = (f: Fixture) => lineOf(w, handle(f)).record.proof;
    expect(count(S.proof3!), `${handle(S.proof3!)}: sources in api, web and web again (the api message cited twice)`).toBe(3);
    expect(count(corpus.you[9]!), `${handle(corpus.you[9]!)}: your words in a session of api and one of web`).toBe(2);
    expect(count(S.proof1!), `${handle(S.proof1!)}: one message`).toBe(1);
    const { byDefault } = await searched();
    const hit = (byDefault.get('prettier') ?? []).find((h) => h.source === handle(S.proof3!));
    expect(hit?.proof, `deep_search shows ${handle(S.proof3!)} with three agreeing sources: ${JSON.stringify(byDefault.get('prettier'))}`).toBe(3);
    const two = (byDefault.get('node engines') ?? []).find((h) => h.source === handle(corpus.you[9]!));
    expect(two?.proof, `deep_search shows ${handle(corpus.you[9]!)} with two: ${JSON.stringify(byDefault.get('node engines'))}`).toBe(2);
  }, 240_000);
});

describe('AC3 over the 20 fixture queries a second index rebuilt from the pages returns the same pages and quotes as the default; a link with ?token= is stored without its query and never fetched', () => {
  it('AC3 each of the 20 queries finds the same set of pages and quotes on the default index and on the second index rebuilt from the pages', async () => {
    const { kept } = await written();
    const { byDefault, bySecond } = await searched();
    expect(corpus.queries, 'twenty fixture queries').toHaveLength(20);
    for (const q of corpus.queries) {
      const expected = kept.filter((k) => holdsAll(stripQueries(k.text), q)).map((k) => `${k.page} | ${stripQueries(k.text)}`).sort();
      const fromDefault = (byDefault.get(q) ?? []).map(pageAndQuote).sort();
      const fromSecond = (bySecond.get(q) ?? []).map(pageAndQuote).sort();
      expect(fromDefault, `"${q}" on the default index: the written claims holding every word`).toEqual(expected);
      expect(fromSecond, `"${q}" on the second index, rebuilt from the pages, returns the default's pages and quotes`).toEqual(fromDefault);
    }
  }, 240_000);

  it('AC3 the link is kept without its query string on the page, the token is in no page and nowhere in the ledger, and nothing ever fetched it', async () => {
    const { w, link, requests } = await written();
    await searched();
    const bare = link.slice(0, link.indexOf('?'));
    const line = lineOf(w, handle(S.link!));
    expect(line.text, `${handle(S.link!)} keeps the link without its query`).toContain(bare);
    expect(line.text, `${handle(S.link!)}'s line has no query string`).not.toContain('?');
    expect(filesUnder(w.wiki).filter((f) => f.text.includes('opensesame') || f.text.includes('?token')).map((f) => f.file), 'the token is on no page and in no file of the wiki').toEqual([]);
    expect(filesUnder(w.root).filter((f) => /ledger\.db/.test(f.file) && f.text.includes('opensesame')).map((f) => f.file), 'the token is nowhere in the ledger: claims, sources, links and the index').toEqual([]);
    expect(requests(), `nothing fetched ${bare} (the writer, either hub, or deep_search)`).toEqual([]);
  }, 240_000);
});

describe('Proof pages written from fixture claims, a deep_search hit with its source, and a second index rebuilt from the pages giving the same hit', () => {
  it('Proof the decision\'s claim is a line on setup.md; deep_search finds it with its source; the second index rebuilt from the pages gives the same hit', async () => {
    const { w } = await written();
    const claim = handle(S.decision!);
    expect(lineOf(w, claim).text, `${claim} is written on its page`).toContain(S.decision!.text);
    const { byDefault, bySecond } = await searched();
    const hit = (byDefault.get('green run main') ?? []).find((h) => h.source === claim);
    expect(hit, `deep_search "green run main" on the default index finds ${claim}: ${JSON.stringify(byDefault.get('green run main'))}`).toBeDefined();
    const sources = Array.isArray(hit!.sources) ? (hit!.sources as Line[]) : [];
    expect(sources.length, `the hit for ${claim} carries its sources`).toBeGreaterThan(0);
    for (const s of sources) expect(quoteProblem(w, s), `the hit's source resolves to its quote`).toBeUndefined();
    const again = (bySecond.get('green run main') ?? []).find((h) => h.source === claim);
    expect(again && { source: again.source, quote: again.quote }, `the second index, rebuilt from the pages, gives the same hit: ${JSON.stringify(bySecond.get('green run main'))}`).toEqual({ source: hit!.source, quote: hit!.quote });
  }, 240_000);
});
