// Acceptance tests for issue #338, the replica and the registries, on its record (docs/spikes/338/record.json),
// the headless run's tracked output (record.out), the fixture record of asks and the technical design.
// Nothing builds the app. Run: node --test tests/acceptance/338/spike.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { checks } from '../../../scripts/lanes.mjs';
import {
  canvasProblems, decisionProblems, fixtureProblems, loadRecord, NEEDS_YOU, outDir, outProblems, PARITY, parityProblems, preflightProblems, registryProblems, REPLICA,
  replicaProblems, rowsProblems,
} from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
// The tracked copy of the headless run's output, once the record names it.
function tracked() {
  const record = loadRecord();
  holds(outProblems(record));
  return { record, dir: outDir(record) };
}

test(`${REPLICA} a replica launched headless at the reference window, under 2 s on every run, with a text snapshot of roles, names and canvas item IDs and a screenshot of each shipped view`, () => {
  const { record, dir } = tracked();
  holds(replicaProblems(record, dir));
});

test(`${NEEDS_YOU} the fixture record holds 40 open asks of every kind, one in Later, one held for an unread message, five folded into an exception, one superseded and one moot, as of its log_pos on the virtual clock`, () => {
  holds(fixtureProblems(loadRecord()));
});

test(`${NEEDS_YOU} the fixture panel that replaces Needs you lists the inbox projection's rows, recomputed from the fixture's events, row for row, and passes needs-you@1; the planted views that cap at 20, drop the folded asks, list the superseded one or hide the newest each fail, naming the ask`, () => {
  const { record, dir } = tracked();
  holds(rowsProblems(record, dir));
});

test(`${PARITY} for Needs you, the sidebar and a session page, the replica's snapshot with bounds equals the live accessibility tree captured on the reference Mac, node for node, and a replica laid out at scale 1 fails, naming the first node that differs`, () => {
  const { record, dir } = tracked();
  holds(parityProblems(record, dir));
});

test('scope: gpui-shell\'s panel registry fills every slot of the app (a sidebar item, a home gadget, a tab in any panel, the line) and replaces the shipped Needs you, each from a tracked panel, and the decision says it covers them', () => {
  holds(registryProblems(loadRecord()));
});

test('scope: the canvas is a component in gpui-shell\'s registry with argument schemas and a retained-state handle, and gpui-kit and gpui-shell come from upstream at a commit, with no fork', () => {
  const { record, dir } = tracked();
  holds(canvasProblems(record, dir));
});

test('scope: the decision records the finished macOS GPU-layer spike, the IOSurface handoff and its cost, with what the registry and the replica do, in the technical design', () => {
  holds(decisionProblems(loadRecord()));
});

test('scope: the headless command runs in the local preflight, and nothing runs in CI', () => {
  holds(preflightProblems(loadRecord(), checks));
});
