// AC1 #1843.5a8eb94d: "On the virtual clock, each of `move`, `resize`, `occluded`, `display` and `activation` at 300 ms
// after a card's presentation makes a press at 600 ms answer nothing and one at 800 ms answer. A table that ignores one
// fails, naming the trigger".
//
// The card is the app's own, on its ask's page in the replica's window (`deep-drive`, the virtual clock, only the frames a
// real window would draw). Each trigger reaches it as the platform says it of that window (helpers.ts, SAYS; README,
// Surface 1), in the frame that ends 300 ms after the card was presented. Every press is the same one, at the middle of
// the same option, stamped by the replica's clock as it is delivered; it isn't hardware, so the OS confirms you, which
// `test-confirm`'s file stands for. What answered is what the app sent its hub: `ask.answer` for that ask.
//
// Every run also shows the press is one that answers: with no trigger it answers at 600 ms, and after a trigger it answers
// at 800 ms, so a card that never arms, or is held for good, fails. And the same with the card armed first, which is the
// issue's own case: each trigger at 700 ms, a press at 1000 ms and one at 1200 ms.
import { afterAll, describe, expect, it } from 'vitest';
import { ASK, askAt, cleanup, FRAME, flicks, ID, MIN, OPTION, plantOf, Replica, SAYS, TRIGGERS, type Trigger } from './helpers.ts';

afterAll(cleanup, 60_000);

/** When the trigger comes, ms after the presentation: before the card arms, as the criterion has it, and once it has. */
const PRESENTED = 300;
const ARMED = 700;

/** What a run of the card found wrong, each naming the trigger: the trigger at `at`, a press 300 ms on and one 500 ms on. */
async function failures(trigger: Trigger | null, o: { at?: number; plant?: string } = {}): Promise<string[]> {
  const when = o.at ?? PRESENTED;
  const r = await Replica.start(o.plant);
  try {
    const named = `${ASK.handle} ("${ASK.question}")`;
    // The first open ask's card is up and past its interval, so nothing of the launch is in the timing.
    await r.until(flicks(1500));
    const presented = r.t;
    await r.open(askAt(ASK.handle));
    const at = (ms: number): number => presented + flicks(ms);
    const out: string[] = [];
    const says = trigger ? SAYS[trigger] : [];
    await r.until(at(when) - says.length * FRAME);
    const [before, should] = [await r.card(), when === ARMED ? 'armed' : 'presented'];
    if (before !== should) out.push(`before any trigger the card for ${named} reads ${before}, not ${should}, just under ${when} ms after it was presented`);
    for (const call of says) {
      const reply = await r.call(call);
      if (reply.ok !== true) return [...out, `the trigger ${trigger} never reached the card for ${named}: deep-drive refused ${JSON.stringify(call)} (README, Surface 1): ${JSON.stringify(reply.error ?? reply).slice(0, 300)}`];
    }
    const [early, late] = trigger ? [when + 300, when + 500] : [when + 300, null];
    const after = trigger ? `after ${trigger} at ${when} ms, a press` : 'with no trigger, a press';
    await r.until(at(early));
    const reads = await r.card();
    await r.press();
    if (trigger && late !== null) {
      const answers = await r.answers();
      if (answers.length) return [...out, `${after} ${early} ms after the card was presented answered ${named} with ${JSON.stringify(answers[0]!.option)}: the card took no notice of ${trigger}`];
      if (reads !== 'presented') out.push(`after ${trigger} at ${when} ms the card for ${named} reads ${reads} at ${early} ms, not presented`);
      await r.until(at(late));
      await r.press();
    }
    // The OS's confirmation and the answer's way to the hub take frames of their own.
    await r.until(r.t + flicks(500));
    const answers = await r.answers();
    if (answers.length !== 1 || answers[0]!.option !== OPTION.id) out.push(`${after} ${late ?? early} ms after the card was presented answered ${named} with ${JSON.stringify(answers.map((a) => a.option))}, not ["${OPTION.id}"] once: the card reads ${await r.card()}`);
    return out;
  } finally {
    await r.stop();
  }
}

describe(`AC1 ${ID.clock} on the virtual clock, each trigger returns the card to presented and restarts its interval`, () => {
  it(`AC1 ${ID.clock} control: with no trigger the same press 600 ms after the card was presented answers`, async () => {
    expect(await failures(null)).toEqual([]);
  }, 30 * MIN);

  for (const trigger of TRIGGERS) {
    it(`AC1 ${ID.clock} ${trigger} at 300 ms makes a press at 600 ms answer nothing and one at 800 ms answer`, async () => {
      expect(await failures(trigger), `the card's ${trigger}`).toEqual([]);
    }, 30 * MIN);
  }

  for (const trigger of TRIGGERS) {
    it(`AC1 ${ID.clock} ${trigger} on the armed card, at 700 ms, makes a press at 1000 ms answer nothing and one at 1200 ms answer`, async () => {
      expect(await failures(trigger, { at: ARMED }), `the armed card's ${trigger}`).toEqual([]);
    }, 30 * MIN);
  }

  for (const trigger of TRIGGERS) {
    it(`AC1 ${ID.clock} wrong program: a table that ignores ${trigger} fails, naming it`, async () => {
      expect((await failures(trigger, { plant: plantOf(trigger) })).join('\n'), `the planted table (README, Plants: ${plantOf(trigger)}) lets the press through`).toContain(`after ${trigger} at 300 ms, a press 600 ms after the card was presented answered ${ASK.handle}`);
    }, 30 * MIN);
  }
});
