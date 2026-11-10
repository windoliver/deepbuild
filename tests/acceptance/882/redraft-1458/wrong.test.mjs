// The two redrafted judges against the wrong programs README.md names, and their controls. These test the tests, so
// they pass at the base and carry no criterion tag. They need no build: the look is ../fixtures/look-chrome.json less
// its third ink tier, asked through ../wrong/look-guards.mjs's guard played in JavaScript.
// Run: node --test tests/acceptance/882/redraft-1458/wrong.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FLOORS, contrast } from '../common.mjs';
import { inkProblems as inkProblemsOld } from '../replica-judge.mjs';
import { guard } from '../wrong/look-guards.mjs';
import { inkProblems, judgeLook } from './judge.mjs';

const expectOne = (failures, pattern) => assert.ok(failures.some((l) => pattern.test(l)), `expected ${pattern} in:\n${failures.join('\n') || '(no failure)'}`);
const fixture = JSON.parse(readFileSync(new URL('../fixtures/look-chrome.json', import.meta.url), 'utf8'));

/** The fixture look with `edit(roles, theme)` applied to the look's roles (light) and to dark's; ink_tertiary gone. */
function look(edit = () => {}) {
  const def = JSON.parse(JSON.stringify(fixture));
  for (const [theme, roles] of [['light', def.roles], ['dark', def.themes.dark.roles]]) {
    delete roles.ink_tertiary;
    edit(roles, theme);
  }
  return def;
}
/** The fake guard (no contrast check: it holds a tertiary tier to 3:1) with `def` as the shipped look. */
const askWith = (def, faults = {}) => (inputs) => guard({ noContrast: true, ...faults })(inputs.map((i) => (i.look === 'clean' ? { look: def } : i)));

// AC1 ------------------------------------------------------------------------------------------------------

test('AC1: the control look, two tiers and disabled, passes the amended judge', () => {
  assert.deepEqual(judgeLook(askWith(look())), []);
});

for (const [name, edit, pattern] of [
  ['keeps ink_tertiary (the base\'s shape)', (r, t) => { r.ink_tertiary = `ink3_${t}`; }, /light: ink_tertiary .* is a third ink tier/],
  ['keeps a third tier under another name', (r, t) => { r.ink_muted = `ink3_${t}`; }, /light: ink_muted .* is a third ink tier/],
  ['has a secondary as strong as the primary', (r, t) => { r.ink_secondary = r.ink_primary; }, /light: ink_secondary's alpha isn't below ink_primary's/],
  ['has dark\'s disabled above its secondary', (r, t) => { if (t === 'dark') r.ink_disabled = 'ink2_dark'; }, /dark: ink_disabled's alpha isn't below ink_secondary's/],
  ['has no secondary', (r) => { delete r.ink_secondary; }, /light: no color for ink_secondary/],
]) {
  test(`AC1: the amended judge fails a look that ${name}`, () => expectOne(judgeLook(askWith(look(edit))), pattern));
}

test('AC1: the amended judge keeps the old plant: a guard that checks data roles only passes the readout and fails', () => {
  expectOne(judgeLook(askWith(look(), { dataOnly: true })), /the session readout at #b45309 passes the guard/);
});

// AC3's ink half -------------------------------------------------------------------------------------------

/** The base's clean light roles (crates/deep-canvas-marks/looks/clean.json) less ink_tertiary. */
const light = {
  ground: '#ffffff', raised: '#f5f5f6', hover: '#1b1d220f', selected: '#1b1d221a',
  ink: '#1b1d22', ink_primary: '#1b1d22', ink_secondary: '#1b1d22d6', ink_disabled: '#1b1d2233',
};
const dark = {
  ground: '#0b0c0e', raised: '#0d0e10', hover: '#f2f3f504', selected: '#f2f3f508',
  ink: '#f2f3f5', ink_primary: '#f2f3f5', ink_secondary: '#f2f3f5d6', ink_disabled: '#f2f3f533',
};

test('AC3: the control inks pass the amended ink judge in light and dark; a faint ink_disabled is not held to 4.5:1', () => {
  assert.deepEqual([...inkProblems('light', light), ...inkProblems('dark', dark)], []);
});

test('AC3: the amended ink judge fails a look that keeps ink_tertiary at the base\'s 0x85, naming it on the light ground', () => {
  expectOne(inkProblems('light', { ...light, ink_tertiary: '#1b1d2285' }), /^light: ink_tertiary #1b1d2285 on ground is 3\.50:1, under 4\.5:1/);
});

test('AC3: a secondary ink under 4.5:1 only on selected over raised fails the amended judge there (the old ground/raised/hover judge passes it)', () => {
  const faint = { ...light, ink_secondary: '#1b1d22a1' };
  assert.deepEqual(inkProblemsOld('light', { ...faint, ink_tertiary: faint.ink_secondary }, FLOORS, contrast), []);
  assert.deepEqual(inkProblems('light', faint), ['light: ink_secondary #1b1d22a1 on selected over raised is 4.39:1, under 4.5:1']);
});

test('AC3: a dark secondary ink under 4.5:1 fails the amended judge, naming dark', () => {
  expectOne(inkProblems('dark', { ...dark, ink_secondary: '#f2f3f540' }), /^dark: ink_secondary #f2f3f540 on ground/);
});

test('AC3: a look with no secondary ink fails the amended judge rather than passing it empty', () => {
  const { ink_secondary: _, ...none } = light;
  expectOne(inkProblems('light', none), /^light: no ink_secondary role/);
});
