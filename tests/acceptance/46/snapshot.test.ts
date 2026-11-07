// AC10: a verdict on a snapshot posts no commit status until a pushed commit has the snapshot's tree, and then posts it
// on that commit; a poster that posts on HEAD while the worktree differs from it fails this test, naming the commit.
//
// The real gate: an uncommitted edit, a stop, a real check on the claim's snapshot and the real verdict on it, PASS where
// the check's Node runs under the sandbox and INCONCLUSIVE where it can't; the status follows that verdict either way.
// HEAD is pushed and differs from the worktree the whole time. The wrong program is the hub's plant `posts-on-head`.
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { AC10, cleanup, CONTEXT, failureOf, must, PUSH_PROMPT, QUIET_MS, READ_WAIT, sleep, STRANGER, waitFor, World } from './helpers.ts';

afterEach(cleanup, 60_000);
const HUB = 420_000;

async function scenario(seen: { head?: string }, plant?: string): Promise<void> {
  const w = await World.start({ ...(plant ? { plant } : {}) });
  const s = await w.session();
  await s.push();
  const head = seen.head = s.head();
  await s.fix();
  await s.stop('The cart total now uses the new rate.');
  const verdict = await waitFor(async () => (await w.events()).find((e) => e.kind === 'verdict.made'), 90_000, 'a verdict on the snapshot', 250)
    .catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
  if (verdict.data.commit === head) throw Error(`BLOCKED: the verdict covers HEAD ${head}, so no snapshot was made`);

  await sleep(QUIET_MS);
  must(w.forge.statusesOf(head).length === 0, `a status was posted on ${head}, HEAD, while the worktree differs from it: ${JSON.stringify(w.forge.statusesOf(head))}`);
  must(w.forge.statuses.length === 0, `a status was posted before any pushed commit had the snapshot's tree: ${JSON.stringify(w.forge.statuses)}`);

  // A pushed commit with another tree gets nothing either.
  const other = w.outsider(STRANGER);
  const elsewhere = other.commit('elsewhere', { 'docs/elsewhere.md': 'a line\n' });
  other.push('elsewhere');
  await sleep(QUIET_MS);
  must(w.forge.statusesOf(elsewhere).length === 0, `a status was posted on ${elsewhere}, whose tree isn't the snapshot's`);

  await s.typed(PUSH_PROMPT);
  const sha = await s.commit('Fix the cart total');
  await s.push();
  const status = await w.status(sha, READ_WAIT);
  const expected = verdict.data.outcome === 'PASS' ? 'success' : 'pending';
  must(status.state === expected && status.context === CONTEXT, `the snapshot's ${String(verdict.data.outcome)} lands on ${sha}, the pushed commit with its tree, as ${expected}: ${JSON.stringify(status)}`);
  must(status.description.includes(String(verdict.data.outcome)), `its description names the verdict: ${status.description}`);
  must(w.forge.statuses.every((x) => x.sha === sha), `on that commit alone: ${JSON.stringify(w.forge.statuses.map((x) => x.sha))}`);
  const tree = execFileSync('git', ['rev-parse', `${sha}^{tree}`], { cwd: s.cwd, encoding: 'utf8' }).trim();
  must(tree !== execFileSync('git', ['rev-parse', `${head}^{tree}`], { cwd: s.cwd, encoding: 'utf8' }).trim(), 'the commit carries the edit');
}

describe(`${AC10} A verdict on a snapshot posts no commit status until a pushed commit has the snapshot's tree, and then posts it on that commit`, () => {
  it(`${AC10} nothing posts while HEAD differs from the worktree or a pushed commit has another tree; the commit with the snapshot's tree gets the status once pushed`, async () => {
    await scenario({});
  }, HUB);

  it(`${AC10} (planted posts-on-head) a poster that posts on HEAD while the worktree differs from it fails this test, naming the commit`, async () => {
    const seen: { head?: string } = {};
    const failure = await failureOf(() => scenario(seen, 'posts-on-head'));
    expect(failure, 'the scenario must fail on the wrong program').not.toBeNull();
    expect(failure, 'naming HEAD\'s commit').toContain(seen.head);
    expect(failure).toMatch(/posted on [0-9a-f]{40}, HEAD, while the worktree differs from it/);
  }, HUB);
});
