// AC2 #1843.3a7ab2f8: "In the real app, a card armed in a 960×640 window that is then resized to 700×400 doesn't arm while
// any of it lies outside the window, and a click on it answers nothing. The merge base answers it and fails, naming the
// trigger".
// AC3 #1843.0a3b77c9: "In the real app, a click that brings the inactive window forward, landing on an armed card's option,
// answers nothing".
//
// The real `deep-app` on a real hub's record in a temp home, read and driven from outside its process (probe.swift). A
// posted press isn't hardware, so the card takes it only once the OS confirms you, which `test-confirm`'s file stands
// for: a press the card lets through is an answer, and the hub's record shows `ask.answered`. Each run also shows, in the
// same window, that a click on the armed card there does answer when the window is the active one and hasn't moved, or
// "answers nothing" would prove nothing.
//
// BLOCKED, never passed: no Accessibility, a locked screen or a sleeping display (before each step and behind it), a window
// macOS won't size or bring forward; for AC3 also a Mac in use, or another window over the point.
import { afterAll, describe, expect, it } from 'vitest';
import {
  answered, answerNamed, App, blocked, cleanup, fmt, ID, inside, makeWorld, middle, MIN, OPENING, otherAppForward, plantOf, realWindowAccess, shared, SMALL,
  type Ask, type AskSpec, type Box, type Card, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** A click the card lets through has reached the hub's record within this, the app's first pairing with it among what it takes. */
const ANSWER_MS = 30_000;

const size = (b: readonly number[]): string => `${b[0]}×${b[1]}`;
/** A click on the option second in the card's order, the window active and unmoved since it armed: it answers. */
async function control(app: App, w: World, ask: Ask, card: Card, when: string): Promise<string[]> {
  if (!card.front) blocked(`${when}, the app isn't the active one, so the control can't say what a click does there`);
  const option = card.options[1] ?? blocked(`the window shows no second option of ${ask.handle}`);
  await app.click(middle(option.frame));
  const answer = await answered(w, ask, ANSWER_MS);
  return answer ? [] : [`control: ${when}, a click on ${option.id} of the armed card, its window active and unmoved, didn't answer ${ask.handle} ("${ask.question}") in ${ANSWER_MS / 1000} s; ${app.stderr()}`];
}

// ---- AC2: a resize.

/**
 * Nine options, as many as a card shows before it folds (#1808), eight of them long enough for two lines in the lane: the
 * card fits a 960×640 window and runs past a 700×400 one.
 */
const TALL: AskSpec = {
  title: 'Receipt layout',
  question: 'Which order do the receipt\'s blocks take?',
  options: ['Keep it as it is', ...['the totals', 'the items', 'the address', 'the refund terms', 'the store hours', 'the loyalty points', 'the tax lines', 'the barcode'].map((first) =>
    `Print ${first} first, then everything else in the order the checkout page shows it today, with one blank line between two blocks`)].map((label, i) => ({ id: `order-${i + 1}`, label, decision: 'none' as const })),
};
/** When the card is pressed again after the resize, ms: while a stale card would still be armed, and well past its interval. */
const MARKS = [150, 400, 700, 1200, 2000, 3500];
/** From here on the window's own frames have shown what the resize did. */
const DRAWN_MS = 500;

/** A point on an option of the card both as it lies at 960×640 and as it lies at 700×400, the window's corner in one place. */
function onEither(large: Card, small: Card): [number, number] {
  let best: Box | null = null;
  for (const a of large.options) for (const b of small.options) {
    const s = shared(a.frame, b.frame);
    if (s && shared(s, small.window) && (!best || s[3] > best[3])) best = s;
  }
  return middle(best ?? blocked('no point lies on an option of the card both at 960×640 and at 700×400'));
}

async function resizedFailures(plant?: string): Promise<string[]> {
  await realWindowAccess();
  const w = await makeWorld([TALL]);
  const ask = w.asks[0]!;
  const app = await App.launch(w, plant);
  try {
    const named = `${ask.handle} ("${ask.question}")`;
    const out: string[] = [];
    await app.armed(ask, `in a ${size(OPENING)} window`);
    // Where the options lie in the small window, and the window back as it was, armed again.
    await app.place(...SMALL);
    const small = await app.card('still', 'any', 10);
    const ids = TALL.options.map((o) => `card-option:${o.id}`);
    const outside = ids.filter((id) => !small.options.some((o) => o.id === id && inside(o.frame, small.window)));
    expect(outside.length > 0 && outside.length < ids.length, `at ${size(SMALL)} part of the card for ${named} lies outside the window ${fmt(small.window)} and part in it: its options lie at ${small.options.map((o) => fmt(o.frame)).join(' ') || 'nowhere'}`).toBe(true);
    await app.place(...OPENING);
    await app.front();
    const armed = await app.armed(ask, `in a ${size(OPENING)} window`);
    const cut = ids.filter((id) => !armed.options.some((o) => o.id === id && inside(o.frame, armed.window)));
    if (cut.length) return [`in a ${size(OPENING)} window the card for ${named} reads armed with ${cut.join(', ')} outside the window`];

    const got = await app.resized(...SMALL, onEither(armed, small), MARKS);
    if (Math.abs(got.window[2] - SMALL[0]) > 1 || Math.abs(got.window[3] - SMALL[1]) > 1) blocked(`the real window couldn't be resized to ${size(SMALL)}: it reads ${fmt(got.window)}`);
    const clicks = got.clicks.map((c) => `${Math.round(c.ms)} ms (${c.option})`).join(', ');
    const answer = await answered(w, ask, ANSWER_MS);
    if (answer) return [...out, `after the window's resize from ${size(OPENING)} to ${size(SMALL)}, with ${outside.join(', ')} outside the window, a click on the card answered ${answerNamed(ask, answer)}: the card took no notice of resize. The clicks came ${clicks} after it`];
    if (got.clicks.length < 3) blocked(`only ${got.clicks.length} clicks reached the card within ${Math.max(...MARKS)} ms of the resize: ${clicks}`);
    const stale = got.reads.filter((r) => r.ms > DRAWN_MS && r.value === 'armed');
    if (stale.length) out.push(`after the window's resize from ${size(OPENING)} to ${size(SMALL)} the card for ${named} reads armed ${Math.round(stale[0]!.ms)} ms on, with ${outside.join(', ')} outside the window`);

    // The same card in its window made as it was: armed, and a click answers.
    await app.place(...OPENING);
    await app.front();
    out.push(...(await control(app, w, ask, await app.armed(ask, `back in a ${size(OPENING)} window`), `back in a ${size(OPENING)} window`)));
    return out;
  } finally {
    await app.stop();
  }
}

describe(`AC2 ${ID.resized} in the real app, a card the window shrank past answers nothing`, () => {
  it(`AC2 ${ID.resized} armed at 960×640, then resized to 700×400 with part of it outside the window, it doesn't arm and no click on it answers`, async () => {
    expect(await resizedFailures()).toEqual([]);
  }, 60 * MIN);

  it(`AC2 ${ID.resized} wrong program: a card that ignores resize answers, and fails naming it`, async () => {
    expect((await resizedFailures(plantOf('resize'))).join('\n'), `the planted card (README, Plants: ${plantOf('resize')}) answers the click`).toMatch(/after the window's resize from 960×640 to 700×400, .* a click on the card answered ask:.*took no notice of resize/s);
  }, 60 * MIN);
});

// ---- AC3: the click that brings the window forward.

const FIRST: AskSpec = { title: 'Cart totals', question: 'Which store keeps the cart?', options: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }] };
const SECOND: AskSpec = { title: 'Release notes', question: 'Which format do the release notes take?', options: [{ id: 'markdown', label: 'Markdown', decision: 'none' }, { id: 'plain', label: 'Plain text', decision: 'none' }] };

async function raisedFailures(plant?: string): Promise<string[]> {
  await realWindowAccess();
  const w = await makeWorld([FIRST, SECOND]);
  const [first, second] = w.asks as [Ask, Ask];
  const app = await App.launch(w, plant);
  try {
    const out: string[] = [];
    // The control: the first ask's card, its window active and unmoved. Answered, it makes way for the second's.
    out.push(...(await control(app, w, first, await app.armed(first, 'in the active window'), 'in the active window')));
    if (out.length) return out;
    await app.armed(second, 'in the active window');

    const other = await otherAppForward(app);
    try {
      // Armed behind another app: what the click lands on. A card that won't arm there can't be armed, and is pressed all the same.
      const card = await app.card('armed', 'any', 10);
      if (card.front) blocked('the app came forward by itself, so the click wouldn\'t bring it forward');
      const option = card.options[1] ?? blocked(`the inactive window shows no second option of ${second.handle}`);
      const raised = await app.raise(middle(option.frame), option.id);
      if (!raised.front) blocked(`the click on ${option.id} didn't bring the app forward, so it isn't the click the criterion names`);
      const answer = await answered(w, second, ANSWER_MS);
      if (answer) return [...out, `the click that brought the inactive window forward (activation), landing on ${raised.pressed} of a card that read ${String(raised.was)}, answered ${answerNamed(second, answer)}: the card took no notice of activation`];
      console.log(`AC3 the cursor was taken for ${Math.round(raised.took_ms)} ms and is ${raised.cursor_back ? 'back where it was' : 'not back where it was'}; the card read ${String(raised.was)} under it`);
    } finally {
      await other.stop();
    }
    // Forward now, the card arms again and a click on it answers.
    await app.front();
    out.push(...(await control(app, w, second, await app.armed(second, 'once the window was brought forward'), 'once the window was brought forward')));
    return out;
  } finally {
    await app.stop();
  }
}

describe(`AC3 ${ID.raised} in the real app, the click that brings the inactive window forward answers nothing`, () => {
  it(`AC3 ${ID.raised} a click on an armed card's option in an inactive window brings it forward and answers nothing`, async () => {
    expect(await raisedFailures()).toEqual([]);
  }, 60 * MIN);

  it(`AC3 ${ID.raised} wrong program: a card that ignores activation answers, and fails naming it`, async () => {
    expect((await raisedFailures(plantOf('activation'))).join('\n'), `the planted card (README, Plants: ${plantOf('activation')}) answers the click`).toMatch(/the click that brought the inactive window forward \(activation\), landing on card-option:\w+ .* answered ask:/s);
  }, 60 * MIN);
});
