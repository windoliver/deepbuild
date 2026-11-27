// #3440, first criterion: on a record in a file, one commit that writes four times the limit, then one more commit: the
// write-ahead file is at most the limit. The same record with the pragma left at SQLite's default (planted: the twin
// `wal-limit-default`, and the merge base) holds a file at least four times the limit and fails, naming both sizes.
import { afterEach, expect, it } from 'vitest';
import { AC, cleanup, fileRecord, FILL, LIMIT, mib, sizes } from './helpers.ts';

afterEach(cleanup, 120_000);

it(`${AC.limit} on a record in a file, one commit that writes four times the 64 MiB limit and then one more commit leave a write-ahead file of at most the limit`, async () => {
  const { path, fill, commit } = await fileRecord();
  // Each event keeps FILL characters of its command in the log, so this many write over four times the limit of pages,
  // and appends made in one turn land in one commit.
  const count = Math.ceil((4 * LIMIT) / FILL);
  await fill(count);
  const written = sizes(path).wal;
  // The file SQLite leaves after that commit holds every page it wrote, until a later commit resets it. A record that
  // already truncated it is within the limit; anything between is not this criterion's commit.
  expect(written >= 4 * LIMIT || written <= LIMIT, `BLOCKED: one commit of ${count} events of ${FILL} characters was to write four times the limit, and the write-ahead file after it is ${mib(written)}: neither four times the limit of ${mib(LIMIT)} nor within it, so this isn't the commit the criterion names`).toBe(true);

  await commit();

  const { wal, log } = sizes(path);
  expect(wal, `after one commit that left a write-ahead file of ${mib(written)} and one more commit, the write-ahead file is ${mib(wal)}, over the limit of ${mib(LIMIT)} (the log's file is ${mib(log)})`).toBeLessThanOrEqual(LIMIT);
}, 900_000);
