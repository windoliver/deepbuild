// AC10: before "Closes", the review check also runs each review pass that found bugs after a close in this repo, such
// as research against outside references or a code audit; replayed on those PRs' commits, how many of the bugs it
// finds is a reading over that sample, reported in Decision 1's numbers (#43) and never a pass or a fail; a pass that
// wasn't run on one of those commits fails this test, naming the PR.
//
// A real git repository: PR 64 (src/fetch.ts) and PR 71 (src/cache.ts) were merged and closed, and bugs were found in
// them afterwards by two passes: research against outside references found the fetch with no timeout in PR 64 and
// the seconds-for-milliseconds comparison in PR 71; a code audit found the unchecked JSON.parse and the same
// comparison in PR 71. The claim's own change, base..head, adds src/sync.ts. The second model is the boundary: a
// planted reviewer, deterministic, stands in for each pass's job and records every diff it was given. It flags, for
// research, a fetch with no timeout; for the audit, an unchecked JSON.parse and a Date.now() difference compared with
// a bare number. So research finds 1 of its 2 bugs and the audit 2 of 2.
import { describe, it } from 'vitest';
import type { PassFinding, PassReviewer, PostClosePass, PostCloseReport } from '../../../../packages/checks-review/src/index.ts';
import { AC10, commit, failureOf, gitRepo, must, review } from './helpers.ts';

const FETCH_TS = "export async function load(url: string) {\n  const res = await fetch(url);\n  return res.json();\n}\n";
const CACHE_TS = "export function read(raw: string) {\n  return JSON.parse(raw);\n}\nexport function stale(at: number) {\n  return Date.now() - at > 60;\n}\n";
const SYNC_TS = "export async function sync(api: string, body: string) {\n  const data = JSON.parse(body);\n  const res = await fetch(api, { method: 'POST', body: JSON.stringify(data) });\n  return res.ok;\n}\n";

interface World { cwd: string; base: string; head: string; passes: PostClosePass[] }
function world(): World {
  const { cwd, first } = gitRepo({ 'README.md': '# shop\n' });
  const pr64 = commit(cwd, { 'src/fetch.ts': FETCH_TS }, 'Load orders over HTTP (#64)');
  const pr71 = commit(cwd, { 'src/cache.ts': CACHE_TS }, 'Cache the order list (#71)');
  const head = commit(cwd, { 'src/sync.ts': SYNC_TS }, 'Sync orders to the API');
  const passes: PostClosePass[] = [
    {
      id: 'research', name: 'research against outside references', prompt: 'Check each call against the documentation of what it calls.',
      found: [
        { pr: 64, base: first, head: pr64, bugs: [{ file: 'src/fetch.ts', line: 2 }] },
        { pr: 71, base: pr64, head: pr71, bugs: [{ file: 'src/cache.ts', line: 5 }] },
      ],
    },
    {
      id: 'audit', name: 'a code audit', prompt: 'Audit the change for unchecked input and unit mistakes.',
      found: [{ pr: 71, base: pr64, head: pr71, bugs: [{ file: 'src/cache.ts', line: 2 }, { file: 'src/cache.ts', line: 5 }] }],
    },
  ];
  return { cwd, base: pr71, head, passes };
}

/** The added lines of a unified diff, by file and new line number. */
function added(diff: string): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  let file = '';
  let line = 0;
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) { file = text.slice(4).replace(/^b\//, ''); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (text.startsWith('+')) out.push({ file, line: line++, text: text.slice(1) });
    else if (text.startsWith(' ')) line++;
  }
  return out;
}
interface Call { pass: string; commit: string; diff: string }
/** The planted reviewer: each pass's rules over the diff's added lines, every call recorded. */
function plantedReviewer(calls: Call[]): PassReviewer {
  const rules: Record<string, { rule: string; flags: (t: string) => boolean }[]> = {
    research: [{ rule: 'fetch-without-timeout', flags: (t) => /\bfetch\(/.test(t) && !/timeout|signal/.test(t) }],
    audit: [
      { rule: 'unchecked-json-parse', flags: (t) => /JSON\.parse\(/.test(t) },
      { rule: 'time-units', flags: (t) => /Date\.now\(\) - \w+ [<>]=? \d+;/.test(t) },
    ],
  };
  return async (job) => {
    calls.push({ pass: job.pass, commit: job.commit, diff: job.diff });
    return added(job.diff).flatMap((a) => (rules[job.pass] ?? []).filter((r) => r.flags(a.text)).map((r): PassFinding => ({ file: a.file, line: a.line, rule: r.rule, quote: a.text.trim() })));
  };
}

const PR_LINE: Record<number, string> = { 64: 'const res = await fetch(url);', 71: 'return JSON.parse(raw);' };
const EXPECTED: Record<string, { found: number; of: number; prs: number[]; claim: string[] }> = {
  research: { found: 1, of: 2, prs: [64, 71], claim: ['fetch-without-timeout src/sync.ts:3'] },
  audit: { found: 2, of: 2, prs: [71], claim: ['unchecked-json-parse src/sync.ts:2'] },
};
const VERDICT_WORDS = /^(PASS|FAIL|INVALID|BLOCKED|INCONCLUSIVE|passed|failed)$/;

/** The criterion, judged against the passes the repo holds (`passes`), whatever the program ran. */
function judge(w: World, passes: PostClosePass[], report: PostCloseReport, calls: Call[]): void {
  for (const p of passes) {
    for (const f of p.found) {
      const ran = calls.some((c) => c.pass === p.id && c.commit === f.head && c.diff.includes(PR_LINE[f.pr]!));
      must(ran, `${AC10} the pass "${p.name}" found bugs in PR ${f.pr} after its close, so before Closes it is replayed on PR ${f.pr}'s commit ${f.head.slice(0, 12)}: it wasn't run on that commit's diff; it ran on ${calls.filter((c) => c.pass === p.id).map((c) => c.commit.slice(0, 12)).join(', ') || 'nothing'}`);
      must(report.replays.some((r) => r.pass === p.id && r.pr === f.pr && r.head === f.head), `${AC10} the report lists the pass "${p.name}" replayed on PR ${f.pr} (${f.head.slice(0, 12)}): its replays are ${JSON.stringify(report.replays)}`);
    }
    const want = EXPECTED[p.id]!;
    must(calls.some((c) => c.pass === p.id && c.commit === w.head && c.diff.includes('src/sync.ts')), `${AC10} before Closes the pass "${p.name}" also runs on the claim's own diff (${w.base.slice(0, 12)}..${w.head.slice(0, 12)}, src/sync.ts): it didn't`);
    const onClaim = (report.claim.find((c) => c.pass === p.id)?.findings ?? []).map((f) => `${f.rule} ${f.file}:${f.line}`).sort();
    must(JSON.stringify(onClaim) === JSON.stringify(want.claim), `${AC10} the pass "${p.name}" on the claim's diff brings back what its reviewer found, ${want.claim.join(', ')}: the report holds ${onClaim.join(', ') || 'none'}`);
    const reading = report.readings.find((r) => r.pass === p.id);
    must(reading !== undefined && reading.found === want.found && reading.of === want.of && JSON.stringify([...reading.prs].sort((a, b) => a - b)) === JSON.stringify(want.prs),
      `${AC10} how many of the bugs the pass "${p.name}" finds on PRs ${want.prs.join(' and ')} is a reading, ${want.found} of ${want.of}: the report's readings are ${JSON.stringify(report.readings)}`);
    must(reading.measure === 'post-close review pass', `${AC10} the reading is Decision 1's measure "post-close review pass" (#43): ${JSON.stringify(reading)}`);
  }
  // A reading, never a pass or a fail: no verdict word anywhere in the readings, and no outcome on the report.
  const words = JSON.stringify(report.readings).match(/"[^"]*"/g)?.map((s) => s.slice(1, -1)).filter((s) => VERDICT_WORDS.test(s)) ?? [];
  must(!words.length && !('outcome' in report) && report.readings.every((r) => !('outcome' in r)), `${AC10} the replay's count is a reading, never a pass or a fail: the report carries ${words.join(', ') || 'an outcome'}`);
}

async function played(skipPr?: number): Promise<{ w: World; report: PostCloseReport; calls: Call[] }> {
  const { reviewBeforeCloses } = await review();
  const w = world();
  const calls: Call[] = [];
  // The wrong program: a check that runs each pass on every PR it found bugs in but one.
  const passes = skipPr === undefined ? w.passes : w.passes.map((p) => ({ ...p, found: p.found.filter((f) => f.pr !== skipPr) }));
  const report = await reviewBeforeCloses({ repo: w.cwd, base: w.base, head: w.head, passes, reviewer: plantedReviewer(calls) });
  return { w, report, calls };
}

describe(`${AC10} before Closes, each review pass that found bugs after a close runs, and its replay on those PRs is a reading`, () => {
  it(`${AC10} research and the audit each run on the claim's diff and on every PR they found bugs in (64, 71); research reads 1 of 2, the audit 2 of 2, never a pass or a fail`, async () => {
    const { w, report, calls } = await played();
    judge(w, w.passes, report, calls);
  });

  it(`${AC10} (wrong program) a check that doesn't run the passes on PR 71's commit fails this test, naming PR 71`, async () => {
    const failure = await failureOf(async () => {
      const { w, report, calls } = await played(71);
      judge(w, w.passes, report, calls);
    });
    must(failure !== null, `${AC10} the check that skips PR 71 must fail this test: it passed`);
    must(failure.startsWith(AC10) && failure.includes('PR 71'), `${AC10} the failure names PR 71; it said: ${failure}`);
  });
});
