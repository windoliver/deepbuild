# docs-data: findings

Area: `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `LICENSE`, `docs/`, `adapters/`, `packs/`, `spikes/`,
`brand/`, `skills/`, `reports/`, `vendor/` (structure only). Checkout
`the checkout` at 06fd33cd. Read-only; nothing was built or run.

Paths below are relative to that checkout.

## Findings, worst first

### DOCS-DATA-1  Loop facts stop at Codex 0.163, so the newest covered Codex (0.166.0-alpha.5.1, the Codex app's CLI) has its goals and heartbeats left unread
- kind: inconsistent
- confidence: LIKELY
- where: `adapters/loops.facts.json:14`; `adapters/codex.facts.json:3`; `packages/hub/src/codex-loops.ts:179`; `packages/hub/src/core.ts:5107`
- evidence: `loops.facts.json:14` has `"versions": ["0.144.0", "0.160.0", "0.163.0-alpha.10.2"]`. `codex.facts.json:3` has
  `"versions": ["0.144.0", "0.160.0", "0.163.0-alpha.10.2", "0.166.0-alpha.5.1"]`. The fourth version was added by 7c77a734
  (Nov 3, "Codex facts cover 0.166.0-alpha.5.1, the Codex app's bundled CLI"), which touched `codex.facts.json` and the corpus
  only; `loops.facts.json` was last given versions by 7b532e45 (Oct 30). The hub reads it at `codex-loops.ts:179`
  (`loopsCovered = (version) => facts().versions.includes(version)`) and `core.ts:5107`
  (`read.version && !loopsCovered(read.version) && coveredBy('codex', read.version) ? [uncoveredLoops(read.version)] : read.readings`).
  Greps: `loopsCovered`, `uncoveredLoops`, `past the loop facts` over `packages`, `tests`, `scripts`: no test asserts the
  version list (tests/acceptance/997 and 907 read other keys; `tests/facts-entry.test.mjs:37` only compares the file with itself).
- failure: a Codex session on 0.166.0-alpha.5.1 (covered by the adapter facts, so not watch-only) gets the one reading
  `Codex 0.166.0-alpha.5.1 is past the loop facts: its goals and heartbeats aren't read, so its loops are left to the grace window`
  in place of its real goal and heartbeat readings, so a goal that continues or a heartbeat that is due is not seen.
- fix: `adapters/loops.facts.json:14` `"versions": ["0.144.0", "0.160.0", "0.163.0-alpha.10.2"],` →
  `"versions": ["0.144.0", "0.160.0", "0.163.0-alpha.10.2", "0.166.0-alpha.5.1"],`
- verify: `rg '"versions"' adapters/loops.facts.json adapters/codex.facts.json` shows the same four; the corpus already holds
  `adapters/corpus/codex/0.166.0-alpha.5.1/goal/` for a replay through the hub's #39 suite (`tests/acceptance/39/`).
- risk: widening says the goal record (`goals_1.sqlite`, `thread_goals`) and `automation.toml` have the same shape on 0.166; the
  commit that added 0.166 says its hook field lists equal 0.163's but did not check the goal store. If that was the reason
  it was left out, this is a QUESTION for the owner, not an edit. No test pins the three-version list.

### DOCS-DATA-2  README's preflight paragraph is two rules behind: five lanes named where there are twenty, and a five-minute budget that is fifteen
- kind: inconsistent
- confidence: SURE
- where: `README.md:66-71`; `scripts/lanes.mjs:268-346`; `scripts/preflight.mjs:44-46,61`; `benchmarks/budgets.json:9,12`
- evidence: README: "Its lanes are `typecheck`, `lint`, `unit`, `parity quick` and `perf`. … The checks with their builds must
  finish in under five minutes." `lanes.mjs` `checks` names 20 lanes: typecheck, lint, unit, contracts, interfaces, noop, seams,
  relay, wasm32, catalogue drift, design links and names, public text, plain words, corpus, motion, canvas kit, parity quick,
  proof, verdict proofs, config eval; `preflight.mjs` adds perf and (with a harness budget) harness budgets.
  `budgets.json:9` is `"elapsedMs": 900000`, and line 12 says "Raised from 300 s to 900 s on 2026-10-22". `preflight.mjs:61`
  prints the budget from that file. No test reads the README's wording (`rg "five minutes|parity quick" tests scripts`: only
  budgets.json's own history and lanes.mjs).
- failure: a contributor following the README expects five lanes and a five-minute run, and reads a 10-minute run with 20 lanes
  as broken.
- fix: `README.md:68-71` replace
  "Its lanes are `typecheck`, `lint`, `unit`, `parity quick` and\n`perf`. A failed lane reports its first error and a fix, later lanes still run,\nand `perf` is `BLOCKED` when they fail. The checks with their builds must finish\nin under five minutes."
  → "Its lanes are the `checks` list in `scripts/lanes.mjs`, from `typecheck`, `lint` and `unit` to `parity quick` and `proof`, then `perf`. A failed lane reports its first error and a fix, later lanes still run, and `perf` is `BLOCKED` when they fail. The checks with their builds must finish within the `preflight` budget in `benchmarks/budgets.json`, 15 minutes today."
- verify: `rg -n "five minutes" README.md` returns nothing; `rg -n '"elapsedMs": 900000' benchmarks/budgets.json` still matches.
- risk: none to code. `scripts/install-prefix.mjs:46` and `scripts/release-stage.mjs:118` copy README.md whole and read no text in it.

### DOCS-DATA-3  The design says `node:sqlite` waits until it is stable and that contracts are checked by Ajv; the code imports `node:sqlite` in three packages and has no Ajv
- kind: inconsistent
- confidence: SURE that the two sides differ; QUESTION which side moves
- where: `docs/technical-design.md:2542` (Libraries), `:883`; `packages/hub/src/codex-loops.ts:10`; `packages/checks-numbers/src/kit.ts:8`; `packages/checks-work/src/kit.ts:12`; `packages/cli/src/main.ts:12`; `packages/contracts/src/validate.ts`
- evidence: design 2542: "**Libraries:** better-sqlite3 behind a small storage interface, Ajv with JSON Schemas as the source of
  every contract … `node:sqlite` is still only a release candidate, from Node 24.15, so it waits until it is stable. … contracts
  (JSON Schema and Ajv)"; 883: "So what Ajv accepts, both languages' types can hold."
  Code: `import { DatabaseSync } from 'node:sqlite';` at the three source lines above, and `main.ts:12` explains the Node floor by
  it ("an older Node loads node:sqlite as experimental"). `rg -i '"ajv' package.json packages/*/package.json scripts/repo-rules.json`:
  no hit; `rg -i "from 'ajv" packages scripts`: no hit. The validator is the project's own `packages/contracts/src/validate.ts`.
  The only `ajv` import in the checkout is `tests/acceptance/39/replies.test.ts:4`, which resolves through a transitive copy
  (`package-lock.json:2114`, under `@microsoft/tsdoc-config`), not a declared dependency.
- failure: a reader (or a blind acceptance job, which sees only the issue and the design) takes Ajv as the validator and
  `node:sqlite` as off limits; #39's blind suite already imports `ajv` on the design's word.
- fix (doc side, if the code is what is meant): in `docs/technical-design.md:2542` "Ajv with JSON Schemas as the source of every contract" →
  "JSON Schemas as the source of every contract, checked by the contracts package's own validator"; "`node:sqlite` is still only a
  release candidate, from Node 24.15, so it waits until it is stable." → "The record stays on better-sqlite3; `node:sqlite`, which
  the Node 24.22 floor loads without the experimental warning (`packages/cli/src/main.ts:12`), reads other tools' databases
  (Codex's goal store, a check kit's fixtures)." (Node's own release notes were not checked; the wording follows that code comment.); "contracts (JSON Schema and
  Ajv)" → "contracts (JSON Schema)". And 883 "what Ajv accepts" → "what the validator accepts".
- verify: `rg -n "Ajv|release candidate" docs/technical-design.md` returns nothing; the design-links lane still passes (no heading changed).
- risk: the design is edited "like code" and a blind suite (#39) was written from the Ajv wording; changing the words does not
  break that test, but it should then get `ajv` as a listed dev dependency or keep resolving transitively. The owner decides the side.

### DOCS-DATA-4  Codex facts map `SessionEnd` but no version's payload list has it, so the mapping can never fire while setup installs the hook
- kind: inconsistent
- confidence: LIKELY (the gap is admitted in a code comment; whether it is still wanted is the question)
- where: `adapters/codex.facts.json:837` (`mapping.SessionEnd`), `events.versions.*` (no `SessionEnd` key in any of the four);
  `adapters/index.mjs:238`; `packages/hub/src/codex-settings.ts:25`; `adapters/codex-schemas/session-end.command.input.schema.json`;
  `packages/adapters/src/index.ts:43-45`
- evidence: `index.mjs:238`: `if (typeof hook !== 'string' || !Object.hasOwn(schemas, hook) || !Object.hasOwn(facts.mapping, hook)) return { events: [], verified: false, readings: [{ code: 'unknown_event', … }] }`.
  Codex's four version lists hold SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop, SubagentStart,
  SubagentStop, PreCompact, PostCompact (and Interrupt from 0.160.0); none holds SessionEnd. `codex-settings.ts:25` installs a
  `SessionEnd` hook entry, and Codex's published schema for it is vendored (`session-end.command.input.schema.json`, tag
  rust-v0.160.0 per `codex-schemas/NOTICE`). `packages/adapters/src/index.ts:45` says "which needs the facts to list the agent's
  SessionEnd (Codex's facts don't yet, #47)"; #47 is open. `rg SessionEnd adapters/corpus/codex`: no recorded payload.
- failure: a Codex `SessionEnd` payload maps to no `session.end` event and an `unknown_event` reading, and the adapter's
  per-session turn set (`turnsBySession`, same file) is never dropped for Codex sessions.
- fix: add the `SessionEnd` field list to each `events.versions.<v>` that has the hook, derived from the vendored schema, with a
  recorded corpus payload (the corpus lane wants every listed event recorded). That is #47's work, not a hand edit; listed here
  so the dead mapping entry is not read as live.
- verify: `node scripts/corpus.mjs check` (lane `corpus`) after the list and a recording land.
- risk: `scripts/corpus.mjs check` fails a version that lists an event with no recording, so the facts cannot change alone.

### DOCS-DATA-5  `docs/spikes/1550/` holds two card images nothing reads, for an issue that is closed
- kind: unneeded
- confidence: LIKELY
- where: `docs/spikes/1550/card-arabic.png`, `docs/spikes/1550/card-chinese.png` (304 KB)
- evidence: added by 8dea5dd5 (Nov 8, "#1550: the C5 check run's Arabic and Chinese question cards, for the taste call").
  `rg "card-arabic|card-chinese|spikes/1550"` over the whole checkout (packages, crates, scripts, tests, benchmarks, docs,
  adapters, packs, vendor): no hit. `tests/acceptance/1550/` reads neither. `gh issue view 1550`: CLOSED. Every other
  `docs/spikes/<n>/` and `spikes/<n>/` folder is read by an acceptance suite, a crate test, `benchmarks/budgets.json` or a facts file.
- failure: n/a; proof nothing uses it is the grep above.
- fix: `git rm -r docs/spikes/1550` (or move the two files to `docs/evidence/1550/` if the taste call's record should keep them).
- verify: `rg "spikes/1550"` stays empty; `node scripts/repo-rules.mjs` unaffected (no rule names the folder).
- risk: the PR or the issue comment for #1550 may link the two images by path on main; a link there would break. Not checked.

### DOCS-DATA-6  `vendor/gpui-pre-apple/upstream/` still carries the patch series and "how to open the PR" steps for an upstream offer that was closed unmerged
- kind: unneeded / inconsistent
- confidence: QUESTION
- where: `vendor/gpui-pre-apple/upstream/README.md:3` against `:73-156`; `0001-…patch` (24.9 KB), `0002-…patch` (8.1 KB), `PR-DESCRIPTION.md` (3.1 KB)
- evidence: line 3: "Zed closed our pull request unmerged on October 28, 2026 … So nothing here has an end date: every change
  below is ours to carry". Lines 73-156 ("What was offered upstream (#711)") still read as a live offer: "The pull request was
  opened from the owner's fork, with the CLA signed", then "How it was opened, for a redo on a new base", ending "Then on
  windoliver/deepbuild#711: paste the PR link under criterion 1." #711 is CLOSED. `rg "PR-DESCRIPTION|0001-gpui_apple|0002-"`
  outside that README: no hit; `scripts/vendor-rebase.mjs` reads only the table (`TABLE`, line 13) and `scripts/proof-guard.mjs:32`
  the same file's table.
- failure: n/a. The two patches are rebased on zed `08cbb88` (Oct 25) and will not apply to a later base without the redo the
  README describes.
- fix: either delete the three files and cut `README.md:73-156` to two lines naming the closed PR, or leave them as the record of
  what was offered. Owner's call.
- verify: `node scripts/vendor-rebase.mjs check` (lint lane) still passes: it reads the table above line 73 only.
- risk: `README.md` is on the proof guard's list (`proof-guard.mjs:32`), so an edit to it may need a signed approval tag.

## Nits (one line each)

- `adapters/paseo.facts.json` `errorTexts.conformance` is `"pi/errorTexts/unknown-otherwise"`; every other paseo section is `paseo/…`. A label only (the kit resolves case names for operations alone, `packages/conformance/src/runner.ts:202`), but `packages/contracts/fixtures/adapter.facts@3/01.json:67` holds the same copy.
- `adapters/index.mjs:2` and `packages/adapters/src/index.ts:1,85` say `adapter.facts@1`; the four files are `@5`, `@4`, `@3`, `@2` and `index.ts:86` accepts only 2 to 5.
- `adapters/mcp-servers.facts.json` `readBy` lists the effect classes as "push, merge, dispatch, send or delete"; `create_pull_request` has `"effect": "pr"`, which `packages/hub/src/wire.ts:176` does type (`'push' | 'pr' | 'merge'`). The sentence lacks `pr`.
- `adapters/index.d.mts:9-10`: `mapHook` takes `transcript?: readonly Record<…>[]`, `replaySession` a mutable one; neither function writes it.
- `docs/parallel-proof.md:42,115` call the throttle class `bay pair`; the word the code takes is `bay-pair` (`scripts/throttle.mjs:14`). Only `bays.mjs` calls it, so nobody types it, but the doc's `throttle.mjs <class>` usage line with the table's name would be refused.
- `docs/parallel-proof.md:164` names `scripts/lane-remote.mjs` (T7, #1122 open): planned, not missing by mistake. Lines 17-21, 238 keep "26 packages" and "27 crates" as the dated baseline; the checkout has 36 and 39.
- `docs/parallel-proof.md:252,267`: the crontab lines `cd ~/doneright`. That is the owner's checkout path, a right `doneright`, but the README's clone is `deepbuild`; a reader copying the line gets a missing folder.
- `README.md:58-59` names `deep status`, `deep inbox` and `deep setup` as what first sets DeepBuild up; `packages/cli/src/main.ts:287` also runs setup for `secret`, `off`, `on`, `env`, `install`, `guard` and `memory`. And `main.ts:189`'s help line says setup installs "for Claude Code" where the README (and `codex-settings.ts`) add Codex.
- `packs/studio-1.0.0/` is named as a pack and has no `pack.json`; its four looks are read only by a unit test (`crates/deep-canvas-scene3d/src/look.rs:237-254`, `include_str!`). The other seven pack folders match their manifests file for file (checked both ways) and each alias targets a listed recipe.
- `brand/README.md` "Which file where" lists no row for `png/symbol-ink-512.png`, `png/symbol-color-dark-512.png`, `png/lockup-horizontal-ink-1200.png`, `png/lockup-horizontal-color-dark-1200.png`, `png/favicon-16.png`, `png/favicon-48.png`, all written by `render_png.py`.
- Spikes live in two homes: `spikes/{80,1330,hub-core}` and `docs/spikes/{21,337,338,339,358,402,573,1477,1550}`.

## More findings (written later; severity order over the whole file: 7, 1, 2, 8, 3, 4, 9, 10, 5, 11, 6)

### DOCS-DATA-7  The two main facts files name an MCP call's tool under different keys, and the hub reads only Claude Code's: every Codex MCP call is recorded and classed under its full `mcp__server__tool` name
- kind: broken (cross-area: the facts disagree here, the wrong read is in `packages/hub`)
- confidence: LIKELY
- where: `adapters/claude-code.facts.json:1028` (`"mcp": { "tool": "tool" }`); `adapters/codex.facts.json:893-897` (no `toolDetail.mcp`);
  `adapters/index.mjs:81`; `packages/hub/src/hookmap.ts:322-324`; `packages/hub/src/mcp-servers.ts:72-86`;
  `packages/hub/src/core.ts:371,374,1916,3265`; `adapters/corpus/README.md:34`
- evidence: `index.mjs:81`: `detail: { server, [facts.toolDetail?.mcp?.tool ?? 'name']: name.join('__') }`. With Claude Code's facts the bare
  name overwrites `tool`; with Codex's it goes under `name` and `tool` stays the payload's `tool_name`. The corpus pins both shapes:
  Claude Code `{"tool":"ask_name","kind":"mcp","server":"corpus"}`, Codex
  `{"tool":"mcp__deep__deep_ask","kind":"mcp","server":"deep","name":"deep_ask"}`.
  `hookmap.ts:322`: `const named = str(call.tool) || str(call.name) || tool || 'unknown';` so for Codex `named` is
  `mcp__deep__deep_ask`, written as the event's `tool` (line 323) and passed to `countMcp(server, named, …)` (line 324).
  `mcp-servers.ts:86`: `if (hints.destructiveHint === true || tool.startsWith('delete_')) counted.counts = 'destructive';` and lines 74, 82
  look `tool` up by bare name in the recorded tool list and your decisions. `core.ts:371`:
  ``tools.get(`mcp__${String(d.server)}__${String(d.tool)}`) ?? d.counts`` and `:1916`, `:3265` build the same string.
  No test drives a Codex MCP call through the hub and reads the event's `tool` (`rg "mcp__" tests/acceptance/39 packages/hub/test`:
  only the PreToolUse sender in `tests/acceptance/39/helpers.ts:364`).
- failure: a Codex session calls `mcp__forge__delete_branch`. The hub records `tool: "mcp__forge__delete_branch"`, `countMcp` tests
  `"mcp__forge__delete_branch".startsWith('delete_')` (false) and counts it `change`, where the same call from Claude Code counts
  `destructive`. A class you set in `rules.json` (`"classes": {"mcp__slack__post_message": "send"}`) is looked up as
  `mcp__slack__mcp__slack__post_message` and missed, so the call is not a send; a saved decision or a tool-list hint keyed by the bare
  name is missed the same way. The label on the page reads `forge mcp__forge__delete_branch`.
- fix (smallest, in the hub): `packages/hub/src/hookmap.ts:322`
  `const named = str(call.tool) || str(call.name) || tool || 'unknown';` → `const named = str(call.name) || str(call.tool) || tool || 'unknown';`
  (Claude Code's mapped call has no `name`, so it keeps `call.tool`; Codex's bare name is in `call.name`.) The other way, adding
  `"mcp": { "tool": "tool" }` to `codex.facts.json`, changes the adapter's events and breaks the Codex corpus sets' `expect`, which are reviewed test data.
  Also `adapters/corpus/README.md:34` "an `mcp` call adds `server` and `name`" → "an `mcp` call adds `server`, and its tool's own name under `name` (Codex) or in place of `tool` (Claude Code)".
- verify: a hub test that sends a Codex `PreToolUse` with `tool_name: 'mcp__forge__delete_branch'` and reads the recorded `tool.before`:
  `tool` is `delete_branch` and `counts` is `destructive` after the fix; before it, `mcp__forge__delete_branch` and `change`.
  `tests/acceptance/304/classes.test.ts` (Claude Code's classes) must stay green.
- risk: readers of recorded Codex events that learned the long `tool` (none found by `rg "d\.tool|data\.tool" packages/hub/src` beyond the
  lines above, which all assume the bare name). Old records keep the long name. The hub's owner should confirm before the edit.

### DOCS-DATA-8  README says `npm run build` builds the `deep-hook` binary; it builds all 39 crates
- kind: inconsistent
- confidence: SURE
- where: `README.md:53-54`; `package.json:17`
- evidence: README: "`npm run build` compiles the TypeScript workspaces and the `crates/deep-hook` binary". `package.json:17`:
  `"build": "npm run build --workspaces && cargo build --workspace --locked"`. `Cargo.toml` lists 39 workspace members, the app, the replica and the GPU crates among them.
- failure: a first clone on a Mac without the Metal toolchain, or on Linux, fails or runs many minutes in a step the README describes as one small binary.
- fix: `README.md:53-54` "compiles the TypeScript workspaces and the `crates/deep-hook`\nbinary" → "compiles the TypeScript workspaces and every Rust crate, `deep-hook` and the app among them".
- verify: read `package.json:17` beside the sentence.
- risk: none.

### DOCS-DATA-9  The design says a planted wrong program "is never chosen by an environment variable"; the shipped TypeScript reads `DEEP_HUB_PLANT`, `DEEP_CLI_PLANT` and `DEEP_PI_PLANT` at run time
- kind: inconsistent (doc against code; the plants themselves are test seams and are in use)
- confidence: QUESTION
- where: `docs/technical-design.md:2608`; `packages/hub/src/server.ts:1432`; `packages/hub/src/plant.ts:291,330`; `packages/cli/src/main.ts:137`; `packages/pi/src/index.ts:23`; `scripts/plant-lint.mjs:1-11`
- evidence: design: "A planted wrong program lives in test code, or behind a build feature a release build refuses to compile, and is never
  chosen by an environment variable, so nothing outside a check can bend a shipped program." #1408 (closed) moved the Rust reads behind
  features, and `plant-lint.mjs` holds only `crates/deep-app/src` to it (`const SOURCE = 'crates/deep-app/src'`). The hub
  (`const plant = plantOf(process.env.DEEP_HUB_PLANT)`), the CLI (`process.env.DEEP_CLI_PLANT === 'bundle-raw-logs' || activePlant() === 'bundle-raw-logs'`,
  which turns the debug bundle's scrub off) and the pi package still read theirs in the code that ships; JavaScript has no build feature to hide them behind.
- failure: `DEEP_CLI_PLANT=bundle-raw-logs deep debug bundle`, run by anything in a shell, writes the bundle with its logs unscrubbed. That is the
  case the design sentence says cannot happen.
- fix: owner's call: either the design sentence gains "in the Rust binaries; the TypeScript packages read theirs from the environment until …" with
  the issue that closes it, or the TypeScript plants move behind something a release strips (`scripts/release-stage.mjs` copies `packages/*/dist` whole today).
- verify: n/a until decided.
- risk: every blind suite that sets `DEEP_HUB_PLANT` depends on the variable; nothing here should be removed.

### DOCS-DATA-10  `.deepbuild/approvers` is on no ref, so on main today no `deep/approved/` tag approves anything
- kind: inconsistent (state against README and design)
- confidence: QUESTION
- where: `README.md:131-147`; `docs/technical-design.md:2609`; `scripts/proof-change.mjs:248,306,333`
- evidence: `git ls-files .deepbuild` → `done.yaml`, `rules.json` only; `git log --all -- .deepbuild/approvers` → nothing.
  `proof-change.mjs:306`: `const listed = signersIn(show(root, change.base, APPROVERS));` and `:333`:
  `if (listed.length) read(people, 'refs/tags/deep/approved/', () => true, true);`. With no list at the merge base, `listed` is empty and
  the tags are not read at all. The rule landed today (61e13a68, "Approvers live in the repo and out of agents' reach (#1326)").
  README: "The first list lands on the default branch by your own push."
- failure: until the owner pushes the first list, any change to a guarded file (`scripts/lanes.mjs`, the vendored README's budgets, a tagged test)
  fails the guard whatever tag it carries. Fixes from this audit that touch guarded files cannot be approved before that.
- fix: none for an agent. The owner adds `.deepbuild/approvers` with a security-key line and pushes it, as `README.md:137-140` shows.
- verify: `git show origin/main:.deepbuild/approvers` prints a line.
- risk: n/a.

### DOCS-DATA-11  `docs/evidence/modularity-audit.md` is a Nov 4 working log that today's `reports/package-modularity-audit.md` replaces, and the only evidence file outside an issue folder
- kind: unneeded
- confidence: QUESTION
- where: `docs/evidence/modularity-audit.md` (142 lines); `reports/package-modularity-audit.md`, `reports/package-deep-audit.md`
- evidence: its title is "Modularity audit — partial implementation, not closed", with sections "Current test correction request", "Further
  implementation progress — not yet verified", "Latest cold-workspace verification attempt — still blocked", and it counts "all 30 package `dist`
  directories" (36 today). `rg "modularity-audit"` outside `reports/` and the file itself: no hit. The two files under `reports/` (PRs #1775, #1909) are the finished audits.
- failure: n/a; nothing reads it.
- fix: `git rm docs/evidence/modularity-audit.md`, or move it under the issue it served.
- verify: `rg "evidence/modularity-audit"` stays empty.
- risk: a PR body may link it by path. Not checked.

## `docs/evidence`: structure

- 453 tracked files, 114 MB, in 81 numbered folders (the issue number) and one loose file (DOCS-DATA-11). 243 PNG, 35 JPG, 29 APNG, 1 MP4,
  61 TXT, 40 JSON, 24 MD, and 16 scripts or sources.
- Read by tests or scripts (30 folders), so in use: 79 (`brand/surfaces.json`, `tests/acceptance/79`), 148
  (`scripts/agents-page-shots/shots.test.ts`), 149, 167, 268, 366 (recorded packages the #366 suite replays), 419, 425, 427, 428, 430, 446, 467, 484,
  492 to 496, 499, 994, 1002, 1003, 1162 (`scripts/checkpoint-1162-shots.mjs`), 1330 (`spikes/1330/README.md`), 1336, 1352, 1436, 1479, 1523. Most are a
  taste test's shots, checked by hash (`tests/acceptance/<n>/taste.test.ts`, `const SHOTS = join(REPO, 'docs', 'evidence', '<n>')`).
- Carry their own writer, so they can be made again: 160 (`shots.mjs`), 492 to 496 (`shoot.mjs`), 1022 (`live-compact.py`), 1118 (`npm-shim.sh`),
  1501 (`e2e.mts`), 1640 (`render.py`).
- Named by nothing in the tree (51 folders): 45, 46, 69, 120, 124, 160, 166, 252, 344, 352, 421, 422, 423, 424, 429, 431, 443, 464, 465, 481, 483, 505, 532,
  567, 882, 965, 990, 995, 996, 1017, 1022, 1033, 1112, 1117 (named only by `docs/evidence/1523/affected.txt`), 1118, 1119, 1172, 1173, 1297, 1328,
  1348, 1359, 1421, 1427, 1455, 1501, 1510, 1556, 1640, 1731, 1732. Grep: `evidence['", /]+<n>\b` over everything but `docs/evidence`,
  `node_modules` and `twins/`. They are what a PR attached (screenshots, taste-call records, base-failure output) and are presumably linked from the PR
  or the issue on GitHub, which I did not check, so none is reported as unneeded. The heaviest are 166 (15 MB), 422 (15 MB), 252 (14 MB) and 124 (7 MB).
- `.gitignore:29-30` ignores `docs/evidence/149/*.png` and `*.apng`; the 25 tracked files of 149 are all under `preview/`, as the comment says.
- No file under `docs/evidence`, `docs/spikes`, `adapters`, `packs`, `spikes`, `brand`, `skills` or `reports` holds a `/Users/<name>` or `/home/<name>` path.

## Checked and found consistent (no finding)

- Every relative markdown link in `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `docs/*.md`, `brand/README.md`, the spike READMEs lands on a file; the three
  heading anchors outside the design-links lane (`technical-design.md#decided`, `#how-we-know-version-0-works`, parallel-proof's `#12a-…`) exist.
- Every backticked repo path in the four docs and the root files exists, except three that are planned: `scripts/lane-remote.mjs` (#1122 open),
  `skills/deepbuild-canvas/SKILL.md` (R6), `contracts/breaks/<from>_<to>/` (made on the first break).
- README's commands and names exist in code: `deep doctor`, `status`, `inbox`, `setup [--undo]`, `gate rules [--json]`; the guards `no-approval-tag-sign` and
  `no-approval-tag-push` (`crates/deep-hook/default-rules.json`); the status context `deepbuild/verdict` and its five-way mapping
  (`packages/github/src/delivery.ts:69`); `allowedFindings`; `testPaths`; `benchmarks/budgets.json`; Node 24.22 and Rust 1.99.1 pins.
- Design numbers that have a constant: Codex Stop timeout 45 min (`codex-settings.ts:18`), continuation cap 8 (`claude-code.facts.json`), three
  reference Macs (`scripts/benchmark.mjs:213-215`), 14-day lapse (`known-failures-check.mjs:10`), wgpu 30, wasmtime 49.0.2, Lean (`lean-toolchain`).
  The 1,500-line ceiling of "Repo guards" is planned (#1432 open), not missing.
- `docs/extension-guide.md` is generated and lane-checked (`scripts/guide.mjs --check`). The three example packages use only methods the guide lists, apart
  from `deep.schedule.read` in the plug-in's `requires.preview`, which is the known #1887. Their names match their manifests.
- `skills/deepbuild/SKILL.md` names exactly the 13 tools `packages/hub/src/tools.ts` serves and is held to its generator by `tests/acceptance/412`.
- `docs/spine.json`: all 34 merge commits are ancestors of HEAD. It differs from the table in `scripts/spine.mjs` on purpose (sub-issue merges against the closing merge).
- `docs/web`: the five icon files are byte copies of their `brand/` sources.
- `packs/`: seven manifests against their files, both ways, and every alias target: no gap. All seven are read by a crate, a benchmark or `tests/acceptance/433`, `1436`.
- `vendor/`: five crates (`gpui-pre`, `gpui-pre-apple`, `gpui-pre-macos`, `accesskit_macos`, `quickjs-jit-runtime`), each patched in by `.cargo/config.toml` and
  named in `Cargo.lock`; `gpui-pre-apple/vendor/gpui` is read by that crate's `build.rs:104`; `unicode-17.0.0` by `tests/acceptance/381/unicode.test.ts`. None unused.
- `brand/`: every file is written by `build.py` or `render_png.py` or listed in the README's table; the README's light and dark headers exist.
- Facts files: `FileChanged` (Claude Code) and `agent.permission.after` (paseo) have a payload list and no mapping on purpose (`claude-settings.ts:20`,
  `hub/src/server.ts:735`). `hookTimeouts.perHook.Stop` 600 s in both is the agent's default; setup's 45 minutes for Codex is separate.

## Coverage

| Files | How read |
|---|---|
| `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `.github/` templates | in full; every command, path and number checked |
| `LICENSE` | head and copyright line only (standard Apache-2.0 text) |
| `docs/parallel-proof.md`, `docs/extension-guide.md`, `docs/extension-guide/**` (10 files) | in full |
| `docs/technical-design.md` (872 KB) | NOT in full. Read in full: lines 1-25, 2490-2577, 2605-2609, 2629, 2670-2673. The rest by grep only: all links, all repo paths, `deep-*` and `@deepbuild/*` names, version pins, `node:sqlite`, Ajv, Playwright, plant wording, and the first 200 characters of each line of 2580-2678. Four reader agents for the remaining ranges could not be started (the session's agent limit was reached). |
| `docs/canvas-primitives.md` (1.39 MB) | NOT read. Headings, links, repo paths and crate names by grep only; the closure tables are lane-checked by `scripts/canvas-closures.mjs drift`. |
| `docs/spine.json`, `docs/web/*` | in full |
| `docs/spikes/**` (59 files) | structure, READMEs' heads, `402/record.json`; records, snapshots and images not read |
| `docs/evidence/**` (453 files) | structure only, as asked; `modularity-audit.md` skimmed |
| `docs/images/*` | not opened (the film's "76 s, 1080p, 60 fps" is unverified) |
| `adapters/index.mjs`, `index.d.mts`, `sign-in.json`, `cursor`, `opencode`, `loops`, `mcp-servers` facts, `codex-schemas/NOTICE` | in full |
| `adapters/claude-code`, `codex`, `paseo`, `pi` facts | every section but `events.versions` in full; `events.versions` by its hook names per version only |
| `adapters/codex-schemas/*.json` (24) | names only |
| `adapters/corpus/README.md` | first 62 lines (shapes, tables); the sessions table skimmed |
| `adapters/corpus/**` (180 files) | not read; grepped for MCP shapes and `SessionEnd` |
| `packs/**` | manifests parsed and cross-checked; `fx` and `chrome-fx` graphs and recipe bodies not read |
| `spikes/**` (37 files) | file list, references, `1330` and `80` names; sources not read |
| `brand/**` | README, `surfaces.json`, `render_png.py` in full; `build.py`, `palette.json`, `trademark-search.json`, `board.html` and the SVGs not read |
| `skills/deepbuild/SKILL.md` | in full |
| `reports/*.md` | heads; they are today's prior audits |
| `vendor/**` | structure, manifests' patch notes, `gpui-pre-apple/upstream/README.md` |

## More nits (found after the first list)

- `docs/technical-design.md:340` says deep-hook falls back "when no acknowledgement arrives within 50 ms of the hook's start"; `crates/deep-hook/src/main.rs:33,766` wait `ACK_BUDGET` = 20 ms from the hook's start (the comment at `:31-32` gives the other 30 ms to start, decide, spool and exit). An acknowledgement at 30 ms is in time by the design and late by the code. QUESTION for the deep-hook reader; #315's suite times this.
- `README.md:34` ("The repository skeleton runs locally; the app and hub are still in development"), its `status-design` badge and `CONTRIBUTING.md:3` ("DeepBuild is in its design phase") describe a checkout that now holds 36 packages and 39 crates. Wording only; the owner's to date.
- `docs/technical-design.md:5` points at "`app/` on the `public-history-oct15/spike-gpui-app` branch of the private DeepBuildAI/deepbuild repo", which no reader of the public repo can open, in the same paragraph that says the code lives in windoliver/deepbuild. Not checkable from this checkout.
- `docs/technical-design.md:2676` keeps `<a id="five-weeks-to-version-0">` over the heading "Six weeks to version 0". A kept old anchor, so old links land; fine unless nothing links it (`rg "five-weeks-to-version-0"` over the checkout: this line only; open issues not checked).
- `tests/acceptance/39/replies.test.ts:4` imports `ajv`, which no `package.json` or `scripts/repo-rules.json` lists; it resolves only through `@microsoft/api-extractor`'s tree (`package-lock.json:2114`). Outside this area; it follows from DOCS-DATA-3.
