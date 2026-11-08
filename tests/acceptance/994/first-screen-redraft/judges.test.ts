// The judges on written readings, no app, anywhere. No criterion tag: they pass at the base on purpose. Only
// first-screen.test.ts reaches the real window.
import { describe, expect, it } from 'vitest';
import type { Seen } from '../../1002/first-screen-redraft/window.ts';
import { answeringFailures, hubCountFailures, notifiedRowFailures, rowFailures } from './helpers.ts';

const HUB = 'The hub isn\'t answering';
const node = (name: string) => ({ role: 'AXButton', name, frame: [0, 0, 1, 1] });
const seen = (names: string[], lines: string[], menu: string[]): Seen => ({ window: [0, 0, 960, 640], nodes: names.map(node), lines, menu, picture: '' });
const ask = { handle: 'ask:01TEST', question: 'Which header colour for the checkout page (ab12)?' };
const row = `${ask.question} · not notified`;

describe('#994 (judges) the count', () => {
  it('passes the hub isn\'t answering on nodes, pixels and menu bar', () => {
    expect(hubCountFailures(seen([HUB], [HUB], [HUB]))).toEqual([]);
  });
  it.each<[string, Seen, RegExp]>([
    ['a number on the window', seen([HUB, '0 asks need you'], [HUB], [HUB]), /the window reads "0 asks need you"/],
    ['a number on the pixels', seen([HUB], [HUB, '143 asks need you'], [HUB]), /the window reads "143 asks need you"/],
    ['a number in the menu bar', seen([HUB], [HUB], ['0']), /the menu bar reads "0"/],
    ['no node', seen(['No hub'], [HUB], [HUB]), /no node of the window says so/],
    ['nothing drawn', seen([HUB], ['No hub'], [HUB]), /the window's pixels don't say so/],
  ])('fails %s', (_, s, why) => { expect(hubCountFailures(s).join('\n')).toMatch(why); });
  it('wants the number back once the hub answers', () => {
    expect(answeringFailures(seen(['1 ask needs you'], ['1 ask needs you'], ['1']), 1)).toEqual([]);
    expect(answeringFailures(seen(['0 asks need you'], ['0 asks need you'], ['0']), 1).join('\n')).toMatch(/must read "1 ask needs you"/);
    expect(answeringFailures(seen(['0 asks need you', HUB], ['0 asks need you'], ['0']), 0).join('\n')).toMatch(/must stop saying/);
  });
});

describe('#994 (judges) the row', () => {
  it('passes one row saying not notified on nodes and pixels', () => {
    expect(rowFailures(seen([row], [row], ['1']), ask)).toEqual([]);
  });
  it.each<[string, Seen, RegExp]>([
    ['no row', seen([], [row], ['1']), /should have one row showing its question; it has 0/],
    ['two rows', seen([row, row], [row], ['1']), /it has 2/],
    ['a row that doesn\'t say so', seen([ask.question], [row], ['1']), /row must say not notified; it reads/],
    ['pixels without the question', seen([row], ['not notified'], ['1']), /question isn't on the window's pixels/],
    ['only a screen reader gets it', seen([row], [ask.question], ['1']), /must say not notified on the window's pixels/],
  ])('fails %s', (_, s, why) => {
    const said = rowFailures(s, ask).join('\n');
    expect(said).toMatch(why);
    expect(said).toContain(ask.handle);
  });
  it('wants no such word with notifications allowed', () => {
    expect(notifiedRowFailures(seen([ask.question], [ask.question], ['1']), ask)).toEqual([]);
    expect(notifiedRowFailures(seen([row], [row], ['1']), ask).join('\n')).toMatch(/nothing says not notified/);
  });
});
