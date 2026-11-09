// AC9: what a session's row shows of its sandbox when its agent version's facts name none, or only the write wall
// (README: the row's `sandbox` field; the facts read through DEEP_HUB_TEST_FACTS).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AC, approve, mentions, mustStart, openWorld, REPO, standInIn, start, waitFor, wallObjects, withoutSandbox, writesOnly, type Line } from './helpers.ts';

async function rowOf(claudeFacts: (facts: Line) => Line, what: string): Promise<Line> {
  const w = await openWorld({ claudeFacts });
  await approve(w, { issues: [41], agents: ['claude-code'], atOnce: 1, planShare: 50 });
  const s = mustStart(await start(w, { issue: 41 }), `${AC[9]}: a start on ${what}`);
  const agent = await standInIn(w, s.worktree, { done: true });
  const row = await waitFor(async () => ((await w.client.call('sessions.read')).sessions as Line[]).find((r) => mentions(r, String(agent.session)) || mentions(r, s.run)), 30_000, `the row of session ${agent.session} in sessions.read`);
  expect(row.sandbox, `${AC[9]}: the row of a session started on ${what} says what its sandbox holds: ${JSON.stringify(row).slice(0, 1500)}`).toBeTruthy();
  return row.sandbox as Line;
}

test(`${AC[9]} a version whose facts name no sandbox starts, its row saying it has none; one with only the write wall shows the other two as not held`, async () => {
  const none = await rowOf(withoutSandbox, 'facts that name no sandbox');
  expect(none.sandboxed, `${AC[9]}: a session whose facts name no sandbox is never shown as sandboxed: ${JSON.stringify(none)}`).toBe(false);
  expect(none.walls, `${AC[9]}: and holds no wall`).toEqual({ writes: false, credentials: false, network: false });

  const shipped = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as Line;
  expect(wallObjects(shipped.sandbox).length, `${AC[9]}: the shipped Claude Code facts name the walls its sandbox holds, under \`sandbox\``).toBeGreaterThan(0);
  const writes = await rowOf(writesOnly, 'facts that name only the write wall');
  expect(writes.walls, `${AC[9]}: a session whose facts name only the write wall shows writes held and the other two not held: ${JSON.stringify(writes)}`).toEqual({ writes: true, credentials: false, network: false });
});
