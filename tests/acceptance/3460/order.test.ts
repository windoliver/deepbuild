// AC8 #3460.6ad8cdef With 25 wiki claims and one decision of yours all holding `billing`, the decision is the first
//                    hit of the first page. On the merge base it comes after all 25, and this test fails. The 25
//                    claims keep their order among themselves.
//
// The claims are learned by the shipped wiki in the order c01 to c25, each on the page notes/billing; the decision is
// saved from a choice ask whose question holds `billing`, as #884's suite saves its decisions. `deep_search` is called
// from a `deep mcp` bound to no session, page after page by `next`.

import { afterAll, expect, test } from 'vitest';
import { askData, startHub } from '../26/helpers.ts';
import { CORE, cleanup, handle, hookIn, makeWorld, sha256, ulid, unboundMcp, withRecord } from '../355/helpers.ts';
import { AC, everySource, learn, search, type Fact } from './helpers.ts';

afterAll(cleanup, 60_000);

const pad = (n: number): string => String(n).padStart(2, '0');
const CLAIMS: Fact[] = Array.from({ length: 25 }, (_, i) => ({ page: 'notes/billing', id: `c${pad(i + 1)}`, text: `Plan ${pad(i + 1)} billing runs on day ${i + 1} of the month` }));
const QUESTION = 'Move billing to monthly invoices?';
const PAGE = 20;

test(`AC8 ${AC[8]} with 25 wiki claims and one decision of yours all holding billing, the decision is the first hit of the first page, and the 25 claims keep their order`, async () => {
  const w = makeWorld();
  const decision = await withRecord(w, async (o) => {
    await learn(w, o, CLAIMS);
    const session = ulid(w.clock.tick());
    const at = w.clock.tick();
    await o.record.append(hookIn(session, 'shop'), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: w.elsewhere, branch: 'main', thread: session } });
    const core = { ...CORE, session, project: 'shop' };
    const t = w.clock.tick();
    const ask = ulid(t);
    await o.record.append(core, { v: 1, id: ask, kind: 'ask.created', ts: t, data: askData('choice', QUESTION, t) });
    const id = ulid(t + 1);
    await o.record.append(core, { v: 1, id, kind: 'decision.created', ts: t + 1, data: { key: sha256(QUESTION), scope: 'repo:shop', answer: 'files', ask: `ask:${ask}` } });
    return `decision:${id}`;
  });
  await startHub(w.home);
  const mcp = await unboundMcp(w);

  const all = await everySource(mcp, 'billing');
  const want = CLAIMS.map(handle);
  expect([...all].sort(), `deep_search "billing" returns the 25 claims and your decision ${decision}, each once, over its pages: ${JSON.stringify(all)}`).toEqual([...want, decision].sort());
  expect(all.filter((s) => s !== decision), 'the 25 claims keep their order among themselves, c01 to c25, as the merge base returns them').toEqual(want);
  const first = (await search(mcp, 'billing')).value;
  expect(first.hits.length, `the first page holds ${PAGE} hits, as today: ${first.hits.length}`).toBe(PAGE);
  const at = all.indexOf(decision);
  expect(String(first.hits[0]?.source), `your decision ${decision} ("${QUESTION}") is the first hit of the first page of deep_search "billing"; it is hit ${at + 1} of ${all.length}, after ${at} wiki claims, and the first page starts ${JSON.stringify(first.hits.slice(0, 3).map((h) => h.source))}`).toBe(decision);
  expect(first.hits.slice(1).map((h) => h.source), 'after your decision the first page holds the first 19 claims in their order').toEqual(want.slice(0, PAGE - 1));
}, 480_000);
