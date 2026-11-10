// The judges, each held to a right input and the wrong ones, with no hub, CLI or replica: a judge that passes what it
// should fail would let a criterion pass on a wrong program. No criterion tag: these pass at the base.
import { describe, expect, test } from 'vitest';
import {
  afterListFailures, clockFailures, clockOf, countFailures, defaultFieldFailures, downFailures, drawnFailures, endFailures, inboxFailures, leakFailures,
  notificationFailures, rowFailures, shapeFailures, textRowFailures, todayAt,
  type FixtureAsk, type FixtureSession, type Row, type Snapshot,
} from './helpers.ts';

const row = (id: string, title: string, word: string, entry: string, unread = false): Row => ({ id, address: id, title, entry, word, why: 'an ask open for 1 min', waits_on: 'you', since: 1, actions: [], unread });
const ROWS = [row('ask:01KB1463AK0000000000000001', 'Which header colour?', 'needs you', 'needs_you', true), row('session:s1', 'Cart totals', 'needs you', 'needs_you'), row('session:s2', 'Search index', 'PASS', 'pass')];
const ASK: FixtureAsk = { handle: 'ask:01KB1463AK0000000000000002', question: 'Ship the cart page today?', session: 's1', key: 'cart', label: 'No', deadline: todayAt(16, 40), defaulted: false };

describe('judges', () => {
  test('shapeFailures: the row shape, a boolean unread', () => {
    expect(shapeFailures(ROWS, 'r')).toEqual([]);
    const { unread: _u, ...noUnread } = ROWS[0]!;
    expect(shapeFailures([noUnread as Row], 'r').join()).toMatch(/lacks unread/);
    expect(shapeFailures([{ ...ROWS[0]!, unread: 'yes' as unknown as boolean }], 'r').join()).toMatch(/not true or false/);
  });

  test('rowFailures: rows, order, word and unread, naming the row', () => {
    expect(rowFailures(ROWS, ROWS.map((r) => ({ ...r })), 's')).toEqual([]);
    expect(rowFailures(ROWS, [...ROWS].reverse(), 's').join()).toMatch(/^row ask:01KB1463AK0000000000000001 is row 1 .* second order/);
    expect(rowFailures(ROWS, ROWS.map((r) => (r.word === 'needs you' ? { ...r, word: 'need you' } : r)), 's')).toEqual([
      'row ask:01KB1463AK0000000000000001 has word "needs you" in the app\'s list and "need you" in s', 'row session:s1 has word "needs you" in the app\'s list and "need you" in s']);
    expect(rowFailures(ROWS, ROWS.map((r) => ({ ...r, unread: !r.unread })), 's').filter((f) => / has unread /.test(f))).toHaveLength(3);
    expect(rowFailures(ROWS, ROWS.slice(1), 's').join()).toMatch(/ask:01KB1463AK0000000000000001 .* not in s/);
  });

  test('drawnFailures: each row drawn by its id, in order, with its title and word', () => {
    const node = (id: string | null, name: string, children: Snapshot['tree'][] = []): Snapshot['tree'] => ({ role: 'button', name, value: null, id, bounds: [0, 0, 1, 1], children });
    const snap = (nodes: Snapshot['tree'][]): Snapshot => ({ window: { size: [1, 1], scale: 2 }, tree: node(null, '', nodes), items: [] });
    const right = snap(ROWS.map((r) => node(r.id, '', [node(null, `${r.title} · ${r.word}`)])));
    expect(drawnFailures(right, ROWS)).toEqual([]);
    expect(drawnFailures(snap([...right.tree.children].reverse()), ROWS).join()).toMatch(/drawn above/);
    expect(drawnFailures(snap(ROWS.map((r) => node(r.id, r.title))), ROWS).join()).toMatch(/lacks its word/);
    expect(drawnFailures(snap(ROWS.map((r, i) => node(`row-${i}`, `${r.title} · ${r.word}`))), ROWS).join()).toMatch(/no node of the window carries its id/);
  });

  test('textRowFailures, countFailures and afterListFailures: the list as text', () => {
    const text = ['Which header colour?  needs you', 'Cart totals  needs you', 'Search index  PASS', '1 ask needs you'].join('\n');
    expect([...textRowFailures(text, ROWS, 'deep'), ...countFailures(text, [1], 'deep'), ...afterListFailures(text, ROWS, 'deep')]).toEqual([]);
    expect(textRowFailures(['Cart totals  needs you', 'Which header colour?  needs you', 'Search index  PASS'].join('\n'), ROWS, 'deep').join()).toMatch(/out of the rows' order/);
    expect(textRowFailures(text.replace('PASS', 'finished'), ROWS, 'deep').join()).toMatch(/session:s2/);
    expect(countFailures(`${text}\n2 asks need you`, [1], 'deep').join()).toMatch(/"2 asks need you", a second count/);
    expect(countFailures(text, [1, 2], 'deep').join()).toMatch(/not one count/);
    expect(afterListFailures(`${text}\nUsage: deep [--help]`, ROWS, 'deep').join()).toMatch(/help text/);
    expect(afterListFailures(`Reading the hub at unix:/x\n${text}`, ROWS, 'deep').join()).toMatch(/plumbing/);
  });

  // tableFailures' and retiredFailures' self-test is redraft-judges/table-judges.test.ts's, swapped in: this one held
  // that `finished` is no word of states::TABLE, which #992's words, the table gains, make untrue.

  test('inboxFailures and defaultFieldFailures: the question first, the default, the handle last', () => {
    const line = `Ship the cart page today?  If you don't answer: No, at ${clockOf(ASK.deadline)}  ${ASK.handle}`;
    expect(inboxFailures(line, [ASK], [ASK])).toEqual([]);
    expect(inboxFailures(`${ASK.handle}  choice  Ship the cart page today?`, [ASK]).join()).toMatch(/before its question/);
    expect(inboxFailures(`Ship the cart page today?  ${ASK.handle}  [yes | no]`, [ASK]).join()).toMatch(/isn't last/);
    expect(inboxFailures(`Ship the cart page today?  ${ASK.handle}`, [ASK], [ASK]).join()).toMatch(new RegExp(`${ASK.handle}.*lacks "If you don't answer`));
    expect(inboxFailures(line.replace(clockOf(ASK.deadline), '11:10'), [ASK], [ASK])).toHaveLength(1);
    const json = { ...row(ASK.handle, ASK.question, 'needs you', 'needs_you'), default: 'No', default_at: ASK.deadline };
    expect(defaultFieldFailures([json], ASK)).toEqual([]);
    expect(defaultFieldFailures([{ ...json, default: 'no', default_at: new Date(ASK.deadline).toISOString() }], ASK)).toHaveLength(2);
  });

  test('clockFailures: a clock time in the zone, never UTC', () => {
    const at = todayAt(16, 40);
    expect(clockFailures(`ask:X is open again; it now defaults at ${clockOf(at)}`, at, 'undo')).toEqual([]);
    expect(clockFailures(`ask:X is open again, its default undone; it waits until ${new Date(at).toISOString()}`, at, 'undo').join()).toMatch(/UTC timestamp/);
    expect(clockFailures(`it now defaults at ${new Date(at).toISOString().slice(11, 16)}`, at, 'undo').join()).toMatch(/doesn't say/);
  });

  test('leakFailures and notificationFailures: no other session, no ID', () => {
    const other = { session: '04738c51-1489-4e50-ae54-cad8321de533', handle: 'ask:01M722BAX1QWFZHRDEHA4JD16G', question: 'Keep the list?' };
    expect(leakFailures({ session: 'a-1', gates: {}, rows: [{ id: 'ask:01M7OWN' }] }, 'a-1', other)).toEqual([]);
    expect(leakFailures({ session: 'a-1', rows: [{ id: other.handle }] }, 'a-1', other).join()).toMatch(`holds session ${other.session}'s`);
    expect(leakFailures({ session: 'a-1', rows: [{ by: '04738c51' }] }, 'a-1', other).join()).toMatch(`holds session ${other.session}'s`);
    expect(leakFailures({ session: null }, 'a-1', other).join()).toMatch(/isn't bound/);
    const sessions: FixtureSession[] = [{ key: 'k', id: other.session, repo: 'shop', title: undefined, cwd: '/w' }];
    const ask = { ...ASK, session: other.session };
    expect(notificationFailures([{ ask: ask.handle, text: 'DeepBuild · shop · Claude Code\nquestion' }], [ask], sessions)).toEqual([]);
    expect(notificationFailures([{ ask: ask.handle, text: 'DeepBuild · Session 04738c51\nquestion' }], [ask], sessions)).toHaveLength(2);
    expect(notificationFailures([], [ask], sessions).join()).toMatch(/no notification/);
  });

  test('endFailures and downFailures: the count last, the hub not answering', () => {
    expect(endFailures('Cart totals  needs you\n  12 calls, 1 failed\n2 asks need you\n', 2, 40)).toEqual([]);
    expect(endFailures('2 asks need you\nFinished:\n  tool echo 1  ok\n', 2, 40).join()).toMatch(/not the count sentence/);
    expect(endFailures(`${'x\n'.repeat(45)}2 asks need you\n`, 2, 40).join()).toMatch(/not under 40/);
    expect(downFailures("The hub isn't answering since 12:31.\n2 asks need you", ['12:30', '12:31'])).toEqual([]);
    expect(downFailures('Reading ledger.db read-only: the hub doesn\'t answer (ECONNREFUSED)', ['12:31']).join()).toMatch(/doesn't say the hub isn't answering/);
    expect(downFailures("The hub isn't answering.\n0 asks need you", ['12:31'])).toHaveLength(2);
  });
});
