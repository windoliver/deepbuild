// The judges, on made-up snapshots and readings: no app, no replica, no criterion tag, runnable at the base anywhere. Each
// judge a criterion leans on passes a right input and fails the wrong ones, naming what it should, so a failure on the
// replica or the app is theirs, not the judge's.
import { describe, expect, it } from 'vitest';
import { chartFailures, firstDifference, handlesShown, idFailures, locatedFailures, locatorWords, readingFailures, visibleWords, type FixtureAsk, type SNode, type Snapshot } from './helpers.ts';

const node = (role: string, name: string | null, id: string | null, bounds = [0, 0, 10, 10], children: SNode[] = [], value: unknown = null): SNode => ({ role, name, value, id, bounds, children });
const snap = (children: SNode[], items: Snapshot['items'] = []): Snapshot => ({ window: { size: [1512, 982], scale: 2 }, tree: node('window', null, null, [0, 0, 3024, 1964], children), items });
const asks: FixtureAsk[] = [
  { handle: 'ask:01KB1459AK0000000000000001', question: 'First?', session: 's1' },
  { handle: 'ask:01KB1459AK0000000000000002', question: 'Second?', session: 's1' },
  { handle: 'ask:01KB1459AK0000000000000003', question: 'Third?', session: 's2' },
];
const sessions = [{ id: 's1', title: 'Cart totals' }];
const rows = (list: FixtureAsk[], id: (a: FixtureAsk, i: number) => string | null, session = 'session:s1'): Snapshot => snap([
  node('button', '! Cart totals · needs you', session),
  ...list.map((a, i) => node('button', a.question, id(a, i))),
]);

describe('#1459 (judges) row ids across a close', () => {
  it('passes rows keyed by their asks, and fails rows keyed by their place, naming the row that moved', () => {
    const byAsk = (a: FixtureAsk): string => a.handle;
    expect(idFailures(rows(asks, byAsk), rows(asks.slice(1), byAsk), asks, asks[0]!, sessions)).toEqual([]);
    const byPlace = (_: FixtureAsk, i: number): string => `ask-${i}`;
    const failed = idFailures(rows(asks, byPlace), rows(asks.slice(1), byPlace), asks, asks[0]!, sessions).join('\n');
    expect(failed).toContain(`the row for ${asks[1]!.handle} ("Second?") had id ask-1 and has ask-0`);
    expect(failed).toContain('its id is its place');
  });
  it('fails rows with no id, rows sharing one, a close that closed nothing, and a session row whose id moved', () => {
    expect(idFailures(rows(asks, () => null), rows(asks.slice(1), () => null), asks, asks[0]!, sessions).join('\n')).toContain('carries no id');
    expect(idFailures(rows(asks, () => 'same'), rows(asks.slice(1), () => 'same'), asks, asks[0]!, sessions).join('\n')).toContain('share the id same');
    expect(idFailures(rows(asks, (a) => a.handle), rows(asks, (a) => a.handle), asks, asks[0]!, sessions).join('\n')).toContain('still has a row');
    expect(idFailures(rows(asks, (a) => a.handle), rows(asks.slice(1), (a) => a.handle, 'session:1'), asks, asks[0]!, sessions).join('\n')).toContain('session s1\'s row');
  });
});

describe('#1459 (judges) a located row and drawn handles', () => {
  it('passes the row named by its question, and fails another ask\'s row, a handle as a name, and nothing', () => {
    expect(locatedFailures(node('button', 'First? · needs you', asks[0]!.handle), asks[0]!)).toEqual([]);
    expect(locatedFailures(node('button', 'Second?', asks[1]!.handle), asks[0]!).join()).toContain('not a row whose name starts with its question');
    expect(locatedFailures(node('button', asks[0]!.handle, asks[0]!.handle), asks[0]!).join()).toContain('not a row whose name starts');
    expect(locatedFailures(undefined, asks[0]!).join()).toContain('located nothing');
  });
  it('finds a handle in a name or a value, never in an id', () => {
    expect(handlesShown(rows(asks, (a) => a.handle))).toEqual([]);
    expect(handlesShown(snap([node('button', `First? ${asks[0]!.handle}`, null)])).length).toBe(1);
    expect(handlesShown(snap([node('label', 'First?', null, [0, 0, 1, 1], [], asks[0]!.handle)])).length).toBe(1);
  });
});

describe('#1459 (judges) a journey\'s words', () => {
  const byId = [{ call: 'launch', launch: { fixture: '/x' } }, { call: 'act', locator: { id: asks[0]!.handle }, act: { kind: 'click' } }];
  const byName = [{ call: 'launch', launch: {} }, { call: 'expect', locator: { role: 'button', name: 'First?' }, expect: { assert: 'visible' } }];
  it('reads every locator string with its step, and the launch\'s fixture path is no locator', () => {
    expect(locatorWords(byId)).toEqual([{ step: 2, key: 'id', word: asks[0]!.handle }]);
    expect(locatorWords(byName).map((w) => w.word)).toEqual(['button', 'First?']);
  });
  it('passes a journey by id over a screen that draws no handle, and fails one by a name the screen shows, naming it', () => {
    const screen = rows(asks, (a) => a.handle);
    expect(visibleWords(byId, screen)).toEqual([]);
    expect(visibleWords(byName, screen).join()).toContain('"First?"');
  });
});

describe('#1459 (judges) a chart\'s readout and caption', () => {
  const items = [
    { id: 'caption', value: { text: 'Hours to each deadline', bound: false, at: [277, 81], box: [143, 17] } },
    { id: 'readout', value: { text: '3', bound: true, at: [825, 81], box: [34, 17] } },
    { id: 'line', value: [24, 25, 27] },
  ];
  const chart = node('image', 'Hours to each deadline, 3, 3 points', 'session-chart', [536, 152, 1200, 400]);
  it('passes a chart named once with its readout where it is drawn', () => {
    expect(chartFailures(snap([chart], items))).toEqual([]);
  });
  it('fails a readout only drawn, one named away from where it is drawn, a caption repeated beside the chart, and no chart', () => {
    expect(chartFailures(snap([node('label', 'Hours to each deadline: 3 points', null, [536, 552, 2472, 36])], items)).join()).toContain('readout "3"');
    expect(chartFailures(snap([chart, node('label', 'Hours to each deadline: 3 points', null, [536, 552, 2472, 36])], items)).join()).toContain('named by 2 nodes');
    expect(chartFailures(snap([node('label', 'Pop out', null)], [])).join()).toContain('draws no chart');
  });
});

describe('#1459 (judges) a row read aloud', () => {
  const before = { parts: ['Search index', 'sent back 1 of 3'] };
  it('passes the same words in order, whatever comes around them', () => {
    expect(readingFailures('✗ Search index · sent back 1 of 3', before, 'r')).toEqual([]);
    expect(readingFailures('Search index, sent back 1 of 3, 2 h', before, 'r')).toEqual([]);
  });
  it('fails a title alone, the words out of order, a status code and an ID', () => {
    expect(readingFailures('Search index', before, 'r').join()).toContain('lacks "sent back 1 of 3"');
    expect(readingFailures('sent back 1 of 3 · Search index', before, 'r').join()).toContain('in its place');
    expect(readingFailures('Search index · sent back 1 of 3 · needs_you', before, 'r').join()).toContain('"needs_you"');
    expect(readingFailures('Search index · sent back 1 of 3 · session:01KB1459SE0000000000000003', before, 'r').join()).toContain('an ID');
    expect(readingFailures(null, before, 'r').join()).toContain('reads nothing');
  });
});

describe('#1459 (judges) replica beside live', () => {
  it('finds a node whose id alone differs, and none in equal trees', () => {
    const a = rows(asks, (x) => x.handle);
    expect(firstDifference(a, structuredClone(a))).toBeNull();
    const b = structuredClone(a);
    b.tree.children[1]!.id = 'other';
    expect(firstDifference(a, b)).toContain('differs in id');
  });
});
