// Acceptance tests for issue #1433 (spike: a second toolkit and gpui-kit's gpui-fast backend against the app's
// must-haves), on what the spike keeps and nothing else: docs/spikes/1433/record.json, its copy of the gates and the
// raw readings the record cites. No reading is taken here and no harness is run: each gate's verdict, each reading
// the record names and each arm's last line are worked out from the kept raw readings and compared with the record.
// A gate that passed holds. A gate that failed is the spike's result: it holds when the record says so and ends the
// arm closed with it. A gate that isn't decided reads INCONCLUSIVE, or BLOCKED for a person's gate no person took,
// and fails its test, except on an arm another gate's kept reading closes (README: Readings).
// Run: node --test tests/acceptance/1433/record.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { gateProblems, gpuiFastProblems, loadRecord, plantedProblems, recordProblems } from './validate.mjs';

/** The kept record, or the test fails: on the merge base there is none. */
function spike(tag) {
  const { record, problems } = loadRecord();
  assert.deepEqual(problems, [], `${tag}:\n${problems.join('\n')}`);
  return record;
}
const holds = (t, tag, { problems, notes = [] }) => {
  for (const note of notes) t.diagnostic(note);
  assert.deepEqual(problems, [], `${tag}:\n${problems.join('\n')}`);
};
const gate = (tag, name) => (t) => holds(t, tag, gateProblems(name, spike(tag)));
const planted = (tag, name) => (t) => holds(t, tag, plantedProblems(name, spike(tag)));

test('AC1 #1433.c0b58a25 canvas handoff: the slots show in the candidate\'s window with a translucent fixture and the #140 colour check, at under 1 ms at 1936 × 1584 over five runs, matching the headless canvas', gate('AC1 #1433.c0b58a25', 'canvas-handoff'));

test('AC2 #1433.8f63851f idle: the same window under canvas-idle has 0 frames and at most 1 wakeup over five runs', gate('AC2 #1433.8f63851f', 'idle'));

test('AC3 #1433.450e5804 long list and transcript: the 1,000-row list plus a streaming transcript, in a real window, in paired alternating runs, meets the 4 ms update budget at p99 and #337\'s cold-start, idle, memory and size numbers, for the candidate and for gpui-fast', gate('AC3 #1433.450e5804', 'list-transcript'));

test('AC4 #1433.9d8646d2 a person types Pinyin, Kotoeri, dictation and the emoji picker into a text area with no lost composition, wrong commit or misplaced candidate window', gate('AC4 #1433.9d8646d2', 'text-input'));

test('AC5 #1433.27d27bbc a person walks the window with VoiceOver, and deep-live finds its tree node-for-node equal to the headless dump', gate('AC5 #1433.27d27bbc', 'accessibility'));

test('AC6 #1433.f1fbb5d2 a question card built with trusted_input.rs and the status item beside the candidate\'s window shell: nothing covers it, and a hardware press is told from a synthetic one', gate('AC6 #1433.f1fbb5d2', 'question-card'));

test('AC7 #1433.08e2511c claude-code/main.js loads through a shim and reaches panel-tree parity within the 4 ms update budget', gate('AC7 #1433.08e2511c', 'panel'));

test('AC8 #1433.1ed927b2 the record names, for every gate, the reading, its machine and its load, as its raw readings give them, and ends in one line per arm: fallback, or closed with the failed gate; an unrun gate leaves it INCONCLUSIVE', (t) => {
  holds(t, 'AC8 #1433.1ed927b2', { problems: recordProblems(spike('AC8 #1433.1ed927b2')) });
});

test('AC9 #1433.ff47ac97 the gpui-fast arm\'s record names its version and every carried hunk, and a reading taken through the replica reads INCONCLUSIVE', (t) => {
  holds(t, 'AC9 #1433.ff47ac97', { problems: gpuiFastProblems(spike('AC9 #1433.ff47ac97')) });
});

test('AC10 #1433.667977ab with retention on and off, a recorded journey\'s frames in a real window are byte-equal', gate('AC10 #1433.667977ab', 'retention-frames'));

test('AC10 #1433.667977ab a planted glyph page retired under a retained view fails the same check, naming the view', planted('AC10 #1433.667977ab', 'retention-frames'));

test('AC11 #1433.5aa9696a a still window on the gpui-fast arm reads no GPU work on a ledger that counts every command buffer', gate('AC11 #1433.5aa9696a', 'still-ledger'));

test('AC11 #1433.5aa9696a a planted ledger that counts only the main render fails the same check', planted('AC11 #1433.5aa9696a', 'still-ledger'));

test('AC12 #1433.e587284a the gpui-fast arm gives its list reading for both state shapes, and one label changing at 1,000 and 3,000 live rows as views rendered, elements laid out and CPU, with retention on and off', gate('AC12 #1433.e587284a', 'list-shapes'));
