// #33 AC3: this repo's next PR carries a verdict. Live only: it reads GitHub, so it runs by hand with DEEP_LIVE=1 and
// your own `gh` sign-in (read-only calls), and skips with that reason otherwise (README, Live tests).
//
// "The next PR" is the first pull request of windoliver/deepbuild created after the commit that added the bootstrap
// `.deepbuild/done.yaml` reached this checkout's history (the gate is on from then). Its head commit must carry a
// commit status in DeepBuild's context, `deepbuild/verdict` (#46), whose state is one #46 posts and whose description
// holds a verdict's word.
import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';
import { AC3, REPO, must } from './helpers.ts';

const LIVE = process.env.DEEP_LIVE === '1';
const SLUG = 'windoliver/deepbuild';
const gitHere = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const gh = (...args: string[]): unknown => JSON.parse(execFileSync('gh', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

describe(`${AC3} this repo's next PR carries a verdict`, () => {
  it.skipIf(!LIVE)(`${AC3} the first PR created after the bootstrap .deepbuild/done.yaml landed has a deepbuild/verdict status on its head commit`, () => {
    const added = gitHere('log', '--diff-filter=A', '--format=%H %cI', '--', '.deepbuild/done.yaml').split('\n').filter(Boolean).pop();
    must(added !== undefined, `${AC3} this checkout's history must hold the commit that added .deepbuild/done.yaml`);
    const [sha, at] = added!.split(' ') as [string, string];
    const prs = gh('pr', 'list', '-R', SLUG, '--state', 'all', '--search', `created:>=${at.slice(0, 19)}`, '--json', 'number,headRefOid,createdAt', '--limit', '200') as { number: number; headRefOid: string; createdAt: string }[];
    const next = prs.filter((p) => p.createdAt >= at).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    must(next !== undefined, `${AC3} no pull request of ${SLUG} was created after ${sha.slice(0, 12)} (${at}) added the bootstrap: open the next PR, then run this again`);
    const statuses = gh('api', `repos/${SLUG}/commits/${next!.headRefOid}/statuses`) as { context: string; state: string; description: string | null }[];
    const ours = statuses.filter((s) => s.context === 'deepbuild/verdict');
    must(ours.length > 0, `${AC3} PR #${next!.number}'s head ${next!.headRefOid.slice(0, 12)} must carry a deepbuild/verdict status: its statuses are ${JSON.stringify(statuses.map((s) => [s.context, s.state])).slice(0, 600)}`);
    const v = ours[0]!;
    must(['success', 'failure', 'error', 'pending'].includes(v.state), `${AC3} the status's state is one #46 posts: ${JSON.stringify(v)}`);
    must(/\b(PASS|FAIL|INVALID|BLOCKED|INCONCLUSIVE|untrusted head)\b/.test(v.description ?? ''), `${AC3} the status's description holds the verdict's word: ${JSON.stringify(v)}`);
    console.log(`${AC3} PR #${next!.number} head ${next!.headRefOid}: deepbuild/verdict ${v.state} "${v.description}"`);
  }, 120_000);
});
