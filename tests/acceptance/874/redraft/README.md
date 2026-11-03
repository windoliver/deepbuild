# Blind redraft of #874's acceptance tests: stand-ins from a drafted check's declared surface, hash recorded

A drafted check's stand-in is built on the real base and its hash is recorded.

A fresh run of the blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding), on the base `a7e140b2`
(origin/main) with the first draft (`../`, commit `14a98f57`) beside it. It never looked at an implementation of #874:
no other worktree or checkout, no other branch, no PR #889 or #864. The first draft in `../` is kept as written; this
folder replaces it.

## What it read

- **The issue**, #874: its title, Scope and the three criteria, AC1 to AC3 in the body's order.
- **The design**, `docs/technical-design.md`: A base with nothing to start, Proven on the base and Who drafts it (What
  done means, fixed at the start); the Definition of done's `stand_in` field; the "Definitions fixed at the start"
  fixtures (the empty repo's `/health` check that fails on the stand-in's `{}`); Dogfooding.
- **`AGENTS.md`**, Proof.
- **The base**, `a7e140b2`, for its public surfaces only: the hub's claim path (`packages/hub/src/ask-tasks.ts`'s lock
  and claim, `core.ts`'s `runClaim`, `runApproved`, `launch` and `finish`, `gate-runner.ts`'s `stop` and `onBase`), the
  hub's socket methods (`server.ts`'s list; `events.read`, `evidence.read`, `changes.read`), `plant.ts`,
  `@deepbuild/gate`'s `baseCheckout`, `surfaces`, `standIns` and `baseProof` (`packages/gate/src/checkouts.ts`), the
  core's mask rule (`packages/gate/src/mask.ts`), and the command check kind's tracing, run and reports
  (`packages/checks-command/src/{shell,index,report,listing}.ts`, `packages/conformance/runtime/check-kind/reporter.mjs`).
- **Sibling suites, for their conventions**: `../` (the first draft: README, helpers, tests, BASE-FAILURE.txt), 31
  (helpers, its service world), 303 (drafted definitions through `DEEP_HUB_TEST_DRAFTS`, `evidence.read`), 29 (`h-d.ts`,
  the real hub and session harness) and `tests/acceptance/27/outcomes-redraft/README.md` for how a redraft is written up.

## The dispute

The first draft was written against `a5471ebd`. On `a7e140b2` it can't reach any criterion:

1. **Its check can't be traced.** Every claim check now runs through the command check kind
   (`packages/checks-command`, from `core.ts`'s `launch` when `run.command` is set; the hub's command is
   `sh '<check path>'`). The kind refuses a command it can't trace: `untraced()` (`shell.ts`) returns `shell input <` for
   the first draft's `exec node --input-type=module - <<'JS'` here-document, so every run of it ends `uncounted`, never
   passes on the claim's snapshot, and every test is BLOCKED ("the drafted check never passed on the claim's snapshot").
   The core's mask rule (`maskIn`, `mask.ts`) also leaves a script with more than one command line uncounted (`; <word>`:
   the last line's exit would be the run's), and `exec` is no traced program.
2. **Its log can't be written.** The kind runs hermetically: its grant writes only the checkout and the run's own temp
   folder, its environment is cleared to an allowlist plus the variables the run is given, and its PATH is its own. The
   first draft's log, appended to a file in the world's `/tmp` folder, can't be written from the check, and the base
   checkout and the run's temp folder are removed once the run ends.
3. **The verdict engine now judges a fix check's base run.** Through `packages/gate`'s `claimVerdict`, wired in
   `gate-runner.ts`: a base run that passes is INVALID (`passes on the merge base, so it can't prove the fix`), and so is
   one that fails off an assertion (`baseOf` reads `on_assertion` from the run's failures). So by that rule AC3's check,
   which fails before any assertion in an empty base with no stand-in, is INVALID without any stand-in: INVALID alone
   proves nothing about a stand-in, and the test has to see that the base run passed.

## What changed from the first draft, and why

The first draft's surface under test (its README, items 1 to 5) is kept as it was: nothing on this base makes one
impossible. Kept as they were: the world (an empty repo, or one whose app already starts; the definition handed through
`DEEP_HUB_TEST_DRAFTS`), the agent's work, the readings of "an empty repo", "a repo whose app already starts", "the
record holds its hash" and "is INVALID", R1's `stand_in` reading and #31's hash, the plants and what each must fail.
Changed, as the base forces:

- **The drafted check's form** (The drafted check, below): one shell command line the kind traces, `echo '<test>' >
  .deepbuild/checks/health.test.mjs && node --test .deepbuild/checks/health.test.mjs`. The base checkout holds only
  the base's tree and the check's approved bytes (`runApproved` writes the one file; `onBase` passes `own: []`), so the
  check carries its node:test file in its own bytes and writes it into its checkout, which the grant allows. A failure
  is then node:test's, placed by the kind at the test file's line (`report.ts`'s `failure`: the innermost frame in the
  check's own files; an assertion only for `AssertionError`/`ERR_ASSERTION`), which is where the definition's `asserts`
  name it.
- **How a test learns what a run saw**: from the record, never a log. Each run of the check is a `run.started` (its
  `check`, `claim` and `commit`: the base commit for a base run, the snapshot for the claim's) and its `run.finished`
  (`outcome`, `assertion`, `points_to`, and `findings`, one line per failure, `<test> (<file>:<line>): <message>`). The
  check's assertion messages, and the error it throws when it gets no answer, are `seen <json>`: where it went (`via`,
  `surface` or `app`), its folder, and the status and body it got, or the error. A failing run's findings carry that.
  A passing run's record says only that it passed, which is all AC3 reads: in the empty base nothing but a surface deep
  serves can answer `GET /health`, since without `DEEP_SURFACE_URL` the check imports `app.mjs`, which the empty base
  lacks, and fails before its assertion. The hub's socket gives no run's output (`evidence.read` answers what the store
  holds of a file, "never its bytes"), and a file the check writes in its checkout is gone with the checkout.
- **AC1 also holds the place**: the base run must fail at the named `assert.deepEqual` (`run.finished`'s `points_to`
  and `assertion`), as the design says ("fails on the stand-in's `{}` at its named `expect`").
- **The wait**: until the claim has a `verdict.made` and every run of it has finished (180 s), since the base run comes
  before the claim's first verdict.

## Criteria

| AC | Tag | Criterion | File |
| --- | --- | --- | --- |
| AC1 | `#874.b1e77128` | Through a real hub, in an empty repo, a drafted check that declares a surface runs on the base against a stand-in, and the record holds its hash | `empty.test.ts` |
| AC2 | `#874.f1e74512` | Through a real hub, in a repo whose app already starts, a check for a new route gets no stand-in | `starts.test.ts` |
| AC3 | `#874.555fd457` | A drafted check that passes on its stand-in is INVALID | `invalid.test.ts` |

Each tag is `#874.` and the first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed; they are the
first draft's.

## How to run

With Node 24.22 first on `PATH` (never Homebrew's 23.9) and the Rust toolchain:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                    # once, if node_modules is missing
npm run build --workspaces                # the hub and the deep CLI the tests start
cargo build -p deep-hook                  # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/874/redraft --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/874/redraft/tsconfig.json
```

- Every test starts a hub of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`), in
  place of `tests/acceptance/874`. The implementer adds it.
- With `--root` here Vitest writes its cache under `tests/acceptance/874/redraft/node_modules/.vite/`; delete it before
  committing.
- Folders are made under `/tmp/dh874-*` (a Unix socket path must fit in 104 bytes on macOS), and `HOME` is the world's
  for every process the hub tests start. Processes are stopped by PID only (`h-d.ts`'s `cleanup` and `stopHub`).
- No network beyond 127.0.0.1, no model, no `claude` binary. Each hub test takes 30 s to 2 minutes on a correct hub.
- A hub that can't start (unbuilt, or a plant it doesn't list), a prompt that opens no task, a stop that makes no claim,
  or a drafted check that never passes on the claim's snapshot is BLOCKED: the test throws, never passes. A BLOCKED
  from deep-hook's "sync didn't finish within the hook's 50 ms" is machine load: run it again.

## The surface under test

The tests reach DeepBuild only through the real hub (`deep hub run`), deep-hook, the hub's socket (`events.read`, as the
cli role) and, for the hash, #31's service (`openCheckouts` in `packages/gate/src/index.ts`). The hub, session and
reader are `tests/acceptance/29/h-d.ts`'s, and #31's world is `tests/acceptance/31/helpers.ts`'s. The issue names no
API, so these are the smallest new parts the tests need, the first draft's:

1. **A requirement declares its surface.** In the definition handed through `DEEP_HUB_TEST_DRAFTS` (#303's test
   surface), a requirement carries `surface`, the shape of #31's `DeclaredSurface` without `check`, since the check is
   the requirement's own `check`:

   ```json
   { "id": "R1", "text": "GET /health answers 200 with {\"status\":\"ok\"}", "source_line": "ask#L1",
     "refuted_by": "a GET /health that answers anything else", "check": ".deepbuild/checks/health.sh",
     "on_base": "fails", "asserts": [".deepbuild/checks/health.test.mjs:25", ".deepbuild/checks/health.test.mjs:26"],
     "depth": "api", "oracle": "code", "near_misses": [],
     "surface": { "kind": "service", "routes": ["/health"], "format": "json" } }
   ```

   The hub carries it from the locked definition to the gate runner's `baseCheckout` as
   `{ check: <the requirement's check>, ...surface }`.
2. **A check run reaches the surface deep serves.** A run of a check whose declared surface deep serves for that run,
   here the stand-in on the base, gets `DEEP_SURFACE_URL`, the service's origin (`http://127.0.0.1:<port>`), among the
   variables the command check kind is given, and its grant lets it connect to that host. Anywhere else the variable is
   unset.
3. **The record holds the stand-in.** R1's `stand_in` is `{ surface, hash }`: `surface` names the declared surface
   (at least its `kind`, `routes` and `format`), and `hash` is the `StandIn.hash` #31's service returns for that
   stand-in. The tests read it from the newest `definition.*` event (`definition.locked`, `definition.revised` or a
   newer kind) whose `task_ref` is the task's and whose R1 carries a `stand_in`, through `events.read`.
4. **INVALID.** A `verdict.made` for the claim (its `subject` or `data.claim`) with outcome `INVALID` and a reason naming
   the check's path, as the verdict engine's base-run INVALID names it today.
5. **Planted wrong programs** (`DEEP_HUB_PLANT`, the hub's `plant.ts`; only tests set it):

   | Plant | The wrong program | Fails |
   | --- | --- | --- |
   | `stand-in-surface-dropped` | never carries the declared surface to `baseCheckout`, so no stand-in is built | AC1, AC3 |
   | `stand-in-unrecorded` | builds the stand-in and runs the check on it, but records no `stand_in` | AC1 |
   | `stand-in-always` | builds a stand-in for every declared surface, even where the part already starts | AC2 |
   | `stand-in-pass-proves` | counts a check's pass on its stand-in as proof, so the claim isn't INVALID | AC3 |

And what the record already gives, which the readings use: `run.started` with `data.run`, `data.check`, `data.claim` and
`data.commit` (the merge base for a base run), and `run.finished` with `data.run`, `data.outcome`, `data.assertion`,
`data.points_to` and `data.findings` (each failure as `<test> (<file>:<line>): <message>`, the message as the tool
reported it, scrubbed only of the values the run was given).

Two Scope lines have no criterion of their own, so nothing here asserts them: the receipt line saying the check "was
proven on a stand-in" (the design: "its receipt line says it was proven on a stand-in"; `changes.read`'s `line` and
`second` would show it), and "a surface with no fixed form goes to the early question". A PR that closes #874 proves the
three criteria; those two need their own proof or a note.

## The drafted check

`helpers.ts`'s `checkBytes` writes it: `.deepbuild/checks/health.sh`, a `#!/bin/sh` line, a comment, and one command
line, `echo '<the test file>' > .deepbuild/checks/health.test.mjs && node --test .deepbuild/checks/health.test.mjs`. The
command check kind traces it (`echo` reads no file; `node` is the hub's own; the quoted text is a word, not the shell's;
no mask), and its exit is `node --test`'s. The test file has one test with a literal name, so the kind's listing finds
it ran. Its `asserts` name its `assert.equal(seen.status, 200, said)` line (25) and, for AC1 and AC2, its
`assert.deepEqual(JSON.parse(seen.body), { status: "ok" }, said)` line (26). AC3's check has the first alone: it asserts
only that the route answers 200, which a program that does nothing also does.

Where `DEEP_SURFACE_URL` is set it calls `GET /health` over HTTP. Anywhere else it calls the app's own handler,
`handle(method, path)` in `app.mjs`, in its folder: on this base the hub starts no stack for a claim's check, and a
check's sandbox can't listen. So:

- on the claim's snapshot the agent's `app.mjs` answers `{"status":"ok"}` and the check passes;
- on an empty base with a stand-in it reaches the stand-in, which answers 200 and `{}`: AC1's check fails at its named
  `deepEqual`, AC3's passes;
- on an empty base with no stand-in there is no `app.mjs` and no URL, so it throws `seen {..., "error": "Cannot find
  module ..."}` before any assertion;
- on a base whose app already starts it calls that app, which answers the new route 404 and `{"error":"not found"}`,
  and it fails at its named `assert.equal`.

## Readings

- **"An empty repo"** (AC1, AC3): one empty root commit on `main`, as #31's reading; the drafted check sits uncommitted
  in `.deepbuild/checks/`, as the drafting job leaves it, and the hub runs its approved bytes.
- **"A repo whose app already starts"** (AC2): its base has `package.json` with a `start` script (`node server.mjs`),
  `server.mjs` and `app.mjs` serving `/`. The design: "A new route ... in a part that already starts goes through that
  part's existing entry point and runs on the real base". The test holds that the base run saw the real base's answer
  (404, `{"error":"not found"}`), never the stand-in's 200 and `{}`, and that R1 records no `stand_in`. A hub that
  reaches the real base's app over HTTP, `DEEP_SURFACE_URL` naming it, passes as well.
- **A run on the base**: a `run.started` for the check whose `commit` is the base commit. The claim's runs on its
  snapshot name the snapshot, which holds the agent's files and so is never the base.
- **"Runs on the base against a stand-in"** (AC1): every run of the check on the base saw the stand-in's fixed answer,
  200 and `{}`, in a folder that isn't your worktree, and failed at the named `deepEqual`.
- **"The record holds its hash"** (AC1): R1's `stand_in.hash` equals the hash #31's service returns from `baseCheckout`
  for the same declared surface in an empty repo.
- **When the base run happens.** The gate runner's base run at the claim, as the Scope says ("to the gate runner's
  `baseCheckout`"). A hub that also proves the check on the base when its definition locks passes as long as every base
  run reached the stand-in.
- **"Passes on its stand-in"** (AC3): every run of the check on the empty base passed. Nothing else there answers
  `GET /health`, so a pass is the stand-in's.
- **"Is INVALID"** (AC3): some `verdict.made` for the claim is `INVALID` and names the check. With the pass on the
  base, an INVALID for any other cause (no base run at all, a failure off the assertions) doesn't count.

## Proof on a wrong program

No `twins.json` here: a twin is an overlay on the implementation, which this job never saw. Each criterion has its
plants above, each run through the same judgement, which must fail naming what the criterion is about. On the base the
hub refuses to start with a plant it doesn't list (`DEEP_HUB_PLANT=<plant> names no planted program`), so those tests
are BLOCKED. AC1 and AC3 fail on the base at their assertions; AC2 holds on the base, which builds no stand-in anywhere,
and is proven by its plant. See `BASE-FAILURE.txt`.

## Base results (`a7e140b2`, Node 24.22.0, load 35 to 86 on 12 cores)

| Test | On the base |
| --- | --- |
| AC1 main | fails at "must reach the stand-in of its declared surface": the base run threw at `health.test.mjs:22`, `Cannot find module .../app.mjs` |
| AC1 `stand-in-surface-dropped`, `stand-in-unrecorded` | BLOCKED: `DEEP_HUB_PLANT=<plant> names no planted program` |
| AC2 main | passes: the base run saw 404 and `{"error":"not found"}`, failed at `health.test.mjs:25`; R1 has no `stand_in` |
| AC2 `stand-in-always` | BLOCKED, as above |
| AC3 main | fails at "must reach the stand-in ... and pass there": expected `failed` to be `passed` |
| AC3 `stand-in-pass-proves`, `stand-in-surface-dropped` | BLOCKED, as above |

Typecheck: exit 0. Under that load deep-hook's 50 ms spool and sync sometimes didn't finish, leaving a prompt with no
task or a stop with no claim (BLOCKED); those tests went through when run again, and `BASE-FAILURE.txt` keeps both.
The plants' judgements have not run against a wrong program: the base has none of the four.

This job's worktree HEAD was `a7e140b2` without the first draft's commit; it read the first draft from that commit
(`14a98f57`, whose only parent is `a7e140b2` and which adds `tests/acceptance/874/` alone) with `git show`.
