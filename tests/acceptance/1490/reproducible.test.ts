// AC5 #1490.ea61d337: "Two exports stay byte-identical"
//
// asserts, on the 2D slider fixture on its recorded track, whose export picks `figure`:
//   - two exports, each a `deep-show run` in a clean home (a fresh HOME and TMPDIR, another USER and LOGNAME, nothing of
//     this shell but PATH), each with its own evidence store and its bundle at another path, the second at least 1.5 s
//     after the first: both receipts name `figure`, and the two bundles hold the same paths with the same bytes
//     (compared sorted, so file-system order can't enter), else the first differing file and byte offset are named;
//   - a third export in a clean home under #172's planted exporter `web_index_export_time` (it writes the export's
//     time into the index page) fails that comparison, naming index.html and the first byte offset that differs (the
//     comparison can fail).
// Wrong programs it fails: the merge base (its receipt names no set, so the bundles carry no `figure` player); a set
// picker or a set's bytes that bring a time, a path, a user, a host or a file order into the bundle (names the file
// and the byte).
import { describe, expect, it } from 'vitest';
import { FULL, TIMEOUT, bundleDifference, failsNaming, useShow, useTemp } from '../172/helpers.ts';
import { AC, FIGURE, cleanExport, pause } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const PLANTED = 'web_index_export_time';

describe(`${AC[5]} two exports of a piece in the figure set stay byte-identical`, () => {
  it(`${AC[5]} two exports of the 2D slider fixture in clean homes, both in ${FIGURE}, are byte-identical; the planted ${PLANTED} fails, naming index.html and the first differing byte`, () => {
    const first = cleanExport(shows(FULL), temp(), 'deep1490a', 1);
    pause(1_500);
    const second = cleanExport(shows(FULL), temp(), 'deep1490bb', 3);
    const diff = bundleDifference(first, second);
    expect(diff, `two exports of the 2D slider fixture in ${FIGURE} are byte-identical${diff ? `: ${diff}` : ''}`).toBeNull();

    pause(1_500);
    const planted = cleanExport(shows(FULL), temp(), 'deep1490c', 2, PLANTED);
    const pdiff = bundleDifference(first, planted);
    const failures = pdiff ? [`the bundles differ: ${pdiff}`] : [];
    failsNaming(failures, 'index.html', `the planted exporter ${PLANTED}`);
    expect(/byte \d+/.test(failures[0]!), `the failure names the first byte offset that differs: ${failures[0]}`).toBe(true);
  }, TIMEOUT);
});
