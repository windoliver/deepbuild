// Standing rules judged by what later broke (#23): each decision that answers asks for you is held to the same kind
// of work you decided yourself. Both breakage rates use one-sided 95% Clopper-Pearson bounds, exact for the
// binomial: yours at its upper bound, so it is never 0, and the limit is that bound times the margin in your
// settings. A rule FAILs when its own lower bound is above the limit, can widen when its upper bound is at or below
// it, and otherwise can't decide, saying how many more cases with no breakage would let it widen.
import type { Judgment, Tally } from '@deepbuild/asks';
import type { RecordStore } from '@deepbuild/record';

const ALPHA = 0.05;

/** ln C(n, k). */
function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}
/** P(X <= x) for X ~ Binomial(n, p). */
function cdf(x: number, n: number, p: number): number {
  if (x >= n || p <= 0) return 1;
  if (p >= 1) return 0;
  let s = 0;
  for (let k = 0; k <= x; k++) s += Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));
  return Math.min(1, s);
}
/** The p in [0, 1] where `below` turns false, by bisection. */
function bisect(below: (p: number) => boolean): number {
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 100 && hi - lo > 1e-15; i++) {
    const mid = (lo + hi) / 2;
    if (below(mid)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
/** The exact one-sided upper bound on a rate seen as `broke` in `cases`: 1 when every case broke. */
const upper = (broke: number, cases: number): number => (broke >= cases ? 1 : bisect((p) => cdf(broke, cases, p) > ALPHA));
/** The exact one-sided lower bound: 0 when none broke. */
const lower = (broke: number, cases: number): number => (broke <= 0 ? 0 : bisect((p) => 1 - cdf(broke - 1, cases, p) < ALPHA));

/** Judges a standing rule's breakage against yours, at the margin in your settings. */
export function judge(rule: Tally, yours: Tally, margin: number): Judgment {
  const mine = upper(yours.broke, yours.cases);
  const limit = mine * margin;
  const bounds = { lower: lower(rule.broke, rule.cases), upper: upper(rule.broke, rule.cases) };
  if (bounds.lower > limit) return { verdict: 'FAIL', rule: bounds, yours: mine, limit, more: null };
  if (bounds.upper <= limit) return { verdict: 'widen', rule: bounds, yours: mine, limit, more: null };
  // The upper bound falls as cases with no breakage add up: the fewest that bring it to the limit, by doubling then halving.
  const fits = (more: number): boolean => upper(rule.broke, rule.cases + more) <= limit;
  let hi = 1;
  while (!fits(hi)) hi *= 2;
  let lo = hi / 2;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return { verdict: 'undecided', rule: bounds, yours: mine, limit, more: hi };
}

/** What a standing rule is judged on: the work it decided, and the same kind of work you decided yourself. */
export interface Evidence { decision: string; rule: Tally; yours: Tally }

const KINDS = ['ask.created', 'ask.answered', 'decision.created', 'decision.applied', 'work.broke'] as const;
const PAGE = 1000;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Each standing rule's evidence over the window ending at `now`, from the record: a standing rule is a decision that
 * decided at least one ask for you in the window. Its cases are those asks; yours are the asks of its key you answered
 * on the trusted path in the window, in every scope. A case broke when the core recorded work.broke naming its ask.
 */
export async function evidence(options: { record: RecordStore; now: number; window: number }): Promise<Evidence[]> {
  const since = options.now - options.window;
  const keyOf = new Map<string, string>();
  const decisions = new Map<string, string>();
  const decided = new Map<string, Set<string>>();
  const answered = new Map<string, Set<string>>();
  const broke = new Set<string>();
  for (let after = 0; ;) {
    const page = await options.record.read({ after, limit: PAGE, kinds: KINDS });
    for (const e of page) {
      const d = isObj(e.data) ? e.data : {};
      if (e.kind === 'ask.created') {
        if (typeof d.key === 'string') keyOf.set(`ask:${e.id}`, d.key);
        continue;
      }
      // Only the core records a decision, an answer, an automatic answer or what broke.
      if (e.writer !== 'core') continue;
      if (e.kind === 'decision.created') decisions.set(`decision:${e.id}`, String(d.key));
      else if (e.kind === 'work.broke') broke.add(String(d.ask));
      else if (e.ts < since || e.ts > options.now) continue;
      else if (e.kind === 'decision.applied' && decisions.has(String(d.decision))) {
        const asks = decided.get(String(d.decision)) ?? decided.set(String(d.decision), new Set()).get(String(d.decision))!;
        asks.add(String(d.ask));
      } else if (e.kind === 'ask.answered' && d.verified === true && (d.via === 'card' || d.via === 'inbox') && e.subject) {
        const key = keyOf.get(e.subject);
        if (key === undefined) continue;
        const asks = answered.get(key) ?? answered.set(key, new Set()).get(key)!;
        asks.add(e.subject);
      }
    }
    if (page.length < PAGE) break;
    after = page[page.length - 1]!.log_pos;
  }
  const tally = (asks: Set<string>): Tally => ({ cases: asks.size, broke: [...asks].filter((a) => broke.has(a)).length });
  return [...decided].map(([decision, asks]) => ({ decision, rule: tally(asks), yours: tally(answered.get(decisions.get(decision)!) ?? new Set()) }));
}
