// #2668's judges, each held to a right input and to the wrong programs the redrafts must fail, with no hub, CLI or
// replica: a judge that passes what it should fail would let #1463 AC1 or #992 AC3 pass on a wrong program. The inputs
// are written in the shapes current main draws and prints: the list as crates/deep-app/src/{list,views}.rs build its
// nodes (heading:needs-you, ask rows with their kind in the word slot, heading:<project>, session rows named
// "<mark> <title> · <word>" valued with their entry, quiet:<project>), and deep status as packages/hub/src/list.ts
// writes it. No criterion tag: these pass on main, and the criteria are the redrafts' (README, Proof).
import { describe, expect, test } from 'vitest';
import { appSessionWord, disagreements, drawnRowFailures, statusTextWord, type Row, type SNode, type Snapshot } from './judges.ts';

const node = (id: string | null, role: string, name: string | null, value: unknown, children: SNode[] = []): SNode => ({ role, name, value, id, bounds: [0, 0, 1, 1], children });
const slots = (id: string, title: string, word: string, time = '3 min'): SNode[] => [
  node(`${id}:mark`, 'label', '●', null), node(`${id}:title`, 'label', title, null), node(`${id}:word`, 'label', word, null), node(`${id}:time`, 'label', time, null),
];
const snap = (items: SNode[]): Snapshot => ({ window: { size: [1512, 982], scale: 2 }, tree: node(null, 'window', 'DeepBuild', null, [node('list', 'list', 'Tasks', null, items)]), items: [] });

const ask = (n: number, title: string): Row => ({ id: `ask:01KB2668AK000000000000000${n}`, title, word: 'needs you', entry: 'needs_you', project: 'shop', session: 's1' });
const ses = (id: string, title: string, project: string, word: string, entry: string): Row => ({ id: `session:${id}`, title, word, entry, project, session: id, agent: 'claude-code' });
// The rows in their one order (States people see; rows.ts orderOf): sessions by section, project, state, then the asks.
const A1 = ask(1, 'Which header colour on the login page?');
const A2 = ask(2, 'Ship the cart page today?');
const NOTES = ses('n0000001', 'Release notes', 'docs', 'needs you', 'needs_you');
const CART = ses('c0000001', 'Cart totals', 'shop', 'needs you', 'needs_you');
const WORK = ses('w0000001', 'work on untitled', 'shop', 'working', 'running');
const REFRESH = ses('r0000001', 'Docs refresh', 'docs', 'says done', 'running');
const OLD = ses('q0000001', 'Old spike', 'docs', 'quiet', 'idle');
const ROWS = [NOTES, CART, WORK, REFRESH, OLD, A1, A2];

const askNode = (r: Row, kind: string, value = 'needs_you'): SNode => node(r.id, 'button', r.title, value, slots(r.id, r.title, kind, '16:40'));
const sesNode = (r: Row, word = r.word, value: unknown = r.entry): SNode => node(r.id, 'button', `● ${r.title} · ${word}`, value, slots(r.id, r.title, word));
const heading = (project: string): SNode => node(`heading:${project}`, 'label', project, null);
const needsYou = (n: number): SNode => node('heading:needs-you', 'label', 'Needs you', String(n), [node('sidebar-count', 'label', `${n} asks need you`, String(n))]);
const quietRow = (project: string, n: number): SNode => node(`quiet:${project}`, 'button', `○ ${n} quiet session${n === 1 ? '' : 's'} · quiet`, 'idle', slots(`quiet:${project}`, `${n} quiet session${n === 1 ? '' : 's'}`, 'quiet'));
/** The window as current main draws the list over ROWS (#1461): Needs you and its asks, then each project by name. */
const RIGHT = (): SNode[] => [needsYou(2), askNode(A1, 'How it looks'), askNode(A2, 'Pick one'), heading('docs'), sesNode(NOTES), sesNode(REFRESH), quietRow('docs', 1), heading('shop'), sesNode(CART), sesNode(WORK)];

describe('drawnRowFailures: the window draws see\'s rows as the one list lays them out', () => {
  test('the list as main draws it passes, whatever order the projects take', () => {
    expect(drawnRowFailures(snap(RIGHT()), ROWS)).toEqual([]);
    const r = RIGHT();
    expect(drawnRowFailures(snap([...r.slice(0, 3), ...r.slice(7), ...r.slice(3, 7)]), ROWS)).toEqual([]);
  });

  test('a window that draws the rows in their one order, the asks last, fails naming each ask', () => {
    const literal = [heading('docs'), sesNode(NOTES), sesNode(REFRESH), quietRow('docs', 1), heading('shop'), sesNode(CART), sesNode(WORK), needsYou(2), askNode(A1, 'How it looks'), askNode(A2, 'Pick one')];
    const f = drawnRowFailures(snap(literal), ROWS);
    expect(f.join('\n')).toMatch(/first heading is "heading:docs", not Needs you/);
    for (const a of [A1, A2]) expect(f.some((x) => x.startsWith(`row ${a.id} `) && /under a project's heading/.test(x)), JSON.stringify(f)).toBe(true);
  });

  test('a second order of the asks fails, naming the ask', () => {
    const r = RIGHT();
    const f = drawnRowFailures(snap([r[0]!, r[2]!, r[1]!, ...r.slice(3)]), ROWS);
    expect(f).toEqual([`row ${A2.id} ("${A2.title}") is drawn above ${A1.id}, the ask before it in see's rows: a second order of the asks`]);
  });

  test('an ask with no word in its slot, without its title or with another entry fails, naming the ask', () => {
    const r = RIGHT();
    const bare = node(A1.id, 'button', A1.title, 'needs_you', slots(A1.id, A1.title, ''));
    expect(drawnRowFailures(snap([r[0]!, bare, ...r.slice(2)]), ROWS)).toEqual([`row ${A1.id} ("${A1.title}") draws no word in its state-word slot (${A1.id}:word)`]);
    const untitled = node(A1.id, 'button', 'An ask', 'needs_you', slots(A1.id, 'An ask', 'How it looks'));
    expect(drawnRowFailures(snap([r[0]!, untitled, ...r.slice(2)]), ROWS).join()).toMatch(new RegExp(`^row ${A1.id} .* lacks its title`));
    expect(drawnRowFailures(snap([r[0]!, askNode(A1, 'How it looks', 'running'), ...r.slice(2)]), ROWS)).toEqual([`row ${A1.id} ("${A1.title}")'s node has the value "running", not its entry "needs_you"`]);
    // How an ask waits stands in for its entry (#1461: folded, later, held).
    expect(drawnRowFailures(snap([r[0]!, askNode(A1, 'held', 'held'), ...r.slice(2)]), ROWS)).toEqual([]);
  });

  test('no Needs you heading, or an ask drawn above it, fails naming the asks', () => {
    const r = RIGHT();
    expect(drawnRowFailures(snap(r.slice(1)), ROWS)).toContain('the list draws no heading Needs you (heading:needs-you) over its 2 ask rows');
    expect(drawnRowFailures(snap([r[1]!, r[0]!, ...r.slice(2)]), ROWS)).toContain(`row ${A1.id} ("${A1.title}") is drawn above the heading Needs you`);
  });

  test('a session under another project, out of its project\'s order, or missing fails, naming the row', () => {
    const r = RIGHT();
    const moved = [...r.slice(0, 4), sesNode(CART), ...r.slice(4, 8), sesNode(WORK)];
    expect(drawnRowFailures(snap(moved), ROWS)).toEqual([`row ${CART.id} ("Cart totals") is drawn outside its project "shop"'s heading`]);
    const swapped = [...r.slice(0, 8), sesNode(WORK), sesNode(CART)];
    expect(drawnRowFailures(snap(swapped), ROWS)).toEqual([`row ${WORK.id} ("work on untitled") is drawn above ${CART.id}, the session of its project before it in see's rows: a second order`]);
    expect(drawnRowFailures(snap(r.slice(0, 9)), ROWS)).toEqual([`row ${WORK.id} ("work on untitled") is in see's rows but no node of the list carries its id`]);
    expect(drawnRowFailures(snap(r.filter((n) => n.id !== 'heading:shop')), ROWS).filter((f) => /heading/.test(f)).length).toBeGreaterThan(0);
  });

  test('a planted app that reads waiting as working, or a session row without its title, fails naming the row', () => {
    const r = RIGHT();
    const planted = r.map((n) => (n.id === CART.id ? sesNode(CART, 'working', 'running') : n));
    expect(drawnRowFailures(snap(planted), ROWS)).toEqual([
      `row ${CART.id} ("Cart totals")'s node has the value "running", not its entry "needs_you"`,
      `row ${CART.id} ("Cart totals")'s state-word slot reads "working", not its word "needs you"`,
    ]);
    const nameless = r.map((n) => (n.id === WORK.id ? node(WORK.id, 'button', '● Session w0000001 · working', 'running', slots(WORK.id, 'Session w0000001', 'working')) : n));
    expect(drawnRowFailures(snap(nameless), ROWS)).toEqual([`row ${WORK.id} ("work on untitled")'s node reads "● Session w0000001 · working", which lacks its title`]);
  });

  test('a quiet session not folded into its project\'s quiet row, or counted wrong, fails naming the row', () => {
    const r = RIGHT();
    expect(drawnRowFailures(snap(r.filter((n) => n.id !== 'quiet:docs')), ROWS)).toEqual([`row ${OLD.id} ("Old spike") reads quiet, and no quiet row (quiet:…) under project "docs"'s heading folds it`]);
    expect(drawnRowFailures(snap(r.map((n) => (n.id === 'quiet:docs' ? quietRow('docs', 2) : n))), ROWS).join()).toMatch(new RegExp(`^row ${OLD.id} .* one of 1 quiet sessions .* reads`));
    expect(drawnRowFailures(snap(r.map((n) => (n.id === 'quiet:docs' ? sesNode(OLD) : n))), ROWS)).toEqual([`row ${OLD.id} ("Old spike") reads quiet, and no quiet row (quiet:…) under project "docs"'s heading folds it`]);
  });

  test('a window with no list fails', () => {
    expect(drawnRowFailures({ window: { size: [1, 1], scale: 2 }, tree: node(null, 'window', '', null, RIGHT()), items: [] }, ROWS)).toEqual([`the window has no list: no node's id is "list", so none of see's ${ROWS.length} rows is drawn`]);
  });
});

describe("statusTextWord and appSessionWord: each session's word in deep status and in the app's list", () => {
  // deep status as packages/hub/src/list.ts writes it: sections, a project's name, `  <name>  <agent>  <word> · <why>, <age>`.
  const TEXT = [
    'docs', '  Release notes  claude-code  needs you · a permission prompt waits on you, 2m',
    'Working:', 'shop', '  work on untitled  claude-code  working · at work, 10s',
    '  Docs refresh  claude-code  says done · it says done, and its checks have given no verdict yet, 1m',
    '  Cart totals  claude-code  flagged · interrupted: its process exited mid-turn · its process is gone mid-turn, 4s',
    '1 quiet, by repo: docs 1', '4 sessions', 'Nothing needs you', '',
  ].join('\n');

  test('each row\'s word as the text says it, the quiet one from the folded line', () => {
    expect(statusTextWord(TEXT, NOTES).word).toBe('needs you');
    expect(statusTextWord(TEXT, WORK).word).toBe('working');
    expect(statusTextWord(TEXT, REFRESH).word).toBe('says done');
    expect(statusTextWord(TEXT, { ...CART, word: 'flagged' }).word).toBe('flagged');
    expect(statusTextWord(TEXT, OLD).word).toBe('quiet');
  });

  test('a line with another word, the base\'s short-ID listing or no fold names no word', () => {
    expect(statusTextWord(TEXT, { ...WORK, word: 'finished' })).toEqual({ word: undefined, said: '  work on untitled  claude-code  working · at work, 10s' });
    const base = '  n0000001  needs you  claude-code  a permission prompt waits on you\n';
    expect(statusTextWord(base, NOTES).word).toBeUndefined();
    expect(statusTextWord(TEXT.replace('1 quiet, by repo: docs 1', ''), OLD).word).toBeUndefined();
    expect(statusTextWord(TEXT, { ...OLD, project: 'shop' }).word).toBeUndefined();
  });

  test('the app\'s word from the row\'s state-word slot, a quiet session\'s from its project\'s quiet row, the planted app\'s working', () => {
    const s = snap(RIGHT());
    expect(appSessionWord(s, NOTES)).toMatchObject({ word: 'needs you', value: 'needs_you' });
    expect(appSessionWord(s, REFRESH)).toMatchObject({ word: 'says done', value: 'running' });
    expect(appSessionWord(s, OLD)).toMatchObject({ word: 'quiet', value: 'idle' });
    const planted = snap(RIGHT().map((n) => (n.id === NOTES.id ? sesNode(NOTES, 'working', 'running') : n)));
    expect(appSessionWord(planted, NOTES)).toMatchObject({ word: 'working', value: 'running' });
    expect(appSessionWord(snap(RIGHT().filter((n) => n.id !== 'quiet:docs')), OLD).word).toBeUndefined();
  });

  test('disagreements name the recording and the session; agreement, nothing', () => {
    expect(disagreements([{ name: 'tools', session: 'abc', status: 'says done', statusSaid: '', app: 'says done', appNode: '' }])).toEqual([]);
    const f = disagreements([
      { name: 'permission-terminal-closed', session: 'c3f1', status: 'needs you', statusSaid: '', app: 'working', appNode: 'session:c3f1' },
      { name: 'tools', session: 'abc', status: undefined, statusSaid: 'no line for "x"', app: undefined, appNode: 'no list' },
    ]);
    expect(f).toEqual([
      'permission-terminal-closed: session c3f1 reads "needs you" in deep status and "working" (session:c3f1) in the app\'s list',
      'tools: session abc reads no word (no line for "x") in deep status and no word (no list) in the app\'s list',
    ]);
  });
});
