// AC6: an ellipsized text copies its whole source string; a bound number copies what's shown, with its unit (README, AC6).
import { describe, expect, it } from 'vitest';
import { center, copyFailure, doc, Replica, SESSION, TAG, textOf, useDrive } from './helpers.ts';

useDrive();

const FIGURE = doc('figure');
const LONG = textOf(FIGURE, 'dd-fig-long');
// data/p95 is 12.46, shown at one decimal with its unit: 12.5 and ms (Bound value, format; the base's formatter puts a
// space between them). A copy of the source number, 12.46, or of the number alone fails.
const SHOWN = /^12\.5[   ]ms$/;

describe(`${TAG.ac6} AC6: an ellipsized text copies its whole source; a bound number copies what's shown, with its unit`, () => {
  it('a click then ⌘C copies the whole source string of a cut text, and the shown number with its unit', async () => {
    expect(LONG.length * 14 * 0.4, 'the fixture\'s text is far wider than its box, so it draws cut').toBeGreaterThan(2 * (FIGURE.items['dd-fig-long'].params.box.w as number));
    const r = await Replica.launch();
    await r.show(SESSION.figure, FIGURE);
    await r.openSession(SESSION.figure);
    for (const id of ['dd-fig-long', 'dd-fig-p95']) await r.visible({ item: id }, `the figure's ${id}`);
    const failures: string[] = [];

    await r.mark('dd1498-ac6-long');
    await r.click(center((await r.probe({ item: 'dd-fig-long' }, 'the ellipsized text')).box), 'hid');
    const longFailure = copyFailure('a click on the ellipsized text, then ⌘C', LONG, await r.copy('hid', 'dd1498-ac6-long'));
    if (longFailure) failures.push(longFailure);

    await r.mark('dd1498-ac6-number');
    await r.click(center((await r.probe({ item: 'dd-fig-p95' }, 'the bound number')).box), 'hid');
    const number = await r.copy('hid', 'dd1498-ac6-number');
    if (number === null || !SHOWN.test(number)) failures.push(`a click on the bound number, then ⌘C: the clipboard holds ${JSON.stringify(number)}, not what's shown, 12.5 with its unit ms`);

    expect(failures).toEqual([]);
  });
});
