// AC8: a chart's readout is in the tree, and the visible caption isn't repeated beside it. The session page's chart, through
// the real deep-drive over fixtures/record.events.jsonl: its canvas text items (#390's shape) against the tree `see` returns.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup } from '../16/helpers.ts';
import { chartFailures, driveBinary, ID, RECORD, requireMacos, see, SESSION_PAGE, textItems } from './helpers.ts';

afterAll(() => cleanup(), 60_000);
const MIN = 60_000;

describe(`AC8 ${ID.chart} A chart's readout is in the tree, and the visible caption isn't repeated beside it`, () => {
  it('AC8 on a session\'s page, the chart\'s readout is named where it\'s drawn and its caption is named once', async () => {
    requireMacos();
    expect(chartFailures(await see(await driveBinary(), RECORD, SESSION_PAGE))).toEqual([]);
  }, 30 * MIN);

  it('AC8 wrong program: the chart\'s text in the tree with the hand-written label kept beside it (plant-chart-label-beside) fails, naming the caption', async () => {
    requireMacos();
    const snapshot = await see(await driveBinary('plant-chart-label-beside'), RECORD, SESSION_PAGE);
    const caption = textItems(snapshot).find((i) => !i.bound);
    expect(caption, 'the planted page still draws its chart').toBeDefined();
    expect(chartFailures(snapshot).join('\n')).toContain(`the chart's caption "${caption!.text}" is named by 2 nodes`);
  }, 30 * MIN);
});
