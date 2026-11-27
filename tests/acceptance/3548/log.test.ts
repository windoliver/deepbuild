// #3548.2789a2c7 (criterion 1): "A dev hub planted to write 200 MB of lines to its log: `logs/` is at or under the
// limit throughout, the newest line is there whole, and no kept line is cut. On the merge base the folder holds 200 MB,
// and the test fails, naming the size". With the Scope's first line: "the hub's log keeps its newest lines whole, and
// the oldest leave first. It holds ... for a dev hub".
//
// The dev hub is the product's: `deep hub start --root <folder>`, which wires the hub's log as it wires it. What
// makes it write is the planted writer (fixtures/writer.mjs, README: The planted writer), loaded into the hub's
// process through the environment the start runs in: one process.stderr.write a line, as the hub writes its own, a
// few hundred lines a turn of its event loop, 200 MiB in all. It works on the merge base as it stands, where the
// start sends the hub's standard error to logs/hub.log and nothing cuts it.
//
// While the hub writes, the size of everything under <root>/logs is read every 20 ms. Once the writer says its last
// write was taken, the logs are read back a line at a time (gzip inflated), whatever files the hub keeps them in.

import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { built, cleanup, deep, filesShown, hubPid, LOGS_LIMIT, makeHome, mb, MIB, newTag, own, pause, readLogs, shown, tail, tidy, until, watchFolder, write, writerEnv } from './helpers.ts';

afterEach(cleanup, 120_000);

const ID = '#3548.2789a2c7';
const WRITTEN = 200 * MIB;

describe(`${ID} a dev hub that writes 200 MB of lines keeps logs/ at or under the limit`, () => {
  it(`${ID} a dev hub planted to write 200 MB of lines to its log: logs/ is at or under 64 MB throughout, the newest line is there whole, no kept line is cut, and the kept lines are the newest ones`, async () => {
    built();
    const h = makeHome();
    const root = join(h.tmp, 'dev');
    const logs = join(root, 'logs');
    const started = await deep(h, ['hub', 'start', '--root', root], { env: writerEnv(h), timeoutMs: 300_000 });
    // A start that gave up on a busy machine may still have started the hub: it is given two minutes more to answer.
    const pid = await until(() => hubPid(h, root), 120_000);
    own(pid);
    expect(pid, `deep hub start --root <folder> starts a dev hub that answers deep hub status: ${shown(started)}\n${tail(logs)}`).toBeDefined();

    const tag = newTag();
    const watch = watchFolder(logs);
    const wrote = await write(h, pid!, { tag, from: 1, bytes: WRITTEN });
    // The newest line lands in the log: a hub that takes a line in and writes it a moment later is given a minute.
    let reading = await readLogs(logs, tag, wrote.to);
    for (const end = Date.now() + 60_000; !reading.has(wrote.to) && Date.now() < end;) {
      await pause(250);
      reading = await readLogs(logs, tag, wrote.to);
    }
    const watched = watch.stop();
    const most = watched.peak.bytes > reading.bytes ? watched.peak : { bytes: reading.bytes, files: reading.files.length };
    console.log(`#3548 dev hub: wrote ${mb(wrote.bytes)} in ${wrote.lines} lines; logs/ held ${mb(watched.peak.bytes)} at the largest of ${watched.samples} readings and ${mb(reading.bytes)} once written: ${filesShown(reading)}`);

    // A hub that wrote nothing, or whose lines went nowhere, holds to any limit: it fails here.
    expect(wrote.bytes, 'the planted hub wrote its 200 MB of lines').toBeGreaterThanOrEqual(WRITTEN);
    expect(reading.planted, `the hub's log, under ${tidy(logs)}, holds lines the hub wrote: ${filesShown(reading)}`).toBeGreaterThan(0);
    // On the merge base nothing cuts the log, the folder holds the 200 MB, and the test fails here, naming the size.
    expect(most.bytes, `logs/ holds ${mb(most.bytes)} in ${most.files} file${most.files === 1 ? '' : 's'} after a dev hub wrote ${mb(wrote.bytes)} of lines to its log; the limit is 64 MB (at most ${LOGS_LIMIT.toLocaleString('en-US')} bytes), at every reading`).toBeLessThanOrEqual(LOGS_LIMIT);
    expect(reading.has(wrote.to), `the newest line, number ${wrote.to}, is in the log whole; the newest whole line there is number ${reading.last}: ${filesShown(reading)}`).toBe(true);
    expect(reading.cutFirst, `${reading.cut} kept line${reading.cut === 1 ? ' is' : 's are'} cut: each holds part of a line the hub wrote, not the whole of it`).toEqual([]);
    expect({ missing: reading.missing, first: reading.missingFirst }, `the kept lines are the newest ones, numbers ${reading.first} to ${reading.last} with none missing between them: the oldest leave first`).toEqual({ missing: 0, first: [] });
  }, 1_800_000);
});
