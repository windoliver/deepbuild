# Acceptance tests for #1824: one lock file and one fetcher

I drafted these tests blind from these sources:

- issue #1824, as saved verbatim for this job: its Scope, its three criteria and its Proof
- `docs/technical-design.md`: How we know version 0 works (the parity-suite paragraph on outside oracles and the
  reference lane; Familiar names, counted; Criteria in a checked shape; Wrong programs; Dogfooding), the ask kinds and
  Tasks only you can do, and Threats
- `docs/canvas-primitives.md`: Pack: assets fetched on first use (`{path, url, sha256, size, license.credit}`)
- AGENTS.md
- the base commit `f38d2b39`, which has no implementation

At the base I also read `scripts/lanes.mjs` (the lint lane's commands; how a command's first `FAIL`, `BLOCKED`,
`INVALID` or `INCONCLUSIVE` line becomes the lane's state), `scripts/repo-rules.mjs` (FAIL lines and Fix lines),
`scripts/verdict-proofs.mjs` and `scripts/lane-x86.mjs` (a BLOCKED line with what unblocks it), `scripts/proof-change.mjs`
(`criterionId`), and `tests/acceptance/423`, `428`, `498/decode`, `1115`, `1333` and `1426` for their shape. The helpers
are written here, never imported from another suite. Per AGENTS.md, the implementing agent doesn't edit these tests. A
dispute goes to a blind redraft by this job.

## Redraft

This is a blind redraft of the plants only, from the same inputs plus the before lane's three lines on the first suite:

```
FAIL before: tests/acceptance/1824/flipped.test.mjs › #1824.a44b9f7f AC2: the planted fetchers that use the flipped file, refetch it when the network is not allowed, or pass there, each fail: its planted wrong program uses-flipped has no files; refetches-not-allowed has no files; passes-not-allowed has no files
FAIL before: tests/acceptance/1824/lint.test.mjs › #1824.f985f5df AC3: the planted lints that pass a moving ref or a row without its size or sha256, and the planted fetcher that fetches an unlisted file, each fail: its planted wrong program lint-any-ref has no files; lint-fields-optional has no files; fetches-unlisted has no files
FAIL before: tests/acceptance/1824/warm.test.mjs › #1824.512f9fb8 AC1: the planted fetcher that fetches a cached, matching file fails, naming the path: its planted wrong program refetches-cached has no files
```

Why: the before lane reads each name in `twins.json` as a folder `twins/<name>/` whose files it lays over the change
at their paths, then runs the tagged tests there (`scripts/proof-runs.mjs`, `prepareRuns`). The first suite's twins
were single files `twins/<name>.mjs` that its own three plant tests ran, so the lane found no folders; and those plant
tests passed on the base, so they proved nothing to the lane.

What changed:

- Each twin is now a folder `twins/<name>/scripts/fetch-lock.mjs`: a whole fetcher with one fault and no import from
  outside Node, which the lane lays over the checkout's fetcher. The names and the map in `twins.json` are as before.
- The three plant tests are gone from `warm.test.mjs`, `flipped.test.mjs` and `lint.test.mjs`, with the `twin` helper
  only they used. The lane runs each twin itself, through the five tests of the real surface.
- The five tests of the real surface keep their names, criterion IDs, judges and expected values. `judges.mjs` changed
  in its head comment only.
- `TWINS.txt` is new and `BASE-FAILURE.txt` is rerun.
- No check that each judge passes a right fetcher is kept as a test. `TWINS.txt` ends with that run, done once.

## How to run

```sh
node --test 'tests/acceptance/1824/*.test.mjs'
```

There are 5 tests in 3 files, all offline, about 1 s together on a fetcher. They're `*.test.mjs` under `tests/acceptance/`, so the
unit lane doesn't pick them up. They need Node 24 only: no `npm ci`, no git, no other tool.

They run the real script, `scripts/fetch-lock.mjs`, as a process in a temporary working folder, and read its exit, its
output, the cache's files and the forge's request log. Nothing imports the code under test. `lint.test.mjs` imports
`checks` from `scripts/lanes.mjs`, the base's own export, to read the lint lane's commands.

One stand-in, at a boundary the repo doesn't own:

- **The forge** that serves outside files is a server the test process runs on 127.0.0.1. It serves the pinned
  fixture files (three listed, one unlisted, each under 40 bytes) at `/fixture/library/<commit>/<path>` and records
  every request it gets. That record is the issue's "network log". `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` (both
  cases, with `NODE_USE_ENV_PROXY=1`) point at the same server, so a request or a tunnel for any other host lands in
  the log as `outside`, is refused, and fails the judge that sees it. A tunnel to the forge itself is handed to the
  forge.

Every process gets a temporary `HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME` and `TMPDIR`, and an environment of only
those, `PATH` and the proxy variables. No real cache or home is read or written. A process still running after 60 s
is stopped by its PID.

## The surface (my choice where the issue leaves it open)

The issue names a lock file, one fetcher, one cache outside the checkout, a lint and what the lane reports, but no
command, path or field. What follows is the smallest surface that makes each criterion true and observable. Every name
below is picked here.

- **The lock file** is `scripts/fetch-lock.json` in the folder the script runs in, beside its script as
  `known-failures.json` is. A lane runs in the checkout's root, so that is the checkout's lock. There is no `--lock`
  flag: a test runs the checkout's script with its working folder set to a temporary one that holds a planted lock, as
  #1426's tests do.
- **Its shape** is `{ "files": [row, …] }`. A row is `{ path, url, sha256, size, credit }`, the issue's five fields
  under the design's names for a pack's assets: `path` a relative path, `url` a string, `sha256` 64 lower-case hex
  digits, `size` a whole number of bytes, `credit` the source's credit line. Other keys aren't tested.
- **A row is named by its `path`.** "Naming the row" means a line that holds the row's `path`.
- **A URL at a pinned commit** has a path segment of exactly 40 hex digits, as a forge's raw URL does
  (`/<owner>/<repo>/<commit>/<path>`). The lint judges that segment, never the scheme or the host: the tests' rows are
  `http://127.0.0.1:<port>/fixture/library/<40 hex>/<path>`. The planted branch row has `main` in that place and the
  planted tag row `v1.4.0`.
- **The lint** is `node scripts/fetch-lock.mjs lint`. It reads the lock and makes no network request. A lock of good
  rows exits 0 with no line starting `FAIL`. A bad row exits non-zero with a line that starts `FAIL` and holds that
  row's `path`; no `FAIL` line holds a good row's `path`. It is a command of the lane named `lint` in the `checks`
  export of `scripts/lanes.mjs`, ending `'scripts/fetch-lock.mjs', 'lint'`.
- **The fetcher** is `node scripts/fetch-lock.mjs fetch [<url> …]`. With no argument it fetches every row. Each
  argument is one row's `url`, and then only those rows are fetched. A lane asks by URL because the criterion has an
  unlisted fetch fail "naming the URL".
- **The cache** is `~/.deepbuild/fetched/`, under the home folder as the lanes' other state is, so a temporary `HOME`
  moves it and no variable is added. A row's file is `~/.deepbuild/fetched/<path>`. Exit 0 means every file asked for
  is there and hashes to its row's `sha256`; a lane reads a cached file only after exit 0. That is what "never read"
  means here: with a file that doesn't match, the fetcher either replaces it before exiting 0 or exits non-zero.
- **The network is allowed** only when `DEEP_FETCH_NETWORK=1` is in the fetcher's environment. A variable, not a flag,
  because a lane's commands are fixed in `lanes.mjs` and `runLanes` passes the caller's environment on. Unset means
  not allowed, so nothing leaves the machine unasked.
- **A file whose hash doesn't match** is reported on one line that holds its `path`, the pinned `sha256` and the
  SHA-256 of the bytes found, each as 64 hex digits. With the network allowed it is fetched again from its row's `url`,
  alone: no other row is requested. The line's first word is free there.
- **BLOCKED.** With the network not allowed, that one line starts `BLOCKED `, as `lanes.mjs` reads a command's state
  from its first such line. The fetcher makes 0 requests and exits non-zero.
- **The unblock ask** is one line, `Unblock: …` after any indent, printed once in a run. At the base a script can't
  raise one of the hub's asks, so the line is the ask, as the `Fix:` line under a BLOCKED lane is. It says what to do
  and the check that proves it done: it holds `DEEP_FETCH_NETWORK=1` and `scripts/fetch-lock.mjs fetch`.
- **An unlisted URL.** `fetch <url>` with a URL no row has exits non-zero with a line that starts `FAIL` and holds the
  URL, and never requests it.

## Criteria → tests

| ID | Criterion | Tests | Fails on |
|---|---|---|---|
| `#1824.512f9fb8` | AC1: With every file in the lock cached and matching, a fetch makes 0 network requests. A planted fetcher that fetches a cached, matching file fails, naming the path | `warm.test.mjs`: after a first fetch caches all three rows (3 files with their pinned bytes), a second fetch with the network allowed exits 0 and the forge's log gains 0 requests; a failure names each path requested. On the twin it fails with one line per path | `refetches-cached` |
| `#1824.a44b9f7f` | AC2: A cached file with one flipped byte is never read; the lane reports the path and both hashes, and refetches it only when the network is allowed, else it is BLOCKED with one unblock ask | `flipped.test.mjs`, two tests over a cache with one bit of `lib/src/beta.js` flipped, its size kept. Network allowed: exit 0, the cached file holds the pinned bytes again, one line names the path and both hashes, and only that row's URL is requested. Network not allowed: 0 requests, non-zero exit, exactly 1 `BLOCKED` line naming the path and both hashes, exactly 1 `Unblock:` line. `uses-flipped` fails both; the other two fail the second | `uses-flipped`, `refetches-not-allowed`, `passes-not-allowed` |
| `#1824.f985f5df` | AC3: A lock row whose URL names a branch or tag instead of a commit, or that has no size or no sha256, fails the lint, naming the row; a planted lane that fetches a file the lock doesn't list fails, naming the URL | `lint.test.mjs`. The lint passes three good rows; with each of the four planted rows added in turn it exits non-zero with a `FAIL` line naming that row's path and none naming a good row, with 0 requests; and the lint lane runs it. The planted lane: a lane that fetches a listed URL passes with the file cached, the planted one fails with a `FAIL` line naming the URL, and the forge, which would have served it, never gets a request for it. The two lint twins fail the first test; `fetches-unlisted` fails the second | `lint-any-ref`, `lint-fields-optional`, `fetches-unlisted` |

## The plants

All are test code under this folder. None is chosen by an environment variable, and nothing shipped knows of them.

- **Twins** (`twins/<name>/scripts/fetch-lock.mjs`, listed per criterion in `twins.json`). Each is a whole, small
  fetcher of the surface above, written from the issue alone, with one fault: the same right program with one edit. It
  imports only Node's own modules. The before lane lays it over the change's `scripts/fetch-lock.mjs` and runs the
  tests of the real surface there; no test here runs a twin. A twin replaces that one file: never
  `scripts/fetch-lock.json`, never anything under `tests/`. `TWINS.txt` holds each twin's run.

  | Twin | The planted fault | The test it fails, and the judge's failure |
  |---|---|---|
  | `refetches-cached` | With the network allowed, fetches every row on every run, cached and matching or not | AC1's: `a warm fetch made a network request for <path>, a cached, matching file`, once per path. (It fails AC2's network-allowed test too: the flipped file's refetch brings the other two.) |
  | `uses-flipped` | Trusts a cached file whose size matches, without hashing it | allowed: `… wasn't fetched again … so a lane would read the flipped file`; not allowed: `… exits 0, so a lane goes on to read the flipped file` |
  | `refetches-not-allowed` | Ignores `DEEP_FETCH_NETWORK` | `with the network not allowed, a fetch requested lib/src/beta.js` |
  | `passes-not-allowed` | Notes the mismatch and exits 0 when the network isn't allowed | `… exits 0 …` and `expected 1 unblock ask …, found 0` |
  | `lint-any-ref` | The lint doesn't read the URL's ref | `a row with a URL that names a branch (planted/branch.js) passes the lint`, and the tag's |
  | `lint-fields-optional` | The lint doesn't require `size` or `sha256` | `a row with no size (planted/no-size.js) passes the lint`, and the sha256's |
  | `fetches-unlisted` | Fetches a URL the lock doesn't list | `the planted lane that fetches <url>, which the lock doesn't list, passes` and `the fetcher requested <url>` |

- **Planted rows** (`PLANTED_ROWS` in `judges.mjs`): a URL naming the branch `main`, a URL naming the tag `v1.4.0`, a
  row with no `size` key, a row with no `sha256` key. Each is otherwise a good row with its own path.
- **The planted lane** (`plants/lane.mjs`): a lane as test code. It runs `fetch <url>` and ends as the fetcher does.
  Given the URL of the file the forge serves and the lock doesn't list, it is AC3's planted lane.

## On the base

`BASE-FAILURE.txt` holds the run on `f38d2b39`. All five tests fail at their assertion, each with
`no fetcher: <repo>/scripts/fetch-lock.mjs doesn't exist`. None passes and no test file crashes.

`TWINS.txt` holds the run of each twin laid over a copy of that base. Every twin fails the tests its criterion names,
at their assertion. On that copy the first AC3 test also fails for every program, at its second assertion: the base's
`scripts/lanes.mjs` has no lint-lane command for the fetcher. `TWINS.txt` says which assertion each run failed at.

## Known limits

- **Not run against a real implementation.** No job kept one. The judges were run against the right fetcher the
  twins were cut from only (`TWINS.txt`, last block); the lint-lane assertion (`checks` holds the command) was never
  seen passing.
- **Outside hosts are caught through the proxy variables.** A program that ignores them and dials another host
  directly isn't recorded. Every URL a test gives the fetcher is on 127.0.0.1, so a program has no cause to.
- **One flipped file, one ask.** The issue's case is one file. Whether two blocked files share one `Unblock:` line
  isn't tested.
- **Not tested, the implementer's call:** a first fetch (nothing cached) with the network not allowed; a fetched file
  whose bytes don't hash to the pin; a row with no `credit` or no `path`, a `sha256` or `size` of the wrong form, two
  rows with one path, a path that leaves the cache; the real lock's rows (the reference lane's and the census's inputs
  arrive with #461 and #1493); what success prints; the exit code beyond zero or not.
- **The lint lane as a whole isn't run.** The test checks the lane's entry and runs that command itself; `runLanes`
  needs the throttle and the lease.
- Existing blind suites' pin tables (423, 428, 498) aren't read by these tests and stay as they are, as the Scope says.

## What the implementer adds outside this folder

- `scripts/fetch-lock.mjs` (`lint` and `fetch`) and `scripts/fetch-lock.json`, whose real rows must pass the lint.
- In `scripts/lanes.mjs`, the lint lane's command `[process.execPath, 'scripts/fetch-lock.mjs', 'lint']`, with its
  words in that lane's `fix`.

## Files

- `warm.test.mjs`, `flipped.test.mjs`, `lint.test.mjs`: the tests, one file per criterion.
- `judges.mjs`: one judge per observable; each runs a script in a sandbox and answers its failures.
- `helpers.mjs`: the sandbox, the stand-in forge and its log, the fixture files.
- `plants/lane.mjs`: the planted lane.
- `twins/<name>/scripts/fetch-lock.mjs`, seven of them, and `twins.json`: the planted wrong programs, by criterion.
- `BASE-FAILURE.txt`: the run on the base, with the checkout's path redacted.
- `TWINS.txt`: the run on each twin laid over a copy of the base.
