// The Scope's lines no criterion covers (README: Scope the criteria don't cover). Neither test carries a criterion's
// ID, so neither proves one.
// - "`session`, `gates` and `claims` stay as they are", and "no new parameter": a guard, which passes on the merge
//   base. The values are the issue's own, under What happens today: the first call of a session, and the call after
//   a claim with no run yet.
// - "The Building blocks row and the tool's description say what it answers": the description `deep mcp` lists for
//   `deep_status`, and the rows of the design's Building blocks table that name it, each name the three things the
//   issue adds, in the design's own nouns: checks, asks and open items. On the merge base neither names asks or
//   open items.

import { afterEach, expect, test } from 'vitest';
import { buildingBlocks, callTool, claimArgs, cleanup, listTools, rowsNaming, valueOf } from '../26/helpers.ts';
import { oneSession, shown, status } from './helpers.ts';

afterEach(cleanup, 30_000);

test('#2197.scope session, gates and claims stay as they are, on a session\'s first call and after a claim with no run yet, and deep_status takes no parameter', async () => {
  const w = await oneSession();
  const tool = (await listTools(w.agent)).find((t) => t.name === 'deep_status');
  expect(tool, 'deep mcp lists deep_status').toBeDefined();
  expect(Object.keys((tool!.inputSchema.properties ?? {}) as object), 'deep_status takes no parameter').toEqual([]);

  const first = await status(w.agent);
  expect({ session: first.session, gates: first.gates, claims: first.claims }, `the first call of a session answers its session, the gates and no claims, as today: ${shown(first)}`)
    .toEqual({ session: w.session.id, gates: { watch_only: false, reason: null }, claims: [] });

  const args = claimArgs({ commit: w.wt.commit });
  const claimed = valueOf(await callTool(w.agent, 'deep_claim', args), 'deep_claim');
  const second = await status(w.agent);
  expect({ session: second.session, gates: second.gates, claims: second.claims }, `the call after a claim with no run yet answers that claim as today: ${shown(second)}`).toEqual({
    session: w.session.id, gates: { watch_only: false, reason: null },
    claims: [{ claim: claimed.claim, task_ref: args.task_ref, commit: args.commit, runs: [], verdict: null, contradictions: [] }],
  });
}, 120_000);

/** Which of the three things deep_status now answers a text doesn't name, in the design's nouns. */
const NOUNS: readonly [string, RegExp][] = [['checks', /\bchecks?\b/i], ['asks', /\basks?\b/i], ['open items', /\bopen items?\b/i]];
const unnamed = (text: string): string[] => NOUNS.flatMap(([what, word]) => (word.test(text) ? [] : [what]));

test('#2197.scope deep_status\'s description, and the Building blocks rows that name it, say what it answers: the checks, the open asks and the open items', async () => {
  const w = await oneSession();
  const description = (await listTools(w.agent)).find((t) => t.name === 'deep_status')?.description ?? '';
  const rows = rowsNaming(buildingBlocks(), 'deep_status');
  expect(rows.length, 'BLOCKED unless a row of the Building blocks table names deep_status').toBeGreaterThan(0);
  expect(unnamed(description), `deep_status's description names what it answers: "${description}"`).toEqual([]);
  const cells = rows.map((r) => `${r.block}: ${r.mcp}`).join(' | ');
  expect(unnamed(cells), `the Building blocks rows that name deep_status say what it answers: "${cells}"`).toEqual([]);
}, 120_000);
