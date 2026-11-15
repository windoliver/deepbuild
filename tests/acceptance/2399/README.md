# Acceptance tests for #2399: a run's egress filter records a refusal once per operation and target, as the sandbox does

Written first, blind, on November 14, 2026, from issue #2399 (its text as of that day: Scope, the 4 checkbox criteria,
Proof and Runs on), issues #1106 and #2420 for what they say, `docs/technical-design.md` (Threats, and what stops each
one; Evidence; Dogfooding), `docs/canvas-primitives.md` (the event catalogue, the `sandbox.denied` row), `AGENTS.md`,
the acceptance suite of #1106 for its conventions and its sample stack, and `packages/supervisor`, `packages/hub`
(with `src/plant.ts`), `packages/env-local` and `packages/cli` as they are at the base commit
`72fe11a11e9b40da5d138688cac52df193af4933` (main), read for their public surfaces only, by a job that never saw an
implementation of #2399. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

The issue has 4 checkbox criteria, AC1 to AC4 in the body's order.

## How to run

On macOS or Linux, with the repo's Node (24.22.0) first on `PATH`:

```sh
npm ci                                            # once, if node_modules is missing
npm run build --workspaces                        # the tests run the built CLI, packages/cli/dist/main.js
cargo build -p deep-hook --locked                 # once: the hub doesn't start without target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2399 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2399/tsconfig.json
```

- **Linux.** A sandboxed run there is under bubblewrap, which sees only system folders, so the Node that runs Vitest
  must be one a sandboxed run can read (the stack's `up` command names `process.execPath`): a Node under a home
  folder is not. This job ran everything with a copy of Node 24.22.0 under `/var/tmp`, first on `PATH`.
- `--no-file-parallelism`: the files start real hubs and stacks on ports leased from 3000 up.
- Nothing leaves the loopback. The stack, the sample APIs, the hub on a temp folder, the temp HOME and the fake
  credentials are #1106's (`tests/acceptance/1106/helpers.ts`, imported as it is, with `fixtures/app.mjs`). Every
  request this suite adds goes to a filter's port on 127.0.0.1, and every host it names ends in `.invalid`.
- Folders are #1106's `/tmp/dh1106-*`, and `/tmp/dh2399-*` for the report of #1106's test when this suite runs it.
  The suite stops only processes it started or whose PID files its fixtures wrote, by PID (#1106's `cleanup`).
- With `--root` here, Vitest may write a cache under `tests/acceptance/2399/node_modules/.vite/`; delete it before
  committing. When this suite runs #1106's test, that Vitest's cache goes to the temp folder, not into
  `tests/acceptance/1106/`.

### #1106's own suite on Linux

Its README says macOS. On this job's Linux arm64 machine, at the base, with the Node above and `deep-hook` built, it
comes up and runs: one whole run passed 7 of its 8 tests, and `refusals.test.ts` alone then passed both of its tests
three times in a row. The one failure in the whole run was its AC3 criterion test at its first control
(`GET /call on the app answered 404`); this job's guess, not checked, is that another program's server answered on
the port the app had leased, on a machine other jobs were loading. It didn't recur in the later runs, here or when
this suite ran that test.

## The surface under test

The issue and the catalogue name the event (`sandbox.denied`, `{run, operation, target}`), the two operations
(`egress-plain-http`, `egress-host`), "the run's filter port" and "#1106's sample stack". They don't say how a test
finds the port, what a request looks like, what "that target" reads as, or how two runs come to be beside each other.
Each choice is listed here so a dispute can name it.

- **#1106's sample stack** is #1106's world: its app (`tests/acceptance/1106/fixtures/app.mjs`) brought up by
  `deep env up --root <hub> --json` in a worktree whose `.deepbuild/done.yaml` declares SHOP_API_KEY for
  `localhost:<port>` and OTHER_API_KEY for `127.0.0.1:<port>`, on a hub of the test's own. The command's `run` is the
  stack's run.
- **The run's filter port** is the port in the `HTTPS_PROXY` (or `https_proxy`) the app's own process holds, read
  from the app's `GET /env`. A `user:password@` in it would be sent as `Proxy-Authorization: Basic`.
- **Requests come from outside the run**: the test's own process connects to `127.0.0.1:<filter port>`, as "anything
  else on this machine that finds the port" would (the issue's first paragraph). One connection per request.
- **A plain HTTP request** is what a proxy's client sends: `GET http://<name>/ HTTP/1.1` with `Host: <name>`.
  "Identical" is that request, byte for byte, 100 times. AC1's name is `dh2399-plain.invalid`.
- **A tunnel asked for** is `CONNECT <name>:443 HTTP/1.1` with `Host: <name>:443`. "A host no credential names" is
  `dh2399-first.invalid:443`, and the second `dh2399-second.invalid:443`. Refused is the 403 the base answers
  (Scope: "a 403 or a refused tunnel"; a tunnel refused another way would fail the 403 check and need a redraft).
- **`sandbox.denied` for a run** is every event of that kind (the hub's `events.read`, cli role) whose
  `data.run` is the run. **The operation** is `data.operation`, exactly. **That target** is read loosely:
  `data.target` holds the request's host name (`dh2399-plain.invalid`); whether a port follows is the implementer's.
- **"Exactly one", "one more"** are counted over what the record gained for the run between two readings. AC1 and
  AC2 also allow no other gained event that is `egress-plain-http`, `egress-host` or names the host; a refusal the
  platform sandbox reported for the app's own doing in that time, if there were one, isn't counted.
- **When the record is read.** A refusal is appended after the filter has answered. After each step the test sends
  the filter one more plain request under a name never used before (`dh2399-mark-<n>-<time>.invalid`), waits up to
  60 s for that marker's `sandbox.denied` in the record, then 500 ms more, and only then reads. This rests on the
  supervisor appending one run's refusals in the order its filter reported them. Marker events are left out of every
  count. A criterion test requires each marker to arrive (a target not seen before must be recorded); a
  `(wrong program)` test waits 10 s and reads the record as it stands, since a plant may never record one.
- **#1106's third criterion, unchanged** (AC3) is `tests/acceptance/1106/refusals.test.ts`'s criterion test (the one
  whose name starts `AC3 SHOP_API_KEY`), run as that file has it in a Vitest of its own:
  `vitest run --root tests/acceptance/1106 refusals.test.ts -t "AC3 SHOP_API_KEY" --config
  tests/acceptance/2399/fixtures/vitest-1106.config.mjs`. The config only moves Vitest's cache to a temp folder and
  loads `fixtures/plant-setup.mjs`. This suite reads that run's exit status, its JSON report and its printed output.
- **#1106's criterion on a planted supervisor** (AC3). #1106's test starts its own hub with no plant, and its
  helpers remove every `DEEP_*` variable when they load. `plant-setup.mjs` puts `DEEP_HUB_PLANT` back in that
  test's process, from `DH2399_PLANT`, after the file has loaded and before its tests run, so the hub it starts
  (and the `deep env up` it runs) holds `DEEP_HUB_PLANT=<plant>`. The plant must act through the hub's variable alone.
  This job checked the route at the base with a plant that exists: with `DH2399_PLANT=standin-every-host`, #1106's
  criterion test failed with its own reading's message printed whole (`127.0.0.1:<port> received SHOP_API_KEY's
  value from the stand-in sent to the second allowed host 127.0.0.1:<port>`).
- **"Naming the placement"** (AC3) is #1106's reading's own words in that run's output, for each of the three:
  `no event in the record names the run <run> and refuses the stand-in sent to the second allowed host
  127.0.0.1:<port>`, `... in a query string`, `... in a form body`.
- **Its three attempts sent a second time** (AC3) are made by this suite on a stack of its own, since #1106's test
  exports nothing: the same three calls `refusals.test.ts` makes (SHOP_API_KEY's stand-in in `Authorization` to the
  other credential's host; in a query string, and in a form body, to its own host), through the app's `/call`, from
  inside the run. Sent once, they must each be refused and leave three `sandbox.denied` events for the run with three
  distinct operation-and-target pairs (Scope: "once for each placement and host"). Sent again, they must each be
  refused again, and **the count of events** is the number of the run's `sandbox.denied` events, of any operation,
  which must be what it was. The second sends differ from the first only in the `x-dh1106-attempt` header.
- **Two runs beside each other** (AC4) are two worktrees (`wt-a`, `wt-b`) of one test repo, each brought up by
  `deep env up` on the same hub, both up at once: two runs, and the test requires two different filter ports. The
  same request, `GET http://dh2399-same.invalid/`, goes once to each run's filter port: the same operation and target.
- **A run started after another ended** (AC4) is `deep env down` in `wt-a` (exit 0), which ends the first run, then
  `deep env up` there again while the second run is still up: a third run, which the test requires to have a new
  run ID. It is sent the same request once, and one `sandbox.denied` must be recorded for it.

### Planted wrong programs

Selected with the hub's `DEEP_HUB_PLANT` (`packages/hub/src/plant.ts`), as #1106's are; only tests set it. None
exists at the base. In each, the filter answers every request as the real program does (403); only what the
supervisor records differs.

| `DEEP_HUB_PLANT=` | The wrong program, exactly | The criterion's reading must fail, naming |
|---|---|---|
| `egress-refusal-once-per-operation` | a supervisor that records a refusal from a run's egress filter only when that run has had none recorded for the same **operation**, whatever the target: the first `egress-host` of a run is recorded, and an `egress-host` for any other host of that run is not (the same for every other operation the filter reports) | the host: `names the second host dh2399-second.invalid:443` |
| `egress-refusals-unrecorded` | a supervisor that records no refusal its egress filter reports: no `sandbox.denied`, and no other event, for a plain request, a tunnel to a host no credential names, or a stand-in refused for where it was put. Refusals from the platform sandbox's own two paths are recorded as in the real program | the placement, in #1106's reading's words: `refuses the stand-in sent to the second allowed host 127.0.0.1:<port>`, `... in a query string` and `... in a form body`, each after `no event in the record names the run` |
| `egress-refusals-seen-without-run` | a supervisor that keeps the set of filter refusals it has recorded by operation and target alone, one set for every run of the hub: a refusal is recorded only when no run of this hub has had one recorded for the same operation and target, and a run's end clears nothing | the run: `no sandbox.denied is recorded for the second run <run>` |

## Criteria to tests

Each `describe` carries the criterion's ID, `#2399.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace
collapsed, `- [ ] ` dropped; the command in `tests/acceptance/48/README.md`), and each test's name starts with its
criterion's number. A test headed `(wrong program)` runs the scenario on the plant the criterion names and expects
the criterion's reading, a helper returning the failure message or null (for AC3, #1106's own test), to fail and name
the thing.

| ID | Criterion (whole) | Tests: each condition and where it is asserted | At this base |
|---|---|---|---|
| AC1 `#2399.a0cbc7fe` | With #1106's sample stack up, 100 identical plain HTTP requests sent to the run's filter port are each answered 403 and leave exactly one `sandbox.denied` for the run, with the operation `egress-plain-http` and that target. On the merge base the record gains 100, and this test fails | `plain-http.test.ts` (1). *Each answered 403*: the 100 answers. *Exactly one ... with the operation and that target*: the record gained one `egress-plain-http` whose target holds `dh2399-plain.invalid`, and no other event from the filter. *On the merge base the record gains 100*: BASE-FAILURE.txt | fails at `plain-http.test.ts:29`: `the record gained 100: expected 100 to be 1` |
| AC2 `#2399.c1245384` | 100 tunnels asked for to one host no credential names leave one `sandbox.denied` with the operation `egress-host`, and a tunnel to a second such host adds one more. A planted supervisor that keeps one refusal per operation records none for the second host and fails, naming the host | `tunnels.test.ts` (2). *100 tunnels ... leave one*: all refused 403, and the record gained one `egress-host` naming `dh2399-first.invalid`. *A second such host adds one more*: one tunnel to `dh2399-second.invalid:443`, refused, and the record gained exactly one `egress-host` naming it. *A planted supervisor ... fails, naming the host*: `(wrong program)` on `egress-refusal-once-per-operation` | fails at `tunnels.test.ts:52`: `100 tunnels asked for to the first host dh2399-first.invalid:443 left 100 sandbox.denied events for the run <run>, not one`. The wrong program fails BLOCKED: `DEEP_HUB_PLANT=egress-refusal-once-per-operation names no planted program` |
| AC3 `#2399.19cd984b` | #1106's third criterion runs unchanged and passes, and each of its three attempts sent a second time leaves the count of events as it was. A planted supervisor that records no refusal from the filter fails #1106's criterion, naming the placement | `standin-refusals.test.ts` (3). *Runs unchanged and passes*: #1106's own test file in a Vitest of its own, 1 passed, 0 failed, exit 0. *Each of its three attempts sent a second time leaves the count as it was*: the second test, above. *A planted supervisor ... fails #1106's criterion, naming the placement*: `(wrong program)`, #1106's own test file again with the hub's plant `egress-refusals-unrecorded`, 1 failed, its output naming all three placements | the first test passes (a regression check: #1106's criterion holds at the base). The second fails at `standin-refusals.test.ts:55`: `expected 6 to be 3`, the record having gained the same three again. The wrong program fails BLOCKED (`egress-refusals-unrecorded` names no planted program) |
| AC4 `#2399.d19e2d85` | A refusal recorded for one run doesn't hide the same operation and target for a second run beside it, and the first refusal of a run started after another ended is recorded. A planted supervisor that keeps the set without the run records none for the second run and fails, naming the run | `runs.test.ts` (2). *Doesn't hide ... for a second run beside it*: one `egress-plain-http` naming `dh2399-same.invalid` for the first run, then one for the second. *The first refusal of a run started after another ended is recorded*: one for the third run. *A planted supervisor ... fails, naming the run*: `(wrong program)` on `egress-refusals-seen-without-run` | the criterion test passes: the base records every refusal, so none hides another (a regression check the fix must keep). The wrong program fails BLOCKED (`egress-refusals-seen-without-run` names no planted program) |

### Proof

The issue's Proof: "The record's `sandbox.denied` events for each case on the branch and on the merge base, where the
hundred requests add a hundred; #1106's criterion's run; and each planted twin with its failure." The criterion tests
read the record for each case, and BASE-FAILURE.txt is the merge base's side: the hundred plain requests add a
hundred, the hundred tunnels add a hundred, and the three second sends add three. Every failure there is at an
assertion for its criterion's own reason, none at setup, a timeout or a `toThrow`. Two criterion tests pass at the
base, as the table says, because their conditions already hold there: #1106's criterion, and AC4's (the base keeps no
set for the filter, so nothing can hide). AC4 is proven wrong-program-sensitive only by its plant; AC3's first test
only by its plant. On the base no plant name exists, so each plant test is BLOCKED there: the hub refuses to start
(`DEEP_HUB_PLANT=<name> names no planted program`).

### Not tested

- The Scope's "the set the other two paths already keep, which is cleared when the run ends": whether the filter's
  refusals share the platform paths' set, and that a run's end clears it, are the supervisor's memory, which no
  surface the issue names shows. AC4's third run reaches only what a criterion states: its first refusal is recorded.
- The same refused request sent again to one run after a long time, or after a hub restart, is in no criterion.
- Requests sent from inside the run are made only by AC3 (the app's own calls); AC1, AC2 and AC4 send from outside.
- #2420's ceiling and cut are its own task. The markers add at most three targets a run, far under its 256.

## Files

- `helpers.ts`: the filter's port, plain requests and tunnels to it, the record's `sandbox.denied` events for a run,
  the marker, a second worktree with `deep env up`/`down` in any worktree, and #1106's criterion run in a Vitest of
  its own. Everything else is imported from `../1106/helpers.ts`, unchanged.
- `plain-http.test.ts` (AC1), `tunnels.test.ts` (AC2), `standin-refusals.test.ts` (AC3), `runs.test.ts` (AC4); AC2's
  and AC4's each hold their criterion's reading as a function returning the failure message or null.
- `fixtures/vitest-1106.config.mjs` and `fixtures/plant-setup.mjs`: what #1106's test runs under when this suite
  runs it (the cache's folder, and the hub's plant when one is named).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`; it type-checks clean at the base.
- `BASE-FAILURE.txt`: the run on the base commit, on Linux, home paths written `~`.
