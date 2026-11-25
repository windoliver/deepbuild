// Criterion 1: the decisions are written into the technical design's Privacy section and the canvas primitives' device
// classes, each with what was not taken and what would reopen it, and you approve them. Offline: the first test reads
// the two docs here and at the base commit; the second also reads this repository's approval tags and checks their
// signatures with ssh-keygen. Code can't judge the text, so the first holds it to a floor of words (README.md, The
// decisions' words) and the second to a person's signature on the commits that wrote it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE, SECTIONS, approvedIn, fileAt, fileHere, gained, git, judgeApproved, judgeDecisions, pieces, readApprovals, sectionIn, sections } from './helpers.mjs';

const CRITERION = 'AC1 #3267.5b43d7cf';

/** What each of the two sections gained since the base: its sentences and table cells the base's section doesn't hold. */
function addedSinceBase() {
  const now = sections(fileHere), before = sections((path) => fileAt(git, BASE, path));
  for (const [key, { file, anchor }] of Object.entries(SECTIONS)) {
    assert.ok(before[key] !== null, `git show ${BASE}:${file} gave no section #${anchor}: the checkout needs the base commit`);
    assert.ok(now[key] !== null, `${file} has no section #${anchor} any more, so nothing can be written into it`);
  }
  return Object.fromEntries(Object.keys(SECTIONS).map((key) => [key, gained(now[key], before[key])]));
}

test(`${CRITERION} the Privacy section and the device classes section each gained text since ${BASE.slice(0, 8)}, and what they gained holds the five Scope decisions, each with "Not taken" and what would reopen it`, () => {
  assert.deepEqual(judgeDecisions(addedSinceBase()), [], 'the decisions are not all written into the two sections');
});

test(`${CRITERION} you approve them: a tag under refs/tags/deep/approved/, signed with a touch or a biometric by a key on .deepbuild/approvers, approves the commits that added the decisions to docs/technical-design.md and docs/canvas-primitives.md`, (t) => {
  const added = addedSinceBase();
  const unwritten = Object.keys(SECTIONS).filter((key) => !added[key].length).map((key) => `${SECTIONS[key].name} (${SECTIONS[key].file}#${SECTIONS[key].anchor})`);
  assert.deepEqual(unwritten, [], `these sections hold no sentence they didn't hold at ${BASE.slice(0, 8)}, so there is no text for an approval to cover`);
  const approvals = readApprovals(git, Object.values(SECTIONS).map(({ file }) => file));
  if (approvals.blocked) {
    t.skip(`INCONCLUSIVE: the approvals can't be read: ${approvals.blocked}`);
    return;
  }
  const approved = Object.fromEntries(Object.entries(SECTIONS).map(([key, { file, anchor }]) => [key, approvedIn(git, approvals.approved, file, (text) => pieces(sectionIn(text, anchor)))]));
  assert.deepEqual(judgeApproved({ added, approved, refused: approvals.refused }), [], 'the decisions the two sections gained are not all approved by a person');
});
