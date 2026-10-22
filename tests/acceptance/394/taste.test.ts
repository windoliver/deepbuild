import { describe, expect, it } from 'vitest';
import {
  TASTE_SOURCE, aboutAsk, agent, app, bands, deltaE, expectBeside, exposed, linearSrgbToOklab, noneOfThese, openWorld, optionsOf, p90DeltaE, paint,
  srgbToOklab, strings, tasteAsk, tasteCall, useBinaries, view, type Rgb, type Still,
} from './helpers.ts';

useBinaries('deep-sheet');

const VIEW: [number, number] = [1280, 800];
const CARD: [number, number] = [360, 240];
const W = 120;
const H = 80;
const NOTE = 'None of these: keep the warm palette but drop the dark band';

// Three figure candidates: a warm figure, the same figure with a 2% exposure change (its linear light × 1.02),
// and a cool one. The copy comes second, so it is the later of the pair.
const WARM = bands(W, H, [[200, 120, 60], [240, 220, 120], [40, 40, 60]]);
const WARM_EXPOSED = exposed(WARM, 1.02);
const COOL = bands(W, H, [[60, 140, 200], [200, 230, 250], [20, 30, 60]]);
const FIGURES = [
  { option: 'fig-warm', label: 'Warm', still: WARM },
  { option: 'fig-warm-exposed', label: 'Warm, brighter', still: WARM_EXPOSED },
  { option: 'fig-cool', label: 'Cool', still: COOL },
];

/** The fixtures' own measure, with palette's OKLab: the copy is a near copy, the cool figure really differs. */
function expectFigures(): void {
  const copy = p90DeltaE(WARM, WARM_EXPOSED);
  expect(copy > 0 && copy < 0.1, `the exposed copy differs from the warm figure, by ΔE ${copy} at the 90th percentile, under 0.1`).toBe(true);
  expect(p90DeltaE(WARM, COOL), 'the cool figure differs from the warm one by more than 0.1').toBeGreaterThan(0.1);
  expect(p90DeltaE(WARM_EXPOSED, COOL), 'and from the copy').toBeGreaterThan(0.1);
}

async function raised() {
  const world = await openWorld();
  await world.start('s1');
  const call = tasteCall(tasteAsk('Which look for the launch figure?', FIGURES), FIGURES.map((f) => ({ option: f.option, still: f.still })));
  const handle = await world.asks.raise(agent('s1'), TASTE_SOURCE, call.ask);
  return { world, call, handle };
}

describe('AC5 a taste call with three figure candidates, one a copy of another with a 2% exposure change, shows two side by side beside none of these and names the dropped copy in its record; answering none of these sends the work back with your note', () => {
  it('AC5 the copy is dropped before the ask: two candidates side by side on the sheet, none of these on the card, the dropped copy named in the ask\'s record', async () => {
    expectFigures();
    const { world, call, handle } = await raised();
    try {
      // A program that keeps all three, or drops the earlier of the pair, fails here.
      expect(call.dropped, 'the later of the pair is dropped, as a copy of the warm figure').toEqual([{ option: 'fig-warm-exposed', same_as: 'fig-warm' }]);
      const none = noneOfThese(call.ask);
      const card = await world.asks.card(handle);
      expect(card.options.map((o) => o.id), 'the card offers the two candidates and none of these').toEqual(['fig-warm', 'fig-cool', none.id]);
      expect(call.cells.map((c) => c.names_option), 'the variant sheet shows the two candidates').toEqual(['fig-warm', 'fig-cool']);
      const laid = view({ view: VIEW, card: { ask: handle, size: CARD }, sheet: call.sheet, inputs: [] });
      expectBeside(laid, VIEW, CARD, call.cells);
      const [a, b] = call.cells.map((c) => laid.cells[c.id]!);
      expect(a![1], 'side by side: the two cells share a row').toBe(b![1]);
      expect(b![0] - (a![0] + a![2]), 'side by side: the second cell follows the first after the sheet\'s 8 px gap').toBe(8);
      // Named in its record: an event about the ask holds the dropped candidate's option ID.
      const named = aboutAsk(await world.events(), handle).filter((e) => strings(e.data).includes('fig-warm-exposed'));
      expect(named.map((e) => e.kind), `the record names the dropped copy fig-warm-exposed in an event about ${handle}`).not.toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('AC5 answering none of these on the card sends the work back to the agent with your note', async () => {
    const { world, call, handle } = await raised();
    try {
      const none = noneOfThese(call.ask);
      await world.asks.answer(app, handle, { option: none.id, words: NOTE });
      const back = world.deliveries.filter((d) => d.ask === handle);
      expect(back.map((d) => ({ session: d.session, option: d.option, words: d.words, decision: d.decision })), 'the agent gets none of these with your note: no candidate is taken')
        .toEqual([{ session: 's1', option: none.id, words: NOTE, decision: 'none' }]);
      const answered = (await world.events()).filter((e) => e.kind === 'ask.answered' && e.subject === handle);
      expect(answered.map((e) => (e.data as { answer: string }).answer), 'the record holds the answer none of these').toEqual([none.id]);
      expect(optionsOf(call.ask).some((o) => o.id === none.id && FIGURES.some((f) => f.option === o.id)), 'none of these is no candidate').toBe(false);
    } finally {
      await world.close();
    }
  });
});

/** 40 × 40 px: the base color, with 6 rows (15% of pixels) at `near` and 2 rows (5%) at `far`. */
const S = 40;
const uniform = (c: Rgb): Still => paint(S, S, () => c);
const patched = (base: Rgb, near: Rgb, far: Rgb): Still => paint(S, S, (_x, y) => (y < 6 ? near : y < 8 ? far : base));

// Every percentile from the 81st to the 95th of the per-pixel ΔE is `near`'s ΔE, so the 90th is exactly it.
// The 5% at `far` (ΔE about 0.58) and the 80% at 0 make the mean, the median and the maximum wrong, and
// the 0.09 pair is far apart in sRGB (0.20) while the 0.11 pair is close (0.03), so an sRGB distance is wrong too.
const CASES = [
  { delta: 0.09, base: [235, 235, 235] as Rgb, near: [204, 206, 207] as Rgb, far: [60, 60, 60] as Rgb, count: 1 },
  { delta: 0.11, base: [0, 0, 0] as Rgb, near: [6, 4, 2] as Rgb, far: [120, 120, 120] as Rgb, count: 2 },
];

describe('AC6 two candidates whose stills differ by ΔE 0.09 at the 90th percentile count as one, and by 0.11 as two', () => {
  it('AC6 the fixtures\' ΔE is palette\'s OKLab: its own test values hold, and the stills differ by 0.09 and 0.11 at the 90th percentile', () => {
    // palette 71011dee47, oklab.rs: blue_srgb (1e-9), red and green (visually equal at 1e-8).
    const near = (got: number[], want: number[], eps: number, what: string) => got.forEach((v, i) => expect(Math.abs(v - want[i]!), `${what}[${i}]`).toBeLessThanOrEqual(eps));
    near(srgbToOklab([0, 0, 255]), [0.4520137183853429, -0.03245698416876397, -0.3115281476783751], 1e-9, 'sRGB blue');
    near(linearSrgbToOklab(1, 0, 0), [0.6279553606145516, 0.22486306106597395, 0.1258462985307351], 1e-8, 'linear red');
    near(linearSrgbToOklab(0, 1, 0), [0.8664396115356694, -0.23388757418790812, 0.17949847989672985], 1e-8, 'linear green');
    for (const c of CASES) {
      expect(Math.abs(p90DeltaE(uniform(c.base), patched(c.base, c.near, c.far)) - c.delta), `the ${c.delta} pair's stills differ by ΔE ${c.delta} at the 90th percentile, within 0.0005`).toBeLessThan(0.0005);
      expect(deltaE(c.base, c.far), `the far pixels of the ${c.delta} pair are far: above 0.5`).toBeGreaterThan(0.5);
    }
  });

  for (const c of CASES) {
    it(`AC6 ΔE ${c.delta} at the 90th percentile counts as ${c.count === 1 ? 'one: the later is dropped' : 'two: both are kept'}`, () => {
      const pair = [
        { option: 'cand-1', label: 'First', still: uniform(c.base) },
        { option: 'cand-2', label: 'Second', still: patched(c.base, c.near, c.far) },
      ];
      const call = tasteCall(tasteAsk(`Which of the two at ${c.delta}?`, pair), pair.map((p) => ({ option: p.option, still: p.still })));
      const none = noneOfThese(call.ask);
      if (c.count === 1) {
        // A maximum (0.58) or an sRGB distance (0.20) counts these as two.
        expect(call.dropped, 'the later candidate is dropped as a copy of the first').toEqual([{ option: 'cand-2', same_as: 'cand-1' }]);
        expect(optionsOf(call.ask).map((o) => o.id), 'the ask offers one candidate and none of these').toEqual(['cand-1', none.id]);
        expect(call.cells.map((x) => x.names_option), 'the sheet shows one candidate').toEqual(['cand-1']);
      } else {
        // A mean (0.045), a median (0) or an sRGB distance (0.03) counts these as one.
        expect(call.dropped, 'neither candidate is dropped').toEqual([]);
        expect(optionsOf(call.ask).map((o) => o.id), 'the ask offers both candidates and none of these').toEqual(['cand-1', 'cand-2', none.id]);
        expect(call.cells.map((x) => x.names_option), 'the sheet shows both candidates').toEqual(['cand-1', 'cand-2']);
      }
    });
  }
});
