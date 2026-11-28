import { afterEach, describe, expect, test } from 'vitest';
import { CHECK, cleanup, LIMIT, q } from '../999/helpers.ts';
import { AC, begin, CODE, edits, exitedZeroThere, proof, said, shownClaim, stopAndClaim } from './helpers.ts';

afterEach(cleanup, 900_000);

const FAILED = /fail|couldn[’']t|could not|can[’']t|cannot|unread|not read|timed out|deadline/i;
const OF_CHANGES = /chang|diff|git/i;

describe(AC[3], () => {
  test('with git failing on the host for the read of what the claim changed, a claim whose check exits 0 there gets a verdict other than PASS before its stop hold ends, naming the failed read', async () => {
    const sc = await begin('test-file');
    await edits(sc, CODE, '17.00\n');
    const git = await sc.w.host.must([
      `cd ${q(sc.repo)} || exit 9`,
      'printf \'not an index\\n\' > .git/index',
      `if git diff --name-only --no-renames ${sc.base} >/dev/null 2>&1; then echo "git diff still reads what changed" >&2; exit 8; fi`,
      'if git status --porcelain >/dev/null 2>&1; then echo "git status still reads what changed" >&2; exit 8; fi',
      'if git ls-files --others --exclude-standard >/dev/null 2>&1; then echo "git ls-files still lists the untracked files" >&2; exit 8; fi',
      `[ "$(git rev-parse -q --verify HEAD)" = ${sc.base} ] || { echo "the folder's HEAD no longer reads as the base" >&2; exit 8; }`,
      `git diff --name-only --no-renames ${sc.base} 2>&1 | tail -n 1`,
    ].join('\n'));
    const c = await stopAndClaim(sc, true);
    exitedZeroThere(sc, c);
    const held = c.verdicts.filter((v) => v.log_pos < c.stopped);
    const names = said(c.verdicts.at(-1));
    proof(sc.w, 'ac3-failed-read.json', { host: sc.w.alias, base: sc.base, edited: [CODE], git_there: git.trim(), claim: c.id, outcome: c.outcome, runs: c.runs, verdicts: c.verdicts.map((v) => ({ log_pos: v.log_pos, before_the_hold_ended: v.log_pos < c.stopped, ...v.data })) });
    const read = sc.w.redact(shownClaim(c));

    expect.soft(c.verdicts.filter((v) => v.data.outcome === 'PASS').length, `with the read of what the claim changed failing on ${sc.w.alias} (${git.trim()}), ${CHECK} must not pass the claim: no verdict of it reads PASS. ${read}`).toBe(0);
    expect.soft(String(held.at(-1)?.data.outcome ?? 'no verdict yet'), `when the session's Stop hook has returned on ${sc.w.alias}, its hold over, the claim already has a verdict, and it isn't PASS: ${read}`).toMatch(/^(FAIL|INVALID|BLOCKED|INCONCLUSIVE)$/);
    expect.soft(names.filter((t) => FAILED.test(t) && OF_CHANGES.test(t)), `the claim's newest verdict names the failed read of what the claim changed on ${sc.w.alias}: ${read}`).not.toEqual([]);
  }, LIMIT);
});
