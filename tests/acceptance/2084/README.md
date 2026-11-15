# Acceptance tests for #2084: a held heavy-command call keeps its settled reply

Written blind from `issue-2084.json`, the base checkout (`1c4d1f0e2aaad8c6a6573848823566d04ff73d17`), `AGENTS.md` and
`docs/technical-design.md`. No claim is made here that any check passes; the implementing agent runs them on the base
and on the fixed hub and keeps the output.

## Requirement to proof

| Requirement (issue) | Proof |
|---|---|
| `tests/acceptance/1015/claude.test.ts` and `focused.test.ts` pass on main, unchanged | Not re-written here. Run the two existing files unchanged (below); this folder never edits them. |
| Two sessions with changes in one repo: the second's first `cargo test --workspace` after its prompt is rewritten into its `deep lease` form and holds a `cpu.slot`; the sibling notice the hold is for still reaches it; a hub whose held reply drops the rewrite fails | `held.test.ts`, test "Claude Code": both sessions edit `README.md` in worktrees of one repo; the second is prompted again; the first edits again (a notice for the second); the second's first cargo call is asserted (1) rewritten into a `deep lease` form (the returned PreToolUse reply), (2) running holding a `cpu.slot` lease under its session in the record's lease table, (3) exits 0, (4) its same reply's `additionalContext` carries a `notice.delivered` text from the first session handed via `PreToolUse`. A hub that drops the settled reply fails (1) with the empty stdout shown. |
| Scope: the one denial for an agent whose calls can't be rewritten | `held.test.ts`, test "Codex": a Claude Code sibling has changed a file; a Codex session is prompted, so its first call is held; `cargo test --workspace` must be denied once with a backticked `deep lease` form containing the command, and the retried form allowed. #1015's `codex.test.ts` runs no held call, so it doesn't cover this. |
| Known-failures listing | Not tested here (a config entry, no behavior). |

## Surfaces and reuse

Real `deep-hook`, `deep hub run`, `deep lease` and the record, through `tests/acceptance/1015/helpers.ts` (`World`,
`Session`, `claudeCall`, `leaseRows`, `slotsOf`, `rewrittenToLease`, `leasedForm`, the stand-in `cargo`), reused by
re-export. `helpers.ts` here adds only a Claude Code Edit (Pre hook, change on disk, Post hook with its
`structuredPatch`, as #352's sessions send it) and a second prompt on a begun session; both reach the 1015
`Session`'s private transcript writer and prompt ID by a cast. Notices are read from the record's `notice.delivered`
events (#352's surface) through `allEvents`. Only the heavy command is stood in for, at the executable boundary.

A hook deep-hook answered without the hub (spooled, on a loaded machine) is reported `INCONCLUSIVE`, never a pass or
a failure for the criterion.

## How to run

```sh
npm run build --workspaces
cargo build --locked -q -p deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2084
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1015/claude.test.ts tests/acceptance/1015/focused.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/2084/tsconfig.json
```

Each file starts a hub of its own; the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (the implementer
adds it). Folders are under `/tmp/dh1015-*`; processes the tests start are stopped by PID or process-group ID only.
