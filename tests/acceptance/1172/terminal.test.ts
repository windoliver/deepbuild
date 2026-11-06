// AC4, its second half: a terminal tab draws its rows through the cell grid; a planted tab that writes its text outside
// the grid fails, naming the tab, judged on the window's pixels, not on a label in a reply.
//
// The fixture's terminal, held by the hub's canvas core for the first session, printed cells of three backgrounds at
// known columns and rows (helpers.ts, FEED), behind ten thin and ten wide glyphs. On a grid of equal cells those fills
// keep exact proportions: five cells are five times one, a gap of two is two, and the cell after ten `i`s sits exactly
// above the cell after ten `W`s. Text written anywhere else has no such fills and no such column. The rule is the
// pixels' own: nothing here assumes a cell's size, and the hub's reply gives only the colors the cells asked for.
import { describe, expect, it } from 'vitest';
import { App, appBinary, canvasUser, gridLaw, makeWorld, ocr, reads, sees, settled, sleep, useCleanup, type Picture, type Plant, type Rgb, type World } from './helpers.ts';

useCleanup();
const MINUTES = 60_000;
const TAB = 'the terminal tab';

/** The color the hub's terminal holds for a cell, as `#rrggbb` becomes bytes. */
async function cellColor(world: World, x: number, y: number): Promise<Rgb> {
  const cell = await canvasUser(world, { call: 'cell', session: world.sessions[0]!.id, tab: 'terminal', x, y });
  const bg = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(cell.bg));
  if (!bg) throw Error(`BLOCKED: the hub's canvas core gave no color for cell ${x},${y}: ${JSON.stringify(cell)}`);
  return [Number.parseInt(bg[1]!, 16), Number.parseInt(bg[2]!, 16), Number.parseInt(bg[3]!, 16)];
}

/** What is wrong with the tab on the pixels: the grid's law (helpers.ts), and its first row read off them. */
async function gridFailures(world: World, picture: Picture): Promise<string[]> {
  const out = gridLaw(picture, await cellColor(world, 0, 1), await cellColor(world, 7, 1), await cellColor(world, 10, 2));
  const lines = await ocr(picture);
  if (!out.length && !reads(lines, 'grid says hello')) out.push(`${TAB}: its first row isn't on the window's pixels: they read ${sees(lines)}`);
  return out;
}

/** Opens the first session's page and its terminal tab with a person's clicks, then judges the window. */
async function tabFailures(world: World, plant?: Plant): Promise<string[]> {
  const app = await App.launch({ home: world.home, binary: await appBinary(plant) });
  try {
    const row = await settled(async () => ((await app.press(world.sessions[0]!.task, 'AXButton')).pressed ? [] : [`${TAB} can't be reached: the sidebar has no row "${world.sessions[0]!.task}" to click`]));
    if (row.length) return row;
    const tab = await settled(async () => ((await app.press('Terminal')).pressed ? [] : [`${TAB} can't be reached: the session's page has no "Terminal" tab to click`]));
    if (tab.length) return tab;
    await sleep(500);
    return await settled(async () => gridFailures(world, await app.capture('terminal')), 6000);
  } finally {
    await app.stop();
  }
}

describe('#1172 a terminal tab draws in the app', () => {
  it('AC4 a terminal tab draws its rows through the cell grid, on the window\'s pixels', async () => {
    expect(await tabFailures(await makeWorld())).toEqual([]);
  }, 8 * MINUTES);

  it('AC4 wrong program: a planted tab that writes its text outside the grid fails, naming the tab', async () => {
    const failures = await tabFailures(await makeWorld(), 'plant-tab-text');
    expect(failures.join('\n'), 'the planted tab fails the same pixel judge').toMatch(/the terminal tab wrote its text outside the cell grid|the terminal tab: /);
  }, 8 * MINUTES);
});
