// A rule's removal is evaluated on this repo's newest archived tasks (#2077), never on a working session's claims.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RecordReader, ReplayPlan } from '@deepbuild/record';
import { archivedTasks } from './archive.js';
import type { ReplayTask } from './index.js';

const run = promisify(execFile);
/** Freeze the same defaults as config-eval.mjs: 20 held-out tasks, up to four earlier readings, three repeats. */
export async function removalPlan(reader: RecordReader, read: (sha: string) => Promise<Uint8Array>, change: {
  id: string; repo: string; file: string; before: string; after: string;
}): Promise<{ plan: ReplayPlan; tasks: ReplayTask[] }> {
  const found = await archivedTasks(reader, read, change.repo);
  const common = async (cwd: string): Promise<string> => (await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd })).stdout.trim();
  const ours = await common(change.repo);
  const folders = new Map<string, string>();
  for (const task of found.tasks) if (!folders.has(task.repo)) folders.set(task.repo, await common(task.repo).catch(() => ''));
  const eligible = found.tasks.filter((t) => folders.get(t.repo) === ours && !/eval|replay|judge|variant|bench|experiment/i.test(t.prompt)).sort((a, b) => b.at - a.at);
  if (eligible.length < 20) throw Error(`the archive holds ${eligible.length} replayable tasks of this repo; a configuration eval needs 20, so the rule is unchanged`);
  const tasks = eligible.slice(0, 20);
  // The removal is structural, not fitted by a model. Earlier tasks are a separate reading, never its decision.
  const cutoff = tasks.at(-1)!.at - 1;
  const fitted = eligible.filter((t) => t.at <= cutoff).slice(0, 4);
  return {
    plan: {
      id: change.id, cutoff, tasks: tasks.map((t) => t.id), fitted: fitted.map((t) => t.id),
      variants: { base: { name: 'current rule file', files: { [change.file]: change.before } }, change: { name: 'removal', files: { [change.file]: change.after } } },
      models: { agent: 'claude-haiku-5-5', judge: 'gpt-reserve' }, repeats: 3, measures: [{ name: 'grade', better: 'higher' }],
      rule: 'paired-mean-one-sided-95', budget: { ms: 110 * 60_000, plan_share: 0.5 },
    }, tasks: [...tasks, ...fitted],
  };
}
