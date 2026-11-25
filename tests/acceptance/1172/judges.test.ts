// The pixel judges, on drawn pictures and read lines: no app, no criterion tag, runnable at the base on any platform. Each
// judge AC1, AC2, AC4 and AC5 lean on must pass a right reading and fail the wrong ones, so a failure on the real app is
// the app's, not the judge's.
import { describe, expect, it } from 'vitest';
import { answeredLineFailures, answeredRowFailures, askRowFailures, askRowFailuresAnswered, drawsRow, gridLaw, groundAndInk, hex, type Ask, type Line, type Node, type Picture, type Rgb } from './helpers.ts';

const GROUND: Rgb = [255, 255, 255];
const FIVE: Rgb = [216, 27, 154];
const ONE: Rgb = [19, 196, 163];
const BAR: Rgb = [96, 64, 208];
type Fill = [x: number, y: number, w: number, h: number, c: Rgb];
const picture = (fills: readonly Fill[]): Picture => ({
  path: 'drawn', width: 400, height: 200,
  at: (x, y) => fills.find(([fx, fy, w, h]) => x >= fx && x < fx + w && y >= fy && y < fy + h)?.[4] as [number, number, number] | undefined ?? [...GROUND] as [number, number, number],
});
/** The fixture's fills on a grid of `w` × `h` px cells, from `(x, y)`. */
const grid = (x: number, y: number, w: number, h: number): Fill[] => [
  [x, y + h, 5 * w, h, FIVE], [x + 7 * w, y + h, w, h, ONE], [x + 10 * w, y + 2 * h, w, 2 * h, BAR],
];

describe('#1172 (judges) the grid law', () => {
  it.each([[16, 32], [18, 36], [14, 28]])('control: fills on a grid of %i × %i px cells pass, whatever the cell', (w, h) => {
    expect(gridLaw(picture(grid(10, 20, w, h)), FIVE, ONE, BAR)).toEqual([]);
  });
  it('wrong program: text with no cell fills fails, naming the tab', () => {
    expect(gridLaw(picture([]), FIVE, ONE, BAR).join('\n')).toMatch(/the terminal tab wrote its text outside the cell grid/);
  });
  it('wrong program: proportional text, whose rows end at different columns, fails, naming the tab', () => {
    const [five, one] = grid(10, 20, 16, 32);
    const out = gridLaw(picture([five!, one!, [100, 84, 16, 32, BAR], [190, 116, 16, 32, BAR]]), FIVE, ONE, BAR);
    expect(out.join('\n')).toMatch(/the terminal tab: the cell after ten "i"s/);
  });
  it('wrong program: cells of unequal width fail, naming the tab', () => {
    const [, one, bar] = grid(10, 20, 16, 32);
    expect(gridLaw(picture([[10, 52, 100, 32, FIVE], one!, bar!]), FIVE, ONE, BAR).join('\n')).toMatch(/the terminal tab: 5 cells draw 100/);
  });
});

describe('#1172 (judges) ground and ink', () => {
  it('control: the most common color is the ground and the strokes\' core its ink', () => {
    const ink: Rgb = [139, 143, 151];
    const strokes: Fill[] = [0, 1, 2, 3, 4, 5].map((i) => [20 + 20 * i, 30, 4, 20, ink]);
    const { ground, ink: read } = groundAndInk(picture(strokes), [10, 20, 200, 40]);
    expect(hex(ground)).toBe('#ffffff');
    expect(hex(read)).toBe(hex(ink));
  });
});

describe('#1172 (judges) a list row drawn on the pixels', () => {
  const question = 'Which header colour on the login page?';
  const lines = (...texts: string[]): Line[] => texts.map((text) => ({ text, box: [0, 0, 1, 1] }));
  it.each([
    ['the whole question', 'Which header colour on the login page? How it looks'],
    ['the title cut by an ellipsis, then the state word (the disputed Mac run\'s reading)', 'Which header co... How it looks'],
    ['the title cut by a single-glyph ellipsis', 'Which header colour on…  2m'],
  ])('control: %s passes', (_, text) => {
    expect(drawsRow(lines('Needs you 3', text), question)).toBe(true);
  });
  it.each([
    ['the ask\'s handle', 'ask:01MCBHM300GP83QANM5WDCWNNP How it looks'],
    ['the ask\'s kind alone', 'How it looks'],
    ['another ask\'s question, cut', 'Which font for th... How it looks'],
    ['the title clipped at the edge with no ellipsis', 'Which header colour on the lo'],
    ['fewer than the first 10 letters and digits before the ellipsis', 'Which hea... How it looks'],
    ['an ellipsis after text that isn\'t the question\'s start', 'Header colour on the login... How it looks'],
  ])('wrong program: %s fails', (_, text) => {
    expect(drawsRow(lines('Needs you 3', text), question)).toBe(false);
  });
});

describe('#1172 (judges) a Needs you row apart from an open card, on the tree', () => {
  const ask = (n: number, question: string, one: string, two: string): Ask => ({
    handle: `ask:0${n}`, question, option: { id: 'one', label: one }, other: two, session: 's', task: 't',
  });
  const asks = [
    ask(1, 'Which header colour on the login page?', 'Blue header', 'Green header'),
    ask(2, 'Which font for the printed receipt?', 'Serif receipt', 'Sans receipt'),
    ask(3, 'Which layout for the changelog?', 'Keep a list', 'Write prose'),
  ];
  const [first, second, third] = asks as [Ask, Ask, Ask];
  const node = (role: string, name: string, ...children: Node[]): Node => ({ role, name, frame: [0, 0, 1, 1], children });
  /** A row as the disputed Mac run's probe read it: a button named with the question, holding it, the kind and the time. */
  const row = (a: Ask): Node => node('AXButton', a.question, node('AXStaticText', a.question), node('AXStaticText', 'How it looks'), node('AXStaticText', 'in 1 d'));
  /** The card as that probe read it: a group named "armed" holding the kind, the question and both options as buttons. */
  const card = (a: Ask, optionRole = 'AXButton'): Node => node('AXGroup', 'armed', node('AXStaticText', 'How it looks'), node('AXStaticText', a.question),
    node(optionRole, a.option.label), node(optionRole, a.other), node('AXStaticText', 'Answering saves it for this task'));
  const list = (...rows: Node[]): Node => node('AXGroup', '', node('AXStaticText', 'Needs you'), ...rows);
  const win = (...children: Node[]): Node => node('AXWindow', '', ...children);

  it('control: the disputed launch reading, every ask\'s row and the first ask\'s card, passes (the old reading counted 2)', () => {
    expect(askRowFailures([win(list(row(first), row(second), row(third)), card(first))], asks, asks)).toEqual([]);
  });
  it('control: three rows and no card pass', () => {
    expect(askRowFailures([win(list(row(first), row(second), row(third)))], asks, asks)).toEqual([]);
  });
  it('control: after the first is answered, two rows and the next ask\'s card pass for those two', () => {
    expect(askRowFailures([win(list(row(second), row(third)), card(second))], asks, [second, third])).toEqual([]);
  });
  it('control: a card named with its question, holding its options, is the card', () => {
    const named = node('AXGroup', first.question, node('AXStaticText', first.question), node('AXButton', first.option.label), node('AXButton', first.other));
    expect(askRowFailures([win(list(row(first), row(second), row(third)), named)], asks, asks)).toEqual([]);
  });
  it('wrong program: two rows for one ask, beside its card, fail, naming the ask', () => {
    expect(askRowFailures([win(list(row(first), row(first), row(second), row(third)), card(first))], asks, asks).join('\n')).toMatch(/1 row for ask:01 .* it has 2/);
  });
  it('wrong program: a wanted ask whose card stays but whose row is gone fails, naming the ask', () => {
    expect(askRowFailures([win(list(row(second), row(third)), card(first))], asks, asks).join('\n')).toMatch(/1 row for ask:01 .* it has 0/);
  });
  it('wrong program: a "card" whose options aren\'t buttons is no card, so its question counts as a second row', () => {
    expect(askRowFailures([win(list(row(first), row(second), row(third)), card(first, 'AXStaticText'))], asks, asks).join('\n')).toMatch(/1 row for ask:01 .* it has 2/);
  });
  it('wrong program: a group holding the question and no options is no card, so its question counts as a second row', () => {
    const bare = node('AXGroup', 'armed', node('AXStaticText', first.question));
    expect(askRowFailures([win(list(row(first), row(second), row(third)), bare)], asks, asks).join('\n')).toMatch(/1 row for ask:01 .* it has 2/);
  });
  it('wrong program: a row gone and its card\'s question laid flat beside the list fails: the card can\'t be told from a row', () => {
    const flat = win(node('AXStaticText', 'Needs you'), row(second), row(third), node('AXStaticText', first.question), node('AXButton', first.option.label), node('AXButton', first.other));
    expect(askRowFailures([flat], asks, asks).join('\n')).toMatch(/ask:01's options are on the tree, but no node holding its question sits in a card/);
  });
  it('wrong program: an answered ask whose row stays fails, naming it', () => {
    expect(askRowFailures([win(list(row(first), row(second), row(third)))], asks, [second, third]).join('\n')).toMatch(/0 rows for ask:01 .* it has 1/);
  });
  it('wrong program: an answered ask whose card stays with its options, its row gone, fails, naming it', () => {
    expect(askRowFailures([win(list(row(second), row(third)), card(first))], asks, [second, third]).join('\n')).toMatch(/still shows ask:01's card/);
  });
  it('wrong program: a card holding another ask\'s question is no card apart from the list', () => {
    const mixed = node('AXGroup', 'armed', node('AXStaticText', first.question), node('AXStaticText', second.question), node('AXButton', first.option.label), node('AXButton', first.other));
    expect(askRowFailures([win(list(row(first), row(second), row(third)), mixed)], asks, asks).join('\n')).toMatch(/1 row for ask:01 .* it has 2/);
  });
});

describe('#1172 (judges) an answered ask kept in its slot, drawn answered (Sixth redraft)', () => {
  const ask = (n: number, question: string, one: string, two: string): Ask => ({
    handle: `ask:0${n}`, question, option: { id: 'one', label: one }, other: two, session: 's', task: 't',
  });
  const asks = [
    ask(1, 'Which header colour on the login page?', 'Blue header', 'Green header'),
    ask(2, 'Which font for the printed receipt?', 'Serif receipt', 'Sans receipt'),
    ask(3, 'Which layout for the changelog?', 'Keep a list', 'Write prose'),
  ];
  const [first, second, third] = asks as [Ask, Ask, Ask];
  const node = (role: string, name: string, ...children: Node[]): Node => ({ role, name, frame: [0, 0, 1, 1], children });
  const row = (a: Ask, word = 'How it looks'): Node => node('AXButton', a.question, node('AXStaticText', a.question), node('AXStaticText', word), node('AXStaticText', 'in 1 d'));
  const card = (a: Ask): Node => node('AXGroup', 'armed', node('AXStaticText', a.question), node('AXButton', a.option.label), node('AXButton', a.other));
  const list = (...rows: Node[]): Node => node('AXGroup', '', node('AXStaticText', 'Needs you'), ...rows);
  const win = (...children: Node[]): Node => node('AXWindow', '', ...children);
  const lines = (...texts: string[]): Line[] => texts.map((text) => ({ text, box: [0, 0, 1, 1] }));

  it('control: the answered row kept in its slot, drawn answered, beside two open rows and the next card, passes', () => {
    const w = [win(list(row(first, 'Answered'), row(second), row(third)), card(second))];
    expect(answeredRowFailures(w, first, asks)).toEqual([]);
    expect(askRowFailuresAnswered(w, asks, [second, third])).toEqual([]);
  });
  it('control: the answered row gone passes', () => {
    expect(askRowFailuresAnswered([win(list(row(second), row(third)), card(second))], asks, [second, third])).toEqual([]);
  });
  it('wrong program: the answered ask kept as a still-open row fails, naming it', () => {
    expect(askRowFailuresAnswered([win(list(row(first), row(second), row(third)))], asks, [second, third]).join('\n')).toMatch(/answered ask:01's row .* still reads as open/);
  });
  it('wrong program: a row that reads "Not answered" still reads as open', () => {
    expect(answeredRowFailures([win(list(row(first, 'Not answered'), row(second), row(third)))], first, asks).join('\n')).toMatch(/still reads as open/);
  });
  it('wrong program: two rows for the answered ask, both drawn answered, fail', () => {
    expect(answeredRowFailures([win(list(row(first, 'Answered'), row(first, 'Answered'), row(second), row(third)))], first, asks).join('\n')).toMatch(/at most 1 row, drawn answered, for answered ask:01 .* it has 2/);
  });
  it('wrong program: the answered ask\'s card still offering its options fails, even with its row drawn answered', () => {
    expect(answeredRowFailures([win(list(row(first, 'Answered'), row(second), row(third)), card(first))], first, asks).join('\n')).toMatch(/still offers answered ask:01's options/);
  });
  it('wrong program: a wanted ask whose row is gone still fails beside a kept answered row', () => {
    expect(askRowFailuresAnswered([win(list(row(first, 'Answered'), row(third)))], asks, [second, third]).join('\n')).toMatch(/1 row for ask:02 .* it has 0/);
  });
  it('control: on the pixels, the disputed Mac run\'s line and a cut row drawn answered pass', () => {
    expect(answeredLineFailures(lines('Needs you 2', 'Which header colour on the login page? Answered "Blue header" at 12:12 from deep inbox. Nothing is left to answe…'), first)).toEqual([]);
    expect(answeredLineFailures(lines('Needs you 2', 'Which header co… Answered 12:12'), first)).toEqual([]);
    expect(answeredLineFailures(lines('Needs you 2', 'Which font for th… How it looks'), first)).toEqual([]);
  });
  it('wrong program: on the pixels, the answered row still drawn open fails, naming it', () => {
    expect(answeredLineFailures(lines('Needs you 2', 'Which header co… How it looks'), first).join('\n')).toMatch(/still draw answered ask:01's row as open/);
  });
  it('wrong program: on the pixels, the answered question on two lines fails', () => {
    expect(answeredLineFailures(lines('Which header co… Answered', 'Which header colour on the login page? Answered'), first).join('\n')).toMatch(/on 2 lines/);
  });
});
