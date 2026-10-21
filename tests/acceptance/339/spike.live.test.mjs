// Live acceptance tests for issue #339: runs the record's commands from the repo root, on macOS, with a
// 10-minute timeout each (they may build the app), and reads the report line each prints. The synthetic run
// needs the Screen Recording permission granted, which a person does once in System Settings; without it the
// test is BLOCKED, never a pass. The held run needs a person to hold the shortcut, so it runs only with
// DEEP_339_HOLD=1 in the environment and is BLOCKED otherwise.
// Run: node --test tests/acceptance/339/spike.live.test.mjs
// With a person at the keyboard: DEEP_339_HOLD=1 node --test tests/acceptance/339/spike.live.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { liveProblems, loadRecord, NO_FRAME, runCommand } from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
const onMac = () => { if (process.platform !== 'darwin') assert.fail('BLOCKED: the capture, its permission flow and the shortcut are macOS\'s; run this on a Mac'); };

test(`${NO_FRAME} at least 200 synthetic presses of the shortcut capture no frame, run now`, () => {
  const record = loadRecord();
  onMac();
  holds(liveProblems(runCommand(record.capture?.command), 'synthetic'));
});

test(`${NO_FRAME} one frame is captured while a person holds the shortcut, run now`, () => {
  const record = loadRecord();
  onMac();
  if (!process.env.DEEP_339_HOLD) assert.fail('BLOCKED: a person must hold the shortcut while this runs; set DEEP_339_HOLD=1 and hold it when the command asks');
  holds(liveProblems(runCommand(record.capture?.heldCommand), 'held'));
});
