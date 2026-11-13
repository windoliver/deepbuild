// AC5, AC6, AC7, AC16 and AC19: the list from the keyboard, in the replica (README, Pinned 3, 7, 13). Headless: the
// real `deep-drive` on this suite's fixture, which lists four sessions and three open asks.
import { describe, expect, it } from 'vitest';
import {
  ASKS, askAt, askRows, byId, controlKey, controls, driveBinary, FLICKS, focusRow, ID, MIN, OPEN_ASKS, readingFailures, Replica,
  requireMacos, rowIds, runAction, sessionAt, SESSIONS, tableOrNull, toList, useCleanup, words, writes, type Feature,
} from './helpers.ts';

useCleanup();
const replica = async (...features: Feature[]): Promise<Replica> => { requireMacos(); return Replica.on(await driveBinary(...features)); };
/** A row's title and project, from the fixture: a session's task and project, an ask's question and its session's project. */
function rowOf(id: string): { title: string; project: string } | undefined {
  const s = Object.values(SESSIONS).find((x) => id === `session:${x.id}`);
  if (s) return { title: s.title, project: s.project };
  const a = OPEN_ASKS.find((x) => x.handle === id);
  if (a) return { title: a.question, project: Object.values(SESSIONS).find((x) => x.id === a.session)!.project };
  if (id.startsWith('project:')) return { title: id.slice('project:'.length), project: id.slice('project:'.length) };
  return undefined;
}

/** AC5: every control hovering a row shows that the tree didn't hold at rest, named. */
async function hoverProblems(...features: Feature[]): Promise<string[]> {
  const r = await replica(...features);
  try {
    const rest = (await r.see()).snapshot;
    const atRest = new Set(controls(rest.tree).map(controlKey));
    const out = new Set<string>();
    for (const id of rowIds(rest)) {
      await r.hover({ id });
      for (const c of controls((await r.see()).snapshot.tree)) {
        if (!atRest.has(controlKey(c))) out.add(`hovering the row ${id} shows the control ${c.role} "${c.name ?? ''}"${typeof c.id === 'string' ? ` (${c.id})` : ''}, which isn't in the tree at rest`);
      }
    }
    return [...out];
  } finally {
    await r.stop();
  }
}

describe(`AC5 ${ID.hover} A hover-only control fails, naming it: every revealed control is in the tree at rest`, () => {
  it('AC5 hovering each row of the list shows no control the tree didn\'t hold at rest', async () => {
    expect(await hoverProblems()).toEqual([]);
  }, 30 * MIN);

  it('AC5 wrong program: a row control drawn only on hover (plant-hover-only-control) fails, naming it', async () => {
    const failures = await hoverProblems('plant-hover-only-control');
    expect(failures.join('\n'), 'the planted row shows a control only while hovered').toMatch(/shows the control .* which isn't in the tree at rest/);
  }, 30 * MIN);
});

describe(`AC6 ${ID.follows} With focus on a row whose ask is answered from the CLI, focus lands on the next row and VoiceOver reads it`, () => {
  it('AC6 the choice\'s row has the keyboard; answered from the CLI, the next row has it and reads as its words', async () => {
    const r = await replica();
    try {
      const failures: string[] = [];
      const ask = ASKS.choice;
      if (!(await toList(r, true))) throw Error('neither F6 nor a click on a row put the keyboard in the list');
      if (!(await focusRow(r, ask.handle))) throw Error(`the arrows never put the keyboard on ${ask.handle}'s row: focus is ${JSON.stringify(await r.focus())}`);
      const drawn = rowIds((await r.see()).snapshot);
      const next = drawn[drawn.indexOf(ask.handle) + 1];
      if (!next) throw Error(`no row is drawn after ${ask.handle}: ${JSON.stringify(drawn)}`);
      // `deep inbox answer` as the hub records it: the core writes the answer, by the inbox (#1172).
      await r.feed(ask.session, { v: 1, id: '01KB1462AN0000000000000001', kind: 'ask.answered', writer: 'core', actor: 'you', scope: 'you', subject: ask.handle, data: { answer: 'files', via: 'inbox' } });
      await r.pass(200);
      const after = (await r.see()).snapshot;
      if (rowIds(after).includes(ask.handle)) failures.push(`${ask.handle} is still listed after it was answered from the CLI`);
      if (after.focus !== next) failures.push(`with focus on ${ask.handle}, answering it from the CLI left focus on ${JSON.stringify(after.focus)}, not the next row ${next}`);
      else failures.push(...readingFailures(byId(after, next)?.name, rowOf(next)?.title ?? next, `VoiceOver on the focused row ${next}`));
      expect(failures).toEqual([]);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);
});

describe(`AC7 ${ID.box} With no pointer, a person opens a session, types into its box and sends, by keys alone`, () => {
  it('AC7 F6 to the list, the arrows to Cart totals, Return, ⌘N, the words and Return: the app hands the box\'s words to its hub', async () => {
    const r = await replica();
    const said = 'tidy the cart totals';
    try {
      const failures: string[] = [];
      const target = SESSIONS.A;
      if (!(await toList(r, false))) throw Error(`F6 never put the keyboard in the list: focus is ${JSON.stringify(await r.focus())}`);
      if (!(await focusRow(r, `session:${target.id}`))) throw Error(`the arrows never put the keyboard on session:${target.id}: focus is ${JSON.stringify(await r.focus())}`);
      await r.press('enter');
      const opened = await r.see();
      if (opened.address !== sessionAt(target.id)) failures.push(`Return on the row opened ${JSON.stringify(opened.address)}, not ${sessionAt(target.id)}`);
      await r.press('cmd-n');
      const focus = await r.focus();
      if (focus !== 'box-draft') failures.push(`⌘N left the keyboard on ${JSON.stringify(focus)}, not the box (box-draft)`);
      await r.type(said);
      const typed = byId((await r.see()).snapshot, 'box-draft')?.value;
      if (typed !== said) failures.push(`the words typed aren't in the box: it reads ${JSON.stringify(typed)}`);
      const before = (await r.see()).hub?.length ?? 0;
      await r.press('enter');
      await r.pass(500);
      const hub = (await r.see()).hub;
      if (!hub) failures.push('deep_drive\'s see reply has no `hub` list of what the app sent its hub (README, Pinned 3), so the send can\'t be read');
      else if (!writes(hub.slice(before)).some((c) => JSON.stringify(c.params ?? {}).includes(said))) failures.push(`Return in the box sent nothing holding "${said}": the app sent ${JSON.stringify(writes(hub.slice(before)).map((c) => c.method))}`);
      expect(failures).toEqual([]);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);
});

/** AC16: what's wrong after typing "shop" with the keyboard in the list, in the replica `features` build. */
async function typeAheadProblems(...features: Feature[]): Promise<string[]> {
  const r = await replica(...features);
  try {
    if (!(await toList(r, true))) return ['neither F6 nor a click on a row put the keyboard in the list'];
    const drawn = rowIds((await r.see()).snapshot);
    const starts = (id: string): boolean => { const row = rowOf(id); return !!row && (row.title.toLowerCase().startsWith('shop') || row.project.toLowerCase().startsWith('shop')); };
    const expected = drawn.find(starts);
    if (!expected) return [`no row drawn starts with "shop" by title or project: ${JSON.stringify(drawn)}`];
    await r.press('s h o p');
    const after = (await r.see()).snapshot;
    const out: string[] = [];
    if (after.focus !== expected) out.push(`typing "shop" put the keyboard on ${JSON.stringify(after.focus)}, not ${expected} ("${rowOf(expected)!.title}"), the first row whose title or project starts with it`);
    const now = rowIds(after);
    for (const id of drawn) if (!now.includes(id)) out.push(`the row ${id} ("${rowOf(id)?.title ?? id}") was drawn before typing "shop" and isn't now`);
    return out;
  } finally {
    await r.stop();
  }
}

describe(`AC16 ${ID.typeAhead} With focus in the list, typing "shop" selects the first row whose title or project starts with it`, () => {
  it('AC16 "shop" moves the keyboard to the first such row and every row stays drawn', async () => {
    expect(await typeAheadProblems()).toEqual([]);
  }, 30 * MIN);

  it('AC16 wrong program: a list that hides a row as you type (plant-list-hides-row) fails, naming it', async () => {
    const failures = await typeAheadProblems('plant-list-hides-row');
    expect(failures.join('\n'), 'the planted list hides a row').toMatch(/the row \S+ \("[^"]+"\) was drawn before typing "shop" and isn't now/);
  }, 30 * MIN);
});

/** AC19: Later on the oldest of the three asks, then the clock to where its default is 50 minutes away. */
async function laterProblems(...features: Feature[]): Promise<string[]> {
  const { table } = tableOrNull();
  const r = await replica(...features);
  try {
    const ask = ASKS.taste;
    const order = askRows((await r.see()).snapshot);
    if (JSON.stringify(order) !== JSON.stringify(OPEN_ASKS.map((a) => a.handle))) return [`the asks aren't listed oldest first before Later: ${JSON.stringify(order)}`];
    await r.open(askAt(ask.handle));
    const how = await runAction(r, table, 'Later');
    await r.pass(200);
    const s = await r.see();
    const out: string[] = [];
    const moved = askRows(s.snapshot);
    if (moved.length !== 3 || moved[2] !== ask.handle) out.push(`Later on ${ask.handle} (${how}) left the asks in the order ${JSON.stringify(moved)}: there's no way to set Later that puts it at the end`);
    const row = byId(s.snapshot, ask.handle);
    if (!row || !words(row).some((w) => /set for later/i.test(w))) out.push(`after Later its row reads ${JSON.stringify(row ? words(row) : 'nothing')}, not "set for later"`);
    if (s.hub && !writes(s.hub).some((c) => c.method === 'ask.later' || JSON.stringify(c.params ?? {}).includes(ask.handle))) out.push(`Later sent the hub nothing about ${ask.handle}`);
    if (out.length) return out;
    // Its default applies an hour and 20 s after launch: at 10 min 20 s it is 50 minutes away.
    await r.must('the replica\'s clock to 10 min 20 s', { call: 'wait_for', wait_for: { t: (10 * 60 + 20) * FLICKS }, timeout: 12 * 60_000 }, 40 * MIN);
    const back = askRows((await r.see()).snapshot);
    if (back[0] !== ask.handle) out.push(`with its default 50 minutes away, ${ask.handle} isn't back in its place: the asks are in the order ${JSON.stringify(back)}`);
    return out;
  } finally {
    await r.stop();
  }
}

describe(`AC19 ${ID.later} Later on the first of three asks moves it to the end and its row reads set for later`, () => {
  it('AC19 Later puts the oldest ask last, reading set for later, and it is back first once its default is 50 minutes away', async () => {
    expect(await laterProblems()).toEqual([]);
  }, 45 * MIN);

  it('AC19 wrong program: an app with no way to set Later (plant-no-later) fails', async () => {
    const failures = await laterProblems('plant-no-later');
    expect(failures.join('\n'), 'the planted app has no Later').toMatch(/Later on ask:\S+ .* no way to set Later/);
  }, 45 * MIN);
});
