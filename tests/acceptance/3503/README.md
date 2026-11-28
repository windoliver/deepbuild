# Acceptance tests for #3503: deep-hook's `mcp actions` holds #2654's line cap

Written first and blind, on November 26, 2026, at the base `f0a816405` (origin/main), by a job that saw only issue
#3503, the design and the base commit. No other branch, worktree, pull request or stash was read. Per AGENTS.md, the
implementing agent doesn't edit these files. A dispute goes to a blind redraft by this job (design: Dogfooding).

## What was read

- The issue: its Scope, six acceptance criteria and Proof line. `AGENTS.md`. From `docs/technical-design.md`: Dogfooding,
  Five ways in (the `deep-actions` entry), Threats, and Numbers version 0 has to hold.
- At the base: `crates/deep-hook/src/actions.rs` (`serve`, `Hub::connect`, `ANSWER` of 55 s, the `resources/read`
  "No resource <uri>" answer), `crates/deep-hook/src/main.rs` (`read_line`, `home`, `address`),
  `packages/hub/src/mcp.ts` (`LINE_CAP`, `CAP_TEXT`, the -32600 refusal), and #2654's suite, the model for this one.
  `tests/acceptance/1015/budgets.test.ts` (building the merge base's deep-hook) and `1097/helpers.ts`
  (`environmentProblem`).

## The surface under test

The real `deep-hook mcp actions`, from `DEEP_BIN_DIR` when a run sets it, else this checkout's `target/debug/deep-hook`
(BLOCKED when neither is built). It runs as a child of `/usr/bin/time -l`, in its own process group, with HOME and
TMPDIR in a `/tmp/dh3503-*` folder that holds no hub, and with its stdin and stdout piped. Requests are
newline-delimited JSON-RPC. The assertions use only:
- the lines it writes;
- its resident memory: `ps -o rss=` by its PID while it is fed, and time's maximum resident set size once it exits;
- for criterion 4, what a stand-in hub socket at `<home>/.deepbuild/hub.sock` saw. The stand-in greets the server,
  answers its hello with a role, then answers its `mcp.call` with `{"v":1,"id":…,"result":{"pad":"` and 32 MiB of `a`
  with no newline, and holds the connection open;
- for criterion 5, the same lines from `deep mcp` (`packages/cli/dist/main.js mcp`), run the same way.

## Criteria and tests

Each ID is `#3503.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, with white space
collapsed (`criterionId` in `scripts/proof-change.mjs`). Each test's name starts with its ID.

| ID | File | What it asserts | On the base |
|---|---|---|---|
| `#3503.1357b746` (1 GB) | `ac1-gigabyte.test.ts` | 1 GiB of `a`, a newline, then `tools/list`. The peak stays under 32 MB, all 1 GiB goes in, exactly one error names the cap, and `tools/list` is answered after it | FAIL at the peak: 106.9 MB after 100.7 MB fed |
| `#3503.2d94a9c4` (exact cap) | `ac2-exact-cap.test.ts` (1) | A ping of exactly 16,777,216 bytes is answered `{}`. One of 16,777,217 gets no result and one error naming the cap. The next line's ping is answered | FAIL: the 16,777,217-byte ping is answered |
| | `ac2-exact-cap.test.ts` (2) | One 256 MiB line, then a ping. The peak stays under 32 MB, one error names the cap, the ping is answered. This is the bound "a reader that keeps the dropped bytes" fails | FAIL at the peak: 106.7 MB |
| `#3503.ac2ce418` (split reads) | `ac3-split-reads.test.ts` (1) | A `resources/read` line cut inside its method name across two reads: the answer quotes the URI | PASS |
| | `ac3-split-reads.test.ts` (2) | The same with URI `deep://codes/café-😀`, cut after U+1F600's 2nd of 4 bytes | PASS |
| `#3503.54cedc2a` (hub reply) | `ac4-hub-reply.test.ts` | With the stand-in holding its reply open, a `find_actions` call is answered as failed (JSON-RPC error or `isError: true`) within 45 s, once at least 16 MiB of the reply was sent | FAIL: no answer in 45 s; it read all 33.6 MB and grew to 38.9 MB |
| `#3503.3e8aff35` (same error) | `ac5-same-error.test.ts` | Both servers get the exact-cap ping, the one-byte-over ping and a short ping. Both answer the first and last; deep-hook's one refusal has deep mcp's `code` and `message` exactly | FAIL: deep-hook answers the over-long ping; deep mcp refuses it with -32600 |
| `#3503.5f4bd902` (budgets) | `ac6-budgets.test.ts` | Idle footprint and peak for an 8 MiB ping, three readings each, change against the merge base's build; each change reading within the limit (below) | INCONCLUSIVE: load 167 on 8 cores; readings printed |

## Readings where the issue leaves a choice

- **The cap**: 16 MiB = 16,777,216 bytes, a line's bytes without its newline (Scope states both).
- **"Under 32 MB resident (drafted)"**: 32,000,000 bytes, the higher of `ps` readings taken every 16 MiB of the feed and
  time's maximum resident set size. Criterion 2's "fails the memory bound" is this bound, the only one the issue states.
  If the owner moves it, `RSS_LIMIT` in `helpers.ts` moves by a blind redraft.
- **"1 GB"**: fed as 1 GiB, which covers either reading. **"The line after"**: the long line ends with its newline, and
  `tools/list` is the next line.
- **"The merge base holds what it is fed and fails, naming the peak"**: once a reading reaches 32 MB the feed goes on
  64 MiB more and stops, so a server that holds what it is fed fails at the peak without taking the whole gigabyte. The
  message names the peak and how much went in. Not asserted as timing.
- **"Names the cap"**: the message matches `16 MiB` or `16,777,216` (with or without commas). The error's `id` isn't
  checked.
- **"Cut across two reads"**: one write holds a whole ping and the first part of the request; the rest goes only once
  the ping is answered. The server has then read past the ping, and the rest wasn't in its pipe, so the request comes in
  two reads at least. That holds for any reader whose buffer takes the first write (under 200 bytes) whole. No fixed
  wait is used.
- **The reply cap (criterion 4)**: Scope says the same 16 MiB. The reply is that and 16 MiB more. Any failure answer
  counts once at least 16 MiB was sent; its wording isn't stated, so it isn't checked. 45 s is well under the base's
  55 s `ANSWER`, after which the base answers "did not answer in time".
- **"The same error code and the same words"**: `error.code` and `error.message` equal, byte for byte, to `deep mcp`'s.
  The exact-cap ping is in the same run, so a server whose cap is lower (refuses it) or higher (answers the
  one-over ping) differs from deep mcp either way.
- **Budgets (criterion 6)**:
  - The merge base is `git merge-base HEAD origin/main`. Its `crates/deep-hook`, `crates/deep-contracts`, `adapters`
    and `Cargo.lock` are unpacked with `git archive` into a temp folder, given a two-crate workspace, and built
    offline and debug there. The change's binary is the debug one under test. Nothing is built in this checkout.
  - "Idle footprint" is `ps -o rss=` once `initialize` and `tools/list` are answered. "Its peak for a request under
    the cap" is time's maximum for a server that answered one 8 MiB ping (the issue's first measured size) and exited.
  - "No higher" is each change reading at most the merge base's highest plus 5% or 256 KiB, whichever is more. A page
    or so moves between runs of one binary.
  - Off a reference Mac in a fit state (`environmentProblem` in `tests/acceptance/1097/helpers.ts`: model, mains,
    Low Power Mode, thermal state, load past the cores) the readings are printed and the test is skipped as
    INCONCLUSIVE, never PASS. A build or reading that fails throws `BLOCKED`.

## Planted wrong programs (the implementer writes the twins; none are written here)

- **"A reader that keeps the dropped bytes"** (criterion 2): fails `ac2-exact-cap.test.ts` (2) at the peak. It also
  fails `ac1-gigabyte.test.ts`, under criterion 1's ID.
- **"A reader that decodes each chunk alone"** (criterion 3): fails `ac3-split-reads.test.ts` (2). It reads U+FFFD for
  the cut character, so the answer doesn't quote the URI, and the message prints the request.
- **"A server whose cap differs"** (criterion 5): fails `ac5-same-error.test.ts`, its message printing both servers'
  answers.

## On the base

5 tests fail at their assertions, for the reasons in the table. 3 don't fail:
- The two criterion-3 tests pass. The base's `BufRead::lines` joins reads and decodes each whole line. The criterion
  says that must stay true, so these prove something only against the per-chunk twin above.
- The budgets test reads INCONCLUSIVE on this loaded machine. On the base the change is the merge base, so it can't fail
  there; it needs a planted twin (a server with a larger idle footprint or peak) to prove anything.

`BASE-FAILURE.txt` holds the trimmed run, with the base's peak readings.

## Run them

With Node 24, from the repo root, after `cargo build --locked -p deep-hook`, `npm ci` and
`npm run build --workspaces`:

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/3503 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/3503/tsconfig.json
```

The suite runs alone (`lane.json`): it feeds a 1 GiB line, reads peak memory, and builds the merge base's deep-hook
with cargo (about 2 minutes, a few hundred MB in `/tmp/dh3503-*`, removed after the file). The feeds go a MiB at a
time, so the test process never holds more than one MiB of them. Nothing leaves the machine. Every process stopped is
one the suite started, stopped by its PID's process group.
