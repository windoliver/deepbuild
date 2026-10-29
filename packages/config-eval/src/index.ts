// @deepbuild/config-eval (#112): configuration evals. A change to instruction files, skills, hooks, guards or policy
// is replayed on real past tasks before it lands: each task's own words, in a checkout of the commit it started from,
// once with the base's files and once with the change's, each repeat graded blind by a judge of another model family,
// and compared by the record's one comparison rule under a plan frozen before either side runs. It runs on your
// machine or in a lane you dispatch, never in hosted CI on push (design: The learned layer, How we know version 0 works).
import { execFile } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { compareReplay, planHash, type Comparison, type ReplayPlan, type ReplayRun } from '@deepbuild/record';
import { defaultLauncher } from './launcher.js';

export { archivedTasks } from './archive.js';

/** A real past task, as read from the transcript archive: the handle of the message that asked for it, when, the repo, the commit it started from and your words. */
export interface ReplayTask { id: string; at: number; repo: string; commit: string; prompt: string }
/** The agent's whole view: its model, prompt, folder and environment. */
export interface AgentRun { model: string; prompt: string; cwd: string; env: Record<string, string> }
export interface AgentResult { ok: boolean; result?: string; usage?: { input: number; output: number } }
export interface JudgeRequest { model: string; prompt: string; outputs: { label: string; text: string }[] }
/** A score from 0 to 1. */
export interface Grade { label: string; score: number }
/** Where the agents under test and the judge run: by default the real ones, on your plan. */
export interface Launcher {
  work(run: AgentRun): Promise<AgentResult>;
  judge(request: JudgeRequest): Promise<Grade[]>;
  /** The share of the 5-hour window used so far (0 to 1), or null. */
  planUsed?(): Promise<number | null>;
}
export interface EvalOptions {
  plan: ReplayPlan;
  /** Every task the plan names, deciding and fitted. */
  tasks: ReplayTask[];
  /** A folder of its own for the agents' checkouts. */
  root: string;
  /** The environment it runs in, which each agent gets as it is. */
  env: Record<string, string | undefined>;
  launcher?: Launcher;
}
export interface EvalReport {
  plan: ReplayPlan;
  /** planHash(plan), taken before either side ran. */
  hash: string;
  runs: ReplayRun[];
  /** Over the plan's tasks, after the cutoff: this decides. */
  after: Comparison;
  /** Over the tasks it was fitted on, before the cutoff: a reading that never decides. */
  before: Comparison;
  /** The change regresses on the tasks after the cutoff, and `after.broke` names the tasks it broke. */
  held: boolean;
  usage: { ms: number; plan_share: number | null };
}

/** The metrics the eval captures: the judge's grade of a run's output, and the tokens the agent reported. */
const METRICS = new Set(['grade', 'tokens']);
/** Hosted CI events that run on every push or pull request: the eval never runs on them. */
const ON_PUSH = new Set(['push', 'pull_request', 'pull_request_target', 'merge_group']);
/** Agent runs at once: enough to replay 20 tasks within two hours, few enough to stay inside a plan window. */
const AT_ONCE = 4;
/** What a judge is shown of one output, at most: a task's six outputs stay well inside its context. */
const OUTPUT_CAP = 20_000;
/** The agents' share of the stated time; the judge grades the last tasks in the rest. */
const AGENTS_SHARE = 0.85;
/** Kept back from the judge at the end, for stopping runs and removing their checkouts. */
const WRAP_UP_MS = 60_000;

const run = promisify(execFile);
/** Git for the eval's own checkouts, without your global or system config, so nothing of yours lands in them. */
const git = async (cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> =>
  (await run('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...env }, maxBuffer: 64 * 1024 * 1024 })).stdout;
const shuffle = <T>(xs: T[]): T[] => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
};

/**
 * A fresh checkout of the task's commit with the variant's files written over it, in a folder whose path names
 * nothing but the repo: only that commit and its history, never what came after it, and the variant's files in its
 * last commit, as an instruction file would be. Returns the folder and the commit the agent starts from.
 */
async function checkout(task: ReplayTask, files: Record<string, string>, root: string): Promise<{ dir: string; start: string }> {
  const dir = join(root, randomBytes(6).toString('hex'), basename(task.repo));
  await mkdir(dir, { recursive: true });
  await git(dir, ['init', '-q']);
  await git(dir, ['-c', 'uploadpack.allowAnySHA1InWant=true', 'fetch', '-q', '--no-tags', task.repo, task.commit]);
  await git(dir, ['checkout', '-q', '-b', 'main', 'FETCH_HEAD']);
  await rm(join(dir, '.git', 'FETCH_HEAD'), { force: true });
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  if ((await git(dir, ['status', '--porcelain'])).trim()) {
    await git(dir, ['add', '-A']);
    const [name, email, date] = (await git(dir, ['log', '-1', '--format=%cn%x00%ce%x00%cI'])).trim().split('\0');
    await git(dir, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '--amend', '--no-verify', '-C', 'HEAD'], { GIT_COMMITTER_DATE: date! });
  }
  return { dir, start: (await git(dir, ['rev-parse', 'HEAD'])).trim() };
}
/** What the judge sees of a run: the agent's final reply and the files it added or changed, never the variant's own files. */
async function workOf(dir: string, start: string, reply: string, variantFiles: string[]): Promise<string> {
  await git(dir, ['add', '-A']);
  const patch = await git(dir, ['diff', '--cached', '--no-color', '--no-ext-diff', start, '--', '.', ...variantFiles.map((f) => `:(exclude)${f}`)]);
  return `Final reply:\n${reply}\n\nChanges:\n${patch || '(none)'}`.slice(0, OUTPUT_CAP);
}

const refusedComparison = (reason: string): Comparison => ({ outcome: 'refused', reason, n: 0, measures: [], tasks: [], broke: [] });
/** Why the eval can't start, before any agent or judge does, or undefined. */
function refusal(options: EvalOptions): string | undefined {
  const { plan, tasks, env } = options;
  if (env.GITHUB_ACTIONS === 'true' && ON_PUSH.has(env.GITHUB_EVENT_NAME ?? '')) return `a configuration eval never runs in hosted CI on ${env.GITHUB_EVENT_NAME}; run it on your machine or in a lane you dispatch with a budget`;
  const rule = compareReplay({ plan, runs: [] }, []);
  if (rule.outcome === 'refused') return rule.reason;
  const unknown = plan.measures.find((m) => !METRICS.has(m.name));
  if (unknown) return `the eval captures ${[...METRICS].join(' and ')}, not ${unknown.name}`;
  if (!Number.isInteger(plan.repeats) || plan.repeats < 1) return `${plan.repeats} repeats can't be replayed`;
  if (!plan.tasks.length) return 'the plan names no task after its cutoff to decide on';
  const named = [...plan.tasks, ...plan.fitted];
  const twice = named.find((t, i) => named.indexOf(t) !== i);
  if (twice !== undefined) return `the plan names ${twice} twice`;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const id of named) if (!byId.has(id)) return `the plan names ${id}, which isn't among the tasks given`;
  const early = plan.tasks.find((id) => byId.get(id)!.at <= plan.cutoff);
  if (early !== undefined) return `${early} is from before the cutoff the change was learned from, so it can't decide`;
  const late = plan.fitted.find((id) => byId.get(id)!.at > plan.cutoff);
  if (late !== undefined) return `${late} is from after the cutoff, so it isn't a task the change was fitted on`;
  return undefined;
}

/**
 * Replays the plan's tasks on both sides and compares them by the one rule. The plan is frozen (hashed) before
 * either side runs; every repeat of every side runs once, in a shuffled order; a run past the plan's stated time or
 * plan share isn't started and stays in the count as failed. A refused eval starts no agent and no judge.
 */
export async function runEval(options: EvalOptions): Promise<EvalReport> {
  const started = performance.now();
  const { plan, root } = options;
  const hash = planHash(plan);
  const refusedWith = (reason: string): EvalReport => ({
    plan, hash, runs: [], after: refusedComparison(reason), before: refusedComparison(reason), held: false, usage: { ms: performance.now() - started, plan_share: null },
  });
  const why = refusal(options);
  if (why) return refusedWith(why);
  const env = Object.fromEntries(Object.entries(options.env).filter((e): e is [string, string] => e[1] !== undefined));
  let launcher: Launcher;
  // The agents' runs end by their share of the budget, and the judge's by the budget less the time to wrap up.
  const deadlines = { work: Date.now() + plan.budget.ms * AGENTS_SHARE, judge: Date.now() + plan.budget.ms - Math.min(WRAP_UP_MS, plan.budget.ms * 0.05) };
  try { launcher = options.launcher ?? defaultLauncher(plan, env, deadlines); } catch (error) { return refusedWith(error instanceof Error ? error.message : String(error)); }

  const byId = new Map(options.tasks.map((t) => [t.id, t]));
  const usedAtStart = (await launcher.planUsed?.()) ?? null;
  const spent = async (): Promise<boolean> => {
    if (performance.now() - started >= plan.budget.ms * AGENTS_SHARE) return true;
    if (usedAtStart === null || !launcher.planUsed) return false;
    const now = await launcher.planUsed();
    return now !== null && now - usedAtStart >= plan.budget.plan_share;
  };

  // Task by task in a shuffled order, each task's repeats of both sides in an order that favors neither side, so
  // each task is graded as soon as its runs end, and the time left at the end is the judge's.
  const all = shuffle([...plan.tasks, ...plan.fitted]);
  const jobs = all.flatMap((task) => shuffle((['base', 'change'] as const).flatMap((side) =>
    Array.from({ length: plan.repeats }, (_, i) => ({ task, side, repeat: i + 1 })))));
  const leads = new Map(shuffle(all.map((_, i) => (i % 2 ? 'base' as const : 'change' as const))).map((side, i) => [all[i]!, side]));
  const left = new Map(all.map((task) => [task, 2 * plan.repeats]));
  const grading: Promise<void>[] = [];
  const graded = plan.measures.some((m) => m.name === 'grade');
  const runs: ReplayRun[] = [];
  const outputs = new Map<ReplayRun, string>();
  const nothing = (): Record<string, number | null> => Object.fromEntries(plan.measures.map((m) => [m.name, null]));
  const next = async (): Promise<void> => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const r: ReplayRun = { plan: hash, task: job.task, side: job.side, repeat: job.repeat, ok: false, metrics: nothing() };
      runs.push(r);
      try { await replay(job, r); } finally {
        left.set(job.task, left.get(job.task)! - 1);
        if (graded && left.get(job.task) === 0) grading.push(grade(plan, byId.get(job.task)!, leads.get(job.task)!, runs, outputs, launcher));
      }
    }
  };
  /** One run: past the agents' share of the budget it isn't started, and it stays in the count as failed. */
  const replay = async (job: { task: string; side: 'base' | 'change' }, r: ReplayRun): Promise<void> => {
    if (await spent()) return;
    const task = byId.get(job.task)!;
    const files = plan.variants[job.side].files;
    let dir: string | undefined;
    try {
      const made = await checkout(task, files, root);
      dir = made.dir;
      const result = await launcher.work({ model: plan.models.agent, prompt: task.prompt, cwd: dir, env: { ...env } });
      if (!result.ok) return;
      r.ok = true;
      if ('tokens' in r.metrics) r.metrics.tokens = result.usage ? result.usage.input + result.usage.output : null;
      outputs.set(r, await workOf(dir, made.start, result.result ?? '', Object.keys(files)));
    } catch {
      r.ok = false;
      r.metrics = nothing();
    } finally {
      if (dir) await rm(dirname(dir), { recursive: true, force: true });
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, next));
  await Promise.all(grading);
  runs.sort((a, b) => a.task.localeCompare(b.task) || a.side.localeCompare(b.side) || a.repeat - b.repeat);
  const usedAtEnd = usedAtStart === null ? null : ((await launcher.planUsed?.()) ?? null);
  const after = compareReplay({ plan, runs });
  return {
    plan, hash, runs, after, before: compareReplay({ plan, runs }, plan.fitted), held: after.outcome === 'regresses',
    usage: { ms: performance.now() - started, plan_share: usedAtStart !== null && usedAtEnd !== null && usedAtEnd >= usedAtStart ? usedAtEnd - usedAtStart : null },
  };
}

/**
 * Grades one task's outputs blind, in one request: both sides under labels that name no side, the side that leads
 * alternating over the tasks in a shuffled order. A grade the judge didn't give stays missing.
 */
async function grade(plan: ReplayPlan, task: ReplayTask, lead: 'base' | 'change', runs: ReplayRun[], outputs: Map<ReplayRun, string>, launcher: Launcher): Promise<void> {
  // The runs are in their shuffled start order.
  const shown = runs.filter((r) => r.task === task.id && outputs.has(r));
  if (!shown.length) return;
  const first = shown.findIndex((r) => r.side === lead);
  if (first > 0) shown.unshift(...shown.splice(first, 1));
  const labels = shown.map((_, k) => String.fromCharCode(65 + (k % 26)) + (k >= 26 ? String(Math.floor(k / 26)) : ''));
  const request: JudgeRequest = {
    model: plan.models.judge,
    prompt: `A developer asked a coding agent:\n\n${task.prompt}\n\nEach output below is one agent's attempt at that request: its final reply and the changes it made. Score each from 0 (does not do what was asked) to 1 (does it fully and correctly), on its own merits.`,
    outputs: shown.map((r, k) => ({ label: labels[k]!, text: outputs.get(r)! })),
  };
  let grades: Grade[] = [];
  try { grades = await launcher.judge(request); } catch { grades = []; }
  shown.forEach((r, k) => {
    const score = grades.find((g) => g.label === labels[k])?.score;
    r.metrics.grade = typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1 ? score : null;
  });
}
