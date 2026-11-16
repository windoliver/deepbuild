# Acceptance tests for #1946: Remove it on hosts

Written first, blind, by a job that never saw an implementation of #1946; none exists at the base (`0e557273`). The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- Issue #1946 (`gh issue view 1946`): Scope, the four criteria, Proof. Its parent #71 for context only.
- `docs/technical-design.md`: Blocks for work on your other machines (`hosts`: Root plan, Remote runs, Changes on a
  host, Grants per host, Still off-limits); Plans before acting; Checks for work beyond code (setting and machine);
  Tasks only you can do; Dogfooding.
- The base, for surfaces and conventions only: `packages/hub/src/hosts.ts` (#1942's and #1945's host link, runs as
  `deep-<token>` user units, `deep_root_plan`, `deep host run`, `deep host changes`, `host.changed` with `grant` you or
  root, `undo` and `fingerprint`), `src/hub-control.ts` and `src/server.ts` (the `host.*` cli methods), `src/runs.ts`
  (`run.start` with `host`), `src/tools.ts` (`deep_root_plan`'s strict schema, a missing nullable field read as null),
  `src/plant.ts`, `packages/checks-host` (`hostFill`, `draftMachine`, the probe's messages), `packages/cli/src/main.ts`,
  `packages/asks`. The suites `1945` (the model: its harness, terminal, agent fixture, README and BASE-FAILURE), `1943`
  and `1942`.

## Criteria and files

Each `describe` title is the criterion's ID and its text: `#1946.` and the first 8 hex of SHA-256 of the checkbox text
after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s `criterionId`).

| AC | ID | File | Test | Plant it must fail |
|---|---|---|---|---|
| AC1 | `#1946.a67b553d` | `remove.test.ts` | `judgeChecks`: the host's checks, drafted after a probe before setup, pass before setup, fail after it at the service's address, and pass again after Remove it | none named |
| AC2 | `#1946.fa254d06` | `sudo-rule.test.ts` | `judgeSudoRule` on dh-fedora: the plan shows the rule as a step with its undo; the rule is a recorded host change as root with its undo and names the script's digest; by it the unchanged script runs as root with `sudo -n`, and with one byte changed sudo refuses it; Remove it takes it out | `sudo-rule-names-path` |
| AC3 | `#1946.525c8ef7` | `remove.test.ts` | `judgeGrants`: the service undone as you with no root step naming it, the package removed in one root plan, as the host and the record show | `remove-undoes-all-as-root` |
| AC3 | `#1946.525c8ef7` | `partial.test.ts` | `judgePartial`: an undo of three steps stopped after its first records the one it undid and the two left, and the host agrees | none named |
| AC4 | `#1946.b7aba9e2` | `edited.test.ts` | `judgeEdited`: a unit edited by hand after setup is kept, a backup holding the edit is saved, and the undo is reported partial, naming the unit | `remove-overwrites-edit` |

## Run them

macOS, the repo's Node (24.22.0) first on `PATH`, with this Mac's Lima VMs `deep-ubuntu` and `deep-fedora` running:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                           # once
npm run build --workspaces                       # the tests run packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook    # the agent's session needs it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1946 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1946/tsconfig.json
```

- **One at a time:** every test starts its own hub and makes a user on a VM, so the implementer adds
  `tests/acceptance/1946/` to `alone` in `scripts/lanes.mjs` (not done here: this job writes tests only). The
  supervisor's sandbox needs a shell that may start it (in Claude Code, the Bash tool with its sandbox off).
- **Needs:** `ps`, `ssh`, `ssh-keygen`, `/bin/bash` and `/usr/bin/script` (the pseudo-terminal), and the two VMs
  (`~/.lima/<vm>/ssh.config` is read at each run for the way in), each with passwordless sudo for Lima's user;
  deep-ubuntu with `dpkg-deb` and `python3`; deep-fedora with a sudo that checks command digests (sudo 1.9;
  deep-ubuntu's sudo-rs can't parse a digest, so AC2 runs on deep-fedora). A VM that can't be reached fails the test as
  BLOCKED; nothing skips for it.
- **Safety:** every local folder is under `/tmp/dh1946-*`, removed after its file. Every hub, `deep` command,
  `deep mcp` and deep-hook runs with `HOME` in its world's temp folder and without the caller's `DEEP_*`, `XDG_*`,
  `CLAUDE*`, `CODEX*`, billing keys or `NODE_OPTIONS` (`SSH_AUTH_SOCK` and `PATH` kept). The only network is
  127.0.0.1 and the VMs through their forwarded ports; no model is called and no `git` is run. Lima's control socket is
  never used and the VMs are never stopped; Lima's user's lingering, sudo rights, groups and password are never
  touched. On a VM the suite makes, and after its file removes: the user `dh1946<id>` (key login with a key made under
  `/tmp/dh1946-<id>/k/`, a random password, lingering on, no subordinate IDs; removed with its sessions, user manager,
  user units and lingering, then `userdel -r`), its `/etc/sudoers.d/00-dh1946-<id>` (checked with `visudo -cf` before
  it's moved in), any file under `/etc/sudoers.d` made during the test that names that user (a rule DeepBuild wrote and
  didn't take out), the root-only folder `/var/lib/dh1946-<id>/`, each folder under `/var/lib/deepbuild/plans` made
  during the test whose files name the test (and those two folders once empty, when made during the test), that
  user's journal file when it had none before, and the test package `dh1946-<id>-pkg` (`dpkg --purge`). Every local
  process is one the suite started, stopped by its PID. No password reaches an argument list or a file the suite
  writes: it goes to the host on an SSH session's stdin (`chpasswd` from `printf`), and to `deep` only at the sudo
  prompt; the suite writes down neither it nor the VM's user name or key paths (`redact`).
- **The proof** (the issue's Proof line: a removal back to where it started on a real host) is written to
  `$TMPDIR/deep-1946-proof/`, rewritten each run: the setup and Remove it on dh-ubuntu (the checks drafted, their
  failures before setup, after it and after Remove it, the host changes, `deep host remove`'s output, its root plan and
  run, the host.undone records), AC2's plan, rule, `sudo -n` runs and removal, AC3's partial record, AC4's edit, backup
  and report, and each plant's failures.

## The worlds (`helpers.ts`)

One world per test (AC1 and AC3's first test share one), adapted from #1945's: a temp home whose `~/.ssh/config` names
one VM, `dh-ubuntu` or `dh-fedora`, straight at Lima's forwarded port with its host key alias and ciphers; **a real
hub** (`deep hub run`) with that home, `DEEP_HUB_TEST_CONFIRM` (the OS confirming you, stubbed) and
`MCP_TOOL_TIMEOUT=30000`; **the hub's socket as the cli role**; **`deep inbox answer`**; **`deep` in a pseudo-terminal**
(`/usr/bin/script`), which types the password once a line ending in `password:` (any case) shows and never before;
**an agent's session** where a root plan is proposed (AC2, AC3's first two tests): `fixtures/agent.mjs` (1945's),
its children the real deep-hook and its own `deep mcp`; **your own login** (`ssh -F` the world's config), for what
you do on the host as your user; and **the harness's own link** to the same VM as Lima's user, which makes and removes
the throwaway user and reads the host as root.

**The user the config logs in as** is a throwaway user `dh1946<id>` the harness makes, whose sudo needs its password
(`dh1946<id> ALL=(ALL:ALL) ALL` in a file named to sort before any other in `/etc/sudoers.d`, so a later rule for the
user is the one sudo matches last) and whose **lingering is already on**, as on a host that has had DeepBuild's runs
before: the hub records no host change for lingering, so the changes each test makes are all Remove it has to undo.

## Readings where the issue leaves a choice

The issue and the design name: every change on a host recorded with its undo and a fingerprint of what it wrote; Remove
it running each undo with the grant that made the change, your user's as you and root's as one root plan; an undo that
stops partway recording what it undid and what's left; a target changed since keeping a backup, stopping and reporting
the undo partial, naming the file; the sudo rule naming the script's sha256 digest, listed as a host change with its
undo; checks proving the host is back. Where they leave a name or a shape open, this job picked the smallest surface
the design and the base imply, extending the base's host surfaces; each is listed so the implementer builds to it.

1. **Remove it is `deep host remove <host>`**, the CLI as you (beside `deep host run`, `deep host changes`), over a cli
   method `host.remove {host}`. It undoes every change the record holds for that host that isn't undone yet: your
   user's changes as you, over your SSH config, at once; root's changes as **one root plan** it raises (an ask as
   #1945's: authority, question naming root and the host, its plan's steps each undo), which you approve with
   `deep inbox answer` and run with `deep host run <ask>` and your sudo password, as every root plan. A root plan is
   told by its question naming root (`/\broot\b/i`), as the base's "Run this root plan on … as root?" does, and that it
   names the host (in the ask or its plan). Its exit code isn't read. The order of the undos isn't read either.
2. **A change as you comes from a remote run that declares it**: `run.start` with `host` (#1942) takes `changes`, a
   list of `{does, changes, undo}` in the shape of `deep_root_plan`'s steps (what it does; what it changes, files by
   absolute path; its undo, a shell command for the host, or null). Once the run has ended, the hub records each as
   `host.changed` with `host`, `change` (the `does`), `changes`, `undo`, `grant: "you"`, `fingerprint` (each absolute
   path's SHA-256 as the hub read it there) and `run`, as #1945 records a root plan's steps with `grant: "root"`.
3. **An undo is its shell command**, run on the host with the grant that made the change: as your user (`sh -c`), or as
   a step of Remove it's root plan. So a root plan's step undo is a command too.
4. **What Remove it records: `host.undone`**, one event per pass and grant (the as-you undos when `deep host remove`
   runs; the root plan's once `deep host run` ran it), with `host`, `grant` (`you` or `root`), `undone` and `left`
   (lists of `{change, undo}`, each `change` the text of the `host.changed` it undoes), `partial` (true when it stopped
   with steps left), and `stopped` (null, or `{change, target, backup, why}`: the step it stopped at, the file that
   changed since or null, the absolute path on the host of the backup it kept or null, and why). The step it stopped
   at is among `left`.
5. **A stop** comes from a target changed since (its fingerprint no longer matches) or from an undo that fails; either
   way the undo stops there and records what it undid and what's left. **The backup** is a copy, on the host, of the
   file as it is now (with the edit), at the path `stopped.backup` names, never the file's own path. **Reported
   partial:** `deep host remove`'s output says `partial` (any case) and names the unit's file name; and the record's
   `host.undone` has `partial: true` with `stopped` naming it.
6. **The sudo rule** is asked for with a new nullable field of `deep_root_plan`, **`sudo_rule`** (`true`: allow this one
   script by a sudo rule naming its sha256 digest; null or absent: none, so the field is optional to every caller). The
   plan then shows a step changing a file under `/etc/sudoers.d/` with its undo; running the plan writes the rule there
   (for the user your SSH config logs in as, `NOPASSWD`, the command's path with `sha256:<digest>`, hex or base64),
   and the record holds it as `host.changed` with `grant: "root"`, `changes` naming that file, and its undo. The path the
   rule allows is read from the rule (its first absolute path); it must hold the plan's script, and is run as your user
   with `sudo -n <path>`. Remove it takes it out in its root plan: afterwards no file under `/etc/sudoers` or
   `/etc/sudoers.d` names that path.
7. **"The host's checks it passed before setup"** are read with the real machine kind of `packages/checks-host`:
   `draftMachine` after a probe (`host.facts` with `refresh`, read before setup), nothing asked of the host but a disk
   margin of 1 GiB, so the draft is one machine check (nothing listens beyond what listened at the probe; the disk keeps
   its free space less 1 GiB), run by `hostFill('machine', {config})` over the world's SSH config. They must pass
   before setup and fail after it at the service's address (else BLOCKED: they couldn't tell), and pass after Remove
   it. **"Fails the host's checks, naming the service":** the kind's failure names the address the service listens at;
   the judge names the service whose address it is.
8. **The setup** (AC1, AC3): the remote run writes `~/.config/systemd/user/dh1946-<id>-web.service`
   (`python3 -m http.server` on 127.0.0.1 at a free port) and runs `systemctl --user enable --now` for it, declaring
   one change (the unit and its `default.target.wants` link) whose undo is `systemctl --user disable --now <unit> &&
   rm -f <unit file> && systemctl --user daemon-reload`; the agent proposes a root plan whose script runs `dpkg -i` on
   the package file `dh1946-<id>-pkg_1.0_all.deb` (no maintainer scripts, so nothing in it is "can't undo"), one step
   naming the package file with undo `dpkg --purge dh1946-<id>-pkg`, approved and run with your password.
9. **"Disables the service as you with no root step":** after Remove it, `systemctl --user is-enabled` (as your user)
   doesn't say `enabled` and nothing listens at its address; a `host.undone` with grant `you` lists its change as
   undone; no root plan Remove it raised has a step naming the unit, and no `host.undone` with grant `root` lists it.
   **"Removes the package in one root plan":** Remove it raised exactly one root plan for the host, it names the
   package, after it ran `dpkg -s` finds no package, and a `host.undone` with grant `root` lists its change as undone.
10. **Grants:** an ask that names the host, offers an option whose decision is `allow` and isn't a root plan (the base's
    grant for changes as you on a host) is answered yes once by `deep inbox answer`, recorded in the proof as
    `answered`; root plans are the tests' to answer.
11. **Plants**, each selected with `DEEP_HUB_PLANT=<name>` as `src/plant.ts` selects every other, given to a planted
    world's hub and to every `deep` command that world runs, so whichever side does the planted work reads it. At the
    base each is refused ("names no planted program") and the hub doesn't start, so those tests fail there:

    | Plant | Criterion | The wrong program | Read as failed when |
    |---|---|---|---|
    | `sudo-rule-names-path` | AC2 | writes the sudo rule naming only the script's path, no digest | `judgeSudoRule` fails with "sudo ran the changed script (variant D …" |
    | `remove-undoes-all-as-root` | AC3 | puts every undo, your user's too, in Remove it's root plan | `judgeGrants` fails with "… dh1946-<id>-web.service is still enabled for your user …" and "the host's checks fail … naming dh1946-<id>-web.service" |
    | `remove-overwrites-edit` | AC4 | writes the recorded version over the edited target and undoes it | `judgeEdited` fails with "Remove it didn't keep your edit to dh1946-<id>-edit.service …" |

## How each criterion is read

- **AC1 and AC3, first two clauses** (`remove.test.ts`): `setupAndRemove` (readings 7 and 8), then `deep host remove`
  and its root plan run; `judgeChecks` (AC1) lists each failure of the host's checks after Remove it; `judgeGrants`
  (AC3) reads readings 2, 4 and 9 from the record and the host. The plant world runs the same flow.
- **AC3, last clause** (`partial.test.ts`): one remote run as you writes `p1/file`, `p2/file` and `p3/file` in the
  test's folder, three changes each with undo `rm -f <file>`; the harness makes `p2` read-only as root (mode 555), so
  the second undo fails while every file still matches its fingerprint. After `deep host remove`, the newest
  `host.undone` with grant `you` must be partial, list exactly one change undone (the first or the third: the undo may
  start from either end, never the second) and the other two left; the file it undid must be gone and the two left still
  there, and only one of the three may be gone.
- **AC4** (`edited.test.ts`): one remote run as you writes `~/.config/systemd/user/dh1946-<id>-edit.service`, one change
  with undo `rm -f <it>`; as your user, `sed -i` changes its `Description=` line. After `deep host remove`: the unit's
  SHA-256 is still the edited file's; the output and the record report the undo partial, naming the unit (reading 5);
  the file at `stopped.backup` has the edited file's SHA-256.
- **AC2** (`sudo-rule.test.ts`): the agent's script `allowed-<nonce>.sh` (in your folder, mode 755) has one line
  `V=<letter>`; run as root it appends `dh1946 <nonce> variant <letter> uid <uid>` to the harness's root-only
  `/var/lib/dh1946-<id>/ran`. Proposed with `sudo_rule: true` and one step whose undo removes its lines there; reading 6
  for the plan, the record and the rule; `sudo -n <path>` as your user must add a line of the unchanged variant as uid
  0; with one byte of the file at that path changed by the harness as root (`dd conv=notrunc`, its SHA-256 checked), it
  must add no line of the changed variant (nor exit 0); the byte is put back; `deep host remove` must raise a root plan,
  which run with your password leaves no rule naming the path, after which `sudo -n <path>` runs nothing. The plant runs
  the same judge on variant C, changed to D.

## Known limits

- The host's checks (reading 7) read every listening socket on a VM other sessions share: one that another user opens
  there during the test fails AC1, as it would fail the host's real checks.
- AC1 reads only what the machine kind reads; a Remove that leaves a file nothing listens on or fills the disk with
  isn't caught by AC1 (AC3 reads the service and the package themselves).
- A stop is caused in AC3 by an undo that fails, and in AC4 by a target changed since; neither test reads the other
  cause. A service's config test before a reload (Scope) is in no criterion and isn't read; nor are console-only
  steps, or what a package's install scripts did (#1945's AC4).
- AC2's script is run by `sudo -n` as your user, never by the hub; whether the hub runs an allowed script later isn't
  read.
