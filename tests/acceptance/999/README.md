# Acceptance tests for #999: sessions on your other machines record into your hub, gated like local ones

Written first, blind, by a job that never saw an implementation of #999; none exists at the base (`2c79d71eb`). The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

**Not run.** The job that wrote this suite was barred from building or running anything (the machine's build queue
was blocked), so no test here has been executed or type-checked: see Unvalidated. There is no `BASE-FAILURE.txt` yet;
whoever first runs the suite on the base saves one. The failures at the base below are predicted from reading.

## What was read

- Issue #999 as saved for this job (`issue.json`): Scope, the three criteria, Proof, Depends on. For context only: the
  epic #7, the closed dependencies #1942 and #315, and the siblings #71 and #1170.
- `owner-ruling.md`, the owner's ruling of 2026-11-24 on the words "reads unknown" in criterion 1, treated as part of
  the issue (The owner's ruling, below). Its provenance, as the file gives it: the question and the recommendation
  were written by the implementing agent after reading only the issue, the design and the base; the owner's answer was
  "whatever you recommend"; the issue's text has not been edited to match, which is the owner's to do.
- `AGENTS.md`, and `docs/technical-design.md`: Blocks for work on your other machines (Sessions on a host, Hosts, Grants
  per host, Remote runs); One hub per user, a tiny hook client, and extensions in-process; Hook protocol; Socket roles
  and contract versions (One role per credential, What a minor may change, Version skew, Your hub wherever it runs);
  States people see; Dogfooding; Repo guards (tests wait for the event they need).
- The base, for surfaces and conventions only: `packages/hub/src/hosts.ts` (`deep host`, `host.facts`, remote runs as
  `deep-<token>` user units), `runs.ts` (`run.started`'s `host`), `server.ts` (the hello's `contract`, `test.clock`),
  `wire.ts` (`CONTRACT`), `plant.ts` (`contract-major-ahead`), `status.ts`, `rows.ts`, `list.ts` (the row shape, the
  quiet row, `deep status`), `doctor.ts`, `log-reads.ts` (an event as the stream carries it), `claude-settings.ts`
  (the hook command), `hookmap.ts`, `packages/checks-command/src/index.ts` (a drafted check runs as `sh <file>`),
  `packages/cli/src/main.ts`, `crates/deep-hook/src/main.rs` (the address, `CONTRACT`, the hello), the schemas
  `hook.request@3`, `doctor.item@1`, `session.attention@2`, `row.set@4`; `scripts/proof-change.mjs` (`criterionId`),
  `scripts/wait-ratchet.mjs`, `scripts/lanes.mjs` and `lanes-lists.mjs` (`lane.json`), `scripts/alone-lint.mjs`. The
  suites `1942` (the VM's way in, the relay, the harness link), `3229` and `3220` (a session through its hooks, the
  followed record, handed definitions), `315` (the spool, the socket's lines), `1334` and its redraft (the contract).

## Criteria and files

Each `describe` title is the criterion's ID and its text: `#999.` and the first 8 hex of SHA-256 of the checkbox text
after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s `criterionId`).

| AC | ID | File | Tests |
|---|---|---|---|
| AC1, to its semicolon | `#999.1bb7a56d` | `session.test.ts` | a session on the host records its start, prompt, tool calls, stops, claims and verdicts into the hub, each carrying the host's name, while a session on this Mac carries none; mid-turn `deep status` lists it under the host's name; its claim reads FAIL while price.txt holds 18.00 and PASS once it holds 17.00, each by the sample check run on the host as a user service named by its run token, recorded on the host |
| AC1, after it | `#999.1bb7a56d` | `cut.test.ts` (1) | link cut mid-session: six calls are let through on the host; the row reads `quiet`, its why says the link to the host is down, with a since, at once and five minutes on by the hub's clock; never finished, ended or gone; after the link returns the twelve events are in the record once, in the order they ran, each with its stamp and the host's name, before the session's next hook; the row no longer says the link is down |
| AC1 | `#999.1bb7a56d` | `cut.test.ts` (2) | a request deep-hook spooled on the host, handed to the hub on this Mac's own socket, isn't recorded under the host's name |
| AC2, first half | `#999.4257f07c` | `skew.test.ts` (1) | the hub updated one contract minor ahead under a recording session: its next call is recorded under the host's name |
| AC2, second half | `#999.4257f07c` | `skew.test.ts` (2) | the hub updated one contract major ahead: a row of `deep status` and an item of `deep doctor` that isn't ok each name the host and both contract versions |
| AC3 | `#999.9065ba1c` | `listeners.test.ts` | the host's TCP and UDP listeners after `deep host add`, and with a session recording through the link, hold none that wasn't there before |

## Run them

macOS, the repo's Node (24.22.0) first on `PATH`, with this Mac's Lima VM `deep-ubuntu` running (or another, named by
`DEEP_TEST_VM`):

```sh
npm ci                                           # once
npm run build --workspaces                       # every test runs packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook    # the hub's own, and the local session's
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/999 --testTimeout=1800000 --hookTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/999/tsconfig.json
```

- **One at a time.** `lane.json` puts the folder in the alone block (`shared: the Lima VMs`): every test starts a hub
  of its own and installs on the one VM, whose one home holds the deep-hook, the hooks and the spool.
- **Needs.** `ssh`, `ps`; the VM (`~/.lima/<vm>/ssh.config` is read at each run for the way in) with `ss`, `git`,
  `base64`, a user manager and lingering on, as #1942's suite needs it. **The deep-hook for the host:** `deep host add`
  finds or builds the deep-hook it installs for the host's system; where it looks is the implementation's, and this
  suite builds nothing for the host. A VM that can't be reached, or a binary that isn't built, fails the test as
  `BLOCKED`; nothing skips, and nothing missing passes.
- **Time.** Six worlds, each a hub start, a `deep host add` and a session; a claim's checks and a held stop take
  minutes on a loaded Mac. No test waits a fixed time (The five minutes).
- **Safety.** Every local folder is under `/tmp/dh999-*`, removed after its test. Every hub and `deep` command runs
  with `HOME` in its world's temp folder and without the caller's `DEEP_*`, `XDG_*`, `GIT_*`, `CLAUDE*`, `CODEX*`,
  billing keys or `NODE_OPTIONS` (`SSH_AUTH_SOCK` kept; `PATH` is Node and the system's programs). The only network is
  127.0.0.1 and the VM through its forwarded port; no model is called. On the VM the suite makes `~/dh999-<id>/`, the
  session's transcript folder under `~/.claude/projects/`, and `~/.claude/` when the VM has none, and removes them;
  it stops the user units whose names hold a token its check wrote down. What `deep host add` installs there
  (deep-hook, the hooks in `~/.claude/settings.json`, the spool) is the hub's: the suite asks it back out with
  `deep host remove <host>` after each test and removes nothing of it itself. Every local process is one the suite
  started, stopped by its PID. The VM's user name, the key's path and both homes are redacted in what the suite
  writes down.
- **The proof** (the issue's Proof line) is written to `$TMPDIR/deep-999-proof/`, rewritten each run: the session's
  events with the host each carries, its claims with their runs and the units they ran in, the row and the replayed
  events of the cut, the rows and doctor items of the skew, the listeners.

## The world (`helpers.ts`)

One world per test: a temp home whose `~/.ssh/config` names the VM under a name made for the run, `box<6 hex>`, with
Lima's way in at the Port of **a relay** this suite runs on 127.0.0.1, so the relay is the hub's only way to the
host: cut, it closes every connection through it and each new one as it arrives; restored, it carries them again.
**A real hub** (`deep hub run`) with that home, `DEEP_HUB_TEST_CONFIRM` (the OS confirming you, stubbed),
`DEEP_HUB_TEST_DRAFTS` (the definition handed, as #3229's suite hands it) and `DEEP_HUB_TEST_CLOCK_STEPS=1` (#965's
`test.clock`). **The record**, followed on one `stream.subscribe` as the cli role. **`deep`** as you: `host add`,
`host facts`, `host remove`, `status`, `doctor`, `inbox answer`. **The harness's own link** to the VM (its own config
and ControlPath, straight to Lima's forwarded port, never through the relay), which makes the suite's folder, the
sample repo and the session's process, and reads the host's listeners, its spool and the check's notes. A world first
reads the host's facts with `deep host facts <host> --refresh` (#1942's) and is `BLOCKED` unless that went through the
relay, so a VM the hub can't reach never reads as a missing feature.

## Readings where the issue leaves a choice

Where the issue and the design leave a name or a shape open, this job picked the smallest surface they and the base
imply. Each is listed so the implementer builds to it, and a dispute starts here.

1. **The test host** is this Mac's Lima VM, as #1942's suite has it, under a name your SSH config gives it. The name
   is made per world, so no text of the run can hold it by accident and nothing an earlier world left on the host
   answers to it.
2. **`deep host add <host>`**, run as you, ends with exit 0 once deep-hook and Claude Code's hooks are on the host and
   the link is up or coming up. **Grants:** no criterion reads the grants, so the tests neither need nor forbid an
   ask. Where the hub asks you something that names the host and offers an option whose `decision` is `allow`, the
   suite answers it once with `deep inbox answer`, as you; where `deep host add` ended non-zero (not 2) having asked,
   it is run once more after the answer.
3. **A session on the host** is the base's convention for a Claude Code session, moved to the host: a long-lived
   process there (`fixtures/agent.sh`, a shell; the VM has no Node) with `CLAUDECODE=1`, whose children are the
   session's hook commands. Each hook is the command `deep host add` installed for that event in
   `~/.claude/settings.json` on the host (the first `command` entry that names deep-hook; the waiter, marked
   `asyncRewake`, is skipped), run as Claude Code runs it: `sh -c <command>` in the session's folder, the hook's JSON
   on stdin. So the suite never names where deep-hook is on the host. The host stands for one where Claude Code has
   run: `~/.claude/` exists. The transcript is where Claude Code keeps it, `~/.claude/projects/<folder, dashed>/`,
   each entry carrying the newest Claude Code version the facts cover. With the link up, a hook is fired again until
   the record holds its event, at most six times (deep-hook lets a call go past its budget, as the base's suites
   allow for); six tries with none recorded fail the test.
4. **The sample repo and what done means.** `~/dh999-<id>/repo` on the host: one commit on `main` with `price.txt`
   (`20.00`) and the drafted check `.deepbuild/checks/price.sh`, which passes once `price.txt` holds `17.00`. The
   prompt's definition is handed with that check, in #3229's shape. The check names no `host:`: a session on a host
   is judged by checks run there ("with checks run there as remote runs"), since its repo is there. The session
   doesn't commit: the gate judges the worktree's snapshot, as for a local session.
5. **The host's name on an event:** `events.read` and the stream give the event with `host: "<name>"` on the event
   itself, beside `session` and `writer`, or in its `data`, as `run.started` has it. It is read on every event of the
   session's hooks (`session.start`, `user.ask`, `tool.before`, `tool.after`, `agent.stop`), on each `claim.made` and
   each `verdict.made` of its claims. A session on this Mac in the same hub carries no host's name.
6. **Under the host's name:** in `deep status`, the session's line sits under a heading line that names the host,
   where a local session's sits under its repo; in `deep status --json`, the session's row names the host in some
   field other than its title and why. The app's sidebar isn't read.
7. **Gated by a check run on the host:** each run of the claim's check is a `run.started` whose `host` is the host's
   name, never `local`; on the host the check notes, from inside its run, its `DEEP_RUN_TOKEN` and its cgroup, which
   is a user unit whose name holds that token (#1942's remote runs); and the claim's newest verdict follows the
   check: `FAIL` for the stop made while `price.txt` holds `18.00`, `PASS` for the one made once it holds `17.00`. The
   stop's own reply isn't read.
8. **The link cut** is the relay closing every connection and each new one: the hub's `ssh` ends at once, and
   deep-hook on the host finds no hub. A link that goes silent without closing isn't tried. The hub must hold at
   least one connection through the relay when it is cut: the SSH link that forwards the hooks' socket.
9. **The five minutes.** The criterion cuts the link for 5 minutes. The repo's rule is that a test waits for the event
   it needs, never for time to pass (design: Repo guards; `scripts/wait-ratchet.mjs` holds a new test file to zero
   fixed waits), so the suite doesn't sleep. The link is cut for real, for as long as the scene takes; the session's
   hooks go on running on the host; and the five minutes pass on the hub's own clock: `test.clock {advance_ms:
   300000}` (#965's, served to a hub started with `DEEP_HUB_TEST_CLOCK_STEPS=1`) steps it while the link is down,
   between the session's fourth and fifth call. What a hub times on its clock comes due: one that gives up on a link
   after some minutes, or ends, finishes or drops a session it hasn't heard from, fails. What five minutes of wall
   time on the host or inside `ssh` would add isn't covered here; the issue's Proof line (one gated task on a real
   host, the link cut and restored mid-session) and #1170's demo are where a real five-minute cut belongs.
10. **The owner's ruling** on "its row reads unknown meanwhile" (`owner-ruling.md`): no new state word; while the
    link is down the session has the hub's `unknown` status, so its row's word is `quiet`; the row's why says the
    link to that host is down, and since when; the row never reads `finished`, and the session is never ended or gone,
    because of the cut. Read as: a `row.set` of the session with word `quiet` arrives after the cut; `deep status
    --json` then gives its row with `word` `quiet`, a `why` that holds the host's name and the words `link` and
    `down`, and a numeric `since` no older than a minute before the last hook the hub had from the host and no later
    than the hub's clock; the same five minutes on; from its first quiet `row.set` until the link returns no
    `row.set` of it reads another word or leaves the list; none since the cut reads `finished`; and the record holds
    no `session.end` or `session.gone` of it. Once the link is back and its events are in, its row's why no longer
    says the link is down.
11. **Once and in order.** Each call the session made while the link was down has one `tool.before` and one
    `tool.after` in the record, by its `tool_use_id` (`data.call`); in the record's order they are exactly the hooks
    in the order they ran; each has a `seq`, rising; each landed after the link returned and before the session's
    next hook, which is fired once they are all in; each carries the host's name. None reached the hub while the
    relay was cut (that would be the harness's fault: `BLOCKED`).
12. **The host's name comes from the link, not the request.** While the link is down, another session's one hook runs
    on the host, and its request is read from the host's spool, `~/.deepbuild/spool/*.jsonl` there ("spools as it
    does locally"; #315's place). Those bytes are then written to the hub's socket on this Mac after its hello, as a
    hook's request is. Whatever the hub answers, no event with that request's ID, or of that session, may carry the
    host's name: the connection it arrived on is no host's link. A hub that refuses the line passes this; one that
    gives no answer in 30 s is `BLOCKED`.
13. **Version skew.** The host gets its deep-hook from `deep host add` on a hub of this checkout, so both speak the
    contract the hub's hello names, `<major>.<minor>`. The hub is then updated under the recording session: stopped
    by its PID and started again on the same home as a planted hub (`DEEP_HUB_PLANT`), while the session's process on
    the host runs on. So the hub must take up its hosts' links again when it starts.

    | Plant | Whose | The hub's hello | Read |
    |---|---|---|---|
    | `contract-minor-ahead` | this suite's, new: the implementer adds it beside #1334's | `<major>.<minor + 1>` | the host's deep-hook is older, within the contract: the session's next call, fired as in reading 3, is recorded with its two hooks, each carrying the host's name |
    | `contract-major-ahead` | #1334's, at the base | `<major + 1>.0` | the host's deep-hook is outside the contract: after one more call of the session, a row of `deep status --json` names the host and both versions, and so does an item of `deep doctor --json` whose level isn't `ok` |

    **Both versions** are the two contract versions, the host deep-hook's and the hub's, since the contract is what
    one is outside of: each must stand in the row's or the item's JSON as a version, not as part of a longer number.
    "Its row" is any row of the list that names the host: the session's under it, or the host's own if it has one.
14. **Listeners** are read on the host by the harness, not by the hub: `ss -Hltn` and `ss -Hlun`, every listening TCP
    socket and every bound UDP one, loopback included, as `tcp <address>:<port>` or `udp <address>:<port>`. A
    listener there after `deep host add`, or while a session's hooks reach the hub, that wasn't there before fails
    the test, named. One that went away doesn't. A forward to a TCP port on the host's loopback is such a listener.

## Wrong programs these tests fail on

No criterion names a planted twin, so the suite ships none; each test fails on the base, and these are the wrong
programs each was written to hold apart, by reading.

| A hub or host link that | Fails | At |
|---|---|---|
| has no `deep host add` (the base) | every test | `deep host add` ends 2 with the usage of `deep host` |
| marks the row finished, ends the session or flags it gone when the link drops | `cut.test.ts` (1) | reading 10 |
| leaves the row as it was (`working`) while the link is down, or says nothing of the link | `cut.test.ts` (1) | reading 10 |
| gives up on the link after minutes on its clock | `cut.test.ts` (1) | reading 9, then 11 |
| replays the host's spool twice, or out of order, or loses a line | `cut.test.ts` (1) | reading 11 |
| blocks the session's calls while the link is down | `cut.test.ts` (1) | every call let through |
| takes the host's name from a field of the request | `cut.test.ts` (2) | reading 12 |
| stamps every event with the host once one is added | `session.test.ts` | reading 5, the session on this Mac |
| runs the claim's check on this Mac, or judges without running it | `session.test.ts` | reading 7 |
| passes every claim, or fails every claim | `session.test.ts` | reading 7, FAIL then PASS |
| refuses a deep-hook whose version isn't its own | `skew.test.ts` (1) | reading 13 |
| is silent about a deep-hook outside its contract, or names one version | `skew.test.ts` (2) | reading 13 |
| forwards the hooks to a TCP port on the host, or starts a listener there | `listeners.test.ts` | reading 14 |

## At the base (predicted, not run)

`deep host add <host>` isn't a command at `2c79d71eb`: `deep host` prints its usage (`deep host run <ask>`, `changes`,
`remove`, `list`, `facts`) and ends 2. Every world should start (hub ready, the VM reached by the harness, its facts
read through the relay), and each of the six tests should then fail at `hostAdd` with "`deep host add box…` must
install deep-hook and Claude Code's hooks on the host and end with exit 0: exit 2, … Usage: deep host run <ask> …".
`listeners.test.ts` reads the host's listeners once before that. Behind it, also missing at the base by reading: any
hook on the host, an event's `host`, a row under a host, a check of a session's claim run as a remote run, the
link-down row, the replay of a host's spool, the plant `contract-minor-ahead`, and a row or doctor item for a host's
deep-hook.

## Unvalidated

No test was run, and `tsc` wasn't. Checked without running anything of the product's: each `.ts` file parses (Node's
`stripTypeScriptTypes`), `fixtures/agent.sh` parses (`sh -n`), and the wait ratchet's own `findings` function, called
from a one-liner on the five files, counts no fixed wait (the two timers in `helpers.ts` only bound a wait and carry
`// deadline:`). None of these was tried:

- that `tsc -p tests/acceptance/999/tsconfig.json` passes, and `node scripts/wait-ratchet.mjs` and
  `node scripts/repo-rules.mjs` as the lint lane runs them;
- the harness on a VM: the master that says `ready`, `fixtures/agent.sh` (its `read` loop, `base64 -w0`, deep-hook as
  its own child), the scripts sent through `sh -s`, `ss`'s columns, the cleanup;
- the relay's cut and restore against a real `ssh`;
- the hub's replies as read here: the stream's frames after a restart, `test.clock`'s `now`, the hello's `contract`;
- that the base's gate judges a drafted check that is plain `sh` with `on_base: passes` as it does #3229's.

## Known limits

- Asks, the app's sidebar, Codex's hooks and the named features of the hello are in Scope but in no criterion as a
  separate reading; they aren't read.
- "Since when" is read as a time in a window, not as the moment of the cut: a test can't tell a hub's last sight of
  the session from its first sight of the dropped link without waiting.
- Reading 12 tries a request the host's own deep-hook wrote. A hub that took the host's name from the request could
  still pass it by refusing every request on its local socket that carries one; nothing here forges a request.
- The skew is made on the hub's side, by a planted hello: no older deep-hook is built or installed on the host.
- One VM stands for every host; two hosts at once aren't tried.
- A world that fails midway may leave what `deep host add` installed on the VM when `deep host remove` doesn't take it
  out; the next world's `deep host add` installs over it.
