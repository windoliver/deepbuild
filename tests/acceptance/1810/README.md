# Acceptance tests for #1810: the chat's "needs you" count is the open asks, the number the app shows

A blind job wrote these first, at base commit `c740dede7`, before any implementation existed. It worked from issue #1810
(its problem, Scope, three acceptance criteria and Proof), the design and the base. The implementing agent does not edit
these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #1810.
- `docs/technical-design.md`: An ask, and your answer getting back (every ask ends; a default can be undone from
  Needs you), States people see, The verdict in the chat, Dogfooding, Tests written first.
- At the base: `packages/hub/src/verdict-chat.ts` (`statusAnswer`), `statusReply` and `promptReply` in
  `packages/hub/src/core.ts`, `recordStates` in `packages/hub/src/session-state.ts`, `packages/hub/src/plant.ts`,
  `packages/verdicts/src/line.ts` (`LINE_WIDTH`, `verdictLine`), `undo` in `packages/asks/src/index.ts`, the
  `claim.made` projection, and the suites `1463`, `83`, `16` and `26` (helpers and conventions).

## How to run

Put Node 24.22 first on `PATH`, build the workspaces (`npm run build --workspaces`) and build `target/debug/deep-hook`
(`cargo build --locked -p deep-hook`). On the Spark, wrap each build and run in the capped `systemd-run --user ...` line.

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1810 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1810/tsconfig.json
```

- Each world is a temp HOME under `/tmp` (#16's `tempDir`). The tests never touch the real `~/.deepbuild` or `~/.claude`.
  A test stops only processes it started, by PID. No network and no model.
- The replica test builds `deep-drive` (`-p deep-replica`) and runs on macOS only. Anywhere else it is BLOCKED.
- Vitest writes `tests/acceptance/1810/node_modules/.vite/`. Delete it before committing.

## The surfaces

- **The status answer**: "anything for me?" typed by a person into the session. The transcript entry marks it as a
  person's prompt (`turnOrigin: human`), and the UserPromptSubmit carries its `prompt_id`. The hub answers over its
  socket as deep-hook sends the hook. The answer is the reason of the reply that blocks the prompt. When an answer is
  waiting for the agent at this prompt, the answer is the reply's `systemMessage` beside it, where the chat shows it
  (#83). The count is the `needs you: <n>` that ends the answer's line.
- **`deep`**: the built CLI's count sentence (`1 ask needs you`, #1463). **`deep status --json`**: its `log_pos`.
- **The app's list**: the rows the app folds. Every `row.set` up to `deep status --json`'s `log_pos` is read through
  `events.read`, and `listed: false` takes a row off. On macOS, the replica's own `see` (`rows`, `log_pos`, and the
  window's count sentence) is read as well.
- **The fixture** (`makeWorld`): a git folder and one Claude Code session. Its first turn goes through the hub
  (SessionStart, a prompt, one call, its Stop; the Stop makes the session's claim, so the answer's line is #83's verdict
  line). Then, with the hub stopped, the record and asks core seed the title (`task.created`) and the asks. An ask
  marked `default` has a deadline one minute after it is raised and takes its default by `tick`. A real hub then starts
  again, and asks marked `answer` are answered through `deep inbox answer <handle> <option>`.

### Pinned here: the implementation must provide this

1. **The plant `needs-you-counts-defaulted`**, added to `Plant` and `PLANTS` in `packages/hub/src/plant.ts` and selected
   by `DEEP_HUB_PLANT`. It is read by the hub: its status answer counts a defaulted ask that can still be undone as
   open, and everything else stays as shipped. It is criterion 2's planted reader.

## Criterion to tests

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| 1 | `#1810.eebcb4a2` | `count.test.ts`: two answered and one open give `needs you: 1`; `deep` says `1 ask needs you`; the folded list at `deep status --json`'s `log_pos` holds the one open ask's row, the same as before the question; on macOS, the replica says 1 at that `log_pos` | a count of closed asks (`judges.test.ts`: `needs you: 3` is named with the count and each closed ask). The base passes (BASE-FAILURE.txt) |
| 2 | `#1810.a646c123` | `defaulted.test.ts`: with one open and one defaulted ask, the answer, `deep` and the folded list say 1 and hold no row for the defaulted ask; `deep inbox undo` then succeeds on it | `needs-you-counts-defaulted`, which is named by the ask's handle |
| 3 | `#1810.1a3e8cda` | `width.test.ts`: a 90-character title and 3 open asks; the answer's count line is at most 80 columns (`LINE_WIDTH`) and ends in `needs you: 3` | the base (98 columns, the count appended after the fitted line), named by the width |

## Disputes and assumptions a redraft may revisit

1. **Criterion 1 at the base.** The issue says the merge base answers 3. At `c740dede7`, #1463 already made
   `statusReply` count the list's ask rows, so the answer says 1 and the test passes there. That is recorded, not
   faked. A redraft against an older base would see 3.
2. **"No wider than #83's width"** is read as the answer's line that carries the count, #83's one line. The answer's
   second line (`work: <worktree> · session … · resume: … · deep://sessions/<id>`) holds a path and two session IDs, and
   #83's suite holds it to no width.
3. **The 90-character title** is the session's title in the record. The base's status line doesn't show the title. The
   line overruns because of the verdict line plus the appended count, which is what the issue's "count is appended
   after the cut" names.
4. **"The same log position"** is read as follows. `deep` reads between two `deep status --json` reads at one equal
   `log_pos`, the fold is taken at that `log_pos`, and the ask rows there equal those just before the question.
5. **"Can still be undone"** is proven by undoing it with `deep inbox undo` after the counts are read.

## Files

- `helpers.ts`: IDs, the fixture, the readers (status answer, `deep`, `log_pos`, folded rows, replica) and the judges.
  It imports `../16/helpers.ts` and `../26/helpers.ts`; the replica driver is adapted from `../1463/helpers.ts`.
- `count.test.ts` (1), `defaulted.test.ts` (2), `width.test.ts` (3). `judges.test.ts` has no criterion tag and passes
  at the base.
- `criteria.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
