// The evidence a journey run leaves. AC2: it remains after the stack is down. AC3: each end-state check records the
// selector and bounding box it looked at, with the run's screenshot. AC4: a broken page fails the journey with a
// screenshot of the failure. AC8: a test password typed into a plain text field marks the later screenshots and
// video incomplete, and an export refuses them without your approval. (AC7's first draft is in
// receipt-first-draft.test.ts; README, Approved changes after the draft.)
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JourneyRun } from '../../../packages/checks-journey/src/index.ts';
import type { ShareAsk } from '../../../packages/evidence/src/index.ts';
import { alive, checkout, isWebm, journey, journeyPath, openWorld, runOptions, serverPids, sleep, storedPng, testSecret, VIEWPORT, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

/** The cart journey on the working build, once per file: its run passes. */
let cart: { dir: string; run: JourneyRun } | undefined;
async function cartRun(): Promise<{ dir: string; run: JourneyRun }> {
  if (cart) return cart;
  const { runJourney } = await journey();
  const dir = checkout();
  const run = await runJourney(runOptions(world, dir, journeyPath('cart-total')));
  cart = { dir, run };
  return cart;
}

describe('AC2 #37.ed0df801 evidence remains after `deep env down`', () => {
  it('AC2 once the run\'s stack is down (its process gone, the stack torn down by run), the screenshots, the video and the trace are still in the evidence store, whole, by hash', async () => {
    const { dir, run } = await cartRun();
    expect(run.outcome, `the cart journey passes on the working build: ${JSON.stringify(run.failures)}`).toBe('passed');
    expect(run.stack, 'the run names the stack it ran against').not.toBeNull();
    const pids = serverPids(dir);
    expect(pids.length, 'the app wrote its PID').toBeGreaterThan(0);
    const deadline = Date.now() + 10_000;
    while (pids.some(alive) && Date.now() < deadline) await sleep(50);
    expect(pids.some(alive), 'the stack is down after the run: its process is gone').toBe(false);
    for (const [what, sha] of [['the video', run.video], ['the trace', run.trace], ...run.steps.map((s) => [`step ${s.id}'s screenshot`, s.screenshot] as const)] as const) {
      expect(sha, `${what} is stored by hash`).toMatch(/^[0-9a-f]{64}$/);
      const record = await world.evidence.get(sha!);
      expect(record?.intake, `${what} is whole after teardown`).toBe('captured');
      expect((await world.evidence.read(sha!)).length).toBeGreaterThan(0);
    }
    expect(isWebm(await world.evidence.read(run.video!)), 'the video is a WebM').toBe(true);
    expect(run.evidence, 'the run lists its evidence by hash, never by path').toEqual(expect.arrayContaining([run.video, run.trace]));
    expect(run.evidence.some((e) => e.startsWith('/')), 'no path in the evidence list').toBe(false);
  }, 120_000);
});

describe('AC3 #37.066be7dc each end-state check records the selector and bounding box it looked at, with the run\'s screenshot', () => {
  it('AC3 the total check records the locator by role and name and the box the Total element occupies (100, 200, 120×40 at 1280×720), and a 1280×720 screenshot of the run', async () => {
    const { run } = await cartRun();
    const total = run.endState.find((e) => e.id === 'total-shown');
    expect(total, 'the end-state check total-shown is recorded').toBeDefined();
    expect(total!.outcome).toBe('passed');
    expect(total!.selector).toMatchObject({ role: 'status', name: 'Total' });
    expect(total!.box, 'the box it looked at: the element\'s own, as the fixture\'s stylesheet places it').toEqual({ x: 100, y: 200, width: 120, height: 40 });
    const image = await storedPng(world, total!.screenshot, 'the end-state screenshot');
    expect({ width: image.width, height: image.height }).toEqual(VIEWPORT);
    const stored = run.endState.find((e) => e.id === 'cart-stored');
    expect(stored?.outcome, 'the readback check passed').toBe('passed');
    expect(stored?.box, 'a readback looks at no element').toBeNull();
  }, 120_000);
});

describe('AC4 #37.18a57a59 a broken page fails the journey with a screenshot of the failure', () => {
  it('AC4 on the build whose cart shows $18.01 the journey fails at its expect, on an assertion, and the failure carries a screenshot of the page as it was', async () => {
    const { runJourney } = await journey();
    const dir = checkout(['s2']);
    const run = await runJourney(runOptions(world, dir, journeyPath('cart-total')));
    expect(run.outcome).toBe('failed');
    expect(run.failures.length).toBeGreaterThan(0);
    const failure = run.failures[0]!;
    expect(failure.assertion, 'an expect that found other text is an assertion failure').toBe(true);
    expect(failure.message).toMatch(/\$18\.00/);
    const step = run.steps.find((s) => s.id === 'see-total');
    expect(step?.outcome).toBe('failed');
    const image = await storedPng(world, step!.screenshot, 'the failing step\'s screenshot');
    expect({ width: image.width, height: image.height }).toEqual(VIEWPORT);
    expect(run.evidence).toContain(step!.screenshot);
  }, 120_000);
});

describe('AC8 #37.ff0f6f4d a journey that types a test password into a plain text field marks its later screenshots and video incomplete, and an export refuses them without your approval', () => {
  it('AC8 the screenshots before the password step are complete, those from it on and the video are incomplete, and an export of them is withheld until you say yes', async () => {
    const { runJourney } = await journey();
    const dir = checkout();
    const value = testSecret();
    const run = await runJourney(runOptions(world, dir, journeyPath('login'), { secrets: { TEST_PASSWORD: value } }));
    expect(run.outcome, `the login journey passes: ${JSON.stringify(run.failures)}`).toBe('passed');
    const at = run.steps.findIndex((s) => s.id === 'password');
    expect(at).toBeGreaterThan(0);
    for (const [i, step] of run.steps.entries()) {
      const record = await world.evidence.get(step.screenshot!);
      expect(record?.redaction, `step ${step.id}'s screenshot, ${i < at ? 'before' : 'from'} the typing`).toBe(i < at ? 'complete' : 'incomplete');
    }
    expect((await world.evidence.get(run.video!))?.redaction, 'the video').toBe('incomplete');
    expect(run.redaction).toBe('incomplete');
    const later = run.steps.slice(at).map((s) => s.screenshot!);
    const asked: ShareAsk[] = [];
    const delivered: string[] = [];
    const refused = await world.evidence.send({ files: [...later, run.video!], via: 'export', destination: 'export:dh37' }, {
      ask: async (q) => { asked.push(q); return false; },
      deliver: async (file) => { delivered.push(file.sha256); },
    });
    expect(delivered, 'nothing left without your yes').toEqual([]);
    expect(refused.withheld.map((w) => w.sha256).sort()).toEqual([...later, run.video!].sort());
    expect(asked.length).toBe(later.length + 1);
    expect(asked[0]!.reason).toMatch(/incomplete/);
    const approved = await world.evidence.send({ files: [run.video!], via: 'export', destination: 'export:dh37' }, {
      ask: async () => true,
      deliver: async (file) => { delivered.push(file.sha256); },
    });
    expect(approved.sent.map((s) => s.sha256)).toEqual([run.video!]);
    expect(delivered).toEqual([run.video!]);
    expect(existsSync(dir)).toBe(true);
  }, 120_000);
});
