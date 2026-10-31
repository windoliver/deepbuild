// #882: each judge fails the wrong programs under wrong/ (and made-up screens), naming what they miss, and passes
// their controls. These test the tests, not #882, so they pass at the base and carry no criterion tag. They read
// the fixture app (fixtures/app, no color literal) and the fixture look (fixtures/look-chrome.json, the clean look
// with chrome roles in the README's shape), so they don't depend on the branch.
// Run: node --test tests/acceptance/882/wrong.test.mjs
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FLOORS, contrast, over, parseColor, remove, tempRoot } from './common.mjs';
import { judgeInventory } from './inventory-judge.mjs';
import { judgeBase, judgeLint, judgeWiring } from './lint-judge.mjs';
import { judgeInkGuard, judgeLook } from './look-judge.mjs';
import { inkProblems, judgeScreen } from './replica-judge.mjs';
import { guard } from './wrong/look-guards.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const wrong = (name) => here(`./wrong/${name}.mjs`);
const source = here('./fixtures/app');
const expectOne = (failures, pattern) => assert.ok(failures.some((l) => pattern.test(l)), `expected ${pattern} in:\n${failures.join('\n') || '(no failure)'}`);

// AC1 ------------------------------------------------------------------------------------------------------

test('AC1: the control guard passes the look judges', () => {
  assert.deepEqual([...judgeLook(guard({})), ...judgeInkGuard(guard({}))], []);
});

for (const [fault, judge, pattern] of [
  ['noRoles', judgeLook, /carries no roles/],
  ['dataOnly', judgeLook, /the session readout at #b45309 passes the guard/],
  ['lightOnly', judgeLook, /in dark alone isn't refused/],
  ['noDistance', judgeLook, /names distance undefined, not 0\.044/],
  ['refuseAll', judgeLook, /the shipped look fails the guard/],
  ['noContrast', judgeInkGuard, /isn't refused naming ink_tertiary/],
]) {
  test(`AC1: the judge fails a guard with the fault ${fault}`, () => expectOne(judge(guard({ [fault]: true })), pattern));
}

// AC2 ------------------------------------------------------------------------------------------------------

test('AC2: the control guard passes the lint judge on the fixture app and the base judge', () => {
  assert.deepEqual([...judgeLint(wrong('lint-control'), { source }), ...judgeBase(wrong('lint-control'))], []);
});

for (const [name, pattern] of [
  ['lint-always-pass', /rgb\(0x2563eb\) in views\.rs \(.*\) passes the guard/],
  ['lint-views-only', /an hsla color in a nested module .* passes the guard/],
  ['lint-rgb-only', /a color held in a constant first .* passes the guard/],
  ['lint-top-level', /an hsla color in a nested module .* passes the guard/],
  ['lint-no-line', /fails the guard without a FAIL line naming crates\/deep-app\/src\/views\.rs:\d+/],
  ['lint-no-role', /names no role to use/],
  ['lint-ignores-root', /passes the guard|the app as it stands fails the guard/],
  ['lint-exception-anywhere', /with a full exception on another line .* passes the guard/],
  ['lint-no-date', /exception that has no review date .* passes the guard/],
]) {
  test(`AC2: the lint judge fails the ${name} guard`, () => expectOne(judgeLint(wrong(name), { source }), pattern));
}

test('AC2: the base judge fails a guard that greps only views.rs, naming the lines it misses', () => {
  expectOne(judgeBase(wrong('lint-views-only')), /names 12 of the base's 23 literal lines; not crates\/deep-app\/src\/canvas\.rs:111/);
});

const control = { guard: 'tests/acceptance/882/wrong/lint-control.mjs', source };

test('AC2: the control lane table passes the wiring judge', async () => {
  assert.deepEqual(await judgeWiring(wrong('lanes-control'), control), []);
});

for (const [name, pattern] of [
  ['lanes-none', /the lint lane doesn't run/],
  ['lanes-release', /the lint lane doesn't run/],
  ['lanes-other-lane', /the lint lane doesn't run/],
  ['lanes-paths', /the lint lane's paths skip a change/],
  ['lanes-elsewhere', /points the guard at tests\/acceptance\/882\/fixtures\/app, not the checkout/],
]) {
  test(`AC2: the wiring judge fails the ${name} lane table`, async () => expectOne(await judgeWiring(wrong(name), control), pattern));
}

test('AC2: the wiring judge fails a lint lane whose guard never fails', async () => {
  const dir = tempRoot('lanes');
  const name = 'tests/acceptance/882/wrong/lint-always-pass.mjs';
  writeFileSync(join(dir, 'lanes.mjs'), `export const checks = [{ name: 'lint', commands: [[process.execPath, '${name}']], fix: 'x' }];\n`);
  try {
    expectOne(await judgeWiring(join(dir, 'lanes.mjs'), { guard: name, source }), /doesn't fail as 'FAIL lint/);
  } finally {
    remove(dir);
  }
});

// AC3 ------------------------------------------------------------------------------------------------------

const look = guard({})([{ look: 'clean' }])[0].roles;

/** A made-up 2x screen: `ground` everywhere, and a `block` of `ink` 24 device px square, as text's stems would be. */
function screen(ground, ink) {
  const [width, height] = [96, 64];
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgb = x >= 8 && x < 32 && y >= 8 && y < 32 ? ink : ground;
      data.set([...rgb, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}
const dark = (role) => parseColor(look.dark[role]);
const light = (role) => parseColor(look.light[role]);

test('AC3: a dark screen of the dark ground and the primary ink passes the screen judge', () => {
  const image = screen(dark('ground').rgb, over(dark('ink_primary'), dark('ground').rgb));
  assert.deepEqual(judgeScreen({ view: 'needs-you', appearance: 'dark', image, roles: look.dark, other: look.light }), []);
});

test('AC3: a build that keeps the light ground in dark fails the screen judge, naming the view and the light ground', () => {
  const image = screen(light('ground').rgb, over(light('ink_primary'), light('ground').rgb));
  const failures = judgeScreen({ view: 'session', appearance: 'dark', image, roles: look.dark, other: look.light });
  expectOne(failures, /^session \(dark\): a fill of #ffffff .* the other appearance's ground/);
});

test("AC3: a dark ground with the light appearance's ink fails the screen judge, naming the view", () => {
  const image = screen(dark('ground').rgb, over(light('ink_primary'), dark('ground').rgb));
  const failures = judgeScreen({ view: 'needs-you', appearance: 'dark', image, roles: look.dark, other: look.light });
  expectOne(failures, /^needs-you \(dark\): no text in an ink tier/);
});

test('AC3: the ink judge passes the fixture look and fails a tertiary ink under 3:1 on hover, naming it', () => {
  assert.deepEqual([...inkProblems('dark', look.dark, FLOORS, contrast), ...inkProblems('light', look.light, FLOORS, contrast)], []);
  const faint = { ...look.light, ink_tertiary: `${look.light.ink.slice(0, 7)}66` };
  expectOne(inkProblems('light', faint, FLOORS, contrast), /^light: ink_tertiary on hover over raised is \d\.\d\d:1, under 3:1/);
});

// AC4 ------------------------------------------------------------------------------------------------------

test('AC4: the control inventory passes the inventory judge on the fixture app', () => {
  assert.deepEqual(judgeInventory(wrong('inventory-control'), { source }), []);
});

for (const [name, pattern] of [
  ['inventory-always-pass', /with deepbuild\/planted-882 added and the inventory not regenerated, the check passes/],
  ['inventory-fixed-list', /the check passes|has no row for deepbuild\/planted-882/],
  ['inventory-unnamed', /fails without a FAIL line naming it/],
  ['inventory-ignores-root', /the check passes|has no row for deepbuild\/planted-882|fails the app as it stands/],
  ['inventory-count-only', /fails without a FAIL line naming it/],
]) {
  test(`AC4: the inventory judge fails the ${name} script`, () => expectOne(judgeInventory(wrong(name), { source }), pattern));
}
