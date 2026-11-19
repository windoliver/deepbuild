// AC4: Counts of 0, 1, 2 and 11 open asks read right in both languages, from the table's plural forms. A planted
// sentence joined from a word and a number fails the lane, naming it (lint.test.ts).
//
// Four worlds, each the record a real hub made with 0, 1, 2 or 11 open asks, one a session so none folds into another
// (helpers.ts `counted`), written as fixtures; each launched in the replica with en-US and with zh-Hans. The count's
// sentence is read where the snapshot gives it, the menu bar's title (design: Replica, `see`). It reads right when en-US
// says the merge base's sentence, which the English table's plural entry gives too, and zh-Hans says, in Chinese, the
// zh-Hans table's form of that entry for the count, with its number (README, Surface 4).
import { afterAll, expect, it } from 'vitest';
import { stopHub } from '../16/helpers.ts';
import { BASE_COUNT, cleanup, counted, countKey, Drive, drivePlain, fixtureOf, form, HAN, ID, makeWorld, MIN, tables } from './helpers.ts';

afterAll(cleanup, 60_000);
const COUNTS = [0, 1, 2, 11] as const;

it(`AC4 ${ID.counts}: counts of 0, 1, 2 and 11 open asks read right in en-US and in zh-Hans, from the table's plural forms`, async () => {
  const bin = await drivePlain();
  const read: Record<number, { en: string; zh: string }> = {};
  for (const n of COUNTS) {
    const w = await makeWorld(counted(n), 'fixture');
    const fixture = await fixtureOf(w);
    await stopHub(w.hub);
    const title = async (locale: string): Promise<string> => {
      const d = await Drive.launched(bin, { from: 'fixture', fixture, locale });
      try {
        await d.wait(1000);
        return (await d.see()).snapshot.menu_bar?.title ?? '';
      } finally {
        await d.stop();
      }
    };
    read[n] = { en: await title('en-US'), zh: await title('zh-Hans') };
  }
  const said = COUNTS.map((n) => `${n}: en-US "${read[n]!.en}", zh-Hans "${read[n]!.zh}"`).join('; ');
  expect(COUNTS.map((n) => read[n]!.en), `en-US says the merge base's sentence at each count (${said})`).toEqual(COUNTS.map(BASE_COUNT));
  expect(COUNTS.filter((n) => read[n]!.zh === read[n]!.en || !HAN.test(read[n]!.zh)).map((n) => `${n} asks: "${read[n]!.zh}"`), `zh-Hans says each count in Chinese, not as en-US says it (${said})`).toEqual([]);
  const t = tables();
  if (typeof t === 'string') expect.fail(t);
  const key = countKey(t);
  expect(key, 'the English table has the count\'s sentence as a plural entry: "1 ask needs you" for 1, "11 asks need you" for 11').toBeDefined();
  expect(COUNTS.map((n) => form(t.en[key!], 'en', n)), 'the English entry\'s forms are the merge base\'s sentences').toEqual(COUNTS.map(BASE_COUNT));
  const zh = t.zh[key!]?.text;
  expect(zh, `the zh-Hans table translates the count's entry ${key}`).toBeDefined();
  expect(COUNTS.map((n) => read[n]!.zh), `zh-Hans says the zh-Hans table's form for each count (${said})`).toEqual(COUNTS.map((n) => form(zh, 'zh', n)));
  expect(COUNTS.filter((n) => n > 0 && !read[n]!.zh.includes(String(n))), `each count of 1 or more holds its number in zh-Hans (${said})`).toEqual([]);
}, 120 * MIN);
