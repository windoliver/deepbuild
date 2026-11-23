// AC1, AC2, AC3 and the Scope's ⌘F: find on a session's page, walked in the app's own views as the replica draws them at
// the reference window, on a fixture record (README, The fixtures). AC1's page is 4,100 lines, "backoff" in three: two on
// the first screen and one 4,000 lines down; AC2's and AC3's is the same with the third 200 lines down, cheaper to draw.
// Each judge returns what's wrong, in words; its planted wrong programs (README, Plants) must be among them, named.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ASK_AT, blocked, byId, cleanup, drawn, driveBin, field, find, HEADING_WORD, ID, inLane, inside, lineAt, LONG, look, MIN, NO_FIELD, on, open, openPage, pageView,
  placed, placeOf, PLANT, REPO, rest, said, SHORT, step, TITLE, type, until, windowBox, WORD, writes, type Line, type Look,
} from './helpers.ts';

beforeAll(async () => { await driveBin(true); }, 480 * MIN);
afterAll(cleanup, 60_000);

// ---- AC1: the three matches, walked.

async function walk(plant?: string): Promise<string[]> {
  const [first, second, third] = LONG.match as [string, string, string];
  return on([LONG], { plant }, async (r) => {
    const before = await openPage(r, LONG);
    const opened = await find(r);
    const at = field(opened);
    if (!at) return [NO_FIELD(LONG)];
    const out: string[] = [];
    const title = byId(opened.s, 'page-title');
    const sameRow = !!title && at.bounds[1]! < title.bounds[1]! + title.bounds[3]! && title.bounds[1]! < at.bounds[1]! + at.bounds[3]!;
    if (!sameRow || !inside(at.bounds, pageView(opened.s) ?? windowBox(opened.s))) out.push(`the field isn't in the page's title row: it is at ${said(at.bounds)}, the title row at ${said(title?.bounds ?? null)}`);
    const typed = await type(r, WORD, '1 of 3', first);
    if (field(typed)?.value !== WORD) out.push(`the field's value is ${said(field(typed)?.value ?? null)} once "${WORD}" is typed`);
    const stops: [string, string, string, Look][] = [['Once typed', '1 of 3', first, typed]];
    for (const [key, name, place, line] of [['enter', 'After Return', '2 of 3', second], ['enter', 'After Return twice', '3 of 3', third], ['shift-enter', 'After ⇧Return', '2 of 3', second]] as const) stops.push([name, place, line, await step(r, key, place, line)]);
    const reads = placeOf(typed);
    const missed = LONG.match.filter((line) => !stops.some(([, , , x]) => inLane(x.s, line)));
    if (reads !== '1 of 3') out.push(`⌘F "${WORD}" on ${LONG.address} reads ${said(reads)}, not "1 of 3"${missed.length ? `: it missed ${missed.map((line) => `"${line}"`).join(', ')}` : ''}`);
    for (const [when, place, line, x] of stops) {
      if (placeOf(x) !== place) out.push(`${when}, the field reads ${said(placeOf(x))}, not "${place}"`);
      else if (!inLane(x.s, line)) out.push(`${when}, the field reads "${place}" and its line "${line}" isn't inside the lane: it is at ${said(lineAt(x.s, line) ?? null)}`);
    }
    // It reads what's on the page: nothing is sent, and the record an agent reads stays where it was.
    const after = await look(r);
    const sent = after.hub.slice(before.hub.length).map((c) => String(c.method));
    if (sent.length) out.push(`find called the hub: ${[...new Set(sent)].join(', ')}`);
    if (after.logPos !== before.logPos) out.push(`find moved the record from ${String(before.logPos)} to ${String(after.logPos)}`);
    if (after.address !== LONG.address) out.push(`find left the page: the window shows ${String(after.address)}`);
    return out;
  });
}

describe(`AC1 ${ID.walk} find walks every match on the page`, () => {
  it(`AC1 ${ID.walk}: with "${WORD}" in three messages, one 4,000 lines down, ⌘F "${WORD}" reads "1 of 3", and Return twice lands on the third with its line inside the lane; the field sits in the title row, ⇧Return walks back, and nothing is sent`, async () => {
    expect(await walk()).toEqual([]);
  }, 60 * MIN);

  it(`AC1 ${ID.walk} wrong program: a find that searches only drawn rows reads "1 of 2", naming the missed line`, async () => {
    expect((await walk(PLANT.drawnOnly)).join('\n'), `the planted find (README, Plants: ${PLANT.drawnOnly})`).toContain(`reads "1 of 2", not "1 of 3": it missed "${LONG.match[2]!}"`);
  }, 60 * MIN);

  it(`AC1 ${ID.walk} Scope: ⌘F is one action of the table, in the Edit menu under its name with its key, and picking it opens the field`, async () => {
    const table = (JSON.parse(readFileSync(join(REPO, 'crates/deep-app/src/actions.json'), 'utf8')) as { actions: { name: string; key: string | null }[] }).actions;
    const rows = table.filter((a) => a.key === 'cmd-f');
    expect(rows, 'the action table (crates/deep-app/src/actions.json) holds one action on cmd-f').toHaveLength(1);
    await on([SHORT], {}, async (r) => {
      const menus = (await r.must('menus', { call: 'menus' })).menus as { name: string; items: Line[] }[];
      const edit = menus.find((m) => m.name === 'Edit')?.items ?? [];
      expect(edit.filter((i) => i.key === 'cmd-f').map((i) => i.name), 'the Edit menu holds that action under its name, with ⌘F').toEqual([rows[0]!.name]);
      await openPage(r, SHORT);
      await r.must('the Edit menu\'s item', { call: 'act', act: { kind: 'menu', path: ['Edit', rows[0]!.name] } });
      const x = await until(r, (l) => field(l) !== undefined, 1000);
      expect(field(x), 'picking it opens the field').toBeDefined();
    });
  }, 60 * MIN);
});

// ---- AC2: chrome isn't searched.

async function chrome(plant?: string): Promise<{ state: string; failures: string[] }> {
  return on([SHORT], { plant }, async (r) => {
    const start = await openPage(r, SHORT);
    const slot = `session:${SHORT.id}:word`;
    const state = String(byId(start.s, slot)?.name ?? '');
    const inContent = (word: string): string | undefined => SHORT.lines.find((l) => l.toLowerCase().includes(word.toLowerCase()));
    const titled = (start.s.runs ?? []).some((x) => x.text === TITLE);
    if (!state || inContent(state) || inContent(HEADING_WORD) || !titled) blocked(`the fixture's premise doesn't hold: the row's state word (${slot}) is ${said(state)}, the title "${TITLE}" ${titled ? 'is' : 'isn\'t'} drawn, and a content line holds one of them: ${said(inContent(state || '\0') ?? inContent(HEADING_WORD) ?? null)}`);
    if (!field(await find(r))) return { state, failures: [NO_FIELD(SHORT)] };
    // The same field finds the content, so an empty answer below is an answer.
    const content = placeOf(await type(r, WORD, '1 of 3'));
    if (content !== '1 of 3') return { state, failures: [`⌘F "${WORD}" on ${SHORT.address} reads ${said(content)}, not "1 of 3"`] };
    const failures: string[] = [];
    for (const [word, where] of [[state, `the row's state word (${slot})`], [HEADING_WORD, `the heading "${TITLE}"`]] as const) {
      const x = await type(r, word, 'never');
      if (field(x)?.value !== word) failures.push(`the field's value is ${said(field(x)?.value ?? null)} once "${word}" is typed`);
      else if (placeOf(x) !== null) failures.push(`find matches "${word}", which only ${where} draws: it reads "${String(placeOf(x))}"`);
    }
    return { state, failures };
  });
}

describe(`AC2 ${ID.chrome} find searches content, never chrome`, () => {
  it(`AC2 ${ID.chrome}: a word that appears only in a row's state word or a heading isn't a match`, async () => {
    expect((await chrome()).failures).toEqual([]);
  }, 60 * MIN);

  it(`AC2 ${ID.chrome} wrong program: a find that matches chrome fails, naming the string`, async () => {
    const { state, failures } = await chrome(PLANT.matchesChrome);
    for (const word of [state, HEADING_WORD]) expect(failures.join('\n'), `the planted find (README, Plants: ${PLANT.matchesChrome})`).toContain(`find matches "${word}", which only`);
  }, 60 * MIN);
});

// ---- AC3: Escape, and an ask's page.

async function closes(plant?: string): Promise<string[]> {
  const [, second, third] = SHORT.match as [string, string, string];
  return on([SHORT], { plant }, async (r) => {
    await openPage(r, SHORT);
    if (!field(await find(r))) return [NO_FIELD(SHORT)];
    const out: string[] = [];
    await type(r, WORD, '1 of 3');
    await step(r, 'enter', '2 of 3', second);
    const landed = await step(r, 'enter', '3 of 3', third);
    if (placeOf(landed) !== '3 of 3' || !inLane(landed.s, third)) return [`Return twice doesn't land on "${third}" in the lane: the field reads ${said(placeOf(landed))}`];
    // The page is at rest before Escape, and looked at again half a second after it.
    await rest(r, 500);
    const was = placed((await look(r)).s, third);
    await r.press('escape');
    await rest(r, 500);
    const x = await look(r);
    if (field(x)) out.push('Escape leaves the field open');
    if (x.address !== SHORT.address) out.push(`Escape left the page: the window shows ${String(x.address)}`);
    const is = placed(x.s, third);
    // Its scroll place: the line where it was, from the window's top or, where closing the field changes the title row's height, from its foot.
    const moved = was && is ? Math.min(Math.abs(is.window - was.window), Math.abs(is.row - was.row)) : Infinity;
    if (!inLane(x.s, third) || moved > 2) out.push(`after Escape the page lost its scroll place: "${third}" was ${said(was?.row ?? null)} px under the title row and is ${is ? `${is.row} px under it` : 'no longer drawn'}`);

    // A presented card: ⌘F there writes nothing and moves nothing, though it opened the field on the session's page.
    const card = await open(r, ASK_AT, (l) => byId(l.s, 'question-card')?.value === 'armed');
    if (card.address !== ASK_AT || byId(card.s, 'question-card')?.value !== 'armed') blocked(`the fixture's premise doesn't hold: ${ASK_AT} shows ${String(card.address)} with its card ${said(byId(card.s, 'question-card')?.value ?? null)}`);
    const still = await look(r);
    await rest(r, 500);
    const before = await look(r);
    if (said(drawn(still), 1e9) !== said(drawn(before), 1e9)) blocked('the ask\'s page moves with no input, so what ⌘F moves can\'t be told');
    await r.press('cmd-f');
    await rest(r, 500);
    const after = await look(r);
    if (field(after)) out.push(`⌘F on ${ASK_AT} with a card presented opens the field`);
    const [had, has] = [new Set(drawn(before)), new Set(drawn(after))];
    const changed = [...[...had].filter((d) => !has.has(d)).map((d) => `- ${d}`), ...[...has].filter((d) => !had.has(d)).map((d) => `+ ${d}`)];
    if (changed.length) out.push(`⌘F on ${ASK_AT} with a card presented moves the window:\n${changed.slice(0, 10).join('\n')}`);
    const wrote = writes(after.hub.slice(before.hub.length));
    if (wrote.length || after.logPos !== before.logPos) out.push(`⌘F on ${ASK_AT} with a card presented writes: ${wrote.join(', ')}, the record from ${String(before.logPos)} to ${String(after.logPos)}`);
    return out;
  });
}

describe(`AC3 ${ID.closes} Escape closes it, and an ask's page has none`, () => {
  it(`AC3 ${ID.closes}: Escape closes the field and the page keeps its scroll place; with a card presented, ⌘F writes nothing and moves nothing`, async () => {
    expect(await closes()).toEqual([]);
  }, 60 * MIN);

  it(`AC3 ${ID.closes} wrong program: a find whose Escape takes the page back to its top fails, naming the line`, async () => {
    expect((await closes(PLANT.escapeRewinds)).join('\n'), `the planted find (README, Plants: ${PLANT.escapeRewinds})`).toContain(`after Escape the page lost its scroll place: "${SHORT.match[2]!}"`);
  }, 60 * MIN);

  it(`AC3 ${ID.closes} wrong program: a find that opens over a presented card fails, naming the ask`, async () => {
    expect((await closes(PLANT.onAsk)).join('\n'), `the planted find (README, Plants: ${PLANT.onAsk})`).toContain(`⌘F on ${ASK_AT} with a card presented opens the field`);
  }, 60 * MIN);
});
