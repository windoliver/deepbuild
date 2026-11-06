# Acceptance tests for #580: warm stacks, start steps kept by their inputs, a template database each run clones, and only the app started from each run's checkout

Written first, blind, by a job that never saw an implementation of #580; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #580 as of 2026-11-05T23:05:08Z: Scope, the 10 checkbox criteria (AC1 to AC10 in the body's order), Proof and
  Depends on (#331, #332, #31, #236, #237, #1017; #29 and #342 as the body names them).
- `docs/technical-design.md`: First-party extensions that ship on by default (env-local's row, Start steps, Warm stacks),
  How runs become one of five verdicts (The stack a check runs against), An agent says it's done (Fast and slow lanes,
  Slow runs start when the turn ends), the `done.yaml` example, Dogfooding. `AGENTS.md` (Proof).
- At the base `d722ba3d929b368edb653682fd76926ae578aa74` (main, 2026-11-05), for surfaces and conventions only:
  `tests/acceptance/331`, `332`, `1017`, `29` (`stack.test.ts`, `h-d.ts`), `907`, `965`, `321`, `packages/env-local`,
  `packages/gate/src/stack.ts`, `packages/hub/src/stacks.ts`, `products.ts`, `plant.ts`, `runs.ts`, `gate-runner.ts`,
  `packages/conformance/src/slots/environment.ts`, `packages/supervisor/src/seatbelt.ts`.

What the base does: `environment` is exactly one of `up` or `compose`; `seed` writes a file database; `run.start` with
`environment: true` starts a stack for a run and takes it down at the run's end, and no claim's check sets it, so a
claim's journey at the base runs with no stack at all (BASE-FAILURE.txt: `Cannot find package 'dh-wire'`). There is no
`install`, `migrate` or `caches`, no kept step, no warm stack and no `stack.slot`.

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"   # the repo's Node, 24.22
npm ci                            # once
npm run build --workspaces        # every test starts `deep hub run` from packages/cli/dist
cargo build --locked -p deep-hook # the sessions' hooks
docker pull postgres:16 && docker pull redis:7 && docker pull busybox:1.36            # once; the tests pull nothing
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/580 --no-file-parallelism <file>   # one file at a time
node node_modules/typescript/bin/tsc -p tests/acceptance/580/tsconfig.json
```

- Docker must be running (29.4 here). `postgres:16` and `busybox:1.36` were pulled once for this suite; `redis:7` and
  `postgres:16` are the sample's services, `busybox:1.36` the base of its `web` image. A missing image or an unreachable
  daemon fails BLOCKED, naming it. Tests never pull.
- `--no-file-parallelism`, since each scenario runs real Postgres and Redis containers.
- Estimated, not measured, since nothing has run past the first `stack.served`: 3 to 8 min for a scenario of three
  claims, about 15 min for `pool.test.ts`, 20 min for `budgets.test.ts`. Delete `tests/acceptance/580/node_modules/.vite`
  if Vitest leaves one.
- Folders are under `/tmp/dh580-*`; HOME is a temp folder for the hub and every session; no model, no sign-in, no registry
  (`dh-wire` is a tarball in the sample). Processes are stopped by PID. Docker objects are removed by the compose projects
  this test's hub recorded in `stack.served`, never by name or port.

## The surface under test

The issue names `install`, `migrate`, `seed` with `database`, `caches`, the record ("each start step's time, run or
reused, with its key"), `stack.slot`, `environment@1` and "uncounted". It gives no event, field or setting for them.
These tests define the smallest surface that reaches every criterion; each choice is listed so a dispute can name it.

### A journey

**A check of a definition, covering a requirement at `depth: journey`, in a repo whose `.deepbuild/done.yaml` has an
`environment` block, runs on a stack started from its own checkout.** The tests never start a stack by `run.start`: a
session's stop makes the claim, as the design has it. The check is a drafted `sh` file running `node --test`
(`.deepbuild/checks/orders.sh`, `cart.sh`), in the command check kind's sandbox; it gets each leased port in the
variable the port is named by (`web`, `db`, `redis`), as #331 hands them, and `hosts` for its own stack's ports.
The record holds five clean runs of it at 300 s, so the lanes put it in the slow lane, and it starts at a green stop whose
reply ends the turn. The design's `type: journey` with `file:` is the journeys extension's and isn't used.

### `done.yaml`

```yaml
environment:
  compose: docker-compose.yml         # the services
  up: "node src/server.mjs"           # the app, started from each run's checkout
  ports: [web, db, redis]
  ready: { http: "http://127.0.0.1:${web}/health", within: 120 }
  install: "npm ci"
  migrate: "npm run db:migrate"
  seed: { run: "npm run db:seed", database: DATABASE_URL }
  caches: [.next/cache]
  products:                           # AC4 only, as #1017 defines it
    - { name: node_modules, path: node_modules, key: [package-lock.json], key_values: [], build: "npm ci" }
```

- **`compose` and `up` together** (the base refuses it: "exactly one"): `compose` holds the services and `up` the app. The
  compose sample (AC3) has no `up`: `web` is a compose service built from the repo.
- **The database service** is the compose service whose image is `postgres`; nothing in `done.yaml` names it. The URL
  handed in `seed.database`'s variable is `postgres://postgres@127.0.0.1:<db's published port>/<name>`. `migrate` and
  `seed` get the template database in it (`POSTGRES_DB`, `shop`, is the sample's), and each run its clone. Both also get
  every leased port by name. The sample's Postgres runs with `POSTGRES_HOST_AUTH_METHOD: trust`.
- **`$DEEP_SEED_RECORD`** stays #332's: the seed step writes `{source, copied_at, migration}` there. Redis's data is
  saved by the seed (`SAVE`), so the volume copy carries it.
- `web` in `docker-compose.yml` uses `build:`, and `db` binds `./db/init` read-only (`:ro`), which `composeRefusal` wants.

### Settings

`stack.slot`: `{ "stack": { "slot": 2 } }` in `<root>/config.json`. It is a lease kind: `lease.acquired` and
`lease.released` with `resource.kind: 'stack.slot'`.

### The record

**`stack.served`** (new event kind, one per run), appended once the run's stack is ready and before the check's process
starts, so a test can read Docker while the run lasts:

```ts
{
  run: string,                        // the check's run handle, as run.started names it
  stack: string,                      // the warm stack's own identity, the same across its runs
  project: string,                    // its compose project
  checkout: string,                   // the folder the run's stack serves, as its real path
  ports: Record<string, number>,      // by name
  ready_ms: number,                   // from the run leaving the queue to the health route answering 200
  steps: {
    step: 'services' | 'install' | 'migrate' | 'seed' | 'clone' | 'app',
    status: 'ran' | 'reused',
    key: string | null,               // holds 12 or more hex digits; null for clone and app
    ms: number,
    product?: { name: string, key: string },   // install: the store's entry
  }[],
  caches: { path: string, digest: string }[],
  images: { service: string, image: string, context_digest: string, built: boolean }[],   // each image built from the repo
  mounts: { service: string, source: string, target: string }[],                          // each bind mount of the repo
}
```

- **Failing `environment@1`** on a run: a line in `run.finished.data.findings` containing `environment@1` and naming what
  the issue says (the step and both keys; the database; the service). The core checks each run against the slot's rules
  from what the supervisor recorded, never the environment's word (invariant 1). The issue's other wording, "fails this
  test", is a test assertion. The conformance kit (`slotKits()`, `runKit`) isn't used: a planted fill there runs the kit's
  fixture server, with no Postgres to show 2 orders. See What this doesn't test.
- **Uncounted** (AC3): `run.finished.data.outcome === 'uncounted'`, its `findings` naming the image or the mount, as
  #29's `attributeStack` words them.
- **`stack.waiting`** (new event kind): a check waiting for a `stack.slot`, `{ claim, check, wait_ms, expected_ms }`, where
  `expected_ms` counts `wait_ms`.
- **`sandbox.denied`** (existing, AC10): gains `holder`, the holder of the lease on the port refused, as `lease.acquired`
  names it; its `target` or another field holds the port.
- Install entries live in #1017's store as `<root>/products/<repo>/node_modules@<key>`, with `key` the `product.key` above.

### Digests

`context_digest` and a cache's `digest` are one function over a set of files: `sha256:` and the hex SHA-256 of one line
per file, `<path>\0<hex SHA-256 of its bytes>\n`, sorted by path in byte order, each path relative to the context or the
cache folder (`helpers.ts`, `treeDigest`). The sample's context is what its `.dockerignore` leaves: `Dockerfile` and
`src/**`.

### Plants

`DEEP_HUB_PLANT=<name>`, tests only. All are new but `env-kills-by-port` (#331), which AC6 reuses for a warm stack's run end.

| Plant | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| `env-reuses-stale-install` | AC1 | reuses the kept install after the lockfile changed | the third run's findings: `environment@1`, `install`, both keys |
| `env-keeps-database` | AC2 | gives every run one database | the second run shows 2 orders; `environment@1` naming the database |
| `env-keeps-redis` | AC2 | leaves Redis running between runs | the counter carries over; `environment@1` naming `redis` |
| `env-reuses-web-image` | AC3 | runs the image built from the previous snapshot | the run is uncounted, naming the image |
| `env-keeps-db-mount` | AC3 | leaves `db` mounted from the previous run's checkout | the run is uncounted, naming `<previous checkout>/db/init` |
| `env-second-install-store` | AC4 | keeps installs in a folder of its own under the hub's root | the test finds that `node_modules` on disk and names it |
| `env-clones-next-whole` | AC5 | clones `.next`, not `.next/cache` | the app finds `.next/BUILD_ID` in its checkout; the failure names it |
| `env-kills-by-port` | AC6 | stops whatever listens on the run's leased ports at a run's end | the helper the supervisor can't prove is stopped; the failure names the port |
| `pool-reclaims-running` | AC7 | reclaims a stack whose journey runs | B's containers go; the failure names worktree B |
| `env-starts-at-every-claim` | AC8 | starts the stack, or installs, at every claim | `stop 2, answered "proceed"` named with what it started |
| `sandbox-any-loopback` | AC10 | admits every loopback port | C's insert lands in A's table; the failure names the port |

## The sample

`fixtures/sample`, assembled per test by `helpers.ts` (`makeWorld`), with the journeys moved to `.deepbuild/checks` and
`docker-compose.host.yml` or `.web.yml` as `docker-compose.yml`:

- Postgres (`postgres:16`, `./db/init` bind-mounted, volume `db-data`) and Redis (`redis:7`, append-only, volume `redis-data`).
- `npm ci` installs one dependency, `dh-wire` (`fixtures/wire`: a Postgres and a Redis client in about 100 lines), from a
  tarball in `vendor/`; the app can't start without it. A lockfile change moves it from 1.0.0 to 1.0.1.
- `npm run db:migrate`, `npm run db:seed`, and a `postinstall`, each logging one line to `<obs>/steps.jsonl`: the truth of
  what ran, beside the record. `<obs>` is a folder of the test's, named in the tracked `obs.json`.
- `src/server.mjs`: orders in Postgres, a visit counter in Redis, one line to `<obs>/app.jsonl` as it starts (PID, folder,
  database, what `.next` held before it wrote anything, whether `node_modules` is a link), and `/report`, the journey's
  way out of its sandbox, to `<obs>/journey.jsonl`. `/go` holds a journey while `<obs>/hold-<worktree>` exists.
- With `seed_mb` in `obs.json` the seed pads the database to that size with random text (AC9: 50, which reads 62 MB).

The sample was dry-run without DeepBuild on Docker 29.4 (compose up, install, migrate, seed, app, journey, both compose
files): one order on the first journey; a second on the same database starts with 1 order, shows 2 and fails.

## Criteria to tests

| ID | File | Tests |
|---|---|---|
| AC1 | `start-steps.test.ts` | three claims: all steps ran; each reused with its key and none logged; install, migrate and seed ran with new keys, `dh-wire` 1.0.1 in the app, and two `node_modules@` entries kept. Plant: `env-reuses-stale-install` |
| AC2 | `isolation.test.ts` | three runs on one stack, each with no orders, visits 0, the seed's Redis key, exactly 1 order and a database of its own. Plants: `env-keeps-database`, `env-keeps-redis` |
| AC3 | `images.test.ts` | the compose sample, Docker read during the run: a new `web` image, the digest equal to the live worktree's `Dockerfile` and `src/**`, `db`'s mount in the run's checkout, `db` restarted, its volume and template kept, the seed reused. Plants: `env-reuses-web-image`, `env-keeps-db-mount` |
| AC4 | `store.test.ts` | `product.built` first; a claim logs no install, its record names the entry and `product.built`'s key; no other install under the hub's root. Plant: `env-second-install-store` |
| AC5 | `caches.test.ts` | the second run finds `.next/cache/compiled` from the first, no other `.next` file, and the record's digest equals `treeDigest` of what it found. Plant: `env-clones-next-whole` |
| AC6 | `teardown.test.ts` | a run's app, clone and copied volume go and `db` answers; a compose change and `SessionEnd` each take the containers down before the port leases end. A helper the supervisor can't prove: left alone, the stack not reused, other ports, `services` ran. Plant: `env-kills-by-port`. Reclaim is read in AC7 |
| AC7 | `pool.test.ts` | `stack.slot` 2, worktrees A to D; C reclaims A; D waits with `stack.waiting`, B's containers standing, until B's verdict lands; no `ask.created`; never over 2 slots. Plant: `pool-reclaims-running` |
| AC8 | `lanes.test.ts` | the planted sorter's "proceed" on a turn changing the lockfile: no step logged, no app, no journey, the warm stack's containers, volumes, databases and `db`'s start time unchanged; the next stop's run installs. Plant: `env-starts-at-every-claim` |
| AC9 | `budgets.test.ts` | one cold run and five on unchanged keys: `ready_ms` less `app`'s `ms` against 5 s, `clone`'s `ms` against 1 s, a template of at least 50 MB, kept products (`du` of the store and Docker's size of the project's volumes) under 2 GB and over 50 MB |
| AC10 | `sandbox.test.ts` | A warm; C's journey tries `INSERT` on A's `db` port with the real client: refused, A's table unchanged by `psql`, `sandbox.denied` on C's run with A's lease's `holder`. Plant: `sandbox-any-loopback` |

### AC9's judgement

Every run within its limit: PASS (load only slows a reading). Over it, on a machine loaded past its cores or off a
reference Mac (Mac15,7 or Mac15,12): INCONCLUSIVE, a skip naming the reading, never a pass and never a FAIL. On a fit
machine, every run over by more than the margin (5% or the runs' spread): FAIL. Nothing gates on mains power or a quiet
machine (the owner's rule). The disk budget isn't a timing, so it's a plain assertion.

## Wrong programs

Each `(wrong program)` test runs its criterion's scenario on its plant and expects the criterion to fail, naming what
the issue says. A hub that doesn't list the plant is BLOCKED, never a pass. Beyond the plants, each scenario's readings
come from what the sample logged and what Docker shows, so a hub that writes the record and does nothing fails: a
`reused` step logged by the sample, an app in the wrong folder, a clone still in `pg_database`.

## Redrafts

- **AC1's wrong-program test** is replaced by `start-steps-redraft.test.ts`, written blind on a dispute, from the issue,
  the design and this README, with no implementation read. The `(wrong program)` test in `start-steps.test.ts` stays in
  that file unchanged, and no longer counts. It could pass on no program: `criterion()` reaches `passed(third)`, whose
  first assertion is `expect(environmentFailures(...)).toEqual([])`, and Vitest prints that list as `[ Array(1) ]`, so the
  message it read could never hold `install` or the keys. The redraft runs the same scenario and reads the third run's
  `run.finished.findings` directly, as AC2's plants do: a line holding `environment@1`, `install`, the key the second run
  recorded for install, and a second, different key. AC1's main test is unchanged.

## What this doesn't test

- **Not yet run past the base:** each session, claim, task and journey ran on the base up to the missing `stack.served`
  (BASE-FAILURE.txt), and the sample was dry-run by hand, but every assertion after `stack.served` has never executed,
  since no implementation exists. A helper bug there is a dispute for a blind redraft, not a fault of the work.
- **"In the local preflight" (AC9):** no task in `benchmarks/budgets.json` is required; the criterion's budgets are read
  here and it calls them targets. A follow-up to the perf lane, as #1017 has, isn't asserted.
- **`environment@1` through the conformance kit:** AC1 and AC2's plants are the hub's and judged on real runs (The record,
  above). A third-party `deep.registerEnvironment` fill that keeps a database isn't covered by these tests.
- **The scope's other lines, not in a criterion:** a base run's install coming from the head run's (#31); a service
  with no seed step starting empty; the template kept for the two most recent seed keys; SQLite's copy-on-write clone
  or a volume-copy clone, since the sample is Postgres; a sandboxed process refused the hub's own ports; the
  `on_base: fails` order on one stack; a least-recently-used reclaim among several idle stacks (AC7 has one).
- **The lanes reading the steps (#29):** covered by #29's `AC34` on the scheduler's model; here only the record.
- **Spec-draft drafting the start steps** from a repo: not in a criterion.
