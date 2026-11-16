# Blind redraft of #55 AC13: an answer to an idle Claude session run through paseo arrives once

A fresh run of the blind acceptance-test job (design: Dogfooding) for one criterion of issue #55, written from the
issue, `docs/technical-design.md` and base commit `1c4d1f0e2`. The implementing agent doesn't edit these files
(AGENTS.md, Proof); the first draft, `tests/acceptance/55/`, is imported and left unchanged.

> In a Claude session run through paseo that deep-hook gates, an answer to the idle session arrives by deep-hook's wake
> route or, where that route has never fired in such a session, by the plugin's prompt route on deep-hook's behalf,
> once; a session where neither fires reads "answer waiting" on its row; a plugin that delivers while deep-hook's waiter
> also fires sends the answer twice and fails this test, naming the ask

ID `#55.480a0e0c`: the first 8 hex of SHA-256 of that text, trimmed, whitespace collapsed (as `../48/README.md` computes
it); it matches the first draft's.

## What this job read

- Issue #55's body as of November 12, 2026: Scope, the 14 criteria, Proof, References, Depends on.
- `docs/technical-design.md`: Dogfooding; What each agent gives us (the paseo row, and the Claude Code row: the
  `asyncRewake` waiter, one live waiter per session, a waiter that watches its parent process); Hooks are evidence, not
  a state machine (Who is calling: one adapter owns a session, the one that bound it first; any other only relays); An
  ask, and your answer getting back. `AGENTS.md`.
- The first draft: `../55/README.md`, `env.ts`, `helpers.ts`, `delivery.test.ts`, `fixtures/paseo-host.mjs`,
  `twins.json`, `BASE-FAILURE.txt`. `../27/helpers.ts` and `../27/fixtures/claude.mjs`, whose stand-in and asking
  session this suite drives as #27's own suite does.
- At the base, for surfaces only: `packages/paseo/README.md`, `package.json` and `paseo-plugin.json`;
  `packages/hub/src/plant.ts` (that `paseo-delivers-beside-waiter` is a name `DEEP_HUB_PLANT` accepts);
  `crates/deep-hook/src/main.rs`'s `hub_plant` (an `env-plants` build reads `DEEP_HUB_PLANT`); one SDK prompt's
  transcript entry in `adapters/corpus/claude-code/2.1.299` (`promptSource: "sdk"`). The base holds #55's
  implementation (`packages/paseo/server/*`, merged before this base); none of its code was read.

## Run

```sh
npm ci && npm run build --workspaces
PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  cargo build --locked -q -p deep-hook --features env-plants
PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/55-redraft-ac13 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/55-redraft-ac13/tsconfig.json
```

- Node 24 on macOS. cargo must be on `PATH` with the same two variables as the build: `deep setup`'s entries run
  `target/debug/deep-hook`, which #27's `setup` rebuilds once per run, and a change of profile settings rebuilds it whole.
- Each test starts its own hub. Folders are `/tmp/dh55-*` (the first draft's `makeHome`), `HOME` is `<tmp>/h` for every
  process, and the real `~/.deepbuild`, `~/.paseo` and `~/.claude` are never touched. No network beyond the hub's
  socket, no model, no account, no real paseo. Processes are stopped by PID and by the process groups this suite
  started, never by name or port. Vitest writes `node_modules/.vite` here with `--root`; delete it before committing.
- `delivery.test.ts` passes on a correct program. `wrong-program.test.ts` is the wrong program's run: it must fail,
  naming the ask (Criteria, below).

## The world

Everything this repo owns runs for real: the hub (`deep hub run`, with #27's short stop hold and short ask wait),
`deep setup`'s entries in Claude Code's user settings, deep-hook and its waiter, `deep mcp`, `deep inbox answer`, and
the plugin, `packages/paseo/index.server.ts`. What it doesn't own is a stand-in:

- **Paseo's daemon** is `fixtures/daemon.mjs`: **one process that hosts the plugin and starts the agents it runs.** It
  runs the first draft's `fixtures/paseo-host.mjs` inside itself, unchanged (the plugin loaded with the
  `PluginServerContext` that file builds; hooks fired with their documented payloads; every SDK call read back), and it
  starts Claude Code as its own child when paseo opens the agent. So Claude Code, every hook it runs (deep-hook, the
  waiter) and its own `deep mcp` are in the daemon's process tree, as a real daemon's agents are. Each world checks that
  the session's live waiter is in the daemon's tree and is BLOCKED if not. Nothing here rests on a process outside that
  tree being taken as paseo's agent. Paseo disabling the plugin (`unloadPlugin`) runs the cleanup the plugin returned
  and ends it, while the daemon and the agents it runs go on.
- **Claude Code** is #27's stand-in (`../27/fixtures/claude.mjs`), driven by #27's `Claude` class through the daemon:
  it runs `deep setup`'s entries for each hook as Claude Code does, and an `asyncRewake` entry that exits 2 wakes the
  idle session with a turn of its own.
- **Paseo's view of the agent** is the first draft's `fakeAgent('claude', …)`: its snapshot's `runtimeInfo.sessionId`
  and `persistence.sessionId` are Claude Code's own session ID. Paseo fires `agent.turn.before` and `agent.turn.after`
  around each turn Claude Code runs (the first prompt's, the wake's, and in test 2 the plugin's prompt's), with the agent
  reading `running` during each and `idle` after.

**The session, in every test** (`world.ts`, `idleInPaseo`): paseo creates and opens the agent and starts Claude Code;
you type a prompt; the agent asks you a choice through `deep_ask`; its Stop's hold ends with nothing answered, so the
session is idle with deep-hook's waiter live; paseo reads the turn's end with the agent idle.

## Criteria

| ID | Criterion | Tests | Wrong program it fails on |
|----|-----------|-------|---------------------------|
| `#55.480a0e0c` AC13 | in a Claude session through paseo that deep-hook gates, an answer to the idle session arrives once, by deep-hook's wake route or, where it never fired in the session, by the plugin's prompt route on deep-hook's behalf; where neither fires, the row reads "answer waiting"; a plugin that delivers beside the waiter sends it twice and fails, naming the ask | `delivery.test.ts`: (1) the waiter live: one wake, no `send` by the plugin, one `delivered`; (2) the waiter stopped before it ever fired: one `send` carrying your answer into the idle agent (no dialog, no interrupt), one `delivered`, no wake; (3) the waiter stopped and the plugin disabled: the session's `sessions.read` row reads `answer waiting`, no wake, no `send` | `wrong-program.test.ts`: the hub with `DEEP_HUB_PLANT=paseo-delivers-beside-waiter`, test (1)'s steps, must fail at the routes assertion, "`<ask>`'s answer goes into `<session>` once, by deep-hook's waiter, and the plugin sends nothing: …", quoting what the plugin sent ("the answer went in twice" when the waiter fires too) |

## The surface

The first draft's (`../55/README.md`, The surface), unchanged; this suite reads only these parts of it:

- the plugin at `packages/paseo/index.server.ts`, loaded by paseo's daemon, registering with `server.addHook`;
- its words go in with `context.paseo.agents.ref(id).send(text, options)`, as a prompt when the agent reads `idle`,
  never into a dialog and never an interrupt;
- your answer with `deep inbox answer <ask> <option>`; the record's `delivery.outcome` events with `outcome:
  'delivered'` for the ask (`events.read`), and the session's row in `sessions.read` holding the words `answer waiting`;
- the hub's plant `paseo-delivers-beside-waiter`, named through `DEEP_HUB_PLANT` (`packages/hub/src/plant.ts`).

Invented here, on the test's side only: `fixtures/daemon.mjs` and its fd 3 protocol, which start an agent as the
daemon's child. No product surface is new.

## Readings where the criterion leaves a choice

- **"Where that route has never fired in such a session"** is a session whose waiter was live but was stopped before it
  ever fired: no wake reached the session, and none can.
- **"A session where neither fires"** adds the plugin disabled in paseo: the daemon and Claude Code go on, so the
  session is live and idle, and nothing can carry the answer in. (The first draft stopped its paseo stand-in whole; with
  Claude Code a child of the daemon, that would end the session too.)
- **"Once"** is read twice over: the agent got the answer by one route (one wake, or one `send` carrying it) and the
  record holds one `delivered` outcome for the ask.
- **"Fails this test, naming the ask"**: the wrong program is the hub's plant, as the first draft named it. With it,
  the answer goes to the plugin's prompt route while the waiter is live. Any `send` by the plugin in the wake route
  fails the routes assertion, whose message names the ask (`ask:<id>`) and quotes what the plugin sent; when the
  waiter's wake comes as well, it says the answer went in twice. The test doesn't wait for the second arrival: the
  plugin delivering beside a live waiter is the fault, and on the base the plant's waiter hadn't fired when the test
  read the routes (`BASE-RUN.txt`).

## Base run

On `1c4d1f0e2`, which holds #55's implementation: `delivery.test.ts` 3 passed; `wrong-program.test.ts` failed, as it
must, naming the ask. The record and the failure's text are in `BASE-RUN.txt`.
