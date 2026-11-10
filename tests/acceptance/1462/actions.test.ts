// AC1, AC3, AC14 and AC15: the one action table as the menu bar, ⌘K and a row's context menu read it, in the replica
// (README, Pinned 1, 2, 4, 6, 11). Headless: the real `deep-drive` on this suite's fixture.
import { describe, expect, it } from 'vitest';
import {
  allItems, askAt, BOARD_PAGE, BOARD_VIEW, byId, commandK, COMMAND_LIST, contextItems, driveBinary, fixtureCopy, hits, ID, MIN,
  readTable, Replica, requireMacos, sessionAt, SESSIONS, ASKS, tableFailures, useCleanup, writes, type Feature, type SNode,
} from './helpers.ts';

useCleanup();

/** AC1: what's wrong with the table's actions in the menu bar and ⌘K of the replica `features` build. */
async function tableProblems(...features: Feature[]): Promise<string[]> {
  requireMacos();
  const table = readTable();
  const r = await Replica.on(await driveBinary(...features));
  try {
    const menus = await r.menus();
    const shown = new Map<string, SNode | undefined>();
    for (const a of table) {
      // What it acts on is selected, so ⌘K offers it: an ask's page for an ask's action, a session's for a session's.
      if (/^ask/.test(a.target)) await r.open(askAt(ASKS.taste.handle));
      else if (/^(session|row)/.test(a.target)) await r.open(sessionAt(SESSIONS.A.id));
      shown.set(a.name, (await commandK(r, a.name)).find((h) => h.name === a.name));
    }
    return tableFailures(table, menus, shown);
  } finally {
    await r.stop();
  }
}

describe(`AC1 ${ID.table} Every action in the table is in the menu bar and in ⌘K with the same name and key`, () => {
  it('AC1 every action of crates/deep-app/src/actions.json is a menu item and a ⌘K hit, each with its name and its key', async () => {
    expect(await tableProblems()).toEqual([]);
  }, 30 * MIN);

  it('AC1 wrong program: an action left out of the menu bar (plant-action-missing-from-menu) fails, naming it', async () => {
    const failures = await tableProblems('plant-action-missing-from-menu');
    expect(failures.join('\n'), 'the planted app leaves one action out of every menu').toMatch(/the action "[^"]+" \([^)]*\) is in no menu of the menu bar/);
  }, 30 * MIN);
});

describe(`AC3 ${ID.plugin} A plug-in's registered page appears in View and ⌘K with no app change`, () => {
  it('AC3 the plain replica, launched with the board plug-in\'s view registered, lists its page in View and in ⌘K', async () => {
    requireMacos();
    const r = await Replica.on(await driveBinary(), { panel: fixtureCopy('board'), view: BOARD_VIEW });
    try {
      const failures: string[] = [];
      const menus = await r.menus();
      const view = menus.find((m) => m.name === 'View');
      if (!view) failures.push(`the menu bar has no View menu: its menus are ${JSON.stringify(menus.map((m) => m.name))}`);
      else {
        const items = allItems([view]).map(({ item }) => item.name);
        if (!items.some((name) => name === BOARD_PAGE || name === BOARD_VIEW.pages[0]!.name)) failures.push(`the View menu doesn't list the plug-in's page "${BOARD_PAGE}": it lists ${JSON.stringify(items)}`);
      }
      const found = await commandK(r, BOARD_PAGE);
      if (!found.some((h) => h.name === BOARD_PAGE)) failures.push(`⌘K finds no hit named "${BOARD_PAGE}": its hits are ${JSON.stringify(found.map((h) => h.name))}`);
      expect(failures).toEqual([]);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);
});

/** AC14: what's wrong with session A's context menu beside the Session menu, in the replica `features` build. */
async function contextProblems(...features: Feature[]): Promise<string[]> {
  requireMacos();
  const r = await Replica.on(await driveBinary(...features));
  try {
    // Session A selected: its page opened, as a click on its row opens it (#1460).
    await r.open(sessionAt(SESSIONS.A.id));
    const session = (await r.menus()).find((m) => m.name === 'Session');
    if (!session) return [`the menu bar has no Session menu: its menus are ${JSON.stringify((await r.menus()).map((m) => m.name))}`];
    const menu = session.items.map((i) => i.name);
    await r.contextClick({ id: `session:${SESSIONS.A.id}` });
    const context = contextItems((await r.see()).snapshot);
    if (!context) return [`a secondary click on session A's row shows no context menu (no node with id context-menu, README Pinned 6)`];
    const out: string[] = [];
    for (const name of context) if (!menu.includes(name)) out.push(`the context menu's "${name}" is not in the Session menu: an action of its own`);
    for (const name of menu) if (!context.includes(name)) out.push(`the Session menu's "${name}" is not in the row's context menu`);
    if (!out.length && JSON.stringify(context) !== JSON.stringify(menu)) out.push(`the context menu holds ${JSON.stringify(context)} and the Session menu ${JSON.stringify(menu)}: the same items in another order`);
    for (const name of ['Copy title', 'Copy link']) if (!context.includes(name)) out.push(`the row's context menu has no "${name}"`);
    return out;
  } finally {
    await r.stop();
  }
}

describe(`AC14 ${ID.context} A row's context menu and the Session menu hold the same items in the same order`, () => {
  it('AC14 a secondary click on session A\'s row shows the Session menu\'s items, in its order, with Copy title and Copy link', async () => {
    expect(await contextProblems()).toEqual([]);
  }, 30 * MIN);

  it('AC14 wrong program: a context-only action (plant-context-only-action) fails, naming it', async () => {
    const failures = await contextProblems('plant-context-only-action');
    expect(failures.join('\n'), 'the planted context menu holds an action the Session menu doesn\'t').toMatch(/the context menu's "[^"]+" is not in the Session menu/);
  }, 30 * MIN);
});

/** #1998's preference words (#330's part): ⌘K answers each by its preference. */
const PREFERENCE_WORDS = ['settings', 'sound', 'mute', 'theme', 'font', 'notifications', 'keys'];

describe(`AC15 ${ID.preferences} ⌘, opens ⌘K showing the preference words, and writes nothing`, () => {
  it('AC15 ⌘, opens ⌘K showing the entry each preference word finds; the box and the hub get nothing', async () => {
    requireMacos();
    const r = await Replica.on(await driveBinary());
    try {
      // What each word finds in ⌘K by itself: the preferences ⌘, must show.
      const wanted = new Set<string>();
      for (const word of PREFERENCE_WORDS) {
        const first = (await commandK(r, word))[0];
        if (first?.name) wanted.add(first.name);
      }
      const before = (await r.see()).snapshot;
      const draft = byId(before, 'box-draft')?.value ?? null;
      await r.press('cmd-,');
      const after = await r.see();
      const failures: string[] = [];
      if (!byId(after.snapshot, COMMAND_LIST)) failures.push('⌘, didn\'t open ⌘K: the window has no command-list');
      else {
        const shown = hits(after.snapshot).map((h) => h.name);
        for (const name of wanted) if (!shown.includes(name)) failures.push(`⌘, opened ⌘K without "${name}", which the preference words find: it shows ${JSON.stringify(shown)}`);
      }
      if ((byId(after.snapshot, 'box-draft')?.value ?? null) !== draft) failures.push(`⌘, wrote into the box: its words were ${JSON.stringify(draft)} and are ${JSON.stringify(byId(after.snapshot, 'box-draft')?.value)}`);
      if (byId(after.snapshot, 'box-said')) failures.push(`⌘, sent the box's words: it says ${JSON.stringify(byId(after.snapshot, 'box-said')?.name)}`);
      if (!after.hub) failures.push('deep_drive\'s see reply has no `hub` list of what the app sent its hub (README, Pinned 3), so "writes nothing" can\'t be read');
      else for (const call of writes(after.hub)) failures.push(`the app sent its hub ${call.method} ${JSON.stringify(call.params ?? {}).slice(0, 200)}`);
      expect(failures).toEqual([]);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);
});
