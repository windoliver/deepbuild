> **Blind redraft after the issue's Nov 22 amendment** ("the first criterion's bound was 64 MB (drafted); the owner
> chose 96 MB once idle resident memory was measured at 55 MB"). Redrafted: criterion 1's test in `ac1-gigabyte.test.ts`
> (tag now `#2654.4f03ec28`), criterion 2's memory-bound test in `ac2-exact-cap.test.ts` (test 2), and the tag table
> and `RSS_LIMIT` in `helpers.ts`. Every other test is unchanged from the first draft.

# Acceptance tests for #2654: deep mcp refuses a line past a byte cap

Written first and blind, from issue #2654 (its scope, its five acceptance criteria and its proof line), the design and
base commit `58b4a8cb2` (origin/main), by a job that saw no implementation. No other branch, worktree, pull request
or stash was read. The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind
redraft of this job (design: Dogfooding).

## What was read

- The issue, `gh issue view 2654`. It names `packages/hub/src/mcp.ts:135` (stdin read by `createInterface`) and `:59`
  (the hub's reply gathered into one string until a newline).
- `AGENTS.md`. From `docs/technical-design.md`: Dogfooding, and Proof's wrong-programs paragraph.
- At the base:
  - `packages/hub/src/mcp.ts`, which covers the hub greeting and hello/role handshake, `mcp.call`, `ANSWER_MS` of
    55 s, the `resources/read` "No resource <uri>" answer, and the build's tool list when no hub answers.
  - `packages/hub/src/paths.ts` (`hubAddress`: `<home>/.deepbuild/hub.sock` when no config names one).
  - `packages/hub/src/server.ts` (the `{role}` line) and `packages/hub/src/wire.ts` (`line`).
  - `packages/cli/src/main.ts` (`deep mcp`).
  - `benchmarks/budgets.json` (`deep-mcp-30d`), the head of `benchmarks/mcp.mjs`, and `scripts/benchmark.mjs`'s
    judging comments.
  - Suites `3005/`, `298/` and `26/` (house style, and how `deep mcp` is driven), and `2897/ac8-budgets.test.ts`
    (how a budget criterion is held).

## The surface under test

`deep mcp` (this checkout's `packages/cli/dist/main.js mcp`) runs as a child process. HOME and TMPDIR point into a
`/tmp/dh2654-*` folder, and its stdin and stdout are pipes. Requests are newline-delimited JSON-RPC, as an MCP client
writes them. Assertions use only:
- the JSON-RPC lines it writes;
- its resident memory, sampled by its PID with `ps -o rss=` every 100 ms;
- for criterion 4, what a stand-in hub socket saw.

No real hub runs. Without one, `tools/list` answers with the build's own list, as `mcp.ts` says. In criterion 4, a
stand-in listens on `<home>/.deepbuild/hub.sock`. It greets the client, answers deep mcp's hello with `{"role":"mcp"}`
as `server.ts` does, then answers the `mcp.call` with `{"v":1,"id":…,"result":{"pad":"` followed by 32 MiB of `a`
with no newline, and holds the connection open.

## Tests

| File | Criterion tag | What it asserts | At the base |
|---|---|---|---|
| `ac1-gigabyte.test.ts` | `#2654.4f03ec28` | 1 GiB of `a`, a newline, then `tools/list`. Peak RSS stays under 96 MB, all 1 GiB goes in, exactly one JSON-RPC error names the cap, and `tools/list` is answered with tools after that error. Once the bound breaks, the feed runs at most 3 s more and the test fails naming the peak. | FAIL at the peak: 752.0 MB after 537 MB fed, past 96 MB after 0.1 s. The base then crashed (`RangeError: Invalid string length` in readline). |
| `ac2-exact-cap.test.ts` (1) | `#2654.2d94a9c4` | A ping line of exactly 16 MiB is answered `{}`. A 16 MiB + 1 ping gets no result, there is exactly one error and it names the cap, and the next line's ping is answered. | FAIL: the 16,777,217-byte ping is answered `{}`. |
| `ac2-exact-cap.test.ts` (2) | `#2654.2d94a9c4` | One 256 MiB line, then a newline and a ping. Peak RSS stays under 96 MB (criterion 1's bound), exactly one error names the cap, and the ping is answered. This is the memory bound "a reader that keeps the dropped bytes" fails. | FAIL at the peak: 783.5 MB. |
| `ac3-split-reads.test.ts` (1) | `#2654.ac2ce418` | A `resources/read` line written in two writes 1 s apart, cut inside the method name. The answer quotes the URI (`No resource <uri>;`). | PASS (see below) |
| `ac3-split-reads.test.ts` (2) | `#2654.ac2ce418` | The same, with URI `deep://codes/café-😀`, cut after the 2nd of U+1F600's 4 bytes. The answer quotes the URI exactly. | PASS (see below) |
| `ac4-hub-reply.test.ts` | `#2654.7c3a0ee7` | With the stand-in hub holding its reply open, deep mcp answers the `tools/call deep_status` within 45 s (base `ANSWER_MS` is 55 s) with a failure: a JSON-RPC `error` or `result.isError: true`. By then the stand-in had sent at least 16 MiB of the reply. | FAIL: no answer within 45 s, with 33.6 MB of the reply sent. |
| `ac5-budgets.test.ts` | `#2654.1891d3ad` | `deep-mcp-30d` is still in `benchmarks/budgets.json` with the base's command `["node","benchmarks/mcp.mjs"]`, a margin of at most 0.5, and no limit raised. | PASS (by construction, see below) |

## Readings where the issue leaves a choice (open points)

- **The cap's value**: 16 MiB = 16,777,216 bytes. The issue's "The cap" section now states it: "16 MiB (16,777,216
  bytes) for one line". If it changes, `CAP` in `helpers.ts` changes too, and that goes by a blind redraft.
- **"A request of exactly the cap"**: the request line's bytes, not counting the newline that ends it. The issue now
  states this ("counted in bytes without its newline"), so it is no longer an open point.
- **"Names the cap"**: the error message matches `16 MiB`/`16MiB` or `16777216`/`16,777,216`. Neither the error code
  nor the wording is stated, so only the message is checked. The error's `id` isn't checked (the base's parse error
  uses `null`).
- **"Under 96 MB"**: read as 96,000,000 bytes of resident memory (`ps -o rss=` KiB × 1024), sampled every 100 ms. A
  spike between samples can be missed. Criterion 2's "fails the memory bound" is read as this same bound, the only one
  the issue states.
- **"1 GB"**: fed as 1 GiB (2^30 bytes), which covers either reading.
- **"The line after"**: the overlong line ends with its own newline, and `tools/list` is the next line.
- **The reply cap (criterion 4)**: the issue says "the same kind of cap". The test assumes the same 16 MiB:
  - it sends 16 MiB more than that, then stops;
  - it accepts any failure answer once at least 16 MiB was sent.

  A larger reply cap would need a redraft. "Tells its client the call failed" is read as a JSON-RPC error or a tool
  result with `isError: true`. The failure's wording isn't stated, so it isn't checked.
- **"Within 3 s"** (criterion 1's base half): this is not asserted as timing. On the base the test fails at the peak,
  and the failure message gives the time the bound broke (0.1 s at the base).

## Planted wrong programs (twins are the implementer's to write; none are written here)

- **Criterion 2, "a reader that keeps the dropped bytes"**: caught by `ac2-exact-cap.test.ts` test (2), the 256 MiB
  line held under 96 MB. It is also caught by `ac1-gigabyte.test.ts`, but that test carries criterion 1's tag.
- **Criterion 3, "a reader that decodes each chunk alone"**: caught by `ac3-split-reads.test.ts` test (2). It reads
  U+FFFD in place of 😀, so the answer doesn't quote the URI sent, and the failure message names the request.
- **Criterion 3 passes at the base**: the base's readline decodes across chunks and joins lines across reads, so both
  tests pass there. The criterion says these must stay true, so they prove something only against the planted
  per-chunk reader above.
  - A reader that serves each chunk as a line fails test (1).
  - The 1 s gap between writes is meant to land the two halves in separate reads. A test can't observe that from
    outside.

## Criterion 5 (budgets): how it is proven

The measurement belongs to the preflight's perf lane. That lane runs `deep-mcp-30d`'s command on the change and on
the merge base, then judges instructions retired and peak memory (`scripts/benchmark.mjs`). The result is a lane
reading, not a test in this folder. A checkout can't build and run its own merge base, and anything run here would pass
at the base by construction.

`ac5-budgets.test.ts`, written in suite 2897's style, holds only what makes that lane reading count: the task is still
there, it uses the merge base's command, and it gives no wider margin and no raised limit. It passes at the base. It can
fail only on a `budgets.json` that drops or loosens the task, so it needs a planted twin (for example 2897's
`budgets-widened`, a margin of 1) to prove anything. That twin is left to the implementer.

## Base results

`BASE-FAILURE.txt` is the whole run at the base on macOS arm64, Node 24.22.0, after `npm ci` and
`npm run build --workspaces`, rerun for the redraft at 1-minute load ~34. Of 7 tests, 4 fail at their assertions for the expected reasons
(table above) and 3 pass (criterion 3's two tests and the budgets test). Nothing is BLOCKED. `tsc -p
tests/acceptance/2654/tsconfig.json` exits 0.

## Run them

With the repo's Node (24), from the repo root, after `npm ci` and `npm run build --workspaces` (no cargo build
needed):

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/2654 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2654/tsconfig.json
```

The 1 GiB and 256 MiB feeds stream a MiB at a time with backpressure. The test process never holds more than one MiB
of them. Timeouts are generous (30 min for the long feeds) for a loaded machine. Running the files one at a time keeps
the memory readings apart. Temp folders are `/tmp/dh2654-*`, removed after each file. Nothing leaves the machine. Every
process the suite stops is one it started, stopped by its PID.
