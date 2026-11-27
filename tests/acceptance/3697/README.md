# Acceptance tests for #3697: sccache's compiles under the grant that asked, and one sampler a table

Drafted blind from issue #3697, the design it links (section 6 of `docs/parallel-proof.md`, as
`node scripts/design-section.mjs --issue 3697` prints it, the bullets "The load, by who made it (#3067)", "GPU time
and the line (#3240)" and "Threads by grant (#3550)"), AGENTS.md, CONTRIBUTING.md and the base commit `894a293f2`.
For call shapes I read the base's `scripts/throttle.mjs`, and for sandbox technique `tests/acceptance/3550/`, `3240/`
and `3067/`. The helpers are this suite's own. `scripts/throttle.mjs` is run as a process, never imported.

## Run

```sh
node --test tests/acceptance/3697/sccache.test.mjs
node --test tests/acceptance/3697/sampler.test.mjs
```

Run them on the Mac (the issue's "Runs on"), from the checkout, under `node --test`: a table of a test's own exists only
inside a test run (section 6).

| File | Criteria | Takes | Load it makes |
|---|---|---|---|
| `sccache.test.mjs` | #3697.68094266, #3697.feb07461, #3697.5c604981 | 7 to 16 s | two compiles of 2 cores each for about 10 s, at the lowest priority |
| `sampler.test.mjs` | #3697.b7f96141 | 4 s; 12 s on the base | none: two or three samplers, a sample each |

No `lane.json`. As with #3550, nothing asserted moves with the machine's load. Every CPU figure is held to the test's
own `ps` readings, taken around the sample. A starved compile reads INCONCLUSIVE, by a skip that says so (below).

**The machine's table at `~/.deepbuild/throttle/` is never read or written.** Every process the suite starts gets
`DEEP_THROTTLE_TABLE` pointed at a fresh folder in the test's temp sandbox, and a temporary `HOME` there. `DEEP_THROTTLE`,
`DEEP_THROTTLE_RUN`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_PROOF_VITEST_REPORT` and `DEEP_THROTTLE_READINGS` are
unset for it. Each process starts in its own process group, and that group's PID stops it once the sample is in the
log. `load` is stopped by its own PID (SIGTERM). Nothing is stopped by name or port. Every spinner, client and server
ends by itself 45 s after it starts.

## The scene

- **Names.** On this Mac a symlink to `node` shows `ps` ucomm `node`, and a bare copy of Homebrew's `node` can't load
  its `libnode`. So the sandbox's `bin/` holds a copy of the real `node` binary under each name, `sccache` and `rustc`,
  with the `libnode*.dylib` beside it linked from node's `../lib`. `ps` then prints ucomm `sccache` and `rustc`. The
  test asserts the names from its own `/bin/ps -A -o pid=,ppid=,%cpu=,ucomm=` reading before it reads the sample.
- **The client** is `node scripts/throttle.mjs build --wait 1 -- <bin>/sccache idle.mjs client rustc --crate-name x
  --edition=2021 --error-format=json -C metadata=3697a1c0ffee5eed --out-dir <sandbox>/target-3697/debug/deps-3697-f00d`.
  It runs on the test's own table and idles under the stub build grant. Its `DEEP_THROTTLE` gives the grant's ID.
- **The server** is `<bin>/sccache server.mjs ...`, started directly by the test in a process group of its own. So it
  is under no grant (asserted: the stub holder isn't among its ancestors). It starts two children, each `<bin>/rustc
  spin.mjs <name> 2 --crate-name x --edition=2021 --error-format json -C metadata=<h> --out-dir <the same folder>`.
  These use the space-separated forms the issue says the server writes. `matched` has the client's hash. `unmatched`
  has `3697b2deadbeef42` and the same crate name and out-dir, so only `-C metadata` tells them apart.
- **A compile that "spins 2 cores"** is #3067's spinner: 24 threads that spin only while the process is behind 2 CPU
  seconds a second, here at `setPriority(19)`. At a 1-minute load of 53 to 83 on 18 cores, `ps` read each one at 1.4 to
  2.1 cores. The test waits until both read at least 1.5 cores in four readings in a row (at most 20 s). Then it starts
  `load` and reads `ps` four times a second until the first sample is in the log.
- **"Within 0.5 of a core"** follows #3067: no more than 0.5 below the least, and no more than 0.5 above the most, of
  what the test's own readings showed for that part of the tree.

## The tests

| Criterion | File, test | What it holds | Wrong program (twin), and where it fails |
|---|---|---|---|
| #3697.68094266 | `sccache.test.mjs`, "a compile the sccache server runs counts under the grant ..." | `grants` is exactly the stub build grant, by its ID, class and holder's pid. Its `cpu` is within 0.5 of the grant's tree plus `matched`, and its `compile` covers `matched`. In `top`, `matched` carries the grant's ID, command `rustc` and its CPU within 0.5. When `top` leaves it out, that fails if `matched` led all but four processes by 0.5 of a core in every reading. Otherwise the test is skipped as INCONCLUSIVE. | **tree-alone**: the one-sampler rule, but every process placed by its tree. Fails at `the grant <id>'s cpu is 0.053; the test's own ps read the grant's tree and the matching compile the server runs at 1.58 to 1.89 cores around the sample, so it must be within 0.5 of that`. |
| #3697.feb07461 | `sccache.test.mjs`, "a second compile of that server with another -C metadata value counts in outside" | Precondition: the grant's `cpu` covers `matched`. Without that, a sampler that sends nothing anywhere would pass. The grant's `cpu` is no more than 0.5 above the tree plus `matched`. `outside.cpu` and `outside.compile` each hold at least `unmatched` less 0.5. `top`'s entry for `unmatched`, when listed, carries no grant, and the same margin rule applies when it isn't listed. | **every-child**: every process under an ungranted `sccache` goes to a client's grant. Fails at `the grant <id>'s cpu is 7.839; the test's own ps read the grant's tree and the matching compile at 1.56 to 2.05, and the compile with -C metadata=3697b2deadbeef42 at 1.57 to 2.10, which goes to outside`. That twin also sent the compiles of the Mac's own sccache server to the grant. |
| #3697.5c604981 | `sccache.test.mjs`, "the log a sample of the first criterion writes holds neither ..." | Precondition: the sample matched `matched` to its client, which means it read the arguments. `load.log`'s text holds neither hash, nor the out-dir path, nor the out-dir's own name `deps-3697-f00d`. | **writes-arguments**: the work, plus each reattributed `top` entry carries the matched hash and out-dir. Fails at `load.log holds the matching -C metadata hash (3697a1c0ffee5eed)`. |
| #3697.b7f96141 | `sampler.test.mjs` | The first `load` writes its sample at start and keeps running. A second `load` on the same table is held, in this order: the log still holds 1 line; the second has exited within 10 s, with exit code 3; it printed exactly one `INCONCLUSIVE load:` line, on stdout or stderr, of the form `INCONCLUSIVE load: another sampler, pid <n>, writes this log`, with `<n>` the first's PID. The first is then stopped by its PID (SIGTERM) and has ended. A third `load` writes a second line within 60 s, is still running, says nothing of another sampler, and its sample isn't `failed`. | **second-writer**: the work, but a second `load` starts as the first did. Fails on the line count: `the log gains no line from the second load, yet it holds 2 lines with the first load's single sample`. |

The three tests in `sccache.test.mjs` share one scene and its one sample, as the issue reads ("Same table", "a sample
of the first criterion"). `before` builds the scene.

### The twins

`twins/<name>/lines.json`, named in `twins.json`, in #1832's line form. **They are written against the base's
`scripts/throttle.mjs` (`894a293f2`), not against the change, which this job never saw.** Each one lays a guess of
mine at the change onto base lines (an argument listing, `ownerOf` that matches a server's child to a client, a
`load.pid` beside `load.log`), with one rule planted wrong. Once the change has rewritten those lines (`ownerOf`, the
line after `ps listed no process`, the `load` entry's `mkdirSync`/`write()`), a twin doesn't apply. The before lane
lays twins only for a test the merge base didn't already fail at an assertion, and each of these tests does, so a twin
that doesn't apply leaves no test unproven. They are there to show that each criterion's named wrong program fails.

## On the base

Base `894a293f2`, macOS, 18 cores, node v24.22.2, 1-minute load 74 to 83. Each file was run once with the files as
they are here. Result: 4 tests, 4 fail, 0 pass, 0 skipped. Each failure is at an assertion of the suite's, for the
expected reason: the base places by tree alone, and it starts a second writer.

```
✖ #3697.68094266 ... AssertionError: the grant cce988c2e31843f2's cpu is 0.001; the test's own ps read the grant's
  tree and the matching compile the server runs at 1.43 to 2.02 cores around the sample, so it must be within 0.5 of that
✖ #3697.feb07461 ... AssertionError: precondition: the grant cce988c2e31843f2's cpu is 0.001, so the matching compile
  the server runs isn't counted under it ...
✖ #3697.5c604981 ... AssertionError: precondition: the grant cce988c2e31843f2's cpu is 0.001, so the sample didn't
  match the compile to its client ...
✖ #3697.b7f96141 ... AssertionError: the log gains no line from the second load, yet it holds 2 lines with the first
  load's single sample
```

On the base, #3697.feb07461 and #3697.5c604981 fail at their precondition, because the base has neither behaviour.
Their twins (every-child, writes-arguments) show each one failing at the criterion's own words.

## What ran, and what didn't

- **On the base:** each file once, as above.
- **On a throwaway guess at the change** (the base's `throttle.mjs` with the twins' right edits, in a scratch copy
  outside the checkout with no `.git`, never committed): 4 pass, at a 1-minute load of 74. `top` listed `matched` with
  the grant's ID, so the test passed rather than skipped.
- **Each twin**, once, at a 1-minute load of 77: each fails its own criterion where the table says. tree-alone also
  fails the other two `sccache.test.mjs` tests, at their preconditions. every-child also fails #3697.68094266, where
  the grant reads 4 cores and more. writes-arguments and second-writer pass every other test.
- **Not run:** `scripts/affected.mjs`, the proof lanes and the preflight; anything on Linux.

## Gaps and assumptions

- **The suite has passed on one program only**, my guess, never on the work.
- **How the arguments are read is open.** The suite asserts only the outcome: the matching compile is under the grant,
  and the other is outside. A sampler may list `args` with its own `ps` call or in the one listing. It must find
  `-C metadata=<h>` and `--out-dir <d>` among the client's words, after `sccache`, a script path and `rustc`. A
  sampler that requires `rustc` to be the word right after `sccache` would fail here, because the client's second word
  is its script.
- **The server's parent is the test, not launchd.** The issue's server hangs from pid 1. Here it hangs from the test
  process, which is under no grant of the test's own table. "Under no grant" is what the Change names.
- **A starved compile reads INCONCLUSIVE**, by a skip that says so, never a pass: when a compile read under 1 core in
  any reading. It didn't happen in any run.
- **`top` is held by #3067's margin rule.** When `matched` isn't among the five and didn't lead all but four processes
  by 0.5 in every reading, #3697.68094266 skips as INCONCLUSIVE after its CPU assertions have passed. This didn't happen
  in any run.
- **`gpuTop` and `runTop`** under the grant aren't held: the criteria name only CPU and `top`.
- **The first sampler is stopped by SIGTERM**, as "stopped by its PID" reads. A sampler killed by SIGKILL, which can't
  clean up after itself, isn't tested.
- **darwin only**: `/bin/ps` ucomm, and the copy of node under another name. On another machine `sccache.test.mjs`
  skips as INCONCLUSIVE. `sampler.test.mjs` runs anywhere.
