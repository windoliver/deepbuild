// AC12, AC17 and AC21, and AC13's planted app: ⌘K from the keyboard, notices, the keymap, and the Quit item, in the
// replica (README, Pinned 2, 3, 4, 10, 11, 14, 15). Headless: the real `deep-drive` on this suite's fixture.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  actionNamed, allItems, ASKS, askAt, askRows, BOARD_COMMAND, BOARD_VIEW, byId, canon, CARD, commandK, driveBinary, FAILING_VIEW,
  fixtureCopy, glyphs, ID, MIN, notices, quitFailures, readTable, Replica, requireMacos, sessionAt, SESSIONS, useCleanup, words,
  type Feature,
} from './helpers.ts';

useCleanup();
const replica = async (o: Parameters<typeof Replica.on>[1], ...features: Feature[]): Promise<Replica> => { requireMacos(); return Replica.on(await driveBinary(...features), o); };

/** AC12: ⌘K, "need", Return, from session D's page: what the window shows then, when it isn't the first ask. */
async function needProblems(...features: Feature[]): Promise<string[]> {
  const r = await replica({}, ...features);
  try {
    const first = askRows((await r.see()).snapshot)[0] ?? ASKS.taste.handle;
    const question = Object.values(ASKS).find((a) => a.handle === first)?.question ?? '';
    await r.open(sessionAt(SESSIONS.D.id));
    await r.press('cmd-k');
    await r.type('need');
    await r.press('enter');
    await r.pass(200);
    const s = await r.see();
    const card = byId(s.snapshot, CARD);
    if (s.address === askAt(first) || (card && words(card).some((w) => w.includes(question)))) return [];
    return [`⌘K, "need", Return opened ${JSON.stringify(s.address)}${card ? ` with a card reading ${JSON.stringify(words(card).slice(0, 3))}` : ''}, not the first ask ${first} ("${question}")`];
  } finally {
    await r.stop();
  }
}

/** The hub's words when no installed view runs a command's action (packages/hub/src/core.ts, runCommand). */
const REFUSAL = `No installed view runs ${BOARD_VIEW.commands[0]!.action}.`;
/** AC12: the board's command run from ⌘K in a replica, whose copy of the hub refuses it: its reason in a notice within 1 s. */
async function refusalProblems(...features: Feature[]): Promise<string[]> {
  const r = await replica({ panel: fixtureCopy('board'), view: BOARD_VIEW }, ...features);
  try {
    await r.press('cmd-k');
    await r.type(BOARD_COMMAND);
    await r.press('enter');
    let shown: string[][] = [];
    for (let waited = 0; waited <= 1000; waited += 100) {
      shown = notices((await r.see()).snapshot).map(words);
      if (shown.some((w) => w.join(' ').includes(REFUSAL))) return [];
      await r.pass(100);
    }
    return [`"${BOARD_COMMAND}" ran from ⌘K and within 1 s the window shows no notice of the hub's reason "${REFUSAL}": its notices are ${JSON.stringify(shown)}`];
  } finally {
    await r.stop();
  }
}

describe(`AC12 ${ID.commandK} With no pointer, ⌘K, "need", Return opens the first ask; a refused command shows its reason`, () => {
  it('AC12 ⌘K, "need", Return opens the first ask Needs you lists', async () => {
    expect(await needProblems()).toEqual([]);
  }, 30 * MIN);

  it('AC12 wrong program: a ⌘K list that opens only on a click (plant-commands-click-only) fails', async () => {
    const failures = await needProblems('plant-commands-click-only');
    expect(failures.join('\n'), 'the planted list ignores Return').toMatch(/⌘K, "need", Return opened .* not the first ask/);
  }, 30 * MIN);

  it('AC12 a command the hub refuses shows the hub\'s reason in the window within 1 s', async () => {
    expect(await refusalProblems()).toEqual([]);
  }, 30 * MIN);

  it('AC12 wrong program: an opener that only logs (plant-opener-only-logs) fails, naming the command', async () => {
    const failures = await refusalProblems('plant-opener-only-logs');
    expect(failures.join('\n'), 'the planted opener logs the refusal and shows nothing').toMatch(/"Refresh board" ran from ⌘K and within 1 s the window shows no notice/);
  }, 30 * MIN);
});

/** AC17: the plug-in whose view fails its kit, launched in a replica: how many notices name the view. */
async function failedViewProblems(...features: Feature[]): Promise<string[]> {
  requireMacos();
  const { r, launched } = await Replica.start(await driveBinary(...features), { panel: fixtureCopy('fails-kit'), view: FAILING_VIEW });
  try {
    if (launched.ok !== true) return [`the replica refused to launch with the plug-in whose view fails its kit, as the app does, so the window shows nothing of the view "${FAILING_VIEW.name}": ${JSON.stringify(launched.error ?? launched).slice(0, 300)}`];
    await r.pass(500);
    const all = notices((await r.see()).snapshot);
    const naming = all.filter((n) => words(n).join(' ').includes(FAILING_VIEW.name));
    return naming.length === 1 ? [] : [`the window shows ${naming.length} notices naming the view "${FAILING_VIEW.name}", not one: its notices are ${JSON.stringify(all.map(words))}`];
  } finally {
    await r.stop();
  }
}

describe(`AC17 ${ID.failedView} A fixture plug-in whose view fails its kit draws one notice naming it`, () => {
  it('AC17 the replica launched with the refused view shows one notice naming it', async () => {
    expect(await failedViewProblems()).toEqual([]);
  }, 30 * MIN);

  it('AC17 wrong program: an app that shows nothing for a failed view (plant-failed-view-silent) fails, naming the view', async () => {
    const failures = await failedViewProblems('plant-failed-view-silent');
    expect(failures.join('\n'), 'the planted app keeps the failure to its log').toMatch(/notices naming the view "Refused board", not one|the window shows nothing of the view "Refused board"/);
  }, 30 * MIN);
});

/** AC21: Next ask rebound in the replica's keymap file: the key ⌘K shows beside it, then where the new key takes you. */
async function rebindProblems(...features: Feature[]): Promise<string[]> {
  const table = readTable();
  const next = actionNamed(table, 'Next ask');
  if (!next?.key) return [`the action table has no "Next ask" with a key: ${JSON.stringify(next ?? null)}`];
  const used = new Set(table.map((a) => canon(a.key)));
  const fresh = ['cmd-shift-j', 'cmd-shift-y', 'cmd-shift-u', 'cmd-shift-i', 'cmd-shift-o'].find((k) => !used.has(canon(k)))!;
  const r = await replica({}, ...features);
  try {
    const out: string[] = [];
    const before = (await commandK(r, 'Next ask')).find((h) => h.name === 'Next ask');
    if (!before) return ['⌘K finds no hit named "Next ask"'];
    if (before.value !== glyphs(next.key)) out.push(`before rebinding, ⌘K shows ${JSON.stringify(before.value)} beside Next ask, not ${glyphs(next.key)}`);
    // The keymap (README, Pinned 15): rebinding is a write to it, which the app reads again at once.
    writeFileSync(join(r.home, '.deepbuild', 'keymap.json'), `${JSON.stringify({ bindings: { 'Next ask': fresh } })}\n`);
    await r.pass(500);
    const after = (await commandK(r, 'Next ask')).find((h) => h.name === 'Next ask');
    if (after?.value !== glyphs(fresh)) out.push(`after rebinding Next ask to ${fresh}, ⌘K shows ${JSON.stringify(after?.value ?? null)} beside Next ask, not ${glyphs(fresh)}`);
    // From a session's page, the new key walks the asks in the order Needs you draws them.
    await r.open(sessionAt(SESSIONS.D.id));
    const order = askRows((await r.see()).snapshot);
    const walked: (string | null)[] = [];
    for (let i = 0; i < order.length; i++) {
      await r.press(fresh);
      walked.push((await r.see()).address);
    }
    const want = order.map(askAt);
    if (JSON.stringify(walked) !== JSON.stringify(want)) out.push(`${fresh}, pressed ${order.length} times from a session's page, opened ${JSON.stringify(walked)}, not the asks in Needs you's order ${JSON.stringify(want)}`);
    return out;
  } finally {
    await r.stop();
  }
}

describe(`AC21 ${ID.rebind} Rebinding the next-ask key shows the new key beside Next ask in ⌘K at once`, () => {
  it('AC21 the rebound key shows beside Next ask at once and walks the asks in Needs you\'s order', async () => {
    expect(await rebindProblems()).toEqual([]);
  }, 30 * MIN);

  it('AC21 wrong program: a ⌘K with a written hint (plant-written-key-hint) shows the old key and fails', async () => {
    const failures = await rebindProblems('plant-written-key-hint');
    expect(failures.join('\n'), 'the planted ⌘K writes the shipped key beside Next ask').toMatch(/after rebinding Next ask to \S+, ⌘K shows .* beside Next ask, not/);
  }, 30 * MIN);
});

describe(`AC13 ${ID.standard} After ⌘W and ⌘Q (the planted menu bar, in the replica)`, () => {
  it('AC13 wrong program: an app with no Quit item (plant-no-quit-item) fails, naming it', async () => {
    const r = await replica({}, 'plant-no-quit-item');
    try {
      expect(quitFailures(allItems(await r.menus())).join('\n'), 'the planted menu bar has no Quit').toMatch(/no Quit item/);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);
});
