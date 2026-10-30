// AC14 #327.74732631: the card's arming, tested as a state machine on a virtual clock fed timestamped press events:
// a press stamped 499 ms after presentation answers nothing and one at 500 ms answers; a press down at 450 ms and
// up at 700 ms answers nothing; a key repeat never answers; and after a `rearm_on` change at 300 ms a press at
// 600 ms answers nothing and one at 800 ms answers; a card that times arming from event delivery, or never re-arms,
// fails this test, naming the trigger.
//
// The surface (README: The surfaces): #400's `deep-show run` scenario on the hub's virtual display clock, which at
// the base already presents the scenario's `card` and arms it 500 ms after its presentation vsync. This issue adds
// two calls and one reply field to it:
//   {call: "press", at, t, phase: "down" | "up" | "repeat", option, source: "hid"}: a press on the card's option
//     `option`, stamped by its platform at flick `t` and delivered to the app at flick `at` (`at` ≥ `t`); replied
//     {outcome: "answered" | "refused" | "ignored"} (refused: the card wasn't armed at `t`; ignored: a repeat, or
//     an up with no armed down);
//   {call: "rearm", at, on: "content" | "move" | "resize" | "occluded" | "display" | "activation"}: one of the
//     card's `rearm_on` changes at flick `at` (here a content change: new text on the card);
//   the `card` reply's `card.answer`: null, or {option, t} once a press answered it (its state is then "answered").
// Planted wrong programs: `arms_from_delivery` (the interval runs from the ask's or the press's delivery, not from
// the presentation vsync and the press's platform stamp) and `never_rearms` (a `rearm_on` change leaves the card
// armed). At the base the scenario's `press` call is unknown and the run answers `bad_input`, so `runShow` fails.
import { describe, expect, it } from 'vitest';
import { A, DOC, Driver, MS, PERIOD_A, ask, cardCall, cardOf, clickPanel, useOut, useShow, view, type Card, type JsonObject, type Planted } from '../400/helpers.ts';

const AC14 = '#327.74732631';
const show = useShow();
const out = useOut();
const T0 = 20 * PERIOD_A;
const VIEWS = [{ doc: DOC.x, panel: 'x', document: view('Orders by day') }];
/** How long a press takes to reach the app after its platform stamped it: the card must judge it by the stamp. */
const LAG = 10 * MS;
/** A press's release, after its down. */
const HOLD = 30 * MS;

type Trigger = 'content';
type Planted327 = 'arms_from_delivery' | 'never_rearms';

const press = (t: number, phase: 'down' | 'up' | 'repeat'): JsonObject => ({ call: 'press', at: t + LAG, t, phase, option: 'yes', source: 'hid' });
const rearm = (at: number, on: Trigger): JsonObject => ({ call: 'rearm', at, on });
const answerOf = (c: JsonObject, what: string): JsonObject | null => {
  const card = c['card'];
  const a = card && typeof card === 'object' && !Array.isArray(card) ? card['answer'] : undefined;
  expect(a === null || (typeof a === 'object' && a !== null && !Array.isArray(a)), `${what}: the card reply carries card.answer (null or {option, t}); got ${JSON.stringify(c).slice(0, 600)}`).toBe(true);
  return a as JsonObject | null;
};

/** A fresh world: one display, x in the main window clicked at T0, the ask 4 ms off A's vsync grid so its presentation is the vsync after it. */
function world(planted: Planted327 | undefined, what: string): { d: Driver; P: number; label: string } {
  const label = `${what}${planted ? ` (planted ${planted})` : ''}`;
  const ASK_AT = T0 + 700 * MS + 4 * MS;
  // The planted names are this issue's; #400's helper types its own.
  const d = new Driver(show(), { evidence: out(), displays: [A], docs: VIEWS, card: ask(ASK_AT), ...(planted ? { planted: planted as unknown as Planted } : {}) });
  clickPanel(d, T0, 'x', label);
  const c0 = cardOf(d.one(cardCall(ASK_AT + 2 * PERIOD_A), `${label}: the card as presented`), `${label}: the card as presented`);
  expect(c0.states[0]?.state, `${label}: the card is presented`).toBe('presented');
  const P = c0.states[0]!.at;
  expect(P > ASK_AT, `${label}: the presentation is the display's vsync after the ask, not the ask's delivery (${P} vs ${ASK_AT})`).toBe(true);
  return { d, P, label };
}

/** The card read after the last delivered event, with what answered it. */
function readCard(d: Driver, at: number, what: string): { card: Card; answer: JsonObject | null } {
  const reply = d.one(cardCall(at), what);
  return { card: cardOf(reply, what), answer: answerOf(reply, what) };
}

function arming(planted?: Planted327): string[] {
  const f: string[] = [];
  const ms = (t: number, P: number): string => `${((t - P) / MS).toFixed(1)} ms after presentation`;

  // A press stamped 499 ms after presentation answers nothing; one at 500 ms answers.
  for (const [offset, answers] of [[499, false], [500, true]] as const) {
    const { d, P, label } = world(planted, `a press at ${offset} ms`);
    const t = P + offset * MS;
    d.step([press(t, 'down'), press(t + HOLD, 'up')], `${label}: down and up`);
    const { card, answer } = readCard(d, t + HOLD + LAG + PERIOD_A, `${label}: the card after`);
    if (answers && (card.state !== 'answered' || answer?.['option'] !== 'yes')) f.push(`a press stamped ${ms(t, P)} (500 ms, the arm interval) answered nothing: state ${card.state}, answer ${JSON.stringify(answer)}; the card arms at presentation + 500 ms, not later`);
    if (!answers && (card.state === 'answered' || answer !== null)) f.push(`a press stamped ${ms(t, P)} (499 ms, delivered ${((t + LAG - P) / MS).toFixed(1)} ms after) answered the card: state ${card.state}, answer ${JSON.stringify(answer)}; the card times arming from the presentation vsync and judges a press by its platform stamp, not by delivery`);
  }

  // Down at 450 ms, up at 700 ms: nothing.
  {
    const { d, P, label } = world(planted, 'down at 450 ms, up at 700 ms');
    d.step([press(P + 450 * MS, 'down'), press(P + 700 * MS, 'up')], `${label}: down and up`);
    const { card, answer } = readCard(d, P + 700 * MS + LAG + PERIOD_A, `${label}: the card after`);
    if (card.state === 'answered' || answer !== null) f.push(`a press down ${ms(P + 450 * MS, P)} and up ${ms(P + 700 * MS, P)} answered the card: ${JSON.stringify(answer)}; both down and up must land on the armed option`);
  }

  // A key repeat never answers.
  {
    const { d, P, label } = world(planted, 'a key repeat');
    d.step([press(P + 450 * MS, 'down'), press(P + 600 * MS, 'repeat'), press(P + 650 * MS, 'repeat'), press(P + 700 * MS, 'up')], `${label}: down, repeats, up`);
    const { card, answer } = readCard(d, P + 700 * MS + LAG + PERIOD_A, `${label}: the card after`);
    if (card.state === 'answered' || answer !== null) f.push(`a key repeat (down ${ms(P + 450 * MS, P)}, repeats at 600 and 650 ms, up at 700 ms) answered the card: ${JSON.stringify(answer)}; a key repeat never answers`);
  }

  // After a rearm_on change at 300 ms: a press at 600 ms answers nothing, one at 800 ms answers.
  {
    const { d, P, label } = world(planted, 'a rearm_on change at 300 ms');
    const on: Trigger = 'content';
    d.one(rearm(P + 300 * MS, on), `${label}: the ${on} change`);
    d.step([press(P + 600 * MS, 'down'), press(P + 600 * MS + HOLD, 'up')], `${label}: a press at 600 ms`);
    const early = readCard(d, P + 600 * MS + HOLD + LAG + PERIOD_A, `${label}: the card after the press at 600 ms`);
    if (early.card.state === 'answered' || early.answer !== null) {
      f.push(`after the rearm_on trigger ${on} at ${ms(P + 300 * MS, P)} a press stamped ${ms(P + 600 * MS, P)} answered the card: ${JSON.stringify(early.answer)}; the card never re-armed on ${on}`);
    } else {
      if (!early.card.states.some((s, i) => i > 0 && s.state === 'presented' && s.at === P + 300 * MS)) f.push(`after the rearm_on trigger ${on} at ${ms(P + 300 * MS, P)} the card's states don't return to presented at that flick: ${JSON.stringify(early.card.states)}`);
      d.step([press(P + 800 * MS, 'down'), press(P + 800 * MS + HOLD, 'up')], `${label}: a press at 800 ms`);
      const late = readCard(d, P + 800 * MS + HOLD + LAG + PERIOD_A, `${label}: the card after the press at 800 ms`);
      if (late.card.state !== 'answered' || late.answer?.['option'] !== 'yes') f.push(`after the rearm_on trigger ${on} at 300 ms a press stamped ${ms(P + 800 * MS, P)} (the re-arm interval, 300 + 500 ms) answered nothing: state ${late.card.state}, answer ${JSON.stringify(late.answer)}`);
    }
  }
  return f;
}

describe(`AC14 ${AC14} the card's arming as a state machine on a virtual clock fed timestamped press events`, () => {
  it(`${AC14} a press stamped 499 ms after presentation answers nothing and one at 500 ms answers; down at 450 ms and up at 700 ms answers nothing; a key repeat never answers; after a rearm_on change at 300 ms a press at 600 ms answers nothing and one at 800 ms answers`, () => {
    expect(arming(), 'the card arms from presentation and re-arms on a change').toEqual([]);
  }, 1_200_000);

  const plants: Array<[Planted327, RegExp]> = [
    ['arms_from_delivery', /499 ms|delivery|500 ms/],
    ['never_rearms', /rearm_on trigger content|re-arm/],
  ];
  for (const [planted, names] of plants) {
    it(`${AC14} wrong program: a card that ${planted === 'arms_from_delivery' ? 'times arming from event delivery' : 'never re-arms'} fails this test, naming the trigger`, () => {
      const failures = arming(planted);
      expect(failures.length, `the planted ${planted} is caught`).toBeGreaterThan(0);
      expect(failures.join('\n'), 'the failure names the trigger').toMatch(names);
    }, 1_200_000);
  }
});
