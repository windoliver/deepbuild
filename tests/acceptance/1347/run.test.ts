// AC1 and AC2, on one run: a workspace's six tasks with seven blocked-by links, kept in the record, run to the end under
// one approval with no forge configured and the forge's address unreachable; no task starts before every task it is
// blocked by finished, and the first task's first attempt, killed mid-turn, goes on as a next attempt in the same
// worktree. The planted run that calls a forge fails, naming the call.
import { expect, test } from 'vitest';
import { blockedByOf, iso, MIN, must, mustFail, named, PLANT, real, waitUntil, World, type Launch, type Ran, type Task, type TaskSpec } from './helpers.ts';

/** The seven links, blocker first, as indexes into TASKS (the shape of #1332's first criterion). */
const LINKS: [number, number][] = [[0, 2], [0, 3], [1, 3], [2, 4], [3, 4], [1, 5], [4, 5]];
const TASKS: TaskSpec[] = [1, 2, 3, 4, 5, 6].map((part, i) => ({
  title: `Write part ${part} of the client report`, criteria: [`Part ${part} of the client report is written`], blockedBy: LINKS.filter(([, d]) => d === i).map(([b]) => b),
}));
const scope = (tasks: Task[]): string => `work through ${tasks.slice(0, -1).map((t) => `#${t.n}`).join(', ')} and #${tasks.at(-1)!.n} with Claude Code, two at a time`;

interface Scene { w: World; entered: { tasks: Task[]; failures: string[] }; missing: string[]; asked?: Ran; hung?: Launch }
/**
 * The run: the six tasks entered, the run's one approval answered yes, and (on the right program) the first task's first
 * attempt killed once it hangs mid-turn; until every task finished (45 minutes), or, planted, until the forge is called
 * (30 minutes).
 */
async function scene(plant?: string): Promise<Scene> {
  const w = await World.open({ topic: 'Client report', forge: 'unreachable', ...(plant ? { plant } : {}) });
  const entered = await w.enter(TASKS);
  if (entered.failures.length) return { w, entered, missing: [] };
  const first = entered.tasks[0]!;
  const { missing } = await w.prepare({ plan: plant ? {} : { [first.n]: { launches: ['hang', 'work'] } } });
  if (missing.length) return { w, entered, missing };
  w.watchLive();
  const asked = await w.run(scope(entered.tasks));
  if (asked.code !== 0) return { w, entered, missing, asked };
  await w.approve(asked);
  if (plant) {
    await waitUntil(async () => w.dead!.calls.length > 0 || (await w.unfinished()).length === 0, 30 * MIN, 5000);
    return { w, entered, missing, asked };
  }
  const hung = await waitUntil(() => w.on(first.n).find((l) => l.hanging), 15 * MIN, 1000);
  if (hung) w.kill(hung);
  await waitUntil(async () => (await w.unfinished()).length === 0, 45 * MIN, 5000);
  return { w, entered, missing, asked, ...(hung ? { hung } : {}) };
}
let shared: Promise<Scene> | undefined;

/** The judgement of AC1's second half: nothing reached the forge's address while the run went on. */
function noForge(w: World): void {
  const call = w.dead!.calls[0];
  must(!call, call ? `the run called the forge ${w.dead!.url} at ${iso(call.at)} with no forge configured: ${call.line}${w.dead!.calls.length > 1 ? ` (and ${w.dead!.calls.length - 1} more calls)` : ''}` : '');
}

test(named(1), async () => {
  const { w, entered, missing, asked } = await (shared ??= scene());
  expect(entered.failures, 'each task enters the workspace with `deep workspace task`').toEqual([]);
  // The tasks live in the record, each an item with work.item@1's fields and what it is blocked by: six tasks, seven links.
  expect(missing, "each task is a record item with work.item@1's source_id, title and criteria").toEqual([]);
  for (const t of entered.tasks) {
    const item = w.items.get(t.n)!;
    expect(item.criteria, `#${t.n}'s record item holds its criteria`).toEqual(t.spec.criteria);
    expect(blockedByOf(item, w.items), `#${t.n}'s record item holds what it is blocked by: ${JSON.stringify(item).slice(0, 600)}`).toEqual([...t.blockers].sort((a, b) => a - b));
  }
  expect(entered.tasks.reduce((sum, t) => sum + t.blockers.length, 0), 'six tasks with seven blocked-by links').toBe(7);

  expect(asked?.code, `deep work "${scope(entered.tasks)}" raises the run's one approval and exits 0: ${asked ? `exit ${asked.code}, ${asked.stderr.slice(-600)}` : 'not run'}`).toBe(0);
  expect(await w.unfinished(), 'the run goes to the end: every task finished, a PASS on its checks covering a commit of the workspace that holds its change').toEqual([]);
  noForge(w);

  // The planted run calls a forge for the workspace's tasks.
  const p = await scene(PLANT);
  expect(p.entered.failures, 'the planted world enters its tasks').toEqual([]);
  expect(p.asked?.code, `the planted run's approval: ${p.asked ? `exit ${p.asked.code}, ${p.asked.stderr.slice(-600)}` : 'not run'}`).toBe(0);
  const call = p.w.dead!.calls[0];
  expect(call, 'the planted run called no forge, so it proves nothing').toBeDefined();
  await mustFail('a run that calls a forge', () => noForge(p.w), [call!.line]);
}, 100 * MIN);

test(named(2), async () => {
  const { w, entered, asked, hung } = await (shared ??= scene());
  expect(entered.failures, 'each task enters the workspace with `deep workspace task`').toEqual([]);
  expect(asked?.code, `the run's approval: ${asked ? `exit ${asked.code}, ${asked.stderr.slice(-600)}` : 'not run'}`).toBe(0);

  // No task starts before every task it is blocked by finished.
  const events = await w.events();
  const finished = new Map<number, number | undefined>();
  for (const t of entered.tasks) finished.set(t.n, (await w.finish(t.n, events))?.at);
  const early: string[] = [];
  for (const t of entered.tasks) {
    for (const l of w.on(t.n)) {
      for (const b of t.blockers) if (finished.get(b) === undefined || l.started < finished.get(b)!) early.push(`#${t.n} started at ${iso(l.started)}, before its blocker #${b} finished (${iso(finished.get(b))})`);
    }
  }
  for (const t of entered.tasks) expect(w.on(t.n).length, `#${t.n} started`).toBeGreaterThan(0);
  expect(early, 'no task starts before its blockers finish').toEqual([]);

  // A session killed mid-turn continues as a next attempt, as on a repo.
  const first = entered.tasks[0]!.n;
  expect(hung, `the run starts #${first}'s first attempt, which is mid-turn when it is killed`).toBeDefined();
  const next = w.on(first).find((l) => l.launch === 2);
  expect(next, `#${first}'s killed session continues as a next attempt`).toBeDefined();
  expect(real(next!.cwd), 'in the same worktree').toBe(real(hung!.cwd));
  expect(next!.found.notes[`notes-${first}.txt`], 'with its uncommitted files intact').toBe(hung!.notes);
  expect(next!.started, 'once the killed one was gone').toBeGreaterThan(hung!.hanging!);
  const seen = w.on(first).map((l) => `attempt ${l.launch} pid ${l.pid} from ${iso(l.started)}${l.ended ? ` to ${iso(l.ended)}` : ''}`);
  expect(w.maxLive.get(first) ?? 0, `#${first} never has two live attempts: ${seen.join('; ')}`).toBeLessThanOrEqual(1);
}, 100 * MIN);
