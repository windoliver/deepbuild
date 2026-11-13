# Acceptance tests for #55: the paseo adapter (the done gate, policy answers and Needs you through paseo)

Written blind, from the issue, `docs/technical-design.md` and base commit `83e4159c`. Never edit these; a dispute goes to this job's blind redraft (design: Dogfooding).

What this job read: issue #55 (Scope, its 14 criteria, Proof, References, Depends on) as of November 3, 2026; in the design, the paseo row of "What each agent gives us, and the limits we design around", "Hooks are evidence, not a state machine" (Who is calling: one adapter owns a session; Facts as data), "Extension API (TypeScript, in-process)", the fast and slow lanes (a session run through paseo gets its verdict when it lands), Dogfooding and the trusted path; `AGENTS.md`; the suites `tests/acceptance/40` (closest analog), `23`, `26`, `18`, `27`, `29`, `48`, `875`, `906`; at base, the public surfaces of `packages/hub` (hook lines, `plant.ts`, setup and undo, the done gate's spec checks and project trust), `packages/cli`, `packages/pi`, `packages/asks`, `packages/resolver-decisions`, `packages/contracts` and `adapters/*.facts.json`; and paseo's own `public-docs/plugins/hooks.md`, `reference.md` and `providers.md` with the 0.15.0 packages `@getpaseo/cli`, `@getpaseo/plugin`, `@getpaseo/client` and `@getpaseo/protocol` (their `.d.ts`), and a real 0.15.0 daemon run in a scratch home.

## Run

```sh
npm ci && npm run build --workspaces            # the tests run the built CLI: deep hub run, deep setup, deep mcp, deep inbox
cargo build --locked -q -p deep-hook            # AC3 builds it if it's missing; #27's setup entries run it
npm i --prefix /tmp/dh55-paseo @getpaseo/cli@0.15.0
DEEP_PASEO_CLI=/tmp/dh55-paseo/node_modules/.bin/paseo DEEP_PI_CLI=<dir>/node_modules/@earendil-works/pi-coding-agent/dist/cli.js \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/55 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/55/tsconfig.json
```

- Node 24 (type stripping on), on macOS. `DEEP_PASEO_CLI` is the `paseo` command of `@getpaseo/cli` at the version `adapters/paseo.facts.json` pins; missing or another version, the real-paseo tests (AC1, AC5, AC7) read `BLOCKED`, never skip. `DEEP_PI_CLI` is real pi 1.4.0, as #40 needs it (AC12); without it AC12 reads `BLOCKED`.
- Every test starts its own hub, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (the implementer adds it). Folders are `/tmp/dh55-*`; `HOME` is `<tmp>/h` for every process, so the hub's root is `<tmp>/h/.deepbuild` and paseo's is `<tmp>/h/.paseo`; the real `~/.deepbuild`, `~/.paseo`, `~/.claude` and `~/.pi` are never touched. Each paseo daemon listens on a free port of its own with its relay off and fetches no speech model. Processes are stopped by PID and by the process groups this suite started, never by name or port.
- No network beyond 127.0.0.1, no model, no account. With `--root` here Vitest writes `tests/acceptance/55/node_modules/.vite`; delete it before committing.
- `DEEP_PASEO_PLANT=<name>` (and `DEEP_HUB_PLANT=<name>`) set by hand reach the plugin and the hub to try a wrong program.

## The worlds

Everything this repo owns runs for real: the hub (`deep hub run`), `deep setup` and `--undo`, `deep mcp`, `deep inbox answer` with #24's confirmation stub, the resolver, the done gate, deep-hook, the pi package and real pi. What it doesn't own is a stand-in:

- **A real paseo daemon** (`real.test.ts`): `paseo daemon run` 0.15.0, with `fixtures/fake-provider`, a provider plugin standing in for the agent's CLI and model. It answers each prompt with one short turn and starts each stdio MCP server its session is opened with, listing its tools into `<cwd>/.dh55-provider.jsonl`, as an agent with MCP support loads them. Checked by hand on 0.15.0: a plugin's `agent.open.before` server reaches it, and it lists `deep mcp`'s real tools.
- **Paseo around the plugin** (every other file): `fixtures/paseo-host.mjs` loads `packages/paseo/index.server.ts` in a process of its own, as paseo's daemon does, and hands it a `PluginServerContext` in the shape `@getpaseo/plugin` 0.15.0 declares, with the SDK parts the hooks page names. The test says which agents exist and how their snapshots read, fires paseo's hooks with their documented payloads, and reads back every SDK call the plugin made, each with the agent's status at the time, the dialog the words went into when one was pending, and `interrupt` when `send` came mid-turn without `activeTurnBehavior: 'steer'` (the SDK interrupts when it's left out). A real daemon can't run a Copilot, Claude or pi agent here (no account, and a plugin provider's session ID isn't the agent's own), so these are recorded-shape fakes.
- **Claude Code** is #27's stand-in with `deep setup`'s real entries and waiter (AC10, AC13), or #29's with deep-hook and a drafted definition (AC3), imported from those suites. **pi** is real pi with #40's scripted provider (AC12).
- **The fixture repo** (AC2, AC11, AC14, permissions): a git repo whose `.deepbuild/done.yaml` names one check, `cart-discount`, failing until the cart takes the discount off; trusted through Claude Code's workspace trust in `~/.claude.json`, which the hub reads as project trust.

## Criteria

| ID | Criterion | Tests | Wrong program it fails on |
|----|-----------|-------|---------------------------|
| `#55.600b9b2a` AC1 | turn end fires with the session ID on the pinned paseo; an ask in paseo's phone app | `real.test.ts` (two) | `keys-by-agent-id`; the phone half reads BLOCKED |
| `#55.44e1fa39` AC2 | a Copilot false done comes back with the failing case, verdict once | `gate.test.ts` | `drops-send-back` |
| `#55.326e394f` AC3 | a Claude session through paseo is gated exactly once | `gate.test.ts` | `keys-by-agent-id` |
| `#55.e582614a` AC4 | a request a saved decision covers is answered without reaching you, decided for you | `permissions.test.ts` | `ignores-decision` |
| `#55.1e08fb6f` AC5 | every agent paseo creates lists DeepBuild's MCP tools | `real.test.ts` | `tools-for-gated-only` |
| `#55.e7e53540` AC6 | an unsigned authority answer from paseo's app is refused naming the trusted path; the ask stays open | `permissions.test.ts` | `saves-app-answer` |
| `#55.9cef546e` AC7 | removing the plugin leaves paseo's configuration as it was | `real.test.ts` | `saves-server-in-config` |
| `#55.6be2ad60` AC8 | an ACP agent with no facts entry is watch-only, naming what it lacks; no ACP request approved by default | `permissions.test.ts` (two) | `approves-acp` |
| `#55.e30f079d` AC9 | kind `other` is never answered from a saved decision; it becomes an ask | `permissions.test.ts` | `other-as-tool` |
| `#55.dae4bb29` AC10 | Claude watched by deep-hook: one prompt, one ask and one delivery, both deep-hook's | `permissions.test.ts` | `keys-by-agent-id` |
| `#55.b7bb3861` AC11 | under 10 ms at p95 added per gated event, reference Mac, against the merge base | `budgets.test.ts` (three) | `slow-handlers` |
| `#55.da36aa35` AC12 | pi with the pi package is gated once, by the package | `gate.test.ts` | `keys-by-agent-id` |
| `#55.480a0e0c` AC13 | an answer arrives once, by deep-hook's wake or the plugin's prompt on its behalf; else "answer waiting" | `../55-redraft-ac13/` (redraft; this draft's `delivery.test.ts` was retired by the owner, Nov 12, 2026: `../55-redraft-ac13/DISPUTE.md`) | `delivers-beside-waiter` (hub) |
| `#55.9d31eef3` AC14 | a fake agent with a picker and a trust prompt while unknown gets no words, then once after idle | `gate.test.ts` | `idle-guess` |

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed (tests/acceptance/48/README.md). `twins.json` maps each to its twin under `twins/`.

## The surface (my choice)

The issue and the design name paseo's hooks, the plugin, `deep setup`, the resolver, the paseo channel and the facts, not these paths. An implementation must provide exactly these.

**Paseo's hook names.** The issue's names are paseo's old ones; 0.14 renamed them and `addHook` takes only the new ones: agent.turn_ended is `agent.turn.after` (`{agent, turnId, outcome, timeline}`), agent.permission_requested is `agent.permission.before` (`{agent, request}`, `request.kind` one of `tool`, `plan`, `question`, `mode`, `other`), and "before agent.create" is `agent.open.before`, whose `mcpServers` are launch-only (see AC7 below for why not `agent.create.before`).

**The plugin.** `packages/paseo/`, npm name `@deepbuild/paseo`, a paseo plugin directory:

- `package.json`: an exact `x.y.z` version, not private, `"type": "module"`, its files including `paseo-plugin.json`, `index.server.ts` and `server/`; no `@deepbuild/*` dependency and no runtime dependency on `@getpaseo/*` (paseo supplies its modules; types only, as dev dependencies), so `npm pack` yields what paseo installs alone.
- `paseo-plugin.json`: `"id": "deepbuild"`; `requirements.paseo` a range holding every version in the facts' `versions`.
- `index.server.ts`: its default export takes the `PluginServerContext` and returns its cleanup. Its modules live under `server/` and are imported with explicit `.ts` extensions in erasable TypeScript, with no runtime import of `@getpaseo/*`, so Node with type stripping runs it as paseo's daemon does (checked on 0.15.0: paseo loads `.ts` imports).
- `server/plant.ts`: `export const plant: string | undefined = process.env.DEEP_PASEO_PLANT || undefined;`, the one place the plugin reads its planted wrong program, so a twin can replace this file alone.
- It registers with `server.addHook`: `agent.turn.after`, `agent.permission.before`, `agent.permission.after` and `agent.open.before`; any other hook is its own business. An `agent.create.before` of its, if any, returns `config.mcpServers` unchanged.
- `agent.open.before` adds DeepBuild's MCP server to **every** agent's `request.mcpServers`, whatever its provider or facts: a stdio entry `{type: 'stdio', command, args, env?}` that runs `deep mcp`, whose `tools/list` holds at least `deep_claim`, `deep_ask`, `deep_propose` and `deep_search`. A `deep_*` call on it is bound to that agent's session (the entry's `env` may carry what binds it; the hub learns the agent's session from the plugin).
- It finds the hub as the pi package does: `<HOME>/.deepbuild/hub.sock` unless `hub.address` in `config.json` says otherwise. No new environment variable.
- **Hook lines.** It sends the hub's `hook.request` lines with `agent: 'paseo'` and `event` paseo's hook name; the hub accepts `paseo` in its adapters. Their `session_id` is **the agent's own session ID as paseo reads it for the agent**: `runtimeInfo.sessionId` of the agent's snapshot (from `context.paseo.agents.ref(id).refresh()`), else `persistence.sessionId`; never paseo's agent ID. The other fields are the implementer's.
- **Its SDK calls.** Words go in with `context.paseo.agents.ref(id).send(text, options)`: `activeTurnBehavior: 'steer'` while the agent reads `running`, a plain prompt when it reads `idle`; never an interrupt. It sends only when the agent's own snapshot reads `status: 'idle'` with no `pendingPermissions` (it may `refresh()` or `subscribe()` to learn so); never while it reads anything else or shows a dialog, and its words never answer a dialog. An answer to a permission goes with `respondToPermission({requestId, response})`.

**Facts.** `adapters/paseo.facts.json`, `agent: 'paseo'`:

- `versions`: the paseo releases covered, newest last; the newest is the pin these tests run on. This draft runs on `0.15.0`.
- `install.source`: `npm:@deepbuild/paseo@<the package's exact version>`.
- `providers`: an entry per provider the plugin gates, keyed by paseo's provider ID (`claude`, `codex`, `pi`, `copilot`, …). An ACP provider's entry, `copilot`'s at least, holds `bridge` (its pinned bridge version, an exact `x.y.z`), `permissions` (its permission quirks), `modelCheck` (the check of the exact model before the first prompt) and `timeouts`. A provider with no entry is watch-only.
- `schema`: an `adapter.facts@<n>` frozen in `packages/contracts/digests.json` that the file validates against (as #40's D2). Not tested here.

**The hub, as the tests read it** (`events.read`, `inbox.read`, `sessions.read` on a cli connection):

- The turn's end of a session the plugin owns is one `agent.stop` with `session` that session ID (also when watch-only). A session deep-hook or the pi package bound first is owned by them: the plugin's lines for it are only relayed, so the turn has no second `agent.stop`, the plugin raises no ask for it and calls no `send` or `respondToPermission` on it. Sessions match on the session ID alone, never on the provider's name.
- The done gate: a `deep_claim` through the plugin's MCP server, then the turn's end, runs the gate on that claim (the repo's spec checks); one `verdict.made` (subject or `data.claim` the claim); a FAIL goes back into the same agent through `send`, its text naming the failing check (`cart-discount`), once.
- A permission request of a session the plugin owns goes to the resolver. Covered by a saved decision: answered with `respondToPermission` allow, one `decision.applied`, nothing open for you. Not covered: an authority `ask.created` whose data names the command, whose first option allows; `deep inbox answer` with it reaches the agent through `respondToPermission`. Kind `other` is never answered from a decision and becomes an ask. No ACP agent's request is approved without the resolver or you.
- An agent whose provider has no facts entry reads watch-only: a `session.reading` for its session whose `reading` names `watch-only`, the provider ID, and `bridge`, `permissions`, `modelCheck` and `timeouts`.
- An answer from paseo's own app, which reaches the plugin as an `agent.permission.after` whose resolution the plugin didn't send, is no answer to DeepBuild's ask: no `ask.answered` or other `ask.*` closing it, no `decision.created`, its inbox row still `unanswered`, and an event about the ask (naming its handle or ID) whose text says `trusted path`.
- In a Claude session deep-hook watches inside paseo, Claude Code's `PermissionRequest` gives the one ask and deep-hook's reply carries your answer (`"behavior": "allow"`) once you give it.
- An answer for an idle Claude session deep-hook gates goes by deep-hook's waiter while it is live; where it never fired in the session, the hub hands it to the plugin, which prompts the session once; where neither route can, the session's `sessions.read` row holds the words `answer waiting`.

**Setup.** `deep setup`, with `paseo` on the login PATH and its daemon running, installs the plugin through paseo's own manager from the facts' `install.source` (an npm registry the daemon's npm reaches), as plugin `deepbuild`, at that exact version, turning paseo's plugins on if they're off. `deep setup --undo` removes it and leaves `<HOME>/.paseo/config.json` byte for byte as it was before setup (paseo's own `plugin remove` rewrites the file, so undo puts the original bytes back as it does for Claude Code's files), with no DeepBuild server in any agent's saved configuration.

**The budget.** `benchmarks/paseo-plugin.mjs` exits 0. `benchmarks/budgets.json` has a task whose `command` includes it and whose `initialReason` names `#55`; `validateBudgets` accepts it against the merge base.

**Plants.** `DEEP_PASEO_PLANT`, read through `packages/paseo/server/plant.ts`, set only by the wrong-program runs; unset, it changes nothing. One plant lives at the hub, under `DEEP_HUB_PLANT` in `packages/hub/src/plant.ts` as the hub's others do.

| Value | The wrong program |
|-------|-------------------|
| `keys-by-agent-id` | sessions keyed by paseo's agent ID, not the agent's own session ID, so a session deep-hook or the pi package gates is gated again under a second ID |
| `drops-send-back` | the hub's send-back for an owned session never reaches the agent |
| `ignores-decision` | a request the hub answered from a decision is never answered in paseo |
| `tools-for-gated-only` | DeepBuild's MCP server added only to agents of providers the facts gate |
| `saves-app-answer` | an answer from paseo's app relayed to the open ask as yours, through the CLI's answer |
| `saves-server-in-config` | the MCP server added in `agent.create.before`, into the agent's saved configuration |
| `approves-acp` | an ACP agent's requests approved by the plugin itself |
| `other-as-tool` | a request of kind `other` sent to the hub as kind `tool` |
| `slow-handlers` | each handler held 20 ms longer before it returns |
| `idle-guess` | a session taken as idle once its turn ended, without reading the agent's own status |
| `paseo-delivers-beside-waiter` (hub) | an answer handed to the plugin's prompt route while deep-hook's waiter for the session is live |

Each twin replaces its plant file whole with the name fixed; the hub's twin is base's `plant.ts` with `plantOf` and `activePlant` fixed, and must keep the real file's exports when it runs.

## Timing

AC11 follows #40's rule: off a reference Mac in a fit state the readings are printed and the test reads INCONCLUSIVE, never PASS; on one, a p95 under 10 ms passes, and one over it fails unless the load is past the core count, which reads INCONCLUSIVE. The number is the time the plugin's handlers hold each gated event where paseo calls them (40 turn ends of an owned Copilot session and 40 permission requests a saved decision answers, after 3 warm-up rounds). The merge base has no plugin, so all of it is added; the perf lane's task is the comparison with the merge base.

## Readings where the issue leaves a choice

- **"The session id this task reads"** is the agent's `runtimeInfo.sessionId` as paseo keeps it for the agent (its saved file, its snapshot). On a real daemon the stand-in is a plugin provider, whose ID paseo makes `plugin:{…}`; the test compares it as it is.
- **"An ask shows in paseo's phone app"** needs a paired phone and #65's channel; no test can look at a phone, so it reads BLOCKED naming both, as the criterion says.
- **"Removing the plugin"** is `deep setup --undo`, DeepBuild's own removal; paseo's `plugin remove` alone can't leave `config.json` byte for byte (checked on 0.15.0: it reorders keys).
- **"Before paseo's agent.create"** is `agent.open.before`: paseo saves what `agent.create.before` changes, and it stays after the plugin is removed (hooks.md), which AC7 forbids.
- **AC2's claim** is `deep_claim` through the plugin's MCP server, the tool the issue names for agents with no hooks; the gate's checks are the repo's spec. A Copilot session has no hooks to say what it edited, so the test doesn't rely on the plugin reading paseo's timeline (it holds the edit anyway).
- **AC3** uses #29's drafted task, so the Claude session's own stop makes the claim; the plugin's twin would make a second.
- **AC10** reads "one ask and one delivery, both by deep-hook" as deep-hook filing the ask from Claude Code's `PermissionRequest` and its reply carrying your yes. #23's and #18's suites leave a prompt no decision covers to Claude Code's own terminal dialog; inside paseo there is no such dialog to draw. If that can't hold, it is this suite's first candidate for a redraft.
- **AC13**'s "where that route has never fired in such a session" is a session whose waiter was stopped before it ever fired; "neither fires" adds the plugin gone (paseo's daemon away).
- **AC14**'s "reads unknown" is an agent whose snapshot reads `initializing`, neither idle nor running, with a model picker (`question`) and a folder-trust prompt (`other`) pending; the words are the false done's FAIL. The person closes both in paseo's app and the snapshot reads `idle`.
- **AC6**'s "the trusted path" is the design's: the app, the CLI once the OS confirms you, or a paired phone that signs; the refusal must say `trusted path`.
- **AC8**'s "says which facts it lacks" names the four fields the Scope lists, by the facts keys above.
- **AC12** asserts the plugin's part (no ask, no delivery) and one stop per turn; pi itself raises no permission prompt, so "twice" shows as a second stop or an ask the plugin filed.

## Disputes

**D1, upheld (the environment).** `helpers.ts` and `gate.test.ts` import `../29/h-d.ts`, which imports `../29/helpers.ts`, and that file deletes every `CLAUDE*` and `DEEP_*` variable from `process.env` as it loads. So `DEEP_PASEO_CLI`, `DEEP_PI_CLI`, `DEEP_PASEO_PLANT` and `DEEP_HUB_PLANT` never reached a test: AC1, AC5 and AC7 read `BLOCKED: no real paseo … (got nothing)` and AC12 `BLOCKED: no real pi … (got nothing)` whatever was built, and the hand-run plants did nothing. The redraft adds `env.ts`, the first import of every file in the suite, which reads those four variables before `../29` loads. This suite's own readers (`paseoCli`, the paseo stand-in's and the daemon's `DEEP_PASEO_PLANT`, the budget command's environment) take them from it, and `helpers.ts` puts them back into `process.env` once its imports have loaded, for the imported helpers that read `process.env` when called (#40's `piCli`, #27's `childEnv` for `DEEP_HUB_PLANT`). Suites 27, 29 and 40 are unchanged, and no test asserts anything new. Checked with a throwaway probe importing `../27`, `../29/h-d.ts` and `../40` in the order the test files do: all four variables reached their readers, pi 1.4.0 from `DEEP_PI_CLI` included. AC5 and AC12 now stop only at the missing plugin, which they check before the environment.

## How far these tests were checked

Type-checked with this tsconfig. Run on base: all 20 tests fail, each for the missing plugin or facts or the missing budget task, and the phone half BLOCKED (`BASE-FAILURE.txt`). Checked by hand on a real paseo 0.15.0 daemon in a scratch home: plugin install and `plugin ls --json`, `paseo run --json`, the saved agent file with `runtimeInfo.sessionId`, `agent.turn.after` and `agent.open.before` reaching a plugin, the stand-in provider listing `deep mcp`'s real tools from a server a plugin added, and that `plugin install`/`remove` rewrites `config.json`. `fixtures/paseo-host.mjs` was run against a throwaway plugin. Never run against an implementation, because none exists: every scenario past loading the plugin, and the twins.
