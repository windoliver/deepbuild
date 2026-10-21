// Acceptance tests for issue #339, the trusted-input spike, on its record (docs/spikes/339/record.json),
// the files it names and the technical design. Nothing builds or runs the app.
// Run: node --test tests/acceptance/339/spike.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { captureProblems, cardRowProblems, cursorWindowProblems, heldProblems, loadRecord, NO_FRAME, permissionProblems, SENDER, senderProblems } from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);

test(`${NO_FRAME} the recorded run of at least 200 synthetic presses captured no frame, with the permission granted and the shortcut never held, as its kept output says`, () => {
  holds(captureProblems(loadRecord()));
});

test(`${NO_FRAME} one frame was captured while a person held the shortcut, kept as a PNG with its hash, so zero frames without the hold mean something`, () => {
  holds(heldProblems(loadRecord()));
});

test(`${SENDER} the decision says whether macOS names an accessibility action's sender, cites the API or its documented absence, and the question card's rule for VoiceOver follows it`, () => {
  holds(senderProblems(loadRecord()));
});

test(`${SENDER} the written answer is in the technical design's Decided row "Clicks on the question card", which no longer waits on the spike`, () => {
  holds(cardRowProblems(loadRecord()));
});

test('scope: the frame is taken through the macOS Screen Recording permission flow', () => {
  holds(permissionProblems(loadRecord()));
});

test('scope: a small window follows the cursor, in a kept screen recording', () => {
  holds(cursorWindowProblems(loadRecord()));
});
