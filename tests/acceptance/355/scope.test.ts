// AC8: In session B of repo `api`, a claim learned in session A of repo `web` at session scope never comes back
// from `deep_search`, and neither does a superseded or rolled-back claim; a planted index that returns them still
// has them dropped by the hub, and a hub that trusts the index fails, naming the claim.
//
// Every claim holds the word heron. Three are learned at install from your words in a session of api and one of web,
// so at scope all: one stays in force, one is superseded by a fourth, and one is rolled back (through the record's
// rollBack, as the learned layer rolls a change back). One is learned in session A of web at that session's scope.
// Session B is the agent stand-in's (tests/acceptance/26), working in the api repo with its session established
// through its hooks; it calls deep_search from its own deep mcp, so the call is bound to B.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent } from '../26/helpers.ts';
import {
  cleanup, handle, initialize, makeRepo, makeWorld, openWiki, seedSession, trustProject, wikiHits, withHub, withRecord, writePlantedIndex, YOU,
  type Candidate, type Line, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const TERM = 'heron';
const KEPT = { page: 'setup', id: 'heron-queue', text: 'The heron queue drains every night' };
const OLD = { page: 'setup', id: 'heron-branch-old', text: 'heron deploys run from the main branch' };
const NEW = { page: 'setup', id: 'heron-branch', text: 'heron deploys run from the release branch' };
const ROLLED = { page: 'setup', id: 'heron-cache', text: 'heron builds cache in the tmp folder' };
const SESSION_ONLY = { page: 'repos/web', id: 'heron-preview', text: 'heron web previews run on port 5173' };
const DROPPED = [SESSION_ONLY, OLD, ROLLED];
const why: Record<string, string> = {
  [handle(SESSION_ONLY)]: 'learned in session A of repo web at session scope',
  [handle(OLD)]: 'superseded',
  [handle(ROLLED)]: 'rolled back',
};

/** The world: claims written, the superseded one replaced and the rolled-back one rolled back, pages rewritten. */
async function world(): Promise<{ w: World; api: string }> {
  const w = makeWorld();
  const api = makeRepo(join(w.tmp, 'api'), [{ Procfile: 'api: node server.js --port 3001\n' }]);
  const web = makeRepo(join(w.tmp, 'web'), [{ 'package.json': '{ "name": "web" }\n' }]);
  await withRecord(w, async (o) => {
    await trustProject(w, o, api.dir);
    const said = (f: { text: string }) => `Remember this: ${f.text}.`;
    const msgs = [KEPT, OLD, NEW, ROLLED].map((f, i) => ({ id: `h${i + 1}`, from: 'you' as const, text: said(f) }));
    const X = await seedSession(w, o, 'api', api.dir, msgs);
    const A = await seedSession(w, o, 'web', web.dir, [...msgs, { id: 'preview', from: 'you', text: said(SESSION_ONLY) }]);
    const both = (f: { page: string; id: string; text: string }, i: number): Candidate => ({ ...f, scope: 'all', sources: [{ at: `session:${X}#h${i}`, quote: f.text }, { at: `session:${A}#h${i}`, quote: f.text }] });
    const wiki = await openWiki({ record: o.record, folder: w.wiki, now: w.clock.now });
    const first = await wiki.learn([both(KEPT, 1), both(OLD, 2), { ...SESSION_ONLY, scope: `session:${A}`, sources: [{ at: `session:${A}#preview`, quote: SESSION_ONLY.text }] }]);
    w.clock.tick(60_000);
    const second = await wiki.learn([{ ...both(NEW, 3), supersedes: handle(OLD) }]);
    const since = w.clock.tick(60_000);
    const third = await wiki.learn([both(ROLLED, 4)]);
    for (const c of [KEPT, OLD, SESSION_ONLY, NEW, ROLLED]) expect([...first.written, ...second.written, ...third.written], `the wiki writes ${handle(c)}`).toContain(handle(c));
    w.clock.tick(60_000);
    const rolled = await o.record.rollBack(YOU, { since });
    expect(rolled.length, `you roll back what was learned since ${new Date(since).toISOString()}: ${handle(ROLLED)}`).toBeGreaterThan(0);
    await wiki.write();
  });
  return { w, api: api.dir };
}

/** Session B, in repo api, searches for heron from its own deep mcp; the claims it must not see fail the test by name. */
async function searchInB(o: { index?: (w: World) => string; plant?: string } = {}): Promise<void> {
  const { w, api } = await world();
  const index = o.index?.(w);
  await withHub(w, { ...(index ? { index } : {}), ...(o.plant ? { plant: o.plant } : {}) }, async (hub) => {
    const agent = Agent.start(w.home, api, o.plant ? { DEEP_HUB_PLANT: o.plant } : {});
    const B = agent.session(api);
    await agent.establish(hub, B);
    await initialize(agent);
    const hits = await wikiHits(agent, TERM, `session B (${B.id}) of repo api`);
    const shown = hits.map((h) => String(h.source));
    for (const c of DROPPED) expect(shown, `session B's deep_search returned ${handle(c)}, ${why[handle(c)]}`).not.toContain(handle(c));
    expect(shown, `session B's deep_search finds ${handle(KEPT)}, in force at scope all: ${JSON.stringify(hits)}`).toContain(handle(KEPT));
    expect(shown, `session B's deep_search finds ${handle(NEW)}, which superseded ${handle(OLD)}`).toContain(handle(NEW));
  });
}

/** The planted index: whatever the hub rebuilds, it returns every heron claim, those it should have let go included. */
const keepsEverything = (w: World): string => writePlantedIndex(w, 'returns-dropped-claims',
  [KEPT, OLD, NEW, ROLLED, SESSION_ONLY].map((c): Line & { claim: string; page: string; quote: string; source: string } => ({ claim: c.id, page: c.page, quote: c.text, source: `planted:${c.id}` })));

describe('AC8 in session B of api, a session-scoped claim of session A of web, a superseded claim and a rolled-back claim never come back from deep_search', () => {
  it('AC8 on the default index, B finds the claims in force and none of the three', async () => {
    await searchInB();
  }, 240_000);

  it('AC8 a planted index that returns all three still has them dropped by the hub', async () => {
    await searchInB({ index: keepsEverything });
  }, 240_000);

  it('AC8 (wrong program) a hub that trusts the index returns them and fails, naming the claim', async () => {
    await expect(searchInB({ index: keepsEverything, plant: 'trusts-index' })).rejects.toThrow(/session B's deep_search returned wiki:(repos\/web#heron-preview|setup#heron-branch-old|setup#heron-cache)/);
  }, 240_000);
});
