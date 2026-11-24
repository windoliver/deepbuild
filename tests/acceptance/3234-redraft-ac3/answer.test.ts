// AC3 and AC4, redrafted blind (README): Send back needs none of the pictures, and the answer's record says, for each
// picture, what the window drew. The original's world, fixtures, numbers, surfaces, trace rule and plants
// (`../3234/answer.test.ts`, `../3234/README.md`), with one change: the words go where an ask's page takes them, the
// box at its foot (#1461), the keyboard put there by ⌘N and the words typed (#1462 AC11), never typed on the card,
// where a letter writes nothing (#1462 AC8). Three of the four pictures are scrolled into view for the arming interval
// and the fourth never is; then ⌘N, the words, and Send back pressed on the card. What the app sent its hub goes to the
// real hub signed as the app signs it (#1101's `asApp`), and the hub's record is read back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  answersOf, ARM_AFTER_MS, askOf, BACK, byId, cleanup, entriesOf, eventsOf, forward, ID, look, makeWorld, MIN, msOf, named, openOn, PLANT,
  press, replicaOf, said, scrollPictures, sent, Trace, typeWords, type Ask, type Line, type World,
} from '../3234/helpers.ts';

afterAll(cleanup, 60_000);
const FOUR: [number, number][] = [[800, 700], [800, 700], [800, 700], [800, 700]];
let world: World;
beforeAll(async () => {
  world = await makeWorld(['clean', 'refuses', 'marks'].map((key) => ({ key, title: `Footer spacing (${key})`, asks: [{ key, question: `Does the footer look right (${key})?`, pictures: FOUR }] })));
}, 30 * MIN);

const WORDS = 'the footer still overlaps the last row';
const cardOf = (ask: Ask): string => `the card for ${ask.handle} ("${ask.question}")`;

interface BackRun { failures: string[]; trace: Trace; params: Line | undefined; end: { from: number; to: number }; unseen: string | undefined }
/** Three pictures shown, the fourth never; ⌘N and the words typed in the page's box; Send back pressed, as your hardware presses it. */
async function backRun(ask: Ask, plant?: string): Promise<BackRun> {
  const card = cardOf(ask);
  const trace = new Trace(ask.pictures);
  const out: string[] = [];
  const r = await replicaOf(world, plant ? { plant } : {});
  let end = { from: 0, to: 0 };
  let params: Line | undefined;
  try {
    await openOn(r, ask.handle, trace);
    await r.wait(ARM_AFTER_MS + 200);
    let x = await look(r);
    trace.add(x.t, x.s);
    const shownCount = (): number => ask.pictures.filter((p) => trace.shown(p.sha)).length;
    if (shownCount() < 3) await scrollPictures(r, trace, () => shownCount() >= 3);
    const never = ask.pictures.filter((p) => trace.never(p.sha)).map((p) => p.sha);
    if (shownCount() !== 3 || never.length !== 1) {
      return { failures: [`the fixture's premise doesn't hold: three of ${card}'s pictures must be shown and one never drawn whole; shown ${named(ask.pictures.filter((p) => trace.shown(p.sha)).map((p) => p.sha)) || 'none'}, never drawn whole ${named(never) || 'none'}`], trace, params, end, unseen: never[0] };
    }
    // The words go where an ask's page takes them: ⌘N puts the keyboard in the box at the page's foot (#1461, #1462
    // Pinned 7), and `act type` types them there. One action between two samples (README of #3234, Readings 2).
    await r.press('cmd-n');
    x = await look(r);
    trace.add(x.t, x.s);
    await typeWords(r, WORDS);
    x = await look(r);
    trace.add(x.t, x.s);
    const box = { focus: x.s.focus ?? null, value: byId(x.s, 'box-draft')?.value ?? null };
    const from = msOf(r);
    await press(r, { id: `card-option:${BACK}` }, `a press on ${card}'s Send back`);
    end = { from, to: msOf(r) };
    await r.wait(300);
    x = await look(r);
    const answers = sent(x.hub, ask.handle);
    if (!answers.length) out.push(`${card} refused Send back with words while ${never[0]} wasn't shown: the app sent no answer`);
    else if (answers.length > 1) out.push(`${card} sent ${answers.length} answers for one Send back: ${said(answers)}`);
    params = answers[0];
    if (params && (params.option !== BACK || params.words !== WORDS)) out.push(`${card}'s Send back must send option ${BACK} with the words typed in its page's box (after ⌘N the keyboard was on ${said(box.focus)} and the box read ${said(box.value)}); it sent ${said(params)}`);
    return { failures: out, trace, params, end, unseen: never[0] };
  } finally {
    await r.stop();
  }
}

/** The answer's record against the replica's trace (README of #3234, Pinned 4 and Readings 2): four entries in the manifest's order. */
function recordFailures(ask: Ask, run: BackRun, answered: Line | undefined): string[] {
  const entries = entriesOf(answered as never);
  if (!entries) return [`the record of ${ask.handle}'s answer holds no per-picture entries (data.pictures): ${said(answered?.data, 600)}`];
  const out: string[] = [];
  if (entries.length !== 4) out.push(`the record of ${ask.handle}'s answer holds ${entries.length} entries, not four: ${said(entries, 600)}`);
  for (const p of ask.pictures) {
    const e = entries.find((x) => x.sha256 === p.sha);
    if (!e) { out.push(`the record of ${ask.handle}'s answer has no entry for ${p.sha}`); continue; }
    const shown = run.trace.shown(p.sha);
    if (e.shown !== shown) out.push(shown ? `the record of ${ask.handle} marks ${p.sha} not shown, which the replica drew whole at half its size or more for the arming interval` : `the record of ${ask.handle} marks ${p.sha} shown, which the replica never drew whole at half its size or more`);
    const scale = run.trace.scale(p.sha);
    if (typeof e.scale !== 'number' || Math.abs(e.scale - scale) > 0.01) out.push(`the record of ${ask.handle} gives ${p.sha} the largest scale ${said(e.scale)}; the replica drew it whole at most at ${scale.toFixed(3)}`);
    const { lo, hi } = run.trace.ms(p.sha, run.end);
    if (typeof e.ms !== 'number' || !Number.isInteger(e.ms) || e.ms < lo - 50 || e.ms > hi + 50) out.push(`the record of ${ask.handle} gives ${p.sha} ${said(e.ms)} ms on screen; the replica's trace bounds it to ${Math.round(lo)}–${Math.round(hi)} ms`);
  }
  const order = entries.map((x) => x.sha256);
  if (order.join() !== ask.pictures.map((p) => p.sha).join() && out.length === 0) out.push(`the record of ${ask.handle} lists its entries out of the manifest's order: ${named(order)}`);
  return out;
}

/** The clean run: its card's Send back, what the hub recorded, and that record's failures. */
let clean: Promise<{ run: BackRun; refused: string | undefined; answered: Line[] }> | undefined;
const cleanRun = (): NonNullable<typeof clean> => (clean ??= (async () => {
  const ask = askOf(world, 'clean');
  const run = await backRun(ask);
  const refused = run.params ? await forward(world, run.params) : undefined;
  return { run, refused, answered: answersOf(await eventsOf(world), ask.handle) as Line[] };
})());

describe(`AC3 ${ID.back} Send back needs none of the pictures`, () => {
  // Fails on: the base (no picture drawn: the premise); a card that holds Send back while a picture is left
  // (refuses-send-back, the next test); a card that drops the box's words or sends twice; a hub that refuses the app's
  // answer, records it twice, without the words or from elsewhere than the card.
  it(`AC3 ${ID.back}: with one of four pictures never shown, Send back with words is accepted and reaches the agent once`, async () => {
    const ask = askOf(world, 'clean');
    const { run, refused, answered } = await cleanRun();
    expect(run.failures, `${cardOf(ask)}'s Send back`).toEqual([]);
    expect(refused, `the hub takes the app's Send back for ${ask.handle}, signed as the app signs it`).toBeUndefined();
    expect(answered.map((e) => [e.data?.option ?? e.data?.answer, e.data?.words, e.data?.via]), `the hub records ${ask.handle}'s Send back once, with the words, from the card`).toEqual([[BACK, WORDS, 'card']]);
  }, 30 * MIN);

  it(`AC3 ${ID.back} wrong program: a planted card that refuses it fails, naming the ask`, async () => {
    const ask = askOf(world, 'refuses');
    const run = await backRun(ask, PLANT.refusesSendBack);
    expect(run.failures.join('\n'), `the planted card (README of #3234, Plants: ${PLANT.refusesSendBack}) wasn't caught naming the ask`).toContain(`the card for ${ask.handle} ("${ask.question}") refused Send back with words`);
  }, 30 * MIN);
});

describe(`AC4 ${ID.record} the answer's record holds what was drawn`, () => {
  // Fails on: the base (no picture drawn: the premise; and no entries); a recorder that marks every picture shown
  // (marks-all-shown, the next test); entries missing, out of the manifest's order, or whose scale or ms the trace
  // doesn't bound.
  it(`AC4 ${ID.record}: the answer's record holds four entries, each with shown, the largest scale and the milliseconds on screen, equal to the replica's trace of what was drawn`, async () => {
    const ask = askOf(world, 'clean');
    const { run, refused, answered } = await cleanRun();
    expect(run.failures, `${cardOf(ask)}'s Send back`).toEqual([]);
    expect(refused, `the hub takes the app's Send back for ${ask.handle}`).toBeUndefined();
    expect(answered.length, `the hub records one answer for ${ask.handle}`).toBe(1);
    expect(recordFailures(ask, run, answered[0])).toEqual([]);
  }, 30 * MIN);

  it(`AC4 ${ID.record} wrong program: a planted recorder that marks every picture shown fails, naming the one that never was`, async () => {
    const ask = askOf(world, 'marks');
    const run = await backRun(ask, PLANT.marksAllShown);
    expect(run.failures, `${cardOf(ask)}'s Send back, planted`).toEqual([]);
    expect(await forward(world, run.params!), `the hub takes the planted app's Send back for ${ask.handle}`).toBeUndefined();
    const failures = recordFailures(ask, run, answersOf(await eventsOf(world), ask.handle)[0] as Line | undefined);
    expect(failures.join('\n'), `the planted recorder (README of #3234, Plants: ${PLANT.marksAllShown}) wasn't caught naming the picture that never was shown`).toContain(`marks ${run.unseen} shown, which the replica never drew whole`);
  }, 30 * MIN);
});
