# Acceptance tests for #1943: setting and machine check kinds for hosts

Written first, blind, by a job that never saw an implementation of #1943; none exists at the base (`07b63844`). The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- Issue #1943 (`gh issue view 1943`): Scope, the one criterion, Proof. Its parent #71 for context only; #1942 and #1945
  are merged into the base; #1944, #1946 and #1947 are other parts, and nothing here tests them.
- `docs/technical-design.md`: Blocks for work on your other machines (Hosts, Grants per host, Remote runs, Changes on a
  host, Done, for a machine, Still off-limits); Work outside a repo (State source, Pinned to a state); Checks for work
  beyond code (Setting, Machine, and the rules every kind shares); How runs become one of five verdicts; Dogfooding; the
  Building blocks table (Check, State source); the Hub slots table (`check.kind@1`'s row); One host contract (`host@1`).
- The base, for surfaces and conventions only: `packages/checks-work` (#68's kinds: `workFill`, `workKit`, `src/kit.ts`
  with its planted runners `misses-the-fault`, `past-deadline`, `dropped-output`, its `planted-` fixtures and seeded
  part), `packages/conformance` (`runKit`, `CheckSpec`, `CheckContext`, `CheckResult`, `RunOutcome`, `KindBudget`,
  `SlotKit`, `PlantedFill`, the `state-source@1` kit), `packages/hub/src/hosts.ts` (#1942's host link: `ssh -F` your
  `~/.ssh/config`, a connection of its own per call), `src/kinds.ts` (#1537's kind table), `src/plant.ts`
  (`DEEP_HUB_PLANT`), `packages/workspaces` (the shipped state sources) and `packages/hub/src/workspaces.ts` (readings
  pinned in a checkout). The suites `68` (a kind's kit and planted-failure tests), `1942` and `1945` (the Lima VMs as
  test hosts, the harness's own SSH link, README and BASE-FAILURE layout).

## Criterion and files

One criterion, `#1943.9249618e` (`#1943.` and the first 8 hex of SHA-256 of the checkbox text after `- [ ] `, trimmed,
white space collapsed: `scripts/proof-change.mjs`'s `criterionId`). Every `describe` title is that ID and its text.

| Clause | File | Tests |
|---|---|---|
| on a test host, a setting the definition requires, changed by a planted drift, fails the setting check, naming the setting | `setting.test.ts` (deep-ubuntu) | the kind passes the setting while it holds and fails it at its assertion after the drift, naming `max_connections` and not `listen_address`; the planted runner `misses-the-drift` fails that judge |
| a service that doesn't survive a restart fails the machine check, naming the service | `machine.test.ts` (deep-fedora) | the kind passes an enabled service that survives its restart and fails one that doesn't at its assertion, naming it; the planted runner `never-restarts` fails that judge |
| each ships with a planted failure it catches, run in its conformance test; each passes `check.kind@1` (#13) | `kit.test.ts` (setting on deep-ubuntu, machine on deep-fedora) | `runKit` on the kind's own kit, on the test host: PASS on every case, fixed and seeded; a `planted-` fixture expected `failed`; the kind's own plant fails the kit on a `planted-` case, and `past-deadline` and `dropped-output` fail it, each with its own message |

## Run them

macOS, the repo's Node (24.22.0) first on `PATH`, with this Mac's Lima VMs `deep-ubuntu` and `deep-fedora` running:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                           # once
npm run build --workspaces                       # vitest.config.ts loads scripts/lanes.mjs, which needs built packages
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1943 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1943/tsconfig.json
```

- **Needs:** `ssh` and the two VMs (`~/.lima/<vm>/ssh.config` is read for the way in), each with a user manager for
  Lima's user (lingering is already on there). A VM that can't be reached fails the test as BLOCKED; nothing skips for
  it. In Claude Code, run it from the Bash tool with its sandbox off, so `ssh` may reach the forwarded ports.
- **One at a time:** the kits restart services and judge runs against deadlines on VMs other suites share, so the
  implementer adds `tests/acceptance/1943/` to `alone` in `scripts/lanes.mjs` (not done here: this job writes tests
  only).
- **Safety:** every local folder is under `/tmp/dh1943-*`, removed after its file. No hub and no `deep` command runs:
  the kinds run in the test's own process, so no HOME or `DEEP_*` setting reaches a hub. The only network is the VMs
  through their forwarded SSH ports on 127.0.0.1; no model is called and no `git` is run. On a VM the suite touches
  only `~/dh1943-<id>/` and the user units whose names hold `dh1943-<id>` (the clauses' and any a kit makes, reading
  9); after each file each such unit is stopped, disabled, reset and unlinked, `~/.config/systemd/user` keeps no file
  or link whose name holds it, and the folder is removed. Services are restarted; no VM is stopped or rebooted. Lima's
  control socket is never used: the world's SSH config and the harness's both set `ControlMaster no` and `ControlPath
  none`. Every local process is one the suite started, stopped by its handle; nothing is stopped by name or port. The
  VM's user name and key path are redacted in what the suite shows (`redact`).

## The world (`helpers.ts`)

One world per VM and test file, opened once: a temp folder `/tmp/dh1943-<id>/` holding **the SSH config the kinds
are handed**, `home/.ssh/config`, one `Host` block naming the VM `dh1943-ubuntu` or `dh1943-fedora` with Lima's way in
(its key, user, host key alias, ciphers and a copy of its known-hosts file, `BatchMode yes`) at the VM's forwarded port;
**the harness's own link**, a second config with its own alias, which makes `~/dh1943-<id>/` on the host, writes what a
check reads there and cleans up; and an empty local `checkout/` with a 120 s deadline as the check runs' context. The
alias exists only in the world's config, so a kind that reaches the host by any other way (another SSH config, Lima's
tools) can't find it.

## Readings where the issue leaves a choice

The issue and the design name: check kinds for hosts under #68's rules, setting (an account's or a machine's setting
holds, read through its state source) and machine (enabled, survives a restart, listens only as asked, keeps its disk
margin), each shipping a planted failure it catches in its conformance test, each passing `check.kind@1`; a host read
only through the host link (#1942's: your SSH config, `ssh -F`). Where they leave a name or a shape open, this job picked
the smallest surface the design and the base imply; each is listed so the implementer builds to it.

1. **The package and its surface.** A new workspace package, `@deepbuild/checks-host`
   (`packages/checks-host/src/index.ts`), a plug-in on the core as `@deepbuild/checks-work` is: it imports only
   `@deepbuild/conformance` and `node:` built-ins, never the hub. The tests import it lazily through that entry, so each
   fails on its own at the base.

   ```ts
   import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec, SlotKit } from '@deepbuild/conformance';

   /** R3's check kinds for hosts. */
   export type HostKind = 'setting' | 'machine';
   /** The host link: the SSH config every read and change on a host goes through, as `ssh -F <config> <host> …`. */
   export interface HostLink { config: string }
   /** Where a kind's kit makes its cases: a test host `config` names, and a folder there that is the kit's alone. */
   export interface TestHost extends HostLink { host: string; folder: string }

   /** A machine's setting holds: each of `settings` has its value in `file` on `host`, read over the link at each run. */
   export interface SettingSpec extends CheckSpec {
     kind: 'setting'; runner: 'ssh';
     /** A host the link's SSH config names. */
     host: string;
     /** The settings file there, an absolute path (reading 3). */
     file: string;
     /** Each setting the definition requires, by name, and the value it must hold. */
     settings: Record<string, string>;
   }
   /** A service is enabled and survives a restart: `service` is a user unit (reading 5) on `host`. */
   export interface MachineSpec extends CheckSpec {
     kind: 'machine'; runner: 'ssh';
     host: string;
     service: string;
   }
   export type HostSpec = SettingSpec | MachineSpec;

   /** A kind as the check.kind@1 fill deep.registerCheck registers; a run reports a run outcome, never a verdict. */
   export interface HostFill extends CheckRunnerFill {
     kind: HostKind;
     run(spec: HostSpec, ctx: CheckContext): CheckResult | Promise<CheckResult>;
   }
   export function hostFill(kind: HostKind, link: HostLink): HostFill;
   /** The kind's own check.kind@1 kit, its cases made on `at.host` under `at.folder` (reading 9). */
   export function hostKit(kind: HostKind, at: TestHost): SlotKit<HostFill>;
   ```

   A `budget` per run, as #68's kinds declare (the hub's kind table admits no kind without one), and a `register`
   function are the implementer's and aren't read here.
2. **The host link.** A kind reaches a host only through the SSH config it was handed: every read and every change
   there is `ssh -F <config> <host>` (with its own options, such as `BatchMode`), as #1942's link is; never another SSH
   config, Lima's control socket or its tools. The hub hands its `~/.ssh/config` (#1942's reading 1); the tests hand the
   world's. The world's config sets no control master: how a kind shares connections is its own.
3. **A setting and its file.** The setting kind reads a settings file on the host: `name = value` lines, spaces around
   `=` optional, blank lines and lines starting with `#` ignored, a value being the text after the first `=`, trimmed.
   The test's file is `~/dh1943-<id>/<tag>/service.conf`:

   ```
   # dh1943 test service settings
   listen_address = 127.0.0.1
   max_connections = 100
   log_level = info
   ```

   and the definition requires `listen_address` = `127.0.0.1` and `max_connections` = `100` (`log_level` it doesn't
   name). A file holding every required setting with its value passes; one where a required setting has another value
   fails at the check's assertion (`failed`, a failure with `assertion: true`).
4. **"Read through its state source"** is read as: the kind reads the setting from the host itself, over the host link,
   at each run, the way a host's state source reads what a thing is now; whether it does so through a `state-source@1`
   fill of its own is the implementer's. A reading pinned in a checkout (`.deepbuild/state/<touch>.json`, #67) isn't
   this path: the drift happens on the host after the check's first run, and the same fill's next run must see it.
5. **A service.** The machine kind's `service` is a user unit (`systemctl --user`) of the user the SSH config logs in
   as. A system unit, which takes root to restart and so a root plan (#1945), isn't covered here.
6. **"Survives a restart"** is read as: the check restarts the service itself (`systemctl --user restart`, a change as
   you within the host's grant; never a reboot) and the service is active again and stays active; **enabled** is
   `systemctl --user is-enabled` saying `enabled`. The test's failing service, enabled and active before the check,
   takes a lock folder on start that it never gives back, so on any start after its first it says so on stderr and
   exits 1 at once (its unit fails within a second of the restart). How long the kind waits after the restart is its
   own; a second is enough for this service.
7. **Naming.** The setting check's drift failure, at its assertion, holds the setting's name (`max_connections`) in
   its message, and no failure of that run names `listen_address`, which holds: a runner that names every required
   setting doesn't name the one that drifted. The machine check's failure, at its assertion, holds the unit's name
   (`dh1943-<id>-<tag>-stale`, with or without `.service`).
8. **One fill, two runs.** Each clause's judge runs one fill twice: the setting before and after the drift, the machine
   kind on the steady service then the stale one. A fill keeps no reading across runs that would hide a change on the
   host.
9. **The kits.** `hostKit(kind, at)` is the kind's own `check.kind@1` kit, run by the conformance package's one runner
   (`runKit`), as #68's kinds' kits are. Its cases are made on the test host `at.host`, reached through `at.config`
   only, under `at.folder`, an absolute folder there that exists and is the kit's alone (the kit never removes it).
   Every user unit a case makes has a name starting with that folder's base name (here `dh1943-<id>`), and a case
   removes what it made when it ends (stopped, disabled, unlinked, reset). As #68's kits: each fixture's expected answer
   holds `outcome`, a run outcome; the fixed part ships at least one fixture whose id starts `planted-` and whose
   expected outcome is `failed` (for setting, a required setting changed by a planted drift; for machine, a service that
   doesn't survive a restart); there is a seeded part, cases drawn from `runKit`'s seed; and the reference fill is
   `hostFill(kind, { config: at.config })`. The tests don't hold `kitProblems`, the preflight's synchronous kit check:
   a host can only be reached asynchronously.
10. **Plants** are selected the way the base selects a kind's planted runners: by name from its kit's `planted`
    (`kit.planted.find((p) => p.name === name)`, as #68's suite does); no hub runs here, so `DEEP_HUB_PLANT` selects
    nothing. At the base no kit exists, so their tests fail there.

    | Plant | Kind | The wrong program | Read as failed when |
    |---|---|---|---|
    | `misses-the-drift` | setting | reports passed on a required setting whose value changed on the host since its last run (as a runner that keeps its first reading, or never compares, would) | `judgeSetting` finds "the setting check missed the drift of max_connections"; the kit FAILs on a `planted-` case with its message |
    | `never-restarts` | machine | reports passed on a service that is enabled and active, without restarting it | `judgeMachine` finds "the machine check passed dh1943-<id>-plant-stale.service"; the kit FAILs on a `planted-` case with its message |
    | `past-deadline` | both | `check.kind@1`'s: reports a result after its deadline | the kit FAILs, a case carrying its message |
    | `dropped-output` | both | `check.kind@1`'s: drops a crashed run's output | the kit FAILs, a case carrying its message |

    The four messages differ within each kit, and each plant's `fill.kind` is the kind.

## How the criterion is read

- **The setting clause** (`setting.test.ts`, deep-ubuntu): reading 3's file is written through the harness's link;
  `hostFill('setting', { config })` runs on `{host: 'dh1943-ubuntu', file, settings: {listen_address: '127.0.0.1',
  max_connections: '100'}}` and must report `passed`; the harness then rewrites the file in place with
  `max_connections = 500` (the planted drift) and checks it landed; the same fill's next run must report `failed`, with a
  failure at its assertion naming `max_connections` and none naming `listen_address`. The wrong program,
  `misses-the-drift`, runs the same judge on a fresh file of its own.
- **The machine clause** (`machine.test.ts`, deep-fedora): two user units, `dh1943-<id>-<tag>-steady.service` and
  `dh1943-<id>-<tag>-stale.service`, each a script in the test's folder that runs while the folder exists, linked from
  that folder, enabled and started, and read back as `enabled` and `active` before any check (BLOCKED otherwise; the
  stale one's lock must exist). `hostFill('machine', { config })` must report `passed` on the steady one and `failed` on
  the stale one, a failure at its assertion naming it. The wrong program, `never-restarts`, runs the same judge on fresh
  units of its own.
- **The conformance clause** (`kit.test.ts`): reading 9 and the plants' table, for each kind on its VM: the kit's slot
  is `check.kind@1`; it ships a `planted-` fixture expected `failed`; `runKit` with `hostFill(kind, { config })` reads
  PASS on every case, fixed and seeded (the seed is in the failure message); then each of the kind's plant,
  `past-deadline` and `dropped-output` makes `runKit` on the fixed part read FAIL, a FAIL case carrying its message (the
  kind's own on a `planted-` case).

## Known limits

- Scope no criterion names isn't read: what done means drafted after a probe, a reboot only with your yes, listening
  only as asked, the disk's margin. Any spec field for them is optional (absent means not checked); the suite's specs
  leave them out.
- The hub isn't run: whether its kind table (#1537) holds these kinds, and how a definition names them, isn't read. The
  criterion names the kinds and their conformance test.
- An account's setting (through an API's state source) isn't tried; the clause is on a test host.
- A missing file, a setting absent from it, a name given twice and a host the config doesn't name aren't tried.
- The kits' own cases are the implementer's: the tests hold their shape (a `planted-` case, a seeded part), that the
  kind passes them all, and that the named plants fail them. The clauses' worlds are this suite's own.
- A runner that names the setting or the service only in some other spelling (quoted differently, cut short) fails.
- The VMs run on this Mac, so "over SSH" crosses loopback and Lima's port forward, not a network.
