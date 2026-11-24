# Blind redraft of #111's revival criterion (`#111.ddf55f68`)

> Reviving a rejected direction is stopped with the decision cited

This folder stands in for the whole of `../revive.test.ts` in the lanes, so it also covers what that file's chat test covers: a rejection read from Codex's transcript as well as Claude Code's, the assistant's same words saving no decision, a re-read saving once, and the decision covering its repo and no other.

## Inputs

- Issue #111's body as read on November 22, 2026 (`gh issue view 111`): Scope, the four criteria, Proof. No comments, linked PRs or other issues' threads.
- `docs/technical-design.md`: The learned layer, Reading by reference, Decision and rule. `AGENTS.md` (Proof).
- The base `37dd3c0c8`: `packages/hub/src/memory.ts` (`rejectedDirections`, `revives`, `captureRejected`, `syncRejected`, `covers`), `wiki-build.ts` (which transcripts `captureRejected` reads), `mcp-operations.ts` (`propose`, `ask`), `packages/record/src/learned.ts` (an assistant's line is read as `outside`), `scripts/lanes.mjs` (which block runs this folder). I read them to learn the surface shapes, where to plant the wrong programs, and how the lanes run the folder.
- This suite's inputs: `../README.md` (Invented here, items 4 to 6, which I keep as the readings), `../helpers.ts`, `../revive.test.ts` and `../redraft/` (`tool-call.test.ts`, `README.md`). Nothing in them is changed.

## How to run

From a built clone (`../README.md`, How to run):

```sh
npx vitest run tests/acceptance/111/redraft-3178/revive.test.ts --reporter=verbose
npx tsc --noEmit -p tests/acceptance/111/redraft-3178
```

**How the lanes run it.** This folder has no `lane.json`, and no entry in `scripts/lanes.mjs`'s `alone` list names it or `tests/acceptance/111/`. So the unit lane runs it in the parallel block, beside other files, as it runs `../revive.test.ts`. Each test makes its own temp HOME and starts its own hub through `deep setup`, using `../helpers.ts` and #356's and #26's helpers. Every run recorded here was this file alone, as the job's brief requires, so it has not been run beside other files. See Readings for what high load does to the deep-hook tests.

macOS only, as `../helpers.ts` is (it uses a launchd stand-in); elsewhere it's BLOCKED, never a pass.

## The surface, and what the implementation must provide

Everything goes through merged surfaces and real components, by way of `../helpers.ts`: `deep setup` reads the transcripts; suite 26's agent stand-in calls `deep_propose` and `deep_ask` over `deep mcp`; `deep inbox` and `deep inbox answer`; deep-hook's PreToolUse run as Claude Code's hook entry runs it; and `decision.created` read from the record.

- **A rejection in chat.** Your own message saying `` rejected: `kafka`. `` in a Claude Code transcript, or `` rejected: `mongodb`. `` in a Codex transcript, is saved once `deep setup` has read it. It becomes one `decision.created` by the core, whose data holds the key and whose `scope` is `repo:<project>` (`../README.md`, item 4). A second `deep setup` saves no second decision. The assistant's line `` rejected: `nats`. `` saves none.
- **A rejection by answer.** Answering a `choice` with `rest` saves a decision whose `subject` is the ask's handle (the choice has no recommendation, so the call waits for you). The other option's backticked key, `graphql`, is the rejected direction (item 6).
- **Stopped when proposed.** A `deep_propose` whose `change` names the key in backticks returns a tool error (`isError`). The reply holds that decision's `decision:<id>`, and no ask holding the proposal's marker is filed, so you aren't asked (invariant 4).
- **Stopped when run.** In the repo you rejected the key for, deep-hook denies a Bash call whose command names the key as a word, and its output holds `decision:<id>`.
- **Not over-stopped.** A direction nobody rejected (`rabbitmq`), the option you chose (`rest`), what only the assistant "rejected" (`nats`), and the rejected key in the other repo (`web`) all go through: the proposal reaches your inbox and the Bash call runs.

## Fixture

The suite's `memoryHome({ agents: ['claude'] })`: a temp HOME with Claude Code's memory file, the fake reading agent and two git repos, `api` and `web`, each given a `scripts/live.sh`. Three of the tests add two transcripts in `api`:

- A Claude Code session with your line rejecting `` `kafka` `` and the assistant's line "rejecting" `` `nats` ``.
- A Codex session with your line rejecting `` `mongodb` ``.

Marker words (`beryl`, `garnet`, `amber`, `coral`, `topaz`, `opal`, `jade`, `quartz`) tell the proposals apart in the inbox and the record.

## Criterion to tests

| # | Test (each named `#111.ddf55f68 …`) | Passes when | Fails when |
|---|---|---|---|
| 1 | an agent proposing a direction you rejected in chat is refused, citing the decision, and you aren't asked | the `rabbitmq` proposal succeeds and reaches the inbox; the `kafka` proposal is `isError`, its reply holds the decision's handle, and no inbox line or ask holds its marker | the `kafka` proposal goes through or is asked of you; the refusal names no `decision:<id>` of the saved decision; the unrelated proposal is stopped |
| 2 | an agent's tool call that revives a direction you rejected in chat is denied by deep-hook, citing the decision | `sh scripts/live.sh rabbitmq` is allowed; `sh scripts/live.sh kafka` is denied with the handle in its output | the `kafka` call runs; the denial names no handle; the unrelated call is denied |
| 3 | a direction you rejected in Codex's transcript is saved by the core for that repo, once, and reviving it is stopped citing it | one decision holds `mongodb`, written by `core` with scope `repo:…`, and still one after a second `deep setup`; proposing it is `isError` citing it with no ask; running it is denied citing it | Codex's line saves nothing, saves twice, or saves at another scope; either revival goes through or cites nothing |
| 4 | the same words from the assistant save no decision and stop nothing | no decision holds `nats`; proposing `nats` reaches the inbox; running it is allowed | the assistant's `rejected:` saves a decision, or stops a proposal or a call |
| 5 | the decision covers the repo you said it in | the decision's scope is `repo:…`; in `web`, proposing `kafka` reaches the inbox and running it is allowed | a decision for `api` stops the proposal or the call in `web` |
| 6 | the option you passed over when you answered a choice is a rejected direction | your answer saves a decision for the ask; proposing `rest` succeeds; proposing `graphql` is `isError` citing that decision, and no ask holds its marker | the `graphql` proposal goes through; the refusal cites nothing or another decision; the chosen option is stopped |

## Wrong programs (twins)

Each twin is one replacement source file under `twins/<name>/`: the base's file with the lines marked `TWIN` changed. To run one:

1. APFS-clone the built base: `cp -cR <clone> <copy>`.
2. Copy `twins/<name>/.` over the copy's root.
3. Run `npm run build -w packages/hub` in the copy. It exits 0 for every twin.
4. Run the test from the copy.

Never lay a twin over the base clone itself.

| Twin | File | Wrong program | Tests it fails |
|---|---|---|---|
| `never-stops` | `packages/hub/src/memory.ts` | nothing you rejected stops anything: `revives` finds nothing, and `syncRejected` writes no `rejected-*` guard | 1, 2, 3, 6 (each revival goes through) |
| `stops-uncited` | `packages/hub/src/memory.ts` | stops the same revivals, but neither the refusal nor the guard's reason names a decision | 1, 2, 3, 6 (each fails at its citation line) |
| `claude-only` | `packages/hub/src/wiki-build.ts` | rejections are read only from Claude Code's transcripts, not Codex's | 3 (`mongodb` saves no decision) |
| `agent-word-saves` | `packages/hub/src/memory.ts` | any speaker's `rejected:` line saves a decision, the assistant's too | 4 (`nats` is saved) |
| `stops-every-repo` | `packages/hub/src/memory.ts` | a decision for one repo covers every repo and session | 5 (the `web` proposal is refused) |

Tests 4 and 5 pass on `never-stops` and `stops-uncited`, as they should, since neither twin over-stops. All the runs are in `BASE-RESULTS.txt`.

## Readings and assumptions

- **At the base, all 6 pass.** The criterion is already built at `37dd3c0c8`, so at the base these tests are regression protection, and the twins are the wrong programs that prove the tests can fail.
- **The deep-hook tests under heavy load.** deep-hook lets a call through when the hub doesn't answer within its 50 ms ("spooled …, but its sync didn't finish within the hook's 50 ms"). At load averages around 125 to 138, that happened once in each of three runs: the base's first run (test 2), `agent-word-saves` (test 3) and `stops-uncited` (test 2). In each case a "denied" line read `allow`. A rerun of the base under the same load passed 6/6. This is the hub missing deep-hook's deadline, not a wrong verdict, but in the lanes' parallel block it can make tests 2 and 3 fail under heavy load. If that recurs, the folder needs a `lane.json` (the lanes' decision, not made here).
- **Why the choice test differs from `../revive.test.ts`'s.** That test raised the choice with `recommended: 'rest'`. At the base, a choice with a recommendation goes on provisionally at once (`mcp-operations.ts` `ask`, #84). Reading the base's source, `filedWhileWaiting` would then see the call end before it filed anything and throw; I read this but did not run it. The criterion doesn't say whether a recommendation is given, so here the choice has none and waits for your answer. The rejected option and the stop are the same either way.
- **"Cited"** means the decision's handle `decision:<id>` appears in what the agent gets back: the MCP reply, or what deep-hook prints. It doesn't have to be in a particular field. Citing the wrong decision fails, because the handle must be the one the record saved.
- **"Stopped"** means, for a proposal, refused to the agent and not asked of you; for a tool call, denied. Only Bash calls are tried. A package install (`npm install kafka`) is left out because the base holds every install as a dependency decision whatever its name (`../redraft/README.md`), which says nothing about this criterion.
- **The re-read assertion in test 3** ("saved once") has no twin of its own. A plant that saved on every read wouldn't bite, because `wiki-build.ts` reads only messages not read before.
- **Not covered here:** a longer name holding the key (in `../redraft/tool-call.test.ts`), and revoked decisions.
- **Type-check.** `tsc --noEmit -p` on this folder exits 2 with 5 errors, all in the `packages/adapters` and `packages/asks` sources, under this suite's relaxed options (`exactOptionalPropertyTypes: false`, as in `../tsconfig.json`). None are in this folder or `../helpers.ts`. `twins/` is excluded.

## Files

- `revive.test.ts`: the six tests.
- `tsconfig.json`: as `../tsconfig.json`, one level deeper; it includes `../helpers.ts` and excludes `twins/` (hub sources, built only in their copy).
- `twins/never-stops/`, `twins/stops-uncited/`, `twins/claude-only/`, `twins/agent-word-saves/`, `twins/stops-every-repo/`: the wrong programs.
- `BASE-RESULTS.txt`: the base runs, every twin run, and the type-check.
