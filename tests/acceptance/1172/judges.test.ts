// The pixel judges, on drawn pictures and read lines: no app, no criterion tag, runnable at the base on any platform. Each
// judge AC1, AC2, AC4 and AC5 lean on must pass a right reading and fail the wrong ones, so a failure on the real app is
// the app's, not the judge's.
import { describe, expect, it } from 'vitest';
import { answeredFailures, askRowFailures, askRowLine, blankIn, drawsRow, listLines, rowLineFailures, rowReadingsFailures, unlessUnreadable, unreadable, within, gridLaw, groundAndInk, hex, type Ask, type Line, type Node, type Picture, type Rgb } from './helpers.ts';

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

describe('#1172 (judges) an answered ask: its list row drawn answered and its page saying so (Seventh redraft)', () => {
  const ask = (n: number, question: string, one: string, two: string): Ask => ({
    handle: `ask:0${n}`, question, option: { id: 'one', label: one }, other: two, session: 's', task: 't',
  });
  const asks = [
    ask(1, 'Which header colour on the login page?', 'Blue header', 'Green header'),
    ask(2, 'Which font for the printed receipt?', 'Serif receipt', 'Sans receipt'),
    ask(3, 'Which layout for the changelog?', 'Keep a list', 'Write prose'),
  ];
  const [first, second, third] = asks as [Ask, Ask, Ask];
  const tasks = ['Cart totals', 'Release notes'];
  /** The list spans x 0 to 260 and the page x 300 to 1000, as the design's two regions, list on the left (#1461). */
  const L = [8, 0, 244, 32];
  const P = [400, 0, 600, 32];
  const node = (frame: number[], role: string, name: string, ...children: Node[]): Node => ({ role, name, frame, children });
  const row = (a: Ask, word = 'How it looks'): Node => node(L, 'AXButton', a.question, node(L, 'AXStaticText', a.question), node(L, 'AXStaticText', word));
  const session = (t: string): Node => node([0, 0, 260, 32], 'AXButton', t);
  const list = (...rows: Node[]): Node => node([0, 0, 260, 900], 'AXGroup', 'Tasks', node(L, 'AXStaticText', 'Needs you'), ...rows, ...tasks.map(session));
  /** The page's closed card as the disputed Mac capture drew it: the question, then what became of it, no options. */
  const receipt = (a: Ask, said = `Answered "${a.option.label}" at 12:12 from deep inbox. Nothing is left to answer.`): Node =>
    node(P, 'AXGroup', '', node(P, 'AXStaticText', a.question), node(P, 'AXStaticText', said));
  const card = (a: Ask): Node => node(P, 'AXGroup', 'armed', node(P, 'AXStaticText', a.question), node(P, 'AXButton', a.option.label), node(P, 'AXButton', a.other));
  const win = (...children: Node[]): Node => node([0, 0, 1512, 982], 'AXWindow', '', ...children);
  const judge = (w: Node): string => answeredFailures([w], first, asks, tasks).join('\n');
  const lines = (...texts: [string, number][]): Line[] => texts.map(([text, x]) => ({ text, box: [x, 0, 200, 20] }));
  /** The two open rows as the R4b Mac run drew them (ninth redraft), beside the answered ask's lines. */
  const OPEN: [string, number][] = [['... How it looks tomorrow 16:49', 10], ['• ... How it looks tomorrow 16:49', 10]];
  const pixels = (...texts: [string, number][]): string => rowLineFailures(lines(...OPEN, ...texts), asks, 520, { open: 2, kept: 1 }).join('\n');

  it('control: the list row kept drawn answered and the page\'s closed card saying it was answered pass (the review\'s right program)', () => {
    expect(judge(win(list(row(first, 'Answered'), row(second), row(third)), receipt(first)))).toBe('');
  });
  it('control: a list row whose state word is a lower-case "answered", beside the page\'s closed card, passes (eighth redraft)', () => {
    expect(judge(win(list(row(first, 'answered'), row(second), row(third)), receipt(first)))).toBe('');
    expect(pixels(['• Which header co... answered', 10], ['Which header colour on the login page? Answered "Blue header" at 12:12 from deep inbox. Nothing is left to answe…', 700])).toBe('');
    expect(pixels(['• ... answered 12:12', 10])).toBe('');
  });
  it('control: the page alone saying it was answered, the row gone, passes; so does nothing at all', () => {
    expect(judge(win(list(row(second), row(third)), receipt(first)))).toBe('');
    expect(judge(win(list(row(second), row(third)), card(second)))).toBe('');
  });
  it('wrong program: the answered ask kept as a still-open list row fails, naming the list', () => {
    expect(judge(win(list(row(first), row(second), row(third)), receipt(first)))).toMatch(/answered ask:01 .* still reads as open in the list/);
  });
  it('wrong program: two list rows for the answered ask, both drawn answered, fail', () => {
    expect(judge(win(list(row(first, 'Answered'), row(first, 'Answered'), row(second), row(third))))).toMatch(/at most 1 node in the list, drawn answered; it has 2/);
  });
  it('wrong program: the answered ask\'s card still offering its options on the page fails', () => {
    expect(judge(win(list(row(first, 'Answered'), row(second), row(third)), card(first)))).toMatch(/still offers answered ask:01's options/);
  });
  it('wrong program: the page still showing the question with no word of the answer fails, naming the page', () => {
    expect(judge(win(list(row(second), row(third)), receipt(first, 'Pick one')))).toMatch(/still reads as open in the page/);
  });
  it.each([['Unanswered'], ['unanswered'], ['Not answered'], ['Not  Answered'], ['not yet answered'], ['not yet Answered'], ["isn't answered"], ['to be answered'], ['never Answered']])('wrong program: a list row reading "%s" still reads as open', (word) => {
    expect(judge(win(list(row(first, word), row(second), row(third))))).toMatch(/still reads as open in the list/);
  });
  it('blocked, never a pass: with no session row the list can\'t be told from the page', () => {
    expect(answeredFailures([win(row(first, 'Answered'))], first, asks, tasks).join('\n')).toMatch(/can't tell the list from the page/);
  });
  it('control: on the pixels, the list row cut and drawn answered and the page\'s receipt line pass', () => {
    expect(pixels(['Which header co… Answered 12:12', 10], ['Which header colour on the login page? Answered "Blue header" at 12:12 from deep inbox. Nothing is left to answe…', 700])).toBe('');
  });
  it('wrong program: on the pixels, the list row still drawn open fails, though the page says answered', () => {
    expect(pixels(['• Which header co... How it looks', 10], ['Which header colour on the login page? Answered "Blue header"', 700])).toMatch(/3 open ask row\(s\), not 2/);
  });
  it.each([['Not answered'], ['unanswered'], ['not yet answered']])('wrong program: on the pixels, a list line reading "%s" fails', (word) => {
    expect(pixels([`Which header co… ${word}`, 10])).toMatch(/3 open ask row\(s\), not 2/);
  });
  it('wrong program: on the pixels, two list lines drawing the answered row fail', () => {
    expect(pixels(['Which header co… Answered', 10], ['Which header co… Answered', 10])).toMatch(/2 answered ask row\(s\), more than 1/);
  });
});

describe('#1172 (judges) Needs you rows on the pixels once an ask row keeps its time (Ninth redraft)', () => {
  const ask = (n: number, question: string): Ask => ({ handle: `ask:0${n}`, question, option: { id: 'one', label: 'a' }, other: 'b', session: 's', task: 't' });
  const asks = [ask(1, 'Which header colour on the login page?'), ask(2, 'Which font for the printed receipt?'), ask(3, 'Which layout for the changelog?')];
  const line = (text: string, x = 10): Line => ({ text, box: [x, 0, 200, 20] });
  /** The R4b Mac run's list (main 02ee0dff4, with #3282's kept time): every title cut to its ellipsis. */
  const R4B = ['Needs you', '... How it looks tomorrow 16:49', '• ... How it looks tomorrow 16:49', '• ... How it looks tomorrow 16:49', 'Tasks', 'Cart totals', 'Release notes'].map((t) => line(t));
  const judge = (ls: readonly Line[], open = 3, kept = 0): string => rowLineFailures(ls, asks, 520, { open, kept }).join('\n');

  it('control: the R4b reading, three rows each cut to an ellipsis before its kind and time, passes', () => {
    expect(judge(R4B)).toBe('');
  });
  it.each([
    ['the third redraft\'s reading, a title cut after 15 characters', 'Which header co... How it looks'],
    ['a title cut after "Which"', '• Which… How it looks tomorrow 16:49'],
    ['a title cut after "Wh"', 'Wh… How it looks in 1 d'],
    ['the whole question', 'Which header colour on the login page? How it looks'],
    ['its mark read by OCR as "o"', 'o ... How it looks tomorrow 16:49'],
    ['its mark read by OCR as "·"', '· … How it looks'],
    ['its mark read by OCR as "0", before a cut title', '0 Which hea… How it looks'],
  ])('control: a row line with %s draws a row', (_, text) => {
    expect(askRowLine(text, asks)).toBe(true);
  });
  it.each([
    ['the ask\'s handle, cut', 'ask:01MCBHM3… How it looks'],
    ['the ask\'s kind alone, no ellipsis', 'How it looks tomorrow 16:49'],
    ['an ellipsis with nothing after it (no right slots)', '• Which header co…'],
    ['a title clipped at the edge with no ellipsis', 'Which header colour on the lo'],
    ['an ellipsis after text that isn\'t a question\'s start', 'Header colour on the login... How it looks'],
    ['a session row', 'Cart totals Working 2m'],
    ['the heading', 'Needs you'],
    ['a session row cut by an ellipsis', 'Release no… Working'],
    ['a one-letter token that isn\'t a lone mark, glued to its title', 'oRelease no… Working'],
  ])('wrong program: a line with %s draws no row', (_, text) => {
    expect(askRowLine(text, asks)).toBe(false);
  });
  it('control: the R4b reading with each mark OCR\'d as a letter or glyph still counts three rows', () => {
    expect(judge(['Needs you', 'o ... How it looks tomorrow 16:49', 'e ... How it looks tomorrow 16:49', '° ... How it looks tomorrow 16:49', 'Release no… Working'].map((t) => line(t)))).toBe('');
  });
  it('wrong program: nothing seen fails, never a pass', () => {
    expect(judge([])).toMatch(/0 open ask row\(s\), not 3/);
  });
  it('wrong program: a row missing from the list fails, naming the count', () => {
    expect(judge(R4B.slice(0, 3))).toMatch(/2 open ask row\(s\), not 3/);
  });
  it('wrong program: handle rows draw no row, so the list counts none', () => {
    expect(judge(['ask:01MCBHM300GP83QANM5WDCWNNP How it looks', 'ask:02MCBHM300GP83QANM5WDCWNNQ How it looks', 'ask:03MCBHM300GP83QANM5WDCWNNR How it looks'].map((t) => line(t)))).toMatch(/0 open ask row\(s\), not 3/);
  });
  it('wrong program: rows drawn only on the page, right of the list\'s edge, don\'t count', () => {
    expect(judge(R4B.map((l) => ({ ...l, box: [700, 0, 200, 20] })))).toMatch(/0 open ask row\(s\), not 3/);
  });
  it('control: a window that is all list (no edge, the popped view) counts every line', () => {
    expect(rowLineFailures(R4B.map((l) => ({ ...l, box: [700, 0, 200, 20] })), asks, null, { open: 3, kept: 0 })).toEqual([]);
  });
  it('AC2: after the answer, two open rows and the answered row drawn answered pass; the answered row still open fails', () => {
    const two = R4B.slice(0, 3);
    expect(judge([...two, line('• ... answered 12:12')], 2, 1)).toBe('');
    expect(judge(two, 2, 1)).toBe('');
    expect(judge([...two, line('• ... How it looks tomorrow 16:49')], 2, 1)).toMatch(/3 open ask row\(s\), not 2/);
  });
  it('AC5: after the pop-out, a main window still drawing a row in its list fails', () => {
    expect(rowLineFailures([line('Tasks'), line('Cart totals'), line('• ... How it looks tomorrow 16:49')], asks, 520, { open: 0, kept: 0 }).join('\n')).toMatch(/1 open ask row\(s\), not 0/);
  });
});

describe('#1172 (judges) a capture OCR reads nothing from is unreadable, never 0 rows (Tenth redraft)', () => {
  const asks: Ask[] = ['Which header colour on the login page?', 'Which font for the printed receipt?', 'Which layout for the changelog?']
    .map((question, i) => ({ handle: `ask:0${i + 1}`, question, option: { id: 'one', label: 'a' }, other: 'b', session: 's', task: 't' }));
  const line = (text: string): Line => ({ text, box: [10, 0, 200, 20] });
  /** R5e's list region (the left 520 px of shell-2.png), which `.accurate` reads whole though the whole frame read nothing. */
  const R5E = ['D', 'Needs you', '2', '• ... How it looks tomorrow 14:30', '• ... How it looks tomorrow 14:30', 'No project'].map(line);
  const full = [0, 0, 400, 200];

  it('control: a drawn picture isn\'t blank; one fill is', () => {
    expect(blankIn(picture([[21, 31, 2, 9, [24, 24, 24]]]), full)).toBe(false);
    expect(blankIn(picture([]), full)).toBe(true);
  });
  it('wrong reading: no line from a region that isn\'t blank is unreadable, never a count', () => {
    expect(unreadable([], false, 'the list\'s region')).toMatch(/^UNREADABLE: OCR read no line from the list's region/);
  });
  it('control: no line from a blank region, or any line read, is a reading', () => {
    expect(unreadable([], true, 'x')).toBeNull();
    expect(unreadable(R5E, false, 'x')).toBeNull();
  });
  it('wrong program: a blank list (one fill, no line) is read as no rows and fails by count', () => {
    expect(unreadable([], true, 'x')).toBeNull();
    expect(rowLineFailures([], asks, 520, { open: 2, kept: 1 }).join('\n')).toMatch(/0 open ask row\(s\), not 2/);
  });
  it('control: R5e\'s list region after the answer, two open rows, passes', () => {
    expect(rowLineFailures(R5E, asks, 520, { open: 2, kept: 1 })).toEqual([]);
  });
  it('twin A: the answered ask still drawn open in the list region fails by count', () => {
    expect(rowLineFailures([...R5E, line('• ... How it looks tomorrow 14:30')], asks, 520, { open: 2, kept: 1 }).join('\n')).toMatch(/3 open ask row\(s\), not 2/);
  });
  it('only unreadable failures make the run INCONCLUSIVE, never PASS', () => {
    expect(() => unlessUnreadable(['UNREADABLE: OCR read no line from the list\'s region'])).toThrow(/INCONCLUSIVE: UNREADABLE/);
    expect(unlessUnreadable([])).toEqual([]);
  });
  it('twin A with its pixels unreadable still fails on the tree, never INCONCLUSIVE', () => {
    const failures = ['UNREADABLE: OCR read no line from the list\'s region', 'answered ask:01 ("Which header colour on the login page?") still reads as open in the list: …'];
    expect(unlessUnreadable(failures)).toEqual(failures);
  });
  it('the blank-main twin fails on the tree (no list), never INCONCLUSIVE', () => {
    const failures = ['the window has no registered sidebar: no node is named "Tasks"', 'can\'t find the list on the pixels: no session row ["Cart totals","Release notes"] is on the tree'];
    expect(unlessUnreadable(failures)).toEqual(failures);
  });
});

describe('#1172 (judges) a row whose ellipsis OCR dropped, counted over the readings (Eleventh redraft)', () => {
  const asks: Ask[] = ['Which header colour on the login page?', 'Which font for the printed receipt?', 'Which layout for the changelog?']
    .map((question, i) => ({ handle: `ask:0${i + 1}`, question, option: { id: 'one', label: 'a' }, other: 'b', session: 's', task: 't' }));
  const list = (text: string): Line => ({ text, box: [10, 0, 200, 20] });
  const page = (text: string): Line => ({ text, box: [900, 0, 400, 20] });
  /** R7t ac1-3's list region, `.accurate` over [0, 0, listEdgePx, height]: one row's ellipsis lost. */
  const REGION = ['Needs you', 'How it looks tomorrow 19:53', '... How it looks tomorrow 19:53', '... How it looks tomorrow 19:53', 'No project', '• Cart totals', '• Release notes', '38 s', '38 s'].map(list);
  /** The same capture's whole-window `.accurate` reading: all three rows with their ellipsis, and the page. */
  const WHOLE = [...['Needs you', '• ... How it looks tomorrow 19:53', '• ... How it looks tomorrow 19:53', '• ... How it looks tomorrow 19:53', 'No project', '• Cart totals', '• Release notes', '38 s', '38 s'].map(list),
    ...['How it looks', 'Which header colour on the login page?', 'Blue header recommended', 'Green header', 'Default: Blue header • at tomorrow 19:53', 'Answer'].map(page)];
  /** The `.fast` reading of the same list: every row without its ellipsis. */
  const FAST = ['Needs you', 'How it looks tomorrow 19:53', 'How it looks tomorrow 19:53', 'How it looks tomorrow 19:53', 'No project', 'Cart totals', 'Release notes'].map(list);
  const judge = (readings: readonly (readonly Line[])[], open = 3, kept = 0): string => rowReadingsFailures(readings, asks, 520, { open, kept }).join('\n');

  it('control: R7t ac1-3, the region read short one ellipsis beside the whole read with all three, passes', () => {
    expect(judge([REGION, WHOLE])).toBe('');
  });
  it('control: either reading order, and the whole read alone, pass', () => {
    expect(judge([WHOLE, REGION])).toBe('');
    expect(judge([WHOLE])).toBe('');
  });
  it('R7t ac1-3\'s region read alone, short only by a row read without its ellipsis, is INCONCLUSIVE, never a fail or a pass', () => {
    const failures = rowReadingsFailures([REGION], asks, 520, { open: 3, kept: 0 });
    expect(failures.join('\n')).toMatch(/^UNREADABLE: the list's pixels draw at most 2 open ask row\(s\) with their ellipsis, not 3/);
    expect(() => unlessUnreadable(failures)).toThrow(/INCONCLUSIVE/);
  });
  it('wrong program: rows drawn with their kind and time and no ellipsis (the .fast reading\'s look) fail, 0 not 3', () => {
    expect(judge([FAST])).toMatch(/^the list's pixels draw 0 open ask row\(s\), not 3/);
  });
  it('wrong program: a row missing from the list fails in every reading, never INCONCLUSIVE', () => {
    const two = WHOLE.filter((_, i) => i !== 3);
    expect(judge([two, REGION.filter((_, i) => i !== 1)])).toMatch(/^the list's pixels draw 2 open ask row\(s\), not 3/);
  });
  it('wrong program: an extra row drawn with no title and no ellipsis beside the three fails', () => {
    expect(judge([[...WHOLE, list('How it looks tomorrow 19:53')]])).toMatch(/4 open ask row\(s\), not 3, 1 of them with no ellipsis/);
  });
  it('twin A: the answered ask still drawn open fails by count, with or without its ellipsis read', () => {
    expect(judge([REGION, WHOLE], 2, 1)).toMatch(/^the list's pixels draw 3 open ask row\(s\), not 2/);
    expect(judge([REGION], 2, 1)).toMatch(/^the list's pixels draw 3 open ask row\(s\), not 2, 1 of them with no ellipsis/);
  });
  it('AC2 control: two open rows and the answered row drawn answered pass, one reading short an ellipsis', () => {
    const after = [list('Needs you'), list('How it looks tomorrow 19:53'), list('• ... How it looks tomorrow 19:53'), list('• ... answered 19:54')];
    const whole = [list('Needs you'), list('• ... How it looks tomorrow 19:53'), list('• ... How it looks tomorrow 19:53'), list('• ... answered 19:54')];
    expect(judge([after, whole], 2, 1)).toBe('');
  });
  it('wrong program: two answered rows fail in whichever reading draws them', () => {
    expect(judge([[list('• ... How it looks tomorrow 19:53'), list('• ... How it looks tomorrow 19:53'), list('… answered'), list('… answered')]], 2, 1)).toMatch(/2 answered ask row\(s\), more than 1/);
  });
  it('wrong program: handle rows, or rows drawn only right of the list\'s edge, count none in any reading', () => {
    expect(judge([['ask:01MCB How it looks tomorrow 19:53', 'ask:02MCB How it looks tomorrow 19:53', 'ask:03MCB How it looks tomorrow 19:53'].map(list)])).toMatch(/^the list's pixels draw 0 open ask row\(s\), not 3/);
    expect(judge([WHOLE.map((l) => ({ ...l, box: [900, 0, 400, 20] }))])).toMatch(/^the list's pixels draw 0 open ask row\(s\), not 3/);
  });
  it('a page line reading a row\'s kind and time right of the edge is no bare row', () => {
    expect(judge([[...REGION.slice(2, 4), page('How it looks tomorrow 19:53')]])).toMatch(/^the list's pixels draw 2 open ask row\(s\), not 3/);
  });
  it('wrong program: 2 of 3 rows, where the whole reading merged a list line with the page\'s whole question, fails', () => {
    const merged: Line = { text: '• Release notes Which font for the printed receipt?', box: [10, 0, 900, 20] };
    const whole = [list('Needs you'), list('• ... How it looks tomorrow 19:53'), list('• ... How it looks tomorrow 19:53'), merged];
    expect(judge([whole])).toBe('');
    expect(listLines(whole, 520)).not.toContain(merged);
    expect(judge([REGION.filter((_, i) => i !== 1), listLines(whole, 520)])).toMatch(/^the list's pixels draw 2 open ask row\(s\), not 3/);
  });
  it('wrong program: no reading at all fails by count, never a pass', () => {
    expect(judge([])).toMatch(/^the list's pixels draw 0 open ask row\(s\), not 3/);
  });
});

describe('#1172 (judges) builds run before the timed checks, bounded, and a build that can\'t finish is BLOCKED (Eleventh redraft)', () => {
  it('control: a build done within its bound gives its result', async () => {
    await expect(within(Promise.resolve('bin'), 1000, 'building')).resolves.toBe('bin');
  });
  it('a build still running at its bound is BLOCKED, never a fail of the program', async () => {
    await expect(within(new Promise(() => undefined), 20, 'building the app')).rejects.toThrow(/^BLOCKED: building the app didn't finish within 0 min; it ran before any check, so nothing was judged/);
  });
  it('a build that fails is BLOCKED, naming what failed', async () => {
    await expect(within(Promise.reject(Error('cargo build: exit 101')), 1000, 'building the app')).rejects.toThrow(/^BLOCKED: building the app failed: cargo build: exit 101/);
  });
  it('a BLOCKED inside a build (no Accessibility permission) stays BLOCKED, said once', async () => {
    await expect(within(Promise.reject(Error('BLOCKED: no Accessibility permission')), 1000, 'building')).rejects.toThrow(/^BLOCKED: no Accessibility permission; it ran before/);
  });
});
