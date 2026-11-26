# Acceptance tests for #3377: a compose service can't read its checkout bind mounts on Linux

Written first and blind, from issue #3377 (`gh issue view 3377 --repo windoliver/deepbuild`), the design
(`docs/technical-design.md`: Sandbox and budgets, Dogfooding), `AGENTS.md` and the base commit `4eed9684f` (head of
`fix/bwrap-docker-socket`, #3371's fix, which #3377 builds on), by a job that never saw an implementation; no other
branch, pull request or stash was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding).

| Criterion | Tag | Test (`mounts.test.ts`) |
|---|---|---|
| AC1: on Linux, `tests/acceptance/580/` gets past `the database service db never answered on its port`, each test's result recorded beside the merge base's | `#3377.6ef73b11` | not here: a recorded hand run of `tests/acceptance/580/`, not this job's |
| AC2: on Linux, after a stack comes up, `<home>/.deepbuild` and `<home>/.deepbuild/checkouts` keep mode 0700, and another checkout's folder is not readable by any uid but yours; a planted change that chmods the checkout tree 0755 must fail it | `#3377.28c30daf` | `AC2 #3377.28c30daf …`; twin `checkout-0755` (`twins.json`) |
| AC3: a stack whose database service exits before it answers yields a finding that names the service, its exit code and its last log line; the merge base must fail it | `#3377.ac962c70` | `AC3 #3377.ac962c70 …` |

Tags follow `scripts/proof-change.mjs`'s `criterionId` (sha256 of the criterion's text, whitespace folded, first 8 hex),
computed from the live issue. Each test is its own top-level `test()`, named from its criterion and tag, no subtests.

## What was read

- `AGENTS.md`; `docs/technical-design.md` (Sandbox and budgets, Dogfooding).
- At the base: `tests/acceptance/3371/` (house style, twins), `tests/acceptance/580/` (`helpers.ts`: `Bench`, the
  sample and its compose files, `sandbox.test.ts`, `isolation.test.ts`, `pool.test.ts`, the journey's `/go` hold),
  `packages/env-local/src/warm.ts` (`serve`, `up`, `dbReady`: its one cause `the database service <s> never answered on
  its port`), `packages/env-local/src/stack.ts` (`composeRefusal`, `SERVICE_KEYS`, the `compose` lease that names a
  stack's project), `packages/gate/src/checkouts.ts` (`made`: `mkdtemp(<root>/checkouts/c-)`, `checkout`),
  `packages/hub/src/core.ts` (where the checkouts live), `scripts/proof-change.mjs` (`criterionId`).

## The surface under test

A real `deep hub run` on #580's sample (`Bench` from `../580/helpers.ts`, imported, not copied): HOME a temp folder
under `/tmp/dh580-*`, sessions played through the real deep-hook, the record read through the hub's socket, Docker
read with `docker ps`/`inspect`. Nothing is mocked.

- **AC2.** Two worktrees, `stack.slot` 2, both journeys held at `/go`, so both runs' checkouts stand while both stacks
  are up (each has its `stack.served`). Then: `stat` of `<home>/.deepbuild` and `<home>/.deepbuild/checkouts` is `0700`;
  and for each run's checkout (`stack.served.checkout`, which must be under `<home>/.deepbuild/checkouts/`), the other
  run's stack being up, a `busybox:1.36` container run as uid 999 (postgres's, so a service's user), 4242 and 65534
  (nobody) with the checkout folder bind-mounted lists it, and must fail. "Not readable by any uid" is tried, not read
  off mode bits, because that is how a compose service meets a mount: the daemon mounts as root, so the 0700 folders
  above the checkout don't guard it. A control listing as your own uid must succeed, or the daemon maps uids (userns
  remap, rootless) and the test is `BLOCKED`.
- **AC3.** The sample with its `db` service (still `postgres:16`, so env-local takes it as the database) given an
  `entrypoint` that writes `deep-3377: starting`, then `deep-3377: the database gave up before it answered`, to
  stderr and exits 93, committed before the session starts. The claim's run must end not passed; when the db
  container is still there its own exit code must read 93 (the scenario formed); and the run's finding that names
  `db` must also hold `93` (as a whole number) and the last line.

Not Linux, no daemon, a missing image or a hub that doesn't start: a failure starting `BLOCKED:`; nothing is skipped.
Docker objects are removed only by the compose projects this hub recorded (`stack.served`, and for AC3, whose stack
never comes up, the hub's `compose` lease), and only when every container of it names this world's folder; the probe
containers are `--rm`.

## The planted twin for AC2: `twins/checkout-0755`

`twins/checkout-0755/packages/gate/src/checkouts.ts` is the base file with one change, in `checkout` where a run's
checkout is made: after the tree is written, `chmod -R 0755` on the checkout. It is a natural wrong fix: the db's
mount becomes readable to postgres, so the stack comes up, and every other uid reads every checkout. AC2 must fail on it
at the listing assertions ("uid … listed … checkout").

## Running

On Linux with Docker (images `postgres:16`, `redis:7`, `busybox:1.36` local), from a checkout with `npm ci`,
`npm run build --workspaces` and `cargo build --locked -p deep-hook` done:

    NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3377 --no-file-parallelism
    node node_modules/typescript/bin/tsc -p tests/acceptance/3377/tsconfig.json

The twin: overlay `twins/checkout-0755/packages/gate/src/checkouts.ts` onto a copy of the checkout,
`npm run build -w packages/gate`, run the suite there; AC2 must fail. The base run is in `BASE-FAILURE.txt`, the twin
run under "Twin failure" below.

## What can't be told apart

- On the base AC2 can't reach its assertions on Linux: the stack never comes up (the bug itself), so it fails at
  `served` (`ended failed with no stack.served event`), not at a mode or listing. That is a failure, not a pass; the
  twin is what shows the assertions catch the wrong program.
- AC2 tries uids 999, 4242 and 65534, not every uid; a fix that opened a checkout to one other chosen uid (say an ACL for
  uid 70) would pass. AC2 lists the checkout's top folder only: a fix that leaves `c-*` 0700 but opens a folder inside
  it to others (an ACL on `db/init` alone) passes, which is what the issue's scope allows.
- AC3 reads the exit code as the whole number 93 anywhere in the finding that names `db`; a finding that held 93 for
  another reason would pass. The last line holds no digit, so it can't supply the 93.
- AC2 doesn't check the stack's own checkout's folder, which a fix by ACL may open to the service's uid.

## Twin failure

`twins/checkout-0755` on the same Linux machine (Linux 7.0.0-1025-nvidia aarch64, Docker 29.6.2, Node v24.22.0, Vitest
5.0.5), 2026-11-24T10:41:37Z, load 29.33 36.22 51.76 before (not waited on): a `cp -a` of the base clone, the twin's
`checkouts.ts` copied over `packages/gate/src/checkouts.ts`, `npm run build -w packages/gate` exit 0 (so the twin
type-checks), then the suite's command: exit 1, 156.5 s.

- `AC2 #3377.28c30daf` FAILED at its listing assertions, 6 of them: uids 999, 4242 and 65534 each listed both runs'
  checkouts (`<home>/.deepbuild/checkouts/c-<rand>`, mode 0755) while the other run's stack was up. Both stacks came
  up (each run had its `stack.served`): opening the tree let postgres read `db/init`, which confirms the issue's cause.
  The 0700 assertions on `<home>/.deepbuild` and `checkouts` held, as the twin leaves them alone, and the own-uid
  control listed each checkout.
- `AC3 #3377.ac962c70` FAILED as on the base (the twin doesn't touch env-local): the finding names neither 93 nor the
  last line.
