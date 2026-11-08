// AC25: on the sample app, a card whose requirement says it fades in from 28 px below over 0.7 s on the Bézier
// (0.33, 1, 0.68, 1) once its top passes 85% of the viewport. A journey that scrolls it into view records one
// animation on the card (opacity 0 to 1 and translate 28 px to 0, 700 ms, delay 0, that easing) and passes; a
// planted build at 400 ms with a plain ease fails naming the card, the duration and the easing; with reduced motion
// on the card shows at full opacity and at rest on its first frame, and a build that ignores the setting records the
// 700 ms translate and fails naming the card; a build that moves the card from a per-frame script records no
// animation and leaves the requirement INCONCLUSIVE, naming the card. A motion requirement runs its journey twice.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkout, journey, journeyPath, openWorld, runOptions, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const EASING = 'cubic-bezier(0.33, 1, 0.68, 1)';

describe('AC25 #37.e2d2dca9 the card\'s fade-in from 28 px below over 0.7 s on cubic-bezier(0.33, 1, 0.68, 1) is recorded and passes; 400 ms with a plain ease fails naming the card, the duration and the easing; under reduced motion the card is at rest on its first frame, a build ignoring the setting fails naming the card, and a per-frame script leaves it INCONCLUSIVE naming the card', () => {
  it('AC25 the working build: the journey runs twice, with reduced motion off and on; off, it records the card\'s animation, opacity 0 to 1 and translate 28 px to 0, 700 ms, delay 0, that easing, and passes; on, the card shows at full opacity and at rest on the first frame it appears', async () => {
    const { motionCheck } = await journey();
    const result = await motionCheck(runOptions(world, checkout(), journeyPath('motion')));
    expect(result.outcome, `passes: ${JSON.stringify(result.named)}`).toBe('passed');
    expect(result.normal.reducedMotion).toBe('no-preference');
    expect(result.reduced.reducedMotion).toBe('reduce');
    const reveal = result.normal.steps.find((s) => s.id === 'reveal')!;
    const onCard = reveal.animations.filter((a) => a.target.role === 'article' && a.target.name === 'Featured');
    expect(onCard.length, `the animations recorded on the card: ${JSON.stringify(reveal.animations)}`).toBeGreaterThanOrEqual(2);
    expect(onCard.map((a) => a.property).sort()).toEqual(['opacity', 'transform']);
    for (const a of onCard) expect(a).toMatchObject({ duration: 700, delay: 0, easing: EASING });
    expect(onCard.find((a) => a.property === 'opacity')).toMatchObject({ from: '0', to: '1' });
    expect(onCard.find((a) => a.property === 'transform')).toMatchObject({ from: 'translateY(28px)', to: 'translateY(0px)' });
    expect(reveal.animations.filter((a) => a.target.name !== 'Featured'), 'nothing else moved').toEqual([]);
    const still = result.reduced.steps.find((s) => s.id === 'reveal')!;
    expect(still.animations, 'under reduced motion nothing animates').toEqual([]);
    expect(still.firstFrame, 'the card on the first frame it appears').toMatchObject({ opacity: 1, transform: 'none' });
  }, 300_000);

  it('AC25 the planted build at 400 ms with a plain ease fails, naming the card, the duration and the easing', async () => {
    const { motionCheck } = await journey();
    const result = await motionCheck(runOptions(world, checkout(['motion-400']), journeyPath('motion')));
    expect(result.outcome).toBe('failed');
    const named = result.named.join('\n');
    expect(named, 'the card').toMatch(/Featured/);
    expect(named, 'the duration').toMatch(/400/);
    expect(named, 'and the easing').toMatch(/\bease\b/);
    expect(named).toMatch(/700/);
  }, 300_000);

  it('AC25 the planted build that ignores prefers-reduced-motion records the 700 ms translate under reduced motion and fails, naming the card', async () => {
    const { motionCheck } = await journey();
    const result = await motionCheck(runOptions(world, checkout(['motion-no-reduce']), journeyPath('motion')));
    expect(result.outcome).toBe('failed');
    const still = result.reduced.steps.find((s) => s.id === 'reveal')!;
    expect(still.animations.some((a) => a.property === 'transform' && a.duration === 700 && a.target.name === 'Featured'), `the translate under reduced motion: ${JSON.stringify(still.animations)}`).toBe(true);
    expect(result.named.join('\n')).toMatch(/Featured/);
    expect(result.normal.outcome, 'with reduced motion off, the build is right').toBe('passed');
  }, 300_000);

  it('AC25 the planted build that moves the card from a per-frame script records no animation and leaves the requirement INCONCLUSIVE, naming the card, never PASS', async () => {
    const { motionCheck } = await journey();
    const result = await motionCheck(runOptions(world, checkout(['motion-script']), journeyPath('motion')));
    expect(result.outcome).toBe('inconclusive');
    expect(result.normal.steps.find((s) => s.id === 'reveal')!.animations, 'script motion has no entry').toEqual([]);
    expect(result.named.join('\n')).toMatch(/Featured/);
  }, 300_000);
});
