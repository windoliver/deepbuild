// Criterion 1 (README: Criterion 1): in a seeded replica journey of record events, clock steps, hovers and resizes, the
// replica draws only when the window is dirty, and after each step a forced frame's snapshot equals the last drawn one. A
// planted view that reads a thread-local with no notify (DEEP_HUB_PLANT=record-in-thread-local) fails, naming the view,
// the node and the step. The replica is `deep-drive` launched with frames: "dirty"; every count, comparison and finding
// below is its own, read from `close`'s frames report and from `see`, which reads the last frame the window drew.
import { afterAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_ASKS, FRAME, PLANT, Replica, SESSION, askCreated, buildDrive, cleanup, eventId, fed, journey, journeyProblems, names,
  requireMacos, run, said, stepOf, type Finding, type Frames, type Obj, type Spec,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const LONG = 1_900_000; // the first test may build deep-drive (up to 30 minutes)

const QUESTION = 'Raised while nobody touched the window: ship 1546?';

/** One ask raised on the record and nothing else: the record's change, the drawn frame after it, and a still frame. */
async function oneAsk(hub?: string): Promise<{ frames: Frames; drawn: string[] }> {
  requireMacos();
  buildDrive();
  const replica = await Replica.open(hub ? { hub } : {});
  try {
    await replica.feed(SESSION.asks, askCreated(eventId(1, 1), QUESTION)); // step 1
    const drawn = names(await replica.see()); // step 2
    await replica.by(FRAME); // step 3
    return { frames: await replica.close(), drawn };
  } finally {
    await replica.stop();
  }
}

// The planted tests' reading of a finding since #1461 (REDRAFT.md). The list draws Needs you as its first section: the
// heading with the one count, then a row per open ask named by its question. The panel names stay, so the view that draws
// the section is `deepbuild/sidebar`, or `deepbuild/needs-you` where that registered view fills it.
const LIST_VIEW = /(^|\/)(sidebar|needs-you)$/;
/** Every whole number a node's name and value read. */
const numbersOf = (node: Obj | null | undefined): number[] =>
  `${String(node?.name ?? '')} ${String(node?.value ?? '')}`.match(/\d+/g)?.map(Number) ?? [];
/** A finding names the ask raised at its step: its row (named by `question`), or the one count reading `count` open asks. */
const namesAsk = (f: Finding, question: string, count: number): boolean =>
  String(f.node.name ?? '').includes(question)
  || (!String(f.node.name ?? '').includes('?') && numbersOf(f.node).includes(count) && !numbersOf(f.drawn).includes(count));
/** The asks open after each step of a run: the fixture's two, plus each ask raised, less each one cancelled. */
function openAfter(ran: { spec: Spec; step: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  let open = FIXTURE_ASKS.length;
  for (const r of ran) {
    if (r.spec.kind === 'feed' && r.spec.what === 'ask') open += 1;
    if (r.spec.kind === 'feed' && r.spec.what === 'cancel') open -= 1;
    out.set(r.step, open);
  }
  return out;
}

/** The frame drawn before one ask is raised, the ask, the frame drawn after it, and a still frame. */
async function oneAskSeen(hub: string): Promise<{ frames: Frames; before: string[]; drawn: string[] }> {
  requireMacos();
  buildDrive();
  const replica = await Replica.open({ hub });
  try {
    const before = names(await replica.see()); // step 1
    await replica.feed(SESSION.asks, askCreated(eventId(1, 1), QUESTION)); // step 2
    const drawn = names(await replica.see()); // step 3
    await replica.by(FRAME); // step 4
    return { frames: await replica.close(), before, drawn };
  } finally {
    await replica.stop();
  }
}

describe('#1546 AC1 a record event reaches the window by itself, and the replica reads the frame it drew', () => {
  it('an ask raised on the record is drawn with no input: the frame drawn after it lists the row and the new count, and equals a forced one', async () => {
    const { frames, drawn } = await oneAsk();
    expect(drawn, 'the last drawn frame has the new ask\'s row in Needs you').toContain(QUESTION);
    expect(drawn, 'and the sidebar\'s count says three asks need you').toContain('3 asks need you');
    const fedStep = stepOf(frames, 1);
    expect(fedStep.drawn, `the record's change made the window dirty by itself: step 1 drew ${fedStep.drawn} frames`).toBeGreaterThanOrEqual(1);
    expect(stepOf(frames, 3), 'a frame of the clock with nothing changed draws nothing').toMatchObject({ frames: 1, drawn: 0, equal: true });
    expect(frames.findings.map(said), 'no step\'s forced frame differs from the last drawn one').toEqual([]);
    expect(frames.claim, `the claim: ${JSON.stringify(frames).slice(0, 600)}`).toBe('PASS');
  }, LONG);

  // Redrafted blind (REDRAFT.md): since #1461 the list's first section is Needs you, its heading with the one count and then
  // a row per open ask, oldest first; so the stale view is the list's (`deepbuild/sidebar`, or `deepbuild/needs-you` where
  // that registered view fills the section), and its first differing node is the count or the new ask's row.
  it('planted record-in-thread-local: the drawn frame keeps the old count and rows, and the check fails naming Needs you, the ask\'s row and the step', async () => {
    const { frames, before, drawn } = await oneAskSeen(PLANT.readsThreadLocal);
    for (const ask of FIXTURE_ASKS) expect(before, `before the feed the list's Needs you section has the fixture's row "${ask}"`).toContain(ask);
    expect(before, 'and no row for the ask not yet raised').not.toContain(QUESTION);
    expect(drawn, 'with nothing marking the window dirty, the frame a real window shows has no row for the ask').not.toContain(QUESTION);
    expect(drawn, 'and is the frame drawn before the feed, name for name: the old count and rows').toEqual(before);
    expect(stepOf(frames, 1), 'step 1, a see, passes no frame and differs in nothing').toMatchObject({ frames: 0, equal: true });
    expect(frames.claim, 'the check fails').toBe('FAIL');
    const atFeed = frames.findings.filter((f) => f.step === 2);
    expect(atFeed.every((f) => f.call === 'feed'), `findings at step 2 name its call, feed: ${atFeed.map(said)}`).toBe(true);
    const inList = atFeed.filter((f) => LIST_VIEW.test(f.view));
    expect(inList.length, `a finding at step 2 names the view that draws Needs you in the list: ${frames.findings.map(said)}`).toBeGreaterThanOrEqual(1);
    const named = inList.filter((f) => namesAsk(f, QUESTION, 3));
    expect(named.length, `one names the node a forced frame has and the drawn one lacks: the ask's row, or the count reading 3: ${inList.map(said)}`).toBeGreaterThanOrEqual(1);
    for (const f of named) {
      expect(String(f.drawn?.name ?? ''), `and the drawn frame has no row for the ask there (${said(f)})`).not.toContain(QUESTION);
      if (!String(f.node.name ?? '').includes(QUESTION)) expect(numbersOf(f.drawn), `the drawn frame's count there reads 2 (${said(f)})`).toContain(2);
    }
    expect(Math.min(...frames.findings.map((f) => f.step)), 'nothing differs before the record changed').toBe(2);
  }, LONG);
});

const SEEDS = [1546, 7, 2026];

describe('#1546 AC1 seeded journeys of record events, clock steps, hovers and resizes', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: the window draws only when dirty, every step's forced frame equals the last drawn one, and the claim is PASS`, async () => {
      requireMacos();
      buildDrive();
      const specs = journey(seed);
      const kinds = new Set(specs.map((s) => s.kind));
      expect([...kinds].sort(), `seed ${seed}'s journey has every kind of step`).toEqual(['clock', 'feed', 'hover', 'resize']);
      const replica = await Replica.open();
      let frames: Frames;
      let ran: Awaited<ReturnType<typeof run>>;
      try {
        ran = await run(replica, specs);
        frames = await replica.close();
      } finally {
        await replica.stop();
      }
      expect(journeyProblems(frames, ran), `seed ${seed}`).toEqual([]);
      expect(frames.clean, 'some steps passed frames and drew none: the run can tell a stale view from a fresh one').toBeGreaterThanOrEqual(1);
      expect(frames.steps.every((s) => s.equal), 'every step equal').toBe(true);
    }, LONG);
  }

  it('seed 1546 with the planted view: FAIL, its first finding at a record event, naming Needs you and a raised ask\'s row at that ask\'s step', async () => {
    requireMacos();
    buildDrive();
    const specs = journey(1546);
    const replica = await Replica.open({ hub: PLANT.readsThreadLocal });
    let frames: Frames;
    let ran: Awaited<ReturnType<typeof run>>;
    try {
      // A planted run may refuse a hover the stale frame misplaces; the claim is judged all the same.
      ran = await run(replica, specs, false);
      frames = await replica.close();
    } finally {
      await replica.stop();
    }
    const problems = journeyProblems(frames, ran);
    expect(problems.length, 'the same judge fails the planted app').toBeGreaterThan(0);
    expect(frames.claim, 'the check fails').toBe('FAIL');
    const first = Math.min(...frames.findings.map((f) => f.step));
    expect(ran.find((r) => r.step === first)?.spec.kind, `the first finding (step ${first}) is at a record event`).toBe('feed');
    // Redrafted blind (REDRAFT.md): Needs you is the list's first section since #1461, so its finding names the list's view,
    // and its node is the raised ask's row or the one count, which reads the asks open after that step.
    const open = openAfter(ran);
    const raised = fed(ran, ['ask']);
    const named = raised.filter((r) => frames.findings.some((f) => f.step === r.step && LIST_VIEW.test(f.view) && namesAsk(f, r.spec.question!, open.get(r.step)!)));
    expect(named.length, `a finding names Needs you's view and the row of an ask, or the count it raised, at the step that raised it; findings: ${frames.findings.map(said).join('; ')}`).toBeGreaterThanOrEqual(1);
  }, LONG);
});
