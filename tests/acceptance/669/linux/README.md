# #669's live checkpoint on Linux

Written blind for the dispute on #70's AC1 ("The R1 end-to-end suite passes on Ubuntu LTS and Fedora with Claude Code
and Codex"), by the same job as `../../668/linux/`, from the same reading: issues #668, #669 and #70 as of November 8,
2026; `docs/technical-design.md` (How it installs, the trusted path, Decided, An agent says it's done, How runs become
one of five verdicts); AGENTS.md; base `origin/main` at `cbabecbf` (`tests/acceptance/669/` whole, `tests/acceptance/
668/`, `packages/hub/src/{service,setup,confirm,plant}.ts`, `packages/supervisor/src/{bubblewrap,supervisor}.ts`,
`scripts/agent-harness.mjs`, `scripts/lanes.mjs`, `scripts/proof-runs.mjs`).

On Linux the macOS suite's `systemctl` stand-in keeps any hub from starting. These tests read #669's six criteria with
the macOS suite's checks through Linux's platform interfaces instead: the hub as a systemd user service, its check
runs in bubblewrap, the Secret Service on the session bus and polkit's stand-in at the hub's confirmation seam. The
implementing agent doesn't edit these files (AGENTS.md, Proof).

## How to run

On Linux only, with Node 24.22 first on `PATH`, the Rust toolchain, and the platform `../../668/linux/README.md` lists:

```sh
npm ci && npm run build --workspaces    # the CLI, and the supervisor's sandbox helper; checkout-web's Vitest is cloned from this install
cargo build --locked -q -p deep-hook
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> node node_modules/vitest/vitest.mjs run --root tests/acceptance/669/linux session.live.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/669/linux/tsconfig.json
```

- On any other platform every test fails `BLOCKED: <ID> … this machine is <platform>`; without the opt-in, the token, a
  `claude` on `PATH` or a piece of the Linux platform, `BLOCKED:` naming it. Nothing skips; each state is the first word
  of its message.
- `--root tests/acceptance/669 session.live.test.ts` (the macOS lane's filter) matches this file too; run it with
  `--root tests/acceptance/669/linux` or `linux/session.live.test.ts`, and keep the macOS lane to its file with
  `--exclude 'linux/**'`.
- Vitest's cache goes to `tests/acceptance/669/linux/node_modules/.vite/`; delete it before committing.
- Folders are `/tmp/dh669-*`, `HOME=<tmp>/h`; the proof goes to `$TMPDIR/deep-669-proof/linux-live/`: the macOS live
  world's `terminal.txt`, `chat.json`, `record.json`, and per side world `<variant>-{chat,record}.json`,
  `<variant>-terminal.txt`, `<variant>-transcript.jsonl`; plus `systemd.txt`, `side-systemd.txt`, `sandbox.json`,
  `<variant>-sandbox.json` and `machine.txt` with the distribution and kernel.

## Two worlds, on the Linux platform

Both use `../helpers.ts` as it is: its home (`makeHome`), `checkout` and its variants, `Drive`, the record readings
and every criterion's check; and `../../668/linux/platform.ts` for the platform (the test's own user manager in a
delegated scope, its `dbus.socket` session bus, gnome-keyring as the Secret Service, polkit's stand-in at
`DEEP_HUB_TEST_CONFIRM`). Each home loses the launchd, `systemctl` and Keychain stand-ins; its test seams
(`DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS`, and in the side world `DEEP_HUB_TEST_MANAGED_SETTINGS`) go into the
user manager's environment, so the hub's unit gets them as a login's units do.

| World | Session | Criteria |
|---|---|---|
| live | the harness's `fix-coupon-test`, a real Claude Code session, as the macOS live file runs it (bash as its `SHELL`) | AC1, AC2, AC4, AC5 |
| side | a second home and hub: `../helpers.ts`'s stand-in sessions on the zero-tests, masked and slow variants, as the macOS fast file's side world runs them | AC3, AC6 |

The macOS suite reads AC3 and AC6 only in its fast file; on Linux the dispute's lane runs this file alone, so it
reads them here, on the side world, with the same checks (`cutAndZeroProblems`, `maskedProblems`).

## Assumed surfaces

Everything `../../668/linux/README.md` lists, and:

- **The hub runs every claim check through the supervisor's Linux backend**, bubblewrap (`supervisor.ts` picks it on
  Linux; `core.ts` runs each claim check "in the platform sandbox"), so a check's processes have a `bwrap` process
  above them.
- **Every process the hub starts stays under the test's user manager in the process tree**: the manager is their
  subreaper, so a run moved to a scope of its own (#70's Scope) is still found under it.
- The approved check `npm test` runs Vitest, whose command line names `vitest`.
- `/bin/cp` (`../helpers.ts` clones Vitest into each checkout with `cp -cRH`, falling back to `cp -RH`).

## Readings on Linux

The macOS README's readings hold as written; these are added or changed.

1. **Setup** (#668's checkpoint, which #669 depends on): `deep setup` exits 0 and the hub runs as the systemd user
   service `deepbuild-hub.service` (`../../668/linux/README.md`, Reading 1); otherwise every test of that world is
   `BLOCKED`, as the macOS `setUp` reads a setup that fails.
2. **"A hub restart"** (AC3): SIGTERM to the hub unit's `MainPID`, by PID, as a logout or an update stops it, once a run
   of the slow claim's check has started (and 2 s more, so its processes are seen); then its login service starts it
   again, `systemctl --user start deepbuild-hub.service` (a no-op when `Restart=` already did).
3. **"The check runs"**, on Linux, runs in bubblewrap: a watch reads, every 100 ms, the processes under the test's user
   manager whose command line names `vitest`, and whether a `bwrap` process sits above each. A check process seen
   outside bubblewrap makes its world `INVALID` (thrown: its verdict isn't evidence of the Linux path): the live world
   for AC1, AC2, AC4 and AC5; the zero-tests and slow runs for AC3; the masked run for AC6. AC3 also needs the slow
   check, which runs 20 s, seen inside bubblewrap at least once, or it is `INCONCLUSIVE`. The live world's check runs
   for a second or two, so there a check never seen reads nothing either way; the side world's slow check is the
   positive sighting.

## Criteria to tests

Same IDs as `../session.live.test.ts` and `../fast.test.ts`; every test name starts with `AC<n> <ID>`.

| ID | Test (`session.live.test.ts`) | World | Check (`../helpers.ts` or the macOS live file's) |
|---|---|---|---|
| AC1 `#669.2302adfc` | `AC1 … (live, Linux) … held while its check runs in bubblewrap …` | live | the macOS live AC1 check; Reading 3 |
| AC2 `#669.b95b4d96` | `AC2 … (live, Linux) … reads PASS with 3 tests …` | live | the macOS live AC2 check; Reading 3 |
| AC3 `#669.db713958` | `AC3 … (Linux) … all skipped reads INVALID … hub restart (SIGTERM to the hub unit's MainPID, then systemctl --user start) reads INCONCLUSIVE, both run in bubblewrap …` | side | `cutAndZeroProblems`; Readings 2, 3 |
| AC4 `#669.059078dc` | `AC4 … (live, Linux) every verdict … names its claim's commit …` | live | the macOS live AC4 check; Reading 3 |
| AC5 `#669.b5400502` | `AC5 … (live, Linux) "all done?" …` | live | the macOS live AC5 check; Reading 3 |
| AC6 `#669.f2c64a9c` | `AC6 … (Linux) the check \`npm test\` … \`|| true\`, run in bubblewrap, is never PASS …` | side | `maskedProblems`; Reading 3 |

### Wrong programs

`scripts/proof-runs.mjs` reads `tests/acceptance/669/twins.json` for any test under `tests/acceptance/669/`, so these
tests' tags take the macOS suite's twins, all in `plant.ts` at the base: AC1 and AC4 `line-pass-without-verdict`,
AC5 `status-from-model`, AC6 `runner-passes-masked-exit` (on the masked check this file reads). The macOS live file
has no planted case of its own, and neither does this one.

## What the lanes need (this job edits nothing outside this folder)

1. `scripts/lanes.mjs` `done gate checkpoint`: its filter also picks this file (checked with `vitest list`); add
   `--exclude 'linux/**'`, or choose the folder by platform, and run this file on Linux with `--root
   tests/acceptance/669/linux session.live.test.ts`.
2. `byHand` must list `tests/acceptance/669/linux/session.live.test.ts`, or the unit lane runs it and it fails
   `BLOCKED` there.

## Files

- `helpers.ts`: the home without the macOS stand-ins, setup with the unit read, the harness run with bash, and the side
  world with the Linux restart and the bubblewrap watch (`../helpers.ts`'s `sideRun` isn't exported, so its steps are
  repeated here with the restart swapped).
- `session.live.test.ts`, `tsconfig.json`. The platform is `../../668/linux/platform.ts`.
