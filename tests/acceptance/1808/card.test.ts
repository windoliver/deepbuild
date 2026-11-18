// AC5 and AC8: every card can arm. One world, a real hub's record: a push approval whose plan is 30 steps (helpers.ts
// `THIRTY`), the older ask, so the window opens on it; and a choice with twelve options (`TWELVE`). The replica on a copy
// of that record at 960×640, on its virtual clock; a press on the card is #124's click, which counts once the OS confirms
// you through `test-confirm`'s file, as #1461's suite answers; what the app sent its hub is `see`'s `hub` (#1462). An
// option or a step is shown when a person sees it: wholly inside the window and the page, its words drawn (`showing`).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  askAt, askOf, byId, cleanup, cross, flat, HOLD_STILL, ID, makeWorld, MIN, OPENING, pageView, PLANT, replicaOf, saying, showing,
  THIRTY, TWELVE, windowBox, type Replica, type SessionSpec, type Snapshot, type World, type WorldAsk,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const SPECS: SessionSpec[] = [
  { key: 'push', project: 'shop', title: 'Release 2.4', state: 'finished', asks: [THIRTY] },
  { key: 'theme', project: 'shop', title: 'Theme picker', state: 'finished', asks: [TWELVE] },
  { key: 'docs', project: 'docs', title: 'Release notes', state: 'finished' },
];
let world: World;
beforeAll(async () => { world = await makeWorld(SPECS); }, 15 * MIN);

const CARD = 'question-card';
const stateOf = (s: Snapshot): string => String(byId(s, CARD)?.value ?? 'no card');
/** What of the page is on screen. */
const view = (s: Snapshot): number[] => cross(pageView(s) ?? windowBox(s), windowBox(s));
const answersTo = (calls: { method: string; params?: Record<string, any> }[], ask: WorldAsk): { method: string; params?: Record<string, any> }[] =>
  calls.filter((c) => c.method === 'ask.answer' && c.params?.ask === ask.handle);

/** The wheel over the card's rows until `done` holds or the wheel moves nothing: over the shown row nearest the page's middle. */
async function scrollCard(r: Replica, rows: RegExp, done: (s: Snapshot) => boolean): Promise<Snapshot> {
  let s = (await r.see()).snapshot;
  let before = '';
  for (let turn = 0; turn < 60 && !done(s); turn++) {
    const box = view(s);
    const shown = flat(s.tree).filter((n) => rows.test(String(n.id)) && showing(s, n, box));
    const key = shown.map((n) => `${String(n.id)}@${n.bounds[1]}`).join(' ');
    if (!shown.length || key === before) break;
    before = key;
    const middle = box[1]! + box[3]! / 2;
    const at = shown.sort((a, b) => Math.abs(a.bounds[1]! - middle) - Math.abs(b.bounds[1]! - middle))[0]!;
    await r.scroll({ id: String(at.id) }, Math.max(40, Math.round(box[3]! / s.window.scale / 2)));
    s = (await r.see()).snapshot;
  }
  return s;
}

// ---- AC5: the 30-row approval.

async function longCardFailures(plant?: string): Promise<string[]> {
  const ask = askOf(world, 'push');
  const named = `the card for ${ask.handle} ("${ask.question}")`;
  const allow = ask.options.find((o) => o.decision === 'allow')!;
  const r = await replicaOf(world, OPENING, plant);
  const out: string[] = [];
  try {
    const opened = await r.see();
    if (opened.address !== askAt(ask.handle)) return [`the window opens on ${String(opened.address)}, not the approval ${askAt(ask.handle)}`];
    if (!byId(opened.snapshot, CARD)) return [`${named} isn't shown on its page`];
    // A press 2 s after the card is shown (the window drew it in its first frames, a second ago), before anything else:
    // on its allow option, which a long card holds back.
    await r.wait(1050);
    await r.click({ id: `card-option:${allow.id}` }, `a press on ${named}'s option "${allow.label}" 2 s after it was shown`);
    await r.wait(300);
    let seen = await r.see();
    const still = saying(seen.snapshot, HOLD_STILL);
    if (still.length) out.push(`${named} reads "${HOLD_STILL}" after a press 2 s after it was shown: ${still.slice(0, 2).join('; ')}`);
    if (!answersTo(seen.hub, ask).length) {
      // Not answered yet: its rows to their end, its last step shown, then it arms and takes the answer.
      const last = `card-step:${THIRTY.steps!.length - 1}`;
      const s = await scrollCard(r, /^card-step:\d+$/, (x) => stateOf(x) === 'armed' || showing(x, byId(x, last), view(x)));
      if (!showing(s, byId(s, last), view(s)) && stateOf(s) !== 'armed') out.push(`${named} never shows its last row (${last}) to the wheel over its rows`);
      let state = stateOf(s);
      for (let waited = 0; state !== 'armed' && waited < 3000; waited += 250) {
        await r.wait(250);
        state = stateOf((await r.see()).snapshot);
      }
      if (state !== 'armed') out.push(`${named} never armed: 3 s after its last row was shown it reads ${JSON.stringify(state)}`);
      else {
        await r.click({ id: `card-option:${allow.id}` }, `a press on ${named}'s option "${allow.label}"`);
        await r.wait(500);
        seen = await r.see();
        const again = saying(seen.snapshot, HOLD_STILL);
        if (again.length) out.push(`${named} reads "${HOLD_STILL}" after a press on it armed: ${again.slice(0, 2).join('; ')}`);
      }
    }
    if (answersTo(seen.hub, ask).length !== 1) out.push(`${named} took ${answersTo(seen.hub, ask).length} answers, not one: the app sent ${JSON.stringify(seen.hub.map((c) => c.method))}`);
  } finally {
    await r.stop();
  }
  return out;
}

describe(`AC5 ${ID.card} every card can arm`, () => {
  it(`AC5 ${ID.card}: at 960×640, a fixture approval card with 30 rows arms and takes an answer, and a press 2 s after a card is shown never reads "Hold still"`, async () => {
    expect(await longCardFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC5 ${ID.card} wrong program: a planted card that grows past its slot and stays unarmed fails, naming the ask`, async () => {
    const ask = askOf(world, 'push');
    expect((await longCardFailures(PLANT.cardGrows)).join('\n'), 'the planted card (README, Surface choices: card-grows-past-slot)').toContain(`the card for ${ask.handle} ("${ask.question}") never armed`);
  }, 30 * MIN);
});

// ---- AC8: twelve options, three folded behind a count.

async function foldFailures(plant?: string): Promise<string[]> {
  const ask = askOf(world, 'theme');
  const named = `the card for ${ask.handle} ("${ask.question}")`;
  const label = (id: string): string => ask.options.find((o) => `card-option:${o.id}` === id)?.label ?? id;
  const options = ask.options.map((o) => `card-option:${o.id}`);
  const shownEver = new Set<string>();
  const look = (s: Snapshot): string[] => {
    const box = view(s);
    const now = options.filter((id) => showing(s, byId(s, id), box));
    now.forEach((id) => shownEver.add(id));
    return now;
  };
  /** The card reads armed: every option must have been shown by now. */
  const armedWithout = (s: Snapshot): string[] => {
    if (stateOf(s) !== 'armed') return [];
    const never = options.filter((id) => !shownEver.has(id));
    return never.length ? [`${named} armed with options never shown: ${never.map(label).join(', ')}`] : [];
  };
  const r = await replicaOf(world, OPENING, plant);
  try {
    await r.open(askAt(ask.handle));
    await r.wait(2000);
    let s = (await r.see()).snapshot;
    const shown = look(s);
    const early = armedWithout(s);
    if (early.length) return early;
    const fold = byId(s, 'card-fold');
    const out: string[] = [];
    if (shown.length !== 9) out.push(`${named} shows ${shown.length} of its 12 options before its fold is opened, not 9 with three folded`);
    if (!fold || !showing(s, fold, view(s))) return [...out, `${named} folds no options behind a count: it shows no fold (card-fold, README, Surface choices)`];
    if (!/\b3\b/.test(`${fold.name ?? ''} ${typeof fold.value === 'string' ? fold.value : ''}`)) out.push(`${named}'s fold doesn't say how many options it holds, 3: it reads ${JSON.stringify(fold.name)} valued ${JSON.stringify(fold.value)}`);
    if (stateOf(s) === 'armed') out.push(`${named} armed before its fold was opened`);
    await r.click({ id: 'card-fold' }, `a press on ${named}'s fold`);
    // Opened: each option shown, scrolling the card's options where they don't all fit, then it arms.
    for (let waited = 0; waited <= 4000; waited += 250) {
      s = (await r.see()).snapshot;
      look(s);
      if (shownEver.size < options.length) s = await scrollCard(r, /^card-option:/, (x) => { look(x); return shownEver.size === options.length; });
      const without = armedWithout(s);
      if (without.length) return [...out, ...without];
      if (stateOf(s) === 'armed') return out;
      await r.wait(250);
    }
    return [...out, `${named} never armed after its fold was opened: it reads ${JSON.stringify(stateOf(s))}`];
  } finally {
    await r.stop();
  }
}

describe(`AC8 ${ID.fold} folded options are opened before the card arms`, () => {
  it(`AC8 ${ID.fold}: a 12-option card with three options folded arms only after the fold was opened`, async () => {
    expect(TWELVE.options!.length).toBe(12);
    expect(await foldFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC8 ${ID.fold} wrong program: a planted card that arms with options never shown fails, naming them`, async () => {
    const failures = (await foldFailures(PLANT.armsFolded)).join('\n');
    const named = /armed with options never shown: (.+)$/m.exec(failures);
    expect(named, `the planted card (README, Surface choices: card-arms-folded) arms with its fold closed: ${failures}`).not.toBeNull();
    const labels = named![1]!.split(', ');
    expect(labels.length, 'the three folded options are named').toBe(3);
    for (const l of labels) expect(TWELVE.options!.map((o) => o.label), 'each named option is one of the card\'s').toContain(l);
  }, 30 * MIN);
});
