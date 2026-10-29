// #326 AC4: guard-judge.mjs fails each wrong guard and each wrong lane table under wrong/, naming the
// case it misses, and passes their controls (the same scan, the same lane, with no fault). These test
// the tests, not #326, so they pass at the base and carry no criterion tag.
// Run: node --test tests/acceptance/326/panels/guard.wrong.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { judgeGuard, judgeWiring } from './guard-judge.mjs';

const wrong = (name) => fileURLToPath(new URL(`./wrong/${name}.mjs`, import.meta.url));

test('the control guard passes the judge', () => {
  assert.deepEqual(judgeGuard(wrong('control')), []);
});

const guards = [
  ['always-pass', /a module that subscribes to the stream \(crates\/deep-app\/src\/planted_view\.rs\) passes/],
  ['subscribe-only', /a module that calls inbox\.read \(crates\/deep-app\/src\/planted_inbox_read\.rs\) passes/],
  ['top-level-only', /a nested module that subscribes to the stream \(crates\/deep-app\/src\/planted_views\/nested_view\.rs\) passes/],
  ['one-file', /a module that subscribes to the stream \(crates\/deep-app\/src\/planted_view\.rs\) passes/],
  ['ignores-root', /a module that calls events\.read \(crates\/deep-app\/src\/planted_events_read\.rs\) passes/],
  ['call-literal-only', /through a constant \(crates\/deep-app\/src\/planted_const\.rs\) passes/],
  ['record-prefix', /named like the reader .*record_mirror\.rs\) passes/],
  ['unnamed', /fails the guard without a FAIL line naming crates\/deep-app\/src\/planted_view\.rs/],
  ['flags-reader', /the app's own source fails the guard/],
];

for (const [name, expected] of guards) {
  test(`the judge fails the ${name} guard`, () => {
    const failures = judgeGuard(wrong(name));
    assert.ok(failures.some((line) => expected.test(line)), `expected ${expected} in:\n${failures.join('\n')}`);
  });
}

const control = { guard: 'tests/acceptance/326/panels/wrong/control.mjs' };

test('the control lane tables pass the wiring judge', async () => {
  assert.deepEqual(await judgeWiring(wrong('lanes-control'), control), []);
  assert.deepEqual(await judgeWiring(wrong('lanes-app-paths'), control), []);
});

const lanes = [
  ['lanes-none', control, /no lane of the local preflight's checks runs/],
  ['lanes-release', control, /no lane of the local preflight's checks runs/],
  ['lanes-guard-paths', control, /skip a change to crates\/deep-app\/src/],
  ['lanes-elsewhere', control, /points the guard at tests\/acceptance\/326\/panels\/fixtures, not the checkout/],
  ['lanes-failing', { guard: 'tests/acceptance/326/panels/wrong/flags-reader.mjs' }, /fails the app as it stands/],
];

for (const [name, options, expected] of lanes) {
  test(`the wiring judge fails the ${name} lane table`, async () => {
    const failures = await judgeWiring(wrong(name), options);
    assert.ok(failures.some((line) => expected.test(line)), `expected ${expected} in:\n${failures.join('\n')}`);
  });
}
