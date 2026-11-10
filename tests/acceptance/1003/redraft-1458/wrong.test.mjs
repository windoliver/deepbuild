// The redrafted tests against wrong programs (README.md here: the wrong-program column). These test the tests, so
// they carry no criterion tag and need no build: the wrong guards are ../wrong/look-guards.mjs's, played in
// JavaScript over the redrafted fixture, and the wrong fixture is the old one, fixtures/look-1003.json.
// Run: node --test tests/acceptance/1003/redraft-1458/wrong.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture as oldFixture } from '../common.mjs';
import { guard } from '../wrong/look-guards.mjs';
import { amendedProblems, judgeBrightBlack, judgeControl, judgeFaintFocus, judgeNoFocus, planted } from './judge.mjs';

const expectOne = (failures, pattern) => assert.ok(failures.some((l) => pattern.test(l)), `expected ${pattern} in:\n${failures.join('\n') || '(no failure)'}`);

test('the control guard passes every redrafted judge', () => {
  for (const judge of [judgeControl, judgeBrightBlack, judgeNoFocus, judgeFaintFocus]) assert.deepEqual(judge(guard({})), [], judge.name);
});

// A guard still on the old three tiers: it refuses a look that gives no ink_tertiary.
const threeTiers = (inputs) => inputs.map((i) => (i.look?.roles && !i.look.roles.ink_tertiary ? { ok: false, code: 'bad_look', path: 'roles/ink_tertiary (light)' } : guard({})([i])[0]));

for (const [what, wrong, judge, pattern] of [
  ['wants ink_tertiary', threeTiers, judgeControl, /the redrafted fixture, which keeps every rule as amended, is refused/],
  ['refuses every look', guard({ refuseAll: true }), judgeControl, /is refused/],
  ['has no terminal check', guard({ noTerminal: true }), judgeBrightBlack, /2\.01:1 on the terminal background isn't refused/],
  ['names ansi_8, not the role', guard({ terminalIndex: true }), judgeBrightBlack, /not naming role "term_bright_black"/],
  ['gives no ratio', guard({ noRatio: true }), judgeBrightBlack, /not naming ratio 2\.01 ± 0\.03/],
  ['passes a look with no focus', guard({ focusOptional: true }), judgeNoFocus, /no focus role isn't refused/],
  ['names the ground whatever surface fails', guard({ focusFirstSurface: true }), judgeFaintFocus, /not naming on one of hover over raised, selected over raised/],
]) {
  test(`the ${judge.name} judge fails a guard that ${what}`, () => expectOne(judge(wrong), pattern));
}

test("the old fixture, whose ink_tertiary is 3.59:1, fails the amended rules, so each plant on it breaks more than its plant", () => {
  expectOne(amendedProblems(oldFixture('look-1003')), /^light: ink_tertiary on selected over raised is 3\.59:1, under 4\.5:1$/);
  for (const kind of ['brightBlack', 'noFocus', 'faintFocus']) expectOne(amendedProblems(planted(kind, oldFixture('look-1003'))), /ink_tertiary on raised is 3\.72:1/);
});
