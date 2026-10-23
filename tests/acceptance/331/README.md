# Acceptance tests for #331: `deep env up`, the repo's own stack started through the supervisor on leased ports, ready only after its health check, and torn down by run token

Written first, blind, from issue #331 (its text as of October 22, 2026: Scope, Fields, the 11 checkbox criteria,
Proof and Depends on), the issues it names (#13, #16, #18, #26, #29, #36, #236, #237, #348, #349, read for scope
only), `docs/technical-design.md` (the env-local row of First-party extensions that ship on by default; The stack
a check runs against; Extension API, `deep.registerEnvironment` and `deep.lease`; the Hub slots table's
`environment@1` row; Building blocks, Environment and lease; the Lease primitive; the `done.yaml` example's
`environment:` block; Dogfooding and How we know version 0 works), `AGENTS.md`, the acceptance tests of #236 and
#314 for their conventions and surfaces, and `packages/supervisor`, `packages/conformance`, `packages/hub` and
`packages/cli` as they are at the base commit `bddb8099fd259985b5e3155247a99b62d938e47c`, by a job that never saw
an implementation of #331. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job.

The issue has 11 checkbox criteria, AC1 to AC11 in the body's order.

## How to run

On macOS (Seatbelt is the supervisor's sandbox at this base), with the repo's Node (24.22.0) first on `PATH` and
`cc` (the Xcode command line tools):

```sh
npm ci                                            # once, if node_modules is missing
npm run generate -w @deepbuild/contracts
npm run build --workspaces                        # the tests run the built CLI, packages/cli/dist/main.js
node node_modules/vitest/vitest.mjs run --root tests/acceptance/331 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/331/tsconfig.json   # needs packages/env-local
```

- `--no-file-parallelism`: the files start real hubs, stacks and listeners on ports from 3000 up, and AC10 needs
  3000 itself; the budgets only mean something with nothing else running.
- Nothing needs the network. Every stack is the test's own dev server (`fixtures/server.mjs`, or
  `fixtures/escape.c` compiled with `cc` into `/tmp/dh331-bin-*`) listening on 127.0.0.1; every hub is a dev hub
  (`deep hub run --root`) on a temp folder; the compose test uses an image already on the machine and pulls none.
- Every test makes its folders under `/tmp/dh331-*` (real paths, short enough for a socket path), points `HOME` at
  a temp folder for itself and every child, removes the agent's own `CLAUDE_*` and `DEEP_*` variables first, and
  never touches the real `~/.deepbuild`. Test repos are git repos made in those folders, with their worktrees beside
  them (single `/usr/bin/git -C <dir> ...` calls). The suite stops only processes it started or that its fixtures
  wrote a PID file for, by PID, after checking the PID still runs one of its programs (`helpers.ts`, `cleanup`);
  never by name or port. The compose test removes only the containers labelled with the projects its own stacks
  used.
- With `--root` here, Vitest writes its cache to `tests/acceptance/331/node_modules/.vite/`; delete that folder
  before committing.

## The surface under test

The issue and the design name `deep env up`, `deep env down`, `env.up(spec, lease, checkout)` / `env.down(handle)`,
the supervisor of #236 with its run tokens and ownership records, the hub's lease table, `lease.kind@1`, the
`environment@1` kit and the `environment:` block of `.deepbuild/done.yaml`, but no command output, hub method or
package entry. These tests define the smallest surface that reaches every criterion, with those names.

### The repo's environment block (`.deepbuild/done.yaml`)

As the design's `done.yaml` example drafts it; the tests write only these keys:

```yaml
environment:
  up: "<command line>"            # the repo's own dev script, run by /bin/sh in the folder env.up is given; or
  compose: docker-compose.yml     # a compose file in that folder
  ports: [web]                    # each name a port leased per worktree, passed to the stack as the variable of that name
  ready: { http: "http://127.0.0.1:${web}/health", within: 20 }   # ready only once this answers 200; within: seconds to wait (default 60)
```

- Each name in `ports` gets a port from the hub's lease table (`lease.acquired@1`, `resource: {host: local, kind:
  port, key: "<port>"}`), handed to every process of the stack as an environment variable of that name (`web=3001`)
  and, for compose, to `docker compose` the same way, so the compose file's `${web}` reads it.
- **Ports are leased from 3000 up**: the lowest port from 3000 that no lease holds and that nothing on the machine
  listens on (127.0.0.1, `0.0.0.0` and `::` all checked). The port kind is env-local's `lease.kind@1` data, exact
  match. AC10 reads "leased port 3000" as the first lease on a fresh hub.
- `ready.within` bounds the wait; a stack whose health route hasn't answered 200 by then, or whose process ended
  first, is BLOCKED, and the cause names the route and what it last answered (`GET /health on 127.0.0.1:3001
  answered 503`). It also bounds a long build (AC5).

### The CLI

`deep env up [--root <hub root>] [--json]` and `deep env down [--root <hub root>] [--json]`, run in a worktree (the
current folder); `--root` names a dev hub as `deep hub stop --root` does. With `--json` each prints one JSON line:

```ts
// deep env up: exit 0 when ready, 3 when BLOCKED (exit.code@1)
type Up =
  | { status: 'ready'; run: string /* run:<ULID> */; worktree: string; ports: Record<string, number>; project?: string /* compose only */ }
  | { status: 'BLOCKED'; worktree: string; cause: string };
// deep env down: exit 0 when nothing is left
interface Down {
  run: string;
  stopped: number[];                         // the PIDs it stopped, each one the supervisor proved the run's
  left: { pid: number; port?: number }[];    // what it couldn't prove and so never stopped, with the leased port each still listens on
}
```

The stack runs through env-local in the hub, every process through the supervisor (#236): sandboxed, with a run
token, `process.starting@1` before each process exists and `process.tracked@1` once it does, and stopped only when
proven the run's. Teardown releases each lease only once every process recorded for the run is proven gone
(`process.ended@1` before `lease.released@1`), never for a process it couldn't prove.

### The hub

- **`run.start`** (#16's method, #236's params) takes one more optional param, `environment: true`: the run needs
  the app running. The hub brings up the environment block of the run's `cwd` (a check's temporary checkout)
  through env-local, from that folder, before the run's process starts; passes the leased ports to the run's process
  as the same variables, and lets it connect to them; and takes the stack down after the run. A stack that isn't
  ready makes the run finish `missing` (`run.finished@1`, which the verdict table makes BLOCKED), with the cause in
  its `findings`, and the run's own process never starts.
- **`lease.stale@1`**: a lease past its `expires` whose holder still runs is marked stale, keeping its holder and
  its port; it ends only by the Lease rule. "The stale lease shows as a reading" is read as that record, with the
  lease still held.
- **Test-only variables** (only tests set them):

| Variable | Effect |
|---|---|
| `DEEP_HUB_TEST_LEASE_MS=<ms>` | the term (`expires - ts`) of every lease the hub grants |
| `DEEP_HUB_TEST_CRASH=start-recorded` | the hub kills itself with SIGKILL right after a stack process's `process.starting@1` is durable, before the spawn |
| `DEEP_HUB_TEST_CRASH=spawned` | the same, right after the spawn and before its `process.tracked@1` |
| `DEEP_HUB_PLANT=<plant>` | a planted wrong program (Wrong programs, below), beside the base's plants |

- **On restart** the hub closes every start the record holds as `process.starting@1` with no `process.ended@1`:
  it reaps or reports the process (found by its run token and folder) and records the run's cleanup as
  `run.cleaned@1` (`stopped` the PIDs it stopped, `left` holding `pid:<n>` for one it couldn't prove).

### env-local and the kit

```ts
// @deepbuild/env-local — packages/env-local/src/index.ts, a new workspace package: the first-party environment
import type { Host } from '@deepbuild/supervisor';
import type { SlotFill } from '@deepbuild/conformance';
/** env-local as an environment@1 fill, starting every process through `host` (the supervisor). */
export function envLocal(options: { host: Host }): SlotFill;   // slot 'environment@1'; up(spec, lease, checkout), down(handle)
```

`environment@1` (`packages/conformance`, #314's kit) takes the design's interface: every fill's `up(spec, lease,
checkout)` gets, as `checkout`, an absolute folder that exists when it is called, and the stack must start from
it. Its `planted` holds, by these names, the issue's four: `ready-before-health`, `unleased-port`,
`leaves-grandchild` (the base's three) and `starts-in-worktree`, which starts the stack in another folder (the
session's worktree) instead of the checkout. Each FAIL carries its plant's message and names what it got wrong: the
case's health route; `port` and the port number; `pid <n>`; the word worktree and the folder's absolute path.
The reference fill and env-local pass it, fixed and seeded parts. How the kit's case hands env-local a stack it
can start (a `done.yaml` in the checkout it made, say) is the kit's to choose; the tests require only that
env-local passes.

## Criteria to tests

Each test's name starts with its criterion's number, and each `describe` carries the criterion's ID,
`#331.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace collapsed, `- [ ] ` dropped). A test headed
`(wrong program)` runs the same scenario against the planted twin the criterion names and expects the criterion's
check to fail on it, naming what the criterion says; the scenario itself must run, so a plant that doesn't start
fails that test.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#331.cc7309c3` | two worktrees, different ports, both up | `stacks.test.ts` AC1 (1): both ups at once, each health route answering from its own worktree, both ports in the lease table | fails: no `deep env` |
| AC2 `#331.86737f8a` | teardown stops only what it started | `stacks.test.ts` AC2 (1): the stack's server and child stopped; a look-alike (same program, flags and folder, no token) left running | fails: no `deep env` |
| AC3 `#331.5001b4d0` | failed health check → dependent checks BLOCKED with the cause | `health.test.ts` (3): `deep env up` BLOCKED, exit 3, the cause naming `/health` and 503, nothing left; a `run.start` with `environment: true` finishing `missing` with the cause, its process never run; the control on a healthy stack | fail: no `deep env`; `run.start` ignores `environment` (the run finishes `failed`, with no port) |
| AC4 `#331.5c02ca8a` | env-local passes environment@1; four plants fail it, naming route, port, process, worktree, at install | `kit.test.ts` (3): the four plants and the checkout argument; each plant's FAIL names its thing; env-local passes. `blocked.test.ts` AC4 (1): at install | fail: no `starts-in-worktree` plant, no checkout, no `packages/env-local`; at install BLOCKED on #348, #349 |
| AC5 `#331.ba119c50` | a port held past expiry is kept; sibling gets another; stale lease is a reading | `leases.test.ts` AC5 (1): a 4 s build on a 1.5 s lease | fails: no `deep env` |
| AC6 `#331.6e85fa63` | a port another program listens on is never leased | `stacks.test.ts` AC6 (3): the test's listener on 127.0.0.1, `0.0.0.0` and `::` at the port the hub would lease first | fails: no `deep env` |
| AC7 `#331.cba94b5d` | a hub killed mid-start reaps or reports on restart | `crash.test.ts` (2): killed before the spawn; killed after the spawn, before tracking | fails: no `deep env` |
| AC8 `#331.18b679cd` | `deep env up` under 1 s beyond the repo's start; teardown under 5 s; reference Mac, vs the merge base | `budgets.test.ts` (4): perf-lane tasks `env-up`, `env-down` valid against the merge base; `benchmarks/env.mjs up` and `down` run; the numbers on the reference Mac | fail: no tasks, no bench, no `deep env`; off the reference Mac the timing test fails BLOCKED, naming why |
| AC9 `#331.b23ec100` | a child agent in its own worktree can't use its parent's port | `stacks.test.ts` AC9 (1): the child's worktree gets another port while the parent's stack holds its own; `blocked.test.ts` AC9 (1): a child session through `deep_env` | fails: no `deep env`; the session half BLOCKED on #18, #26 |
| AC10 `#331.43266bc3` | escaped helper on 3000 reported, never stopped; lease ends; next up leases another | `leases.test.ts` AC10 (4): the run; three wrong programs | fail: no `deep env`; the plants don't exist, so the hub refuses to start (BLOCKED) |
| AC11 `#331.14c365a0` | two compose projects from run tokens on leased ports; down removes only its own | `compose.test.ts` (2): the run; the default-project wrong program | BLOCKED here: the Docker daemon isn't running on this Mac |

### How each criterion is read

- **AC1.** "Both stacks come up": each `deep env up` exits 0, ready, and GET `/health` on its port answers 200 from
  a server whose folder is that worktree. The two ups run at the same time.
- **AC2.** The stack's server starts a child carrying the run's environment; the decoy is the same program with
  the same flags in the same worktree, started by the test with no run token, with its own child. After down the
  stack's two are gone within 5 s, the decoy's two run and still answer, and `stopped` names none of the decoy's.
- **AC3.** "Dependent checks": a check that needs the app running, started through `run.start` (#16's stand-in for
  check runs, as #236's tests use it) with `environment: true` in a plain folder standing for its temporary
  checkout. Missing is BLOCKED by the verdict table (#28) and `families.ts`. The control proves the path isn't
  BLOCKED for everything: the check gets its port in `web`, reaches the stack, passes, and the stack is gone after.
- **AC4.** "Naming the route, the port, the process or the worktree" is read off each FAIL's message, as above.
  "Each fail it at install" needs the extension host's conformance step, which isn't built (blocked.test.ts).
- **AC5.** "A long build": the stack's server waits 4 s before it listens, past a 1.5 s lease term
  (`DEEP_HUB_TEST_LEASE_MS`). Then: `lease.stale@1` for its port with its holder, no `lease.released@1`, the stack
  still answering there, and a sibling worktree's up getting another port while the first still answers.
- **AC6.** "Another program" is a listener of the test's own, at the port the hub would lease first (the lowest
  free port from 3000). No `lease.acquired@1` names it, and the stack comes up on another.
- **AC7.** "Reaps or reports": before the spawn there is no process, so the restart closes the start with
  `run.cleaned@1` naming nothing left, ends the run's leases, and starts nothing late. After the spawn, the
  process is either stopped and listed in `run.cleaned@1`'s `stopped`, or still running and listed in its `left`
  as `pid:<n>`. Only the record survives the crash: the root keeps its ledger alone before the restart. This is
  the blind redraft, adopted by the user's decision on a dispute (PR #681): the first draft read the record after
  the restart and so forbade the reap from tracking what it found.
- **AC8.** "The repo's own start" is the same dev server spawned bare until its health route answers 200. Each
  round is five ups and downs interleaved with five bare starts; the number is median(up) minus median(bare start),
  and median(down); five rounds after a warm-up, judged by the timing rule. It counts only on a reference Mac
  (Mac15,7 or Mac15,12) on mains power, Low Power Mode off, no thermal warning, as the local preflight runs it;
  anywhere else it fails BLOCKED naming why. "Compared with the merge base" is the perf lane's: tasks `env-up`
  (`["node","benchmarks/env.mjs","up"]`) and `env-down` (`[..., "down"]`) in `benchmarks/budgets.json`, each
  with an `initialReason` naming #331, valid by `validateBudgets` against the merge base's file.
- **AC9.** At this base a child agent can't be made (#18 maps no child sessions; #26's `deep mcp` has no
  `deep_env`), so the half tested now is the worktree's: the child's own worktree (a worktree of the same repo
  made after the parent's stack came up) gets another port, and the parent's stack keeps answering on its own.
- **AC10.** `fixtures/escape.c` listens on the leased port, then double-forks: the middle process exits at once,
  the grandchild calls `setsid` and execs itself with an empty environment, keeping the listening socket. The
  test checks the scenario formed (the first lease is 3000; the helper's PPID is 1, it leads its own group, has no
  run token, listens on 3000, and no `process.tracked@1` names it) and fails BLOCKED if not; port 3000 already in
  use on the machine is BLOCKED too. Then: the stack's server is gone; the helper still runs; `deep env down`'s
  `left` holds `{pid: <helper>, port: 3000}`; `lease.released@1` for port 3000 comes within 10 s and after
  `process.ended@1` for every process recorded for the run; no `lease.acquired@1` for 3000 follows it; and the next
  up in the worktree is ready on another port.
- **AC11.** The repo's compose file names itself (`name: shop`, the repo's default project name in every
  worktree) and serves `/health` from a bind-mounted folder with busybox `httpd` on container port 3000, published
  as `${web}:3000`. "Named from their run tokens" is read as: each up reports its `project`, the two differ, and
  neither is the default (`shop`) nor compose's default for the folder (the token's value is never read). Down in
  one: no container labelled `com.docker.compose.project=<its project>` remains; its lease ends, and never while
  such a container remains; the other project's containers remain, it still answers, and its lease holds. Docker
  must be reachable and have `busybox` (or `alpine`) locally; otherwise BLOCKED, naming why.

## Wrong programs

| Plant | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| `DEEP_HUB_PLANT=env-kills-by-port` | AC10 | at down, stops whatever listens on the run's leased ports | the helper is stopped; the failure names it and port 3000 |
| `DEEP_HUB_PLANT=env-leases-port-again` | AC10 | leases a port a released lease held without checking it free | the next up leases 3000 again; the failure names 3000 |
| `DEEP_HUB_PLANT=env-holds-lease-for-helper` | AC10 | keeps the lease while anything still listens on its port | the lease on 3000 never ends; the failure names 3000 |
| `DEEP_HUB_PLANT=compose-default-project` | AC11 | runs `docker compose` without a project of its own | both worktrees share `shop`, the second up replaces the first; the failure names the project |
| `environment@1`'s four planted fills | AC4 | as above | each fails the kit, naming what it got wrong |

The criteria that name no twin (AC1, AC2, AC3, AC5, AC6, AC7, AC8, AC9) fail on the base, which has no `deep env`
command, no env-local, a `run.start` that ignores `environment`, and a kit whose fills get no checkout
(BASE-FAILURE.txt); past that, the mutation lane is their wrong program.

## What depends on other issues

- **#348, the extension host**, and **#349, extension slots**: AC4's "at install". `blocked.test.ts` fails BLOCKED
  until they land; the kit half is tested here through `runKit`.
- **#18, child sessions**, and **#26, `deep_env` in `deep mcp`**: AC9's child agent. BLOCKED until they land; the
  worktree half is tested here through `deep env up`.
- **#237, the lease table**: not built at this base (the supervisor of #236 keeps fixed pools). These tests demand
  the lease behavior the issue names regardless, through the record's `lease.*@1` events; #331 can't pass
  without it.
- **Docker**: AC11 runs only where the daemon is reachable with a local busybox or alpine image; here it is
  BLOCKED.
- **The reference Mac**: AC8's numbers count only there, in the local preflight.

So a PR for #331 that passes everything else says `Part of #331` and lists AC4's install half, AC9's child-session
half, and (until it runs where Docker is up) AC11 as open.

## Files

- `helpers.ts`: temp folders, test repos and worktrees, the escape fixture's build, PID files and `ps`/`lsof`, ports
  and listeners, the hub as a process and its line protocol, `deep env up`/`down` as a person runs them, Docker's
  reachability, the reference-Mac gate and the timing judge.
- `stacks.test.ts` (AC1, AC2, AC6, AC9), `health.test.ts` (AC3), `kit.test.ts` (AC4), `leases.test.ts` (AC5, AC10),
  `crash.test.ts` (AC7), `budgets.test.ts` (AC8), `compose.test.ts` (AC11), `blocked.test.ts` (AC4, AC9).
- `fixtures/server.mjs` (the repo's dev server: a child, a long build, an unhealthy route), `fixtures/check.mjs`
  (AC3's check that needs the app), `fixtures/escape.c` (AC10's escaping helper).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`; at this base its only error is
  the missing `packages/env-local`.
- `BASE-FAILURE.txt`: the run on the base commit.
