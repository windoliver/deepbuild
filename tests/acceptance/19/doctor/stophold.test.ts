// AC15 #19.fbe84694 With the hold at 60 s, a Claude Code settings fixture whose Stop hook entry sets `timeout` to
// 60, and the same with 64, each make `deep doctor` show the stop-hold relation broken, naming the hold, the timeout
// and the reason, and exit 1, and the hub started on the same fixture shows the same reading; with 65 the item is
// ok. A doctor that compares the two with no margin passes 64 and fails this test, and one that only checks the
// entry exists passes all three and fails it too.
//
// Each fixture is a home set up by `deep setup`, its DeepBuild stop-hold entry (the one foreground Stop entry,
// #18) edited to the timeout with the hub stopped, then the hub started on it. The hold is the design's default,
// 60 s, as setup leaves it. "The reason" is why the relation breaks: the hold must end at least 5 s before the
// timeout, or Claude Code cuts the hook off and the stop goes through with no verdict, so stops go watch-only
// (README: AC15).

import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, count, doctor, eventually, itemText, readingTexts, setStopTimeout, shown, stopHub, world } from './helpers.ts';

afterAll(cleanup, 60_000);

const HOLD = '60 s';
const stopHold = (text: string) => /stop[- ]hold/i.test(text);
/** Names the hold and the timeout: `60 s` twice when they are equal. */
const namesBoth = (text: string, seconds: number) => (seconds === 60 ? count(text, HOLD) >= 2 : text.includes(HOLD) && text.includes(`${seconds} s`));
const givesReason = (text: string) => /watch-only|no verdict|cut[s]? (the hook )?off|\b5 s\b/i.test(text);
/** A broken reading at the hub: the relation, both values, and a word that it's broken or what it turns off. */
const brokenReading = (text: string, seconds: number) => stopHold(text) && namesBoth(text, seconds) && /broken|watch-only/i.test(text);

/** One fixture: the stop-hold entry's timeout at `seconds`, checked in deep doctor and at the hub's start. Throws naming what's wrong. */
async function relationAt(seconds: number, plant?: string): Promise<void> {
  const w = await world({ ...(plant ? { plant } : {}), noSession: true, after: (h) => setStopTimeout(h, seconds) });
  try {
    const d = await doctor(w.h);
    const items = d.items.filter((i) => stopHold(itemText(i)));
    if (seconds <= 64) {
      const broken = items.find((i) => i.code === 'timing_relation_broken' && i.level === 'fail' && namesBoth(itemText(i), seconds) && givesReason(itemText(i)));
      if (!broken) throw Error(`AC15 at ${seconds} s against the ${HOLD} hold, deep doctor must show the stop-hold relation broken (timing_relation_broken, fail), naming the ${HOLD} hold, the ${seconds} s timeout and the reason: ${shown(d.ran)}`);
      if (d.ran.code !== 1) throw Error(`AC15 at ${seconds} s deep doctor must exit 1 with the stop-hold relation broken: ${shown(d.ran)}`);
      const atStart = await eventually(async () => (await readingTexts(w.hub!)).some((t) => brokenReading(t, seconds)), 20_000);
      if (!atStart) throw Error(`AC15 at ${seconds} s the hub started on the same fixture must show the same reading, the stop-hold relation broken naming the ${HOLD} hold and the ${seconds} s timeout: ${JSON.stringify(await readingTexts(w.hub!)).slice(0, 3000)}`);
    } else {
      if (items.some((i) => i.code === 'timing_relation_broken')) throw Error(`AC15 at ${seconds} s the stop-hold relation holds, and deep doctor must not show it broken: ${shown(d.ran)}`);
      if (!items.some((i) => i.level === 'ok' && itemText(i).includes(`${seconds} s`))) throw Error(`AC15 at ${seconds} s deep doctor must show the stop-hold relation as an ok item naming the ${seconds} s timeout: ${shown(d.ran)}`);
      const texts = await readingTexts(w.hub!);
      if (texts.some((t) => brokenReading(t, seconds))) throw Error(`AC15 at ${seconds} s the hub must not show the stop-hold relation broken: ${JSON.stringify(texts).slice(0, 3000)}`);
    }
  } finally {
    await stopHub(w.hub!);
  }
}

describe('AC15 #19.fbe84694 With the hold at 60 s, a Claude Code settings fixture whose Stop hook entry sets `timeout` to 60, and the same with 64, each make `deep doctor` show the stop-hold relation broken, naming the hold, the timeout and the reason, and exit 1, and the hub started on the same fixture shows the same reading; with 65 the item is ok', () => {
  it('AC15 #19.fbe84694 the Stop hook entry\'s timeout at 60 s: broken in deep doctor (exit 1) and at hub start, naming 60 s twice and the reason', async () => {
    await relationAt(60);
  }, 600_000);

  it('AC15 #19.fbe84694 the Stop hook entry\'s timeout at 64 s: broken in deep doctor (exit 1) and at hub start, naming the 60 s hold, the 64 s timeout and the reason', async () => {
    await relationAt(64);
  }, 600_000);

  it('AC15 #19.fbe84694 the Stop hook entry\'s timeout at 65 s: the stop-hold item is ok, naming 65 s, and nothing reads broken', async () => {
    await relationAt(65);
  }, 600_000);

  it('AC15 #19.fbe84694 (wrong program) a doctor and hub that compare the hold and the timeout with no margin (stop-hold-no-margin) pass 64 s and fail this test', async () => {
    await expect(relationAt(64, 'stop-hold-no-margin')).rejects.toThrow(/AC15 at 64 s against the 60 s hold, deep doctor must show the stop-hold relation broken/);
  }, 600_000);

  it('AC15 #19.fbe84694 (wrong program) a doctor and hub that only check the Stop entry exists (stop-hold-entry-only) pass all three and fail this test', async () => {
    await expect(relationAt(60, 'stop-hold-entry-only')).rejects.toThrow(/AC15 at 60 s against the 60 s hold, deep doctor must show the stop-hold relation broken/);
    await expect(relationAt(64, 'stop-hold-entry-only')).rejects.toThrow(/AC15 at 64 s against the 60 s hold, deep doctor must show the stop-hold relation broken/);
  }, 900_000);
});
