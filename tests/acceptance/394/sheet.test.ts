import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SHEET_BIN, TASTE_SOURCE, agent, app, bands, center, expectBadInput, expectBeside, noneOfThese, onlyPreselects, openWorld, optionsOf, p90DeltaE, tasteAsk,
  tasteCall, useBinaries, view, type Rect, type TasteCall, type World,
} from './helpers.ts';

useBinaries('deep-sheet');

/** The view at scale 1, so device px are the view's px; the card's measured size. */
const VIEW: [number, number] = [1280, 800];
const CARD: [number, number] = [360, 240];
const W = 120;
const H = 80;
/** Three figure candidates that really differ: no two count as one. */
const CANDIDATES = [
  { option: 'fig-warm', label: 'Warm', still: bands(W, H, [[200, 120, 60], [240, 220, 120], [40, 40, 60]]) },
  { option: 'fig-cool', label: 'Cool', still: bands(W, H, [[60, 140, 200], [200, 230, 250], [20, 30, 60]]) },
  { option: 'fig-mono', label: 'Mono', still: bands(W, H, [[30, 30, 30], [128, 128, 128], [230, 230, 230]]) },
];

let world: World;
let call: TasteCall;
let handle: string;

beforeEach(async () => {
  world = await openWorld();
  await world.start('s1');
  call = tasteCall(tasteAsk('Which look for the release figure?', CANDIDATES), CANDIDATES.map((c) => ({ option: c.option, still: c.still })));
  handle = await world.asks.raise(agent('s1'), TASTE_SOURCE, call.ask);
});
afterEach(async () => { await world?.close(); });

const cellFor = (option: string): string => {
  const cell = call.cells.find((c) => c.names_option === option);
  expect(cell, `the sheet has a cell naming option ${option}`).toBeDefined();
  return cell!.id;
};

/** A point of the view on neither the card's slot nor the sheet. */
function empty(card: Rect, sheet: Rect): [number, number] {
  const off = (r: Rect, x: number, y: number): boolean => x < r[0] || x >= r[0] + r[2] || y < r[1] || y >= r[1] + r[3];
  for (let y = 4; y < VIEW[1]; y += 8) for (let x = 4; x < VIEW[0]; x += 8) if (off(card, x, y) && off(sheet, x, y)) return [x, y];
  throw Error('the card and the sheet cover the whole view');
}

describe('AC1 a taste call shows its sheet beside the card, and a cell click only preselects', () => {
  it('AC1 the taste call\'s sheet draws beside the card\'s slot, one cell per candidate at its still\'s exact size', () => {
    for (const [i, a] of CANDIDATES.entries()) for (const b of CANDIDATES.slice(i + 1)) {
      expect(p90DeltaE(a.still, b.still), `${a.option} and ${b.option} really differ: ΔE above 0.1 at the 90th percentile`).toBeGreaterThan(0.1);
    }
    expect(call.dropped, 'three candidates that really differ: none is dropped').toEqual([]);
    expect(call.cells.map((c) => c.names_option), 'one cell per candidate, in the candidates\' order, each naming its option').toEqual(CANDIDATES.map((c) => c.option));
    for (const c of call.cells) expect(c.size, `cell ${c.id} is its still's size`).toEqual([W, H]);
    const laid = view({ view: VIEW, card: { ask: handle, size: CARD }, sheet: call.sheet, inputs: [] });
    expectBeside(laid, VIEW, CARD, call.cells);
  });

  it('AC1 a cell click preselects its option and nothing else: the ask stays open and unanswered until the card\'s own click', async () => {
    const laid = view({ view: VIEW, card: { ask: handle, size: CARD }, sheet: call.sheet, inputs: [] });
    const clicks = [center(laid.cells[cellFor('fig-cool')]!), empty(laid.card, laid.sheet), center(laid.cells[cellFor('fig-mono')]!)];
    const run = view({ view: VIEW, card: { ask: handle, size: CARD }, sheet: call.sheet, inputs: clicks.map((click) => ({ click })) });
    expect(run.trace.map((s) => s.preselect), 'each cell click preselects its option; a click off the sheet keeps it').toEqual(['fig-cool', 'fig-cool', 'fig-mono']);
    expect(await onlyPreselects(world, handle, run), 'after the cell clicks the ask is still open, unanswered and undelivered').toEqual([]);
    // The card's own click, on the trusted path, is what answers; here it takes the preselected option.
    await world.asks.answer(app, handle, { option: run.trace.at(-1)!.preselect! });
    const answered = (await world.events()).filter((e) => e.kind === 'ask.answered' && e.subject === handle);
    expect(answered.map((e) => (e.data as { answer: string }).answer), 'the card\'s click records the answer').toEqual(['fig-mono']);
    expect(world.deliveries.filter((d) => d.ask === handle).map((d) => d.option), 'and it reaches the agent').toEqual(['fig-mono']);
    expect(optionsOf(call.ask).map((o) => o.id), 'the card offers every candidate and none of these').toEqual([...CANDIDATES.map((c) => c.option), noneOfThese(call.ask).id]);
  });

  it('AC1 a planted sheet whose cell click answers fails this check, naming the ask', async () => {
    const laid = view({ view: VIEW, card: { ask: handle, size: CARD }, sheet: call.sheet, inputs: [] });
    const run = view({ view: VIEW, card: { ask: handle, size: CARD }, sheet: call.sheet, inputs: [{ click: center(laid.cells[cellFor('fig-cool')]!) }], planted: 'cell_click_answers' });
    const failures = await onlyPreselects(world, handle, run);
    expect(failures.length, 'the check fails on the planted twin').toBeGreaterThan(0);
    expect(failures.join('\n'), 'and names the ask a cell click answered').toContain(handle);
  });

  it('AC1 deep-sheet view and deep-sheet taste answer bad_input to a line they can\'t read', () => {
    expectBadInput(SHEET_BIN, 'view');
    expectBadInput(SHEET_BIN, 'taste');
  });
});
