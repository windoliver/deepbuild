// Screens, compared with the merge base rendered by DeepBuild on the same machine. AC6: a refactor that moves a
// button 8 px fails its "no visible change" claim, the diff shown side by side. AC9: the claim also diffs the DOM
// and bundle sizes and lists every delta that remains. AC11: a claim with a visual change carries highlighted
// screenshots without anyone asking, each change marked in a strip beside the frame. AC23: the baseline, the
// capture rule, pixel equality outside masks, masks painted on both sides, a mask matching nothing, and the planted
// 4×4 block. AC24: the base rendered twice and kept per base commit, a region that differs between the renders
// (the clock footer) uncounted with one ask for a mask, saved to the spec on your answer; a second claim asks nothing.
// Slow: each comparison renders the base twice and the head once, each on its own stack.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Box, MaskAsk, ScreenOptions, ScreenResult } from '../../../packages/checks-journey/src/index.ts';
import { assertionFails, checkout, journey, journeyPath, journeyVariant, openWorld, pixel, runOptions, storedPng, tempDir, VIEWPORT, withBlockChanged, type Doc, type Flag, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const BASE_COMMIT = 'b000000000000000000000000000000000000037';
/** A screen comparison of the cart journey: the base build against the head build, the renders cached in `cache`. */
function screens(o: { head: Flag[]; base?: Flag[]; requirement?: ScreenOptions['requirement']; cache?: string; answer?: ScreenOptions['answer']; edit?: (doc: Doc) => void; plant?: ScreenOptions['plant'] }): ScreenOptions {
  const base = checkout(o.base ?? []);
  const head = checkout(o.head);
  const file = o.edit ? journeyVariant(head, 'cart-total', o.edit) : journeyPath('cart-total');
  if (o.edit) journeyVariant(base, 'cart-total', o.edit);
  return {
    host: world.sup, evidence: world.evidence, journey: file, base: { checkout: base, commit: BASE_COMMIT }, head: { checkout: head },
    cache: o.cache ?? tempDir('cache'), spec: join(head, file), requirement: o.requirement ?? 'no-visible-change', answer: o.answer ?? (async () => false),
    ...(o.plant ? { plant: o.plant } : {}),
  };
}
const payBox = (boxes: Box[]): Box | undefined => boxes.find((b) => b.y >= 290 && b.y <= 340 && b.x >= 100 && b.x <= 400);

describe('AC6 #37.bb6b115c a refactor that moves a button 8 px fails its "no visible change" claim, and the diff is shown side by side', () => {
  it('AC6 the Pay button moved 8 px fails the claim, naming the step and the box that changed, with a side-by-side image of base and head', async () => {
    const { compareScreens } = await journey();
    const result = await compareScreens(screens({ head: ['moved-8px'] }));
    expect(result.outcome, `a difference fails a no-visible-change requirement: ${JSON.stringify(result.named)}`).toBe('failed');
    const difference = result.differences.find((d) => d.step === 'see-total' || d.step === 'open');
    expect(difference, 'naming the step').toBeDefined();
    const box = payBox(difference!.boxes);
    expect(box, `and the box that changed, around the Pay button: ${JSON.stringify(difference!.boxes)}`).toBeDefined();
    expect(box!.width, 'the box spans the button\'s old and new place, at least 8 px wider than the move').toBeGreaterThanOrEqual(8);
    const side = await storedPng(world, result.sideBySide, 'the side-by-side diff');
    expect(side.width, 'base beside head, each a 1280-wide frame').toBeGreaterThanOrEqual(2 * VIEWPORT.width);
    expect(side.height).toBeGreaterThanOrEqual(VIEWPORT.height);
  }, 600_000);
});

describe('AC9 #37.e421f602 a "no visible change" claim also diffs the DOM and bundle sizes, and lists every delta that remains', () => {
  it('AC9 the refactor that moves the button and grows app.js by 100 bytes lists the screen box, the DOM change on the Pay button and the bundle delta with both sizes; the same build lists no delta', async () => {
    const { compareScreens } = await journey();
    const result = await compareScreens(screens({ head: ['moved-8px', 'bigger-bundle'] }));
    expect(result.outcome).toBe('failed');
    const kinds = new Set(result.deltas.map((d) => d.kind));
    expect([...kinds].sort(), 'screen, DOM and bundle deltas').toEqual(expect.arrayContaining(['screen', 'dom', 'bundle']));
    const dom = result.deltas.find((d) => d.kind === 'dom');
    expect(dom?.what, 'the DOM delta names the Pay button').toMatch(/Pay|pay/);
    const bundle = result.deltas.find((d) => d.kind === 'bundle');
    expect(bundle?.what).toMatch(/app\.js/);
    expect(Number(bundle?.head) - Number(bundle?.base), 'with both sizes, 100 bytes apart').toBe(100);
    const same = await compareScreens(screens({ head: [] }));
    expect(same.outcome, `the same build: no delta remains: ${JSON.stringify(same.deltas)}`).toBe('passed');
    expect(same.deltas).toEqual([]);
  }, 900_000);
});

describe('AC11 #37.bb3ba137 a claim with a visual change, and every taste call, carries highlighted screenshots without anyone asking, each change marked in a strip beside the frame', () => {
  it('AC11 for a requirement that isn\'t "no visible change", the moved button is evidence for a taste call, with a highlighted screenshot whose strip beside the frame marks the change\'s rows, without any ask for it', async () => {
    const { compareScreens } = await journey();
    const asked: MaskAsk[] = [];
    const result = await compareScreens(screens({ head: ['moved-8px'], requirement: 'visual', answer: async (ask) => { asked.push(ask); return false; } }));
    expect(result.outcome, 'a difference never passes a visual requirement, and never fails it: it is evidence for the taste call').not.toBe('passed');
    expect(result.taste, 'the taste call').toBe(true);
    expect(asked, 'nobody asked for the highlight').toEqual([]);
    const image = await storedPng(world, result.highlighted, 'the highlighted screenshot');
    expect(image.width, 'the frame plus a strip beside it').toBeGreaterThan(VIEWPORT.width);
    expect(image.height).toBe(VIEWPORT.height);
    const box = payBox(result.differences.flatMap((d) => d.boxes))!;
    expect(box).toBeDefined();
    const marked = (y: number): boolean => { for (let x = VIEWPORT.width; x < image.width; x++) { const [r, g, b] = pixel(image, x, y); if (r + g + b < 3 * 250) return true; } return false; };
    expect(marked(Math.floor(box.y + box.height / 2)), 'the strip is marked at the change\'s rows').toBe(true);
    expect(marked(50), 'and clear where nothing changed').toBe(false);
    expect(marked(VIEWPORT.height - 20)).toBe(false);
  }, 600_000);
});

describe('AC23 #37.42a70bf0 the only baseline is the base rendered by DeepBuild here; capture once fonts and images loaded and two frames match; equal outside masks, size is a difference; masks painted on both sides, a mask matching nothing is INVALID; a 4×4 block is a difference and a comparator tolerating 16 pixels fails this test', () => {
  it('AC23 the base render is the baseline and a committed image never is: a journey naming a baseline image is refused at review', async () => {
    const { reviewJourney, compareScreens } = await journey();
    const dir = checkout();
    const doc = parse(readFileSync(join(dir, journeyPath('cart-total')), 'utf8')) as Doc;
    doc.baseline = 'screens/cart.png';
    const refused = reviewJourney(stringify(doc));
    expect(refused.ok, 'no image anyone commits is ever compared').toBe(false);
    if (!refused.ok) expect(refused.reasons.join('\n')).toMatch(/baseline/);
    const result = await compareScreens(screens({ head: [] }));
    expect(result.renders, 'the base rendered twice and the head once, here').toEqual({ base: 2, head: 1 });
  }, 600_000);

  it('AC23 each side is captured once its images have loaded: the hero image\'s pixels are its colour on both sides', async () => {
    const { compareScreens } = await journey();
    const result = await compareScreens(screens({ head: [] }));
    expect(result.outcome).toBe('passed');
    const image = await storedPng(world, result.screens[0]!.head, 'the head screen');
    expect(pixel(image, 120, 420).slice(0, 3), 'the hero image, 40×40 at (100, 400), has loaded').toEqual([0x33, 0x99, 0x66]);
    const base = await storedPng(world, result.screens[0]!.base[0], 'the base screen');
    expect(pixel(base, 120, 420).slice(0, 3)).toEqual([0x33, 0x99, 0x66]);
  }, 600_000);

  it('AC23 a mask is a locator the spec names, painted on both sides, so the footer\'s text is masked while the Pay button\'s move still differs; a mask that matches nothing makes the check INVALID naming it', async () => {
    const { compareScreens } = await journey();
    const masked = await compareScreens(screens({ head: ['moved-8px'], edit: (doc) => { doc.masks = [{ role: 'contentinfo', name: 'Footer' }]; } }));
    expect(masked.outcome, 'the move outside the mask still differs').toBe('failed');
    expect(masked.differences.flatMap((d) => d.boxes).some((b) => b.y >= 500 && b.y < 524 && b.x >= 100 && b.x < 400), 'nothing inside the footer mask differs').toBe(false);
    const invalid = await compareScreens(screens({ head: [], edit: (doc) => { doc.masks = [{ role: 'dialog', name: 'Nowhere' }]; } }));
    expect(invalid.outcome).toBe('INVALID');
    expect(invalid.named.join('\n'), 'naming the mask').toMatch(/Nowhere/);
  }, 900_000);

  const blockIsADifference = async (plant?: 'tolerates-16-pixels'): Promise<void> => {
    const { comparePixels, runJourney } = await journey();
    const run = await runJourney(runOptions(world, checkout(), journeyPath('cart-total')));
    const bytes = await world.evidence.read(run.steps[1]!.screenshot!);
    const planted = withBlockChanged(bytes, 640, 100);
    const same = comparePixels(bytes, bytes, [], plant ? { plant } : {});
    expect(same.equal, 'an image equals itself').toBe(true);
    const differs = comparePixels(bytes, planted, [], plant ? { plant } : {});
    expect(differs.equal, 'one 4×4 block changed outside the masks is a difference').toBe(false);
    expect(differs.boxes.some((b) => b.x <= 640 && b.x + b.width >= 644 && b.y <= 100 && b.y + b.height >= 104), `the box holds the block: ${JSON.stringify(differs.boxes)}`).toBe(true);
    const inMask = comparePixels(bytes, planted, [{ x: 636, y: 96, width: 12, height: 12 }], plant ? { plant } : {});
    expect(inMask.equal, 'under a mask painted on both sides, the block is no difference').toBe(true);
  };
  it('AC23 a planted head image with one 4×4 block changed outside the masks is a difference; under a mask it isn\'t', () => blockIsADifference(), 120_000);

  it('AC23 (wrong program) a comparator that tolerates 16 differing pixels passes the planted block, and fails this test', async () => {
    const error = await assertionFails(() => blockIsADifference('tolerates-16-pixels'));
    expect(error.message).toMatch(/is a difference|equals itself/);
  }, 120_000);
});

describe('AC24 #37.94ac69b6 the base rendered twice and kept per base commit; a region that differs between the renders is uncounted naming it, with one ask proposing a mask for the smallest element holding it, saved to the spec on your answer; a second claim on the same base asks nothing; a rule failing the first as a difference fails this test', () => {
  const unstableBaseAsksOnce = async (plant?: 'unstable-base-as-difference'): Promise<void> => {
    const { compareScreens } = await journey();
    const cache = tempDir('cache');
    const asked: MaskAsk[] = [];
    const first = await compareScreens(screens({ head: ['clock-footer'], base: ['clock-footer'], cache, plant, answer: async (ask) => { asked.push(ask); return true; } }));
    expect(first.outcome, `the first claim: the clock differs between the two base renders, so the screen's run is uncounted, never a difference: ${JSON.stringify(first.named)}`).toBe('uncounted');
    expect(first.named.join('\n'), 'naming the region').toMatch(/\b(\d+), ?(\d+)\b|Clock|footer/i);
    expect(asked.length, 'one ask').toBe(1);
    expect(asked[0]!.mask, 'proposing a mask for the smallest element holding the region: the clock, not the footer').toMatchObject({ name: 'Clock' });
    const spec = parse(readFileSync(first.spec, 'utf8')) as Doc;
    expect(spec.masks, 'saved to the spec on your answer').toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Clock' })]));
    const again: MaskAsk[] = [];
    const second = await compareScreens({ ...screens({ head: ['clock-footer'], base: ['clock-footer'], cache, plant, answer: async (ask) => { again.push(ask); return true; } }), spec: first.spec });
    expect(again, 'a second claim on the same base asks nothing').toEqual([]);
    expect(second.renders.base, 'the base renders are reused').toBe(0);
    expect(second.outcome, `with the clock masked, the same build passes: ${JSON.stringify(second.named)}`).toBe('passed');
  };
  it('AC24 the clock footer is uncounted on its first claim with one ask for a mask on the clock, saved to the spec; a second claim on the same base asks nothing and reuses the renders', () => unstableBaseAsksOnce(), 900_000);

  it('AC24 a head screen that never holds still where the base did is a difference', async () => {
    const { compareScreens } = await journey();
    const result: ScreenResult = await compareScreens(screens({ head: ['clock-footer'] }));
    expect(result.outcome).toBe('failed');
    expect(result.named.join('\n')).toMatch(/still|clock|Clock/i);
  }, 600_000);

  it('AC24 (wrong program) a rule that fails the first claim as a difference fails this test', async () => {
    const error = await assertionFails(() => unstableBaseAsksOnce('unstable-base-as-difference'));
    expect(error.message).toMatch(/uncounted|difference/);
  }, 900_000);
});
