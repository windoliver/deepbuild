// AC5: A notification for an ask and the menu bar's title are in the app's language, read from the accessibility tree,
// and the ask's own question is the agent's words, unchanged.
//
// The notification (README, Readings 4): an unbundled app has no Notification Center a test can read, so the replica
// stands in for it as in #883, #994 and #1100: this checkout's `deep-drive` launched with zh-Hans and with en-US on the
// record a real hub made (helpers.ts RICH, as a fixture), its clock run 2 s, and the text it posted for the approval
// (`close`'s trace, `notifications`): the title and body macOS is asked to show, which is what the banner's accessibility
// element reads. The menu bar's title is read from the real app's accessibility tree: the real `deep-app` in a temp HOME,
// on a real hub with one open ask, started with the system's preferred languages set for its one process
// (`-AppleLanguages "(zh-Hans-CN, en-US)"`, and "(en-US)"; README, Surface 6), its status item's title read as an
// assistive client reads it (#1462's probe `status`).
import { afterAll, expect, it } from 'vitest';
import { stopHub } from '../16/helpers.ts';
import { RealApp } from '../1808/helpers.ts';
import {
  appPlain, askOf, BASE_COUNT, cleanup, countKey, Drive, drivePlain, englishIn, fixtureOf, form, HAN, ID, keyed, makeWorld, MIN, RICH, sleep,
  statusTitles, strip, tables, withLanguages,
} from './helpers.ts';

afterAll(cleanup, 60_000);

it(`AC5 ${ID.asks}: a notification for an ask and the menu bar's title read in the app's language, and the ask's question is the agent's words, unchanged`, async () => {
  const bin = await drivePlain();
  const w = await makeWorld(RICH, 'fixture');
  const fixture = await fixtureOf(w);
  await stopHub(w.hub);
  const ask = askOf(w, 'push');
  const notified = async (locale: string): Promise<string | undefined> => {
    const d = await Drive.launched(bin, { from: 'fixture', fixture, locale });
    try {
      await d.wait(2000);
      const trace = await d.close();
      return ((trace.notifications ?? []) as { ask: string | null; text: string }[]).find((n) => n.ask === ask.handle)?.text;
    } finally {
      await d.stop();
    }
  };
  const en = await notified('en-US');
  const zh = await notified('zh-Hans');
  expect(typeof en === 'string' && typeof zh === 'string', `the replica posts a notification for ${ask.handle} in en-US and in zh-Hans: ${JSON.stringify({ en, zh })}`).toBe(true);
  expect(zh, 'the zh-Hans notification reads otherwise than the en-US one').not.toBe(en);
  expect([en!, zh!].filter((text) => !text.includes(ask.question)), `each holds the ask's question "${ask.question}" unchanged`).toEqual([]);
  const t = tables();
  if (typeof t === 'string') expect.fail(t);
  expect(englishIn(zh!, keyed(t), w.words), `the zh-Hans notification holds no English string the table has a key for: ${zh}`).toBeUndefined();
  expect(HAN.test(strip(zh!, w.words)), `the zh-Hans notification's own words are Chinese: ${zh}`).toBe(true);

  const key = countKey(t);
  expect(key, 'the English table has the count\'s sentence as a plural entry').toBeDefined();
  const live = await makeWorld([RICH[0]!], 'live');
  const app = await appPlain();
  for (const [locale, languages, want] of [
    ['zh-Hans', ['zh-Hans-CN', 'en-US'], form(t.zh[key!]?.text, 'zh', 1)],
    ['en-US', ['en-US'], BASE_COUNT(1)],
  ] as const) {
    expect(want, `the ${locale} table has the count's sentence for 1`).toBeDefined();
    const real = await RealApp.launch(live.home, withLanguages(app, languages));
    try {
      let titles: (string | null)[] = [];
      for (const until = Date.now() + 60_000; Date.now() < until; await sleep(1000)) {
        titles = await statusTitles(real.pid);
        if (titles.includes(want!)) break;
      }
      expect(titles, `with the system's languages ${languages.join(', ')}, the status item's title an assistive client reads is the count's sentence in ${locale}`).toContain(want);
    } finally {
      await real.stop();
    }
  }
}, 120 * MIN);
