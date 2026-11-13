# Acceptance tests for #1942: hosts from your SSH config, facts as readings, runs started once by token

Written first, blind, by a job that never saw an implementation of #1942; none exists at the base (`d51be2c3`). The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- Issue #1942 (`gh issue view 1942`): Scope, the five criteria, Proof. Its parent #71 for context only; #1943 to #1947
  are other parts and nothing here tests them.
- `docs/technical-design.md`: Blocks for work on your other machines (`hosts`): Hosts, Grants per host, Remote runs,
  Sessions on a host (for `deep host`), Still off-limits; Plans before acting; Scale later's "Every lease and run names
  its host" and "One host contract" (`host@1`); the Lease primitive; Dogfooding; the interfaces table (CLI, MCP tools)
  and the Building blocks table (Check: `deep_run`).
- The base, for surfaces and conventions only: `packages/supervisor/src/types.ts` (host@1's `StartSpec`, whose run
  token is `DEEP_RUN_TOKEN`; `HostFacts`; the kept run's `systemd-run --user` scope in `supervisor.ts`),
  `packages/hub/src/runs.ts` (`run.start`, `run.started@3`'s `host`, a run's output as evidence, `run.finished`),
  `src/core.ts` (`mcpCall`, `deep_claim`, `deep_run`, `deep_status`, `checksOf` reading `.deepbuild/done.yaml`),
  `src/tools.ts`, `src/server.ts` (roles, `stream.subscribe`), `src/plant.ts` (`DEEP_HUB_PLANT`), `src/mcp.ts`,
  `src/paths.ts`, `packages/readings/src/types.ts` (a reading's `value` and `as_of`), `packages/evidence`,
  `packages/cli/src/main.ts`, `scripts/proof-change.mjs` (`criterionId`), `scripts/benchmark.mjs` and
  `scripts/release-budgets.mjs`. The suites `1922` and `1731` (layout, README, BASE-FAILURE), `965` and `29` (a
  session played through deep-hook with its own deep mcp), `27` (`MCP_TOOL_TIMEOUT`), `30`, `1106`, `996`
  (`run.start` on the cli role), `1098` and `1515` (budgets).

## Criteria and files

Each `describe` title is the criterion's ID and its text: `#1942.` and the first 8 hex of SHA-256 of the checkbox text
after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s `criterionId`).

| AC | ID | File | Tests |
|---|---|---|---|
| AC1 | `#1942.4fd41df2` | `unnamed.test.ts` | the hub lists only the host your SSH config names and reads its facts; three names it doesn't name refused by `host.facts` and `run.start`, naming them, with no connection to the listener `Host *` leads to |
| AC2 | `#1942.dd9b1b61` | `survives.test.ts` | an agent's `deep_run` of a check naming `host:` starts a 40 MiB download as a user unit holding its run token; after the session ends the unit runs on and the download grows while the run has no end and the claim no verdict; it completes, then the run ends `passed` with its output whole as evidence |
| AC3 | `#1942.b3fd8575` | `budgets.test.ts` | the perf lane has a #1942 task; facts refresh over SSH under 5 s (five timed after a warm-up, each fresh); a remote run's lines reach `deep run follow` within 500 ms (five windows' worst line) |
| AC4 | `#1942.a60bd93f` | `stall.test.ts` | `judgeStall`: A's connection stalled 60 s, B stays on its own connection within 500 ms, A alone reconnects; planted hub `host-link-drops-every-connection` fails it, naming B's run |
| AC5 | `#1942.be821b2d` | `once.test.ts` | `judgeOnce`: the link dropped right after a start lands on the host; one start there, read back by its token, one `run.started`, ended `passed` with its output once; planted hub `host-link-resends-on-reconnect` fails it with the run started twice, naming the token |

## Run them

macOS, the repo's Node (24.22.0) first on `PATH`, with this Mac's Lima VMs `deep-ubuntu` and `deep-fedora` running:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                           # once
npm run build --workspaces                       # the tests run packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook    # the hub and AC2's session need it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1942 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1942/tsconfig.json
```

- **One at a time:** every test starts its own hub, and AC3's and AC4's numbers mean something only without another
  file's runs on the same VM, so the implementer adds `tests/acceptance/1942/` to `alone` in `scripts/lanes.mjs` (not
  done here: this job writes tests only). The supervisor's sandbox needs a shell that may start it (in Claude Code, the
  Bash tool with its sandbox off). With an implementation, the suite takes about 12 minutes, most of it AC4's two
  60 s stalls and AC2's download.
- **Needs:** `ps`, `ssh`, and the two VMs (`~/.lima/<vm>/ssh.config` is read for the way in). A VM that can't be
  reached fails the test as BLOCKED; nothing skips for it.
- **Safety:** every local folder is under `/tmp/dh1942-*`, removed after its file. Every hub, `deep` command,
  `deep mcp` and deep-hook runs with `HOME` in its world's temp folder and without the caller's `DEEP_*`, `XDG_*`,
  `CLAUDE*`, `CODEX*`, billing keys or `NODE_OPTIONS` (`SSH_AUTH_SOCK` and `PATH` kept). The only network is
  127.0.0.1 and the VMs through their forwarded ports; no model is called and no `git` is run. On a VM the suite
  touches only `~/dh1942-<id>/`, the processes it started there (by PID; its host-side loops also end by themselves
  once that folder is gone), and the user units whose names hold a token its runs wrote down or whose command or
  folder is its folder: each is stopped and reset, and the folder removed, after the file. Lima's control socket is
  never used and the VMs are never stopped. Every local process is one the suite started, stopped by its PID; nothing
  is stopped by name or port. The VM's user name and the key's path are redacted in everything the suite writes down.
  Files the hub itself leaves on a host (if any) are the implementation's to remove.
- **The proof** (the issue's Proof line) is written to `$TMPDIR/deep-1942-proof/`, rewritten each run: AC2's run with
  its host, the unit holding its token, the download's output and its evidence hash; AC5's starts by token; AC4's
  connection rates, stall and lag readings; AC3's readings; each planted hub's failures.

## The world (`helpers.ts`)

One world per test: a temp home whose `~/.ssh/config` names one VM, `dh-ubuntu` or `dh-fedora`, with Lima's way in
(its key file, user, host key alias and a copy of its known-hosts file, `BatchMode yes`, no `ControlMaster`) at the
Port of **a relay** this suite runs on 127.0.0.1, which forwards to the VM's forwarded SSH port and can count, stall,
delay and drop each connection; **a real hub** (`deep hub run`) with that home and `DEEP_HUB_TEST_CONFIRM` (the OS
confirming you, stubbed); **the hub's socket as the cli role** (the control token and this process as the peer);
**`deep inbox answer`**; **`deep run follow`**; and **the harness's own link** to the same VM (its own config file and
ControlPath under the world's folder, straight to Lima's forwarded port, never through the relay), which makes
`~/dh1942-<id>/`, writes the runs' inputs, reads the host's user units, the runs' marker files and its clock, and cleans
up. AC2 adds **an agent's session**: `fixtures/agent.mjs` stands for Claude Code, its children the real deep-hook
(`SessionStart`, `SessionEnd`) and its own `deep mcp`, spoken to as an MCP client; a deep mcp reply that the hub was
unreachable ("nothing was recorded") is called again, as it says to.

**The runs.** Each test run begins with one line appended to `<folder>/<tag>.starts`, written from inside the run:
`<$DEEP_RUN_TOKEN> <the last line of /proc/self/cgroup>`. So each start of a run on the host leaves one line, which
names its token and the unit it runs in. AC3's and AC4's runs then write `dh1942 <tag> <i> <host ns> [<pad>]` every
100 ms (A pads with 4,000 and B with 400 fresh random base64 characters, so nothing compresses them); AC5's writes
`tick 1` to `tick 20` a second apart, then `done`; AC2's download is below.

## Readings where the issue leaves a choice

The issue and the design name hosts read from your SSH config, facts as readings with their age, remote runs as user
services named by run token through `systemd-run --user`, followed, stoppable, their output kept as evidence, a claim
that waits for them, and a start at most once per token, read back after a drop. Where they leave a name or a shape
open, this job picked the smallest surface the design and the base imply; each is listed so the implementer builds to it.

1. **Your SSH config** is `~/.ssh/config` under the hub's `HOME`. Since `ssh` itself reads the passwd home's, the hub
   hands it the file (`ssh -F`) or reads it the same way. **A host** is a name a `Host` line names literally (no `*`,
   `?` or `!`); a name only a pattern such as `Host *` matches, an address in a `HostName` value, or an `ssh://` URL
   is not a host and is never contacted. The world's config sets no `ControlMaster`: how the hub shares connections is
   the hub's.
2. **`host.list {}`** (cli role) answers `{hosts: [{name}]}`: each host your SSH config names, and nothing else.
3. **`host.facts {host, refresh}`** (cli role) answers `{host, facts: {system, gpus, drivers, disk, listening}}`, each
   fact a reading `{value, as_of}`: `as_of` is when it was read over SSH, in ms since the epoch on this Mac's clock, so
   its age is now − `as_of`. With `refresh: true` each fact is read over SSH during the call (its `as_of` within 250 ms
   of the call's span) and the reply comes once all are read; with `refresh: false` the kept readings come back with
   their `as_of` unchanged. What the tests read of each value: `system`'s JSON holds the kernel release (`uname -r`);
   `gpus` is a list of GPUs (each with its memory), empty on these VMs; `drivers` is present; `disk` holds objects with
   `free_bytes`, one of which is the space free or available, in bytes, on the filesystem holding your home there
   (within 5% or 1 GiB of `df`); `listening` holds an object with `port` (a number) for each listening TCP port, a
   loopback one included. A name that isn't a host: an `error` reply whose text names the name as given.
4. **A remote run started as you** is the base's `run.start` (cli role) with `host: <name>`: `argv` runs on that host,
   `cwd` is an absolute folder there, and `check`, `claim` and `commit` are as today (the suite names a claim the record
   doesn't hold, as `#1106`'s and `#996`'s suites do). It answers `{run: "run:<id>"}`; the record's `run.started`
   names `host: <name>` (`run.started@3`'s field: "a run records its host"); a name that isn't a host is an `error`
   naming it. The run ends as today: `run.finished` with the host's exit as its outcome (`passed` for 0) and
   `evidence` holding the SHA-256 of its stdout bytes.
5. **A remote run started by an agent** is a check in the repo's `.deepbuild/done.yaml` that names `host:` beside
   `run:`; `deep_run` of it runs `run` with `/bin/sh -c` on that host and answers as today (`{run, claim, outcome:
   "running", evidence: []}` once its wait ends; the suite's hub has `MCP_TOOL_TIMEOUT=30000`, so it ends at once).
6. **A user service named by its run token.** The run's environment on the host holds `DEEP_RUN_TOKEN`, host@1's run
   token, as every supervised run's does; the run is a user unit started through `systemd-run --user` (its cgroup is
   under `user@<uid>.service`) whose name holds that token, such as `deep-<token>.service`, and which outlives the SSH
   session that started it. The tests read the token from inside the run and find the unit by it with
   `systemctl --user list-units --all`.
7. **Followed:** `deep run follow <run>` (the CLI, as you) writes the run's stdout to its own stdout as it comes, from
   the run's start, then live, and exits once the run has ended.
8. **Output kept as evidence:** `run.finished`'s `evidence` holds the SHA-256 of exactly the bytes the run wrote to
   stdout, read whole across reconnects and drops (AC2's download output, AC5's ticks).
9. **A claim waits for its run:** read in the record. While the run's unit is still active on the host after the
   session ended, there is no `run.finished` for the run and no `verdict.made` for the claim; once it ends there, the
   run's `run.finished` is `passed`, and any verdict on the claim comes after it (by `log_pos`). A hub that ends the run
   when the session or its connection ends, or judges the claim first, fails.
10. **Grants:** no criterion reads the grants, so the tests neither need nor forbid an ask. Where the hub asks you
    something that names the host's alias and offers an option whose `decision` is `allow`, the suite answers it once
    with `deep inbox answer <ask> <option>`, as you (recorded in the proof as `answered`). AC1's world answers none.
11. **Plants**, selected with `DEEP_HUB_PLANT=<name>` on the hub, as `src/plant.ts` selects every other; at the base
    each name is refused ("names no planted program"), so those tests fail there:

    | Plant | Criterion | The wrong program | Read as failed when |
    |---|---|---|---|
    | `host-link-drops-every-connection` | AC4 | on one stalled connection, the host link drops every connection it holds to that host | `judgeStall` fails naming B's run (the unstalled one) as reconnected, or as stalled with A |
    | `host-link-resends-on-reconnect` | AC5 | on reconnecting after a drop, the host link sends the unknown start again | `judgeOnce` fails with the run "started 2 times" on the host, naming the token |

12. **How lag is measured.** A line's lag is when it reached the follower (this process, `deep run follow`'s stdout)
    less when the host wrote it, both on this Mac's clock: each line carries the host's `date +%s%N`, and the host's
    clock offset is read over the harness's link before and after (12 round trips over one SSH session, the shortest
    kept, so its error is under half of about 5 ms), their mean taken.
13. **How AC4 stalls a run's connection and reads reconnects.** Once both followers have 20 lines, the relay's
    connections are ranked by bytes from the host over 3 s: A's connection is the busiest (at least 10 KB/s), B's the
    next (at least 1.5 KB/s and under a third of A's); a B with no connection of its own fails. A's connection is then
    stalled both ways for 60 s (its sockets stop being read; nothing passes) and released. **Only the stalled one
    reconnects** is read as: B's connection stays open through the stall and carries bytes in every 2 s of it, B's
    lines written during the stall all arrive, in order, none repeated, each within 500 ms; and A comes back on a
    connection opened during the stall that carries over 50 KB, with lines A wrote during the stall arriving before it
    ends. A polling design that opens a connection per read reconnects B too, and fails.
14. **How AC5 drops the link.** The host's facts are read first (so a link the hub keeps is up; a failure there is
    ignored). Then every byte from the host is held back 1 s at the relay, the run is started with `run.start`, and a
    loop on the host (through the harness's link) watches `once.starts`; the moment the run's line lands there (it has
    started, and its start's reply is still held), every connection to the host is cut and the delay lifted. Then: one
    line in `once.starts`; an active user unit whose name holds that token right after the drop; one `run.started` for
    the run; and `run.finished` `passed` whose stdout evidence is the 20 ticks and `done`, once. A start the record
    shows on another host ends the wait early.
15. **AC3's timing rule** is the repo's (`scripts/benchmark.mjs`'s `judgeLimit`, as #1098's): five readings after a
    warm-up, with the load average at each reading's start and end; PASS when all five are within the limit, FAIL when
    all five are over it by more than the margin, INCONCLUSIVE otherwise, and INCONCLUSIVE off a reference Mac, on
    battery, with Low Power Mode on, the thermal state not nominal, or the load above the core count. A facts reading is
    one `host.facts {refresh: true}` call, call to reply, a second after the one before; a lag reading is the worst line
    of a window of 20. The surface is exercised first, so a missing one fails on any machine. "Compared with the merge
    base" is the perf lane's: the first test asks for a task in `benchmarks/budgets.json` whose `initialReason` names
    #1942, valid by `validateBudgets`; this suite runs no git, so it can't read the merge base's budgets itself.
16. **AC4 under load:** a lag past 500 ms, read while the 1-minute load average is above the core count and with
    nothing else failing, is a reading, not a result: the test skips as INCONCLUSIVE with it. Every other failure fails.

## How each criterion is read

- **AC1** (`unnamed.test.ts`): the config names `dh-ubuntu` and ends with `Host *` (`HostName 127.0.0.1`, `Port` of
  a listener that counts and closes every connection). `host.list` names `dh-ubuntu` alone; `host.facts {refresh}` on
  it holds its kernel release and went through the relay. For `dh1942-stranger`, `127.0.0.1` and
  `ssh://dh@127.0.0.1:<listener>`, `host.facts` and `run.start` are each refused, naming the name, and the listener
  counts no connection, then or in the 5 s after.
- **AC2** (`survives.test.ts`): the download is `download.sh` in the test's folder on `dh-fedora`: 40 MiB copied from
  `source.bin` (random bytes the test made) in 1 MiB pieces about a second apart, `downloaded <i> of 40 MiB` after
  each, then `model.bin complete 41943040 bytes`. The session claims (`deep_claim`, task `session:<id>#model`) and runs
  `model-download` (`deep_run`); the run is recorded on `dh-fedora`, its line lands in `download.starts` with a token,
  and its cgroup is a `user@<uid>.service` unit holding that token. The session ends (SessionEnd, then its process and
  deep mcp exit) and the record holds its end. 15 s on: the unit holding the token is active, `model.part` grew, the
  run has no `run.finished` and the claim no `verdict.made`. Then `model.bin`'s SHA-256 is `source.bin`'s, the run is
  `passed` with the download's output as its stdout evidence, and no verdict on the claim comes before its end.
- **AC3** (`budgets.test.ts`): reading 15. The facts' host has a listener the test opened (a port the host picked),
  which `listening` must hold; each refresh's facts must be read during it (reading 3). The lag run writes 150 lines;
  each of the five windows must hold its 20 lines in order before its worst lag is read.
- **AC4** (`stall.test.ts`): readings 12, 13, 16, on `dh-ubuntu`.
- **AC5** (`once.test.ts`): reading 14, on `dh-fedora`.

## Known limits

- "Stoppable" (Scope) is in no criterion and isn't read; the suite stops its own units through the harness's link.
- The grants (probe, change as you asked once, root only as a plan) and lingering are in Scope but no criterion; they
  aren't read (reading 10). Lingering is already on for the user on both VMs.
- "Keys stay in your SSH agent": the world's config names Lima's key file, as Lima's own does, and `SSH_AUTH_SOCK` is
  passed through; nothing reads where the hub's ssh takes its key from.
- AC1 tries three names a hub could reach; a name in the passwd home's own SSH config (not the world's) isn't tried,
  since this suite can't write that file. A hub that ran `ssh` without the world's file wouldn't reach `dh-ubuntu`,
  so AC1's first half fails it.
- AC2 reads "the claim waits" in the record: no verdict and no run end while the run runs on. The base makes no
  verdict on a claim with no definition of done, so a hub that never judges such a claim meets that half; the run's
  end, `passed` once the download really ended, is what the claim waits for here.
- AC4 identifies connections by their bytes from the host. A hub that carries both runs on one connection fails it
  (stalling that connection stalls both), which is the criterion's point; one that moves a run's stream between
  connections on its own, with nothing stalled, may also fail it.
- AC5's drop comes after the run has started on the host and before its start's reply reaches the hub; a drop at
  other moments (before the start leaves this Mac, or after its reply) isn't tried.
- Timings: the VMs run on this Mac, so "over SSH" crosses loopback and Lima's port forward, not a network.
