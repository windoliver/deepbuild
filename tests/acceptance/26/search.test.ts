// #26.943c5a8d A `deep_search` from a call bound to no session returns hits from a test `index@1` fill standing in
// for the wiki, from decisions and from the project's spec, and none from any session's transcript, claims, open
// items or verdicts; a hub that lets an unbound call read everything returns a session's open item and fails this
// test, naming it.
// One word, the term, is in all of them, each with a marker of its own, so a hit shows where it came from.

import { afterEach, expect, test } from 'vitest';
import { fixtures } from '../../../packages/contracts/src/index.ts';
import {
  agentWorld, callTool, claimArgs, cleanup, deep, eventMatching, initialize, McpProcess, ulid, valueOf, word, type Line,
} from './helpers.ts';

afterEach(cleanup, 30_000);

async function searchUnbound(plant?: string): Promise<void> {
  const term = word(10);
  const m = { wiki: word(), decision: word(), spec: word(), item: word(), verdict: word(), transcript: word() };
  let asked = '';
  const w = await agentWorld({
    plant,
    prompt: `fix the ${term} transcript${m.transcript} bug`,
    checks: [`smoke: { type: command, run: "echo ${term} spec${m.spec}" }`],
    wiki: [{ id: 'c1', page: 'repos/shop', source: 'wiki/repos/shop.md', text: `The shop deploy runs ${term} wiki${m.wiki} first.` }],
    seeded: async (s, session, worktree) => {
      await s.start('S0past', worktree);
      asked = await s.raise('S0past', 'choice', `Keep ${term} decision${m.decision} on SQLite or plain files?`);
      // A verdict on the session's claim, as the core records one.
      const verdict = structuredClone(fixtures('verdict.made@1')[0]) as Line;
      Object.assign(verdict.data, { reasons: [`${term} verdict${m.verdict} failed`], smallest: `${term} verdict${m.verdict}`, verdict: `verdict:${ulid()}` });
      await s.record.append({ writer: 'core', actor: 'you', scope: 'you', session: session.id }, { v: 1, id: ulid(s.now()), kind: 'verdict.made', ts: s.now(), data: verdict.data });
    },
  });
  const answered = await deep(w.home, ['inbox', 'answer', asked, 'files']);
  if (answered.code !== 0) throw Error(`BLOCKED: deep inbox answer ${asked} files exited ${answered.code}: ${answered.stdout}${answered.stderr}`);
  // The session's own open item and claim, through its own deep mcp.
  const itemText = `${term} openitem${m.item} is still open`;
  valueOf(await callTool(w.agent, 'deep_open_item', { text: itemText }), 'deep_open_item from the session');
  valueOf(await callTool(w.agent, 'deep_claim', claimArgs()), 'deep_claim from the session');
  await eventMatching(w.hub, (e) => e.kind === 'decision.created' && e.data?.ask === asked, 10_000);
  await eventMatching(w.hub, (e) => e.kind === 'open_item.opened' && String(e.data?.text).includes(`openitem${m.item}`), 10_000);

  // The twin: the session's own search reaches its open item, so leaving it out below is the binding's doing.
  const own = JSON.stringify(valueOf(await callTool(w.agent, 'deep_search', { query: term }), 'deep_search from the session itself'));
  expect(own, `the session's own deep_search finds its open item "${itemText}"`).toContain(`openitem${m.item}`);

  // A call bound to no session: a deep mcp started by hand in the worktree.
  const hand = McpProcess.start(w.home, w.wt.path, plant ? { DEEP_HUB_PLANT: plant } : {});
  await initialize(hand);
  const value = valueOf(await callTool(hand, 'deep_search', { query: term }), 'deep_search from a call bound to no session');
  const hits = (value?.hits ?? []) as Line[];
  const shown = JSON.stringify(hits);
  expect(shown, `an unbound deep_search returned session ${w.session.id}'s open item "${itemText}"`).not.toContain(`openitem${m.item}`);
  expect(shown, `an unbound deep_search returned a session's verdict (verdict${m.verdict})`).not.toContain(`verdict${m.verdict}`);
  expect(shown, `an unbound deep_search returned session ${w.session.id}'s transcript (transcript${m.transcript})`).not.toContain(`transcript${m.transcript}`);
  expect(hits.map((h) => String(h.source)).filter((s) => /^(claim|verdict|session):/.test(s)), 'an unbound deep_search cites no claim, verdict or session').toEqual([]);
  expect(Array.isArray(value?.hits) && hits.every((h) => typeof h.source === 'string' && h.source), `every hit names its source: ${shown.slice(0, 1500)}`).toBe(true);
  const from = (marker: string) => hits.filter((h) => JSON.stringify(h).includes(marker)).map((h) => String(h.source));
  expect(from(`wiki${m.wiki}`).some((s) => s.startsWith('wiki:')), `an unbound deep_search returns the index@1 fill's claim, cited as wiki:<page>#<claim>: ${shown.slice(0, 1500)}`).toBe(true);
  expect(from(`decision${m.decision}`).some((s) => s.startsWith('decision:')), `an unbound deep_search returns the past decision, cited as decision:<id>: ${shown.slice(0, 1500)}`).toBe(true);
  expect(from(`spec${m.spec}`).some((s) => s.includes('.deepbuild/done.yaml')), `an unbound deep_search returns the project's spec, citing .deepbuild/done.yaml: ${shown.slice(0, 1500)}`).toBe(true);
}

test('#26.943c5a8d an unbound deep_search returns the wiki, decisions and the spec, and nothing of a session\'s', async () => {
  await searchUnbound();
}, 120_000);

test('#26.943c5a8d (wrong program) a hub that lets an unbound call read everything returns a session\'s open item and fails, naming it', async () => {
  await expect(searchUnbound('unbound-reads-all')).rejects.toThrow(/open item ".* openitem\S+ is still open"/);
}, 120_000);
