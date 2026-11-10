// AC2, AC10, AC13 and AC22 on the real app: `deep-app` on a real hub in a temp home (#26's world, the record seeded
// before the hub starts), its keys posted to its PID alone and its window, menu bar and status item read from outside
// its process by probe.swift, as an assistive client reads them (README, Pinned 5, 8, 9, 12, 18, 19, 20). No pointer:
// nothing here clicks. Without Accessibility and Screen Recording, or with the screen locked, each test fails BLOCKED.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allItems, answersOf, App, appBinary, askAt, confirmFile, driveBinary, ID, MIN, quitFailures, realWorld, REPO, Replica,
  ROW_ID, sessionAt, settled, sleep, t26, tableOrNull, useCleanup, type Action, type Real, type Spec,
} from './helpers.ts';

useCleanup();
/** What to look at when no status item is found: macOS can keep an app's item out of the menu bar. */
const NO_ITEM = 'if the app does make one, macOS may be keeping it out of the menu bar: allow it in System Settings, Menu Bar';
const taste: Spec['ask'] = { kind: 'taste', question: 'Which header colour for the cart page?', options: [{ id: 'blue', label: 'Blue header', decision: 'none' }, { id: 'green', label: 'Green header', decision: 'none' }], recommended: 'blue', default: 'blue' };
const choice: Spec['ask'] = { kind: 'choice', question: 'Which store keeps the release notes?', options: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }], recommended: 'sqlite', default: 'sqlite' };
const push: Spec['ask'] = {
  kind: 'authority', question: 'Push main to origin?', options: [{ id: 'approve', label: 'Push it', decision: 'allow' }, { id: 'decline', label: 'No', decision: 'deny' }],
  recommended: null, default: 'decline', steps: [{ does: 'git push origin main', changes: ['origin/main'], undo: "can't be undone", public: true, cost: 0 }],
};

/** Runs the table's action `name` in the real app by keys: its key when the table gives one, else ⌘K, its name, Return. */
async function action(app: App, table: readonly Action[] | null, name: string): Promise<string> {
  const key = table?.find((a) => a.name === name)?.key;
  if (key) { await app.key(key); return `its key ${key}`; }
  await app.key('cmd-k');
  await app.type(name);
  await app.key('enter');
  return `⌘K, "${name}", Return`;
}
const cardValue = async (app: App): Promise<string | null> => (await app.nodes()).find((n) => n.identifier === 'question-card')?.value ?? null;
async function untilAddress(app: App, want: string, ms = 10_000): Promise<string | null> {
  const deadline = Date.now() + ms;
  let at = await app.address();
  while (at !== want && Date.now() < deadline) { await sleep(300); at = await app.address(); }
  return at;
}
/** F6 until the keyboard is on a row, then the arrows until it is on `id` (README, Pinned 7, 19). */
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

/** AC2's path, step by step, stopping at the first step that doesn't do what it should. */
async function noPointerProblems(real: Real, app: App, table: readonly Action[] | null): Promise<string[]> {
  const { hub } = real.world;
  // Two asks, each answered on its card by Return, the window brought to it by the next-ask key when it isn't on it.
  for (let n = 0; n < 2; n++) {
    const all = await t26.events(hub);
    const open = real.asks.filter((a) => !answersOf(all, a.handle).length);
    let at = await app.address();
    if (!open.some((a) => askAt(a.handle) === at)) {
      const how = await action(app, table, 'Next ask');
      const deadline = Date.now() + 10_000;
      while (!open.some((a) => askAt(a.handle) === at) && Date.now() < deadline) { await sleep(300); at = await app.address(); }
      if (!open.some((a) => askAt(a.handle) === at)) return [`Next ask (${how}) brought the window to ${JSON.stringify(at)}, not an open ask`];
    }
    const ask = open.find((a) => askAt(a.handle) === at)!;
    if ((await settled(async () => ((await cardValue(app)) === 'armed' ? [] : ['not armed']), 10_000)).length) return [`${ask.handle}'s card never read armed to an assistive client: it reads ${JSON.stringify(await cardValue(app))}`];
    await app.key('enter');
    const answered = await t26.eventMatching(hub, (e) => e.kind === 'ask.answered' && e.subject === ask.handle, 20_000);
    if (!answered) return [`Return on ${ask.handle}'s card ("${ask.question}") answered nothing in 20 s: the app's log reads ${JSON.stringify(app.stderr().slice(-400))}`];
    if (answered.data?.via !== 'card') return [`${ask.handle} was answered ${String(answered.data?.via)}, not on the card`];
  }
  // A session opened from the list.
  const target = real.sessions.find((s) => s.title === 'Search index')!;
  if (!(await toRow(app, `session:${target.id}`))) return [`F6 and the arrows never put the keyboard on session:${target.id}: it is on ${JSON.stringify(await app.focusId())}`];
  await app.key('enter');
  const opened = await untilAddress(app, sessionAt(target.id));
  if (opened !== sessionAt(target.id)) return [`Return on its row opened ${JSON.stringify(opened)}, not ${sessionAt(target.id)}`];
  // Paused, by the table's action (README, Pinned 18).
  const how = await action(app, table, 'Pause');
  const paused = await t26.eventMatching(hub, (e) => e.kind === 'session.paused' && e.subject === `session:${target.id}`, 20_000);
  if (!paused) return [`Pause (${how}) on session ${target.id} recorded no session.paused in 20 s`];
  // The Map is the project's page: opened from its heading in the list, then ⌘[ back.
  const project = `project:${t26.PROJECT}`;
  if (!(await toRow(app, project))) return [`F6 and the arrows never put the keyboard on the project's heading ${project}: it is on ${JSON.stringify(await app.focusId())}`];
  await app.key('enter');
  const map = await untilAddress(app, `project/${t26.PROJECT}`);
  if (map !== `project/${t26.PROJECT}`) return [`Return on the project's heading opened ${JSON.stringify(map)}, not project/${t26.PROJECT}`];
  await app.key('cmd-[');
  const back = await untilAddress(app, sessionAt(target.id));
  if (back !== sessionAt(target.id)) return [`⌘[ from the project's page went to ${JSON.stringify(back)}, not back to ${sessionAt(target.id)}`];
  return [];
}

describe(`AC2 ${ID.noPointer} With no pointer, a person answers two asks, opens a session, pauses it, opens the Map and returns, on the real app`, () => {
  it('AC2 on the real app, by keys posted to it alone: two answers on the card, a session opened and paused, its project opened and left', async () => {
    const real = await realWorld([{ title: 'Cart totals', ask: taste }, { title: 'Release notes', ask: choice }, { title: 'Search index' }]);
    const app = await App.launch(real.world.home, await appBinary('test-confirm'), { DEEP_APP_TEST_CONFIRM: confirmFile('confirmed') });
    try {
      expect(await noPointerProblems(real, app, tableOrNull().table)).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 30 * MIN);
});

describe(`AC10 ${ID.push} On the real app, with no pointer, a push whose step can't be undone is approved by keys alone`, () => {
  it('AC10 focus starts on No; Tab reaches the step\'s switch, Space turns it on, Tab reaches Push it, Return approves', async () => {
    const real = await realWorld([{ title: 'Checkout push', ask: push }]);
    const app = await App.launch(real.world.home, await appBinary('test-confirm'), { DEEP_APP_TEST_CONFIRM: confirmFile('confirmed') });
    const { table } = tableOrNull();
    try {
      const ask = real.asks[0]!;
      const failures: string[] = [];
      if ((await app.address()) !== askAt(ask.handle)) await action(app, table, 'Next ask');
      if ((await untilAddress(app, askAt(ask.handle))) !== askAt(ask.handle)) throw Error(`the window never showed the push's page ${askAt(ask.handle)}: it shows ${JSON.stringify(await app.address())}`);
      if ((await settled(async () => ((await cardValue(app)) === 'armed' ? [] : ['no']), 10_000)).length) throw Error(`the push's card never read armed: ${JSON.stringify(await cardValue(app))}`);
      const start = await app.focusId();
      if (start !== 'card-option:decline') failures.push(`on the approval focus starts on ${JSON.stringify(start)}, not No (card-option:decline)`);
      const reach = async (id: string): Promise<boolean> => {
        for (let i = 0; i < 12; i++) { if ((await app.focusId()) === id) return true; await app.key('tab'); }
        return (await app.focusId()) === id;
      };
      if (!(await reach('card-step:0'))) failures.push(`Tab never reached the step's switch (card-step:0): focus is on ${JSON.stringify(await app.focusId())}`);
      else {
        await app.key('space');
        const on = await settled(async () => ((await app.nodes()).find((n) => n.identifier === 'card-step:0')?.value === 'on' ? [] : ['off']), 10_000);
        if (on.length) failures.push(`Space on the step's switch, the OS confirming you, left it ${JSON.stringify((await app.nodes()).find((n) => n.identifier === 'card-step:0')?.value)}`);
      }
      if (!(await reach('card-option:approve'))) failures.push(`Tab never reached Push it (card-option:approve): focus is on ${JSON.stringify(await app.focusId())}`);
      if (!failures.length) {
        await app.key('enter');
        const answered = await t26.eventMatching(real.world.hub, (e) => e.kind === 'ask.answered' && e.subject === ask.handle, 20_000);
        if (!answered) failures.push(`Return on Push it approved nothing in 20 s: the app's log reads ${JSON.stringify(app.stderr().slice(-400))}`);
        else if (answered.data?.answer !== 'approve' || answered.data?.via !== 'card') failures.push(`the push was answered ${JSON.stringify(answered.data)}, not approve on the card`);
      }
      expect(failures).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 30 * MIN);
});

describe(`AC13 ${ID.standard} After ⌘W the menu bar still shows the count and a new ask still notifies; after ⌘Q the hub still answers deep`, () => {
  it('AC13 on the real app: Quit is on ⌘Q; ⌘W leaves the count and the notifier; ⌘Q leaves the hub', async () => {
    const real = await realWorld([{ title: 'Cart totals', ask: taste }]);
    const app = await App.launch(real.world.home, await appBinary(), { DEEP_APP_NOTIFICATION_SETTING: 'allowed' });
    try {
      const failures = quitFailures(allItems(await app.menus()));
      const count = (await app.status())[0]?.title ?? null;
      if (!count || !/\d/.test(count)) failures.push(`before ⌘W the status item shows no count: ${JSON.stringify(count)} (${NO_ITEM})`);
      await app.key('cmd-w');
      if ((await settled(async () => ((await app.windows()).length ? ['open'] : []), 10_000)).length) failures.push('⌘W left the window open');
      if (app.exited) failures.push('⌘W quit the app');
      const after = (await app.status())[0]?.title ?? null;
      if (after !== count) failures.push(`after ⌘W the status item shows ${JSON.stringify(after)}, not the count ${JSON.stringify(count)}`);
      // A new ask, raised as an agent raises one, with the window closed.
      const question = 'Which footer colour for the cart page?';
      void t26.pending(t26.callTool(real.world.agent, 'deep_ask', { kind: 'taste', question, options: [{ id: 'grey', label: 'Grey footer' }, { id: 'white', label: 'White footer' }], recommended: 'grey' }));
      const created = await t26.eventMatching(real.world.hub, (e) => e.kind === 'ask.created' && e.data?.question === question, 30_000);
      if (!created) failures.push(`deep_ask "${question}" filed nothing in 30 s`);
      else if ((await settled(async () => (new RegExp(`deep-app: notified \\S+ ask:${created.id}`).test(app.stderr()) ? [] : ['no']), 30_000)).length) failures.push(`with the window closed, the new ask ask:${created.id} wasn't notified in 30 s: the app's log reads ${JSON.stringify(app.stderr().slice(-400))}`);
      await app.key('cmd-q');
      if ((await settled(async () => (app.exited ? [] : ['running']), 15_000)).length) failures.push('⌘Q didn\'t quit the app in 15 s');
      const deep = await t26.deep(real.world.home, []);
      if (deep.code !== 0) failures.push(`after ⌘Q the hub doesn't answer deep: exit ${deep.code}, ${JSON.stringify(deep.stderr.slice(-300))}`);
      expect(failures).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 30 * MIN);
});

/** The glyph the shipped look gives a status-map entry (crates/deep-canvas-marks/looks/clean.json). */
const glyphOf = (entry: string): string => (JSON.parse(readFileSync(join(REPO, 'crates/deep-canvas-marks/looks/clean.json'), 'utf8')) as { status_treatment: { glyph: Record<string, string> } }).status_treatment.glyph[entry] ?? '?';

describe(`AC22 ${ID.statusMenu} In the real app, the status item's menu lists each session with its state's word and mark, and the replica reports that same menu`, () => {
  it('AC22 the status item\'s menu, read from the status item itself, holds a line per session with its word and mark, and the replica\'s equals it', async () => {
    const real = await realWorld([{ title: 'Cart totals', ask: taste }, { title: 'Release notes' }, { title: 'Search index', ask: choice }]);
    const app = await App.launch(real.world.home, await appBinary());
    try {
      const status = await t26.deep(real.world.home, ['status', '--json']);
      let parsed: { rows?: { id: string; title: string; word: string; entry: string }[] } = {};
      try { parsed = JSON.parse(status.stdout) as typeof parsed; } catch { throw Error(`deep status --json printed no JSON: exit ${status.code}, ${status.stdout.slice(0, 300)} ${status.stderr.slice(0, 300)}`); }
      const rows = (parsed.rows ?? []).filter((r) => r.id.startsWith('session:'));
      if (!rows.length) throw Error(`deep status --json lists no session: ${status.stdout.slice(0, 300)} ${status.stderr.slice(0, 300)}`);
      let lines: string[] = [];
      const failures = await settled(async () => {
        const item = (await app.status())[0];
        if (!item) return [`the app has no status item an assistive client finds: none in its AXExtrasMenuBar and none at a status-layer window it owns (${NO_ITEM})`];
        lines = item.items.map((i) => i.title);
        if (!lines.length) return ['the status item has no menu under its count (README, Pinned 12)'];
        return rows.flatMap((r) => {
          const line = lines.find((l) => l.includes(r.title));
          if (!line) return [`the status item's menu has no line for "${r.title}": it reads ${JSON.stringify(lines)}`];
          return [...(line.includes(r.word) ? [] : [`its line "${line}" lacks the state's word "${r.word}"`]), ...(line.includes(glyphOf(r.entry)) ? [] : [`its line "${line}" lacks the mark ${glyphOf(r.entry)} of ${r.entry}`])];
        });
      }, 20_000);
      if (!failures.length) {
        // The replica, on a copy of the same record read once from this home's hub, reports the same menu.
        const r = await Replica.on(await driveBinary(), { from: 'record_copy', home: real.world.home });
        try {
          const reported = (await r.see()).snapshot.menu_bar?.items;
          if (JSON.stringify(reported) !== JSON.stringify(lines)) failures.push(`the replica reports the status menu ${JSON.stringify(reported ?? null)} (snapshot menu_bar.items), the real app's reads ${JSON.stringify(lines)}`);
        } finally {
          await r.stop();
        }
      }
      expect(failures).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 30 * MIN);
});
