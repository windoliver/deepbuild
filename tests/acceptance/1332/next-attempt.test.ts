// AC3: a session killed mid-turn continues as a next attempt in the same worktree, its uncommitted files intact, and no
// issue ever has two live attempts, across a hub restart too.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { MIN, named, real, sleep, waitUntil, World } from './helpers.ts';

const ISSUE = 100;
const SCOPE = 'work through #100 with Claude Code, one at a time';

test(named(3), async () => {
  // The first attempt writes notes it never commits and hangs inside a call; the next one waits for the test's go.
  const w = await World.open({ issues: [{}], plan: { [ISSUE]: { launches: ['hang', 'gated'] } } });
  w.watchLive();
  const asked = await w.run(SCOPE);
  expect(asked.code, `deep work "${SCOPE}" raises the run's one approval and exits 0: exit ${asked.code}, ${asked.stderr.slice(-600)}`).toBe(0);
  await w.approve(asked);

  const first = await waitUntil(() => w.on(ISSUE).find((l) => l.hanging), 15 * MIN, 1000);
  expect(first, `the run starts #${ISSUE}'s first attempt, which is mid-turn`).toBeDefined();
  const notes = join(first!.cwd, `notes-${ISSUE}.txt`);
  expect(existsSync(notes) && readFileSync(notes, 'utf8'), 'its uncommitted notes are in its worktree').toBe(first!.notes);
  w.kill(first!);

  const next = await waitUntil(() => w.on(ISSUE).find((l) => l.launch === 2), 10 * MIN, 1000);
  expect(next, `a session killed mid-turn continues as a next attempt on #${ISSUE}`).toBeDefined();
  expect(real(next!.cwd), 'the next attempt runs in the same worktree').toBe(real(first!.cwd));
  expect(next!.found.notes[`notes-${ISSUE}.txt`], 'with its uncommitted files intact').toBe(first!.notes);
  expect(next!.started, 'it started after the killed one was gone').toBeGreaterThan(first!.hanging!);

  // The hub restarts while the next attempt is live and mid-turn; the sampler watches for a second live one throughout.
  await waitUntil(() => w.on(ISSUE).find((l) => l.pid === next!.pid && l.steps.some((s) => s.what === 'turn')), 2 * MIN, 500);
  await w.restartHub();
  await sleep(45_000);
  w.go(ISSUE);
  await waitUntil(() => w.on(ISSUE).find((l) => l.stopAt && l.launch >= 2), 10 * MIN, 1000);
  await sleep(30_000);
  const seen = w.on(ISSUE).map((l) => `attempt ${l.launch}: ${l.agent} pid ${l.pid} from ${new Date(l.started).toISOString()}${l.ended ? ` to ${new Date(l.ended).toISOString()}` : ''}`);
  expect(w.maxLive.get(ISSUE) ?? 0, `#${ISSUE} never has two live attempts, across the hub's restart too: ${seen.join('; ')}`).toBeLessThanOrEqual(1);
}, 60 * MIN);
