# Acceptance tests for #1945: host changes and root plans

Written first, blind, by a job that never saw an implementation of #1945; none exists at the base (`4004257c`). The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- Issue #1945 (`gh issue view 1945`): Scope, the four criteria, Proof. Its parent #71 for context only; #1942 (merged
  into the base) and #1943, #1944, #1946, #1947 are other parts, and nothing here tests them.
- `docs/technical-design.md`: Blocks for work on your other machines (`hosts`: Hosts, Grants per host, Root plan,
  Remote runs, Changes on a host, Still off-limits); Plans before acting (the plan, no drift after your yes); Tasks only
  you can do (`tasks`); Work outside a repo's State source (the change log for a host); Answers from the terminal (a
  root plan's sudo prompt); Protection; Dogfooding; the Building blocks table.
- The base, for surfaces and conventions only: `packages/hub/src/hosts.ts` (#1942's host link: `ssh -F` your
  `~/.ssh/config`, the `host.change` grant ask, runs as `deep-<token>` user units through `systemd-run --user`),
  `src/runs.ts` (`run.start` with `host`; its refusal of `sudo`: "Root on X is never a run's: it comes only as a root
  plan you approve"), `src/core.ts` (`host.list`, `host.facts`, `mcpCall`, the cli methods, `evidence.read`),
  `src/tools.ts` (the strict tool schemas), `src/plant.ts` (`DEEP_HUB_PLANT`, `activePlant()`), `src/inbox.ts` (how
  `deep inbox` shows a plan's steps), `src/channels.ts`, `src/confirm.ts`, `packages/cli/src/main.ts`,
  `packages/asks` (`PlanInput`, `PlanStep`, `CANT_UNDO`, `plan.proposed`), `packages/asks/sources.json` (the
  `host.root_plan` and `host.change` rows), `packages/evidence` (where the store keeps a file, what it packs),
  `packages/channels/chat`. The suites `1942` (the model for this one: its relay, harness link, agent fixture, README
  and BASE-FAILURE), `1922`, `1731`, `1580` and `65` (a channel and its provider stand-in), `34` (the OS stand-in).

## Criteria and files

Each `describe` title is the criterion's ID and its text: `#1945.` and the first 8 hex of SHA-256 of the checkbox text
after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s `criterionId`).

| AC | ID | File | Tests |
|---|---|---|---|
| AC1 | `#1945.5592231a` | `root-plan.test.ts` | `judgePassword`: a root plan run with the sudo password typed at `deep host run`'s prompt; the password, in ten forms, is in no event, no file of the hub's or the world's, no hub or `deep` output, no file written on the host since the test began nor its journal, nothing the agent was handed and nothing the chat channel sent, each place first holding a control value |
| AC2 | `#1945.a62d8bc1` | `root-plan.test.ts` | `judgeLocked`: after your yes, the script changed by one byte where the agent wrote it is refused by `deep host run` before anything runs as root, naming both hashes; put back, it runs as root from a copy only root can write, and the record holds the run with exit 0 and its output's SHA-256; the planted `deep` `root-plan-runs-agent-path` fails it for running the changed script |
| AC3 | `#1945.fcdd3d22` | `linger.test.ts` | `judgeLinger` on dh-ubuntu: lingering on as the first remote run starts (read from inside it), `host.changed` with its undo in the record and in `deep host changes`, and the run beating on through 60 s with no SSH session of your user there; `judgeRootLinger` on dh-ubuntu with a polkit rule: the change comes as a root plan that `deep host run` runs with your sudo password; the planted hub `host-skips-lingering` on dh-fedora fails `judgeLinger` for losing the run, naming the host |
| AC4 | `#1945.a75a14aa` | `package.test.ts` | `judgePackage`: before your yes, `deep inbox` shows a step of the plan installing the test package, naming it, that says what its install scripts did with undo "can't undo"; the planted hub `host-package-fully-undoable` fails it, naming the package |

## Run them

macOS, the repo's Node (24.22.0) first on `PATH`, with this Mac's Lima VMs `deep-ubuntu` and `deep-fedora` running:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                           # once
npm run build --workspaces                       # the tests run packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook    # the agent's session needs it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1945 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1945/tsconfig.json
```

- **One at a time:** every test starts its own hub and makes users on the VMs, and AC3's 60 s with no session means
  something only while the suite's own hub is the one holding that user's sessions, so the implementer adds
  `tests/acceptance/1945/` to `alone` in `scripts/lanes.mjs` (not done here: this job writes tests only). The
  supervisor's sandbox needs a shell that may start it (in Claude Code, the Bash tool with its sandbox off). With an
  implementation, expect about 20 minutes on a loaded Mac, most of it hub starts, the channel's install and AC3's window.
- **Needs:** `ps`, `ssh`, `ssh-keygen`, `/bin/bash` and `/usr/bin/script` (the pseudo-terminal), and the two VMs (`~/.lima/<vm>/ssh.config`
  is read for the way in), each with passwordless sudo for Lima's user; deep-ubuntu with `dpkg-deb`. A VM that can't be
  reached fails the test as BLOCKED; nothing skips for it.
- **Safety:** every local folder is under `/tmp/dh1945-*`, removed after its file. Every hub, `deep` command,
  `deep mcp` and deep-hook runs with `HOME` in its world's temp folder and without the caller's `DEEP_*`, `XDG_*`,
  `CLAUDE*`, `CODEX*`, billing keys or `NODE_OPTIONS` (`SSH_AUTH_SOCK` and `PATH` kept). The only network is
  127.0.0.1 and the VMs through their forwarded ports; no model is called and no `git` is run. Lima's control socket is
  never used and the VMs are never stopped; Lima's user's lingering, sudo rights, groups and password are never
  touched. On a VM the suite makes, and after its file removes: the user `dh1945<id>` (key login with a key it makes
  under `/tmp/dh1945-<id>/k/`, a random password, lingering off, no subordinate IDs, so `/etc/subuid` and
  `/etc/subgid` stay as they are; removed with its sessions, user manager and lingering, then `userdel -r`), its `/etc/sudoers.d/dh1945-<id>` (checked with `visudo -cf` before it's moved in),
  AC3's `/etc/polkit-1/rules.d/10-dh1945-<id>.rules`, the root-only folder `/var/lib/dh1945-<id>/`, the folder each
  root plan ran from (one made during the test with nothing older in it goes whole, else only the copy; empty parents
  made during the test after it), that user's journal file when it had none before, any test package a run installed
  (`dpkg --purge`), and for Lima's user (AC4) the folder `~/dh1945-<id>/`. The journal and the login records keep their
  lines, as any login leaves them. Every local process is one the suite started, stopped by its PID (a hub's own
  children still running once it has stopped among them, each matched by its PID and start time); on a VM, what
  still runs as the test's own user at the end is stopped through logind and systemd, then by PID. No password ever
  reaches an argument list or a file the suite writes: it goes to the host on an SSH session's stdin (`sudo -n sh -s`,
  `chpasswd` from `printf`), and to `deep` only at the sudo prompt; the suite writes down neither it nor the VM's user
  name or key paths (`redact`).
- **The proof** (the issue's Proof line) is written to `$TMPDIR/deep-1945-proof/`, rewritten each run: AC2's root plan
  you approved on deep-fedora (its ask, its plan with the locked hash, the refusal `deep host run` printed, where the
  copy ran from, the run's `run.started` and `run.finished` with its exit code and evidence); AC3's lingering host
  change with its undo, `deep host changes` and the run's 60 s; AC3's lingering root plan and its run; AC1's places and
  counts; AC4's plan as `deep inbox` showed it; each plant's failures.

## The worlds (`helpers.ts`)

One world per test, as #1942's: a temp home whose `~/.ssh/config` names one VM, `dh-ubuntu` or `dh-fedora`, with
Lima's host key alias and ciphers, at the Port of **a relay** this suite runs on 127.0.0.1, which forwards to the VM's
forwarded SSH port and can cut every connection and refuse new ones; **a real hub** (`deep hub run`) with that home and
`DEEP_HUB_TEST_CONFIRM` (the OS confirming you, stubbed); **the hub's socket as the cli role**; **`deep inbox answer`**;
**`deep` in a pseudo-terminal** (`/usr/bin/script -q /dev/null node …/main.js <args>`, which bash execs with its stdin
from `cat` through a process substitution, since `script` needs a real pipe there), which types the password once a
line ending in `password:` (any case) shows and never before; and **the harness's own link** to the same VM as Lima's
user (its own config and ControlPath under the world's folder, straight to Lima's forwarded port), which makes and
removes the throwaway user through `sudo -n sh -s` and reads the host.

**The user the config logs in as.** AC1 to AC3: a throwaway user `dh1945<id>` the harness makes on the VM, whose sudo
needs its password (`dh1945<id> ALL=(ALL:ALL) ALL`) and whose lingering is off; its home is made traversable and its
folder `~/dh1945-<id>/` readable, so the harness reads the runs' files without sudo. AC3's root-plan world adds a polkit
rule that makes `org.freedesktop.login1.set-self-linger` need an admin for that user alone. AC4: Lima's user, since
nothing there runs as root. **An agent's session** (AC1, AC2, AC4): `fixtures/agent.mjs` stands for Claude Code, its
children the real deep-hook (`SessionStart`, `UserPromptSubmit`) and its own `deep mcp`, spoken to as an MCP client,
everything it's handed kept for AC1. **A channel** (AC1): `deep install packages/channels/chat`, every kind of ask routed
to it in `channels.json`, its provider a stand-in on 127.0.0.1 that keeps every request.

## Readings where the issue leaves a choice

The issue and the design name: grants per host with root only as a plan; a root plan as one authority ask showing the
exact script and each step's undo, defaulting to no; run by `deep` in your own terminal from a copy in a folder only
root can write, its hash checked there against the plan you approved, its output and exit code kept as the run's
evidence; the sudo password typed only at that prompt and never held, relayed or recorded; lingering turned on
(`loginctl enable-linger`) before the first remote run as a host change with its undo, or as a root plan where the
host's policy needs root; and a package's install scripts listed as not undoable before your yes. Where they leave a
name or a shape open, this job picked the smallest surface the design and the base imply; each is listed so the
implementer builds to it.

1. **Your SSH config** is `~/.ssh/config` under the hub's `HOME` (and `deep`'s), as in #1942; `ssh` itself reads the
   passwd home's, so the hub and `deep` hand it the file (`ssh -F`). The world's config sets no `ControlMaster` and no
   `BatchMode`: how the hub shares connections, and that `deep host run` gets a terminal for sudo's prompt, are theirs.
2. **An agent proposes a root plan** with a new deep_* tool, **`deep_root_plan`**, served through `deep mcp` like the
   others and held to its strict schema: `{host: string, script: string, steps: [{does: string, changes: string[],
   undo: string | null, package: string | null}]}` (every field required, the last two nullable). `host` is a host
   your SSH config names; `script` the absolute path on that host of the script the agent wrote there (in the home of
   the user your config logs in as); each step what it does, what it changes, its undo (`null` for none, which the core
   marks "can't undo") and, for a step that installs a package, the package file's absolute path on the host. It
   answers at once (the suite's hub has `MCP_TOOL_TIMEOUT=30000`) with `{ask: "ask:<id>", …}`, the root plan's ask,
   open. The hub reads the script on the host when it's proposed. No agent proposes a host change as you in this suite:
   one comes from a remote run (#1942) or from the hub itself (lingering, reading 7).
3. **The root plan is an ask:** kind `authority` (the ask source `host.root_plan`), with an option whose decision is
   `allow` and a default option whose decision is `deny`; its plan, the core's `plan.proposed` for the ask, holds each
   step with its undo or "can't undo", and **locks the script**: it holds the script's SHA-256 (64 lower-case hex) or
   the script's exact text, so the plan's hash covers the script as it was when proposed.
4. **You approve it** with `deep inbox answer <ask> <its allow option>`, the OS's confirmation stubbed.
5. **You run it with `deep host run <ask>`** in your terminal. It asks nothing there but sudo's password (sudo's own
   prompt, a line ending in `password:` in any case); you type the password once, after the prompt shows. It reaches
   the host through your SSH config, copies the script from where the agent wrote it into a folder on the host only
   root can write, checks the copy's SHA-256 there against the plan's, and only when they match runs the copy as root.
   On a mismatch it exits non-zero before anything of the script runs as root and prints both hashes, the one the plan
   locked and the one it found, each whole or as at least its first 12 hex characters. **"A folder only root can
   write":** the copy and the folder holding it are owned by uid 0 and writable by no one else (no write bit for
   others, nor for a group other than gid 0); each folder above them is owned by uid 0 and writable by no one else
   unless it's sticky. **"Runs from a copy":** the script is run from that file (as `sh <copy>`, `<copy>` or with the
   copy on its stdin), so the script finds the copy's path in `$0` or on `/proc/$$/fd/0`.
6. **Its output and exit code as the run's evidence:** the record holds `run.started` naming the plan's ask (`ask:
   <handle>`) and the host (`host: <alias>`), and its `run.finished` (same `run`) with `exit`, the script's exit status
   as a number, `outcome` `passed` for exit 0, and `evidence` holding the SHA-256 of exactly the bytes the script wrote
   to its stdout (not a terminal's copy of them: no CR added, no prompt).
7. **Lingering as a recorded host change.** Before the first remote run on a host, the hub turns lingering on for your
   user there, as you where the host's polkit lets you, and records it: **`host.changed`** in the record, `host:
   <alias>`, its other fields naming `enable-linger`, and `undo`, a string naming `disable-linger`. **`deep host changes
   <host>`** (the CLI, as you) shows each host change recorded for the host with its undo: a line naming
   `enable-linger` with `disable-linger` on it or within the next three lines. "Before the run starts" is read from
   inside the run: its first line holds what `loginctl show-user` says of its own user's `Linger`, which must be `yes`.
8. **Where the host's policy needs root for it** (the test's polkit rule returns `AUTH_ADMIN` for
   `org.freedesktop.login1.set-self-linger` for that user alone, so `loginctl enable-linger` as you is refused), the
   first remote run brings a root plan: an ask as reading 3 names, naming the host, whose plan holds a step naming
   `enable-linger` with an undo naming `disable-linger`. Lingering stays off until you approve it and run it as reading
   5 says; then it's on. Whether the run waits for it isn't read. Should more than one ask naming the host have a plan
   naming `enable-linger` (a grant ask that also lists lingering, say), the root plan is the newest whose question
   names root (as the `host.root_plan` fixture's "Run this root plan on …?" does), else the newest; `deep host run` must
   show sudo's prompt for it.
9. **A package's install scripts.** For a step whose `package` names a package file on the host, the plan holds,
   before your yes, a step naming the package (its name or its file's name) and its install scripts (`install
   script`, `maintainer script`, `postinst`, `preinst` or `scriptlet`, any case) with no undo, so the core marks it
   "can't undo"; `deep inbox` shows it under the ask, as it shows every plan step (`N. <does>  changes …  undo: can't
   undo  cost $0.00`). The agent's own step for the package keeps the undo it gave (`dpkg --purge`): the test reads
   only that some step says the scripts' work can't be undone.
10. **"Every SSH session to the host has closed"** is read for your user, the one your SSH config logs in as: no
    session of that user whose service is `sshd` is left in `loginctl list-sessions` on the host. The relay cuts every
    connection to the host and refuses new ones; other users' sessions (the harness's link as Lima's user, other work on
    the shared VM) keep no user manager of yours.
11. **"The run keeps going":** for 60 s after the last session closed, with none opened, the run wrote a beat (its host
    time, each second) with no gap over 15 s and its last within 15 s of the end, its unit's cgroup (from its own
    `/proc/self/cgroup`) still holds a process, and `user@<uid>.service` is active. Without lingering, logind stops that
    user manager 10 s after the last session (`UserStopDelaySec`'s default on both VMs), and the run with it.
12. **Grants:** where the hub asks you something that names the host and offers an option whose `decision` is `allow`,
    the suite answers it once with `deep inbox answer` (recorded in the proof as `answered`), except a root plan the test
    answers itself (its ask or plan names the test's script: its path, nonce or SHA-256) and, in AC3's root-plan world,
    an ask whose question names root. A yes to a root plan runs nothing: only `deep host run` does.
13. **Plants**, each selected with `DEEP_HUB_PLANT=<name>` as `src/plant.ts` selects every other: on the hub for the two
    hub plants, and on the one `deep host run` command for the planted `deep` (the CLI reads it through
    `activePlant()`). At the base each hub plant is refused ("names no planted program"), and the planted `deep` has no
    `deep host` to plant into, so those tests fail there:

    | Plant | Where | Criterion | The wrong program | Read as failed when |
    |---|---|---|---|---|
    | `root-plan-runs-agent-path` | `deep host run` | AC2 | runs the script from where the agent wrote it, with no copy and no check | `judgeLocked` fails with "ran the changed script (variant D …)" |
    | `host-skips-lingering` | hub | AC3 | starts the first remote run without turning lingering on | `judgeLinger` fails with "dh-fedora lost run:<id> when the last SSH session of your user there closed" |
    | `host-package-fully-undoable` | hub | AC4 | lists the package with the agent's undo and nothing about its install scripts | `judgePackage` fails with "the plan that installs dh1945-<id> … lists the package as fully undoable" |

## How each criterion is read

- **The root plans' scripts** (AC1, AC2): `planScript` writes, in the folder of the user your config logs in as,
  `plan-<nonce>.sh` with one line `V=<letter>`, the byte a test changes. Run as root, it appends to the harness's
  root-only `/var/lib/dh1945-<id>/ran` which variant ran and as which uid, the file it ran from with its owner, group
  and mode, and each folder above it; then it prints `dh1945 <nonce> <letter> uid 0` and exits 0.
- **AC1** (`root-plan.test.ts`): a plan (variant E) proposed; once the chat channel has carried its ask (up to 2
  minutes), approved and run with the password typed at the prompt; then the agent calls `deep_status` and `deep_wait` and submits a prompt, and 15 s pass for the channel. The forms
  searched: plain, hex (both cases), URL-encoded, JSON-escaped, and base64 and base64url at each of three byte
  alignments. The places: the record (every event `events.read` gives, every file under the hub's `~/.deepbuild`, a
  `.zst` or `.gz` one unpacked); a log (the hub's stdout and stderr, every `deep` command's output but the terminal's,
  every other file in the world's folder, and on the host every file under `/`, `/home`, `/var`, `/root`, `/etc`,
  `/tmp`, `/var/tmp`, `/run`, `/dev/shm`, `/opt`, `/srv`, `/usr/local` written since the user was made, and the
  journal since then, as root); an agent (every hook output and deep mcp reply the session was handed); a channel
  (every request the chat channel made of its provider). Controls, each needed or the search is BLOCKED: the ask in the
  events and its id in the hub's files; the plan's note in `/var/lib/dh1945-<id>/ran` and a line the harness logged
  (`logger`) in the host's search; the ask in what the agent was handed; the ask's id in what the channel sent.
- **AC2** (`root-plan.test.ts`): `judgeLocked`, variant A: proposed (the plan must be an authority ask defaulting to
  no that locks the script), approved, then `V=A` becomes `V=B` in place (`dd conv=notrunc`, the file's SHA-256 checked)
  and `deep host run` runs with the password: nothing of variant B, nor of A, may run as root, it must exit non-zero
  and name both hashes. `V=A` is put back and `deep host run` runs again: variant A must run as uid 0 from a file other
  than the agent's, owned and held as reading 5 says, and the record must hold the run as reading 6 says. The plant
  runs the same judge on variant C, changed to D.
- **AC3** (`linger.test.ts`): the run is `run.start` with `host` (#1942's reading 4), a check `first-remote-run` whose
  script writes its token, its cgroup and `linger=<Linger>` to `first.starts`, then a beat a second for 15 minutes.
  `judgeLinger`: readings 7, 10, 11; a user session that stays open 2 minutes after every connection was cut fails the
  test (the run's life can't be told apart from it). `judgeRootLinger`: reading 8, then the plan approved and run with
  the password, and `Linger` read back as `yes` within 30 s. Before each, the user's `Linger` must read `no`.
- **AC4** (`package.test.ts`): the package `dh1945-<id>` (`dpkg-deb --root-owner-group --build`), its file list
  checked to hold `/usr/share/dh1945-<id>/listed` and not the file its postinst writes,
  `/var/lib/dh1945-<id>-made/unlisted`, and its control to hold a postinst. The script `install-dh1945-<id>.sh` is
  `dpkg -i <file>`; the step names the package file. Read while the ask is open (no `ask.answered`), from `deep inbox`:
  reading 9.

## Known limits

- AC1 searches the places the criterion names; your own terminal, where you type the password, isn't one (sudo shows
  only its `*`s; the proof says whether the terminal's text held the password). A password kept hashed, encrypted or
  compressed other than as `.zst` or `.gz` isn't found by any search; the macOS unified log isn't searched.
- AC2's script exits 0, so a hub that always records exit 0 isn't caught here; the outcome and the exit are read.
- AC3 reads "before the run starts" from inside the run (lingering on as it started), not from the order of events in
  the record; the record must hold the change, in any order.
- AC4 installs nothing: what the postinst would write is read from the package (its file list against its postinst),
  not from an install.
- Scope that no criterion names isn't read: the sha256-digest sudo rule as a host change, console-only steps as tasks,
  fingerprints, Remove it and partial undos (#1946), config tests before a reload, and host changes as you other than
  lingering. Lingering is already on for Lima's user on both VMs; only the throwaway users have it off.
