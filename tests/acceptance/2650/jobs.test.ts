// #2650 AC4: an ended job's result and its row in job.list() are what they are today, 10,000 jobs later; what the
// runner's output returns for a job ended past the bound is the answer the issue's first comment drafts, '', as for a
// job that ended before a restart; and a planted runner that returns nothing for a job still inside the bound fails,
// naming the job. The rows are the runner's own list(), status() and wait(), which the hub's job.list and job.status
// hand on as they are (README, The surface under test). Each job is the stand-in agent's, through the supervisor.
import { describe, expect, it } from 'vitest';
import type { JobRecord, Plant } from '../../../packages/runner/src/index.ts';
import { AC4, MINUTE } from './helpers.ts';
import { judgeJobs, type Ended, type Later } from './judges.ts';
import { job, openRunnerWorld, type RunnerWorld } from './runner.ts';

/** The newest ended jobs the issue's first comment keeps in memory: inside the bound, with their outputs. */
const BOUND = 64;

async function ended(w: RunnerWorld, result: string): Promise<Ended> {
  const row = await w.runner.run(job(result));
  if (row.state !== 'finished') expect.fail(`a job didn't run to its end: ${JSON.stringify(row)}`);
  return { job: row.job, row, output: await w.runner.output(row.job), result };
}
const read = async <T>(f: () => Promise<T>): Promise<T | { error: string }> => {
  try { return await f(); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
};
async function later(w: RunnerWorld, id: string, listed: JobRecord[]): Promise<Later> {
  return { listed: listed.find((j) => j.job === id), status: await read(() => w.runner.status(id)), waited: await read(() => w.runner.wait(id)), output: await read(() => w.runner.output(id)) };
}
/** The first job, then `after` more jobs, each run to its end; the first job and the newest 64 read again at the end. */
async function jobsLater(after: number, plant?: Plant): Promise<{ first: { ended: Ended; later: Later }; inside: { ended: Ended; later: Later }[] }> {
  const w = await openRunnerWorld(plant ? { plant } : {});
  const first = await ended(w, 'the first job, read again after the others');
  // It got past its account's wait for a first window reading (runner.window) and ended with the stand-in's result.
  expect(first.row.result, `the first job's result: ${JSON.stringify(first.row)}`).toBe(first.result);
  const newest: Ended[] = [];
  for (let i = 1; i <= after; i++) {
    const e = await ended(w, `job ${i} of ${after} after the first`);
    if (i > after - BOUND) newest.push(e);
  }
  const listed = await w.runner.list();
  return { first: { ended: first, later: await later(w, first.job, listed) }, inside: await Promise.all(newest.map(async (e) => ({ ended: e, later: await later(w, e.job, listed) }))) };
}

describe(`${AC4} An ended job's result and its row in \`job.list()\` are what they are today, 10,000 jobs later. What the runner's \`output\` returns for a job ended past the bound is the answer drafted in this issue, and a planted runner that returns nothing for a job still inside the bound fails, naming the job`, () => {
  it(`${AC4} 10,000 jobs later the first job's row and result read as they did when it ended, its output reads '', and each job inside the bound keeps its output`, async () => {
    const seen = await jobsLater(10_000);
    console.log(`#2650 AC4: the first job ${seen.first.ended.job} later: ${JSON.stringify({ ...seen.first.later, output: typeof seen.first.later.output === 'string' ? `${seen.first.later.output.length} characters` : seen.first.later.output })}`);
    expect(judgeJobs(seen.first, seen.inside)).toEqual([]);
  }, 120 * MINUTE);

  it(`${AC4} (wrong program) empty-output-inside-bound, a runner that returns nothing for a job still inside the bound, fails, naming the job`, async () => {
    const seen = await jobsLater(100, 'empty-output-inside-bound');
    const problems = judgeJobs(seen.first, seen.inside);
    const named = seen.inside.filter((j) => problems.some((p) => p.includes(j.ended.job) && /inside the bound/.test(p)));
    expect(named.length, `a problem names a job still inside the bound: ${JSON.stringify(problems).slice(0, 2000)}`).toBeGreaterThan(0);
  }, 30 * MINUTE);
});
