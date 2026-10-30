// The one comparison rule for every learned change that alters behavior (#112): a configuration eval, the learned
// layer's widening from a session to a repo, and #118's scores. A replay's plan is frozen before either side runs;
// per task, each side's repeats are averaged, never maxed; the change is adopted only when the one-sided 95% bound
// of its paired gain beats the base on every declared measure, and regresses when that bound is worse on any one.
// Anything else is INCONCLUSIVE (design: The learned layer).
import { createHash } from 'node:crypto';

export interface Measure { name: string; better: 'higher' | 'lower' }
/** Files written over the checkout: path → text. */
export interface Variant { name: string; files: Record<string, string> }
export interface ReplayPlan {
  id: string;
  /** In ms: the change was learned from sessions before it. */
  cutoff: number;
  /** The replayed tasks that decide, each from after the cutoff. */
  tasks: string[];
  /** Tasks from before the cutoff, replayed as a reading that never decides. */
  fitted: string[];
  variants: { base: Variant; change: Variant };
  models: { agent: string; judge: string };
  repeats: number;
  measures: Measure[];
  rule: 'paired-mean-one-sided-95';
  /** Its stated time, and its share of one 5-hour plan window (0 to 1). */
  budget: { ms: number; plan_share: number };
}
export interface ReplayRun {
  /** planHash of the plan it ran under. */
  plan: string;
  task: string;
  side: 'base' | 'change';
  repeat: number;
  /** false: this side failed this repeat. */
  ok: boolean;
  /** Each declared measure; null when it wasn't captured, never 0 for one that is missing. */
  metrics: Record<string, number | null>;
}
export interface ReplayResult { plan: ReplayPlan; runs: ReplayRun[] }
export interface MeasureResult {
  name: string;
  better: 'higher' | 'lower';
  /** The mean gain over the tasks compared; positive is better for the change. */
  mean: number | null;
  /** Its one-sided 95% lower bound. */
  bound: number | null;
  /** The tasks whose value of this measure is missing. */
  missing: string[];
}
/** A gain per measure. */
export interface TaskPair { task: string; failed: boolean; diff: Record<string, number | null> }
export interface Comparison {
  outcome: 'adopt' | 'regresses' | 'INCONCLUSIVE' | 'refused';
  reason: string;
  /** Every task compared, failed or missing ones included. */
  n: number;
  measures: MeasureResult[];
  tasks: TaskPair[];
  /** The tasks with a negative gain on any measure, or whose change side failed where the base's didn't. */
  broke: string[];
}

const RULE = 'paired-mean-one-sided-95';
/** A gain this close to 0 is float noise from averaging, not a loss. */
const EPS = 1e-9;

/** One canonical text of a JSON value, keys sorted, so a plan's hash doesn't depend on the order of its keys. */
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
};
/** The plan as frozen: SHA-256 over every field. A run carries it, so a plan changed after a side ran no longer matches. */
export function planHash(plan: ReplayPlan): string {
  return createHash('sha256').update(canonical(plan)).digest('hex');
}

/** A model's family is its maker, read from its name; other names count as their own first word. */
const MAKERS: [RegExp, string][] = [[/^claude/, 'Anthropic'], [/^(gpt|o\d|codex|chatgpt)/, 'OpenAI'], [/^gemini/, 'Google']];
const familyOf = (model: string): string => MAKERS.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? model.toLowerCase().split(/[-_.\s]/)[0]!;

// The one-sided t quantile, from the regularized incomplete beta (Numerical Recipes, 6.1 and 6.4).
function lnGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betacf(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    for (const aa of [(m * (b - m) * x) / ((a + m2 - 1) * (a + m2)), (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))]) {
      d = 1 + aa * d;
      d = 1 / (Math.abs(d) < tiny ? tiny : d);
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      h *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-15) break;
  }
  return h;
}
function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betacf(a, b, x)) / a : 1 - (front * betacf(b, a, 1 - x)) / b;
}
const tCdf = (t: number, df: number): number => {
  const tail = 0.5 * ibeta(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
};
const quantiles = new Map<number, number>();
/** t(0.95, df), by bisection on the CDF. */
function t95(df: number): number {
  let q = quantiles.get(df);
  if (q === undefined) {
    let lo = 0;
    let hi = 1;
    while (tCdf(hi, df) < 0.95) hi *= 2;
    for (let i = 0; i < 200 && hi - lo > 1e-13; i++) {
      const mid = (lo + hi) / 2;
      if (tCdf(mid, df) < 0.95) lo = mid;
      else hi = mid;
    }
    q = (lo + hi) / 2;
    quantiles.set(df, q);
  }
  return q;
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt = (x: number): string => (Math.round(x * 1e4) / 1e4).toString();

/**
 * The one comparison rule over `tasks` (by default the plan's deciding tasks). Refused when a run ran under another
 * plan than the one compared, the plan names another rule, or its judge is of the agents' family. A task with a failed
 * side stays in the count, its gain never above 0; a metric not captured leaves its measure without a mean or bound.
 */
export function compareReplay(result: ReplayResult, tasks: string[] = result.plan.tasks): Comparison {
  const { plan, runs } = result;
  const refused = (reason: string): Comparison => ({ outcome: 'refused', reason, n: 0, measures: [], tasks: [], broke: [] });
  if (plan.rule !== RULE) return refused(`the plan names the rule ${String(plan.rule)}; the one comparison rule is ${RULE}`);
  const family = familyOf(plan.models.agent);
  if (familyOf(plan.models.judge) === family) return refused(`the judge ${plan.models.judge} is of the agents' own family (${family}, as ${plan.models.agent}); it must come from another`);
  const hash = planHash(plan);
  const off = runs.find((r) => r.plan !== hash);
  if (off) return refused(`${off.task}'s ${off.side} repeat ${off.repeat} ran under plan ${String(off.plan).slice(0, 12)}, not the plan compared (${hash.slice(0, 12)}): a plan that changed after either side ran can't be compared`);
  const named = new Set([...plan.tasks, ...plan.fitted]);
  const stray = tasks.find((t) => !named.has(t));
  if (stray !== undefined) return refused(`${stray} is not a task the plan ${plan.id} names`);

  // Each side of each task: failed when any repeat failed, is absent, or ran twice; otherwise its runs.
  const sides = new Map<string, { failed: boolean; runs: ReplayRun[] }>();
  for (const task of tasks) {
    for (const side of ['base', 'change'] as const) {
      const of = runs.filter((r) => r.task === task && r.side === side);
      const repeats = new Set(of.map((r) => r.repeat));
      const whole = of.length === plan.repeats && repeats.size === plan.repeats && [...repeats].every((k) => Number.isInteger(k) && k >= 1 && k <= plan.repeats);
      sides.set(`${task} ${side}`, { failed: !whole || of.some((r) => !r.ok), runs: of });
    }
  }
  /** A side's measure: the mean of its repeats, or null when any repeat's value is missing. */
  const sideMean = (task: string, side: 'base' | 'change', m: Measure): number | null => {
    const values = sides.get(`${task} ${side}`)!.runs.map((r) => r.metrics[m.name]);
    return values.every((v): v is number => typeof v === 'number' && Number.isFinite(v)) ? mean(values) : null;
  };
  const signed = (m: Measure, change: number, base: number): number => (m.better === 'higher' ? change - base : base - change);

  const pairs: TaskPair[] = [];
  const broke: string[] = [];
  for (const task of tasks) {
    const base = sides.get(`${task} base`)!;
    const change = sides.get(`${task} change`)!;
    const diff: Record<string, number | null> = {};
    for (const m of plan.measures) {
      if (base.failed) diff[m.name] = 0;
      else if (change.failed) {
        // The failed change side counts as the worst outcome any run of the cohort reached, so it never shows improvement.
        const b = sideMean(task, 'base', m);
        const seen = tasks.flatMap((t) => [...sides.get(`${t} base`)!.runs, ...sides.get(`${t} change`)!.runs])
          .filter((r) => r.ok).map((r) => r.metrics[m.name]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        const worst = !seen.length ? undefined : m.better === 'higher' ? Math.min(...seen) : Math.max(...seen);
        diff[m.name] = b === null ? null : worst === undefined ? 0 : Math.min(0, signed(m, worst, b));
      } else {
        const b = sideMean(task, 'base', m);
        const c = sideMean(task, 'change', m);
        diff[m.name] = b === null || c === null ? null : signed(m, c, b);
      }
    }
    pairs.push({ task, failed: base.failed || change.failed, diff });
    if ((change.failed && !base.failed) || Object.values(diff).some((d) => d !== null && d < -EPS)) broke.push(task);
  }

  const n = tasks.length;
  const stats = plan.measures.map((m) => {
    const missing = pairs.filter((p) => p.diff[m.name] === null).map((p) => p.task);
    const diffs = pairs.map((p) => p.diff[m.name]).filter((d): d is number => d !== null);
    if (missing.length || n === 0) return { result: { name: m.name, better: m.better, mean: null, bound: null, missing }, upper: null, why: missing.length ? `${m.name} is missing for ${missing.join(', ')}` : 'no tasks to compare' };
    const mu = mean(diffs);
    if (n < 2) return { result: { name: m.name, better: m.better, mean: mu, bound: null, missing }, upper: null, why: `${n} task can't bound ${m.name}` };
    const sd = Math.sqrt(diffs.reduce((a, d) => a + (d - mu) ** 2, 0) / (n - 1));
    const margin = (t95(n - 1) * sd) / Math.sqrt(n);
    return { result: { name: m.name, better: m.better, mean: mu, bound: mu - margin, missing }, upper: mu + margin, why: `${m.name}'s mean gain ${fmt(mu)} has a bound of ${fmt(mu - margin)} over ${n} tasks` };
  });
  const measures = stats.map((s) => s.result);
  const worse = stats.filter((s) => s.upper !== null && s.upper < 0);
  if (worse.length) {
    return { outcome: 'regresses', reason: `the change regresses: ${worse.map((s) => `${s.result.name}'s gain is below 0 at one-sided 95% (mean ${fmt(s.result.mean!)}, upper bound ${fmt(s.upper!)})`).join('; ')}; it broke ${broke.join(', ') || 'no single task'}`, n, measures, tasks: pairs, broke };
  }
  if (measures.length && measures.every((m) => m.bound !== null && m.bound > 0)) {
    return { outcome: 'adopt', reason: `the one-sided 95% bound beats the base on every declared measure over ${n} tasks: ${stats.map((s) => s.why).join('; ')}`, n, measures, tasks: pairs, broke };
  }
  const short = stats.filter((s) => s.result.bound === null || s.result.bound <= 0);
  return { outcome: 'INCONCLUSIVE', reason: `INCONCLUSIVE: ${short.length ? short.map((s) => s.why).join('; ') : 'no measure declared'}, so it neither adopts nor regresses`, n, measures, tasks: pairs, broke };
}
