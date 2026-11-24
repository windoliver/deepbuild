// AC1, AC2 and AC6: the card's accepting option arms only once each picture its evidence lists was drawn whole inside
// the window at half its pixel size or more for the arming interval. One world, a real hub's record (README, The
// fixtures): `four`, a taste ask whose manifest lists four 800 × 700 pictures, two of which the window draws below the
// fold; `wide`, one whose manifest lists one 1512 × 982 screenshot. The replica on a copy of that record at the
// reference window, on its virtual clock; what was drawn is the replica's snapshots (helpers.ts `Trace`).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCEPT, ARM_AFTER_MS, askOf, cleanup, drawnIn, ID, isArmed, leftOf, look, makeWorld, manifestOf, MIN, named, openOn, optionOf, PLANT, press,
  replicaOf, said, scrollPictures, sent, Trace, ulidNow, waitFor, wordsOf, type Snapshot, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
let world: World;
/** AC6's manifests: the four pictures with the one at each index replaced by the spare picture. */
const replaced: string[] = [];
beforeAll(async () => {
  world = await makeWorld([
    { key: 'header', title: 'Header layout', asks: [{ key: 'four', question: 'Does the new header look right on all four pages?', pictures: [[800, 700], [800, 700], [800, 700], [800, 700]], spare: [[800, 700]] }] },
    { key: 'hero', title: 'Hero image', asks: [{ key: 'wide', question: 'Does the checkout screenshot look right?', pictures: [[1512, 982]] }] },
  ], {
    more: async (_s, w) => {
      const four = askOf(w, 'four');
      for (const i of four.pictures.keys()) replaced.push(await w.put(manifestOf(four.pictures.map((p, k) => (k === i ? four.spare[0]! : p))), 'taste.pictures'));
    },
  });
}, 30 * MIN);

const cardOf = (handle: string, question: string): string => `the card for ${handle} ("${question}")`;

// ---- AC1: four pictures, two below the fold.

interface FoldRun { failures: string[]; below: string[] }
async function foldRun(plant?: string): Promise<FoldRun> {
  const ask = askOf(world, 'four');
  const card = cardOf(ask.handle, ask.question);
  const trace = new Trace(ask.pictures);
  const out: string[] = [];
  let below: string[] = [];
  /** The accepting option read armed while a picture was never drawn whole at half its size: the plant's catch. */
  const armedEarly = (s: Snapshot): void => {
    if (!isArmed(optionOf(s, ACCEPT)) || out.some((f) => f.includes('armed with pictures not shown'))) return;
    const never = ask.pictures.filter((p) => trace.neverHalf(p.sha)).map((p) => p.sha);
    if (never.length) out.push(`${card}'s accepting option armed with pictures not shown: ${never.join(', ')}`);
  };
  const r = await replicaOf(world, plant ? { plant } : {});
  try {
    await openOn(r, ask.handle, trace);
    await r.wait(ARM_AFTER_MS + 200);
    let x = await look(r);
    trace.add(x.t, x.s);
    if (!drawnIn(x.s, ask.pictures).size) return { failures: [`${card} draws none of its four pictures (no node picture:<sha256> for ${named(ask.pictures.map((p) => p.sha))})`], below };
    below = ask.pictures.filter((p) => trace.never(p.sha)).map((p) => p.sha);
    armedEarly(x.s);
    const shown = ask.pictures.filter((p) => trace.shown(p.sha));
    if (shown.length !== 2 || below.length !== 2) out.push(`the fixture's premise doesn't hold: ${card} must draw two of its four pictures whole and two below the fold; it shows ${named(shown.map((p) => p.sha)) || 'none'} and draws ${below.length} never whole`);
    const option = optionOf(x.s, ACCEPT);
    if (!option) return { failures: [...out, `${card} draws no accepting option (card-option:${ACCEPT})`], below };
    const left = leftOf(x.s, option);
    if (left?.[0] !== 2 || left[1] !== 4) out.push(`${card}'s accepting option must read that 2 of 4 are not shown yet; it reads ${JSON.stringify(wordsOf(x.s, option))}`);
    // A press on it, not armed, writes nothing.
    const before = sent(x.hub, ask.handle).length;
    await press(r, { id: `card-option:${ACCEPT}` }, `a press on ${card}'s accepting option before its pictures were shown`);
    await r.wait(300);
    x = await look(r);
    trace.add(x.t, x.s);
    if (sent(x.hub, ask.handle).length !== before) out.push(`a press on ${card}'s accepting option with 2 of 4 pictures not shown wrote an answer: ${said(sent(x.hub, ask.handle))}`);
    // Both scrolled into view for the arming interval: it arms, and the answer is taken.
    await scrollPictures(r, trace, () => ask.pictures.every((p) => trace.shown(p.sha)), armedEarly);
    const missing = ask.pictures.filter((p) => !trace.shown(p.sha)).map((p) => p.sha);
    if (missing.length) return { failures: [...out, `the wheel over ${card}'s pictures never drew ${named(missing)} whole at half its size or more for the arming interval`], below };
    x = await waitFor(r, (s) => isArmed(optionOf(s, ACCEPT)));
    if (!isArmed(optionOf(x.s, ACCEPT))) return { failures: [...out, `${card}'s accepting option never armed after all four pictures were shown: it reads ${said(optionOf(x.s, ACCEPT)?.value)} "${wordsOf(x.s, optionOf(x.s, ACCEPT))}"`], below };
    await press(r, { id: `card-option:${ACCEPT}` }, `a press on ${card}'s accepting option, armed`);
    await r.wait(300);
    x = await look(r);
    const answers = sent(x.hub, ask.handle);
    if (answers.length !== 1 || answers[0]!.option !== ACCEPT) out.push(`${card}, armed, must take one answer with ${ACCEPT}; the app sent ${said(answers)}`);
  } finally {
    await r.stop();
  }
  return { failures: out, below };
}

describe(`AC1 ${ID.fold} the accepting option waits for the pictures below the fold`, () => {
  it(`AC1 ${ID.fold}: in a replica, a taste ask with four pictures, two below the fold, presents its accepting option not armed reading that 2 of 4 are not shown yet; a press on it writes nothing; once both are scrolled into view for the arming interval it arms and the answer is taken`, async () => {
    expect((await foldRun()).failures).toEqual([]);
  }, 30 * MIN);

  it(`AC1 ${ID.fold} wrong program: a planted card that arms at presentation fails, naming the two hashes`, async () => {
    const run = await foldRun(PLANT.armsAtPresentation);
    const caught = run.failures.find((f) => f.includes('armed with pictures not shown: '));
    expect(caught, `the planted card (README, Plants: ${PLANT.armsAtPresentation}) wasn't caught: ${run.failures.join(' | ')}`).toBeDefined();
    const shas = caught!.split('armed with pictures not shown: ')[1]!.split(', ');
    expect(run.below.length, 'two pictures sat below the fold').toBe(2);
    expect([...shas].sort(), 'the failure names the two hashes below the fold').toEqual([...run.below].sort());
  }, 30 * MIN);
});

// ---- AC2: a screenshot drawn small doesn't count; opened at half size or more, it does.

async function smallRun(plant?: string): Promise<string[]> {
  const ask = askOf(world, 'wide');
  const [p] = ask.pictures;
  const card = cardOf(ask.handle, ask.question);
  const trace = new Trace(ask.pictures);
  const r = await replicaOf(world, plant ? { plant } : {});
  const out: string[] = [];
  try {
    await openOn(r, ask.handle, trace);
    await r.wait(3 * ARM_AFTER_MS);
    let x = await look(r);
    trace.add(x.t, x.s);
    if (trace.never(p!.sha)) return [`${card} never draws its screenshot ${p!.sha} whole inside the window (no node picture:<sha256>)`];
    if (!trace.neverHalf(p!.sha)) return [`the fixture's premise doesn't hold: ${card} draws ${p!.sha} at scale ${trace.scale(p!.sha).toFixed(3)} from the start, so the small draw the criterion names (96 px of 1512) never happened`];
    const small = trace.scale(p!.sha);
    const option = optionOf(x.s, ACCEPT);
    if (isArmed(option)) out.push(`${card}'s accepting option armed while ${p!.sha} was drawn only at scale ${small.toFixed(3)} (${Math.round(small * p!.size[0])} px of ${p!.size[0]})`);
    const left = leftOf(x.s, option);
    if (left?.[0] !== 1 || left[1] !== 1) out.push(`${card}'s accepting option must read that 1 of 1 is not shown yet while ${p!.sha} is drawn ${Math.round(small * p!.size[0])} px wide; it reads ${JSON.stringify(wordsOf(x.s, option))}`);
    // Opened: a press on the picture draws it at half its size or more.
    await press(r, { id: `picture:${p!.sha}` }, `a press on ${card}'s screenshot, which opens it`);
    x = await look(r);
    trace.add(x.t, x.s);
    await r.wait(ARM_AFTER_MS + 200);
    x = await look(r);
    trace.add(x.t, x.s);
    if (!trace.shown(p!.sha)) return [...out, `opening ${p!.sha} doesn't draw it whole inside the window at half its size or more: its largest whole draw is scale ${trace.scale(p!.sha).toFixed(3)}`];
    x = await waitFor(r, (s) => isArmed(optionOf(s, ACCEPT)));
    if (!isArmed(optionOf(x.s, ACCEPT))) out.push(`${card}'s accepting option never armed after ${p!.sha} was opened at scale ${trace.scale(p!.sha).toFixed(3)}: it reads ${said(optionOf(x.s, ACCEPT)?.value)} "${wordsOf(x.s, optionOf(x.s, ACCEPT))}"`);
  } finally {
    await r.stop();
  }
  return out;
}

describe(`AC2 ${ID.small} a screenshot drawn small isn't shown; opened at half size or more, it is`, () => {
  it(`AC2 ${ID.small}: a 1512 × 982 screenshot drawn small doesn't count as shown, and the same picture opened at half size or more does`, async () => {
    expect(await smallRun()).toEqual([]);
  }, 30 * MIN);

  it(`AC2 ${ID.small} wrong program: a planted card that counts the small draw fails, naming the picture and the scale`, async () => {
    const sha = askOf(world, 'wide').pictures[0]!.sha;
    const failures = (await smallRun(PLANT.countsSmallDraw)).join('\n');
    expect(failures, `the planted card (README, Plants: ${PLANT.countsSmallDraw}) wasn't caught naming the picture and its scale`).toMatch(new RegExp(`armed while ${sha} was drawn only at scale 0\\.\\d{3}`));
  }, 30 * MIN);
});

// ---- AC6: a picture replaced under a presented card.

describe(`AC6 ${ID.replaced} a picture replaced by a new hash counts as not shown again`, () => {
  it(`AC6 ${ID.replaced}: a picture replaced under a presented card, by a new hash, returns the option to not armed with 1 left`, async () => {
    const ask = askOf(world, 'four');
    const card = cardOf(ask.handle, ask.question);
    const trace = new Trace([...ask.pictures, ...ask.spare]);
    const r = await replicaOf(world);
    try {
      await openOn(r, ask.handle, trace);
      await r.wait(ARM_AFTER_MS + 200);
      const first = await look(r);
      trace.add(first.t, first.s);
      expect(drawnIn(first.s, ask.pictures).size, `${card} draws its pictures (nodes picture:<sha256>)`).toBeGreaterThan(0);
      const s = await scrollPictures(r, trace, () => ask.pictures.every((p) => trace.shown(p.sha)));
      expect(ask.pictures.filter((p) => !trace.shown(p.sha)).map((p) => p.sha), `the wheel shows each of ${card}'s pictures`).toEqual([]);
      const armed = await waitFor(r, (x) => isArmed(optionOf(x, ACCEPT)));
      expect(isArmed(optionOf(armed.s, ACCEPT)), `${card}'s accepting option arms once its four pictures were shown: it reads "${wordsOf(armed.s, optionOf(armed.s, ACCEPT))}"`).toBe(true);
      // The picture to replace: one the window no longer draws whole, so the new one stays not shown while it's read.
      const now = drawnIn(s, ask.pictures);
      const at = Math.max(0, ask.pictures.findIndex((p) => !now.get(p.sha)?.whole));
      const event = { v: 1, id: ulidNow(), kind: 'ask.moved', writer: 'core', actor: 'you', scope: 'you', subject: ask.handle, data: { pinned_to: { kind: 'evidence', ref: replaced[at]! } } };
      await r.feed(ask.session, event);
      const after = await look(r);
      const option = optionOf(after.s, ACCEPT);
      expect(isArmed(option), `${card}'s accepting option must return to not armed once ${ask.pictures[at]!.sha} is replaced by ${ask.spare[0]!.sha} (ask.moved, README Pinned 1)`).toBe(false);
      expect(leftOf(after.s, option), `${card}'s accepting option must read that 1 of 4 is not shown yet; it reads ${JSON.stringify(wordsOf(after.s, option))}`).toEqual([1, 4]);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);
});
