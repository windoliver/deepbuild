# Acceptance tests for #874: stand-ins from a drafted check's declared surface, hash recorded

A drafted check's stand-in is built on the real base and its hash is recorded.

Written first and blind, by a job that never saw an implementation of #874. Sources:

- **The issue**: its title, Scope and the three checkbox criteria, AC1 to AC3 in the body's order.
- **The design**, `docs/technical-design.md`: A base with nothing to start, Proven on the base and Who drafts it (What
  done means, fixed at the start); the Definition of done's `stand_in` field; Fail before, pass after and Failing on an
  assertion (How runs become one of five verdicts); The stack a check runs against; the "Definitions fixed at the
  start" fixtures (the empty repo's `/health` check that fails on the stand-in's `{}`); Dogfooding.
- **`AGENTS.md`**, Proof.
- **The base commit**, `a5471ebd` (PR #864's head for #31). Read for its public surfaces only: `@deepbuild/gate`'s
  `baseCheckout` with `surfaces` and `standIns` (`packages/gate/src/checkouts.ts`), the hub's gate runner, ask-tasks and
  run launch (`packages/hub/src/gate-runner.ts`, `ask-tasks.ts`, `core.ts`), the supervisor's sandbox profile, and the
  hub's planted programs (`plant.ts`).
- **Sibling suites, for their conventions**: tests/acceptance/31 (README, standin.test.ts, lifetime.test.ts's hub test,
  twins), 303 (drafted definitions through `DEEP_HUB_TEST_DRAFTS`) and 29 (`h-d.ts`, the real hub and session harness).

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

| AC | Tag | Criterion | File |
| --- | --- | --- | --- |
| AC1 | `#874.b1e77128` | Through a real hub, in an empty repo, a drafted check that declares a surface runs on the base against a stand-in, and the record holds its hash | `empty.test.ts` |
| AC2 | `#874.f1e74512` | Through a real hub, in a repo whose app already starts, a check for a new route gets no stand-in | `starts.test.ts` |
| AC3 | `#874.555fd457` | A drafted check that passes on its stand-in is INVALID | `invalid.test.ts` |

Each tag is `#874.` and the first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed (as #31's).

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                    # once, if node_modules is missing
npm run build --workspaces                # the hub and the deep CLI the tests start
cargo build -p deep-hook                  # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/874 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/874/tsconfig.json
```

- Every test starts a hub of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`). The
  implementer adds it.
- With `--root` here Vitest writes its cache under `tests/acceptance/874/node_modules/.vite/`; delete it before
  committing.
- Node must be 24.22: under Homebrew's Node 23.9 the supervisor's sandbox denies Homebrew's `libuv`, so #31's own
  stand-in never listens and AC1's hash reading is BLOCKED.
- Folders are made under `/tmp/dh874-*` (a Unix socket path must fit in 104 bytes on macOS), and `HOME` is the world's
  for every process the hub tests start. Processes are stopped by PID only (`h-d.ts`'s `cleanup` and `stopHub`).
- No network beyond 127.0.0.1, no model, no `claude` binary. Each hub test takes 30 s to 2 minutes on a correct hub.
- A hub that can't start (unbuilt, or a plant it doesn't list), a prompt that opens no task, a stop that makes no claim,
  or a drafted check that never passes on the claim's snapshot is BLOCKED: the test throws, never passes.

## The surface under test

The tests reach DeepBuild only through the real hub (`deep hub run`), deep-hook, the hub's socket (`events.read`, as the
cli role) and, for the hash, #31's service (`openCheckouts` in `packages/gate/src/index.ts`). The hub, session and
reader are `tests/acceptance/29/h-d.ts`'s, and #31's world is `tests/acceptance/31/helpers.ts`'s, as #31's AC15 borrows
them. The issue names no API, so these are the smallest new parts the tests need:

1. **A requirement declares its surface.** In the definition handed through `DEEP_HUB_TEST_DRAFTS` (#303's test
   surface, since #335's drafting job isn't built), a requirement carries `surface`, the shape of #31's
   `DeclaredSurface` without `check`, since the check is the requirement's own `check`:

   ```json
   { "id": "R1", "text": "GET /health answers 200 with {\"status\":\"ok\"}", "source_line": "ask#L1",
     "refuted_by": "a GET /health that answers anything else", "check": ".deepbuild/checks/health.sh",
     "on_base": "fails", "asserts": [".deepbuild/checks/health.sh:20", ".deepbuild/checks/health.sh:21"],
     "depth": "api", "oracle": "code", "near_misses": [],
     "surface": { "kind": "service", "routes": ["/health"], "format": "json" } }
   ```

   The hub carries it from the locked definition to the gate runner's `baseCheckout` as
   `{ check: <the requirement's check>, ...surface }`.
2. **A check run reaches the surface deep serves.** A run of a check whose declared surface deep serves for that run,
   here the stand-in on the base, gets `DEEP_SURFACE_URL`, the service's origin (`http://127.0.0.1:<port>`), and may
   connect to it from inside its sandbox. Anywhere else the variable is unset.
3. **The record holds the stand-in.** R1's `stand_in` is `{ surface, hash }`: `surface` names the declared surface
   (at least its `kind`, `routes` and `format`), and `hash` is the `StandIn.hash` #31's service returns for that
   stand-in. The tests read it from the newest `definition.*` event (`definition.locked`, `definition.revised` or a
   newer kind) whose `task_ref` is the task's and whose R1 carries a `stand_in`, through `events.read`.
4. **INVALID.** A `verdict.made` for the claim with outcome `INVALID` and a reason naming the check's path, as the
   gate runner's base-run INVALID names it today.
5. **Planted wrong programs** (`DEEP_HUB_PLANT`, the hub's `plant.ts`; only tests set it):

   | Plant | The wrong program | Fails |
   | --- | --- | --- |
   | `stand-in-surface-dropped` | never carries the declared surface to `baseCheckout`, so no stand-in is built | AC1, AC3 |
   | `stand-in-unrecorded` | builds the stand-in and runs the check on it, but records no `stand_in` | AC1 |
   | `stand-in-always` | builds a stand-in for every declared surface, even where the part already starts | AC2 |
   | `stand-in-pass-proves` | counts a check's pass on its stand-in as proof, so the claim isn't INVALID | AC3 |

Two Scope lines have no criterion of their own, so nothing here asserts them: the receipt line saying the check "was
proven on a stand-in" (the design: "its receipt line says it was proven on a stand-in"), and "a surface with no fixed
form goes to the early question". A PR that closes #874 proves the three criteria; those two need their own proof or a
note.

## The drafted check

`helpers.ts`'s `checkBytes` writes it: one `/bin/sh` file whose Node body calls `GET /health` and appends what it saw
(its folder, the digest of the `app.mjs` it ran on, the status, the body or the error) to a log in the world's folder
before its assertions. `asserts` names its `assert.equal(res.status, 200)` line and, for AC1 and AC2, its
`assert.deepEqual(JSON.parse(res.body), { status: 'ok' })` line. AC3's check has the first alone: it asserts only that
the route answers 200, which a program that does nothing also does.

Where `DEEP_SURFACE_URL` is set it calls the route over HTTP. Anywhere else it calls the app's own handler,
`handle(method, path)` in `app.mjs`, in its folder: on this base the hub starts no stack for a claim's check (no run of
the gate runner asks for `environment`), and a check's run-as-you sandbox can't listen on a port, even on loopback
(tried on this Mac: `EPERM` for TCP, `EINVAL` for a Unix socket). So:

- on the claim's snapshot the agent's `app.mjs` answers `{"status":"ok"}` and the check passes;
- on an empty base with a stand-in it reaches the stand-in, which answers 200 and `{}`: AC1's check fails at its named
  `deepEqual`, AC3's passes;
- on an empty base with no stand-in there is no `app.mjs` and no URL, so it fails before any assertion, elsewhere;
- on a base whose app already starts it calls that app, which answers the new route 404 and `{"error":"not found"}`.

A check run is on the base when the `app.mjs` its folder held is the base's (none, in the empty repo); on the snapshot
when it is the agent's.

## Readings

- **"An empty repo"** (AC1, AC3): one empty root commit on `main`, as #31's reading; the drafted check sits uncommitted
  in `.deepbuild/checks/`, as the drafting job leaves it, and the hub runs its approved bytes.
- **"A repo whose app already starts"** (AC2): its base has `package.json` with a `start` script (`node server.mjs`),
  `server.mjs` and `app.mjs` serving `/`. The design: "A new route ... in a part that already starts goes through that
  part's existing entry point and runs on the real base". The test holds that the base run saw the real base's answer
  (404, `{"error":"not found"}`), never the stand-in's 200 and `{}`, and that R1 records no `stand_in`. A hub that
  reaches the real base's app over HTTP, `DEEP_SURFACE_URL` naming it, passes as well.
- **"Runs on the base against a stand-in"** (AC1): every run of the check on the base is in a temporary checkout,
  never your worktree, and saw the stand-in's fixed answer, 200 and `{}`; its check then fails at the named `deepEqual`.
- **"The record holds its hash"** (AC1): R1's `stand_in.hash` equals the hash #31's service returns from `baseCheckout`
  for the same declared surface in an empty repo.
- **When the base run happens.** The gate runner's base run at the claim, as the Scope says ("to the gate runner's
  `baseCheckout`"). A hub that also proves the check on the base when its definition locks passes as long as every base
  run reached the stand-in.
- **"Is INVALID"** (AC3): some `verdict.made` for the claim is `INVALID` and names the check. The test also holds that
  the check passed on the stand-in, so an INVALID for any other cause (no base run at all, a changed hash) doesn't count.

## Proof on a wrong program

No `twins.json` here: a twin is an overlay on the implementation, which this job never saw. Each criterion has its
plants above, each run through the same judgement, which must fail naming what the criterion is about. On the base the
hub refuses to start with a plant it doesn't list, so those tests are BLOCKED. AC1 and AC3 fail on the base at their
assertions; AC2 holds on the base, which builds no stand-in anywhere, and is proven by its plant. See `BASE-FAILURE.txt`.
