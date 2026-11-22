# Acceptance tests for #2869: a throttle waiter waits on through a full disk

These tests were drafted blind from issue #2869 (its text on 2026-11-19), `docs/parallel-proof.md` section 6, the
Dogfooding part of `docs/technical-design.md`, AGENTS.md and the base commit `6a2b68d44`, which has no
implementation. At the base I also read `scripts/throttle.mjs` and `tests/acceptance/2744/` for style. The helpers
are written here, never imported from another suite, and no test imports the code under test: `scripts/throttle.mjs`
is run as a process. Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a blind
redraft by this job.

Run them with:

```sh
node --test 'tests/acceptance/2869/*.test.mjs'
```

They must run under `node --test`, since section 6 lets a request use `DEEP_THROTTLE_TABLE` only inside a test run.
All 7 are offline, on real processes: `throttle.mjs` itself and stub commands (a small node script that notes when it
starts and holds until a stop file appears). The suite took 10 s on the base and 27 s with the reference fix on this
Mac at a load of 28 to 45; the longest test took about 10 s. On the base, 5 fail at their assertions and the 2 for
"any other error" pass, as they should (`BASE-FAILURE.txt`).

**No test reads or writes the live table at `~/.deepbuild/throttle/`.** Every `throttle.mjs` process gets
`DEEP_THROTTLE_TABLE` pointed at a fresh folder in the test's temp sandbox, a temporary `HOME` in that sandbox, and
`DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_PROOF_VITEST_REPORT` and `NODE_OPTIONS` unset. Each
process starts in its own process group, and after the test only those groups are stopped, by their PIDs.

## The surface (my choice where the issue leaves it open)

- **CLI.** `node scripts/throttle.mjs test --wait <min> -- <command ...>`, as on the base. The waiter's outcomes are
  the base's: its command's exit status once granted, `INCONCLUSIVE no grant` as the first stdout line and exit 3
  when the wait runs out, and a `BLOCKED throttle: <the error's message>` line with exit 2 for any other error.
- **Waiting.** A waiter is a request in `<table folder>/table.json`'s `requests` with its `throttle.mjs` pid; the
  tests read that file only to know a request is queued before the disk fills. Every test slot (section 6: 2 on the
  Mac, 6 on the Spark) is held by a stub under its own `throttle.mjs` first, so the waiters really wait.
- **The full disk.** A filesystem is a boundary we don't own, so the fault is injected there: a preload,
  `fault.mjs`, written into the sandbox by `helpers.mjs` and passed with `--import` to the waiters' `throttle.mjs`
  only (never to the holders, nor to a waiter's command: spawn doesn't pass `execArgv` on). While the sandbox's
  `disk-full` marker exists, each write of data into the table folder fails as a full disk fails it: the file is
  created, half the data lands, and the write throws `ENOSPC: no space left on device, write` with `code`
  `ENOSPC`, `errno` -28 and `syscall` `write`. Removing the marker is space coming back. It patches the `node:fs`
  functions that create or write files (`openSync`/`writeSync`/`writevSync` on a descriptor opened for writing in the
  folder, `writeFileSync`, `appendFileSync`, `copyFileSync`, `mkdtempSync`, `mkdirSync` of a new folder) on the
  module object and syncs the ESM named exports, so it doesn't depend on which of them the script uses; it leaves
  renames, links and removals alone, which a full disk lets through. Two scopes: `all` fails every such write (the
  lock file's write comes first at the base), `table` only a write whose data is a throttle table (JSON with
  `"grants"`), so the lock and the log go through and the table's own temp write fails, as in the issue's words.
  Each injected failure is noted in the sandbox's `faults.jsonl`; a test whose waiter never had a write fail fails,
  since it would prove nothing. The other errors are `EIO: i/o error, write` (errno -5) on the write and
  `EACCES: permission denied, open '<path>'` (errno -13) at the open, nothing created.
- **A temp file of its own** is an entry of the table folder with the waiter's pid as a number in its name, or
  `table.lock` while its JSON names the waiter's pid. Looked at four times, 400 ms apart, with the disk full and the
  waiter's writes failing: one present at every look was left behind. A retried write that makes and removes its
  file in between is never seen at four looks in a row; a file left between retries, renewed each time, is.
- **Keeps its place.** Two waiters face the full disk, and a third, queued after them, writes with no fault. Once
  space comes back, each slot that frees must go to the next in line: first, then second, then third. A waiter that
  rejoined the queue after a failed write falls behind the third.

## The tests

| File | Criterion | What it checks |
|---|---|---|
| `wait.test.mjs` 1, 2 | `#2869.08271434` | Scopes `all` and `table`. Every slot held; waiters `first` and `second` (full disk) and `third` (no fault) queue in that order, `--wait 1`; the disk is full for at least 3 s and until each of the first two had 2 writes fail; both still run with no `BLOCKED` or `INCONCLUSIVE` line; space comes back and 1 s later all still wait; each freed slot goes to the next in line and no one behind it (1.5 s settle); each runs its command and exits 0. |
| `wait.test.mjs` 3 | `#2869.08271434` | Every slot held; a waiter with `--wait 0.1` (6 s); the disk stays full. It ends within 90 s: no `BLOCKED`, exit 3, first line `INCONCLUSIVE no grant`, not before 6 s from its start, its command never run. |
| `temp.test.mjs` 1, 2 | `#2869.48e3b6ea` | Scopes `all` and `table`. Every slot held; one waiter; the disk full until it had 2 writes fail; four looks find no file of its own present at all four; it still waits; space comes back, a slot frees, it runs and exits 0, and no file of its own is left. |
| `other.test.mjs` 1, 2 | `#2869.fd8c32fe` | `EIO` on the write and `EACCES` at the open. Every slot held; one waiter, `--wait 1`; its writes fail; within 40 s it exits 2 with a `BLOCKED throttle: ...<code>` line and never runs its command. Passes on the base, as "as before" says it should. |

Criterion IDs are the trace lane's (`#<issue>.` and the first 8 hex digits of the SHA-256 of the criterion's text,
whitespace collapsed), from the three bullets under the issue's `## Criterion`. The issue lists them as plain
bullets under `## Criterion`, not `- [ ]` items under `### Acceptance criteria`, so the trace lane's reader, as it
stands at the base, finds no criteria in it; the issue's shape needs fixing before a `Closes`.

## Wrong programs

The base fails the 5 tests of the first two criteria at an assertion for the criterion's reason (`BASE-FAILURE.txt`):
each waiter prints `BLOCKED throttle: ENOSPC: no space left on device, write` and exits 2 at its first failed write,
and leaves `table.lock.<pid>` (scope `all`) or `table.json.<pid>` (scope `table`) behind.

No twin is shipped and there is no `twins.json`: the base alone already fails each test of the first two criteria,
and the third's guard needs a fix to break. To check that the tests can pass and that they catch plausible wrong
programs, I wrote a throwaway reference fix of `scripts/throttle.mjs` in a scratch copy (never committed: it removes
its temp file when a write fails, and in `acquire`'s wait loop takes an `ENOSPC` from the table as not granted yet,
or as the timeout once its own deadline passed, with the timeout's log line allowed to fail on `ENOSPC` too); it passes
all 7. These twins of it each failed as listed at the end of `BASE-FAILURE.txt`:

- **Waits on, but leaves its temp file** (`leaves-temp`): caught by both `temp.test.mjs` tests.
- **Reads a full disk as the wait running out** (`give-up`): caught by every test of the first two criteria
  (the waiter ends at once; the timed one after about 0.3 s, not 6 s).
- **Waits on every error** (`wait-all`): caught by both `other.test.mjs` tests.
- **Waits on, but rejoins the queue's end after a failed write** (`requeue`): caught by both place tests, the third
  waiter being granted first.
