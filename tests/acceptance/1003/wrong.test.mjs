// #1003: each judge fails the wrong programs under wrong/ (and made-up answers), naming what they miss, and passes its
// control. These test the tests, not #1003, so they pass at the base and carry no criterion tag; they read only the
// fixture look and need no build.
// Run: node --test tests/acceptance/1003/wrong.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAIRS, judgeCells, scenario } from './cells-judge.mjs';
import {
  judgeBlocked, judgeBrightBlack, judgeControl, judgeFaintFocus, judgeNoFocus, judgeSelected, judgeShipped, planted, plantRatios,
} from './look-judge.mjs';
import { judgeShot, judgeTaste } from './taste-judge.mjs';
import { guard } from './wrong/look-guards.mjs';

const expectOne = (failures, pattern) => assert.ok(failures.some((l) => pattern.test(l)), `expected ${pattern} in:\n${failures.join('\n') || '(no failure)'}`);
const JUDGES = { judgeControl, judgeSelected, judgeBlocked, judgeBrightBlack, judgeNoFocus, judgeFaintFocus, judgeShipped };

test('the plants keep the ratios the README gives', () => assert.deepEqual(plantRatios(), []));

test('the control guard passes every look judge', () => {
  for (const [name, judge] of Object.entries(JUDGES)) assert.deepEqual(judge(guard({})), [], name);
});

for (const [fault, judge, pattern] of [
  // The merge base: every plant accepted, and a shipped look passed on its word.
  ['base', judgeSelected, /drops ink_secondary to 4\.40:1 on selected over raised isn't refused/],
  ['base', judgeBlocked, /2\.90:1 on the raised ground isn't refused/],
  ['base', judgeBrightBlack, /bright black is 2\.01:1 on the terminal background isn't refused/],
  ['base', judgeNoFocus, /no focus role isn't refused/],
  ['base', judgeFaintFocus, /focus is under 3:1 on hover over raised and selected over raised isn't refused/],
  ['noSelected', judgeSelected, /isn't refused/],
  ['shortName', judgeSelected, /not naming on "selected over raised"/],
  ['groundOnly', judgeBlocked, /isn't refused/],
  ['noTerminal', judgeBrightBlack, /isn't refused/],
  ['terminalIndex', judgeBrightBlack, /not naming role "term_bright_black"/],
  ['noRatio', judgeBrightBlack, /not naming ratio 2\.01 ± 0\.03/],
  ['focusOptional', judgeNoFocus, /isn't refused/],
  ['focusFirstSurface', judgeFaintFocus, /not naming on one of hover over raised, selected over raised/],
  ['refuseAll', judgeControl, /the fixture, which keeps every rule the README pins, is refused/],
  ['refuseAll', judgeShipped, /the shipped look clean fails the guard/],
]) {
  test(`the ${judge.name} judge fails a guard with the fault ${fault}`, () => expectOne(judge(guard({ [fault]: true })), pattern));
}

test("the shipped judge fails a guard that passes a shipped look the README's floors refuse, naming the role and surface", () => {
  const wrong = guard({ base: true }, { clean: planted('selected') });
  expectOne(judgeShipped(wrong), /^clean \(light\): ink_secondary on selected over raised is 4\.40:1, under 4\.5:1/);
});

test('the shipped judge fails an app look with no terminal roles or focus, naming them', () => {
  const def = planted('noFocus');
  delete def.roles.term_bright_black;
  const failures = judgeShipped(guard({ base: true }, { clean: def }));
  expectOne(failures, /^clean \(light\): no opaque term_bright_black/);
  expectOne(failures, /^clean \(dark\): no focus role/);
});

// AC3, the cells -------------------------------------------------------------------------------------------------

const { asked } = scenario('/tmp/unused');
const asSent = asked.map(({ pair, x }) => ({ g: 'XY'[x], fg: pair.fg, bg: pair.bg }));

test('the cells judge passes cells drawn as sent', () => assert.deepEqual(judgeCells(asked, asSent), []));

test("the cells judge fails a terminal that raises the program's text to a floor, naming the cell", () => {
  const boosted = asSent.map((c, i) => (asked[i].home === 'panel' && asked[i].y === 0 ? { ...c, fg: '#5a5a5a' } : c));
  expectOne(judgeCells(asked, boosted), /^the panel's terminal, cell \(0, 0\): sent #2c2c2c on #000000 \(1\.5:1\), drawn #5a5a5a on #000000/);
});

test("the cells judge fails a session page that moves the program's background, and one that answers no cell", () => {
  const moved = asSent.map((c, i) => (asked[i].home === 'session' && asked[i].y === 1 ? { ...c, bg: '#101010' } : c));
  expectOne(judgeCells(asked, moved), new RegExp(`^the session page's terminal, cell \\(0, 1\\): sent ${PAIRS[1].fg}`));
  expectOne(judgeCells(asked, asSent.slice(0, 2)), /no cell answer/);
});

// AC5, the shots and the taste call ------------------------------------------------------------------------------

const hashes = { 'light/sidebar.png': 'a'.repeat(64), 'dark/sidebar.png': 'b'.repeat(64) };
const call = (over) => ({ verdict: 'right', by: 'the owner', at: '2026-11-04', screens: { ...hashes }, ...over });

test('the taste judge passes only a recorded "right" on exactly these pictures', () => {
  assert.equal(judgeTaste(call({}), hashes).verdict, 'PASS');
});

for (const [what, record, verdict, pattern] of [
  ['no record', null, 'INCONCLUSIVE', /no taste call is recorded at docs\/evidence\/1003\/taste\.json/],
  ['a call on other pictures', call({ screens: { ...hashes, 'dark/sidebar.png': 'c'.repeat(64) } }), 'INCONCLUSIVE', /judged other pictures than this run's dark\/sidebar\.png/],
  ['a call that leaves a picture out', call({ screens: { 'light/sidebar.png': hashes['light/sidebar.png'] } }), 'INCONCLUSIVE', /other pictures than this run's dark\/sidebar\.png/],
  ['a call with no verdict', call({ verdict: undefined }), 'INCONCLUSIVE', /has no verdict/],
  ['a call with a verdict of its own', call({ verdict: 'PASS' }), 'INCONCLUSIVE', /not "right" or "wrong"/],
  ['a call with no one behind it', call({ by: '' }), 'INCONCLUSIVE', /has no by/],
  ['a record that is not JSON', { error: 'Unexpected token' }, 'INCONCLUSIVE', /isn't a taste call/],
  ['a call of "wrong"', call({ verdict: 'wrong' }), 'FAIL', /look wrong/],
]) {
  test(`the taste judge answers ${verdict} for ${what}`, () => {
    const got = judgeTaste(record, hashes);
    assert.equal(got.verdict, verdict, got.why);
    assert.match(got.why, pattern);
  });
}

test('the shot judge passes a screen at the reference window and fails one at another size, naming it', () => {
  const snapshot = { window: { size: [1512, 982], scale: 2 } };
  assert.deepEqual(judgeShot('light/sidebar.png', { size: [3024, 1964], snapshot }), []);
  expectOne(judgeShot('dark/sidebar.png', { size: [1512, 982], snapshot: { window: { size: [756, 491], scale: 2 } } }), /^dark\/sidebar\.png: 1512x982 px, not the reference window's 3024x1964/);
});
