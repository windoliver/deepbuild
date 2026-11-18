// AC5: a drag over a failure line on a session's page then ⌘C gives its text; a drag over a row's title selects
// nothing (README, AC5).
import { describe, expect, it } from 'vitest';
import { acrossString, copyFailure, FAILURE_LINE, Replica, ROW_TITLE, SESSION, TAG, useDrive, wroteFailure } from './helpers.ts';

useDrive();

describe(`${TAG.ac5} AC5: a check's failure line copies; a row's title selects nothing`, () => {
  it('a drag over a row\'s title copies nothing, and a drag over the failure line copies its text', async () => {
    const r = await Replica.launch();
    await r.openSession(SESSION.fail);
    await r.visible({ text: FAILURE_LINE }, 'the session page\'s failure line');
    const failures: string[] = [];

    // Another session's row, in the list beside the page: its title is drawn once.
    const row = await acrossString(r, ROW_TITLE);
    await r.mark('dd1498-ac5-row');
    await r.drag(row.from, row.to, 'hid');
    const rowFailure = wroteFailure(`a drag over the row title ${JSON.stringify(ROW_TITLE)}, then ⌘C`, 'dd1498-ac5-row', await r.copy('hid', 'dd1498-ac5-row'));
    if (rowFailure) failures.push(rowFailure);

    // The press may have opened that row's page: the failing session's page again.
    await r.openSession(SESSION.fail);
    await r.visible({ text: FAILURE_LINE }, 'the session page\'s failure line');
    const line = await acrossString(r, FAILURE_LINE);
    await r.mark('dd1498-ac5-failure');
    await r.drag(line.from, line.to, 'hid');
    const lineFailure = copyFailure('a drag over the failure line, then ⌘C', FAILURE_LINE, await r.copy('hid', 'dd1498-ac5-failure'));
    if (lineFailure) failures.push(lineFailure);

    expect(failures).toEqual([]);
  });
});
