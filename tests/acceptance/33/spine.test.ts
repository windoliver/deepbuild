// #33 AC8 (offline part): once this repo is gated, each of the 25 spine tasks is judged again at its merged commit.
// The judging needs GitHub (the issues' criteria) and hours of runs, so it is spine.live.test.ts; this file holds what
// can be read here: `node scripts/spine.mjs list` names exactly the 25 tasks the `spine` label carries, each with its
// merged commit, a commit of this checkout's history (README, The spine re-judge).
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, it } from 'vitest';
import { AC8, NODE, REPO, SPINE, must } from './helpers.ts';

describe(`${AC8} the 25 spine tasks, each with its merged commit`, () => {
  it(`${AC8} node scripts/spine.mjs list names the 25 spine tasks, each with a merged commit of this checkout's history`, () => {
    const r = spawnSync(NODE, ['scripts/spine.mjs', 'list'], { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
    must(r.status === 0, `${AC8} \`node scripts/spine.mjs list\` must exit 0: exit ${r.status}, ${(r.stderr || r.error?.message || '').slice(0, 600)}`);
    const rows = r.stdout.split('\n').filter(Boolean).map((line) => /^#(\d+) ([0-9a-f]{40})$/.exec(line.trim()));
    must(rows.every(Boolean), `${AC8} each line reads "#<issue> <40-hex merged commit>": ${r.stdout.slice(0, 600)}`);
    const listed = rows.map((m) => Number(m![1])).sort((a, b) => a - b);
    must(JSON.stringify(listed) === JSON.stringify(SPINE), `${AC8} the list is exactly the 25 spine tasks ${SPINE.join(', ')}: it names ${listed.join(', ')}`);
    for (const m of rows) {
      const sha = m![2]!;
      const known = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: REPO }).status === 0;
      must(known, `${AC8} #${m![1]}'s merged commit ${sha} is in this checkout's history`);
      const subject = execFileSync('git', ['log', '-1', '--format=%s', sha], { cwd: REPO, encoding: 'utf8' }).trim();
      must(subject.length > 0, `${AC8} #${m![1]}'s merged commit ${sha} reads as a commit: ${subject}`);
    }
  }, 120_000);
});
