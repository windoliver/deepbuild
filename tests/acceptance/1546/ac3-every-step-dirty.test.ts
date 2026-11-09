// Criterion 3 (README: Criterion 3): a run where every step was dirty proves nothing. A replica planted to notify the
// window's root before every frame it asks GPUI for (DEEP_DRIVE_PLANT=notifies-every-step) draws on every step, so a view
// that missed its notify would be redrawn anyway: its run reads INCONCLUSIVE, never PASS. A `see` midway, a step that
// passes no frame, doesn't count as a clean step. The same journey without the plant reads PASS, so the plant is what
// made it INCONCLUSIVE; with the stale view planted as well, the check can't see it and still never reads PASS.
import { afterAll, describe, expect, it } from 'vitest';
import { PLANT, Replica, buildDrive, cleanup, journey, requireMacos, run, said, type Frames, type Spec } from './helpers.ts';

afterAll(cleanup, 60_000);
const LONG = 1_900_000;

/** Seed 1546's journey with a `see` after its tenth step. */
const SPECS: Spec[] = (() => {
  const specs = journey(1546);
  specs.splice(10, 0, { kind: 'see' });
  return specs;
})();

async function journeyWith(o: { hub?: string; drive?: string }): Promise<Frames> {
  requireMacos();
  buildDrive();
  const replica = await Replica.open(o);
  try {
    await run(replica, SPECS, o.hub === undefined);
    return await replica.close();
  } finally {
    await replica.stop();
  }
}

describe('#1546 AC3 a run where every step was dirty proves nothing: INCONCLUSIVE, never PASS', () => {
  it('planted notifies-every-step: every step that passed a frame drew one, nothing differs, and the claim reads INCONCLUSIVE', async () => {
    const frames = await journeyWith({ drive: PLANT.everyStep });
    const passed = frames.steps.filter((s) => s.frames > 0);
    expect(passed.length, 'the journey passes frames of the clock').toBeGreaterThan(0);
    expect(passed.filter((s) => s.drawn === 0).map((s) => s.step), 'with the root notified before every frame, no step passes a frame without drawing').toEqual([]);
    const seen = frames.steps.find((s) => s.call === 'see')!;
    expect(seen, 'the journey\'s see is a step').toBeTruthy();
    expect(seen.frames, 'a see passes no frame of the clock').toBe(0);
    expect(frames.clean, 'no clean step: a step with no frame is not one').toBe(0);
    expect(frames.findings.map(said), 'nothing differs').toEqual([]);
    expect(frames.claim, 'a run where every step was dirty proves nothing').not.toBe('PASS');
    expect(frames.claim).toBe('INCONCLUSIVE');
  }, LONG);

  it('the same journey without the plant has clean steps and reads PASS', async () => {
    const frames = await journeyWith({});
    expect(frames.clean, 'steps that passed frames and drew none').toBeGreaterThanOrEqual(1);
    expect(frames.findings.map(said)).toEqual([]);
    expect(frames.claim).toBe('PASS');
  }, LONG);

  it('with the stale view planted too, every step\'s redraw hides it, and the claim still never reads PASS', async () => {
    const frames = await journeyWith({ drive: PLANT.everyStep, hub: PLANT.readsThreadLocal });
    expect(frames.clean, 'no clean step').toBe(0);
    expect(frames.claim, `the claim: ${JSON.stringify({ claim: frames.claim, findings: frames.findings.map(said) }).slice(0, 600)}`).not.toBe('PASS');
  }, LONG);
});
