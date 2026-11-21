// AC2 #2856.7e832739: "The test server gives the element's script as `text/plain`, and in a second run changes one byte
// of it. In each, the page shows the line and its link, and the link opens the bundle's fallback page. On the merge base
// both pages show nothing, and this test fails"
//
// The lab's bundle (#172's fixture), served by the test server with every file as written but the element's script
// (the index page's one module script with a src): in the first run it goes out as `text/plain`, in the second with its
// last byte changed (helpers.ts `oneByte`) under its own type. The browser refuses it either way, so no script of the
// bundle runs; the test checks that the server sent it so and that `<deep-player>` stayed undefined (the refusal)
// (helpers.ts `refusedFailures`).
//
// asserts, for each run:
//   - the page shows the line: `<deep-player>` holds text, shown, in one line (its rendered text, `innerText`, is one
//     non-empty line), with a link (`<a href>`) inside it, shown, to the bundle's fallback page (the receipt's file
//     marked `fallback: "index"`, #1040's);
//   - the link, clicked at its centre as a pointer clicks (nothing covers it there), opens that page: the tab, or a
//     page the click opens, shows `/<the fallback page's path>`, which the server sent with the receipt's SHA-256.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  AC, FULL, TIMEOUT, bundleFailures, elementScriptOf, exportLab, fallbackPage, none, oneByte, refusedFailures, sha256, usePages, useShow, useTemp,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const pages = usePages();
const hex = (b: number): string => `0x${b.toString(16).padStart(2, '0')}`;

describe(`${AC[2]} a page whose element script the browser refused shows the line and its link to the fallback page`, () => {
  it(`${AC[2]} the element's script served as text/plain, then with one byte changed: each page shows the line and its link, and the link opens the bundle's fallback page`, async () => {
    const out = join(temp(), 'bundle');
    const { receipt } = exportLab(shows(FULL), temp(), out, 'the lab');
    none(bundleFailures(out, receipt, 'the lab\'s bundle'), 'the lab: the bundle holds every file its receipt names, each by its hash');
    const script = elementScriptOf(readFileSync(join(out, 'index.html'), 'utf8'), 'the lab\'s bundle');
    const fallback = fallbackPage(receipt, 'the lab\'s receipt');
    const bytes = readFileSync(join(out, script.path));
    const original = sha256(bytes);
    const change = oneByte(bytes);
    const failures = [
      ...await refusedFailures(out, { path: script.path, type: 'text/plain' }, original, fallback, 'served as text/plain', pages),
      ...await refusedFailures(out, { path: script.path, change }, original, fallback, `served with one byte changed (byte ${change.at}, ${hex(bytes[change.at]!)} to ${hex(change.to)})`, pages),
    ];
    none(failures, 'each page whose element script the browser refused shows the line and its link, and the link opens the fallback page');
  }, TIMEOUT);
});
