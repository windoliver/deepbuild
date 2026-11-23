// AC3: a press on a button's label fires the button and selects nothing; on a map a drag still pans and a double press
// still flies in, ⌥-drag on a label there selects its text, and a click on a figure's label then ⌘C copies the whole
// label (README, AC3).
import { describe, expect, it } from 'vitest';
import { acrossString, carets, center, copyFailure, doc, gridId, type Box, Replica, SESSION, TAG, textOf, useDrive, wroteFailure } from './helpers.ts';

useDrive();

const MAP = doc('map');
const FIGURE = doc('figure');
const LIGHT = textOf(MAP, 'dd-map-light');
const CAPTION = textOf(FIGURE, 'dd-fig-title');
/** A pan moves every item by the drag, in whole device pixels, within this much. */
const SLACK = 3;

const box = async (r: Replica, id: string): Promise<Box> => (await r.probe({ item: id }, `the map's ${id}`)).box;
const shift = (a: Box, b: Box): [number, number] => [b[0] - a[0], b[1] - a[1]];

describe(`${TAG.ac3} AC3: buttons keep their press; a map keeps its pan and fly-in; ⌥-drag and a click copy labels`, () => {
  it('fires the button and selects nothing; pans, flies in, copies a label by ⌥-drag and a figure\'s label by click', async () => {
    const r = await Replica.launch();
    await r.show(SESSION.map, MAP);
    await r.show(SESSION.figure, FIGURE);
    // The map's session hosts a terminal, so what the Terminal button opens draws a cell grid.
    await r.terminal(SESSION.map, { size: [40, 4], output: 'Harbor map export ready\r\n' });
    await r.openSession(SESSION.map);
    for (const id of ['dd-map-light', 'dd-map-market', 'dd-map-ferry']) await r.visible({ item: id }, `the map's ${id}`);
    const failures: string[] = [];

    // A press on the button's label fires the button: the Terminal tab opens and draws its grid.
    expect(await gridId(r), 'no terminal grid is drawn before the button is pressed').toBeNull();
    const label = await acrossString(r, 'Terminal');
    await r.click(center(label.box), 'hid');
    let opened = false;
    for (let i = 0; i < 40 && !opened; i++) {
      opened = (await gridId(r)) !== null;
      if (!opened) await r.wait(50);
    }
    if (!opened) failures.push('a click on the Terminal button\'s label didn\'t fire the button: no terminal grid was drawn within 2 s');
    // ...and selects nothing: a drag across the label, then ⌘C, leaves the clipboard as it was.
    const button = await acrossString(r, 'Terminal');
    await r.mark('dd1498-ac3-button');
    await r.drag(button.from, button.to, 'hid');
    const afterButton = wroteFailure('a drag across the Terminal button\'s label, then ⌘C', 'dd1498-ac3-button', await r.copy('hid', 'dd1498-ac3-button'));
    if (afterButton) failures.push(afterButton);

    // On the map a drag pans, even one that starts on a label's text, and selects nothing.
    const light0 = await box(r, 'dd-map-light');
    const market0 = await box(r, 'dd-map-market');
    const from = center(market0);
    const to: [number, number] = [from[0] + 160, from[1] + 60];
    await r.mark('dd1498-ac3-pan');
    await r.drag(from, to, 'hid');
    for (const [id, before] of [['dd-map-light', light0], ['dd-map-market', market0]] as const) {
      const [dx, dy] = shift(before, await box(r, id));
      if (Math.abs(dx - 160) > SLACK || Math.abs(dy - 60) > SLACK) failures.push(`a drag by [160, 60] on the map moved ${id} by [${dx}, ${dy}]: the drag didn't pan`);
    }
    const afterPan = wroteFailure('a drag on the map from a label\'s text, then ⌘C', 'dd1498-ac3-pan', await r.copy('hid', 'dd1498-ac3-pan'));
    if (afterPan) failures.push(afterPan);

    // ⌥-drag on a label there selects its text, and doesn't pan.
    const light1 = await box(r, 'dd-map-light');
    const across = await carets(r, 'dd-map-light', 0, 'dd-map-light', LIGHT.length);
    await r.mark('dd1498-ac3-alt');
    await r.drag(across.from, across.to, 'hid', ['alt']);
    const altFailure = copyFailure('⌥-drag across the map\'s label, then ⌘C', LIGHT, await r.copy('hid', 'dd1498-ac3-alt'));
    if (altFailure) failures.push(altFailure);
    const [ax, ay] = shift(light1, await box(r, 'dd-map-light'));
    if (Math.abs(ax) > 1 || Math.abs(ay) > 1) failures.push(`a ⌥-drag across the map's label moved it by [${ax}, ${ay}]: it panned`);

    // A double press on the map still flies in: the place pressed fills much more of the view.
    const ferry0 = await box(r, 'dd-map-ferry');
    await r.doubleClick(center(ferry0), 'hid');
    await r.wait(1_500);
    const ferry1 = await box(r, 'dd-map-ferry');
    if (ferry1[2] < 2 * ferry0[2]) failures.push(`a double press on the map's "Ferry Terminal" didn't fly in: its box went from ${JSON.stringify(ferry0)} to ${JSON.stringify(ferry1)}, under twice as wide`);

    // A click on a figure's label, then ⌘C, copies the whole label.
    await r.openSession(SESSION.figure);
    await r.visible({ item: 'dd-fig-title' }, 'the figure\'s caption');
    await r.mark('dd1498-ac3-figure');
    await r.click(center((await r.probe({ item: 'dd-fig-title' }, 'the figure\'s caption')).box), 'hid');
    const figureFailure = copyFailure('a click on the figure\'s label, then ⌘C', CAPTION, await r.copy('hid', 'dd1498-ac3-figure'));
    if (figureFailure) failures.push(figureFailure);

    expect(failures).toEqual([]);
  });
});
