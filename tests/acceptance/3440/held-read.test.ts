// #3440, second criterion: with a second process holding one read open, events append until the write-ahead file is
// twice the limit. Within two commits after that read ends the file is at most the limit again. A planted record that
// sets the limit on a read-only connection and not on the writer's (the twin `wal-limit-on-reader`) stays large and
// fails, naming both sizes.
import { afterEach, expect, it } from 'vitest';
import { openRecordReader } from '../../../packages/record/src/index.ts';
import { AC, cleanup, fileRecord, FILL, holdRead, LIMIT, mib, sizes } from './helpers.ts';

afterEach(cleanup, 120_000);

it(`${AC.read} with a second process holding one read open, appends grow the write-ahead file to twice the 64 MiB limit, and within two commits after the read ends it is at most the limit again`, async () => {
  const { path, fill, commit } = await fileRecord();
  // The record's own read-only connection (#63's reader), open in this process for the whole test: the planted record
  // sets its limit there.
  const reader = openRecordReader({ path });
  try {
    const held = await holdRead(path);
    // About 2 MiB a commit. With no read held, SQLite starts the file over once a commit this size is checkpointed, so
    // it reaches twice the limit only while the read is open.
    const batch = 256;
    const most = Math.ceil((4 * LIMIT) / (batch * FILL));
    let commits = 0;
    while (sizes(path).wal < 2 * LIMIT && commits < most) {
      await fill(batch);
      commits += 1;
    }
    const grown = sizes(path).wal;
    expect(grown, `BLOCKED: with a second process holding a read open since log position ${held.first}, ${commits} commits of ${batch} events of ${FILL} characters left a write-ahead file of ${mib(grown)}, under twice the limit of ${mib(LIMIT)}: the read didn't hold the file`).toBeGreaterThanOrEqual(2 * LIMIT);

    await held.end();
    // The record's read-only connection reads once more, beside the writer, before the two commits.
    await reader.archived();
    await commit();
    await commit();

    const { wal, log } = sizes(path);
    expect(wal, `two commits after the second process's read ended, the write-ahead file is ${mib(wal)}, over the limit of ${mib(LIMIT)}; it was ${mib(grown)} while the read was open (the log's file is ${mib(log)})`).toBeLessThanOrEqual(LIMIT);
  } finally {
    reader.close();
  }
}, 900_000);
