// AC1 to AC4: an ask from the session whose page is open in the key window is said once, as a line that starts with
// "needs you" and ends with the key that opens its card; an ask from another session posts its notification and is not
// said; and the region keeps its last five lines as rows that draw nothing.
//
// One run (README, The fixtures: the journey): a real hub's record with two finished sessions and no open ask; the
// replica on a copy of it at the reference window, session A's page open; then, each as a real hub records it and fed
// to the replica in log order, an ask from A, an ask from B, and four more asks from A, 3 s of the replica's clock
// after each. The shipped run is made once and judged by all four criteria; each plant's run goes only as far as its
// judge reads.
import { afterAll, describe, expect, it } from 'vitest';
import { shared, ulid } from '../16/helpers.ts';
import { letters, makeWorld } from '../2018/helpers.ts';
import { rowSet } from '../1461/helpers.ts';
import type { Row } from '../1463/helpers.ts';
import { blocked, changed, cleanup, MIN, REFERENCE, Stage } from './helpers.ts';
import {
  addedSince, askLine, askOpened, drawsNone, ID, openKeys, otherAsk, PLANT, regionOf, regionRows, REGION,
  type Entry, type Posted, type Read, type Shot, type Snapshot,
} from './judges.ts';

afterAll(cleanup, 5 * MIN);
const LIMIT = 180 * MIN;
const HELD = 'the shipped app must pass this judge first, or a plant it fails proves nothing';

const TITLE = { a: 'Cart totals', b: 'Release notes' } as const;
/** What A's turn did last, as its row's doing line says it (design: States people see). */
const DOING = 'Ran npm';
const FIRST = 'Which store keeps the cart totals?';
const OTHER = 'Which heading opens the release notes?';
const MORE = ['Keep the old totals table?', 'Round the totals up or down?', 'Show the tax line on the cart?', 'Ship the totals behind a flag?'];
/** How long each change is left before the next: past the notifier's delay (1 s) and the 2 s inside which changes are one line. */
const APART_MS = 3000;

interface Asked { who: string; handle: string; question: string }
const asked = (handle: string, question: string, title: string): Asked => ({ handle, question, who: `the ask ${handle} ("${question}") from ${title}` });
interface Journey {
  first: Asked; other?: Asked;
  base: Read; firstRead: Read; settled: Read;
  /** B's ask: the announcements 3 s after it. */
  afterOther?: Read;
  /** Every entry the run made, in order, as each was read when it was made. */
  made: Entry[];
  final?: Snapshot; shots: Shot[]; picture?: { sha256: string; w: number; h: number };
  posted: Posted[] | undefined;
  at: (e: Entry) => number;
}

async function journey(o: { plant?: string; upTo: 'ask' | 'other' | 'rows' }): Promise<Journey> {
  const w = await makeWorld({
    repos: ['shop'],
    seed: async (s, T) => {
      for (const [i, key] of (['a', 'b'] as const).entries()) {
        const at = T - (20 - 5 * i) * MIN;
        await s.start(key, 'shop', at);
        await s.task(key, TITLE[key], at + 1000);
        await s.prompt(key, `Tidy up ${TITLE[key].toLowerCase()}`, at + 2000);
        const call = await s.toolStart(key, at + 3000);
        await s.toolEnd(key, call, at + 9000);
        await s.stop(key, at + 20_000, false);
      }
    },
  });
  const stage = await Stage.on(w, o.plant ? { plant: o.plant } : {});
  try {
    const [a, b] = [w.sessions.a ?? blocked('the world has no session a'), w.sessions.b ?? blocked('the world has no session b')];
    // Before its page opens, A's row reads working with a doing line, as the core writes a working session's row
    // (row.set@3): the words a planted line starts with (README, Plants). No page of A's is open, so nothing is said.
    const row = (await stage.row(`session:${a.id}`)) ?? blocked(`the replica's list holds no row for session:${a.id} (${TITLE.a})`);
    const now = Date.now();
    await stage.feed(a.id, { ...(await rowSet({ ...row, word: 'working', entry: 'running', why: 'at work', waits_on: 'agent', since: now, unread: false, doing: { words: DOING, at: now, ago: true } } as unknown as Row)), v: 3 });
    await stage.d.open(`session/${a.id}`);
    await stage.d.wait(APART_MS);
    const base = await stage.read();

    // An ask from A opens, its page open in the key window.
    let handle = '';
    await changed(stage, async (s, at) => { handle = await s.ask('a', 'choice', FIRST, at); });
    let firstRead = await stage.read();
    if (!firstRead.missing && addedSince(base, firstRead).added.length === 0) {
      // "Within one event of the ask": one more record event, which says nothing by itself (B's agent's message).
      await stage.feed(b.id, { v: 1, id: ulid(), kind: 'session.activity', writer: 'hook', actor: 'you', scope: 'you', subject: `session:${letters(b.id)}`, data: { activity: 'Reading the release notes' } });
      firstRead = await stage.read();
    }
    await stage.d.wait(APART_MS);
    const settled = await stage.read();
    const out: Journey = { first: asked(handle, FIRST, TITLE.a), base, firstRead, settled, made: [...addedSince(base, settled).added], shots: [], posted: undefined, at: stage.at };
    if (o.upTo !== 'ask') {
      // An ask from B, A's page still open.
      let other = '';
      await changed(stage, async (s, at) => { other = await s.ask('b', 'choice', OTHER, at); });
      await stage.d.wait(APART_MS);
      out.other = asked(other, OTHER, TITLE.b);
      out.afterOther = await stage.read();
      out.made.push(...addedSince(settled, out.afterOther).added);
    }
    if (o.upTo === 'rows') {
      // Four more changes: four more asks from A, each 3 s after the last.
      let last = out.afterOther!;
      for (const question of MORE) {
        await changed(stage, async (s, at) => { await s.ask('a', 'choice', question, at); });
        await stage.d.wait(APART_MS);
        const read = await stage.read();
        out.made.push(...addedSince(last, read).added);
        last = read;
      }
      out.picture = await stage.d.windowShot();
      out.final = (await stage.d.see()).snapshot;
      const [region] = regionOf(out.final);
      if (region) {
        out.shots.push(await stage.d.shot('the region', { id: REGION }));
        for (const r of region.children ?? []) out.shots.push(typeof r.name === 'string' ? await stage.d.shot(`the row "${r.name}"`, { role: r.role, name: r.name }) : { what: 'a row with no name', ok: false, code: 'unnamed', said: 'a row of the region has no name, so no screenshot of it could be asked' });
      }
    }
    out.posted = (await stage.d.close()).posted;
    return out;
  } finally {
    await stage.stop();
  }
}

const shipped = shared(() => journey({ upTo: 'rows' }));
const besides = [...openKeys(), TITLE.a, TITLE.b, DOING];
const opened = (j: Journey): string[] => askOpened({ ...j.first, count: 1, base: j.base, first: j.firstRead, settled: j.settled, posted: j.posted, besides });
const line = (j: Journey): string[] => askLine({ who: j.first.who, text: addedSince(j.base, j.settled).added[0]?.text, keys: openKeys() });
const rows = (j: Journey): string[] => regionRows({ snapshot: j.final, made: j.made, kept: 5, at: j.at });
const other = (j: Journey): string[] => (j.other && j.afterOther ? otherAsk({ who: j.other.who, handle: j.other.handle, before: j.settled, after: j.afterOther, posted: j.posted }) : ['the run never reached the ask from the other session']);

describe(`AC1 ${ID.ask} an ask from the session whose page is open in the key window is announced once, and posts no notification`, () => {
  it(`AC1 ${ID.ask}: in a replica with session A's page open in the key window, an ask from A opens; the snapshot's announcements hold exactly one entry, with the count in words and the ask's question, within one event of the ask, and no notification is posted`, async () => {
    expect(opened(await shipped())).toEqual([]);
  }, LIMIT);
});

describe(`AC2 ${ID.line} the entry starts with "needs you" and ends with the key that opens the ask's card`, () => {
  it(`AC2 ${ID.line}: that entry starts with "needs you" and ends with the key the action table gives for opening that ask's card`, async () => {
    expect(line(await shipped())).toEqual([]);
  }, LIMIT);

  it(`AC2 ${ID.line} wrong program: a planted line that starts with the session's doing words (${PLANT.lineStartsWithDoing}) fails, naming the line`, async () => {
    expect(line(await shipped()), HELD).toEqual([]);
    const failures = line(await journey({ plant: PLANT.lineStartsWithDoing, upTo: 'ask' })).join('\n');
    expect(failures, `${PLANT.lineStartsWithDoing} wasn't caught naming its line`).toMatch(new RegExp(`the line "${DOING}.*" \\(the ask ask:\\S+ \\("${FIRST.replace('?', '\\?')}"\\) from ${TITLE.a}\\) doesn't start with "needs you"`));
  }, LIMIT);
});

describe(`AC3 ${ID.rows} the region keeps its last five lines as rows, newest first, each with its time, and draws none`, () => {
  it(`AC3 ${ID.rows}: after that run and four more changes, the region's node holds five rows in the tree, newest first, each with its line and its time, and the screenshot draws none of them`, async () => {
    const j = await shipped();
    expect(rows(j)).toEqual([]);
    expect(j.picture, 'a screenshot of the window was taken at the reference window').toMatchObject({ w: REFERENCE.width * 2, h: REFERENCE.height * 2 });
    console.log(`AC3 the window's screenshot with five rows in the region: sha256 ${j.picture?.sha256 ?? 'none'}`);
    const lines = (regionOf(j.final)[0]?.children ?? []).map((r) => r.name).filter((n): n is string => typeof n === 'string');
    expect(drawsNone({ shots: j.shots, runs: j.final?.runs ?? [], lines })).toEqual([]);
  }, LIMIT);

  it(`AC3 ${ID.rows} wrong program: a planted window that keeps only the last line (${PLANT.keepsLastLine}) fails, naming the four it lost`, async () => {
    expect(rows(await shipped()), HELD).toEqual([]);
    const j = await journey({ plant: PLANT.keepsLastLine, upTo: 'rows' });
    const failures = rows(j).join('\n');
    expect(j.made.length, `the planted run made its five entries: ${JSON.stringify(j.made.map((e) => e.text))}`).toBe(5);
    expect(failures, `${PLANT.keepsLastLine} wasn't caught`).toMatch(/keeps 1 of its last 5 lines as rows and lost 4: /);
    const named = failures.split('lost 4: ')[1]!.split('; it holds ')[0]!;
    for (const lost of j.made.slice(0, 4)) expect(named, `the failure names the lost line "${lost.text}"`).toContain(`"${lost.text}"`);
    expect(named, 'the failure names only the four lost, not the line it kept').not.toContain(`"${j.made[4]!.text}"`);
  }, LIMIT);
});

describe(`AC4 ${ID.other} an ask from another session posts its notification and adds no announcement`, () => {
  it(`AC4 ${ID.other}: with the same page open, an ask from session B posts its notification and adds no announcement`, async () => {
    expect(other(await shipped())).toEqual([]);
  }, LIMIT);

  it(`AC4 ${ID.other} wrong program: a planted window that announces every new ask (${PLANT.everyAsk}) fails, naming B's ask`, async () => {
    expect(other(await shipped()), HELD).toEqual([]);
    const failures = other(await journey({ plant: PLANT.everyAsk, upTo: 'other' })).join('\n');
    expect(failures, `${PLANT.everyAsk} wasn't caught naming B's ask`).toMatch(new RegExp(`the ask ask:\\S+ \\("${OTHER.replace('?', '\\?')}"\\) from ${TITLE.b}, whose session's page isn't the open one, added 1 entry`));
  }, LIMIT);
});
