// AC1, AC2, AC3, AC4, AC6 and AC7 of #3495: a state reads as a plain sentence, then its word, on each plain surface
// that shows it, and as its word alone on a detail view.
//
// One world serves them all (helpers.ts, makeWorld): a record with one session in each of the six states that read a
// sentence, and one in each of the other states a record can hold, read by a real hub. `deep`, `deep status` and its
// `--json` are the built CLI on that hub. The list, the project's page and a session's page are the real `deep-drive`
// on a copy of that record: one launch, read as the window opens, with the project's page open, with each of the six
// sessions' pages open, once a running job's row arrived, and with the list at its narrowest width. Each planted wrong
// program runs the judge its shipped side passes and must fail it by name; one that changes nothing is BLOCKED.
//
// Nothing here waits on the wall clock: each read of the window follows half a second of the replica's own virtual
// clock, so what a call changed is drawn in full.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bareFailures, bareOf, blocked, cleanup, deep, detailFailures, drawn, got, ID, jobReading, jsonFailures, leadFailures, lineOf, listed, makeWorld, MIN,
  named, narrowFailures, NINE, none, once, onItsPage, PAGE, pageFailures, pageNode, PLANT, plantedNarrow, plantedOpened, printed, QUESTION, quietRow, reached,
  readWindow, rowView, sentencesIn, sha256, shown, shownRows, shownText, sixOf, statusRows, stringsOf, SUITE, tasteReading, tempDir,
  type Expected, type Listed, type Narrow, type Taste, type World,
} from './helpers.ts';

afterAll(cleanup, 120_000);
const T = 30 * MIN;
const world = once(makeWorld);
/** The world once each of its sessions reads its state in `deep status --json`: BLOCKED until then. */
const fixture = once(async () => { const w = await world(); return { w, ...(await reached(w)) }; });
const print = once(async () => deep(await world(), []));
const appWindow = once(async () => { const { w, rows } = await fixture(); return readWindow(w, sixOf(rows)); });
const unchanged = (plant: string, what: string): never => blocked(`DEEP_HUB_PLANT=${plant} changed nothing: ${what} (README, Pinned 6), so the planted program isn't there to fail`);
const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
const DEEP = 'what deep prints';
const LIST = "the list's row";

describe(`AC1 ${ID.print} deep prints each row's sentence, then its word`, () => {
  it(`AC1 ${ID.print}: on a record with one session in each of the six states, deep with no arguments prints each row's sentence, then its word, then the row's own sentence as before`, async () => {
    const { rows } = await fixture();
    const ran = await print();
    expect(ran.code, `deep exits 0: ${shown(ran)}`).toBe(0);
    none(leadFailures(DEEP, printed(ran.stdout, sixOf(rows), true)), 'each of the six rows in what deep prints');
    expect(ran.stdout, 'the line the issue gives').toContain("couldn't be checked: something a check needs is missing · BLOCKED");
  }, T);

  it(`AC1 ${ID.print} wrong program: a planted print that shows the word alone fails, naming the row and its state`, async () => {
    const { w, rows } = await fixture();
    const six = sixOf(rows);
    none(leadFailures(DEEP, printed((await print()).stdout, six, true)), 'the shipped print passes the judge its planted print must fail');
    const planted = await deep(w, [], PLANT.wordAlone);
    const failures = leadFailures(DEEP, printed(planted.stdout, six, true));
    if (!failures.length) unchanged(PLANT.wordAlone, `deep printed each of the six rows with its sentence: ${shown(planted)}`);
    expect(failures, 'one finding for each of the six rows, and no other').toHaveLength(six.length);
    for (const r of six) expect(failures.some((f) => f.includes(`${named(r)}, ${r.word}, as its word alone`)), `a finding names ${named(r)} and its state ${r.word}, read as its word alone:\n${failures.join('\n')}`).toBe(true);
  }, T);
});

describe(`AC2 ${ID.views} the list's row and the project's page read the same sentence and word as deep prints`, () => {
  it(`AC2 ${ID.views}: in a replica on the same record, the list's row reads the same sentence and word for each of the six as deep prints`, async () => {
    const { rows } = await fixture();
    const six = sixOf(rows);
    const { opened } = await appWindow();
    none(leadFailures(LIST, drawn(opened.snapshot, six)), "each of the six rows in the app's list");
    none(leadFailures(DEEP, printed((await print()).stdout, six)), 'deep prints that sentence and word for each of the six');
  }, T);

  it(`AC2 ${ID.views}: with the project's page open, each of the six reads the same sentence and word beside it as deep prints, and the page's own region shows none of the six words without its sentence`, async () => {
    const { rows } = await fixture();
    const six = sixOf(rows);
    const seen = got((await appWindow()).page);
    const page = pageNode(seen, PAGE);
    none([
      ...leadFailures("the project's page, in the row beside it,", drawn(seen.snapshot, six)),
      ...pageFailures("the project's page", stringsOf(seen, page)),
    ], `the project's page ${PAGE}`);
    none(leadFailures(DEEP, printed((await print()).stdout, six)), 'deep prints that sentence and word for each of the six');
  }, T);

  it(`AC2 ${ID.views} wrong program: a planted view that writes a sentence of its own fails, naming the view and the state`, async () => {
    const { w, rows } = await fixture();
    const six = sixOf(rows);
    none(leadFailures(LIST, drawn((await appWindow()).opened.snapshot, six)), 'the shipped list passes the judge its planted view must fail');
    const planted = await plantedOpened(w, PLANT.ownSentence);
    const failures = leadFailures(LIST, drawn(planted.snapshot, six));
    if (!failures.length) unchanged(PLANT.ownSentence, 'the env-plants build drew each of the six rows with the table\'s sentence');
    const row = six.find((r) => r.word === 'BLOCKED') ?? blocked('the fixture has no BLOCKED session');
    expect(failures, `only the planted view's row fails:\n${failures.join('\n')}`).toHaveLength(1);
    expect(failures[0], 'the finding names the view and the state, as a sentence of the view\'s own').toContain(`${LIST} reads ${named(row)}, BLOCKED, with a sentence of its own, `);
  }, T);
});

describe(`AC3 ${ID.nine} a row in each of the other nine states reads its word and no sentence before it`, () => {
  it(`AC3 ${ID.nine}: deep prints a row in each of the seven such states it gives a row of its own, with its word and no sentence before it`, async () => {
    const { rows } = await fixture();
    const seven = bareOf(rows);
    expect(seven.map((r) => r.word).sort(), 'the fixture holds a session in each').toEqual(NINE.filter((word) => word !== 'quiet' && word !== 'running').sort());
    none(bareFailures(DEEP, printed((await print()).stdout, seven)), 'each such row in what deep prints');
  }, T);

  it(`AC3 ${ID.nine}: in the list, a row in each of the nine states reads its word and no sentence before it`, async () => {
    const { rows } = await fixture();
    const win = await appWindow();
    const nine = [...drawn(win.opened.snapshot, bareOf(rows)), quietRow(win.opened, 'docs'), jobReading(got(win.job))];
    expect(nine.map((r) => r.word).sort(), 'a row in each of the nine').toEqual([...NINE].sort());
    none(bareFailures(LIST, nine), "each such row in the app's list");
  }, T);

  it(`AC3 ${ID.nine} wrong program: a planted sentence for working fails, naming the state`, async () => {
    const { w, rows } = await fixture();
    const seven = bareOf(rows);
    none(bareFailures(DEEP, printed((await print()).stdout, seven)), 'the shipped print passes the judge its planted sentence must fail');
    const planted = await deep(w, [], PLANT.workingSentence);
    const failures = bareFailures(DEEP, printed(planted.stdout, seven));
    if (!failures.length) unchanged(PLANT.workingSentence, `deep printed the working row with no sentence before its word: ${shown(planted)}`);
    const row = seven.find((r) => r.word === 'working') ?? blocked('the fixture has no working session');
    expect(failures, `only the working row fails:\n${failures.join('\n')}`).toHaveLength(1);
    expect(failures[0], 'the finding names the state').toContain(`${DEEP} reads ${named(row)}, working, with `);
  }, T);
});

describe(`AC4 ${ID.narrow} at the list's narrowest width a sent back row keeps its word and its time, and cuts its sentence from its end`, () => {
  const sentBack = (rows: readonly Listed[]): Listed => rows.find((r) => r.word === 'sent back') ?? blocked('the fixture has no sent back session');
  /** The sent back row as the list draws it at its narrowest; BLOCKED when the list isn't that narrow. */
  const judged = (n: Narrow, row: Listed): string[] => {
    if (Math.abs(n.width - n.listMin) > 2) blocked(`the list is ${n.width} points wide in a window as wide as its narrowest and the page's narrowest together, not its narrowest, ${n.listMin}`);
    return narrowFailures(rowView(n.seen.snapshot, row));
  };

  it(`AC4 ${ID.narrow}: at the list's narrowest width the sent back row shows its word and its time whole, its sentence is cut from its end, and its accessible name holds the whole sentence`, async () => {
    const { rows } = await fixture();
    none(judged(got((await appWindow()).narrow), sentBack(rows)), 'the sent back row at the list\'s narrowest width');
  }, T);

  it(`AC4 ${ID.narrow} wrong program: a planted row that cuts the word fails, naming the row`, async () => {
    const { w, rows } = await fixture();
    const row = sentBack(rows);
    none(judged(got((await appWindow()).narrow), row), 'the shipped row passes the judge its planted row must fail');
    const failures = judged(await plantedNarrow(w, PLANT.cutsWord), row);
    if (!failures.length) unchanged(PLANT.cutsWord, 'the env-plants build drew the sent back row\'s word whole in its slot');
    expect(failures.filter((f) => !f.startsWith(`${named(row)} `)), 'every finding starts with the row').toEqual([]);
    expect(failures.some((f) => f.startsWith(`${named(row)} doesn't show its word whole: `)), `a finding says the row doesn't show its word whole:\n${failures.join('\n')}`).toBe(true);
  }, T);
});

describe(`AC6 ${ID.detail} a session's page, deep status and its --json read each state as on the merge base`, () => {
  /** Every row the fixture holds, as the merge base reads it: its sessions, and its one open ask. */
  const expected = (w: World, rows: readonly Listed[]): Expected[] => [
    ...rows,
    ...w.asks.map((a) => ({ id: a.handle, title: a.question, word: 'needs you' })),
  ];

  it(`AC6 ${ID.detail}: on the same record deep status reads each state's word as on the merge base, and deep status --json holds the same word and entry for each row`, async () => {
    const w = await world();
    const status = await statusRows(w);
    const rows = listed(w, status.rows);
    expect(w.asks.map((a) => a.question), 'the fixture holds its one open ask').toEqual([QUESTION]);
    none(jsonFailures(status.rows, expected(w, rows)), 'deep status --json');
    const ran = await deep(w, ['status']);
    expect(ran.code, `deep status exits 0: ${shown(ran)}`).toBe(0);
    none([
      ...rows.filter((r) => r.word !== 'quiet').flatMap((r) => detailFailures('deep status', { id: r.id, title: r.title, word: r.word, agent: r.agent, text: lineOf(ran.stdout, r.title) }, '')),
      ...sentencesIn(ran.stdout).map((s) => `deep status holds the sentence "${s.sentence}": a detail view reads the state's word, ${s.word}, as on the merge base`),
    ], 'deep status');
  }, T);

  it(`AC6 ${ID.detail}: on the same record a session's page reads each of the six states' word as on the merge base`, async () => {
    const { rows } = await fixture();
    const pages = got((await appWindow()).pages);
    none(sixOf(rows).flatMap((r) => {
      const { reading, whole } = onItsPage(pages[r.key] ?? blocked(`the window never opened the page of ${r.id}`), r);
      return detailFailures("the session's page", reading, whole);
    }), "each of the six sessions' pages");
  }, T);

  it(`AC6 ${ID.detail} wrong program: a planted row whose word holds the sentence fails, naming the row`, async () => {
    const w = await world();
    const real = await statusRows(w);
    const rows = listed(w, real.rows);
    none(jsonFailures(real.rows, expected(w, rows)), 'the shipped deep status --json passes the judge its planted row must fail');
    const planted = await statusRows(w, { plant: PLANT.wordHoldsSentence });
    const failures = jsonFailures(planted.rows, expected(w, rows));
    if (!failures.length) unchanged(PLANT.wordHoldsSentence, 'deep status --json held each row\'s word and entry as shipped');
    const row = rows.find((r) => r.word === 'BLOCKED') ?? blocked('the fixture has no BLOCKED session');
    expect(failures.filter((f) => !f.startsWith(`${named(row)} `)), 'only the planted row fails, and every finding starts with it').toEqual([]);
    expect(failures.some((f) => f.includes('its word holds a sentence')), `a finding says the row's word holds a sentence:\n${failures.join('\n')}`).toBe(true);
  }, T);
});

describe(`AC7 ${ID.shown} shown to you`, () => {
  const FILE = 'shown.txt';
  it(`AC7 ${ID.shown}: the check run writes the six rows in the list, on the page and in what deep prints, before and after, and reads INCONCLUSIVE unless a recorded taste call on exactly these rows says they read right`, async () => {
    const { rows } = await fixture();
    const win = await appWindow();
    const text = shownText(shownRows(sixOf(rows), (await print()).stdout, win.opened, got(win.page)));
    const out = process.env.DS3495_SHOWN ?? tempDir();
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, FILE), text);
    const files = { [FILE]: sha256(text) };
    console.log(`AC7: the six rows as this run read them, written to ${join(out, FILE)} (SHA-256 ${files[FILE]}):\n${text}`);
    const call = tasteReading(JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste, files);
    if ('inconclusive' in call) inconclusive(`AC7: ${call.inconclusive}`);
    else expect(call.reads, `the recorded taste call says the rows read wrong${'note' in call ? `: ${call.note}` : ''}`).toBe('right');
  }, T);
});
