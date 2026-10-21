// Live acceptance tests for issue #338: runs the spike's headless command (record.headless.command) once,
// from the repo root, with DISPLAY, WAYLAND_DISPLAY and CI unset and DEEP_338_OUT set to a fresh directory,
// then holds that fresh output to the same checks as the tracked copy (the replica's launch times, snapshots
// and screenshots; the Needs you rows against the fixture's events; the snapshots against the tracked live
// trees; the canvas component) and reads libtest's result for every named test. It builds the app, so it
// takes minutes. Run: node --test tests/acceptance/338/spike.live.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasProblems, headlessProblems, loadRecord, namedTests, NEEDS_YOU, PARITY, parityProblems, REPLICA, replicaProblems, rowsProblems, runHeadless } from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
let cached;
function headless() {
  const record = loadRecord();
  cached ??= runHeadless(record);
  if (cached.error) assert.fail(`BLOCKED: the headless command didn't run: ${cached.error.message}`);
  return { record, named: namedTests(record), run: cached, dir: cached.out };
}

test(`${REPLICA} the replica launches headless now, under 2 s on every run, and writes each shipped view's snapshot and screenshot`, () => {
  const { record, named, run, dir } = headless();
  holds([...headlessProblems(named.replica, run), ...replicaProblems(record, dir)]);
});

test(`${NEEDS_YOU} the fixture panel's rows, written by the run now, equal the rows recomputed from the fixture's events, and each planted view fails naming an ask`, () => {
  const { record, named, run, dir } = headless();
  holds([...headlessProblems(named.needsYou, run), ...rowsProblems(record, dir)]);
});

test(`${PARITY} the snapshots the replica writes now equal the tracked live trees node for node, and the scale-1 replica differs at the node the run names`, () => {
  const { record, named, run, dir } = headless();
  holds([...headlessProblems(named.parity, run), ...parityProblems(record, dir)]);
});

test('scope: every slot\'s panel loads through the registry now, and the canvas component is registered with its argument schemas and retained state', () => {
  const { record, named, run, dir } = headless();
  holds([...headlessProblems([...named.registry, ...named.canvas], run), ...canvasProblems(record, dir)]);
});
