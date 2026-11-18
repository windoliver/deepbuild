// AC2, AC4, AC6 and AC7: a long page scrolls, a narrow window keeps the count, and a title that doesn't fit is cut in its
// slot. One world, a real hub's record: two open asks in shop, a session there whose newest run failed, and four sessions
// in docs titled 200 characters long, in Han, in Arabic, and one that reads INCONCLUSIVE once its row says so. Each test
// reads the replica on a copy of that record, on its virtual clock. What the hub writes for a change is fed as it writes
// it: the failed run as `run.finished`, the INCONCLUSIVE reading as the row's `row.set` (helpers.ts `feedRow`).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulid } from '../26/helpers.ts';
import {
  askAt, askOf, byId, cleanup, cross, feedRow, ID, inside, listView, makeWorld, MIN, NARROW, OPENING, overlap, pageView,
  PLANT, replicaOf, runsIn, sessionOf, showing, slot, TITLE, windowBox, type Run, type SessionSpec, type Snapshot, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const FIRST = 'Which header colour on the login page?';
const SECOND = 'Keep the cart on SQLite or plain files?';
const SPECS: SessionSpec[] = [
  { key: 'a1', project: 'shop', title: 'Cart totals', state: 'finished', asks: [{ kind: 'taste', question: FIRST }] },
  { key: 'a2', project: 'shop', title: 'Checkout page', state: 'finished', asks: [{ kind: 'choice', question: SECOND }] },
  { key: 'failing', project: 'shop', title: 'Totals check', state: 'failed' },
  { key: 'long', project: 'docs', title: TITLE.long, state: 'finished' },
  { key: 'han', project: 'docs', title: TITLE.han, state: 'finished' },
  { key: 'arabic', project: 'docs', title: TITLE.arabic, state: 'finished' },
  { key: 'twelve', project: 'docs', title: TITLE.twelve, state: 'finished' },
];
let world: World;
beforeAll(async () => { world = await makeWorld(SPECS); }, 15 * MIN);

const ELLIPSIS = '…';
const chars = (text: string): string[] => [...text];

// ---- AC2: a session page whose failure runs 400 lines.

const LINES = Array.from({ length: 400 }, (_, i) => `line ${String(i + 1).padStart(3, '0')} of 400`);
const LAST_LINE = LINES.at(-1)!;
/** The failed run as the core records it (run.finished@3), its actual output the 400 lines. */
const failedRun = (): Record<string, unknown> => ({
  v: 3, id: ulid(), kind: 'run.finished', writer: 'core', actor: 'you', scope: 'you',
  data: {
    run: `run:${ulid()}`, outcome: 'failed', tests_run: 1, passed: 0, runs: 1, evidence: [], check: 'unit', assertion: null,
    expected: null, actual: LINES.join('\n'), step: null, points_to: null, findings: [], environment: 'darwin-arm64', exit: 1,
  },
});

async function pageFailures(plant?: string): Promise<string[]> {
  const failing = sessionOf(world, 'failing');
  const address = `session/${failing.id}`;
  const r = await replicaOf(world, OPENING, plant);
  try {
    await r.feed(failing.id, failedRun());
    await r.open(address);
    await r.wait(500);
    let before = '';
    let lastShown = 'none of its lines';
    for (let turn = 0; turn < 200; turn++) {
      const seen = await r.see();
      if (seen.address !== address) return [`opening ${address} shows ${String(seen.address)}`];
      const s = seen.snapshot;
      const view = pageView(s) ?? windowBox(s);
      const shown = (s.runs ?? []).filter((x) => LINES.includes(x.text) && inside(x.bounds, view));
      if (shown.some((x) => x.text === LAST_LINE)) return [];
      if (shown.length) lastShown = `"${shown.reduce((a, b) => (b.bounds[1]! > a.bounds[1]! ? b : a)).text}"`;
      const key = shown.map((x) => `${x.text}@${x.bounds[1]}`).join(' ');
      if (key === before) break;
      before = key;
      // The wheel over the failure line shown nearest the page's middle, else over the page's lane.
      const middle = view[1]! + view[3]! / 2;
      const at = [...shown].sort((a, b) => Math.abs(a.bounds[1]! - middle) - Math.abs(b.bounds[1]! - middle))[0];
      await r.scroll(at ? { text: at.text } : { id: 'lane' }, Math.max(40, Math.round(view[3]! / s.window.scale / 2)));
    }
    return [`the session page ${address} doesn't show its last line "${LAST_LINE}" after scrolling: the wheel over it moves nothing further, with ${lastShown} the last line shown`];
  } finally {
    await r.stop();
  }
}

describe(`AC2 ${ID.page} every page scrolls`, () => {
  it(`AC2 ${ID.page}: a session page whose failure runs 400 lines shows its last line after scrolling`, async () => {
    expect(await pageFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC2 ${ID.page} wrong program: a planted page that clips fails, naming the page`, async () => {
    const failing = sessionOf(world, 'failing');
    expect((await pageFailures(PLANT.pageClips)).join('\n'), 'the planted page (README, Surface choices: page-clips) cuts what is past its lane').toContain(`the session page session/${failing.id} doesn't show its last line`);
  }, 30 * MIN);
});

// ---- AC4: at 700 wide with two open asks.

/** The count of what needs you on the page (README, Surface choices: `page-count`), and one key to the ask rows. */
async function narrowFailures(plant?: string): Promise<string[]> {
  const asks = [askOf(world, 'a1'), askOf(world, 'a2')];
  const window = `the window at ${NARROW.width}×${NARROW.height}`;
  const r = await replicaOf(world, NARROW, plant);
  const out: string[] = [];
  try {
    const seen = await r.see();
    const s = seen.snapshot;
    if (seen.address !== askAt(asks[0]!.handle)) return [`${window} opens on ${String(seen.address)}, not the first open ask ${askAt(asks[0]!.handle)}`];
    const count = byId(s, 'page-count');
    const title = byId(s, 'page-title');
    if (!count) out.push(`${window} shows no count on the page: it has no node page-count (README, Surface choices)`);
    else {
      if (String(count.value) !== '2') out.push(`${window}: the page's count (page-count) is valued ${JSON.stringify(count.value)}, not the one count, 2`);
      if (!inside(count.bounds, windowBox(s))) out.push(`${window}: the page's count is off screen, at ${JSON.stringify(count.bounds)}`);
      if (!runsIn(s, count.bounds).some((x) => /(^|\D)2(\D|$)/.test(x.text))) out.push(`${window}: the page's count draws no "2": it draws ${JSON.stringify(runsIn(s, count.bounds).map((x) => x.text))}`);
      if (!title) out.push(`${window}: the page has no title row (page-title) for the count to sit in`);
      else if (!overlap([0, count.bounds[1]!, 1e9, count.bounds[3]!], [0, title.bounds[1]!, 1e9, title.bounds[3]!])) out.push(`${window}: the count isn't in the page's title row: it is at ${JSON.stringify(count.bounds)}, the title at ${JSON.stringify(title.bounds)}`);
    }
    // One key, Escape (#1462), and the list's ask rows show with the keyboard on one of them.
    await r.press('escape');
    await r.wait(300);
    const after = (await r.see()).snapshot;
    const view = listView(after) ?? [0, 0, 0, 0];
    for (const a of asks) if (!showing(after, byId(after, a.handle), cross(view, windowBox(after)))) out.push(`${window}: after Escape the ask row ${a.handle} ("${a.question}") isn't shown`);
    if (!asks.some((a) => a.handle === after.focus)) out.push(`${window}: after Escape the keyboard is on ${JSON.stringify(after.focus)}, not an ask row`);
  } finally {
    await r.stop();
  }
  return out;
}

describe(`AC4 ${ID.narrow} a narrow window keeps the count`, () => {
  it(`AC4 ${ID.narrow}: at 700 wide with two open asks, the count shows on the page and one key reaches the ask rows`, async () => {
    expect(await narrowFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC4 ${ID.narrow} wrong program: a planted narrow window with no count fails, naming the window`, async () => {
    expect((await narrowFailures(PLANT.noCount)).join('\n'), 'the planted window (README, Surface choices: narrow-no-count) draws no count').toMatch(/the window at 700×640 shows no count on the page/);
  }, 30 * MIN);
});

// ---- AC6 and AC7: a title that doesn't fit its slot.

/** The strings drawn over a row's title slot, left to right. */
function titleRuns(s: Snapshot, row: string): Run[] {
  const title = slot(s, row, 'title');
  return title ? (s.runs ?? []).filter((x) => overlap(x.bounds, title.bounds)).sort((a, b) => a.bounds[0]! - b.bounds[0]!) : [];
}
/** What's wrong with `row`'s title as drawn: one line, inside its slot, never under the slots to its right, cut at a whole character. */
function titleFailures(s: Snapshot, row: string, whole: string): string[] {
  const named = `row ${row} ("${chars(whole).slice(0, 24).join('')}…")`;
  const node = byId(s, row);
  const title = slot(s, row, 'title');
  if (!node || !title) return [`${named} isn't drawn with its title slot (${row}:title)`];
  const out: string[] = [];
  if (!String(node.name ?? '').includes(whole)) out.push(`${named}'s accessible name doesn't hold its whole title: it is ${JSON.stringify(node.name)}`);
  const runs = titleRuns(s, row);
  if (!runs.length) return [...out, `${named} draws nothing in its title slot`];
  const line = runs[0]!.bounds;
  if (runs.some((x) => Math.abs(x.bounds[1]! - line[1]!) > line[3]! / 2)) out.push(`${named} draws its title on more than one line: ${JSON.stringify(runs.map((x) => [x.text.slice(0, 20), x.bounds]))}`);
  // Under the slots to its right: over the words they draw by more than a glyph is wide (a run's bounds hold the whole
  // sprite of a glyph its slot's edge cuts, which reaches at most that far).
  const across = (a: number[], b: number[]): number => Math.min(a[0]! + a[2]!, b[0]! + b[2]!) - Math.max(a[0]!, b[0]!);
  for (const right of ['word', 'time', 'flag'] as const) {
    const other = byId(s, `${row}:${right}`);
    const words = other ? runsIn(s, other.bounds) : [];
    const under = runs.find((x) => words.some((w) => overlap(x.bounds, w.bounds) && across(x.bounds, w.bounds) > x.bounds[3]!));
    if (under) out.push(`${named} draws its title under its ${right === 'word' ? 'state word' : right} slot (${row}:${right}): "${under.text.slice(0, 30)}" at ${JSON.stringify(under.bounds)} over ${JSON.stringify(words.map((w) => w.text))}`);
  }
  // Two strings drawn over each other spell neither in the replica's reading, so the state word must read clear too.
  const word = slot(s, row, 'word');
  if (word?.name && !runsIn(s, word.bounds).some((x) => x.text === word.name)) out.push(`${named} draws its title under its state word slot (${row}:word): the word "${word.name}" isn't drawn clear in it, it reads ${JSON.stringify(runsIn(s, word.bounds).map((x) => x.text))}`);
  // A glyph's raster may spill a pixel or two past its slot; one cut by the slot's edge is no whole character.
  for (const x of runs) if (!inside(x.bounds, title.bounds, 2)) out.push(`${named} draws "${x.text.slice(0, 30)}" past its title slot: at ${JSON.stringify(x.bounds)}, the slot at ${JSON.stringify(title.bounds)}`);
  // A run its clip cut spells the whole line it starts, whatever shows, so it is judged before its text.
  const drawn = runs.map((x) => x.text).join('');
  if (runs.some((x) => x.cut)) out.push(`${named} is clipped at the edge of its slot, not cut at a whole character with an ellipsis: it starts ${JSON.stringify(drawn.slice(0, 40))}`);
  else if (drawn !== whole) {
    const kept = drawn.endsWith(ELLIPSIS) ? drawn.slice(0, -ELLIPSIS.length) : null;
    if (kept === null) out.push(`${named} is cut without an ellipsis: it draws ${JSON.stringify(drawn.slice(0, 60))}`);
    else if (!kept.length || !whole.startsWith(kept)) out.push(`${named} isn't cut at a whole character of its title: it draws ${JSON.stringify(drawn.slice(0, 60))}`);
  }
  return out;
}

async function titlesFailures(plant?: string): Promise<string[]> {
  const r = await replicaOf(world, OPENING, plant);
  try {
    const s = (await r.see()).snapshot;
    return (['long', 'han', 'arabic'] as const).flatMap((key) => titleFailures(s, `session:${sessionOf(world, key).id}`, TITLE[key]));
  } finally {
    await r.stop();
  }
}

describe(`AC6 ${ID.titles} a long title fits its slot`, () => {
  it(`AC6 ${ID.titles}: a 200-character title, a Han title and an Arabic title each draw on one line inside their slot, with the full text as the accessible name`, async () => {
    expect([...TITLE.long].length, 'the fixture title is 200 characters').toBe(200);
    expect(await titlesFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC6 ${ID.titles} wrong program: a planted row whose title runs under its state word fails, naming the row`, async () => {
    const long = sessionOf(world, 'long');
    expect((await titlesFailures(PLANT.titleUnder)).join('\n'), 'the planted row (README, Surface choices: title-under-word)').toContain(`row session:${long.id} ("${[...TITLE.long].slice(0, 24).join('')}…") draws its title under its state word slot (session:${long.id}:word)`);
  }, 30 * MIN);
});

/** At 260 wide, the row reading INCONCLUSIVE and how much of its title it shows. */
async function twelveFailures(plant?: string): Promise<string[]> {
  const twelve = sessionOf(world, 'twelve');
  const row = `session:${twelve.id}`;
  const r = await replicaOf(world, OPENING, plant);
  try {
    const before = await r.see();
    const listed = before.rows.find((x) => x.id === row);
    if (!listed) return [`the record's rows hold no ${row}`];
    await feedRow(r, listed, { word: 'INCONCLUSIVE', entry: 'inconclusive', why: 'the timing check ran on a loaded machine; a run on a quiet one decides it' });
    await r.wait(500);
    const s = (await r.see()).snapshot;
    const list = listView(s);
    const width = list ? list[2]! / s.window.scale : 0;
    if (Math.abs(width - 260) > 4) return [`the list is ${width} wide, not 260`];
    const named = `row ${row} ("${TITLE.twelve}")`;
    const word = slot(s, row, 'word');
    if (!word || !runsIn(s, word.bounds).some((x) => x.text === 'INCONCLUSIVE')) return [`${named} doesn't read INCONCLUSIVE in its state word slot (${row}:word)`];
    const runs = titleRuns(s, row);
    if (runs.some((x) => x.cut)) return [`${named} reading INCONCLUSIVE draws its title clipped, not cut at an ellipsis, so the characters it shows can't be read`];
    const drawn = runs.map((x) => x.text).join('');
    const kept = drawn.endsWith(ELLIPSIS) ? drawn.slice(0, -ELLIPSIS.length) : drawn;
    if (!TITLE.twelve.startsWith(kept)) return [`${named} reading INCONCLUSIVE draws ${JSON.stringify(drawn)} in its title slot, not the start of its title cut at an ellipsis`];
    return chars(kept).length >= 12 ? [] : [`${named} reading INCONCLUSIVE shows ${chars(kept).length} characters of its title (${JSON.stringify(drawn)}), fewer than 12`];
  } finally {
    await r.stop();
  }
}

describe(`AC7 ${ID.twelve} every state word leaves 12 characters of title`, () => {
  it(`AC7 ${ID.twelve}: at 260 wide, a row reading INCONCLUSIVE shows at least 12 characters of its title`, async () => {
    expect(await twelveFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC7 ${ID.twelve} wrong program: a planted row that shows fewer fails, naming the row`, async () => {
    const twelve = sessionOf(world, 'twelve');
    expect((await twelveFailures(PLANT.titleEight)).join('\n'), 'the planted row (README, Surface choices: title-shows-8)').toContain(`row session:${twelve.id} ("${TITLE.twelve}") reading INCONCLUSIVE shows 8 characters of its title`);
  }, 30 * MIN);
});
