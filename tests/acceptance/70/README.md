# Acceptance tests for #70: Linux: the hub, deep-hook and the CLI, with the CLI as the trusted path

Written first, blind, from issue #70 (its body as of November 6, 2026; it has no comments), `docs/technical-design.md`
(How it installs and its Platforms list; One role per credential; The trusted path is a device you paired; Destructive
commands you approved; Secret; Decided: Answers from the terminal, Hub lifecycle, Grants and the sandbox, Linux) and
base commit `c12a65bb`, by a job that saw no implementation of #70's remaining work. The bubblewrap backend from PR #987
is merged and reused here, not rewritten. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job.

The issue has eight criteria, AC1 to AC8 in the body's order, with IDs as `scripts/proof-change.mjs` computes them
(SHA-256 of the text, trimmed, white space collapsed). Each test's title starts with its criterion and ID.

| Criterion | ID | File | Tests | Lane |
|---|---|---|---|---|
| AC1: the R1 end-to-end suite on Ubuntu LTS and Fedora, with Claude Code and Codex | `#70.3a94aeb5` | `e2e.live.test.ts` | 2 | by hand, in each VM |
| AC2: an answer typed from inside an agent's process tree is refused | `#70.eb5a58a0` | `answers.test.ts` | 1 + 1 wrong program | VM |
| AC3: a secret through the CLI lands in the Secret Service, never in a file or a log | `#70.18ce54cd` | `secret.test.ts` | 1 | VM |
| AC4: bubblewrap passes the suite on both distributions; planted egress and a profile with no network filter fail it | `#70.ef8d1e25` | `sandbox.test.ts` | 1 + 2 wrong programs | VM, in each |
| AC5: on a filesystem without copy-on-write, a command of unknown reach becomes an ask | `#70.7f24fc90` | `staging.test.ts` | 1 + 1 wrong program | VM |
| AC6: the same budgets, measured on the Linux reference machine | `#70.6c040d74` | `budgets.test.ts` | 1, always BLOCKED | none until a machine is named |
| AC7: an authority answer from `systemd-run --user` or a double fork counts only once polkit confirms you | `#70.b6da6dea` | `answers.test.ts` | 2 + 2 wrong programs + 1 on the real polkitd | VM |
| AC8: `systemctl --user restart` leaves a hosted terminal's program and a kept run running, and the hub reattaches both | `#70.047e3c2e` | `restart.test.ts` | 1 + 1 wrong program | VM |

## How to run

Inside each VM, from a login shell (`limactl shell deep-ubuntu`, `limactl shell deep-fedora`), in a checkout of the
repo, with Node 24.22 first on `PATH`:

```sh
npm ci && npm run build --workspaces              # the CLI, the hub and the supervisor's Linux helper
cargo build --locked -q -p deep-hook
node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/70 --exclude '**/*.live.test.ts'
node node_modules/typescript/bin/tsc -p tests/acceptance/70/tsconfig.json
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> CODEX_API_KEY=<key> \
  node node_modules/vitest/vitest.mjs run tests/acceptance/70/e2e.live.test.ts       # by hand: spends plan usage
```

- `--no-file-parallelism` is required: the hub's unit name is fixed, so one test at a time holds the machine's service.
- **Throwaway VMs only.** The tests install `deepbuild-hub.service` into the real user manager and, for one AC7 test,
  put a rule into the real polkitd. A machine with a `deepbuild-hub.service` of its own fails BLOCKED; it is never touched.
- Every missing thing fails with `BLOCKED` in the message; nothing skips. Off Linux every test reads BLOCKED.
- Every test makes its folders under `/tmp/dh70-*` (AC5 also under `/dev/shm/dh70-*`) and sets `HOME` to a temp folder
  for every process it starts. Only the unit folder is real: `XDG_CONFIG_HOME` stays the user manager's own for
  `deep hub start`, or the manager would never see the unit. No child inherits a billing key or a `CLAUDE*`, `CODEX*`,
  `DEEP_*`, `GIT_*` or other `XDG_*` setting of the runner's.
- Tests stop only processes they started, by PID, each checked against the start time first read for it.
- `scripts/lanes.mjs` should list `tests/acceptance/70/` in `byHand`: no lane here reaches a VM, and on a Mac every test
  fails BLOCKED. This job edits nothing outside its folder.

### What each VM needs

| Needed | For | Missing reads |
|---|---|---|
| Node 24.22, Rust, `cc`, git, procps, GNU `cp`, `python3` | the build, AC3's terminal, AC5's control | BLOCKED, or a build failure |
| A running `systemd --user` (`loginctl enable-linger`), with `XDG_RUNTIME_DIR` and the session bus | every hub test | BLOCKED |
| `/usr/bin/bwrap`, unprivileged user namespaces, Linux 6.7+ (Ubuntu 26.04 needs no allowance, even with `kernel.apparmor_restrict_unprivileged_userns=1`) | AC3, AC4, AC8 | BLOCKED |
| `secret-tool` and a Secret Service on the session bus with its `login` collection unlocked; headless, start `gnome-keyring-daemon --foreground --login --components=secrets` with a generated password on stdin, through `systemd-run --user` with `StandardInputData`; the daemon outlives the unit. `--unlock` on a daemon D-Bus already started creates nothing, so stop that one first | AC3 | BLOCKED |
| `/dev/shm`, a tmpfs | AC5 | BLOCKED |
| `pkcheck`, polkitd on the system bus, passwordless `sudo` | the real-polkitd AC7 test only | BLOCKED |
| A journal that holds the service's output (user or system) | AC3 | BLOCKED |
| `claude` and `codex`, signed in | AC1 only | BLOCKED |

## The surface under test

### Merged surfaces, used as their suites define them

- **`deep hub start`** (#19, `packages/hub/src/service.ts`): writes `deepbuild-hub.service` and enables it through the
  real `systemctl --user`. A drop-in beside the unit (`deepbuild-hub.service.d/dh70.conf`) carries the plant and the
  polkit stub, so the unit `deep` wrote is what runs. The hub's journal output and `MainPID` are systemd's.
- **The hub's socket** with the control token, as `cli` or `app`: `events.read`, `run.start`.
- **`deep setup`, `deep install`, `deep inbox answer`** and the exit table: 0 counted, 3 not decided.
- **`DEEP_HUB_PLANT`** with its merged plants: `answer-inside-session`, `answer-on-peer-check`, `stages-without-copy`.
- **The asks core and the record**, seeding an authority ask before the hub starts, as #19's and #24's suites do.
- **`@deepbuild/supervisor`**: `bubblewrap`, `sandboxSuite`, `plantedBackends`, `HELPER`.
- **`scripts/lanes.mjs`**'s `releaseLanes` and **#48's** `harness.live.test.mjs` (AC1).
- **The Claude Code stand-in** `fixtures/claude.mjs`, copied from #19's suite: one process per session, the parent of
  what its hooks and its Bash tool run, so the hub's peer check finds it above them. It decides nothing.

### Assumed surfaces: names the design implies, none exists at the base

1. **`DEEP_HUB_TEST_POLKIT=<program>`**, set on the hub. On Linux the hub asks polkit by running `pkcheck`, with
   `--action-id`, `--process` for the deep command and `--allow-user-interaction`; this setting names the program to run
   in its place, with the same arguments. Exit 0 is polkit confirming you, anything else is not. See The polkit boundary.
2. **The hub asks polkit, not the CLI**, as on macOS (`confirm.ts`: a confirmation a client reports is a claim the hub
   can't check). A stub set on the hub alone would not reach a CLI that asks for itself.
3. **`packages/hub/native/*.policy`**: where an action file ships, if the implementation defines one. The real-polkitd
   test installs each with `sudo`, as a package's install would. None there is fine if it uses a stock action.
4. **`deep secret add <package> <name>`**: reads the value from the terminal with echo off, after a prompt whose last
   line holds `value`, `secret` or `key` and ends in `:` or `?`; exit 0 saved, exit 3 not decided. It goes through
   `enterSecret`, which keys a secret by the package that names it.
5. **Where the Secret Service keeps it**: attributes `service=deepbuild.secret` and
   `account=deepbuild/<package>/<name>`, the same two keys `keychainStore` uses for `-s` and `-a` on macOS.
6. **`deep secret list --json`**: one JSON line per held secret, `{secret, provider}`, from the host's `heldSecrets()`,
   which asks the store.
7. **Hub methods for a hosted terminal, role `app`**: `terminal.open {argv, cwd, cols, rows, title}` →
   `{terminal, run, pid}`, kept past a restart; `terminal.tab {terminal}` → the host's `TerminalTab`;
   `terminal.input {terminal, text}`. At the base terminals exist only inside the extension host, reached by a piece's
   action, and the hub has no way to approve run-as-you. These three are the smallest way a test can reach one through
   a real service. A redraft could go through a package instead, if the implementation adds approval and actions.
8. **`run.start` takes `keep: true`**: the hub passes `StartSpec.keep` to the host. No caller of `run.start` can ask
   for it at the base.
9. **`DEEP_HUB_PLANT=kept-in-service-cgroup`**: a hub that starts kept runs and terminals without a scope of their own,
   so they stay in the service's cgroup. `plant.ts` must list it, or the hub refuses to start and the test fails BLOCKED.

## Readings where the issue and design leave a choice

### The polkit boundary

The issue stubs the prompt "at that boundary". `DEEP_HUB_TEST_CONFIRM`, #24's seam, stands above the platform's code:
`Confirmer.you` returns from it before the `process.platform` check, so a hub with no polkit at all would pass every test
that used it. These tests never set it. `DEEP_HUB_TEST_POLKIT` replaces only the program that talks to polkit, so the
hub's Linux path runs, and the hub's decision reads the stub's exit as it would pkcheck's. The stub's cancelled is
pkcheck's 3, dismissed.

A stub can't show that the real polkitd accepts what the hub sends, so one AC7 test runs with no stub: real `pkcheck`,
real polkitd, the hub's real action. A rule in `/etc/polkit-1/rules.d` answers in place of the prompt, `NO` then `YES`,
and a control read proves the rule live first. No test types a real login password: that the prompt is yours and asks
for your login password (`auth_self` or similar in the action file) stays a check by hand.

### Both distributions (AC1, AC4)

One run sees one distribution. `distribution()` accepts Ubuntu LTS and Fedora and fails BLOCKED on anything else, and
each assertion names the one it ran on, but **a criterion that says "both" is proven only by a pass in each VM.** Keep
both outputs. A pass in one VM is half a criterion, and the proof must say so.

### AC1: "the R1 end-to-end suite"

No file or lane has that name. The reading: for Claude Code, the release preflight's live lanes that start real
sessions (`spine checkpoint`, `setup checkpoint`, `done gate checkpoint`, `risky calls checkpoint`, `spine exit`,
`claude code adapter live`), read from `scripts/lanes.mjs` so they stay current. For Codex no such lanes exist, so the
reading is #48's live tests whose names say Codex; that is thinner than Claude Code's and nothing here widens it. Each
must report tests run, none failed, none skipped. Some of those suites were written on macOS and may need their own
redrafts for Linux; that is for the live run to show.

### AC2 and AC7

- **"Refused"**: exit 3, naming the session and the ask, with polkit confirming throughout, so only the peer check can
  refuse it. The same answer typed by you then counts: at the base that half fails, since no polkit path exists.
- **"Double-forked so PID 1 adopted it"**: at most the script and its subshell above the command, then PID 1. A subreaper
  in between fails BLOCKED, so run from a login shell, not inside a user unit. A chain that still holds the agent fails BLOCKED.
- **`systemd-run --user`**: the agent's Bash tool starts it; the command's cgroup must be that transient unit.

### AC3

"A secret round trip" (Proof): in through a real terminal, read out by `secret-tool`, a reader DeepBuild doesn't own, and
back through the hub, which stops holding it once `secret-tool` clears the item, so a private copy fails. "Never in a
file or a log" is searched in every form the Privacy scrub knows (raw, base64, base64url, hex, URL-encoded) across every
file in the test's world, what the terminal showed, the service's journal and the hub's `/proc` command line and
environment. The keyring's own files are outside that world, on purpose: gnome-keyring may store a collection with an
empty password as plain text, and that is the store, not a leak. Files a process wrote and removed before the search
aren't seen. The polkit step comes from Scope and Decided: a new secret counts only after polkit confirms you.

### AC4

`noNetworkFilter` is built in the test from the public entry: bubblewrap's own launch with the helper taken out. The
network filter lives only in that helper's seccomp, so removing it removes the filter; Landlock goes with it, since the
same process puts it on. So other cases fail too, and the test asserts the one the issue names: `egress` fails, its
detail showing the ungranted connection `allowed`, not `never tried`. A narrower twin would need a new helper flag; this
one needs nothing outside this folder.

### AC5

tmpfs at `/dev/shm` is the no-copy-on-write file system: both distributions have it, unprivileged, while `/tmp` and `/`
differ (Fedora's root may be btrfs, which clones). HOME, the hub's root and the worktree all sit there, so a clone can't
fail by crossing devices. A control reads `cp --reflink=always` failing first. The ext4 path a real Ubuntu user is on
isn't run separately. The ask isn't answered. A hub late under load leaves deep-hook deciding alone; that try is taken
again, and after five the test is INCONCLUSIVE.

### AC6

The criterion names both "the reference Mac" and "the Linux reference machine", and no Linux machine is named anywhere.
The test fails BLOCKED on every program, so it never reads PASS, listing the budget tasks read as "hook, hub and CLI":
`hook-startup`, `deep-hook-overhead`, `deep-hook-fail-open`, `deep-hook-guards`, `hub-cold-start`, `hub-round-trip`,
`hub-idle`, `deep-inbox-30d`, `deep-status-30`, `deep-doctor`. When the owner names a machine, a blind redraft writes
the measurement. Until then a PR for this issue says `Part of #70`, not `Closes #70` (AGENTS.md, Proof).

### AC8

- **"User scope of its own"**: every process the record tracks for the terminal and the run has a cgroup ending in
  `.scope`, not under the service, and the two programs' scopes differ.
- **"The hub reattaches"**, a terminal: the new hub's `terminal.tab` shows output written since the restart, it isn't
  ended or read-only, and `terminal.input` reaches the program, which only the holder of the hub's lock can do.
- **"The hub reattaches"**, a kept run: the new hub records `process.tracked` for a child the run starts after the
  restart, and the run was started exactly once.
- **The kept run writes to stdout all the time**, as a run does. A kept run whose stdout pipe died with the old hub dies
  of SIGPIPE at its next line and fails here. Choosing where its output goes is the implementer's.

## How each test fails on a wrong program

| Test | Wrong program | Seen |
|---|---|---|
| AC2 | `answer-inside-session` (merged plant) | fails naming the ask, `run inside agent session …` |
| AC7, each origin | `answer-on-peer-check` (merged plant), the issue's "CLI that counts it because the peer check found no agent" | fails naming the ask, `… the polkit prompt cancelled` |
| AC7, confirmed half | the base: no polkit path | `the hub can't ask linux to confirm you yet`, so a confirmed answer never counts |
| AC7, real polkitd | a hub that calls polkit with an unregistered action or a wrong subject, invisible to the stub | the `YES` half never counts |
| AC3 | the base: `noSecrets`, and no `deep secret` | fails at `deep secret add`; a store that isn't the Secret Service fails `secret-tool`, a kept copy fails the clear, and a control proves the file search finds a planted copy |
| AC4, egress | `plantedBackends(fx).egress` (merged) | fails exactly the `egress` case |
| AC4, no filter | the test's `noNetworkFilter` | `egress` fails, its detail `(not granted): allowed` |
| AC5 | `stages-without-copy` (merged plant); also what a fallback to a plain copy would do | `` `rm -rf build/*` was let through with no ask `` |
| AC8 | `kept-in-service-cgroup` (assumed plant); the base is the same program, with no scope | fails naming `terminal term:…`, both that its program died at the restart and that it stayed in the service's cgroup |
| AC1, AC6 | none reachable yet | BLOCKED; AC6 can't pass on any program |

At the base, on both distributions (`BASE-FAILURE.txt`): AC4 and AC5 pass, their wrong programs failing as they should, since
the backend and "can't clone off macOS" are merged; once a Linux clone exists, AC5 is what guards this. AC2's main test
and all of AC3, AC7 and AC8 fail for the missing behaviour, and AC7's two wrong programs pass as tests. AC2's and AC8's
wrong-program tests fail at the base without showing their wrong program: AC2's plant can't count an answer with no polkit
path, and AC8's plant doesn't exist. `BASE-FAILURE.txt` says how the steps a base can't reach were read on throwaway twins.

## Not covered by these tests

Scope lines with no criterion of their own: the socket's mode 0600, packaging for x86_64 and arm64, desktop notifications
and the tray count, and "every platform interface passes the same conformance tests as on macOS" beyond the sandbox's
suite. Staging on btrfs or XFS (the Platforms list): no criterion names it, and `deep-hook clone` has no Linux path at the
base. A real password at a real polkit prompt, by hand as above.

## Files

- `helpers.ts`: what the machine must have, homes, the real service, the line protocol, the polkit stub and rule, the
  Claude Code stand-in, a command that left the agent's tree, the seeded ask.
- `answers.test.ts` (AC2, AC7), `secret.test.ts` (AC3), `sandbox.test.ts` (AC4), `staging.test.ts` (AC5),
  `budgets.test.ts` (AC6), `restart.test.ts` (AC8), `e2e.live.test.ts` (AC1).
- `fixtures/claude.mjs`: the Claude Code stand-in, from #19's suite. `fixtures/stub-bin.sh`: a `claude` for `deep setup`
  to find. `fixtures/vault/`: a package that names one secret. `fixtures/tty.py`: a real terminal for AC3.
- `BASE-FAILURE.txt`: the run at the base in each VM, a table by criterion and distribution, then each full output.
