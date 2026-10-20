// Live acceptance tests for issue #337: runs the spike's headless command (record.headless.command)
// once, from the repo root, with DISPLAY, WAYLAND_DISPLAY and CI unset, and reads libtest's results
// for every screen, the stocks panel and the report. It builds the app, so it takes minutes.
// Run: node --test tests/acceptance/337/spike.live.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENTS, headlessProblems, loadRecord, namedTests, PANELS, runHeadless, STOCKS } from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
let cached;
function headless() {
  const record = loadRecord();
  cached ??= runHeadless(record);
  return { named: namedTests(record), run: cached };
}

test(`${PANELS} both agents' panels load and pass their headless render and click test, run now`, () => {
  const { named, run } = headless();
  assert.equal(named.panels.length, AGENTS.length, `one panel per agent (${AGENTS.join(', ')})`);
  holds(headlessProblems(named.panels, run));
});

test(`${STOCKS} the stocks panel's test on recorded quotes and the report's test that opens it in the browser pass, run now`, () => {
  const { named, run } = headless();
  holds(headlessProblems(named.stocks, run));
});

test('scope: every screen renders and is clicked headlessly with no display, run now', () => {
  const { named, run } = headless();
  holds(headlessProblems(named.screens, run));
});
