// AC3: each Needs you row shows its ask's question, and a click on it presents that ask's question card in the window; a
// row that shows the ask's handle fails, naming the ask.
//
// A click is the press a screen reader sends a row (README: The surface). A fresh launch for each ask, so one ask's card
// never stands for another's. The card is judged by its own options, on the tree and on the pixels, since the question
// alone is already on the row under it.
import { describe, expect, it } from 'vitest';
import { App, appBinary, handleRows, makeWorld, nodes, ocr, reads, sees, settled, sleep, useCleanup, type Ask, type Plant, type World } from './helpers.ts';

useCleanup();
const MINUTES = 60_000;

/** What is wrong with one row and its card, naming the ask. */
async function rowFailures(world: World, ask: Ask, plant?: Plant): Promise<string[]> {
  const app = await App.launch({ home: world.home, binary: await appBinary(plant) });
  try {
    const handles = await settled(async () => {
      const tree = await app.tree();
      const found = handleRows(world, tree);
      return found.length ? found : tree.windows.flatMap((w) => nodes(w.tree)).some((n) => n.name.includes(ask.question)) ? [] : [`Needs you has no row showing ${ask.handle}'s question "${ask.question}"`];
    });
    if (handles.length) return handles;
    const windows = (await app.windows()).length;
    const press = await app.press(ask.question);
    if (!press.pressed) return [`${ask.handle}'s row took no click: ${JSON.stringify(press)}`];
    const others = world.asks.filter((a) => a !== ask).flatMap((a) => [a.option.label, a.other]);
    const failures = await settled(async () => {
      const out: string[] = [];
      const shown = (await app.tree()).windows.flatMap((w) => nodes(w.tree));
      for (const label of [ask.option.label, ask.other]) {
        if (!shown.some((n) => n.role === 'AXButton' && n.name.includes(label))) out.push(`a click on ${ask.handle}'s row presented no card with its option "${label}"`);
      }
      for (const label of others) if (shown.some((n) => n.name.includes(label))) out.push(`a click on ${ask.handle}'s row shows another ask's option "${label}"`);
      return out;
    }, 4000);
    if (failures.length) return failures;
    if ((await app.windows()).length !== windows) return [`${ask.handle}'s card opened a window of its own, not in the window`];
    await sleep(300);
    const lines = await ocr(await app.capture('card'));
    return [ask.option.label, ask.other].filter((label) => !reads(lines, label)).map((label) => `${ask.handle}'s card isn't on the window's pixels: they lack "${label}" and read ${sees(lines)}`);
  } finally {
    await app.stop();
  }
}

describe('#1172 Needs you shows questions and presents their cards', () => {
  it('AC3 each row shows its ask\'s question, and a click on it presents that ask\'s question card in the window', async () => {
    const world = await makeWorld();
    const failures: string[] = [];
    for (const ask of world.asks) failures.push(...await rowFailures(world, ask));
    expect(failures).toEqual([]);
  }, 12 * MINUTES);

  it('AC3 wrong program: a planted row that shows the ask\'s handle fails, naming the ask', async () => {
    const world = await makeWorld();
    const ask = world.asks[0]!;
    const failures = await rowFailures(world, ask, 'plant-handle-rows');
    expect(failures.join('\n'), 'the row that shows a handle fails the same judge, naming the ask').toContain(ask.handle);
    expect(failures.join('\n')).toMatch(/by its handle/);
  }, 8 * MINUTES);
});
