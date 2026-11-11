// The check kinds the hub holds (#1537): each shipped check.kind@1 fill, admitted by its budget, with the routes by
// which a gate run names it. The gate dispatches every claim check that isn't a command through this table, and
// `checks.kinds` reads it back, so a kind held with no route shows as one. The review runs on every claim that opens
// or updates a PR, its second model a runner job under your reserve (#87); the numbers check on every claim whose
// words state a number with the query behind it (#87); a work kind where a definition's drafted check names it (#68).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { commandCheckKind } from '@deepbuild/checks-command';
import { numbersFill, type NumbersSpec, type StatedNumber } from '@deepbuild/checks-numbers';
import { independence, reviewFill, type ChangeSession, type ReviewerAnswer, type ReviewSpec } from '@deepbuild/checks-review';
import { workFill } from '@deepbuild/checks-work';
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec } from '@deepbuild/conformance';
import { admitKind } from '@deepbuild/gate';
import type { JobRecord } from '@deepbuild/runner';
import type { KindsOptions, ReviewOf, ReviewRound } from './checks-port.js';
export type { ReviewOf, ReviewRound } from './checks-port.js';

/** Each route a gate run names a kind by. */
const ROUTES = {
  spec: 'a check in the repo\'s .deepbuild/done.yaml',
  definition: 'a check a task\'s definition of done names',
  pr: 'every claim that opens or updates a pull request',
  number: 'every claim that states a number with the query behind it',
} as const;
type Route = keyof typeof ROUTES;

interface Held { fill: CheckRunnerFill; routes: Route[] }

/** The rubric a review reads when your wiki holds none: `- <rule>: <text>`, in order. */
const RUBRIC = `# Review rubric

- wrong-comparison: an assignment where a comparison is meant
- unchecked-parse: parsing input that isn't validated or caught
- swallowed-error: a catch block that drops the error
- off-by-one: a bound, index or range that is one too many or too few
- unguarded-null: a value that may be null or undefined used without a check
`;
/** The review's job prompt: the diff and the rubric alone, never a transcript, claim or PR text (#87). */
const prompt = (request: { diff: string; rubric: string[] }): string => [
  'Review this diff against the rubric. Answer with one JSON object and nothing else: {"findings": [{"file": "<path>", "line": <line in the new file>, "rule": "<a rule of the rubric>", "quote": "<the text at that line>"}]}. List only findings on lines the diff adds or changes; an empty list when there are none.',
  '', 'Rubric:', ...request.rubric.map((r) => `- ${r}`), '', 'Diff:', request.diff,
].join('\n');
/** The answer's JSON object, from the job's final text: the whole text, or the outermost braces in it. */
const answerOf = (text: string): unknown => {
  try { return JSON.parse(text); } catch { /* prose around it */ }
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  return from >= 0 && to > from ? JSON.parse(text.slice(from, to + 1)) : undefined;
};
const result = (outcome: CheckResult['outcome'], test: string, file: string, message: string, mask: string | null = null): CheckResult =>
  ({ outcome, testsRun: 0, failures: [{ test, file, line: 1, stack: null, assertion: false, message }], evidence: [], read: [], mask });

/** A number a claim states and the query behind it, cited in its words as (<sql> on <sqlite file>), each part in backticks or not. */
const STATED = /\b(\d[\d,]*(?:\.\d+)?)\b([^()`]*?)\(\s*`?((?:SELECT|WITH)\b(?:[^`()]|\([^`()]*\))*?)`?\s+on\s+`?([\w./-]+)`?\s*\)/gi;
/** The kinds the hub holds, by kind; one without a budget is refused (#68), so no gate run reaches it. */
export class Kinds {
  private readonly held = new Map<string, Held>();
  constructor(private readonly o: KindsOptions) {
    const fills: [CheckRunnerFill, Route[]][] = [
      // Its runs go through runs.ts's own path (#30), with output, attempts and stand-ins the fill's result has no room for.
      [{ slot: 'check.kind@1', revision: 1, kind: 'command', budget: { time_ms: 24 * 3_600_000, cost_usd: 0 }, run: (spec, ctx) => commandCheckKind(o.host()).run(spec, ctx) }, ['spec', 'definition']],
      [reviewFill(() => { throw Error('a review runs only through the hub\'s runner job'); }), ['pr']],
      [numbersFill(), ['number']],
      ...(['service', 'data', 'document', 'message'] as const).map((k): [CheckRunnerFill, Route[]] => [workFill(k), o.plant === 'kind-without-route' && k === 'message' ? [] : ['definition']]),
    ];
    for (const [fill, routes] of fills) if (admitKind(fill).admitted) this.held.set(fill.kind, { fill, routes });
  }
  /** `checks.kinds`: each kind held and the routes a gate run names it by. */
  list(): { kind: string; routes: string[] }[] {
    return [...this.held].map(([kind, h]) => ({ kind, routes: h.routes.map((r) => ROUTES[r]) }));
  }
  /** Whether a gate run may name `kind` by `route`. */
  reaches(kind: string, route: Route): boolean { return this.held.get(kind)?.routes.includes(route) ?? false; }
  /** The deadline a kind's run gets when its check names none: its budget's time. */
  deadline(kind: string): number { return this.held.get(kind)?.fill.budget?.time_ms ?? 0; }

  /** A drafted check's bytes as a kind's spec: a JSON object with check@1's fields naming a kind a definition reaches, else undefined. */
  definitionSpec(bytes: Uint8Array): CheckSpec | undefined {
    let spec: unknown;
    try { spec = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { return undefined; }
    if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return undefined;
    const kind = (spec as { kind?: unknown }).kind;
    return typeof kind === 'string' && kind !== 'command' && this.reaches(kind, 'definition') ? spec as CheckSpec : undefined;
  }
  /** The numbers a claim's words state with the query behind each, cited as `<sql>` on `<sqlite file>`: its numbers spec, or undefined for none. */
  numbersSpec(words: string): NumbersSpec | undefined {
    if (!this.reaches('numbers', 'number')) return undefined;
    const numbers: StatedNumber[] = [...words.matchAll(STATED)].map((m) => ({ where: `the claim's "${`${m[1]}${m[2]}`.trim()}"`, stated: m[1]!, query: { database: m[4]!, sql: m[3]! } }));
    if (!numbers.length) return undefined;
    return { kind: 'numbers', runner: 'sqlite', inputs: [...new Set(numbers.map((n) => n.query.database))], depth: 'unit', oracle: 'code', contract: null, numbers, added: [] };
  }
  /** The words with each number's cited query as plain text: the numbers check re-runs it, so it is no run or file the session cites. */
  uncited(words: string): string {
    return this.reaches('numbers', 'number') ? words.replace(STATED, (m) => m.replaceAll('`', '')) : words;
  }
  /** The review's spec for a claim on a PR: base..head against the rubric your wiki holds (`<root>/wiki/review-rubric.md`), or the shipped one written beside it. */
  reviewSpec(base: string, head: string, root: string): ReviewSpec | undefined {
    if (!this.reaches('review', 'pr')) return undefined;
    let rubric = join(root, 'wiki', 'review-rubric.md');
    if (!existsSync(rubric)) {
      rubric = join(root, 'checks', 'review-rubric.md');
      if (!existsSync(rubric)) { mkdirSync(dirname(rubric), { recursive: true }); writeFileSync(rubric, RUBRIC); }
    }
    return { kind: 'review', runner: 'second-model', inputs: [], depth: 'unit', oracle: 'model', contract: null, base, head, rubric, since: null };
  }

  /** One run of a held kind on `spec` in `ctx`; a review asks its second model through the runner, for `of`'s claim. */
  async run(spec: CheckSpec, ctx: CheckContext, of: ReviewOf): Promise<CheckResult & { round?: ReviewRound }> {
    const held = this.held.get(spec.kind);
    if (!held) return result('missing', `${spec.kind}: run`, '', `BLOCKED: the hub holds no ${spec.kind} check kind`);
    if (spec.kind !== 'review') return held.fill.run(spec, ctx);
    let job: JobRecord | undefined;
    let waiting: string | undefined;
    const reviewer = async (request: { diff: string; rubric: string[] }): Promise<ReviewerAnswer> => {
      job = await this.o.submit({ kind: 'review', agent: of.agent === 'codex' ? 'codex' : 'claude-code', prompt: prompt(request), task: of.task, claim: of.claim, deadline_ms: ctx.deadline });
      // At your reserve the job waits, and the review with it: its check is BLOCKED with the job's cause (#87).
      if (job.state === 'waiting' && job.blocked) {
        waiting = `${job.blocked.cause}${job.blocked.why ? `: ${job.blocked.why}` : ''}`;
        await this.o.cancel(job.job).catch(() => undefined);
        throw Error(waiting);
      }
      if (job.state !== 'finished') job = await this.o.wait(job.job);
      if (job.state !== 'finished') throw Error(`the second model's job ended ${job.state}${job.stop ? ` (${job.stop.cause})` : ''}${job.refused ? `: ${job.refused}` : ''}`);
      const answer = answerOf(job.result ?? '');
      return (typeof answer === 'object' && answer !== null ? answer : {}) as ReviewerAnswer;
    };
    const ran = await reviewFill(reviewer).run(spec as ReviewSpec, ctx);
    if (waiting) return result('missing', 'review: second model', '', `BLOCKED: no second model is free to review the diff (${waiting})`);
    if (!job || job.state !== 'finished') return { outcome: ran.outcome, testsRun: ran.testsRun, failures: ran.failures, evidence: ran.evidence, read: ran.read, mask: ran.mask };
    // A review answered by the change's own model, or by one its output doesn't name, counts neither way (#87).
    const change: ChangeSession = { agent: of.agent, transcript: of.transcript ? readTranscript(of.transcript) : '', route: {} };
    const counted = independence(job.model ?? 'unknown', change);
    if (!counted.counted) return { ...result('uncounted', 'review: second model', '', `the review is uncounted: ${counted.reason!}`, counted.reason), read: ran.read };
    const note = counted.note ? [`${counted.note} (${counted.answered})`] : [];
    return { outcome: ran.outcome, testsRun: ran.testsRun, failures: ran.failures, evidence: [...ran.evidence, ...note], read: ran.read, mask: null, ...(ran.testsRun ? { round: { sent: ran.sendBack?.items ?? [], open: ran.open } } : {}) };
  }
}
const readTranscript = (path: string): string => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
