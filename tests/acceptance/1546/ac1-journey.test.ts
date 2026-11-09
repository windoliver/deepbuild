// Criterion 1 (README: Criterion 1): in a seeded replica journey of record events, clock steps, hovers and resizes, the
// replica draws only when the window is dirty, and after each step a forced frame's snapshot equals the last drawn one. A
// planted view that reads a thread-local with no notify (DEEP_HUB_PLANT=record-in-thread-local) fails, naming the view,
// the node and the step. The replica is `deep-drive` launched with frames: "dirty"; every count, comparison and finding
// below is its own, read from `close`'s frames report and from `see`, which reads the last frame the window drew.
import { afterAll, describe, expect, it } from 'vitest';
import {
  FRAME, PLANT, Replica, SESSION, askCreated, buildDrive, cleanup, eventId, fed, journey, journeyProblems, names, requireMacos, run,
  said, stepOf, type Frames,
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

  it('planted record-in-thread-local: the drawn frame keeps the old count and rows, and the check fails naming Needs you, the ask\'s row and the step', async () => {
    const { frames, drawn } = await oneAsk(PLANT.readsThreadLocal);
    expect(drawn, 'with nothing marking the window dirty, the frame a real window shows has no row for the ask').not.toContain(QUESTION);
    expect(drawn, 'and keeps the old count').toContain('2 asks need you');
    expect(frames.claim, 'the check fails').toBe('FAIL');
    const atFeed = frames.findings.filter((f) => f.step === 1);
    expect(atFeed.every((f) => f.call === 'feed'), `findings at step 1 name its call, feed: ${atFeed.map(said)}`).toBe(true);
    const needsYou = atFeed.find((f) => /(^|\/)needs-you$/.test(f.view));
    expect(needsYou, `a finding at step 1 names the Needs you view: ${frames.findings.map(said)}`).toBeTruthy();
    expect(needsYou!.node.name, `it names the node a forced frame has and the drawn one lacks: the ask's row (${said(needsYou!)})`).toContain(QUESTION);
    expect(String(needsYou!.drawn?.name ?? ''), 'and the drawn frame has no such row there').not.toContain(QUESTION);
    const sidebar = atFeed.find((f) => /(^|\/)sidebar$/.test(f.view));
    expect(sidebar, `a finding at step 1 names the sidebar, whose count is stale too: ${frames.findings.map(said)}`).toBeTruthy();
    expect({ forced: sidebar!.node.name, drawn: sidebar!.drawn?.name }, 'naming the count: three in the forced frame, two in the drawn one').toEqual({ forced: '3 asks need you', drawn: '2 asks need you' });
    expect(Math.min(...frames.findings.map((f) => f.step)), 'nothing differs before the record changed').toBe(1);
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
    const raised = fed(ran, ['ask']);
    const named = raised.filter((r) => frames.findings.some((f) => f.step === r.step && /(^|\/)needs-you$/.test(f.view) && String(f.node.name).includes(r.spec.question!)));
    expect(named.length, `a finding names Needs you and the row of an ask at the step that raised it; findings: ${frames.findings.map(said).join('; ')}`).toBeGreaterThanOrEqual(1);
  }, LONG);
});
