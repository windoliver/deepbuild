// @deepbuild/config-eval (#112): configuration evals. A change to instruction files, skills, hooks, guards or policy
// is replayed on real past tasks before it lands: each task's own words, in a checkout of the commit it started from,
// once with the base's files and once with the change's, each repeat graded blind by a judge of another model family,
// and compared by the record's one comparison rule under a plan frozen before either side runs. The judge grades the
// changes a run made, never what its agent said of them, and only once it has scored a control (#3245). It runs on your
// machine or in a lane you dispatch, never in hosted CI on push (design: The learned layer, How we know version 0 works).
import { execFile } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { compareReplay, planHash, type Comparison, type ReplayPlan, type ReplayRun } from '@deepbuild/record';
import { askOf, control, NO_CHANGE } from './control.js';
import { defaultLauncher } from './launcher.js';
import type { Grant, Launch } from '@deepbuild/supervisor';

export { archivedTasks } from './archive.js';
export { removalPlan } from './removal.js';

/** One outside call the original session made, with its result, as its transcript holds them (#1108). */
export interface RecordedCall {
  /** Claude Code's tool name: `Bash`, or `mcp__<server>__<tool>`. */
  tool: string;
  input: unknown;
  /** The tool result's text. */
  result: string;
  error?: boolean;
}
/**
 * A real past task, as read from the transcript archive: the handle of the message that asked for it, when, the repo,
 * the commit it started from, your words, the outside calls its session made, when it made one, and whether its session
 * changed a file (a work task), which the plan freezes.
 */
export interface ReplayTask { id: string; at: number; repo: string; commit: string; prompt: string; recording?: RecordedCall[]; work?: boolean }
/** The agent's whole view: its model, prompt, folder and environment; and the recording its outside calls are answered from. */
export interface AgentRun { model: string; prompt: string; cwd: string; env: Record<string, string>; recording?: RecordedCall[] }
/** One outside call a run made, and whether the recording answered it. */
export interface Made { tool: string; input: unknown; answered: boolean }
/** A run's end: with the outside calls it made. */
export interface AgentResult { ok: boolean; result?: string; usage?: { input: number; output: number }; calls?: Made[] }
/** One outside call a replayed agent made, as the replay recorded it: `answered` false got the not-in-the-recording error. */
export interface ReplayCall { task: string; side: 'base' | 'change'; repeat: number; tool: string; input: unknown; answered: boolean }
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
  /** Hub jobs recheck the account's reserve before every model turn. Standalone evals use their own budget. */
  checkpoint?: (agent: 'claude-code' | 'codex') => Promise<void>;
  signal?: AbortSignal;
  /** Supplied by an installed hub: all subprocesses retain supervisor ownership and per-agent sign-in isolation. */
  execute?: (launch: Launch, grant: Grant, prompt: string, deadline: number) => Promise<unknown[]>;
  read?: (agent: 'claude-code' | 'codex', model: string, prompt: string, deadline: number) => Promise<unknown[]>;
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
  /** Every outside call of every run: the replay's record. */
  calls: ReplayCall[];
  /** Each pair either side of which made a call the recording can't answer, with those calls; it counts as a failed pair. */
  diverged: { task: string; calls: ReplayCall[] }[];
  /** The tasks graded on words: their original session changed no file, so a run's reply is its output. */
  words: string[];
  /** Each run whose output doesn't fit the judge's cap, in characters: it was never sent, and its grade is missing. */
  oversize: { task: string; side: 'base' | 'change'; repeat: number; size: number; cap: number }[];
  /** The first judge request, before any agent, and its scores of the right change and of no change: null where it gave none. Absent when nothing is graded. */
  control?: { sha256: string; request: JudgeRequest; right: number | null; none: number | null };
}

/** The metrics the eval captures: the judge's grade of a run's output, and the tokens the agent reported. */
const METRICS = new Set(['grade', 'tokens']);
/** Hosted CI events that run on every push or pull request: the eval never runs on them. */
const ON_PUSH = new Set(['push', 'pull_request', 'pull_request_target', 'merge_group']);
/** Agent runs at once: enough to replay 20 tasks within two hours, few enough to stay inside a plan window. */
const AT_ONCE = 4;
/** An output longer than this, in characters, is never shown to a judge: a task's six outputs stay well inside its context. */
const OUTPUT_CAP = 20_000;
/** Drafted: a judge that scores no change this or above in the control decides nothing. */
const NONE_BELOW = 0.5;
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
    const parts = path.split('/');
    if (isAbsolute(path) || parts.some((p) => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')) throw Error(`unsafe variant path ${path}`);
    for (let i = 1; i <= parts.length; i++) {
      const info = await lstat(join(dir, ...parts.slice(0, i))).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return undefined; });
      if (info?.isSymbolicLink()) throw Error(`a variant cannot follow the historical link ${path}`);
    }
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
/** The files a run added or changed, as a diff, never the variant's own files and no word of the agent's. */
async function changesOf(dir: string, start: string, variantFiles: string[]): Promise<string> {
  await git(dir, ['add', '-A']);
  return (await git(dir, ['diff', '--cached', '--no-color', '--no-ext-diff', start, '--', '.', ...variantFiles.map((f) => `:(exclude)${f}`)])) || NO_CHANGE;
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
  const worded = new Set(plan.words);
  const words = [...plan.tasks, ...plan.fitted].filter((t) => worded.has(t));
  const refusedWith = (reason: string, opened?: EvalReport['control']): EvalReport => ({
    plan, hash, runs: [], after: refusedComparison(reason), before: refusedComparison(reason), held: false, usage: { ms: performance.now() - started, plan_share: null }, calls: [], diverged: [],
    words, oversize: [], ...(opened ? { control: opened } : {}),
  });
  const why = refusal(options);
  if (why) return refusedWith(why);
  const env = Object.fromEntries(Object.entries(options.env).filter((e): e is [string, string] => e[1] !== undefined));
  let launcher: Launcher;
  // The agents' runs end by their share of the budget, and the judge's by the budget less the time to wrap up.
  const deadlines = { work: Date.now() + plan.budget.ms * AGENTS_SHARE, judge: Date.now() + plan.budget.ms - Math.min(WRAP_UP_MS, plan.budget.ms * 0.05) };
  try { launcher = options.launcher ?? defaultLauncher(plan, env, deadlines, options.signal, options.execute, options.read); } catch (error) { return refusedWith(error instanceof Error ? error.message : String(error)); }

  const graded = plan.measures.some((m) => m.name === 'grade');
  let opened: EvalReport['control'];
  if (graded) {
    await options.checkpoint?.(accountOf(plan.models.judge));
    opened = await openWithControl(plan.models.judge, launcher);
    const { right, none } = opened;
    if (right === null || none === null || none >= NONE_BELOW || none >= right) {
      return refusedWith(`the judge ${plan.models.judge} scored no change ${none ?? 'nothing'} and a change that does what was asked ${right ?? 'nothing'} in the control, so its grades decide nothing: no change must score below ${NONE_BELOW} and below that change`, opened);
    }
  }

  const byId = new Map(options.tasks.map((t) => [t.id, t]));
  await options.checkpoint?.('claude-code');
  const usedAtStart = (await launcher.planUsed?.()) ?? null;
  const spent = async (): Promise<boolean> => {
    if (options.signal?.aborted || performance.now() - started >= plan.budget.ms * AGENTS_SHARE) return true;
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
  const runs: ReplayRun[] = [];
  const oversize: EvalReport['oversize'] = [];
  const calls: ReplayCall[] = [];
  const outputs = new Map<ReplayRun, string>();
  const nothing = (): Record<string, number | null> => Object.fromEntries(plan.measures.map((m) => [m.name, null]));
  const next = async (): Promise<void> => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const r: ReplayRun = { plan: hash, task: job.task, side: job.side, repeat: job.repeat, ok: false, metrics: nothing() };
      runs.push(r);
      try { await replay(job, r); } finally {
        left.set(job.task, left.get(job.task)! - 1);
        if (graded && left.get(job.task) === 0) grading.push(grade(plan, byId.get(job.task)!, worded.has(job.task), leads.get(job.task)!, runs, outputs, launcher, options.checkpoint));
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
      const out = await checkout(task, files, root);
      dir = out.dir;
      await options.checkpoint?.('claude-code');
      if (await spent()) return;
      const result = await launcher.work({ model: plan.models.agent, prompt: task.prompt, cwd: dir, env: { ...env }, ...(task.recording ? { recording: task.recording } : {}) });
      const made = (result.calls ?? []).map((c) => ({ task: job.task, side: job.side, repeat: r.repeat, tool: c.tool, input: c.input, answered: c.answered }));
      calls.push(...made);
      // A run that made a call the recording can't answer is no longer the same task: it counts as failed.
      if (!result.ok || made.some((c) => !c.answered)) return;
      r.ok = true;
      if ('tokens' in r.metrics) r.metrics.tokens = result.usage ? result.usage.input + result.usage.output : null;
      const output = worded.has(job.task) ? result.result ?? '' : await changesOf(dir, out.start, Object.keys(files));
      if (graded && output.length > OUTPUT_CAP) oversize.push({ task: job.task, side: job.side, repeat: r.repeat, size: output.length, cap: OUTPUT_CAP });
      else outputs.set(r, output);
    } catch {
      r.ok = false;
      r.metrics = nothing();
    } finally {
      if (dir) await rm(dirname(dir), { recursive: true, force: true });
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, next));
  await Promise.all(grading);
  for (const list of [runs, calls, oversize]) list.sort((a, b) => a.task.localeCompare(b.task) || a.side.localeCompare(b.side) || a.repeat - b.repeat);
  const usedAtEnd = usedAtStart === null ? null : ((await launcher.planUsed?.()) ?? null);
  const after = compareReplay({ plan, runs });
  const unanswered = calls.filter((c) => !c.answered);
  const diverged = [...new Set(unanswered.map((c) => c.task))].map((task) => ({ task, calls: unanswered.filter((c) => c.task === task) }));
  return {
    plan, hash, runs, after, before: compareReplay({ plan, runs }, plan.fitted), held: after.outcome === 'regresses', calls, diverged,
    words, oversize, ...(opened ? { control: opened } : {}),
    usage: { ms: performance.now() - started, plan_share: usedAtStart !== null && usedAtEnd !== null && usedAtEnd >= usedAtStart ? usedAtEnd - usedAtStart : null },
  };
}

const accountOf = (judge: string): 'claude-code' | 'codex' => (/^claude/.test(judge) ? 'claude-code' : 'codex');
const labelOf = (k: number): string => String.fromCharCode(65 + (k % 26)) + (k >= 26 ? String(Math.floor(k / 26)) : '');
/** The judge's score for a label, or null when it gave none from 0 to 1. */
function scoreOf(grades: Grade[], label: string): number | null {
  const score = grades.find((g) => g.label === label)?.score;
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1 ? score : null;
}

/** The eval's first request: the control, in an order that favors neither output, with the judge's scores of it. */
async function openWithControl(model: string, launcher: Launcher): Promise<NonNullable<EvalReport['control']>> {
  const { prompt, sha256, right, none } = control();
  const order = shuffle<'right' | 'none'>(['right', 'none']);
  const request: JudgeRequest = { model, prompt, outputs: order.map((o, k) => ({ label: labelOf(k), text: { right, none }[o] })) };
  let grades: Grade[] = [];
  try { grades = await launcher.judge(request); } catch { grades = []; }
  const scored = (o: 'right' | 'none'): number | null => scoreOf(grades, labelOf(order.indexOf(o)));
  return { sha256, request, right: scored('right'), none: scored('none') };
}

/**
 * Grades one task's outputs blind, in one request: both sides under labels that name no side, the side that leads
 * alternating over the tasks in a shuffled order. A grade the judge didn't give stays missing.
 */
async function grade(plan: ReplayPlan, task: ReplayTask, words: boolean, lead: 'base' | 'change', runs: ReplayRun[], outputs: Map<ReplayRun, string>, launcher: Launcher, checkpoint: EvalOptions['checkpoint']): Promise<void> {
  // The runs are in their shuffled start order.
  const shown = runs.filter((r) => r.task === task.id && outputs.has(r));
  if (!shown.length) return;
  const first = shown.findIndex((r) => r.side === lead);
  if (first > 0) shown.unshift(...shown.splice(first, 1));
  const labels = shown.map((_, k) => labelOf(k));
  const request: JudgeRequest = {
    model: plan.models.judge,
    prompt: askOf(task.prompt, words),
    outputs: shown.map((r, k) => ({ label: labels[k]!, text: outputs.get(r)! })),
  };
  let grades: Grade[] = [];
  try { await checkpoint?.(accountOf(request.model)); grades = await launcher.judge(request); } catch { grades = []; }
  shown.forEach((r, k) => { r.metrics.grade = scoreOf(grades, labels[k]!); });
}
