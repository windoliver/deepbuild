// AC3 #2856.168ff773: "Served untouched, the page's text holds no such line at the first view or at `ready`. A planted
// element that leaves the line in place fails, naming the text"
//
// "Such line" is the line the index page carries inside `<deep-player>` for a page whose script never ran (the issue's
// Scope; criterion 2): its text as the browser's own parser reads the served index page (DOMParser, which runs no
// script), collapsed. The lab's bundle (#172's fixture) is served untouched by the test server and opened with the
// shim, which only observes here: it keeps the page's text (helpers.ts `textOf(document.body)`) at the first view,
// right after the core's draw first reports a frame drawn (the player's first view, as the design and #1044 name the
// first frame the player draws), and at `ready` (helpers.ts `lineFailures`).
//
// asserts:
//   - the index page carries a line inside `<deep-player>` (at the base it carries none, so there is no line to look
//     for and the test fails there);
//   - the page's text at the first view and at `ready` doesn't hold that line;
//   - the planted element `web_element_leaves_line` fails that judgement, a failure naming the line's text.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { AC, FULL, PLANTED, TIMEOUT, bundleFailures, exportLab, failsNaming, lineFailures, none, usePages, useShow, useTemp } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const pages = usePages();

/** The lab exported to the web (by the planted export when named), its bundle checked against its receipt. */
function exported(planted?: string): string {
  const out = join(temp(), 'bundle');
  const what = `the lab${planted ? ` (planted ${planted})` : ''}`;
  const { receipt } = exportLab(shows(FULL), temp(), out, what, planted);
  none(bundleFailures(out, receipt, `${what}'s bundle`), `${what}: the bundle holds every file its receipt names, each by its hash`);
  return out;
}

describe(`${AC[3]} a page whose script ran never shows the line`, () => {
  it(`${AC[3]} served untouched, the page's text holds no such line at the first view or at ready`, async () => {
    const { failures } = await lineFailures(exported(), 'the lab, served untouched', pages);
    none(failures, 'the element removes the line before the player draws, and it stays gone');
  }, TIMEOUT);

  it(`${AC[3]} the planted element ${PLANTED.leavesLine}, which leaves the line in place, fails, naming the text`, async () => {
    const { line, failures } = await lineFailures(exported(PLANTED.leavesLine), `the lab, served untouched (planted ${PLANTED.leavesLine})`, pages);
    console.log(`${AC[3]} the planted element's failures:\n  ${failures.join('\n  ')}`);
    failsNaming(failures, line, `the planted element ${PLANTED.leavesLine}`);
  }, TIMEOUT);
});
