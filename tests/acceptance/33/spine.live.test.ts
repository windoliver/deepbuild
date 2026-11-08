// #33 AC8 (live): once this repo is gated, each of the 25 spine tasks is judged again at its merged commit against its
// issue's criteria and the tests it landed; a spine task that doesn't reach PASS reopens before week 4 starts, naming
// the criterion. Runs by hand with DEEP_LIVE=1 and your own `gh` sign-in (it reads the issues, and the re-judge runs
// every spine task's tests at its commit, for hours); skips with that reason otherwise.
//
// `node scripts/spine.mjs judge` prints one JSON line per task (README, The spine re-judge). For each: the commit is the
// one `list` names; every criterion of the issue is judged, by its ID `#<issue>.<hash>`; the task's verdict is PASS
// exactly when every criterion's is; and a task that isn't PASS names, in `reopen.criterion`, a criterion that isn't
// PASS, and on GitHub it is open again with a comment naming that criterion.
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, it } from 'vitest';
import { AC8, NODE, REPO, SPINE, must } from './helpers.ts';

const LIVE = process.env.DEEP_LIVE === '1';
const SLUG = 'windoliver/deepbuild';
interface Judged { issue: number; commit: string; verdict: string; criteria: { id: string; outcome: string }[]; reopen: { criterion: string } | null }

describe(`${AC8} each spine task judged again at its merged commit; one that doesn't PASS reopens naming the criterion`, () => {
  it.skipIf(!LIVE)(`${AC8} node scripts/spine.mjs judge: 25 tasks judged on their criteria; each non-PASS task reopened naming a criterion`, () => {
    const list = spawnSync(NODE, ['scripts/spine.mjs', 'list'], { cwd: REPO, encoding: 'utf8' });
    const commits = new Map(list.stdout.split('\n').flatMap((l) => { const m = /^#(\d+) ([0-9a-f]{40})$/.exec(l.trim()); return m ? [[Number(m[1]), m[2]!] as const] : []; }));
    const r = spawnSync(NODE, ['scripts/spine.mjs', 'judge'], { cwd: REPO, encoding: 'utf8', timeout: 8 * 3_600_000, maxBuffer: 256 * 1024 * 1024 });
    must(r.status === 0 || r.status === 1, `${AC8} the re-judge must run to its end (exit 0 all PASS, 1 some not): exit ${r.status}, ${(r.stderr || '').slice(-800)}`);
    const judged = r.stdout.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l) as Judged);
    must(JSON.stringify(judged.map((j) => j.issue).sort((a, b) => a - b)) === JSON.stringify(SPINE), `${AC8} every spine task is judged once: ${judged.map((j) => j.issue).join(', ')}`);
    for (const j of judged) {
      must(j.commit === commits.get(j.issue), `${AC8} #${j.issue} is judged at its merged commit ${commits.get(j.issue)}: ${j.commit}`);
      must(j.criteria.length > 0 && j.criteria.every((c) => c.id.startsWith(`#${j.issue}.`)), `${AC8} #${j.issue} is judged on its issue's criteria, by ID: ${JSON.stringify(j.criteria)}`);
      const allPass = j.criteria.every((c) => c.outcome === 'PASS');
      must((j.verdict === 'PASS') === allPass, `${AC8} #${j.issue}'s verdict is PASS exactly when every criterion is: ${JSON.stringify(j)}`);
      if (j.verdict === 'PASS') continue;
      const named = j.reopen?.criterion;
      must(named !== undefined && j.criteria.some((c) => c.id === named && c.outcome !== 'PASS'), `${AC8} #${j.issue} didn't reach PASS, so it reopens naming a criterion that isn't PASS: ${JSON.stringify(j)}`);
      const issue = JSON.parse(execFileSync('gh', ['issue', 'view', String(j.issue), '-R', SLUG, '--json', 'state,comments'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as { state: string; comments: { body: string }[] };
      must(issue.state === 'OPEN', `${AC8} #${j.issue} is open again: ${issue.state}`);
      must(issue.comments.some((c) => c.body.includes(named!)), `${AC8} #${j.issue}'s reopening names ${named} in a comment`);
    }
  }, 8 * 3_600_000 + 600_000);
});
