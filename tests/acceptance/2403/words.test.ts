// AC1: In a replica launched with `locale: zh-Hans`, no shipped view's text snapshot holds an English string the table
// has a key for, and with `locale: en-US` every snapshot is byte-identical to the merge base's. On the merge base the two
// launches draw the same, and the test fails, naming the first node.
//
// One world, the record a real hub made (helpers.ts RICH: an approval with its plan, the oldest ask, so the window opens
// on its card; a choice; a taste call; a working, a failed and a finished session in two projects), written as a fixture
// so every build draws the same launch at the replica's NOW. Seven visits (README, Readings 2): the first open ask's page
// with its question card, a session's page, the Agents page, the Rules page, a project's page, the empty state and the
// first launch's page, which between them draw every shipped view the replica's window draws. Each visit is taken four
// ways: this checkout's `deep-drive` with zh-Hans and with en-US, and the merge base's (built from `git archive` of
// `git merge-base HEAD origin/main`, helpers.ts `baseDrive`) with both. The judge (helpers.ts `judge`) reads what a person
// reads: nodes' names, the strings drawn and the menu bar, never a node's value, which is a code.
import { afterAll, describe, expect, it } from 'vitest';
import { shared, stopHub } from '../16/helpers.ts';
import {
  baseDrive, cleanup, Drive, drivePlain, firstDifference, fixtureOf, flat, ID, IN_WINDOW, judge, keysOf, makeWorld, MIN, NAMED,
  RICH, sessionOf, tables, type Visit, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** One build's seven visits in one locale, each launch in a process of its own. */
async function visits(bin: string, locale: string, fixture: string, w: World): Promise<Visit[]> {
  const out: Visit[] = [];
  const d = await Drive.launched(bin, { from: 'fixture', fixture, locale });
  try {
    await d.wait(2000);
    out.push({ name: `the first open ask's page with its card, ${locale}`, seen: await d.see() });
    for (const [name, address] of [
      ['a session\'s page', `session/${sessionOf(w, 'tint').id}`],
      ['the Agents page', 'page/agents'],
      ['the Rules page', 'page/rules'],
      ['a project\'s page', 'project/atlas'],
    ] as const) {
      await d.open(address);
      await d.wait(500);
      out.push({ name: `${name}, ${locale}`, seen: await d.see() });
    }
  } finally {
    await d.stop();
  }
  for (const [name, launch] of [['the empty state', { from: 'empty' }], ['the first launch\'s page', { from: 'empty', setup: 'unfinished' }]] as const) {
    const e = await Drive.launched(bin, { ...launch, locale });
    try {
      await e.wait(1000);
      out.push({ name: `${name}, ${locale}`, seen: await e.see() });
    } finally {
      await e.stop();
    }
  }
  return out;
}

const runs = shared(async () => {
  const [here, base] = await Promise.all([drivePlain(), baseDrive()]);
  const w = await makeWorld(RICH, 'fixture');
  const fixture = await fixtureOf(w);
  await stopHub(w.hub);
  return {
    words: w.words,
    zh: await visits(here, 'zh-Hans', fixture, w),
    en: await visits(here, 'en-US', fixture, w),
    baseZh: await visits(base, 'zh-Hans', fixture, w),
    baseEn: await visits(base, 'en-US', fixture, w),
  };
});

describe(`AC1 ${ID.words} the app's own words in zh-Hans, and en-US as at the merge base`, () => {
  it(`AC1 ${ID.words}: in a replica launched with locale zh-Hans no shipped view's text snapshot holds an English string the table has a key for, and with en-US every snapshot is byte-identical to the merge base's`, async () => {
    const r = await runs();
    const drawn = new Set(r.zh.flatMap((v) => (v.seen.snapshot.views ?? []).map((x) => x.name)));
    expect(IN_WINDOW.filter((name) => !drawn.has(name)), 'the zh-Hans visits draw every shipped view the replica\'s window draws').toEqual([]);
    expect(r.zh.some((v) => flat(v.seen.snapshot.tree).some((n) => n.id === 'question-card')), 'a zh-Hans visit shows the question card').toBe(true);
    const t = tables();
    expect(judge(r.zh, r.en, t, r.words), 'each zh-Hans launch draws otherwise than en-US and holds no English string the table has a key for').toEqual([]);
    expect(typeof t === 'string' ? [t] : NAMED.filter((s) => !keysOf(t, s).length).map((s) => `the table has no key for "${s}"`), 'the table has a key for each literal the issue names').toEqual([]);
    const differ = r.en.flatMap((v, i) => (v.seen.sha256 === r.baseEn[i]?.seen.sha256 ? [] : [`${v.name}: ${firstDifference(v.seen.snapshot, r.baseEn[i]!.seen.snapshot)}`]));
    expect(differ, 'each en-US snapshot is byte-identical to the merge base\'s').toEqual([]);
  }, 120 * MIN);

  it(`AC1 ${ID.words}: the merge base, launched with zh-Hans, draws the same as with en-US and fails the judge, naming the first node that holds an English string the table has a key for`, async () => {
    const r = await runs();
    const failures = judge(r.baseZh, r.baseEn, tables(), r.words);
    expect(failures.filter((f) => f.includes('draws the same as en-US')).length, `the merge base draws each zh-Hans visit the same as en-US:\n${failures.join('\n')}`).toBe(r.baseZh.length);
    const first = `${r.baseZh[0]!.name}: in zh-Hans node `;
    expect(failures.find((f) => f.startsWith(first)), `the judge names the node of the merge base's first zh-Hans visit that first holds an English string the table has a key for:\n${failures.join('\n')}`).toBeDefined();
  }, 120 * MIN);
});
