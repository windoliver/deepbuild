// AC3: two tasks in a workspace that touches two hosts run to the end. The first task's checks read web-1 and web-2, the
// second's only web-2. The first task's verdict names the workspace commit it covers and the digests of what its state
// sources read; then web-1 drifts, that verdict goes stale and only the check that reads web-1 runs again.
import { expect, test } from 'vitest';
import { changed, MIN, named, requirement, sleep, stateCheck, waitUntil, World, type Ev, type Task } from './helpers.ts';

test(named(3), async () => {
  const w = await World.open({ topic: 'Web fleet', forge: 'unreachable' });
  const entered = await w.enter([
    { title: 'Keep both web hosts serving', criteria: ['web-1 serves on port 80 and web-2 serves TLS'] },
    { title: "Keep web-2's certificate current", criteria: ["web-2's certificate is current"] },
  ]);
  expect(entered.failures, 'each task enters the workspace with `deep workspace task`').toEqual([]);
  const [one, two] = entered.tasks as [Task, Task];

  const web1 = w.hostLog('web-1', { workers: 4, port: 80 });
  const web2 = w.hostLog('web-2', { tls: true, cert: 'current' });
  const own = (n: number): string => `!fs.readFileSync('src/i${n}.txt', 'utf8').includes('BROKEN')`;
  const port = stateCheck(`i${one.n}-web-1`, `state('web-1').port === 80 && ${own(one.n)}`);
  const tls = stateCheck(`i${one.n}-web-2`, `state('web-2').tls === true && ${own(one.n)}`);
  const cert = stateCheck(`i${two.n}-web-2`, `state('web-2').cert === 'current' && ${own(two.n)}`);
  const prepared = await w.prepare({
    touches: [{ id: 'web-1', source: 'host', log: web1 }, { id: 'web-2', source: 'host', log: web2 }],
    files: { ...port.files, ...tls.files, ...cert.files },
    requirements: (t) => (t.n === one.n
      ? [requirement('R1', 'web-1 serves on port 80', port.path, { reads: ['web-1'] }), requirement('R2', 'web-2 serves TLS', tls.path, { reads: ['web-2'] })]
      : [requirement('R1', "web-2's certificate is current", cert.path, { reads: ['web-2'] })]),
  });
  expect(prepared.missing, 'each task is a record item').toEqual([]);
  const scope = `work through #${one.n} and #${two.n} with Claude Code, two at a time`;
  const asked = await w.run(scope);
  expect(asked.code, `deep work "${scope}" raises the run's one approval and exits 0: exit ${asked.code}, ${asked.stderr.slice(-600)}`).toBe(0);
  await w.approve(asked);
  await waitUntil(async () => (await w.unfinished()).length === 0, 40 * MIN, 5000);
  expect(await w.unfinished(), 'both tasks finish').toEqual([]);

  // The first task's verdict names its commit: the workspace's new commit, holding its change, in the workspace's history.
  const events = await w.events();
  const first = (await w.finish(one.n, events))!.verdict;
  const second = (await w.finish(two.n, events))!.verdict;
  const commit = String(first.data.commit);
  expect(commit, "the task's verdict names a commit").toMatch(/^[0-9a-f]{40}$/);
  expect(await w.onMain(commit), `${commit} is a commit of the workspace's own history`).toBe(true);
  expect(await w.holds(commit, one.n), `${commit} holds #${one.n}'s change`).toBe(true);
  // And its state digests: one for each touch its checks read, the readings the record pinned to its claim.
  const pinned = events.filter((e) => e.kind === 'state.read' && e.data.claim === first.data.claim).at(-1);
  expect(pinned, `the record's state.read pins what ${String(first.data.claim)}'s checks read`).toBeDefined();
  const readings = pinned!.data.readings as { touch: string; digest: string }[];
  expect(readings.map((r) => r.touch).sort(), 'the touches its checks read').toEqual(['web-1', 'web-2']);
  const digests = first.data.key?.state_digests as string[] | undefined;
  expect(digests, `${String(first.data.verdict)} names its state digests in its key`).toBeDefined();
  for (const d of digests!) expect(d, 'each a SHA-256').toMatch(/^[0-9a-f]{64}$/);
  expect([...digests!].sort(), "the digests of what the task's state sources read").toEqual([...new Set(readings.map((r) => r.digest))].sort());

  // web-1 drifts: the verdict that read it goes stale, and only the check reading it runs again.
  const since = events.at(-1)!.log_pos;
  changed(web1, 'workers', 8);
  const drift = await w.deep(['workspace', 'drift', w.id]);
  expect(drift.code, `deep workspace drift ${w.id}: exit ${drift.code}, ${drift.stdout.slice(-600)} ${drift.stderr.slice(-600)}`).toBe(0);
  const runsSince = (all: readonly Ev[]): Ev[] => all.filter((e) => e.kind === 'run.started' && e.log_pos > since);
  await waitUntil(async () => {
    const all = await w.events();
    const runs = runsSince(all);
    return runs.length > 0 && runs.every((r) => all.some((e) => e.kind === 'run.finished' && e.data.run === r.data.run));
  }, 5 * MIN, 2000);
  await sleep(30_000);
  const after = await w.events();
  const stale = after.filter((e) => e.kind === 'verdict.stale' && e.log_pos > since).map((e) => String(e.data.verdict));
  const ofOne = w.verdictsOf(after, one.n);
  expect(stale, `the verdict that read web-1 goes stale: ${String(first.data.verdict)}`).toContain(String(first.data.verdict));
  expect(stale.filter((v) => !ofOne.has(v)), `no other task's verdict goes stale: ${String(second.data.verdict)} read only web-2`).toEqual([]);
  const reran = runsSince(after).map((e) => String(e.data.check));
  expect(reran.length, 'the check reading web-1 runs again').toBeGreaterThan(0);
  expect([...new Set(reran)], 'and only it: the checks reading web-2 keep their results').toEqual([port.path]);
}, 60 * MIN);
