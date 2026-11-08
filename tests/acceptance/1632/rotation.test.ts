// #1632.62d3152b A fixture Claude Code process starts session A, and its `deep mcp` binds to A. The fixture sends
//   SessionEnd `clear` for A, then a SessionStart `clear` for B from the same process. The next `deep_claim`, stamped
//   by B's PreToolUse, is recorded under B. The merge base refuses it with `unbound`, naming A.
// #1632.be55c5e4 A read-only call such as `deep_search` after the clear goes on as it does today.
// The process is fixtures/agent.mjs: its hooks are the real deep-hook and its one deep mcp is its child, kept across
// the clear, as Claude Code keeps its MCP servers.

import { afterEach, expect, test } from 'vitest';
import { claimArgs, claimsFor, cleanup, clear, deep, eventMatching, events, seedPastAsk, sleep, valueOf, word, world } from './helpers.ts';

afterEach(cleanup, 30_000);

test('#1632.62d3152b after /clear, a deep_claim stamped by the new session\'s PreToolUse is recorded under the new session, not refused naming the old', async () => {
  const w = await world();
  const { agent, hub, a } = w;
  const before = claimArgs();
  valueOf(await agent.call('deep_claim', before), `deep_claim while session A ${a.id} runs`);
  const first = await eventMatching(hub, (e) => e.kind === 'claim.made' && e.data?.task_ref === before.task_ref);
  expect(first?.session, `before the clear the deep mcp acts for A ${a.id}`).toBe(a.id);

  const { b } = await clear(w, a);
  // Each later call binds by its own stamp: two in a row, each after the PreToolUse Claude Code fires for it.
  const later = [claimArgs(), claimArgs()];
  for (const [i, args] of later.entries()) {
    await agent.stamp(b, 'deep_claim', args);
    valueOf(await agent.call('deep_claim', args), `deep_claim #${i + 1} after /clear, stamped by B ${b.id}'s PreToolUse (A ${a.id} ended with reason clear)`);
  }
  await sleep(500);
  const all = await events(hub);
  for (const [i, args] of later.entries()) {
    expect(claimsFor(all, args.task_ref).map((e) => e.session), `deep_claim #${i + 1} after the clear is recorded once, under B ${b.id} (A was ${a.id})`).toEqual([b.id]);
  }
}, 180_000);

test('#1632.be55c5e4 deep_search after /clear goes on as before it: it still finds a past decision, stamped or not', async () => {
  const tag = word();
  const question = `Keep the ${tag} store on SQLite or plain files?`;
  let past = '';
  const w = await world({ seeded: async (home, worktree) => { past = await seedPastAsk(home, worktree, question); } });
  const { agent, hub, home, a } = w;
  const answered = await deep(home, ['inbox', 'answer', past, 'files']);
  if (answered.code !== 0) throw Error(`BLOCKED: deep inbox answer ${past} files exited ${answered.code}: ${answered.stdout}${answered.stderr}`);
  const decision = await eventMatching(hub, (e) => e.kind === 'decision.created' && e.data?.ask === past);
  if (!decision) throw Error(`BLOCKED: no decision.created for ${past} after you answered it`);
  const cite = `decision:${decision.id}`;
  const sources = (value: any): string[] => (Array.isArray(value?.hits) ? value.hits : []).map((h: any) => String(h?.source));

  const beforeClear = sources(valueOf(await agent.call('deep_search', { query: question }), `deep_search while A ${a.id} runs`));
  expect(beforeClear, `before the clear, deep_search finds the past decision ${cite}`).toContain(cite);

  const { b } = await clear(w, a);
  const unstamped = sources(valueOf(await agent.call('deep_search', { query: question }), `deep_search after /clear (A ${a.id} ended, B ${b.id} started), with no PreToolUse for it`));
  expect(unstamped, `after the clear, an unstamped deep_search still finds ${cite}`).toContain(cite);
  const args = { query: question };
  await agent.stamp(b, 'deep_search', args);
  const stamped = sources(valueOf(await agent.call('deep_search', args), `deep_search after /clear, stamped by B ${b.id}'s PreToolUse`));
  expect(stamped, `after the clear, a deep_search stamped by B still finds ${cite}`).toContain(cite);
}, 180_000);
