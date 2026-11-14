// #504.3b622b2f An agent's figure or film never appears in Needs you and never feeds a verdict; it shows beside an opened ask
// or in a receipt's explains-never-proves section.
//
// Blind redraft of #504's criterion 2 (docs/technical-design.md, Dogfooding). One Claude Code session files a claim and a choice
// ask; the hub minted a figure and a film for each (README: Seams, the world file's `docs.<id>.on`); the agent shows all four with
// deep_show through its deep mcp and checks the figure on its claim against the claim with `deep show --check --claim` from its
// own process tree. Needs you is `inbox.read`, the opened ask is `ask.card`, the claim's receipt is `changes.read`, the record is
// `events.read`. The first two halves hold at the base, so each has a planted hub that must fail the same check; the last two
// fail at the base, which has no `beside` and no `explains`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PLANT_NEEDS_YOU, PLANT_VERDICT, SETTLE_MS, besideFailures, cleanup, explainsFailures, namesDocOrAsk, needsYouFailures, observe, openWorld,
  runFlow, sleep, untilFailing, useCanvasCore, verdictFailures, type Flow, type Observed,
} from './helpers.ts';

const canvasCore = useCanvasCore();

describe('#504.3b622b2f an agent\'s figure and film on its ask and on its claim, through the hub', () => {
  afterAll(cleanup, 60_000);
  let seen: { flow: Flow; obs: Observed } | undefined;
  beforeAll(async () => {
    canvasCore();
    const w = await openWorld();
    const flow = await runFlow(w);
    await sleep(SETTLE_MS);
    seen = { flow, obs: await observe(w, flow) };
  }, 900_000);
  const got = (): { flow: Flow; obs: Observed } => {
    if (!seen) throw Error('BLOCKED: the world never opened');
    return seen;
  };

  it('#504.3b622b2f never appears in Needs you: inbox.read gains no ask or row and names none of the figures or films, and the record files no ask for them', () => {
    const { flow, obs } = got();
    expect(needsYouFailures(flow, obs), 'what Needs you shows after the agent showed a figure and a film on its ask and on its claim').toEqual([]);
  });

  it('#504.3b622b2f never feeds a verdict: the claim\'s runs, verdicts, checks and line stay as they were, and the agent\'s own check of its figure against the claim is not PASS', () => {
    const { flow, obs } = got();
    expect(verdictFailures(flow, obs), 'the claim\'s receipt and the record after the agent showed its figure and film on the claim and checked the figure against it').toEqual([]);
  });

  it('#504.3b622b2f shows beside an opened ask: ask.card lists the figure and the film shown on the ask, at their newest revisions, and nothing shown on the claim', () => {
    const { flow, obs } = got();
    expect(besideFailures(flow, obs), `ask.card for ${flow.ask}`).toEqual([]);
  });

  it('#504.3b622b2f shows in the receipt\'s explains-never-proves section: changes.read\'s explains lists the figure and the film shown on the claim, at their newest revisions, and nothing shown on the ask', () => {
    const { flow, obs } = got();
    expect(explainsFailures(flow, obs), `changes.read for ${flow.claim}`).toEqual([]);
  });
});

describe(`#504.3b622b2f planted ${PLANT_NEEDS_YOU}`, () => {
  afterAll(cleanup, 60_000);
  it(`#504.3b622b2f a hub planted with ${PLANT_NEEDS_YOU}, which puts an agent's figure or film in Needs you, fails the Needs-you check, naming the document or the ask it raised`, async () => {
    canvasCore();
    const w = await openWorld(PLANT_NEEDS_YOU);
    const flow = await runFlow(w);
    const failures = await untilFailing(w, flow, (o) => needsYouFailures(flow, o));
    expect(failures.length, 'the Needs-you check fails on the planted hub').toBeGreaterThan(0);
    expect(failures.some(namesDocOrAsk(flow)), `a failure names one of the agent's documents or the ask raised for it: ${failures.join(' | ')}`).toBe(true);
  }, 900_000);
});

describe(`#504.3b622b2f planted ${PLANT_VERDICT}`, () => {
  afterAll(cleanup, 60_000);
  it(`#504.3b622b2f a hub planted with ${PLANT_VERDICT}, which takes an agent's figure or film on its claim as proof, fails the verdict check, naming the claim`, async () => {
    canvasCore();
    const w = await openWorld(PLANT_VERDICT);
    const flow = await runFlow(w);
    const failures = await untilFailing(w, flow, (o) => verdictFailures(flow, o));
    expect(failures.length, 'the verdict check fails on the planted hub').toBeGreaterThan(0);
    expect(failures.some((f) => f.includes(flow.claim)), `a failure names the claim ${flow.claim}: ${failures.join(' | ')}`).toBe(true);
  }, 900_000);
});
