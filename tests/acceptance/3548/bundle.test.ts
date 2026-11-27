// #3548.a664c633 (criterion 3): "With a `logs/hub.log` of 600 MB, `deep debug bundle` exits 0, stays under 256 MB
// resident (drafted), and its bundle holds the log's last line and the bytes it left out. On the merge base it ends on
// the string-length error and writes no bundle, and the test fails, naming the error". With the Scope's second line:
// "reads each log from its end, at most 8 MB of each (drafted) ... The bundle says how many bytes of each log it left
// out".
//
// The log is made once, a few megabytes at a time and never held whole: planted lines (fixtures/lines.mjs) numbered
// from 0 in ~/.deepbuild/logs/hub.log of a temporary home, 600,000,156 bytes, 2,830,190
// lines, each with its own number, so its last line is no other line. No hub runs. `deep debug bundle` is the built
// CLI as a child process under `time`, which reads its peak resident memory; the bundle is the file whose path it
// prints last. The peak is printed on both sides before anything is judged: the Proof asks for it.

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { built, bundle, cleanup, CUT_LIMIT, heldOf, makeHome, makeLog, mb, newTag, readBundle, RESIDENT_LIMIT, shown, stringLengthError, tidy } from './helpers.ts';

afterEach(cleanup, 120_000);

const ID = '#3548.a664c633';
const SIZE = 600_000_000;

describe(`${ID} deep debug bundle on a 600 MB log`, () => {
  it(`${ID} with a logs/hub.log of 600 MB, deep debug bundle exits 0, stays under 256 MB resident, and its bundle holds the log's last line, at most 8 MB of the log from its end, and the bytes it left out`, async () => {
    built();
    const h = makeHome();
    const log = makeLog(join(h.root, 'logs', 'hub.log'), { tag: newTag(), bytes: SIZE });
    expect(statSync(log.path).size, 'the made log is its 600 MB').toBe(log.bytes);

    const made = await bundle(h, {}, { measure: true, timeoutMs: 1_500_000 });
    const peak = made.peakBytes;
    const error = stringLengthError(made.ran);
    console.log(`#3548 deep debug bundle on a logs/hub.log of ${mb(log.bytes)}: exit ${made.ran.code}${error ? `, "${error}"` : ''}, ${made.path ? 'a bundle' : 'no bundle'}, peak resident memory ${peak === undefined ? 'not read' : mb(peak)}`);

    // On the merge base it reads the log whole as one string and ends on the string-length error, and the test fails here, naming it.
    expect(made.ran.code, `deep debug bundle on a logs/hub.log of ${mb(log.bytes)} exits 0; it ${error ? `ended on the string-length error "${error}"` : 'ended otherwise'}, with ${made.path ? 'a bundle' : 'no bundle'} and a peak resident memory of ${peak === undefined ? 'no reading' : mb(peak)}: ${shown(made.ran)}`).toBe(0);
    expect(made.path, `deep debug bundle prints its bundle's path last: ${tidy(made.ran.stdout.slice(-600))}`).toBeDefined();
    expect(peak, `/usr/bin/time read the command's peak resident memory (BLOCKED where this system has no such time): ${tidy(made.ran.stderr.slice(-800))}`).toBeDefined();
    expect(peak!, `deep debug bundle's peak resident memory on a 600 MB log is ${mb(peak!)}; it stays under 256 MB (${RESIDENT_LIMIT.toLocaleString('en-US')} bytes)`).toBeLessThan(RESIDENT_LIMIT);

    const b = readBundle(made.path!);
    expect(b.tooBig, `the bundle, ${mb(b.bytes)} on disk, inflates to under 128 MiB: it holds the end of the log, not the log`).toBe(false);
    const held = heldOf(b, 'logs/hub.log', log);
    const last = log.line(log.count - 1);
    // A bundle that holds no log fails here.
    expect(held.text !== undefined && held.cut !== undefined, `the bundle holds the log's last line, "${last.slice(0, 64)}…", in its text of the log`).toBe(true);
    const cut = held.cut!;
    expect(cut.toEnd, `the bundle's text of the log is the log's end, line for line to its last line${cut.differs ? `; where line ${cut.differs.number} should be it has "${cut.differs.got}"` : ''}`).toBe(true);
    expect(cut.kept, `the bundle holds ${mb(cut.kept)} of the log; it reads at most 8 MB of each log (${CUT_LIMIT.toLocaleString('en-US')} bytes)`).toBeLessThanOrEqual(CUT_LIMIT);
    expect(held.stated, `the bundle says how many bytes of logs/hub.log it left out: ${cut.leftOut.toLocaleString('en-US')}, the ${mb(log.bytes)} less the ${mb(cut.kept)} it holds from line ${cut.first} on; the numbers it holds: ${b.numbers.slice(0, 20).join(', ') || 'none'}`).toBe(true);
  }, 2_400_000);
});
