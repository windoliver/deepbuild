// AC5: a workspace with four tasks, the first finished by a run and three still open: the second blocked by the first,
// the third by the second, the fourth by the second and the third. Moving the workspace to the fixture repo's checkout (`deep workspace move <id> <checkout>`) files each open task
// once as an issue on the played forge, with its blocked-by links between the issues it filed, and files nothing for
// the finished task.
import { expect, test } from 'vitest';
import { MIN, named, sleep, waitUntil, World, type Task } from './helpers.ts';

test(named(5), async () => {
  const w = await World.open({ topic: 'Shop launch', forge: 'played' });
  const entered = await w.enter([
    { title: 'Pick the shop name', criteria: ['The shop has a name'] },
    { title: 'Write the product pages', criteria: ['Each product has a page'], blockedBy: [0] },
    { title: 'Write the shipping policy', criteria: ['The shipping policy is written'], blockedBy: [1] },
    { title: 'Announce the launch', criteria: ['The launch is announced'], blockedBy: [1, 2] },
  ]);
  expect(entered.failures, 'each task enters the workspace with `deep workspace task`').toEqual([]);
  const [done, ...open] = entered.tasks as [Task, Task, Task, Task];
  const prepared = await w.prepare();
  expect(prepared.missing, 'each task is a record item').toEqual([]);

  // The first task finishes; the other three stay open.
  const scope = `work through #${done.n} with Claude Code, one at a time`;
  const asked = await w.run(scope);
  expect(asked.code, `deep work "${scope}" raises the run's one approval and exits 0: exit ${asked.code}, ${asked.stderr.slice(-600)}`).toBe(0);
  await w.approve(asked);
  await waitUntil(async () => (await w.finish(done.n)) !== undefined, 30 * MIN, 3000);
  expect(await w.unfinished([done]), `#${done.n} finishes before the move`).toEqual([]);
  await sleep(10_000);
  const forge = w.forge!;
  const before = forge.opened.length;

  const moved = await w.deep(['workspace', 'move', w.id, w.checkout!], w.tmp);
  expect(moved.code, `deep workspace move ${w.id} ${w.checkout}: exit ${moved.code}, ${moved.stdout.slice(-600)} ${moved.stderr.slice(-600)}`).toBe(0);
  await waitUntil(() => forge.opened.length - before >= open.length, 2 * MIN, 1000);
  // Any second filing, and links made after the issues, have time to arrive.
  await sleep(20_000);
  const filed = forge.opened.slice(before);
  expect(filed.map((f) => f.title).sort(), 'each open task is filed once as an issue, and the finished one is not').toEqual(open.map((t) => t.spec.title).sort());

  const issue = new Map(open.map((t) => [t.n, filed.find((f) => f.title === t.spec.title)!.number]));
  for (const t of open) {
    const want = t.blockers.filter((b) => issue.has(b)).map((b) => issue.get(b)!).sort((a, b) => a - b);
    expect(forge.linksOf(issue.get(t.n)!), `#${t.n}'s issue #${issue.get(t.n)} is blocked by the issues filed for its open blockers`).toEqual(want);
  }
}, 60 * MIN);
