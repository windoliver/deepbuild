# Acceptance tests for #1813: every line DeepBuild puts in a chat says who it's talking to and where the person answers

Written first and blind, at base commit `9bbe0f24c` (origin/main, Merge pull request #3764), from issue #1813 (updatedAt
2026-11-28T05:35:26Z: its problem, Scope, four acceptance criteria and Proof; no comments), the design and the base,
before any implementation. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). There is no taste criterion, so no `TASTE.json`.

## What was read

- Issue #1813; the titles and states of #1460 (closed), #1463 (closed) and #1105 (open), which it depends on or names.
- `docs/technical-design.md`: An ask, and your answer getting back (with Where asks reach you); What each agent gives us,
  and the limits we design around; How we know version 0 works, Dogfooding and "Tests written first".
- At the base: `packages/hub/src/holds.ts` (`waiting`, `decide`, `holdUnstaged`, `namedDefaults`, `gate`), the strings
  under `packages/hub/src` that start `DeepBuild `, `crates/deep-hook/default-rules.json`, `packages/cli/src/main.ts`
  (`deep open`, `deep inbox`), `crates/deep-app/src/single.rs`, `packages/hub/src/reply-fit.ts` and
  `scripts/tool-load.mjs` (the pinned tokenizer), `scripts/lanes.mjs` (the lint lane, `aloneReasons`),
  `scripts/selection-lint.mjs`, `scripts/proof-change.mjs` (criterion IDs), and the suites `83` (the world, reused by
  import), `1460` (addresses, `deep open`, the lint's shape; `appBinary` reused), `1459` (`RealApp`, reused), `1463`,
  `321`, `1523` and `2200` (twins).

## How to run

With Node 24 first on `PATH`, the workspaces built (`npm ci; npm run build --workspaces`), `deep-hook` built (`cargo build
-p deep-hook`), cargo on `PATH`, on macOS, in a logged-in session:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1813 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1813/tsconfig.json --noEmit
```

- **The world** is #83's (`tests/acceptance/83/helpers.ts`): a real hub on a temp home under `/tmp` with `deep setup` run,
  Claude Code's stand-in firing the settings' hook entries (deep-hook, the CLI) for each session, and `deep inbox answer`
  counting with #24's OS-confirmation stub. Nothing touches the real `~/.deepbuild`, `~/.claude` or
  `~/Library/LaunchAgents`; only what a test started is stopped, by PID. No network, no model.
- **The merge base** is `git merge-base HEAD origin/main`. `agent.test.ts` and `tokens.test.ts` run the hub of the
  merge base as well, through #83's `mergeBase()`: this checkout when its code is the base's, else a `git archive` copy at
  `/tmp/dh83-base-<sha>`, built once and kept.
- **The real app.** `address.test.ts`, once the reason holds an address, builds `deep-app` (#1460's `appBinary`, copied to
  `$TMPDIR/dd1460-bin-<uid>`) and runs it on the world's home, read from outside by #1459's `probe.swift`. The process
  running the tests needs Accessibility and Screen Recording; without them that test fails `BLOCKED: …`, never passes.
- **Alone** (`lane.json`): the real window `deep open` reaches, and the cargo and merge-base builds.
- **`--root` cache.** Vitest writes `tests/acceptance/1813/node_modules/.vite/`; delete it before committing.

## The fixture run (`helpers.ts`, `fixtureRun`)

The run that reaches the hub's lines: two Claude Code sessions on one hub, each on a git repo with an origin, each begun
with a prompt you typed that names no push, PR or merge. Session 1: `git push origin main` is held; held again while its
ask waits; the person says no (`deep inbox answer … decline`) and it is held again; `gh pr create --title … --body …` is
held, the person says yes and it runs; the session stops, and the stop delivers the person's answers. Session 2: its push
is held, the person says yes, it is held for its 10 s (#1101), and it runs once that is over. At each step, every text a
DeepBuild hook entry's reply carries (`permissionDecisionReason`, `additionalContext`, `reason`, `systemMessage`,
`stopReason`, or stderr at exit 2) is the dump, by step. A step that doesn't hold or let through as it says fails the run,
naming the step. In this run only the person answers any ask, so each "your answer", "you said" or "once you say" in the
dump means the person.

## Pinned here: the implementation must provide these

1. **The lint: `node scripts/agent-lines-lint.mjs [--root <checkout>]`**, run by the lint lane in `scripts/lanes.mjs`. It
   reads every string the hub sends into a chat under the root: at least each string literal in `packages/hub/src/**/*.ts`
   whose text starts `DeepBuild ` (the form every hub line into a chat takes at the base). With `--root` it reads only
   what is under `packages/`, `crates/deep-hook/` and `adapters/` there, the folders the test copies. It exits 0 on no
   finding, and non-zero with a line per finding that names the file (its path from the root) and the string. The plant is
   appended to the copy's `packages/hub/src/holds.ts`: an exported function returning the base's held wording,
   `` `DeepBuild is holding this: ${question} It waits for your answer to ${ask}; once you say yes, run the same call again.` ``
   (`helpers.ts`, `PLANTED`); the failure line must hold `packages/hub/src/holds.ts` and `It waits for your answer`.
2. **The address** in a held call's reason is #1460's: `ask/<ULID>` (the ask's handle without `ask:`), bare or as
   `deepbuild://ask/<ULID>`; `deep open` takes it as the reason writes it. The app's page for it has a node whose
   accessibilityIdentifier is `ask/<ULID>`, and its card the node `question-card` (#1460's README, Pinned 2).
3. **The order** (Scope: the ask's question leads and its ID goes last, as `deep inbox` prints it): the reason holds the
   ask's question exactly as its `ask.created` records it, before the address, and the ask's ID appears nowhere after
   the address.

## What each test proves

| # | Criterion | Test | On the base |
|---|---|---|---|
| 1 | `#1813.c20f2ad6` the dump holds no person-"you"; a planted "It waits for your answer" fails, naming string and file | `dump.test.ts`: the fixture run's dump holds none of the three phrases (each failure names the step, the hook and the whole string); then the lint (Pinned 1) is in the lint lane, passes a copy of the checkout's `packages/`, `crates/deep-hook/` and `adapters/`, and fails the same copy with the plant, in a line naming both | fails: nine strings, from "Once you say yes, run the same call again" to "DeepBuild delivers your answers" |
| 2 | `#1813.9f6d5db8` the held reason holds the ask's address, `deep open` lands on its card; a planted ID-only reason fails, naming the ask | `address.test.ts`: the push's held reason passes the address judge (Pinned 2 and 3); the same reason with every address cut back to `ask:<ULID>` fails the same judge, naming `ask:<ULID>`; then `deep open <address>` against the real app exits 0 and leaves `ask/<ULID>` and `question-card` in its window | fails: the reason names `ask:<ULID>` by its ID alone |
| 3 | `#1813.1e762706` on a recorded session the agent sent the line doesn't answer the ask or retry before the person; on the base's wording the planted agent retries and the test fails, naming the call | `agent.test.ts`: the planted agent (`literalAgent`, which reads every "you"/"your" as itself: where the line asks for its answer or waits on what it says, it runs `deep inbox answer` on the ask and the same call again; otherwise it waits) gets the push's held-call line; the judge reads the hub's record (`tool.before`, `ask.answered`) between the held call and the person's answer, and checks the call runs after the person's yes. Then the same on the merge base, where the agent must retry and the judge must fail naming `git push origin main` | fails on this checkout's own run: the agent answered the ask and retried `git push origin main` before the person |
| 4 | `#1813.343b9fbb` every changed line at or under its merge base token count | `tokens.test.ts`: each default rule's `reason` and `next_step` (`crates/deep-hook/default-rules.json`, here against `git show <merge base>:`), and each line of the fixture run's dump on this checkout against the same step's on the merge base (IDs, hashes, paths and times made the same; lines both hold are unchanged; the rest pair in order; a line with no base line is new, against 0), counted by gpt-tokenizer's o200k_base, the repo's pinned tokenizer | passes, as it must; its wrong program is the twin `longer-rule-line` (`twins/README.md`) |

## Limits, said rather than tested

- **"Every string the hub sends into a chat."** The dump covers what the fixture run reaches: the push and PR holds, the
  no, the yes and its hold, and the stop that delivers answers. Other lines (a send-back's reasons, hub-down replies,
  Codex's and other agents' routes) are reached by no run here; the lint (Pinned 1) is what reads every string. Its scope
  is pinned only as far as the hub's `DeepBuild …` literals, which the base's held line is one of.
- **"That means the person."** No test decides meaning in general. The dump's run answers every ask by the person alone,
  so there each phrase means the person; the lint's plant is the base's own held wording.
- **"Recorded session."** Read as the hub's record of a session the stand-in drove, with the planted agent's turn played
  through the same hooks. No live model runs: whether a real model misreads a line is not tested, and a passing test
  here says only that the planted literal reader, which retries on the base's line, waits on the change's.
- **Criterion 4's lines** are the dump's and the default rules'. A changed string no fixture run reaches and that isn't a
  default rule is not counted here.
- Unrelated, seen at the base while writing these: `deep inbox` printed "Nothing needs you" right after the push's
  authority ask was raised and while it was open; not this issue's, noted only.
