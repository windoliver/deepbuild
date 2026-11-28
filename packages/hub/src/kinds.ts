// The check kinds the hub holds (#1537): each shipped check.kind@1 fill, admitted by its budget, with the routes by
// which a gate run names it. The gate dispatches every claim check that isn't a command through this table, and
// `checks.kinds` reads it back, so a kind held with no route shows as one. The review runs on every claim that opens
// or updates a PR, its second model a runner job under your reserve (#87); the numbers check on every claim whose
// words state a number with the query behind it or a speed with its timing check, or whose diff adds a term to a
// query on its definition's sample (#87, #1863); a work kind where a definition's drafted check names it (#68).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NumbersSpec, StatedNumber } from '@deepbuild/checks-numbers';
import type { ChangeSession, PassFinding, PostClosePass, PostCloseReport, ReviewerAnswer, ReviewSpec, Site } from '@deepbuild/checks-review';
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec } from '@deepbuild/conformance';
import { admitKind } from '@deepbuild/gate';
import type { JobRecord } from '@deepbuild/runner';
import { checkHost } from '@deepbuild/supervisor';
import type { TimingReport } from '@deepbuild/verdicts';
import type { ClaimCheck } from './gate-runner.js';
import { uncitedSpeeds } from './speed.js';
import type { KindsOptions, PassRan, RepoOf, ReviewOf, ReviewRound } from './checks-port.js';
export type { RepoOf, ReviewOf, ReviewRound } from './checks-port.js';

/** A review pass's run on a claim (#2748): the review's spec with the pass as your wiki holds it, and the IDs of the passes whose scope left them out of this claim's diff. */
interface PassSpec extends ReviewSpec { pass: PostClosePass; out: string[] }

/** Each route a gate run names a kind by. */
const ROUTES = {
  spec: 'a check in the repo\'s .deepbuild/done.yaml',
  definition: 'a check a task\'s definition of done names',
  pr: 'every claim that opens or updates a pull request',
  number: 'every claim that states a number with the query behind it, or a speed with its timing check, or whose diff adds a term to a query on its definition\'s sample',
} as const;
type Route = keyof typeof ROUTES;

interface Held { fill: CheckRunnerFill; routes: Route[] }
/**
 * The check kinds a first-party plug-in holds, by the plug-in (#184): a definition reaches each through the extension
 * host, and with its plug-in off the check is BLOCKED, naming the plug-in, never run as a command.
 */
const PLUGIN_KINDS: Record<string, string> = {
  playtest: 'deepbuild/playtest',
  ...Object.fromEntries(['catalog.refs', 'catalog.reach', 'catalog.economy', 'catalog.bounds', 'catalog.copy', 'scenario.reach', 'catalog.dominance'].map((k) => [k, 'deepbuild/catalog'])),
};
/** #194: the spec field each catalog kind's input sits in, which names its catalog by asset ID (#832: dominance too). */
const CATALOG_FIELDS = ['refs', 'reach', 'economy', 'bounds', 'copy', 'scenario', 'dominance'] as const;
/**
 * #194: `spec` with every catalog its kind's input names carried in `catalogs`, the bytes in base64 and the probe's
 * record kept beside them (`catalogs/<sha256>.json`), from the evidence root `evidence`; one it doesn't hold is left
 * out, and the plug-in refuses the check, naming it.
 */
function withCatalogs(spec: CheckSpec, evidence: string | undefined): CheckSpec {
  if (!evidence || PLUGIN_KINDS[spec.kind] !== 'deepbuild/catalog') return spec;
  const named = CATALOG_FIELDS.map((f) => (spec as unknown as Record<string, unknown>)[f] as { catalog?: unknown } | undefined).map((i) => i?.catalog).filter((c): c is string => typeof c === 'string' && /^[0-9a-f]{64}$/.test(c));
  const catalogs: Record<string, { bytes: string; record: unknown }> = {};
  for (const sha of named) {
    try {
      const bytes = readFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)));
      catalogs[sha] = { bytes: bytes.toString('base64'), record: JSON.parse(readFileSync(join(evidence, 'catalogs', `${sha}.json`), 'utf8')) };
    } catch { /* not held: the plug-in names it */ }
  }
  return { ...spec, catalogs } as CheckSpec;
}
/** A plug-in kind's deadline when its check names none. */
const PLUGIN_MS = 3_600_000;

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
/** A review pass's job prompt (#2748): the pass's own prompt, as your wiki holds it, and the diff alone. */
const passPrompt = (pass: string, diff: string): string => [
  pass,
  'Answer with one JSON object and nothing else: {"findings": [{"file": "<path>", "line": <line in the new file>, "rule": "<what is wrong, in a few words>", "quote": "<the text at that line>"}]}. An empty list when there are none.',
  '', 'Diff:', diff,
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
/** Load actual fills at first use; the routing table itself remains part of the core's startup graph. */
export async function openKinds(o: KindsOptions): Promise<Kinds> {
  const [{ reviewFill }, { numbersFill }, { workFill, workKinds }] = await Promise.all([
    import('@deepbuild/checks-review'), import('@deepbuild/checks-numbers'), import('@deepbuild/checks-work'),
  ]);
  return new Kinds(o, [
    // Its runs go through runs.ts's own path (#30), with output, attempts and stand-ins the fill's result has no room for.
    [{ slot: 'check.kind@1', revision: 1, kind: 'command', budget: { time_ms: 24 * 3_600_000, cost_usd: 0 }, run: async (spec, ctx) => (await import('@deepbuild/checks-command')).commandCheckKind(o.host()).run(spec, ctx) }, ['spec', 'definition']],
    [reviewFill(() => { throw Error('a review runs only through the hub\'s runner job'); }), ['pr']],
    [numbersFill(), ['number']],
    ...workKinds().map((k): [CheckRunnerFill, Route[]] => [workFill(k), o.plant === 'kind-without-route' && k === 'message' ? [] : ['definition']]),
  ]);
}

/** The kinds the hub holds, by kind; one without a budget is refused (#68), so no gate run reaches it. */
class Kinds {
  private readonly held = new Map<string, Held>();
  constructor(private readonly o: KindsOptions, fills: [CheckRunnerFill, Route[]][]) {
    for (const [fill, routes] of fills) if (admitKind(fill).admitted) this.held.set(fill.kind, { fill, routes });
  }
  /** `checks.kinds`: each kind held and the routes a gate run names it by. */
  list(): { kind: string; routes: string[] }[] {
    return [...this.held].map(([kind, h]) => ({ kind, routes: h.routes.map((r) => ROUTES[r]) }));
  }
  /** Whether a gate run may name `kind` by `route`. */
  reaches(kind: string, route: Route): boolean { return this.held.get(kind)?.routes.includes(route) ?? (route === 'definition' && kind in PLUGIN_KINDS); }
  /** The deadline a kind's run gets when its check names none: its budget's time. */
  deadline(kind: string): number { return this.held.get(kind)?.fill.budget?.time_ms ?? (kind in PLUGIN_KINDS ? PLUGIN_MS : 0); }

  /** A drafted check's bytes as a kind's spec: a JSON object with check@1's fields naming a kind a definition reaches, else undefined. */
  definitionSpec(bytes: Uint8Array): CheckSpec | undefined {
    let spec: unknown;
    try { spec = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { return undefined; }
    if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return undefined;
    const kind = (spec as { kind?: unknown }).kind;
    return typeof kind === 'string' && kind !== 'command' && this.reaches(kind, 'definition') ? spec as CheckSpec : undefined;
  }
  /** The numbers a claim's words state with the query behind each, cited as `<sql>` on `<sqlite file>`: its numbers spec, or undefined for none. */
  private numbersSpec(words: string): NumbersSpec | undefined {
    const numbers: StatedNumber[] = [...words.matchAll(STATED)].map((m) => ({ where: `the claim's "${`${m[1]}${m[2]}`.trim()}"`, stated: m[1]!, query: { database: m[4]!, sql: m[3]! } }));
    if (!numbers.length) return undefined;
    return { kind: 'numbers', runner: 'sqlite', inputs: [...new Set(numbers.map((n) => n.query.database))], depth: 'unit', oracle: 'code', contract: null, numbers, added: [] };
  }
  /** The words with each number's cited query, and each speed's timing check, as plain text: the numbers check re-runs them, so neither is a run or file the session cites. */
  uncited(words: string): string {
    return this.reaches('numbers', 'number') ? uncitedSpeeds(words.replace(STATED, (m) => m.replaceAll('`', ''))) : words;
  }
  /**
   * The checks a claim's numbers get (#1537, #1863): one for the numbers its words state with the query behind each,
   * as the repo's spec runs them; and each speed its words state with its timing check, and the terms its diff adds to
   * a query on its definition's sample, read in the session's worktree `cwd` against the definition's base. None where
   * the numbers check isn't held with its route.
   */
  async claimChecks(words: string, cwd: string, base: string, sample: string | null): Promise<{ check: ClaimCheck; spec: CheckSpec }[]> {
    if (!this.reaches('numbers', 'number')) return [];
    const cited = this.numbersSpec(words);
    const query = cited ? [{ spec: cited, check: {
      check: `numbers: ${cited.numbers.map((n) => n.stated).join(', ')}`, approved: null, command: cited.numbers.map((n) => `${n.stated}: ${n.query.sql} on ${n.query.database}`).join('; '),
      covers: [], depth: 'unit' as const, on_base: 'passes' as const, asserts: [], source: 'spec' as const,
    } }] : [];
    const { numbersChecks } = await import('./claim-numbers.js');
    return [...query, ...await numbersChecks(words, cwd, base, sample)];
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

  /** Built-in fills get the same supervised scope as extension-host checks, never the kit's local path. */
  private async probe(fill: CheckRunnerFill, spec: CheckSpec, ctx: CheckContext): Promise<CheckResult> {
    const scope = checkHost(this.o.supervisor());
    try { return await fill.run(spec, { ...ctx, host: scope.host }); }
    finally { await scope.close(); }
  }

  /**
   * One run of a review pass (#2748): the pass on the claim's diff, what it finds judged as a review finding is, then
   * its replay on each PR it found bugs in, read as carried where the record keeps one. Its output names what it sent
   * back, the pre-existing findings, the passes whose scope left them out of this diff, and each replay.
   */
  private async passRun(s: PassSpec, checkout: string, ask: (text: string) => Promise<ReviewerAnswer>, kept: (key: string) => Promise<number | undefined>): Promise<CheckResult & { pass?: Omit<PassRan, 'model'> }> {
    const { reviewBeforeCloses } = await import('@deepbuild/checks-review');
    let report: PostCloseReport;
    try {
      report = await reviewBeforeCloses({
        repo: checkout, base: s.base, head: s.head, passes: [s.pass], carried: kept,
        reviewer: async (j) => {
          const answer = await ask(passPrompt(j.prompt, j.diff));
          if (!Array.isArray(answer.findings)) throw Error('the second model\'s answer holds no list of findings');
          return answer.findings as PassFinding[];
        },
      });
    } catch (e) {
      return result('failed', `review pass: ${s.pass.id}`, '', `the review pass stopped before its findings: ${e instanceof Error ? e.message : String(e)}`);
    }
    const mine = report.claim[0]!;
    const site = ({ file, line, quote }: Site): Site => ({ file, line, quote });
    const at = (x: Site): string => `${x.file}:${x.line}`;
    // #2748's planted hubs: one sends back a finding on a line the change didn't add or alter as it does one on an
    // added line; the other records what a pass finds on the claim and sends none of it back.
    const context = this.o.plant === 'pass-sends-back-context' ? mine.followUps.map(site) : [];
    const found = [...mine.sendBack?.sites ?? [], ...context];
    const sites = this.o.plant === 'pass-findings-sent-nowhere' ? [] : found;
    const followUps = context.length ? [] : mine.followUps.map(site);
    const evidence = [
      `review pass ${s.pass.id}: ${sites.length ? `sent back ${sites.map(at).join(', ')}` : `nothing sent back${found.length ? ` of ${found.map(at).join(', ')}` : ''}`}${mine.dropped.length ? `; ${mine.dropped.length} dropped` : ''}`,
      ...(followUps.length ? [`pre-existing, a follow-up: ${s.pass.id} at ${followUps.map(at).join(', ')}`] : []),
      ...(s.out.length ? [`passes out of scope of this diff, not run: ${s.out.join(', ')}`] : []),
      ...(report.replays.length ? [`replays, a reading: ${report.replays.map((r) => `PR ${r.pr} (${r.head.slice(0, 12)}) found ${r.found} of ${r.of}${r.carried ? ', carried' : ''}`).join('; ')}`] : []),
    ].map((line) => line.slice(0, 8000));
    return {
      outcome: sites.length ? 'failed' : 'passed', testsRun: 1, evidence, read: [], mask: null,
      failures: sites.length ? [{ test: `review pass: ${s.pass.id}`, file: sites[0]!.file, line: sites[0]!.line, stack: null, assertion: true, message: `${s.pass.id} at ${sites.map(at).join(', ')}` }] : [],
      pass: { pass: s.pass.id, sent: sites.length ? [{ rule: s.pass.id, sites }] : [], follow_ups: followUps, replays: report.replays.map(({ pass: _pass, ...r }) => r) },
    };
  }

  /** One run of a held kind on `spec` in `ctx`; a review asks its second model through the runner, for `of`'s claim; a speed or added terms read the hub's store for `repo`'s run (#1863). */
  async run(spec: CheckSpec, ctx: CheckContext, of: ReviewOf, repo?: RepoOf): Promise<CheckResult & { round?: ReviewRound; speed?: TimingReport; pass?: PassRan }> {
    const held = this.held.get(spec.kind);
    const plugin = PLUGIN_KINDS[spec.kind];
    if (!held && plugin) {
      const ran = await this.o.extensions()?.runCheck(spec.kind, withCatalogs(spec, this.o.evidence), ctx);
      if (ran && ran.outcome !== 'missing') return ran;
      return result('missing', `${spec.kind}: run`, '', `BLOCKED: the check kind ${spec.kind} is the ${plugin} plug-in's, which isn't loaded`);
    }
    if (!held) return result('missing', `${spec.kind}: run`, '', `BLOCKED: the hub holds no ${spec.kind} check kind`);
    const { claimNumbers, runClaimNumbers } = await import('./claim-numbers.js');
    if (claimNumbers(spec)) {
      if (!repo) return result('missing', `${spec.kind}: run`, '', `BLOCKED: the ${spec.runner} check has no worktree to read its claim's commits from`);
      const checkouts = this.o.checkouts();
      // The baseline side's checkout of its commit, from the session's worktree, held by the run's handle until it ends.
      const checkoutOf = async (commit: string): Promise<{ dir: string; ended(): Promise<void> }> => {
        const t = await checkouts.checkout({ worktree: repo.worktree, commit, runs: [repo.run] });
        return { dir: t.dir, ended: () => checkouts.ended(t, repo.run) };
      };
      return runClaimNumbers(spec, ctx, { supervisor: this.o.supervisor(), store: this.o.store, checkoutOf }, async (s, c) => this.probe(held.fill, s, c), repo.stop);
    }
    if (spec.kind !== 'review') return this.probe(held.fill, spec, ctx);
    let job: JobRecord | undefined;
    let waiting: string | undefined;
    const pass = 'pass' in spec ? spec as PassSpec : undefined;
    // The model that answered a review pass on the claim's own diff (#2748), its first ask: what its replays are kept and read by.
    let answered: string | undefined;
    const ask = async (text: string): Promise<ReviewerAnswer> => {
      // A review pass's job names its task as the issue whose budget covers it (#325).
      job = await this.o.submit({ kind: 'review', agent: of.agent === 'codex' ? 'codex' : 'claude-code', prompt: text, task: of.task, claim: of.claim, ...(pass && of.task ? { issue: of.task } : {}), deadline_ms: ctx.deadline });
      // At your reserve the job waits, and the review with it: its check is BLOCKED with the job's cause (#87).
      if (job.state === 'waiting' && job.blocked) {
        waiting = `${job.blocked.cause}${job.blocked.why ? `: ${job.blocked.why}` : ''}`;
        await this.o.cancel(job.job).catch(() => undefined);
        throw Error(waiting);
      }
      if (job.state !== 'finished') job = await this.o.wait(job.job);
      if (job.state !== 'finished') throw Error(`the second model's job ended ${job.state}${job.stop ? ` (${job.stop.cause})` : ''}${job.refused ? `: ${job.refused}` : ''}`);
      answered ??= job.model ?? 'unknown';
      const answer = answerOf(job.result ?? '');
      return (typeof answer === 'object' && answer !== null ? answer : {}) as ReviewerAnswer;
    };
    const { reviewFill, independence } = await import('@deepbuild/checks-review');
    const ran: CheckResult & { round?: ReviewRound; pass?: Omit<PassRan, 'model'> } = pass
      ? await this.passRun(pass, ctx.checkout, ask, async (key) => of.kept?.(key, answered!))
      : await reviewFill((request) => ask(prompt(request))).run(spec as ReviewSpec, ctx).then((r) => ({ ...r, ...(r.testsRun ? { round: { sent: r.sendBack?.items ?? [], open: r.open } } : {}) }));
    if (waiting) return result('missing', 'review: second model', '', `BLOCKED: no second model is free to review the diff (${waiting})`);
    if (!job || job.state !== 'finished') return { outcome: ran.outcome, testsRun: ran.testsRun, failures: ran.failures, evidence: ran.evidence, read: ran.read, mask: ran.mask };
    // A review answered by the change's own model, or by one its output doesn't name, counts neither way (#87).
    const change: ChangeSession = { agent: of.agent, transcript: of.transcript ? readTranscript(of.transcript) : '', route: of.route };
    const counted = independence(answered ?? 'unknown', change);
    if (!counted.counted) return { ...result('uncounted', 'review: second model', '', `the review is uncounted: ${counted.reason!}`, counted.reason), read: ran.read };
    const note = counted.note ? [`${counted.note} (${counted.answered})`] : [];
    return { outcome: ran.outcome, testsRun: ran.testsRun, failures: ran.failures, evidence: [...ran.evidence, ...note], read: ran.read, mask: null, ...(ran.round ? { round: ran.round } : {}), ...(ran.pass && answered ? { pass: { ...ran.pass, model: answered } } : {}) };
  }
}
const readTranscript = (path: string): string => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
