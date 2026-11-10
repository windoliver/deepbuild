// The blind redraft of four #1003 look tests for #1458's amended ink floors (README.md here). Each starts from
// look-1003-1458.json, which keeps every rule as amended, first proves its plant breaks only its own rule, then asks
// the real guard (`deep-canvas-render look`, built once, as ../look.test.mjs does).
// Run: node --test tests/acceptance/1003/redraft-1458/look.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AC, realGuard } from '../common.mjs';
import { amendedProblems, judgeBrightBlack, judgeControl, judgeFaintFocus, judgeNoFocus, planted } from './judge.mjs';

test('the fixture look, which keeps every rule the README pins, passes the guard and resolves its terminal and focus roles', () => {
  assert.deepEqual(amendedProblems(planted('none')), [], 'the redrafted fixture breaks an amended rule');
  assert.deepEqual(judgeControl(realGuard), []);
});

test(`${AC[3]} a planted look whose bright black is 2:1 on the terminal background is refused, naming the color`, () => {
  assert.deepEqual(amendedProblems(planted('brightBlack')), ['dark: term_bright_black on the terminal background is 2.01:1, under 3:1'], 'the plant breaks more than bright black');
  assert.deepEqual(judgeBrightBlack(realGuard), []);
});

test(`${AC[4]} a planted look with no focus role is refused`, () => {
  assert.deepEqual(amendedProblems(planted('noFocus')), ['light: no focus', 'dark: no focus'], 'the plant breaks more than focus');
  assert.deepEqual(judgeNoFocus(realGuard), []);
});

test(`${AC[4]} (scope) a planted look whose focus is under 3:1 on a surface is refused, naming focus and that surface`, () => {
  assert.deepEqual(amendedProblems(planted('faintFocus')), [
    'light: focus on hover over raised is 2.84:1, under 3:1',
    'light: focus on selected over raised is 2.76:1, under 3:1',
  ], 'the plant breaks more than focus');
  assert.deepEqual(judgeFaintFocus(realGuard), []);
});
