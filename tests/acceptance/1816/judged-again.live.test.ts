// #1816 AC3 (by hand): #44 is judged again. Runs only with DEEP_LIVE=1, by the maintainer, with their own `gh` sign-in:
// `node scripts/spine.mjs judge --issue 44` in this checkout reads #44's parts from GitHub and runs each part's tests at
// #44's merged commit, and, as the spine does, reopens #44 on GitHub if it doesn't read PASS. Without DEEP_LIVE=1 it
// skips with a reason starting INCONCLUSIVE, so the criterion is never PASS unproven (AGENTS.md invariant 2).
//
// What it holds: #44 gets one judgment, at the commit `list` names, on its criteria by ID; the verdict is PASS exactly
// when every criterion is; every BLOCKED criterion says why (AC5); and no criterion is lost to the checkout's missing
// git history or node_modules: the line never says "not a git repository" and never "the workspaces didn't build".
import { spawnSync } from 'node:child_process';
import { describe, it } from 'vitest';
import { AC3, NODE, REPO, must, type Judged } from './helpers.ts';

const LIVE = process.env.DEEP_LIVE === '1';

describe(`${AC3} #44 is judged again`, () => {
  it(`${AC3} node scripts/spine.mjs judge --issue 44 judges #44 at its merged commit on its criteria, each BLOCKED one saying why`, (ctx) => {
    if (!LIVE) ctx.skip('INCONCLUSIVE: by hand only: run with DEEP_LIVE=1 and your gh sign-in (README, AC3); it can reopen #44 on GitHub');
    const list = spawnSync(NODE, ['scripts/spine.mjs', 'list'], { cwd: REPO, encoding: 'utf8' });
    const listed = /^#44 ([0-9a-f]{40})$/m.exec(list.stdout ?? '')?.[1];
    must(listed !== undefined, `${AC3} \`spine.mjs list\` names #44's merged commit: ${list.stdout}`);
    const r = spawnSync(NODE, ['scripts/spine.mjs', 'judge', '--issue', '44'], { cwd: REPO, encoding: 'utf8', timeout: 8 * 3_600_000, maxBuffer: 1 << 28 });
    must(r.status === 0 || r.status === 1, `${AC3} the judging runs to its end: exit ${r.status}, ${(r.stderr ?? '').slice(-800)}`);
    const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l) as Judged);
    const j = lines.find((l) => l.issue === 44);
    must(j !== undefined && lines.length === 1, `${AC3} #44 is judged once: ${r.stdout}`);
    must(j.commit === listed, `${AC3} #44 is judged at its merged commit ${listed}: ${j.commit}`);
    must(j.criteria.length > 0 && j.criteria.every((c) => c.id.startsWith('#44.')), `${AC3} #44 is judged on its criteria, by ID: ${JSON.stringify(j.criteria)}`);
    must((j.verdict === 'PASS') === j.criteria.every((c) => c.outcome === 'PASS'), `${AC3} #44's verdict is PASS exactly when every criterion is: ${JSON.stringify(j)}`);
    for (const c of j.criteria.filter((x) => x.outcome === 'BLOCKED')) must(Object.entries(c).some(([k, v]) => k !== 'id' && k !== 'outcome' && typeof v === 'string' && v.length > 0), `${AC3} BLOCKED ${c.id} says why: ${JSON.stringify(c)}`);
    const text = JSON.stringify(j);
    must(!/not a git repository/.test(text) && !/the workspaces didn't build/.test(text), `${AC3} no criterion is lost to the checkout's missing git history or node_modules: ${text}`);
    console.log(`${AC3} #44 judged again: ${text}`);
  }, 8 * 3_600_000 + 600_000);
});
