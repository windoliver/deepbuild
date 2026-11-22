// AC1 #2892.8cdf43e0: "The decision is written in this issue before any code moves, with the inflater's bytes and its
// time on the full player when the answer is Brotli"
//
// The decision is a record, not a program's behaviour, so this test reads the record: the issue's comments, live
// through `gh`, and the change's commits since the merge base.
// asserts:
//   - a comment of the issue records the decision in the form the issue's own decision takes ("**Decision (<date>):
//     gzip" or "…: Brotli"), and its answer is the form this suite's other tests hold the bundle to (`DECIDED`);
//   - when the answer is Brotli, that comment gives the inflater's bytes (a number of B) and its time on the full
//     player (a number of ms);
//   - no commit of the change since the merge base that touches code (any path outside tests/acceptance/ that isn't
//     Markdown) is dated before that comment.
// Wrong programs, judged by the same function on twins made here: an issue with no decision; a code commit dated a day
// before the decision (fails naming the commit); a decision for Brotli without the inflater's bytes or time.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { blocked, none, type JsonValue } from '../172/helpers.ts';
import { AC, DECIDED, git, gitEnv, mergeBase } from './helpers.ts';

interface Comment { body: string; createdAt: string }
interface Commit { sha: string; at: string; paths: string[] }
const DECISION = /^\s*\*\*Decision \((\d{4}-\d{2}-\d{2})\):\s*(gzip|brotli)\b/i;
const isCode = (path: string): boolean => !path.startsWith('tests/acceptance/') && !path.endsWith('.md');

/** What keeps the issue's record from holding the criterion; empty when it holds. */
function decisionFailures(comments: Comment[], commits: Commit[]): string[] {
  const found = comments.map((c) => ({ c, m: DECISION.exec(c.body) })).find((x) => x.m);
  if (!found) return ['the issue holds no comment that records the decision ("**Decision (<date>): gzip" or "…: Brotli")'];
  const f: string[] = [];
  const answer = found.m![2]!.toLowerCase();
  if (answer !== DECIDED) f.push(`the issue decides ${answer}, but this suite holds the bundle to ${DECIDED} (helpers.ts DECIDED)`);
  if (answer === 'brotli') {
    if (!/\d[\d,]*\s*B\b/.test(found.c.body)) f.push('the decision for Brotli gives no inflater bytes (a number of B)');
    if (!/\d[\d,.]*\s*ms\b/.test(found.c.body)) f.push('the decision for Brotli gives no inflater time on the full player (a number of ms)');
  }
  const decided = Date.parse(found.c.createdAt);
  for (const c of commits) {
    const code = c.paths.filter(isCode);
    if (code.length && Date.parse(c.at) < decided) f.push(`commit ${c.sha} moves code (${code[0]}) at ${c.at}, before the decision of ${found.c.createdAt}`);
  }
  return f;
}

describe(`${AC[1]} the decision is written in the issue before any code moves`, () => {
  it(`${AC[1]} the issue records the decision before any commit of the change moves code, with the inflater's bytes and time if it is Brotli`, () => {
    const r = spawnSync('gh', ['issue', 'view', '2892', '--repo', 'windoliver/deepbuild', '--json', 'comments'], { encoding: 'utf8', env: gitEnv(), maxBuffer: 64 << 20 });
    if (r.error || r.status !== 0) blocked(`gh can't read issue #2892 (${r.error?.message ?? (r.stderr ?? '').trim().slice(-400)}). Unblock: install gh and sign in to a GitHub account that can read windoliver/deepbuild`);
    const comments = ((JSON.parse(r.stdout) as { comments?: { body?: JsonValue; createdAt?: JsonValue }[] }).comments ?? [])
      .map((c) => ({ body: String(c.body ?? ''), createdAt: String(c.createdAt ?? '') }));
    const base = mergeBase();
    const commits: Commit[] = [];
    for (const block of git(['log', '--format=%x00%H %cI', '--name-only', `${base}..HEAD`], 'the change\'s commits').split('\0').filter((b) => b.trim())) {
      const [head, ...paths] = block.split('\n').filter(Boolean);
      const [sha, at] = head!.split(' ');
      commits.push({ sha: sha!, at: at!, paths });
    }
    const decision = comments.find((c) => DECISION.test(c.body));
    console.log(`${AC[1]} the decision: ${decision ? `${decision.createdAt}: ${decision.body.split('\n')[0]}` : 'none'}; ${commits.length} commits since ${base}`);
    none(decisionFailures(comments, commits), 'the issue records the decision before any code moves');

    // The same judge on wrong records.
    expect(decisionFailures(comments.filter((c) => !DECISION.test(c.body)), commits), 'an issue with no decision fails').not.toEqual([]);
    const early = { sha: 'f'.repeat(40), at: new Date(Date.parse(decision!.createdAt) - 86_400_000).toISOString(), paths: ['crates/deep-show/src/export/web.rs'] };
    const moved = decisionFailures(comments, [...commits, early]);
    expect(moved.some((f) => f.includes(early.sha)), `a code commit a day before the decision fails, naming it: ${moved.join(' | ')}`).toBe(true);
    const brotli = decisionFailures([{ body: '**Decision (2026-11-19): Brotli.** It fits the budget.', createdAt: decision!.createdAt }], []);
    expect(brotli.some((f) => f.includes('inflater bytes')) && brotli.some((f) => f.includes('inflater time')), `a decision for Brotli without the inflater's bytes and time fails: ${brotli.join(' | ')}`).toBe(true);
  });
});
