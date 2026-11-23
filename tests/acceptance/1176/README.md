# Acceptance tests for #1176: the #806 suite's Codex stand-in stamps each MCP call

Written blind from issue #1176 (its three acceptance criteria, Proof and Out of scope), the issues it links (#806, #39), `AGENTS.md`,
`docs/technical-design.md` (Proof, Dogfooding, Failing on an assertion) and base commit `61aa8eb06` (`origin/main`). Read at the
base: `tests/acceptance/806/` (helpers, figure, sessions suite, REDRAFT.md), `tests/acceptance/26/helpers.ts`, `tests/acceptance/39/`
(its twins), `packages/hub/src/mcp-operations.ts` (`bind`), `packages/hub/src/hookmap.ts` (the stamp's digest), `scripts/proof-runs.mjs`.
The redraft #1176 asks for is already on main (commit `43d428e86`, "part of #1176"), so each test passes at the base and must fail on
its twins. Never read: PR 1226.

## Run them

```sh
npm run build --workspaces; cargo build -p deep-hook; cargo build --bin deep-show   # as the #806 suite needs
npx vitest run --root tests/acceptance/1176 --no-file-parallelism
npx tsc -p tests/acceptance/1176/tsconfig.json
```

`after.test.ts` and `before.test.ts` each run the #806 sessions suite (with the app), so the folder runs alone: `lane.json` here says so
(`scripts/lanes.mjs` reads it, #1327), and no `lanes.mjs` edit is needed. Each stays under the proof lanes' 20-minute cap per file
(`scripts/proof-runs.mjs`, TIMEOUT) by its own 18-minute stop: `after` runs the whole suite (7 tests), `before` only the two tests the
criterion names (`-t`). Each imports `../806/helpers.ts`, so a lane's binary selection follows into the suite. `before` makes a sibling
folder `tests/acceptance/1176-before-<pid>` and removes it after; a folder whose process is gone is removed by the next run. The inner
vitest runs in its own process group, stopped with it on exit, SIGTERM, SIGINT or SIGHUP and at its deadline.

## The tests

| Criterion | Test (file) | What it reads |
|---|---|---|
| `#1176.3cc34af6` | `after.test.ts` | Runs `vitest run --root tests/acceptance/806 --no-file-parallelism sessions.test.ts` with a JSON report: 7 tests, all passed. Off macOS it fails `INCONCLUSIVE:` (`requireMacos`). |
| `#1176.3cc34af6` | `before.test.ts` | Lays the first draft beside it: main's 806 folder with `helpers.ts`, `figure.ts` and `sessions.test.ts` from `git show 43d428e86^:<path>` (the redraft, pinned; no commit has touched these three since, so this is main's folder with the redraft undone). Runs the same with `-t` on the two Codex `deep_claim` tests: both run, both fail, each on `deep_claim` refused `unbound`. |
| `#1176.56faa14e` | `stamps.test.ts` | The #806 world (`openFigures({app:false})`), the Codex stand-in's `hook` and `request` wrapped to record what it sends. After `showFigure`: the last hook before each `tools/call` (`deep_claim`, then `deep_show`) is a PreToolUse with `tool_name` `mcp__deep__<tool>` and `tool_input` deep-equal to the call's arguments; the claim is filed as the Codex session; deep_show is `presented` with no `code`. Then: a stamp with other arguments → `deep_claim` refused `unbound`, the refusal naming `deep_claim`, nothing filed; a stamp with the call's arguments under `mcp__deep__deep_show` → `unbound`; the control (same arguments) binds and is filed as the Codex session. |
| `#1176.9980ad17` | `diff.test.ts` | git at run time, the redraft (pinned: `43d428e86`, whose message names #1176) against its parent: changed files ⊆ `REDRAFT.md`, `figure.ts`, `helpers.ts`, `sessions.test.ts` in `tests/acceptance/806/`, none under `packages/` or `crates/`; every first-draft test title kept, exactly one added (the twin, "other arguments … unbound"); the planted-writer `it` block byte-identical; `sessions.test.ts` only gains lines inside the twin test; `helpers.ts` only gains the `stamp` method; `figure.ts` changes only inside `showFigure` and its helpers import, and `showFigure` stamps `deep_claim` then `deep_show`. |

## The twins (`twins.json`)

Each is a full copy of `packages/hub/src/mcp-operations.ts` at the base with one change in `McpOperations.bind` (the stamp match of
a call from a `deep mcp` with no session of its own, i.e. Codex's):

- **`stamp-ignores-arguments`**: the filter drops `s.digest === digest` (`void digest;` keeps the type-check). A hub that binds a Codex
  call through any unspent stamp for its tool. Criterion 1: `after` fails (the 806 twin test's mismatched stamp binds, 6 of 7); `before` still passes on it (the first draft's unstamped calls stay unbound), which the lanes allow, since a test is proven by any one twin its criterion lists.
  Criterion 2: the stamp with other arguments binds instead of `unbound`.
- **`stamp-ignores-tool`**: the filter drops `s.tool === tool`. A hub that binds through any stamp whose arguments match, whatever tool
  it names. Criterion 2 only: the `mcp__deep__deep_show` stamp binds the `deep_claim`. (The 806 suite passes on it, so it is not
  criterion 1's.)
- **`binds-by-process`**: when no stamp binds, the call binds to the one live session whose process is the `deep mcp`'s parent (the
  pre-#39 rule). Criteria 1 and 2: the mismatched stamp's call binds by process, so `after` and `stamps` fail; the first draft's unstamped Codex calls bind too, so `before` fails (its two tests pass). (Issue's Out of scope says such a hub "would still
  pass here"; that holds for the correctly stamped calls, not for the twin test, which this twin fails.)

## Not provable by a product twin

**`#1176.9980ad17`** is about the redraft's diff in git history and test files; no product source changes it, so it has no twin
and stays open in trace. Its test still runs and fails on a redraft that strays (shown only by reading, not by a twin run).

## Base run

`BASE-RESULT.txt`.
