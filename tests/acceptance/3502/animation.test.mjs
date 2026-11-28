// #3502, seventh criterion: on each reference Mac, a 300-frame animation in the app's focused window presents at the
// display's rate, and no frame waits more than 4 ms for its drawable (drafted), read from the present times the
// carried hook reports; the merge base's reading is recorded beside it; off a reference Mac this reads INCONCLUSIVE
// (README: The animation).
//
// The reading is taken in `deep-show live`: a looping film in the app's real window, a release build, five runs
// after a warm-up one, each judged on the first 300 frames presented after the film's first pass, and the two
// limits by the budgets' own
// `judgeLimit` (scripts/benchmark.mjs). The machine is read before anything is built: off a reference Mac, on
// battery, in Low Power Mode, warm or loaded, the test is INCONCLUSIVE, naming which. The second test holds the
// record of both sides' readings to its shape; it runs on any machine.
// Run: node --test tests/acceptance/3502/animation.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocked, EVIDENCE, inconclusive, judgeLimit, load, read, referenceModels, releaseBinary, REPO, timingProblem } from './common.mjs';
import { ANIMATION_FRAMES, animationReading, DRAWABLE_WAIT_MS, film, filmSpanNs, judgeFrameRecord, liveRun, scenario } from './show.mjs';

/** Where the head's reading and the merge base's are kept (README: The records). */
const RECORD = `${EVIDENCE}/frames.json`;
/** The film's first pass, then long enough for 300 frames at a third of a 60 Hz display's rate. */
const WATCH = { watch_from: 'first_frame', watch_ms: filmSpanNs() / 1e6 + 15_000 };
const RUNS = 5;

test('AC7 #3502.f53607ef on a reference Mac, a 300-frame animation in the app\'s focused window presents at the display\'s rate, and no frame waits more than 4 ms for its drawable', { timeout: 3 * 3_600_000 }, async () => {
  const off = await timingProblem();
  if (off) inconclusive(off);
  const bin = releaseBinary('deep-show');
  const take = (what) => animationReading(liveRun(bin, scenario(film(), WATCH)), what);
  take('the warm-up run');
  const readings = [], loads = [];
  for (let run = 1; run <= RUNS; run += 1) {
    const start = load();
    readings.push(take(`run ${run}`));
    loads.push({ start, end: load() });
  }
  const said = readings.map((reading, index) => `run ${index + 1}: ${ANIMATION_FRAMES} frames over ${reading.refreshes} refreshes at ${reading.hz} Hz; frame ${reading.slowest} waited ${reading.worstWaitMs.toFixed(3)} ms for its drawable`);
  console.log(`AC7\n${said.join('\n')}`);
  const [rate, wait] = [await judgeLimit(ANIMATION_FRAMES, readings.map(({ refreshes }) => refreshes), loads), await judgeLimit(DRAWABLE_WAIT_MS, readings.map(({ worstWaitMs }) => worstWaitMs), loads)];
  for (const verdict of [rate, wait]) {
    if (verdict.status === 'BLOCKED') blocked(verdict.reason);
    if (verdict.status === 'INCONCLUSIVE') inconclusive(verdict.reason, said);
  }
  assert.equal(rate.status, 'PASS', `the animation presents at the display's rate, ${ANIMATION_FRAMES} frames in ${ANIMATION_FRAMES} refreshes: ${rate.reason}\n${said.join('\n')}`);
  assert.equal(wait.status, 'PASS', `no frame waits more than ${DRAWABLE_WAIT_MS} ms for its drawable: ${wait.reason}\n${said.join('\n')}`);
});

test('AC7 #3502.f53607ef the merge base\'s reading is recorded beside the head\'s, both taken on one reference Mac', async () => {
  assert.deepEqual(judgeFrameRecord(read(REPO, RECORD), await referenceModels(), RECORD), []);
});
