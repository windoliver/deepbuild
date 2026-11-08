// The judges and the taste call on written readings, no app, anywhere. No criterion tag: they pass at the base on purpose.
// They show each judge rejects what the real window can't be made to show here: a reason or a fix gone, a button only a
// screen reader gets, one outside the window. Only first-screen.test.ts reaches the real first screen.
import { describe, expect, it } from 'vitest';
import { finishedFailures, offeredFailures } from './helpers.ts';
import { kept, tasteCall, type Seen, type Taste } from './window.ts';

const FILE = '/tmp/da1002-x/h/.claude/settings.json';
const REASON = 'Setup stopped: ~/.claude/settings.json is not valid JSON. Fix the file, then Set up again.';
const COUNT = 'Setup didn\'t finish';
const node = (role: string, name: string, frame = [10, 60, 40, 20]) => ({ role, name, frame });
const right = (over: Partial<Seen> = {}): Seen => ({
  window: [0, 40, 960, 640],
  nodes: [node('AXButton', COUNT), node('AXButton', 'Set up'), node('AXStaticText', REASON)],
  lines: [COUNT, 'Set up', REASON],
  menu: [COUNT],
  picture: '',
  ...over,
});
const settings = { file: FILE };

describe('#1002 (judges) the first screen after a setup that stopped', () => {
  it('passes the right screen', () => {
    expect(offeredFailures(right(), settings)).toEqual([]);
    expect(offeredFailures(right({ lines: [COUNT, 'Set up', 'Setup stopped: the hub didn\'t start', 'through its login service'], nodes: [node('AXButton', COUNT), node('AXButton', 'Set up'), node('AXStaticText', 'Setup stopped: the hub didn\'t start')] }), 'hub')).toEqual([]);
  });
  it.each<[string, Partial<Seen>, RegExp]>([
    ['the window\'s count reads 0', { lines: ['0 asks need you', 'Set up', REASON] }, /never 0: the window reads "0 asks need you"/],
    ['a node reads 0', { nodes: [node('AXButton', '0 asks need you'), node('AXButton', 'Set up'), node('AXStaticText', REASON)] }, /never 0: the window reads/],
    ['the menu bar is a number', { menu: ['0'] }, /never 0: the menu bar reads "0"/],
    ['the menu bar is empty', { menu: [] }, /never 0: the menu bar reads ""/],
    ['the menu bar says something else', { menu: ['No hub'] }, /the menu bar reads "No hub"/],
    ['no node says it', { nodes: [node('AXButton', 'Set up'), node('AXStaticText', REASON)] }, /no node of the window says so/],
    ['only a screen reader gets the count', { lines: ['Set up', REASON] }, /the window's pixels don't say so/],
    ['no button', { nodes: [node('AXButton', COUNT), node('AXStaticText', 'Set up'), node('AXStaticText', REASON)] }, /no button named "Set up"/],
    ['the button is outside the window', { nodes: [node('AXButton', COUNT), node('AXButton', 'Set up', [10, 900, 40, 20]), node('AXStaticText', REASON)] }, /is outside the window/],
    ['the button isn\'t drawn', { lines: [COUNT, REASON] }, /pixels draw no Set up button/],
    ['no reason on the nodes', { nodes: [node('AXButton', COUNT), node('AXButton', 'Set up')] }, /must show why setup stopped, naming/],
    ['no reason on the pixels', { lines: [COUNT, 'Set up'] }, /must show why setup stopped, naming/],
    ['no fix', { nodes: [node('AXButton', COUNT), node('AXButton', 'Set up'), node('AXStaticText', '~/.claude/settings.json is not valid JSON')] }, /must show the reason's fix/],
  ])('fails when %s', (_, over, why) => {
    expect(offeredFailures(right(over), settings).join('\n')).toMatch(why);
  });
  it('fails a hub reason that names no hub', () => {
    expect(offeredFailures(right(), 'hub').join('\n')).toMatch(/that the hub didn't start/);
  });
  it('rejects Set up or the words once setup finished, and passes a window with neither', () => {
    expect(finishedFailures(right()).join('\n')).toMatch(/still has the Set up button/);
    expect(finishedFailures(right({ nodes: [], lines: [], menu: [COUNT] })).join('\n')).toMatch(/must not read setup didn't finish/);
    expect(finishedFailures(right({ nodes: [node('AXButton', '0 asks need you')], lines: ['0 asks need you'], menu: ['0'] }))).toEqual([]);
  });
});

describe('#1002 (judges) the taste call', () => {
  const got = { 'a.png': 'aa', 'run.json': 'bb' };
  const call: Taste = { verdict: 'looks_right', who: 'you', when: '2026-11-06', files: got };
  it('is INCONCLUSIVE with no call, no person or other pictures, never a pass', () => {
    expect(() => tasteCall({ verdict: null }, got)).toThrow(/INCONCLUSIVE: no taste call/);
    expect(() => tasteCall({ ...call, who: null }, got)).toThrow(/INCONCLUSIVE: the taste call names no one/);
    expect(() => tasteCall({ ...call, files: { 'a.png': 'other', 'run.json': 'bb' } }, got)).toThrow(/INCONCLUSIVE: the recorded taste call was made on other pictures/);
  });
  it('fails looks_wrong, quoting it, and passes looks_right on exactly these files', () => {
    expect(() => tasteCall({ ...call, verdict: 'looks_wrong', note: 'cramped' }, got)).toThrow(/cramped/);
    expect(() => tasteCall(call, got)).not.toThrow();
  });
  it('keeps a recorded run only from the same app with the same files', () => {
    expect(kept(call, got, 'app', 'app')).toBe(true);
    expect(kept(call, got, 'other', 'app')).toBe(false);
    expect(kept({ verdict: null, files: {} }, {}, 'app', 'app')).toBe(false);
  });
});
