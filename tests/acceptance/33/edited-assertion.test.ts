// #33 AC7: the corpus holds a claim whose diff edits only the assertion an approved check reads, which never reaches
// PASS, and its clean twin, which does; a gate that counts the edited check as approved passes the first and fails the
// kit, naming the claim.
//
// The case covering `edited-assertion` (README, The corpus): its base holds an approved spec (.deepbuild/done.yaml);
// its claim's commit changes exactly one file from the base, a test file, and every line it adds or removes is an
// assertion (expect or assert). Its claim expects anything but PASS (the design's seeded case: INCONCLUSIVE), its twin
// PASS. The kit on the shipped gate judges both as expected; on the wrong program `edited-check-approved`
// (DEEP_HUB_PLANT) the claim reaches PASS and the kit fails, its line naming the case.
import { afterEach, describe, it } from 'vitest';
import { AC7, CORPUS, addedLines, caseFor, changed, cleanup, expectedOf, kit, kitCaught, kitPassed, must, readManifest, treeOf } from './helpers.ts';

afterEach(cleanup, 60_000);

const PLANT = 'edited-check-approved';
const TEST_FILE = /(^|\/)(tests?|spec|__tests__)\/|\.test\.|\.spec\.|_test\.|(^|\/)test_/;
const ASSERTION = /\b(expect|assert)/;

describe(`${AC7} a diff that edits only an approved check's assertion never reaches PASS; its twin does`, () => {
  it(`${AC7} the corpus case: one test file changed, only assertion lines, under an approved spec; the kit judges the claim not PASS and the twin PASS`, async () => {
    const c = caseFor(readManifest(), 'edited-assertion', AC7);
    const base = treeOf(CORPUS, c, 'base');
    must(base.has('.deepbuild/done.yaml'), `${AC7} ${c.id}'s base holds the approved spec, .deepbuild/done.yaml: its files are ${[...base.keys()].join(', ')}`);
    const head = treeOf(CORPUS, c, c.claim.commits[c.claim.commits.length - 1]!);
    const diff = changed(base, head);
    must(diff.length === 1, `${AC7} ${c.id}'s claim edits one file only: it changes ${JSON.stringify(diff)}`);
    const file = diff[0]!;
    must(TEST_FILE.test(file) && base.has(file) && head.has(file), `${AC7} the file it edits is an existing test file an approved check reads: ${file}`);
    const lines = [...addedLines(base.get(file), head.get(file)), ...addedLines(head.get(file), base.get(file))].filter((l) => l.trim());
    must(lines.length > 0 && lines.every((l) => ASSERTION.test(l)), `${AC7} every line the claim adds or removes in ${file} is an assertion: ${JSON.stringify(lines)}`);
    must(!expectedOf(c.claim).includes('PASS'), `${AC7} the claim expects a verdict other than PASS: ${JSON.stringify(c.claim.expected)}`);
    must(expectedOf(c.twin).join() === 'PASS', `${AC7} the twin expects PASS: ${JSON.stringify(c.twin.expected)}`);
    kitPassed(AC7, await kit(['run', '--case', c.id]), [c.id]);
  }, 1_800_000);

  it(`${AC7} (wrong program) a gate that counts the edited check as approved (DEEP_HUB_PLANT=${PLANT}) passes the claim, and the kit fails naming it`, async () => {
    const c = caseFor(readManifest(), 'edited-assertion', AC7);
    kitCaught(AC7, await kit(['run', '--case', c.id], { plant: PLANT }), c.id, 'PASS');
  }, 1_800_000);
});
