# Twins for the 3440 tests

No implementation existed when these tests were drafted, so no twin folder is here yet. Each twin is the merged
implementation with exactly one rule broken as below, and nothing else changed. A twin changes product files only, never
a file under `tests/`, and is kept as its wrong lines in `twins/<name>/lines.json` (the line form,
`tests/acceptance/1832/README.md`), never as a whole copy of a file. "Replaces" names the files its lines change, as the
base has them; the implementer names the real ones.

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#3440.e48b80ad` | `wal-limit-default` | `packages/record/src/storage.ts` (where the writer's connection is settled) | The pragma is left at SQLite's default: the writer's connection sets no `journal_size_limit` (−1, no limit), as on the merge base. Everything else is as shipped | `wal-limit.test.ts`, its last assertion: `after one commit that left a write-ahead file of <n> bytes … and one more commit, the write-ahead file is <n> bytes …, over the limit of 67108864 bytes (64.0 MiB)`, the file at least four times the limit |
| `#3440.fd63704e` | `wal-limit-on-reader` | `packages/record/src/storage.ts` (`openReadOnly` and the writer's settings) | `journal_size_limit` is set on the record's read-only connections (`openReadOnly`, which `openRecordReader` opens) and not on the writer's. A read-only connection never resets the file, so the limit does nothing | `held-read.test.ts`, its last assertion: `two commits after the second process's read ended, the write-ahead file is <n> bytes …, over the limit of 67108864 bytes (64.0 MiB); it was <n> bytes … while the read was open` |
| `#3440.bc903f14` | `size-log-file-alone` | the file that holds `recordSize` (`packages/record/src`) | The reading takes the log's file alone: it leaves the write-ahead file's bytes out | `size.test.ts`, its last assertion: `the record's size reads <n> bytes …; its log's file is <n> bytes … and its write-ahead file <n> bytes …, <n> bytes … together: the reading is <n> bytes short of the two together, more than one page of 4096 bytes` |

The merge base is itself `wal-limit-default`, and fails the first two tests at those assertions (`../BASE-FAILURE.txt`).
`size-log-file-alone` can only exist on the change: the merge base has no reading, and fails `size.test.ts` one
assertion earlier, at the missing export. All three faults were planted in a throwaway copy of the record's source (see
`../README.md`, How the tests were checked) and failed the test named, at that assertion.

`#3440.e9dfc29b` (the budget) has no twin: its wrong program is the merge base, whose two tasks don't name it.
