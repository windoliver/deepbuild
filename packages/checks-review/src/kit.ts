// check.kind@1's kit for the review kind (#87), run by the conformance package's one runner. A case is a git history
// the judge builds (a base and the change), the rubric, and the reviewer's recorded answer, which the judge gives the
// fill through `review`, so a fill's own reviewer is never asked. The fixed part holds a planted bug and its clean
// twin, a crashed reviewer and a reviewer past its deadline; the seeded part draws the change's names and lines.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fail, Finding } from '@deepbuild/conformance/findings';
import type { CheckContext, CheckResult, Fixture, PlantedFill, Random, RunOutcome, SlotCase, SlotKitImpl, SlotRule } from '@deepbuild/conformance';
import type { ReviewFill, ReviewSpec, Reviewer, ReviewerAnswer } from './types.js';

const SLOT = 'check.kind@1';
const LONG = 60_000;
/** The deadline case: a reviewer that answers SLOW ms in, against a DEADLINE ms deadline. */
const DEADLINE = 300;
const SLOW = 1500;
const OUTCOMES: readonly RunOutcome[] = ['passed', 'failed', 'ran_nothing', 'missing', 'overran', 'stopped', 'uncounted'];

const RULES = {
  work: { id: 'outcome-from-findings', rule: 'A counted finding on a line the change added is sent back at the check\'s assertion, naming its rule and site; a change with none passes.', message: 'reported a run other than what the findings show', code: 'review_outcome' },
  deadline: { id: 'deadline-holds', rule: 'A review still waiting on its second model at its deadline is overran; an answer that arrives after the deadline is never passed or failed.', message: 'reported a result after the deadline instead of overran', code: 'reported_after_deadline' },
  crash: { id: 'crash-output-kept', rule: 'A review whose second model errs is a crash: failed, its error kept as a failure that isn\'t the check\'s assertion.', message: 'dropped a crashed run\'s output', code: 'crash_output_dropped' },
} as const;
type Rule = keyof typeof RULES;
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

const RUBRIC = '# Review rubric\n\n- unchecked-parse: JSON.parse on input that isn\'t validated or caught\n- swallowed-error: a catch block that drops the error\n';
/** A case: the file before and after the change, what the second model answers (or the error it raises), and when. */
interface Work { file: string; before: string; after: string; answer: ReviewerAnswer | { error: string }; delay_ms: number; deadline: number }
interface Expected { outcome: RunOutcome; assertion?: string; crash?: string }

const readOrder = (line: string): string => `export function readOrder(body: string) {\n${line}\n  return order;\n}\n`;
const flagged = (file: string, line: number, quote: string): ReviewerAnswer =>
  ({ findings: [{ title: 'Parse result is not checked', file, line, rule: 'unchecked-parse', quote }], overall_explanation: 'One concern.' });
const work = (id: string, w: Partial<Work>, expected: Expected): Fixture => ({
  id, expected: expected as unknown as Fixture['expected'],
  input: { file: 'src/orders.ts', before: readOrder('  const order = {};'), after: readOrder('  const order = JSON.parse(body);'), answer: { findings: [] }, delay_ms: 0, deadline: LONG, ...w } as unknown as Fixture['input'],
});
const BUG = flagged('src/orders.ts', 2, 'JSON.parse(body)');

const FIXED: Fixture[] = [
  work('planted-unchecked-parse', { answer: BUG }, { outcome: 'failed', assertion: 'unchecked-parse at src/orders.ts:2' }),
  work('clean-twin', { after: readOrder('  const order = parseOrder(body);'), answer: { findings: [{ file: 'src/orders.ts', line: 2, rule: 'unchecked-parse', quote: 'JSON.parse(body)' }] } }, { outcome: 'passed' }),
  work('crashed-second-model', { answer: { error: 'the review job stopped: agent_crashed' } }, { outcome: 'failed', crash: 'agent_crashed' }),
  work('past-deadline', { answer: BUG, delay_ms: SLOW, deadline: DEADLINE }, { outcome: 'overran' }),
];

function generate(random: Random): SlotCase[] {
  const name = Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz'[random.int(0, 25)]).join('');
  const pad = random.int(0, 5);
  const file = `src/${name}.ts`;
  const lines = (last: string): string => `${Array.from({ length: pad }, (_, i) => `export const ${name}${i} = ${i};`).join('\n')}${pad ? '\n' : ''}${last}\n`;
  const quote = `JSON.parse(${name})`;
  const seeded = (i: number, w: Partial<Work>, expected: Expected): SlotCase => ({
    id: `seeded-${i}`, part: 'seeded', expected: expected as unknown as SlotCase['expected'],
    input: { file, before: lines(''), after: lines(`export const ${name} = ${quote};`), answer: { findings: [] }, delay_ms: 0, deadline: LONG, ...w } as unknown as SlotCase['input'],
  });
  return [
    seeded(1, { answer: flagged(file, pad + 1, quote) }, { outcome: 'failed', assertion: `unchecked-parse at ${file}:${pad + 1}` }),
    // The same finding cited one line off: dropped, so nothing goes back.
    seeded(2, { answer: flagged(file, pad + 2, quote) }, { outcome: 'passed' }),
  ];
}

// ---- Building a case's history, and the judge.

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=Kit', '-c', 'user.email=kit@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();
function history(w: Work): { checkout: string; base: string; head: string } {
  const checkout = mkdtempSync(join(tmpdir(), 'deep-review-kit-'));
  const put = (path: string, text: string): void => { mkdirSync(dirname(join(checkout, path)), { recursive: true }); writeFileSync(join(checkout, path), text); };
  git(checkout, 'init', '-q', '-b', 'main');
  put('rubric.md', RUBRIC);
  put(w.file, w.before);
  git(checkout, 'add', '-A');
  git(checkout, 'commit', '-q', '-m', 'base');
  const base = git(checkout, 'rev-parse', 'HEAD');
  put(w.file, w.after);
  git(checkout, 'commit', '-q', '-am', 'change');
  return { checkout, base, head: git(checkout, 'rev-parse', 'HEAD') };
}
const playback = (w: Work): Reviewer => () => new Promise((resolve, reject) => setTimeout(() => {
  if ('error' in w.answer) reject(new Error(String(w.answer.error)));
  else resolve(JSON.parse(JSON.stringify(w.answer)) as ReviewerAnswer);
}, w.delay_ms));

const grace = (deadline: number): number => Math.max(100, deadline);
const broke = (rule: Rule, detail: string): Finding => fail(RULES[rule].message, [RULES[rule].code], detail);

function hold(answer: unknown, ex: Expected, deadline: number, elapsed: number): void {
  if (typeof answer !== 'object' || answer === null) throw new Finding('FAIL', 'the result is not an object', ['type']);
  const r = answer as Record<string, unknown>;
  if ('verdict' in r) throw new Finding('FAIL', 'the result carries a verdict; a runner reports a run outcome and the core matches it to a verdict', ['unlisted_field']);
  if (!OUTCOMES.includes(r.outcome as RunOutcome)) throw new Finding('FAIL', `outcome ${JSON.stringify(r.outcome)} is not one of the run outcomes`, ['enum']);
  if (!Number.isInteger(r.testsRun) || !Array.isArray(r.failures) || !Array.isArray(r.read)) throw new Finding('FAIL', 'the result lacks its testsRun, failures or read', ['type']);
  const failures = r.failures as CheckResult['failures'];
  const outcome = r.outcome as RunOutcome;
  const shown = failures.map((f) => `${f.assertion ? '(assertion) ' : ''}${f.message}`).join(' | ') || 'no failures';
  if (elapsed > deadline + grace(deadline) && outcome !== 'overran') throw broke('deadline', `reported ${outcome} ${elapsed} ms in, past the ${deadline} ms deadline`);
  if (outcome !== ex.outcome) throw broke('work', `reported ${outcome}; the findings' run is ${ex.outcome} (${shown})`);
  if (ex.assertion && !failures.some((f) => f.assertion && f.message.includes(ex.assertion!))) throw broke('work', `no failure at the check's assertion says "${ex.assertion}" (${shown})`);
  if (ex.crash && !failures.some((f) => !f.assertion && f.message.includes(ex.crash!))) throw broke('crash', `the run stopped on "${ex.crash}", and no failure keeps it (${shown})`);
}

function* judge(fill: ReviewFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const w = c.input as unknown as Work;
  const h = history(w);
  try {
    const spec: ReviewSpec = { kind: 'review', runner: 'second-model', inputs: [], depth: 'unit', oracle: 'model', contract: null, base: h.base, head: h.head, rubric: 'rubric.md', since: null };
    const ctx: CheckContext = { checkout: h.checkout, deadline: w.deadline, now: () => Date.now() };
    const started = Date.now();
    const answer = yield () => fill.review(spec, ctx, playback(w));
    hold(answer, c.expected as unknown as Expected, w.deadline, Date.now() - started);
  } finally {
    rmSync(h.checkout, { recursive: true, force: true });
  }
}

function planted(reference: ReviewFill): PlantedFill<ReviewFill>[] {
  const plant = (name: string, breaks: Rule, review: ReviewFill['review']): PlantedFill<ReviewFill> =>
    ({ name, message: RULES[breaks].message, codes: [RULES[breaks].code], breaks: RULES[breaks].id, fill: { ...reference, review, run: (spec, ctx) => review(spec, ctx, () => { throw new Error('no reviewer'); }) } });
  return [
    plant('misses-the-fault', 'work', async (spec, ctx, reviewer) => {
      const r = await reference.review(spec, ctx, reviewer);
      return r.outcome === 'failed' && r.failures.every((f) => f.assertion) ? { ...r, outcome: 'passed', failures: [], sendBack: null } : r;
    }),
    plant('past-deadline', 'deadline', (spec, ctx, reviewer) => reference.review(spec, { ...ctx, deadline: LONG }, reviewer)),
    plant('dropped-output', 'crash', async (spec, ctx, reviewer) => {
      const r = await reference.review(spec, ctx, reviewer);
      return { ...r, failures: r.failures.filter((f) => f.assertion), evidence: [] };
    }),
  ];
}

export function reviewKit(reference: () => ReviewFill): SlotKitImpl<ReviewFill> {
  return { slot: SLOT, fills: 'one', revision: 1, rules, fixtures: FIXED, planted: planted(reference()), clean: () => [reference()], generate, judge };
}
