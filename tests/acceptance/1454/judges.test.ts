// The judges, on made-up records and drawn pictures: no app, no criterion tag, runnable at the base anywhere. Each judge a
// criterion leans on must pass a right input and fail the wrong ones, so a failure on the real app is the app's, not the
// judge's. These are the planted twins of what the real run can't plant: a hub that records one answer can't show two.
import { describe, expect, it } from 'vitest';
import { answerFailures, figureFailures, panelFailures, PANEL_TEXT, REFUSED_TEXT, tasteFailure, unconfirmedFailures, type Ev, type Line, type Picture, type Rgb } from './helpers.ts';

const handle = 'ask:01MCBKEP00AF27SH36Z7R1YMBQ';
const ask = { handle, pick: { id: 'green', label: 'Green header' } };
const answered = (over: Partial<Ev['data']> = {}, subject = handle): Ev => ({ id: '1', kind: 'ask.answered', subject, writer: 'app', ts: 0, log_pos: 1, data: { answer: 'green', via: 'card', ...over } });

describe('#1454 (judges) an answer that reaches its session once', () => {
  it('passes one answer from the card that reached the session', () => {
    expect(answerFailures(ask, [answered()], 'green')).toEqual([]);
  });
  it('fails none, two, another option, one from `deep inbox`, and one the session never got, each named', () => {
    expect(answerFailures(ask, [], 'green').join()).toContain(`the record shows 0 answers to ${handle}`);
    expect(answerFailures(ask, [answered(), answered()], 'green').join()).toContain('the record shows 2 answers');
    expect(answerFailures(ask, [answered({ answer: 'blue' })], 'green').join()).toContain('answered blue, not green');
    expect(answerFailures(ask, [answered({ via: 'inbox' })], 'green').join()).toContain('came inbox, not from the card');
    expect(answerFailures(ask, [answered()], undefined).join()).toContain('the session didn\'t get');
    expect(answerFailures(ask, [answered({}, 'ask:other')], 'green').join(), 'another ask\'s answer isn\'t this one').toContain('0 answers');
  });
  it('fails an answer the OS never confirmed, and lets none through', () => {
    expect(unconfirmedFailures(ask, [])).toEqual([]);
    expect(unconfirmedFailures(ask, [answered()]).join()).toContain('though the OS didn\'t confirm you');
  });
});

const GROUND: Rgb = [255, 255, 255];
const BAR: Rgb = [96, 64, 208];
type Fill = [x: number, y: number, w: number, h: number, c: Rgb];
const picture = (fills: readonly Fill[]): Picture => ({
  path: 'drawn', width: 800, height: 400,
  at: (x, y) => fills.find(([fx, fy, w, h]) => x >= fx && x < fx + w && y >= fy && y < fy + h)?.[4] as [number, number, number] | undefined ?? [...GROUND] as [number, number, number],
});
const words: Line[] = [{ text: 'Release readiness', box: [0, 0, 10, 10] }, { text: 'Ready for review', box: [0, 0, 10, 10] }];
const bars = (scale: number, x = 100, y = 40): Fill[] => [
  [x, y, 240 * scale, 16, BAR], [x, y + 30 * scale, 180 * scale, 16, BAR], [x, y + 60 * scale, 120 * scale, 16, BAR],
];
const judge = (p: Picture, l: readonly Line[] = words): string[] => figureFailures(p, BAR, l, 'Release readiness', 'Ready for review');

describe('#1454 (judges) the figure in the window', () => {
  it('passes the three bars at any scale, in the figure\'s law', () => {
    expect(judge(picture(bars(1)))).toEqual([]);
    expect(judge(picture(bars(2)))).toEqual([]);
  });
  it('fails words with no picture, bars with no words, and bars that aren\'t the figure\'s', () => {
    expect(judge(picture([])).join()).toContain('no three bars');
    expect(judge(picture(bars(1)), []).join()).toContain('lack the figure\'s "Release readiness"');
    const [a, b, c] = bars(1) as [Fill, Fill, Fill];
    expect(judge(picture([a, b, [c[0], c[1], 240, c[3], c[4]]])).join(), 'three equal bars').toContain('no three bars');
    expect(judge(picture([a, [b[0] + 40, b[1], b[2], b[3], b[4]], c])).join(), 'bars with no one left edge').toContain('no three bars');
  });
});

describe('#1454 (judges) panels', () => {
  const line = (text: string): Line => ({ text, box: [0, 0, 10, 10] });
  it('passes the installed panel without the refused one, and fails the others', () => {
    expect(panelFailures([line(PANEL_TEXT)], { refused: true })).toEqual([]);
    expect(panelFailures([], { refused: true }).join()).toContain('isn\'t in the window with no flag');
    expect(panelFailures([line(PANEL_TEXT), line(REFUSED_TEXT)], { refused: true }).join()).toContain('loaded anyway');
  });
});

describe('#1454 (judges) the taste call', () => {
  const got = { 'a.png': 'aa', 'run.json': 'bb' };
  const call = { verdict: 'looks_right', who: 'you', when: '2026-11-06', files: got };
  it('stays INCONCLUSIVE with no call, an anonymous one, or one on other files', () => {
    expect(tasteFailure({ verdict: null }, got)?.inconclusive).toContain('no taste call');
    expect(tasteFailure({ ...call, who: null }, got)?.inconclusive).toContain('names no one');
    expect(tasteFailure({ ...call, files: { 'a.png': 'cc', 'run.json': 'bb' } }, got)?.inconclusive).toContain('other pictures');
  });
  it('fails on looks_wrong, quoting it, and passes only on exactly these files', () => {
    expect(tasteFailure({ ...call, verdict: 'looks_wrong', note: 'the card is cut off' }, got)?.fails).toContain('the card is cut off');
    expect(tasteFailure(call, got)).toBeNull();
  });
});
