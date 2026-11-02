// AC6, AC26, AC28: the runner's Codex launch, through @deepbuild/runner and a hub, with fixtures/fake-codex.pl as `codex`.
// These tests use tests/acceptance/159's world (the runner's own suite): same repo, same license.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, contentsOf, git, home, makeRepo, sub, tempDir, ulid, uuid, type Line } from '../159/helpers.ts';
import { job, openWorld, room, runJob } from '../159/world.ts';
import type { JobSpec } from '../../../packages/runner/src/index.ts';
import { AC, FIXTURES, parseObject } from './helpers.ts';

afterEach(cleanup, 30_000);
const VERSION = '0.160.0';
function fakeCodex(): string {
  const bin = sub(tempDir(), 'bin');
  copyFileSync(join(FIXTURES, 'fake-codex.pl'), join(bin, 'codex'));
  chmodSync(join(bin, 'codex'), 0o755);
  writeFileSync(join(bin, 'fake-codex.json'), JSON.stringify({ version: VERSION, loginExit: 0 }));
  mkdirSync(join(home(), '.codex'), { recursive: true });
  return bin;
}
const codexJob = (kind: JobSpec['kind'], prompt: string, over: Partial<JobSpec> = {}): JobSpec => ({ ...job(kind, prompt, over), agent: 'codex' });
const started = (stdout: string): Line => {
  for (const l of stdout.split('\n')) {
    const text = parseObject(l)?.item?.text;
    if (typeof text === 'string' && text.startsWith('fake:')) return JSON.parse(text.slice(5)) as Line;
  }
  throw Error(`the fake never reported its start: ${stdout.slice(0, 500)}`);
};
const stdinOf = (stdout: string) => Buffer.from(String(started(stdout).stdin), 'base64').toString('utf8');
const rollout = (session: string | undefined) => { const f = join(home(), '.codex/sessions', `rollout-${session}.jsonl`); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };

// AC6's test is the blind redraft in tests/acceptance/39-redraft (job.test.ts): a job's own temp CODEX_HOME holds no hooks, so its events come from the runner's reading of its output.

// AC26's test is the blind redraft in tests/acceptance/39-redraft-ac26 (the launch is `-s danger-full-access`, by the user's decision: macOS forbids nested Seatbelt).

describe(`${AC[28]} In Codex, #159's end-to-end marker test passes: the drafting job's stdin, its folder and its own transcript hold none of the three markers, and the review's hold the diff's marker and neither of the others; a runner that passes the PR body to the review, or the diff to the drafting job, fails it, naming the marker`, () => {
  it(`${AC[28]} a session's transcript, diff and PR body carry distinct markers; a Codex drafting job and review through the runner hold what the criterion says, by marker`, async () => {
    const bin = fakeCodex();
    const markers = { transcript: `TRANSCRIPT-MARK-${ulid()}`, diff: `DIFF-MARK-${ulid()}`, claim: `CLAIM-MARK-${ulid()}` };
    const repo = makeRepo({ 'README.md': 'A widget.\n' });
    const worktree = sub(tempDir(), 'wt');
    git(repo.dir, 'worktree', 'add', '-q', '-b', 'feature', worktree);
    writeFileSync(join(worktree, 'feature.txt'), `the change ${markers.diff}\n`);
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-q', '-m', 'feature');
    writeFileSync(join(worktree, 'PR_BODY.md'), `Done. ${markers.claim}\n`);
    const session = uuid();
    const transcript = join(home(), '.codex/sessions', `rollout-${session}.jsonl`);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({ type: 'response_item', payload: { role: 'user', content: `make the widget blue ${markers.transcript}` } })}\n`);
    const diff = git(worktree, 'diff', `${repo.base}..HEAD`);
    const w = await openWorld({ loginPath: `${bin}:/usr/bin:/bin` });
    try {
      await room(w);
      const draft = await runJob(w, codexJob('draft', 'Draft the checks for the issue: make the widget blue.', { checkout: { repo: worktree, commit: repo.base } }));
      const review = await runJob(w, codexJob('review', `Review this diff against the issue.\n\n${diff}`, { checkout: { repo: worktree, commit: repo.base } }));
      expect(draft.rec.state, `${AC[28]} the runner runs Codex's drafting job: ${JSON.stringify(draft.rec)}`).toBe('finished');
      expect(review.rec.state, `${AC[28]} and its review: ${JSON.stringify(review.rec)}`).toBe('finished');
      const holds = (what: string, text: string, name: keyof typeof markers, expected: boolean) => expect(text.includes(markers[name]), `${AC[28]} ${what} ${expected ? 'must hold' : 'holds'} the ${name} marker ${markers[name]}`).toBe(expected);
      for (const [what, text] of [['the drafting job\'s stdin', stdinOf(draft.stdout)], ['the drafting job\'s folder', contentsOf(draft.rec.folder).text], ['the drafting job\'s own transcript', rollout(draft.rec.session)]] as const) {
        for (const name of ['transcript', 'diff', 'claim'] as const) holds(what, text, name, false);
      }
      holds('the review\'s stdin', stdinOf(review.stdout), 'diff', true);
      for (const [what, text] of [['the review\'s stdin', stdinOf(review.stdout)], ['the review\'s folder', contentsOf(review.rec.folder).text], ['the review\'s own transcript', rollout(review.rec.session)]] as const) {
        for (const name of ['transcript', 'claim'] as const) holds(what, text, name, false);
      }
    } finally {
      await w.close();
    }
  }, 120_000);
});
