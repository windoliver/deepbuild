// One review run (#87): the second model reads the diff and the wiki's rubric; its findings are filtered by code.
// A finding counts only with a file, line, rule and quote, its quote at that file and line of the diff read, and its
// rule one of the rubric's; any other is dropped and counted. A counted finding on a context line is pre-existing, a
// follow-up that never sends the claim back; one matching an item already sent back on the claim stays that item.
// The rest go back as one send-back, one item per rule listing every site, with none of the reviewer's prose.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CheckContext, Failure } from '@deepbuild/conformance';
import { diffOf, follow, hunks, newSide, norm } from './diff.js';
import type { DroppedFinding, ReviewerAnswer, ReviewFinding, ReviewResult, ReviewSpec, Reviewer, SendBackItem } from './types.js';

/** The rubric page's rules, `<rule>: <text>`, in order. */
const rubricRules = (page: string): { rule: string; text: string }[] =>
  [...page.matchAll(/^\s*[-*]\s+([A-Za-z0-9][\w.-]*):\s*(.+)$/gm)].map(([, rule, text]) => ({ rule: rule!, text: text!.trim() }));

const nothing = (): Omit<ReviewResult, 'outcome' | 'testsRun' | 'failures' | 'verdictLine'> =>
  ({ evidence: [], read: [], mask: null, sendBack: null, open: [], followUps: [], dropped: [] });

const late = Symbol('late');
/** The reviewer's answer, or `late` once the deadline passed first. */
async function answerBy(reviewer: Reviewer, request: Parameters<Reviewer>[0], deadline: number): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([Promise.resolve().then(() => reviewer(request)), new Promise((r) => { timer = setTimeout(() => r(late), Math.max(1, deadline)); })]);
  } finally {
    clearTimeout(timer);
  }
}

/** Why a finding doesn't count, or null with the finding as it counts. */
function counted(raw: unknown, rules: Set<string>, at: Map<string, string>): { finding: ReviewFinding | null; reason: string } {
  const f = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const missing = (['file', 'line', 'rule', 'quote'] as const).filter((k) =>
    k === 'line' ? !(Number.isInteger(f.line) && (f.line as number) > 0) : !(typeof f[k] === 'string' && (f[k] as string).trim() !== ''));
  if (missing.length) return { finding: null, reason: `no ${missing.join(', ')}` };
  const finding = { file: f.file as string, line: f.line as number, rule: f.rule as string, quote: f.quote as string };
  if (!rules.has(finding.rule)) return { finding: null, reason: `rule ${finding.rule} isn't a rule of the rubric` };
  const line = at.get(`${finding.file}\0${finding.line}`);
  if (line === undefined || !norm(line).includes(norm(finding.quote))) return { finding: null, reason: `the quote isn't at ${finding.file}:${finding.line} in the diff` };
  return { finding, reason: '' };
}

const fourOf = (raw: unknown): DroppedFinding['finding'] => {
  const f = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return { file: f.file, line: f.line, rule: f.rule, quote: f.quote };
};
const sameItem = (item: SendBackItem, f: ReviewFinding): boolean => item.rule === f.rule && item.sites.some((s) => norm(s.quote) === norm(f.quote));

/** The second model's answer judged against the diff it read: findings dropped and why, pre-existing ones, and the
 *  send-back's items, one per rule in the rubric's order, each site once; none matching an item already sent back. */
export function judgeAnswer(diff: string, rules: string[], answer: ReviewerAnswer, sent: SendBackItem[]): { items: SendBackItem[]; followUps: ReviewFinding[]; dropped: DroppedFinding[]; read: string[] } {
  const raw = Array.isArray(answer.findings) ? answer.findings : [];
  const lines = newSide(diff);
  const at = new Map(lines.map((l) => [`${l.file}\0${l.line}`, l.text]));
  const added = new Set(lines.filter((l) => l.added).map((l) => `${l.file}\0${l.line}`));
  const ruleSet = new Set(rules);
  const dropped: DroppedFinding[] = [];
  const followUps: ReviewFinding[] = [];
  const fresh: ReviewFinding[] = [];
  for (const r of raw) {
    const { finding, reason } = counted(r, ruleSet, at);
    if (!finding) dropped.push({ finding: fourOf(r), reason });
    else if (!added.has(`${finding.file}\0${finding.line}`)) followUps.push(finding);
    else if (!sent.some((i) => sameItem(i, finding))) fresh.push(finding);
  }
  const items: SendBackItem[] = [];
  for (const rule of rules) {
    const sites = new Map<string, ReviewFinding>();
    for (const f of fresh) if (f.rule === rule && !sites.has(`${f.file}\0${f.line}`)) sites.set(`${f.file}\0${f.line}`, f);
    if (sites.size) {
      const sorted = [...sites.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
      items.push({ rule, sites: sorted.map(({ file, line, quote }) => ({ file, line, quote })) });
    }
  }
  return { items, followUps, dropped, read: [...new Set(lines.map((l) => l.file))] };
}

export async function review(spec: ReviewSpec, ctx: CheckContext, reviewer: Reviewer): Promise<ReviewResult> {
  const crashed = (why: string): ReviewResult => ({
    ...nothing(), outcome: 'failed', testsRun: 0, verdictLine: 'review: stopped before its findings',
    failures: [{ test: 'review: run', file: spec.rubric, line: 1, stack: null, assertion: false, message: `the review stopped before its assertion: ${why}` }],
  });
  let diff: string;
  let rules: { rule: string; text: string }[];
  try {
    rules = rubricRules(readFileSync(resolve(ctx.checkout, spec.rubric), 'utf8'));
    diff = diffOf(ctx.checkout, spec.since?.commit ?? spec.base, spec.head);
  } catch (e) {
    return crashed(e instanceof Error ? e.message : String(e));
  }
  // A rubric with no rule can send nothing back: the review ran nothing, never a pass.
  if (!rules.length) return { ...nothing(), outcome: 'ran_nothing', testsRun: 0, failures: [], verdictLine: `review: ${spec.rubric} holds no rule (- <rule>: <text>)` };
  let answer: unknown;
  try {
    answer = await answerBy(reviewer, { diff, rubric: rules.map((r) => `${r.rule}: ${r.text}`) }, ctx.deadline);
  } catch (e) {
    return crashed(e instanceof Error ? e.message : String(e));
  }
  if (answer === late) return { ...nothing(), outcome: 'overran', testsRun: 0, failures: [], verdictLine: 'review: overran its deadline' };
  if (!Array.isArray((answer as { findings?: unknown } | null)?.findings)) return crashed('the second model\'s answer holds no list of findings');

  const { items, followUps, dropped, read } = judgeAnswer(diff, rules.map((r) => r.rule), answer as ReviewerAnswer, spec.since?.items ?? []);
  // An earlier item stays open while the commit reviewed leaves every line it cites as it was.
  const since = spec.since;
  const moved = since ? hunks(diffOf(ctx.checkout, since.commit, spec.head, 0)) : [];
  const open = (since?.items ?? []).filter((i) => i.sites.every((s) => follow(s.file, s.line, moved) !== null));

  const failures: Failure[] = items.map((i) => ({
    test: `review: ${i.rule}`, file: i.sites[0]!.file, line: i.sites[0]!.line, stack: null, assertion: true,
    message: `${i.rule} at ${i.sites.map((s) => `${s.file}:${s.line}`).join(', ')}`,
  }));
  const said = [`review: ${items.length ? `sent back ${items.map((i) => `${i.rule} (${i.sites.length})`).join(', ')}` : 'nothing sent back'}`];
  if (open.length) said.push(`${open.length} still open`);
  if (followUps.length) said.push(`pre-existing: ${followUps.map((f) => `${f.rule} at ${f.file}:${f.line}`).join(', ')}`);
  if (dropped.length) said.push(`${dropped.length} dropped`);
  return {
    outcome: items.length ? 'failed' : 'passed', testsRun: 1, failures, evidence: [], read, mask: null,
    sendBack: items.length ? { items } : null, open, followUps, dropped, verdictLine: said.join('; '),
  };
}
