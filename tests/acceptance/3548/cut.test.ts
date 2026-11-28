// #3548.3ae8d7b0 (criterion 4): "The bundle's text of a log starts at the start of a line. A planted reader that cuts
// by bytes alone starts mid-line and fails, naming the first characters". With the Scope's second line, which the cut
// comes from: "`deep debug bundle` reads each log from its end, at most 8 MB of each (drafted), cut at the start of a
// line ... The bundle says how many bytes of each log it left out".
//
// Two logs are made once for the file, each past the cut, of planted lines whose lengths differ (fixtures/lines.mjs):
// logs/hub.log, 12 MB, and logs/second.log, 10 MB. They are laid so that no byte count is a line's start in both
// (README: The two logs): in hub.log every line with its line end is an even number of bytes, so each line starts an
// even number of bytes from the log's end; second.log is the same but for its last line, one byte longer, so each of
// its lines starts an odd number of bytes from its end. A reader that keeps the last N bytes of each log therefore
// starts inside a line, or on a line's end, in one of them, whatever N is.
//
// No hub runs. `deep debug bundle` is the built CLI with HOME the temporary home; the bundle is the file whose path
// it prints last, and its text of a log is the string in it that holds that log's last line (README: The bundle).

import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  built, bundle, cleanup, CUT_LIMIT, heldOf, makeHome, makeLog, mb, newTag, readBundle, shown, tidy, type Bundled, type Held, type Home, type Layout,
} from './helpers.ts';

const ID = '#3548.3ae8d7b0';
const SCOPE = '#3548.a664c633 #3548.3ae8d7b0';
const PLANT = 'bundle-cuts-by-bytes';

let h: Home;
let logs: { name: string; layout: Layout }[];
let plain: Bundled;
beforeAll(async () => {
  built();
  h = makeHome();
  logs = [
    { name: 'logs/hub.log', layout: makeLog(join(h.root, 'logs', 'hub.log'), { tag: newTag(), bytes: 12_000_000, even: true }) },
    { name: 'logs/second.log', layout: makeLog(join(h.root, 'logs', 'second.log'), { tag: newTag(), bytes: 10_000_000, even: true, lastExtra: 1 }) },
  ];
  plain = await bundle(h, {}, { timeoutMs: 600_000 });
}, 900_000);
afterAll(cleanup, 120_000);

/** What a run's bundle holds of each of the two logs; fails when the run made no bundle that can be read. */
function read(made: Bundled, what: string): Held[] {
  expect(made.ran.code, `${what} exits 0: ${shown(made.ran)}`).toBe(0);
  expect(made.path, `${what} prints its bundle's path last: ${tidy(made.ran.stdout.slice(-600))}`).toBeDefined();
  const b = readBundle(made.path!);
  expect(b.tooBig, `the bundle, ${mb(b.bytes)} on disk, inflates to under 128 MiB`).toBe(false);
  return logs.map(({ name, layout }) => heldOf(b, name, layout));
}
/** Each log whose text in the bundle doesn't start at the start of a line, with the text's first characters. */
const midLine = (held: readonly Held[]): string[] => held.flatMap((x) => (x.cut?.midLine === undefined ? [] : [`the bundle's text of ${x.name} starts mid-line, with ${JSON.stringify(x.cut.midLine)}: ${x.cut.fragment} byte${x.cut.fragment === 1 ? '' : 's'} of line ${x.cut.first - 1} come before line ${x.cut.first}, its first whole line`]));
/** Each log the bundle holds no whole line of: a bundle that holds no log proves nothing about where its text starts. */
const absent = (held: readonly Held[]): string[] => held.flatMap((x) => (x.cut ? [] : [`the bundle holds no text of ${x.name}: no string in it holds the log's last line and a whole line of it`]));

describe(`${ID} the bundle's text of a log starts at the start of a line`, () => {
  it(`${ID} with two logs past the cut, the bundle's text of each holds the log's last line and starts at the start of a line`, () => {
    const held = read(plain, 'deep debug bundle');
    expect(absent(held), 'the bundle holds each log').toEqual([]);
    // A reader that cuts by bytes alone fails here, naming the first characters of the text that starts mid-line.
    expect(midLine(held), 'where each log\'s text starts').toEqual([]);
  }, 300_000);

  it(`${SCOPE} (Scope) the bundle holds each log from its end, line for line to its last, at most 8 MB of it, and says how many bytes of it it left out`, () => {
    const held = read(plain, 'deep debug bundle');
    expect(absent(held), 'the bundle holds each log').toEqual([]);
    const problems = held.flatMap((x) => {
      const cut = x.cut!;
      return [
        ...(cut.toEnd ? [] : [`the bundle's text of ${x.name} is not the log's end, line for line to its last line${cut.differs ? `: where line ${cut.differs.number} should be it has ${JSON.stringify(cut.differs.got)}` : ''}`]),
        // The merge base fails here: it holds each log whole.
        ...(cut.kept <= CUT_LIMIT ? [] : [`the bundle holds ${mb(cut.kept)} of ${x.name}, a log of ${mb(x.layout.bytes)}; it reads at most 8 MB of each log (${CUT_LIMIT.toLocaleString('en-US')} bytes)`]),
        ...(x.stated ? [] : [`the bundle doesn't say how many bytes of ${x.name} it left out: ${cut.leftOut.toLocaleString('en-US')}, the ${mb(x.layout.bytes)} less the ${mb(cut.kept)} it holds from line ${cut.first} on`]),
      ];
    });
    expect(problems, 'what each log\'s text holds').toEqual([]);
  }, 300_000);

  it(`${ID} (wrong program) a reader that cuts by bytes alone, DEEP_CLI_PLANT=${PLANT}, starts mid-line in one of the two logs and fails the same reading, naming the first characters`, async () => {
    const made = await bundle(h, { DEEP_CLI_PLANT: PLANT }, { timeoutMs: 600_000 });
    const held = read(made, `deep debug bundle with DEEP_CLI_PLANT=${PLANT}`);
    expect(absent(held), 'the planted bundle holds each log').toEqual([]);
    const named = midLine(held);
    // The merge base knows no such planted program: its bundle holds each log from its first line, and the test fails here.
    expect(named.length, `the reading names a log whose text starts mid-line, with its first characters; it found: ${named.join('\n') || 'every text starting at the start of a line'}`).toBeGreaterThan(0);
    expect(named.join('\n'), 'each names the text\'s first characters').toMatch(/starts mid-line, with "[^"]/);
  }, 900_000);
});
