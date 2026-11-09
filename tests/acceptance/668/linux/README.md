# #668's live checkpoint on Linux

Written blind for the dispute on #70's AC1 ("The R1 end-to-end suite passes on Ubuntu LTS and Fedora with Claude Code
and Codex"), by a job that never saw a Linux implementation of #70. It read:

- issues #668 (six criteria), #669 and #70 as of November 8, 2026;
- `docs/technical-design.md`: How it installs (Platforms), Socket roles and the trusted path, Decided (Answers from the
  terminal, Hub lifecycle, Grants and the sandbox, Linux), Dogfooding; AGENTS.md;
- base `origin/main` at `cbabecbf`: `tests/acceptance/668/` (README, helpers, live and fast files, twins),
  `tests/acceptance/669/`, `packages/hub/src/{service,setup,confirm,keychain,doctor,plant}.ts`, the parts of
  `packages/hub/src/core.ts` that confirm a command and report the secret store, `packages/supervisor/src/
  {bubblewrap,supervisor}.ts`, `scripts/agent-harness.mjs` (its pseudo-terminal on Linux), `scripts/lanes.mjs` and
  `scripts/proof-runs.mjs`.

The macOS suite's `launchctl` stand-in and a `systemctl` that only logs mean no hub ever starts on Linux, where
`deep setup` installs the hub as a systemd user service. These tests read the same six criteria with the same checks
through Linux's own platform interfaces instead. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## How to run

On Linux only, with Node 24.22 first on `PATH`, the Rust toolchain, and the platform below:

```sh
npm ci && npm run build --workspaces    # the CLI, and the supervisor's sandbox helper packages/supervisor/dist/helper
cargo build --locked -q -p deep-hook
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> node node_modules/vitest/vitest.mjs run --root tests/acceptance/668/linux session.live.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/668/linux/tsconfig.json
```

- On any other platform every test fails `BLOCKED: <ID> … this machine is <platform>`; without `DEEP_HARNESS_LIVE=1`,
  `CLAUDE_CODE_OAUTH_TOKEN`, a `claude` on `PATH`, or any piece listed under Assumed surfaces, `BLOCKED:` naming what is
  missing. Nothing skips. Every state is the first word of the message, as `scripts/lanes.mjs` reads it; a sibling
  helper's "`<ID> BLOCKED: …`" is restated that way (`platform.ts`, `restated`).
- `--root tests/acceptance/668 session.live.test.ts` (the macOS lane's filter) matches this file too: Vitest's filter
  is a substring of the path. Run this file with `--root tests/acceptance/668/linux`, as above, or with `--root
  tests/acceptance/668 linux/session.live.test.ts`; keep the macOS lane to its file with `--exclude 'linux/**'`.
- With `--root` here, Vitest writes its cache to `tests/acceptance/668/linux/node_modules/.vite/`; delete it before
  committing.
- The home, folders, fixture repo, record readings and checks are the macOS suite's (`../helpers.ts`, imported, not
  copied): `/tmp/dh668-*`, `HOME=<tmp>/h`, nothing of the person's `~/.deepbuild`, `~/.claude` or `~/.config` touched.
  The proof goes to `$TMPDIR/deep-668-proof/linux-live/`, with `systemd.txt` (the unit, its state and MainPID),
  `hub-health.json`, `polkit-asks.log` and a `machine.txt` naming the distribution and kernel beside the macOS files.

## The Linux platform (`platform.ts`)

`deep setup` runs the real `systemctl` against a user manager the test starts for itself, so it never installs,
starts or stops anything in the person's own:

1. `systemd-run --user --scope -p Delegate=yes -- env -i <the login's variables> /usr/lib/systemd/systemd --user
   --unit=dh-login.target`: a user manager in a transient scope of the runner's (the only call that reaches the
   person's manager), its cgroup delegated, `XDG_RUNTIME_DIR=<tmp>/run` (mode 0700), `HOME` and `XDG_CONFIG_HOME` the
   test's home. `dh-login.target`, written to `<tmp>/run/systemd/user/`, wants only `dbus.socket`, so the
   distribution's own user units never start.
2. The session bus that manager's `dbus.socket` gives at `<tmp>/run/bus`; every process the test starts gets
   `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS` and `XDG_DATA_HOME` of this login (`h.env`), so `systemctl --user`
   in `deep setup` and `deep setup --undo` reaches this manager over `<tmp>/run/systemd/private`.
3. The Secret Service: `gnome-keyring-daemon --foreground --components=secrets --unlock` on that bus, its keyring in
   the test's home, unlocked with a random password made for the run and never written down; the run waits for
   `org.freedesktop.secrets` to have an owner.
4. polkit's password prompt, stood in for at the hub's confirmation seam `DEEP_HUB_TEST_CONFIRM` in its executable
   form (`packages/hub/src/confirm.ts`: run once per ask with its words; exit 0 is you confirming): it confirms and
   logs each ask's words, so a test reads which commands polkit was asked about.
5. The macOS stand-ins taken out of `../helpers.ts`'s home: no `launchctl`, no `systemctl` stand-in, no Keychain
   stand-in (`DEEP_HUB_TEST_KEYCHAIN`). Claude Code's own sign-in file on Linux, `~/.claude/.credentials.json`, holds a
   lifetime that outlives any run and no secret, where the doctor reads the token's lifetime (`doctor.ts` reads it
   where there is no Keychain).

The hub is stopped (AC4's removal) by SIGTERM to the unit's `MainPID`, by PID. Teardown sends the manager SIGTERM
(a user manager then starts `exit.target`, stopping the hub's unit), stops the keyring by PID, SIGKILLs by PID anything
left in the manager's scope cgroup, and waits for all of it to exit. Then, as the same user and without sudo, it makes
every folder under the temp folder enterable and writable (the manager leaves systemd's `inaccessible` nodes in
`<tmp>/run/systemd/` with mode 000) and removes `<tmp>/run`; the suite's own cleanup then removes the rest, and runs
even when the teardown fails. A teardown that can't stop a process or remove the folder fails the file, naming it.

## Assumed surfaces

Each missing one fails `BLOCKED`, naming it, before anything runs.

- Linux with the unified cgroup hierarchy (cgroup v2), a user manager of the runner's own (`$XDG_RUNTIME_DIR/systemd/
  private`; log in, or `loginctl enable-linger`), `systemd-run`, `systemctl`, `busctl`, and the systemd binary at
  `/usr/lib/systemd/systemd` or `/lib/systemd/systemd` that runs as a second user manager in a delegated scope, with
  `$XDG_RUNTIME_DIR/systemd/user` on its unit search path.
- The distribution's `dbus.socket` user unit (dbus-user-session on Ubuntu, dbus-broker on Fedora), listening at
  `$XDG_RUNTIME_DIR/bus`.
- `gnome-keyring-daemon` (package gnome-keyring) as the Secret Service provider, taking `--unlock` from stdin.
- bubblewrap at `/usr/bin/bwrap`, the supervisor's helper at `packages/supervisor/dist/helper`, and Landlock ABI 4
  (Linux 6.7 or later; Ubuntu 24.04 LTS's 6.8 has it, 22.04's 5.15 does not), as the bubblewrap backend needs
  (`packages/supervisor/src/bubblewrap.ts`). This suite starts no check run; #669's Linux twin reads the sandbox.
- util-linux `script` (the harness's pseudo-terminal on Linux) and `/bin/bash`, the session's `SHELL` (the macOS
  helper sets `/bin/zsh`, which Linux lacks by default).
- **DeepBuild's Linux login service** (`packages/hub/src/service.ts` at the base): the unit `deepbuild-hub.service` in
  `$XDG_CONFIG_HOME/systemd/user/`, `systemctl --user daemon-reload` and `enable --now`; undo `disable --now`.
- **The hub gets the test seams from its user manager's environment** (`DEEP_HUB_TEST_CONFIRM`), as a login's units get
  the manager's; on macOS the launchd stand-in hands setup's environment to the hub. The unit itself sets only `PATH`
  and `HOME`.
- **polkit stays behind `DEEP_HUB_TEST_CONFIRM`** on Linux: the seam is read before any platform branch at the base,
  and #70's AC6 stubs the polkit prompt "at that boundary".
- **`hub.health` reports `secrets: "reachable"`** when the hub reaches the secret store (`core.ts` at the base reads
  the session bus on Linux).
- **Claude Code on Linux** signs in with `CLAUDE_CODE_OAUTH_TOKEN` ahead of a stored sign-in, and keeps its stored one
  in `~/.claude/.credentials.json`.

## Readings on Linux

The macOS README's readings hold as written; these are added or changed.

1. **"After `deep setup`"** (the checkpoint's first step, before every criterion): setup exits 0 and the hub runs as
   the systemd user service: the unit file in the home's `$XDG_CONFIG_HOME/systemd/user/`, `is-enabled` `enabled`,
   `is-active` `active`, its `MainPID` alive in the unit's own cgroup under the test's manager, and a hub answering at
   `~/.deepbuild/hub.sock`. Otherwise every test fails naming AC1 (`#668.f5be25d4 … deep setup …`), as the macOS
   checkpoint fails a setup that doesn't exit 0.
2. **AC4, "every item OK"**: also, the hub its unit started reaches the secret store: `hub.health` reads `secrets:
   "reachable"` (the Secret Service on the session bus). The doctor has no secret-store item at the base, so this is
   read off the hub.
3. **AC4, the removal "by hand"** happens with the hub stopped by SIGTERM to its unit's `MainPID`; a hub systemd starts
   again on its own within the wait is `BLOCKED`, as on macOS.
4. **AC5, "`deep off` … `deep on`"**, and **AC6, "`deep setup --undo`"**: each is run by you with the OS confirming you,
   which on Linux is polkit with your login password, never the peer check alone (#70's Scope): the hub must have
   shown polkit's stand-in an ask whose words start with that command.

## Criteria to tests

Same IDs and checks as `../session.live.test.ts`; every test name starts with `AC<n> <ID>` and every check message
with its ID.

| ID | Test (`session.live.test.ts`) | Linux additions |
|---|---|---|
| AC1 `#668.f5be25d4` | `AC1 … (live, Linux) with the hub set up as a systemd user service, …` | Reading 1 (thrown for every test) |
| AC2 `#668.c478c854` | `AC2 … (live, Linux) deep status lists …`; `AC2 … (live, Linux, planted status) …` | none |
| AC3 `#668.96a6fd85` | `AC3 … (live, Linux) the real session's failing first test run …` | none |
| AC4 `#668.3ee80c65` | `AC4 … (live, Linux) … reaching the Secret Service; … stopped by its unit's MainPID …` | Readings 2, 3 |
| AC5 `#668.e1e1081d` | `AC5 … (live, Linux) … deep off, once polkit confirms you, …` | Reading 4 |
| AC6 `#668.882ded0d` | `AC6 … (live, Linux) … deep setup --undo, once polkit confirms you, …` | Reading 4 |

### Wrong programs

- **In the file**: the planted status (`DEEP_HUB_PLANT=status-omits-commit`, in `plant.ts` at the base) must fail the
  AC2 check naming the criterion and the commit, as on macOS.
- **Twins**: `scripts/proof-runs.mjs` reads `tests/acceptance/668/twins.json` for any test under
  `tests/acceptance/668/`, so these tests' tags take the same twins: AC1 `setup-writes-project-settings`, AC2
  `status-omits-commit`, AC4 `doctor-misses-hooks`, AC5 `on-stays-off`, AC6 `undo-reserializes`, all in `plant.ts` at
  the base.
- Not run: `acts-on-peer-check` (in `plant.ts` at the base, not in `twins.json`) answers a command on the peer check
  alone; it would ask polkit nothing, so Reading 4 should fail on it. Unverified.

## What the lanes need (this job edits nothing outside this folder)

1. `scripts/lanes.mjs` `setup checkpoint`: its filter also picks this file (checked with `vitest list`); add
   `--exclude 'linux/**'`, or choose the folder by platform, and run this file on Linux with `--root
   tests/acceptance/668/linux session.live.test.ts`.
2. `byHand` must list `tests/acceptance/668/linux/session.live.test.ts`, or the unit lane runs it, and it fails
   `BLOCKED` there.

## Files

- `platform.ts`: the Linux platform, shared with #669's Linux twin (`../../669/linux/` imports it; nothing here
  imports from #669).
- `helpers.ts`: the home without the macOS stand-ins, the harness run with bash, the Linux checkpoint (the macOS
  `checkpoint` step for step, the hub stopped by `MainPID`, polkit's asks kept), and AC4's secret-store reading.
- `session.live.test.ts`, `tsconfig.json`.
