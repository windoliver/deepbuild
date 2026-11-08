// #33 AC13: the corpus holds a claim whose test failed on its commit and which is then retried with an empty commit,
// whose run passes: the claim stays FAIL, or INCONCLUSIVE naming the test, and never reaches PASS; its clean twin, a
// commit that fixes the test, passes; a gate that judges the empty commit's run alone fails this test, naming the claim.
//
// The case covering `retry:empty-commit` (README, The corpus): its claim's commits end with one folder named twice in
// a row, so the last commit is empty (a stop after each); it expects FAIL or INCONCLUSIVE, and with INCONCLUSIVE it
// names the test. Its twin starts from the same first commit and then commits a changed tree, the fix. The kit plays
// both on the shipped gate; on the wrong program `empty-commit-run-alone` (DEEP_HUB_PLANT), which judges the empty
// commit's run as if nothing came before it (no verdict reused for the head whose inputs didn't change, #325, and the
// pass after a failure on the same inputs not read as both, #30), the claim reaches PASS and the kit fails, naming it.
import { afterEach, describe, it } from 'vitest';
import { AC13, CORPUS, caseFor, changed, cleanup, expectedOf, kit, kitCaught, kitPassed, must, readManifest, treeOf } from './helpers.ts';

afterEach(cleanup, 60_000);

const PLANT = 'empty-commit-run-alone';

describe(`${AC13} a failing test retried by an empty commit never reaches PASS; the fixing commit does`, () => {
  it(`${AC13} the corpus case ends on an empty commit and expects FAIL or INCONCLUSIVE naming the test; its twin fixes it; the kit judges both as expected`, async () => {
    const c = caseFor(readManifest(), 'retry:empty-commit', AC13);
    const commits = c.claim.commits;
    must(commits.length >= 2 && commits[commits.length - 1] === commits[commits.length - 2], `${AC13} ${c.id}'s claim ends with an empty commit, its last folder named twice in a row: ${JSON.stringify(commits)}`);
    const expected = expectedOf(c.claim);
    must(expected.length > 0 && expected.every((o) => o === 'FAIL' || o === 'INCONCLUSIVE'), `${AC13} ${c.id}'s claim stays FAIL or INCONCLUSIVE: ${JSON.stringify(c.claim.expected)}`);
    if (expected.includes('INCONCLUSIVE')) must((c.claim.names ?? []).length > 0, `${AC13} an INCONCLUSIVE claim names the test: ${JSON.stringify(c.claim.names)}`);
    const twin = c.twin.commits;
    must(twin[0] === commits[0] && twin.length >= 2 && changed(treeOf(CORPUS, c, twin[twin.length - 2]!), treeOf(CORPUS, c, twin[twin.length - 1]!)).length > 0, `${AC13} ${c.id}'s twin starts from the same failing commit, then a commit that changes the tree, the fix: ${JSON.stringify(twin)}`);
    must(expectedOf(c.twin).join() === 'PASS', `${AC13} the twin expects PASS: ${JSON.stringify(c.twin.expected)}`);
    const k = await kit(['run', '--case', c.id]);
    kitPassed(AC13, k, [c.id]);
    const line = k.lines.find((l) => l.id === c.id && l.play === 'claim')!;
    if (line.outcome === 'INCONCLUSIVE') must((c.claim.names ?? []).some((n) => line.reasons.includes(n)), `${AC13} the INCONCLUSIVE names the test: ${line.raw}`);
  }, 1_800_000);

  it(`${AC13} (wrong program) a gate that judges the empty commit's run alone (DEEP_HUB_PLANT=${PLANT}) passes the claim, and the kit fails naming it`, async () => {
    const c = caseFor(readManifest(), 'retry:empty-commit', AC13);
    kitCaught(AC13, await kit(['run', '--case', c.id], { plant: PLANT }), c.id, 'PASS');
  }, 1_800_000);
});
