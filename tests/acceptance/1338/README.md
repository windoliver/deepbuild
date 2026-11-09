# Acceptance tests for #1338: reach a shared hub from another machine

Written first, blind, by a job that never saw an implementation of #1338; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has five checkbox criteria, AC1 to AC5 in the body's order. Each test's name carries its criterion's ID
(`#1338.` and the first 8 hex digits of SHA-256 of the checkbox's text, `AC<n>: ` included, white space collapsed, as
`scripts/proof-change.mjs` reads it):

| AC | ID | File | What it checks |
|---|---|---|---|
| AC1 | `#1338.177002b6` | `revoke.test.ts` | bob reads the project over the network; a client presenting nothing gets none of it; 5 s after maya revokes bob, his read is refused |
| AC2 | `#1338.0bb77d41` | `hook.test.ts` | deep-hook on bob's machine over a 100 ms link stays within the network route's declared overhead, every hook recorded; a fail_closed fast rule decides the same with the link up and cut |
| AC3 | `#1338.3bfe844f` | `generation.test.ts` | the CLI and deep-hook, having seen generation 3, refuse the hub left behind at generation 2, naming both |
| AC4 | `#1338.6ce12ef3` | `port.test.ts` | a hub with no members, told where to listen, opens no TCP port (and opens one once it has a member); the planted hub that listens fails, naming the port |
| AC5 | `#1338.3ec909b1` | `proof.test.ts` | bob's credential copied to a machine without his key is refused there, naming the proof |

## What was read

- Issue #1338 as the job's brief quoted it: Scope, the five criteria, Proof ("Two machines on one hub, with the link
  cut and restored"), Depends on (#1337, closed, merged). Not read from GitHub by this job; the IDs are computed from
  the quoted text.
- `docs/technical-design.md`: Socket roles and contract versions (One role per credential, Version skew, Your hub
  wherever it runs, People in the record), Scale later (A writer generation, Agents in the cloud), One hub for a
  project shared by several people, A hub of your own in the cloud, Threats (Injected answers, Callers posing as
  others, A broken hub: fail-open, the 50 ms). `AGENTS.md`.
- At the base `dd83ac2f` (main), for surfaces and conventions only: `packages/hub/src/server.ts` (the hello line with
  `generation`, roles, the Origin refusal, the person's `cli`/`hook` hello), `people.ts` and core's `person.add`,
  `paths.ts` (`hubAddress`: `hub.address` must be `unix:`), `client.ts`, `status.ts` (`deep status` lists each session by
  the first 8 characters of its ID), `plant.ts`, `packages/record/src/index.ts` (`writerGeneration`, `prepareRestore`),
  `crates/deep-hook/src/main.rs` (`address()`, the 20 ms ack budget, fail-open, the spool) and `default-rules.json`,
  `adapters/claude-code.facts.json` (no route member today); the suites `tests/acceptance/1337` (layout, the world),
  `16` (its helpers, imported by path), `304` (deep-hook's decision as Claude Code reads it), `572` (generations).

## What the base does

The hub listens only on its socket; `hub.address` must be `unix:`; there is no invite, no revocation, no network
listener, no route in the facts, and no client reads the generation. Every test fails or reads BLOCKED;
`BASE-FAILURE.txt` has the run.

## Run them

macOS (lsof), with the repo's Node (`.node-version`, 24.22.0) and Rust:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                                                   # once
npm run build --workspaces                                               # the tests run packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # target/debug/deep-hook
NO_COLOR=1 npx vitest run tests/acceptance/1338 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1338/tsconfig.json
```

The suite never builds deep-hook itself; a missing binary reads BLOCKED. Each world lives under `/tmp/dh1338-*` (a short
path, for the hub's socket) and is removed at the end; every process is stopped by its PID. No model is called, nothing
is fetched, and nothing leaves 127.0.0.1.

## The world (`helpers.ts`), and what "another machine" is here

**Two (or three) machines are simulated on one Mac.** maya's machine is the home `<tmp>/m`: her hub runs there (`deep
hub run`, its root `<m>/.deepbuild`), with her clone of `acme/shop` (origin `https://github.com/acme/shop.git`). Every
other machine (bob's, carol's) is a separate home on the same Mac, `<tmp>/<name>`, with its own `~/.deepbuild` (the
shipped fast rules, as `deep setup` writes them) and its own clone of `acme/shop` (origin `https://github.com/acme/shop`).
It shares nothing with maya's home: its clients (`deep`, deep-hook) reach her hub only over the hub's network listener,
through **the link**, a TCP forwarder in the test process on 127.0.0.1 that can hold every chunk 100 ms each way (AC2)
and be cut: a cut link takes connections and holds them silent, passing nothing and sending no reset, as a dead network
does; restored, it carries again. The invite names the link's address, so every byte between another machine and the
hub crosses it. Same user, same kernel, same loopback: what this can't show is under Known limits.

Stand-ins for boundaries this repo doesn't own, as #1337's suite has them: the forge (`DEEP_HUB_TEST_FORGE` at a server
on 127.0.0.1 that answers 404), first on `PATH` a `gh` with no login and a `claude` and a `codex` that list no plugins;
`DEEP_HUB_TEST_CONFIRM` names a file holding `confirmed`, so a step that asks the OS to confirm the owner is confirmed.
maya's sessions are made-up Claude Code sessions whose hooks run the real deep-hook (`deep-hook claude-code <event>`,
payloads from #16's helpers).

## Surfaces this suite assumes

The issue and design name an encrypted, authenticated connection, invites, revocation, key-bound credentials, route
facts and a planted hub, but no command, method, setting, field or plant name. These are this suite's choices, each the
smallest the design and the base code imply. Each is defined once, in `helpers.ts`'s `SURFACE` (or the one helper
named), so the implementer can be told exactly what to provide. Tests assert behaviour (served or refused, exit codes,
which ports are open, what reaches the record, timings against declared values) and, where a criterion says "naming
X", only that a message contains X.

1. **Where the hub listens: `hub.listen` in `<root>/config.json`**, `{"hub": {"listen": "127.0.0.1:0"}}`: a
   `<host>:<port>`, port 0 meaning any free port. The hub listens there on its encrypted, authenticated connection only
   while it has a project member (an invited person counts from the invite); with none it listens only on its socket.
   The suite finds the port with `lsof -nP -a -p <hub and its descendants> -iTCP -sTCP:LISTEN`, never from a setting.
2. **An invite: `person.invite`**, a socket method on the owner's `cli` connection (the control token; any ask to the
   OS to confirm the owner is confirmed by `DEEP_HUB_TEST_CONFIRM`):
   `{"v":1,"id":…,"method":"person.invite","params":{"person":"bob","repo":"<absolute path of maya's clone>","address":"127.0.0.1:<port>"}}`.
   `repo` names the project as `person.add` does (#1337); `address` is where the person's machine reaches this hub,
   which the inviter knows and the hub can't (here, the link). The result is `{"invite": <a non-empty string>}`.
3. **Joining: `deep join <repo link> --invite <invite>`**, run in the joining machine's home with its clone as the
   working folder, the repo link `https://github.com/acme/shop`; exit 0. It leaves under that home's `~/.deepbuild/`
   whatever its clients need: the hub's address and identity, the credential, and the key the credential is bound to.
   (The issue routes joining through #1341's repo link; this suite calls a `join` command so it doesn't depend on
   #1341's cloning and forge reads. If the implementation joins through `deep <repo link> --invite <invite>` instead,
   only `SURFACE.join` changes.) An exit 2 or a usage message reads BLOCKED.
4. **A client's read of the project: `deep status`** on the joined machine, in its clone: it reads the project's hub over
   the network connection and lists the project's sessions as today (each by the first 8 characters of its ID), exit 0.
   Refused, it exits nonzero. (Today `status.read` is `app`/`cli` only; a person's `deep status` reads what that person
   may see, as #1337's reads do.)
5. **Keys: `~/.deepbuild/keys/`.** Every private key a client's credentials are bound to is a file in this folder under
   the client's home, and nothing else there is a key. (A key in the login Keychain would be shared by every home of
   one macOS user, so two homes could not stand for two machines.) AC5 copies everything else in `~/.deepbuild/`.
6. **Revoking: `person.revoke`**, a socket method on the owner's `cli` connection, `{"person":"bob"}`, answered by a line
   without `error`. From that answer, within 5 s, every credential of that person's is refused.
7. **Route facts: `routes.network`** in `adapters/claude-code.facts.json`, with `hookOverheadMs` (a positive number: the
   hook's wall time, spawn to exit, that the network route keeps to, measured on a link with 100 ms each way) and
   `failOpenMs` (the fail-open time on that route; read and printed, not judged, since AC2 states no bound on it).
   Absent, AC2 reads BLOCKED.
8. **deep-hook on a joined machine** (`deep-hook claude-code <event>` with that home, in its clone) sends to the
   project's hub over the network connection, and its events reach the record as today: `session` is the payload's
   `session_id`, a PreToolUse is `tool.before`. Its fast rules are that machine's `~/.deepbuild/rules.json` (the shipped
   rules here); the join needn't copy any.
9. **The plant: `DEEP_HUB_PLANT=listen-without-members`**, listed in `packages/hub/src/plant.ts` like the others: a hub
   that listens on its network listener with no project members. A hub that doesn't list it refuses to start, which
   reads BLOCKED.
10. **A stale hub's refusal names both generations:** one line of the client's output (`deep status`'s stdout or
    stderr; deep-hook's stdout, stderr or a file in its `~/.deepbuild/spool/`) holds the word `generation`, the
    generation seen (3) and the hub's (2), each as a number on its own.
11. **A key-less credential's refusal names the proof:** the refused client's stdout or stderr contains `proof`.

## How each criterion is read

- **AC1** (`revoke.test.ts`): bob's machine joins (2, 3); maya works in her clone; bob's `deep status` (4) must exit 0
  and list maya's session (the project's work is shared), over a new connection through the link. Then raw clients
  connect straight to the hub's port presenting nothing, one over plain TCP and one over TLS (no client credential, any
  server certificate), each sending a `cli` hello with no token and `events.read`, `sessions.read` and `status.read`; for
  3 s nothing either receives may contain maya's session ID, its 8-character prefix or any of its events' IDs. maya
  revokes bob (6); 5 s after the hub's answer, bob's `deep status` must exit nonzero and list none of it.
- **AC2** (`hook.test.ts`): bob's machine joins; the link holds 100 ms each way. Three runs of ten PreToolUse hooks
  (`ls`, allowed) through the real deep-hook on bob's machine; each run's p95 wall time is judged against
  `routes.network.hookOverheadMs` (7) by #16's judge: PASS when every run is within it, FAIL when every run is over it
  by more than the runs' spread (at least 5%), INCONCLUSIVE otherwise. So that a hook that sends nothing can't pass, all
  thirty must reach the record within 60 s. The guard: `no-kill-by-name`, a shipped fail_closed fast rule deep-hook
  enforces locally, its planted call `pkill -f node` and its twin `echo 'pkill -f node'` (the shipped proofs), decided
  with the link up (100 ms) and then with it cut: the planted call denied and the twin allowed both times; a failure
  names the call and both verdicts. Then the link is restored and a new session's SessionStart must reach the record.
  The timing judgment runs last, since an unclear reading ends the test INCONCLUSIVE.
- **AC3** (`generation.test.ts`): maya's own machine, her hub over its socket (the generation check is the clients', on
  any route). With the hub stopped, the record's own restore (`prepareRestore`, #572) raises it to generation 2, a copy
  is kept (the hub left behind), and a second restore raises the record to 3. The hub starts on generation 3 (its hello
  must say 3); `deep status` reads it (exit 0) and a session's hooks through deep-hook are recorded: both clients have
  seen 3. The hub restarts on the copy (its hello must say 2). `deep status` must exit nonzero, a line naming 3 and 2
  (10). A new session's SessionStart through deep-hook must not be written to that hub (after 3 s its record holds no
  event of the session), and a line of deep-hook's output or spool must name 3 and 2.
- **AC4** (`port.test.ts`): maya's hub with `hub.listen` set (1) and no members; 3 s after its ready line, neither it
  nor any process it started listens on a TCP port. Then bob is invited (2) and the same hub must open a port within
  15 s, or the test reads BLOCKED: a hub that never listens proves nothing about listening only with members. With
  `listen-without-members` (9) the same judgment must fail, naming a port lsof found.
- **AC5** (`proof.test.ts`): bob's and carol's machines join, each with its own key (5). bob's `deep status` lists maya's
  session (the control). Then carol's `~/.deepbuild` keeps only her `keys/` and gets everything else from bob's: bob's
  credential on a machine without bob's key, as a copied file would be. Its `deep status` must list none of the
  project's sessions, exit nonzero and name the proof (11).

## Known limits

- One Mac, one user, loopback: the "machines" are homes. A client that found the other home's files by path, or a
  key kept outside `~/.deepbuild/keys/`, would defeat AC5's copy; a firewall, NAT or a real network's packet loss isn't
  simulated, and the link's 100 ms is added per chunk, each way, by the test process.
- AC1 reads revocation through new connections (`deep status` runs one per call); a connection held open across the
  revocation, such as an app's stream, isn't read separately. "No data" is read over plain TCP and TLS line clients;
  a hub speaking another protocol on its port (HTTP, WebSocket) is judged only by what those clients receive.
- AC5 can't tell whether carol's client refused locally or the hub refused it; either way no data and the proof named.
- AC2's timing is the hook's wall time on this machine, under whatever load it has; a busy machine reads INCONCLUSIVE,
  never PASS. The fail-open time is printed, not judged.
- The design's Origin refusal, the threats-table rows, the client's check of the hub's identity, bounded reads and
  routes (#1573, #1575, #1576) are in the issue's Scope but no criterion; this suite doesn't read them.
- AC3 reads the generation on maya's socket route, not over the network listener.
