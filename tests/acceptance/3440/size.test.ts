// #3440, third criterion: the record's size as the budget reads it equals the two files' bytes together, within one
// page. A planted reading that takes the log's file alone (the twin `size-log-file-alone`) is short by the write-ahead
// file's bytes and fails, naming both.
//
// The reading is `recordSize(path)`, on the record package's public entry: the bytes of the record at `path`, its log's
// file and its write-ahead file together (README.md, Surfaces). The merge base has no such reading.
import { afterEach, expect, it } from 'vitest';
import * as recordPackage from '../../../packages/record/src/index.ts';
import { AC, cleanup, fileRecord, mib, pageSize, sizes } from './helpers.ts';

afterEach(cleanup, 120_000);

it(`${AC.size} the record's size as the budget reads it is the log's file and its write-ahead file together, within one page`, async () => {
  const { path, fill } = await fileRecord();
  // One commit of about 2.5 MiB of pages: under the 1,000 pages at which SQLite checkpoints by itself, so they stay in
  // the write-ahead file and the log's file stays small. Nothing writes the record after it.
  await fill(200);
  const page = pageSize(path);
  const before = sizes(path);
  expect(before.wal, `BLOCKED: the write-ahead file holds ${before.wal} bytes after a commit of 200 events, not more than a page of ${page}, so a reading without it couldn't be told from one with it`).toBeGreaterThan(page);

  const recordSize = (recordPackage as unknown as { recordSize?: (path: string) => number | Promise<number> }).recordSize;
  expect(typeof recordSize, "the record package's public entry exports recordSize(path), the record's size as the budget reads it: it exports none").toBe('function');
  const read = await recordSize!(path);
  const after = sizes(path);
  expect(after, 'BLOCKED: the two files changed while the size was read, though nothing appended').toEqual(before);

  const together = before.log + before.wal;
  expect(Number.isFinite(read) && Math.abs(read - together) <= page, `the record's size reads ${mib(read)}; its log's file is ${mib(before.log)} and its write-ahead file ${mib(before.wal)}, ${mib(together)} together: the reading is ${together - read} bytes short of the two together, more than one page of ${page} bytes`).toBe(true);
}, 120_000);
