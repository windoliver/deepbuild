# Blind redraft of #148's Codex-daemon criterion

`AC16 #148.9536f2a1`: "With one Codex daemon serving two sessions and a sync landing after the daemon started, both
sessions' rows say the daemon started before the sync until their own evidence shows the new set; restarting it is one
authority ask naming both sessions, and nothing signals the daemon; a host that runs the restart without your answer
fails this test, naming the daemon; on the pinned Codex version, whether a running daemon picks up a changed
`hooks.json` and `[mcp_servers]` is recorded in Codex's facts with the version."

Written fresh from the criterion by a job that never saw an implementation of #148, nor `tests/acceptance/148/daemon.test.ts` (only its one-line row in 148's README table).
The implementing agent doesn't edit these files; a dispute goes to another blind redraft (AGENTS.md, Proof; design:
Dogfooding).

What was read: issue #148 (Scope's "Codex's shared daemon" line and AC16); `docs/technical-design.md` (What each agent
gives us: Codex's row; One role per credential; Dogfooding); `AGENTS.md`; `tests/acceptance/148/README.md` (The surface
under test 1–24, Plants), `helpers.ts` and `fixtures/` (`agent.mjs`, `stub.mjs`), which this file imports rather than
redefines; at the base `packages/hub/src/plant.ts`, `holds.ts` (an authority ask's options) and `status.ts` (Codex
rows' `readings`), at main `a4d2c5d4` (the suite's base `9bdebdfb` plus 13 main commits, none of #148); `codex app-server daemon --help` of the installed Codex 0.166.0-alpha.5.1 in a temp HOME.

## Run it

As `tests/acceptance/148/README.md` (Run them): Node 24.22.0, `npm ci`, `npm run build --workspaces`,
`cargo build --locked -p deep-hook`, `DEEP_CLAUDE_BIN`, `DEEP_CODEX_BIN` and `DEEP_PI_BIN` set. Then:

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/148-redraft-ac16 --no-file-parallelism --testTimeout=600000
```

Everything is under `/tmp/dh148-*` with a temp HOME; no network; processes are stopped by PID (148's `cleanup`).

## What the tests assert

`daemon.test.ts`, on a world whose `codex` command records `app-server daemon ...` instead of running it (24):

1. One daemon process (23) and two Codex sessions A and B whose hooks run under it; both get rows in `status.read`.
   Control: neither row has a reading naming the daemon's PID before any sync.
2. A server proposed for Codex alone (7) and approved (11); the sync completes.
3. Both rows get a reading naming the daemon's PID (16).
4. `agents.restart {agent: "codex"}` (13). Within 30 s an ask, other than the sync's, names A or B. 3 s later: Codex's
   restart command hasn't run, nothing signalled the daemon and it runs; exactly one such ask exists, its `kind` is
   `authority`, and it names both sessions (by ID, with or without dashes).
5. Your answer with the ask's `allow` option: the restart runs once, with the arguments `daemon.restart` in Codex's
   facts names (19); still no signal, the daemon runs.
6. A new daemon starts after the sync; A sends SessionStart (`resume`) from it (23). A's row loses the reading (no
   reading naming either daemon's PID or matching `/older/i`); B's row, still on the old daemon, keeps it.

The facts test: `daemon.restart` with `--help` runs on the real installed Codex and exits 0 (it is a command that
version has), and `daemon.picksUp["<the installed version>"]` holds booleans `"hooks.json"` and `"mcp_servers"`.

The twin runs steps 1–6 on a hub with `DEEP_HUB_PLANT=restarts-without-answer`; it must fail at step 4 with a message
naming `Codex's daemon (pid <its PID>)` and "restarted without your answer".

## Where this reads the surface differently from 148's README

- **Step 1's control** is added: a reading naming the daemon's PID before any sync would say something false under
  (16), and without the control a row that always names its daemon passes step 3.
- **Answering the restart ask**: the surface names `apply` only for a sync's ask (11). Here the option is the one whose
  `decision` is `allow`, as the base's authority asks carry it (`holds.ts`).
- **The restart's arguments** must begin with `daemon.restart`; a hub may add Codex's own options after it.
- **"Recorded with the version"** is also checked as a real command: `daemon.restart` must be one the installed Codex
  answers `--help` to. The booleans' values are not measured against a live daemon.
- **Losing the reading** also rules out a reading matching `/older/i` (9's wording for the older set), since A then runs
  the new set.
