# #1156 on Linux: a real Claude Code session's risky calls stopped before they run

The Linux twin of `../session.live.test.ts`, written blind for #70's AC1 ("The R1 end-to-end suite passes on Ubuntu LTS
and Fedora with Claude Code and Codex"). That suite throws BLOCKED off macOS, since it builds and code-signs macOS's
`deep-confirm` and stands in for launchd. This one proves the same checkpoint through the Linux interfaces #70's Scope
names: the hub as a systemd user service, bubblewrap as the sandbox, and the CLI as the trusted path once polkit
confirms you.

It read only: issues #1156 and #70 (`gh issue view`), `docs/technical-design.md` (How it installs, Platforms, Decided:
Answers from the terminal, Linux, Hub lifecycle; Staging), AGENTS.md, and the code at origin/main (`65c2b6e3`):
`tests/acceptance/1156/`, `packages/hub/src/{service,confirm,setup,keychain,plant,staging}.ts`, the trusted path in
`packages/hub/src/core.ts`, `packages/supervisor/src/bubblewrap.ts`, `scripts/{agent-harness,lanes}.mjs`.

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft.

## How to run

On Linux, with Node 24.22 first on `PATH`, the Rust toolchain and the tools below:

```sh
npm ci && npm run build --workspaces
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/1156/linux session.live.test.ts   # spends plan usage
node node_modules/typescript/bin/tsc -p tests/acceptance/1156/linux/tsconfig.json
```

Every test fails with an error starting `BLOCKED:` naming what is missing, and nothing skips, when: the machine isn't
Linux; `DEEP_HARNESS_LIVE=1` or `CLAUDE_CODE_OAUTH_TOKEN` is unset; `claude` isn't on `PATH`; any of `systemctl`,
`systemd-run`, `/usr/lib/systemd/systemd`, `dbus-daemon`, `gdbus`, `python3` with python-dbusmock, `bwrap`, `script`,
`lsof`, `curl`, `openssl`, `cargo`, `git` is missing; or `/var/tmp` can't make a copy-on-write copy (`cp
--reflink=always`). Staging needs btrfs, or XFS with reflink (design, Staging): Fedora's `/var/tmp` is btrfs by default,
Ubuntu LTS's is ext4, so the Ubuntu reference machine needs `/var/tmp` on one of those.

Everything lives under `/var/tmp/dh1156-*`, with `HOME`, `TMPDIR` and `XDG_RUNTIME_DIR` there for every process the
test starts. Your `~/.deepbuild`, `~/.claude`, login keyring, session and system buses and systemd user manager are
never used: each is the test's own (below). Processes are stopped by PID only. The proof lands in
`/tmp/deep-1156-linux-proof/`: `../README.md`'s files, plus `polkit.log` and `answers.json`.

## What is the same

The world (checkout-web with a local bare remote, `out/` of 200 files, the README's mirror URL, the trusted
`vendor-guard` extension, the sample API, the 1,000,000-event padding), the script (`SESSION.md`, the harness's
`risky-calls` scenario, the made-up session for the hub-stopped pushes), and every reading of AC1, AC2, AC3, AC5, AC6
and AC7 are `../helpers.ts`'s, imported. The test IDs are the ones `scripts/proof-change.mjs` computes, from
`../helpers.ts`. Where `../helpers.ts` keeps a part of the world to itself (the API, the repo, `fixtures/core.mjs`),
`helpers.ts` here carries a copy.

## What differs on Linux

1. **The hub is setup's systemd user service.** `deep setup` writes `deepbuild-hub.service` under the test's
   `$XDG_CONFIG_HOME/systemd/user` and runs `systemctl --user enable --now` (`service.ts`). The session's hub is that
   service: stopped and started with `systemctl --user` around the seeding and padding, and restarted after the session
   so its pass at start archives the transcript. "Stopped by PID" is the service's `MainPID`, stopped by that PID; if
   the service brings the hub back before both pushes are sent, the run is INCONCLUSIVE.
2. **Your answers count once polkit confirms you.** No test types a login password, as no macOS test shows Touch ID:
   polkit is stood in at its boundary (#70's AC6 says the same of its own test). The helper, its signature and launchd
   have no part here.
3. **AC4's readings.** The yes: `deep inbox answer <ask> approve` exits 0 once polkit confirms you, the hub asked polkit
   during it, the ask is answered once, the retried push runs once and origin's `main` is the session's commit. The
   macOS twins of a confirmation that isn't yours, the exit-0 helper and the replayed signature, read on Linux as: with
   polkit's prompt cancelled the answer is refused (exit 3, naming the ask) and the ask stays open; and after polkit
   confirmed you for the push, an answer to the README URL's ask with the prompt now cancelled is refused the same way,
   so no confirmation carries over to another ask. "Naming the path" doesn't carry over: nothing at a path confirms you
   on Linux, so both refusals must name the ask.
4. **Wrong programs.** This folder has no fast file, so the issue's wrong programs run here, after the session, on the
   same world, each checked against the same reading the real program passes: the pre-#1097 deep-hook (AC1), the
   copy-less stager (AC2), the all-`repo` matcher (AC3), the by-value environment (AC5) and the per-call trust reader
   (AC6), all `../helpers.ts`'s. For AC4 the exit-0 helper and `signature-covers-anything` have nothing to replace on
   Linux; the base's `answer-on-peer-check` plant, the CLI #70's AC6 names that counts an answer because the peer check
   found no agent above it, must fail the refusal reading, naming the ask. Like `../helpers.ts`'s, each wrong program
   runs on a hub started with `deep hub run` and its plant, with the service stopped.

## Assumed surfaces

The design names none of these for a test; each is the smallest that keeps the run off your own machine's state.

- **The test's own systemd user manager.** Setup enables its unit by name from the test's `$XDG_CONFIG_HOME`, which
  your user manager never reads, and the test mustn't touch yours. So the test starts one:
  `systemd-run --user --scope -p Delegate=yes -- env -i <the test's environment> /usr/lib/systemd/systemd --user
  --unit=dh1156.target`, `dh1156.target` an empty unit so nothing of yours starts, and `systemctl --user` reaches it
  through the test's `XDG_RUNTIME_DIR/systemd/private`. The rest of the test's environment (`NODE_EXTRA_CA_CERTS` for
  the sample API, `DEEP_HUB_TEST_SORTER`, the bus addresses) reaches the hub through `systemctl --user
  set-environment`, since the unit names only `PATH` and `HOME`. This needs a delegated cgroup from your manager; not
  run on a Linux machine in this draft.
- **polkit on a bus of the test's.** A `dbus-daemon` on `/var/tmp/dh1156-*/bus`, named in both
  `DBUS_SYSTEM_BUS_ADDRESS` and `DBUS_SESSION_BUS_ADDRESS`, with python-dbusmock's `polkitd` template on it as
  `org.freedesktop.PolicyKit1`. Confirmed is `AllowUnknown(true)`; cancelled is `AllowUnknown(false)` with
  `SetAllowed([])`, which polkit reads as not authorized; its `--logfile` counts `CheckAuthorization` calls. This assumes
  the hub asks polkit's Authority on the system bus, as `pkcheck` and a direct D-Bus call both do; a hub that asks some
  other way reaches no stand-in and its yes fails. The template's method names weren't checked against an installed
  python-dbusmock.
- **No Secret Service.** The session bus has nothing on it, so your keyring is never reached. #1156 stores no secret:
  its credential comes from a dotfile, as on macOS. The Secret Service round trip is #70's AC3, not this suite's.

## Not covered

- Codex: #1156 is a Claude Code checkpoint. #70's AC1 also names Codex, which this suite doesn't run.
- Which distribution: the suite proves one machine per run; #70's AC1 wants a run on Ubuntu LTS and one on Fedora.
- The lane: `scripts/lanes.mjs`'s `risky calls checkpoint` runs `vitest run --root tests/acceptance/1156
  session.live.test.ts`, a filter that also matches `linux/session.live.test.ts`, which then fails BLOCKED on the Mac.
  That lane needs a narrower filter (such as `1156/session.live.test.ts`), and a Linux lane would run this folder; both
  are the implementer's, since this job edits no lane.
