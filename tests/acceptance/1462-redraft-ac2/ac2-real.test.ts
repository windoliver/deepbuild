// AC2 of #1462, redrafted blind (README): on the real `deep-app`, on a real hub in a temp home, a person with no pointer
// answers two asks on their cards, opens a session from the list, pauses it, opens its project's page and returns, by
// keys posted to the app's PID alone. What the app did is read from the record (the hub's events), the pause as the
// base's contracts let a hub write a session's subject (README, Pinned 1); where the window is and what holds the
// keyboard are read as an assistive client reads them (../1462/README.md, Pinned 7, 8, 19). Nothing here clicks.
// Supersedes the AC2 test in ../1462/real.test.ts.
import { describe, expect, it } from 'vitest';
import {
  allItems, answersOf, App, appBinary, askAt, confirmFile, keyArgs, MIN, realWorld, ROW_ID, sessionAt, settled, sleep, t26,
  useCleanup, type Real, type Spec,
} from '../1462/helpers.ts';

useCleanup();

/** `scripts/proof-change.mjs`'s criterionId of AC2's text as the issue reads now. */
const AC2 = '#1462.61a5fe15';

const taste: Spec['ask'] = { kind: 'taste', question: 'Which header colour for the cart page?', options: [{ id: 'blue', label: 'Blue header', decision: 'none' }, { id: 'green', label: 'Green header', decision: 'none' }], recommended: 'blue', default: 'blue' };
const choice: Spec['ask'] = { kind: 'choice', question: 'Which store keeps the release notes?', options: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }], recommended: 'sqlite', default: 'sqlite' };

/**
 * A session as a subject names it (README, Pinned 1): `session:` and its ID's letters and digits, as every base schema
 * with a session subject allows (`^session:[0-9A-Za-z]+$`) and the hub writes it (`packages/hub/src/core.ts`, `letters`).
 */
const handleOf = (id: string): string => `session:${id.replace(/[^0-9A-Za-z]/g, '')}`;
/** Whether `e` is about session `id`: its subject names the session's handle (a `#part` after it aside), or it has no subject and its envelope names the session. */
const about = (e: t26.Ev, id: string): boolean => (e.subject !== undefined ? e.subject.split('#')[0] === handleOf(id) : e.session === id);
const isPause = (id: string) => (e: t26.Ev): boolean => e.kind === 'session.paused' && about(e, id);

/** A keystroke probe.swift can post, in the table's form. */
const postable = (key: string): boolean => { try { keyArgs(key); return true; } catch { return false; } };
/**
 * Runs an action as a person with no pointer does (README, Pinned 2): the key the real app's menu bar shows beside the
 * item whose name starts with `name`, else ⌘K, the name, Return. How it was run, for the failure.
 */
async function act(app: App, name: string): Promise<string> {
  const item = allItems(await app.menus()).find(({ item }) => item.name.trim().toLowerCase().startsWith(name.toLowerCase()))?.item;
  if (item?.key && postable(item.key)) { await app.key(item.key); return `the key ${item.key} its menu item "${item.name}" shows`; }
  await app.key('cmd-k');
  await app.type(name);
  await app.key('enter');
  return `⌘K, "${name}", Return`;
}
const cardValue = async (app: App): Promise<string | null> => (await app.nodes()).find((n) => n.identifier === 'question-card')?.value ?? null;
async function untilAddress(app: App, want: (at: string | null) => boolean, ms = 10_000): Promise<string | null> {
  const deadline = Date.now() + ms;
  let at = await app.address();
  while (!want(at) && Date.now() < deadline) { await sleep(300); at = await app.address(); }
  return at;
}
/** F6 until the keyboard is on a row, then the arrows until it is on `id` (../1462/README.md, Pinned 7, 19). */
async function toRow(app: App, id: string): Promise<boolean> {
  for (let i = 0; i < 3 && !ROW_ID.test((await app.focusId()) ?? ''); i++) await app.key('f6');
  if (!ROW_ID.test((await app.focusId()) ?? '')) return false;
  for (const key of ['down', 'up']) {
    for (let i = 0; i < 16; i++) {
      if ((await app.focusId()) === id) return true;
      await app.key(key);
    }
  }
  return (await app.focusId()) === id;
}
/** F6 until the keyboard is on one of the card's options, at most three presses (README, Pinned 3). */
async function toCard(app: App): Promise<void> {
  for (let i = 0; i < 3 && !((await app.focusId()) ?? '').startsWith('card-option:'); i++) await app.key('f6');
}
/** The roles a field you type a reason into has, as an assistive client reads it. */
const FIELDS = new Set(['AXTextField', 'AXTextArea', 'AXComboBox', 'AXSearchField']);
const tail = (app: App): string => JSON.stringify(app.stderr().slice(-400));

/** AC2's path, step by step, stopping at the first step that doesn't do what it should. */
async function noPointerProblems(real: Real, app: App): Promise<string[]> {
  const { hub } = real.world;
  // Two asks, each answered on its card by Return; the next-ask action brings the window to one when it isn't on one.
  for (let n = 0; n < 2; n++) {
    const all = await t26.events(hub);
    const open = real.asks.filter((a) => !answersOf(all, a.handle).length);
    const onOpen = (at: string | null): boolean => open.some((a) => askAt(a.handle) === at);
    let at = await app.address();
    if (!onOpen(at)) {
      const how = await act(app, 'Next ask');
      at = await untilAddress(app, onOpen);
      if (!onOpen(at)) return [`ask ${n + 1} of 2: Next ask (${how}) brought the window to ${JSON.stringify(at)}, not an open ask's page (${open.map((a) => askAt(a.handle)).join(', ')})`];
    }
    const ask = open.find((a) => askAt(a.handle) === at)!;
    await toCard(app);
    if ((await settled(async () => ((await cardValue(app)) === 'armed' ? [] : ['not armed']), 10_000)).length) return [`ask ${n + 1} of 2: ${ask.handle}'s card never read armed to an assistive client: it reads ${JSON.stringify(await cardValue(app))}`];
    const focus = await app.focusId();
    await app.key('enter');
    const answered = await t26.eventMatching(hub, (e) => e.kind === 'ask.answered' && e.subject === ask.handle, 20_000);
    if (!answered) return [`ask ${n + 1} of 2: Return on ${ask.handle}'s card ("${ask.question}"), the keyboard on ${JSON.stringify(focus)}, recorded no ask.answered in 20 s: the app's log reads ${tail(app)}`];
    if (answered.data?.via !== 'card') return [`ask ${n + 1} of 2: ${ask.handle} was answered via ${JSON.stringify(answered.data?.via)}, not on the card`];
  }
  // A session opened from the list.
  const target = real.sessions.find((s) => s.title === 'Search index')!;
  if (!(await toRow(app, `session:${target.id}`))) return [`F6 and the arrows never put the keyboard on the row session:${target.id} ("${target.title}"): it is on ${JSON.stringify(await app.focusId())}`];
  await app.key('enter');
  const opened = await untilAddress(app, (at) => at === sessionAt(target.id));
  if (opened !== sessionAt(target.id)) return [`Return on the row of "${target.title}" opened ${JSON.stringify(opened)}, not ${sessionAt(target.id)}`];
  // Paused: the Session menu's Pause on the session whose page is open, with a reason typed if it asks for one.
  const before = Math.max(0, ...(await t26.events(hub)).map((e) => e.log_pos));
  const how = await act(app, 'Pause');
  let paused = await t26.eventMatching(hub, isPause(target.id), 5_000);
  let reason = '';
  if (!paused) {
    const field = await app.focused();
    if (field && FIELDS.has(field.role ?? '') && field.identifier !== 'box-draft') {
      await app.type('Paused from the keyboard');
      await app.key('enter');
      reason = ', a reason typed in the field it focused and Return';
    }
    paused = await t26.eventMatching(hub, isPause(target.id), 20_000);
  }
  if (!paused) {
    const since = (await t26.events(hub)).filter((e) => e.log_pos > before).map((e) => `${e.kind} ${e.subject ?? `(session ${String(e.session)})`}`);
    return [`Pause (${how}${reason}) on "${target.title}" recorded no session.paused about ${handleOf(target.id)} in 25 s; the record since reads ${JSON.stringify(since.slice(0, 12))}; the app's log reads ${tail(app)}`];
  }
  // The Map is the project's page (#57): opened from the project's heading in the list, then ⌘[ back.
  const heading = `project:${t26.PROJECT}`;
  if (!(await toRow(app, heading))) return [`F6 and the arrows never put the keyboard on the project's heading ${heading}: it is on ${JSON.stringify(await app.focusId())}`];
  const from = await app.address();
  if (!from) return ['before the project\'s page opened the window showed no page to return to'];
  await app.key('enter');
  const map = await untilAddress(app, (at) => at === `project/${t26.PROJECT}`);
  if (map !== `project/${t26.PROJECT}`) return [`Return on the project's heading opened ${JSON.stringify(map)}, not project/${t26.PROJECT}`];
  await app.key('cmd-[');
  const back = await untilAddress(app, (at) => at === from);
  if (back !== from) return [`⌘[ from project/${t26.PROJECT} went to ${JSON.stringify(back)}, not back to ${from}`];
  return [];
}

describe(`AC2 ${AC2} With no pointer, a person answers two asks, opens a session, pauses it, opens the Map and returns, by keys alone, on the real app`, () => {
  it(`AC2 ${AC2} on the real app, by keys posted to it alone: two answers on the card, a session opened and paused (session.paused on its handle), its project opened and left`, async () => {
    const real = await realWorld([{ title: 'Cart totals', ask: taste }, { title: 'Release notes', ask: choice }, { title: 'Search index' }]);
    const app = await App.launch(real.world.home, await appBinary('test-confirm'), { DEEP_APP_TEST_CONFIRM: confirmFile('confirmed') });
    try {
      expect(await noPointerProblems(real, app)).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 30 * MIN);
});
