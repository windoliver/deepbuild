# Acceptance tests for #1024: one Codex thread shows as one row after a hub restart

Written first, blind, by a job that never saw an implementation of #1024; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has two checkbox criteria, AC1 and AC2 in the body's order. Each test's name carries its criterion's ID
(`#1024.` and the first 8 hex digits of SHA-256 of the criterion's text, white space collapsed, as
`scripts/proof-change.mjs` reads it):

| AC | ID | File |
|---|---|---|
| AC1 | `#1024.f267e668` | `one-row.test.ts` |
| AC2 | `#1024.bd7d9d35` | `one-row.test.ts` |
| Proof (live) | both | `live.test.ts`, skipped unless run by hand |

## What was read

- Issue #1024 as of 2026-11-08: What the record shows, Why it matters, the two criteria, Proof. Its epic #5 and #39
  (closed), for context only.
- `docs/technical-design.md`: What each agent gives us, and the limits we design around (with Hooks are evidence, not a
  state machine: Threads, not IDs), the `archive` row of First-party extensions, Dogfooding. `AGENTS.md` (Proof).
- At the base `f1e8736e` (main, 2026-11-08; the worktree was at `42319109`, which adds only #531's logic@1 merge,
  nothing this suite reaches), for surfaces and conventions only: `packages/hub/src/status.ts`
  (`deep status`, `status.read`'s rows), `service.ts` (`deep hub status` prints `hub.health`), `core.ts` (`status.read`,
  `health()`, the archive pass at the hub's start), `packages/archive/src/index.ts` (how Codex rollouts are found, and
  the `session:<letters and digits>` handle on `transcript.archived`), `packages/record/src/projections.ts` (the
  sessions table), `adapters/codex.facts.json` (`transcripts.path`), `adapters/corpus/codex/0.160.0/tools`, and the
  suites `tests/acceptance/39` (helpers) and `1325` (this README's form).
- Imported by path, not copied: `../39/helpers.ts` (the temp home with its codex stand-in, the hub as a process,
  `deep setup`, `deep-hook codex <event>` as Codex runs an entry, `status.read` and `events.read` over the control
  socket, cleanup by PID).

## The replay (`replay.ts`)

The run's own record (the session notes `issue39-live-codex-2026-11-01.md`) isn't in the repo. The replay rebuilds its
shape from what the issue states, on real components: the built CLI's hub, the real `deep-hook`, the real archive.

- **The thread** is the 0.160.0 corpus recording `tools` (`adapters/corpus/codex/0.160.0/tools`: nine hook payloads,
  SessionStart to Stop, and the rollout Codex wrote), read at run time and re-keyed: a fresh dashed UUID for the
  thread, the test's own folder for `cwd`, and the rollout at the path Codex 0.160.0 keeps it,
  `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl` (its facts' `transcripts.path`), which every payload's
  `transcript_path` names. Changed from the recording: the rollout's `session_meta` says `originator: codex_cli_rs`,
  `source: cli`, since the issue's run was in the Codex CLI.
- **The steps**, as the issue tells them:
  1. The hub starts in a temp home. The rollout's first lines are written; SessionStart, UserPromptSubmit and the first
     Bash call's PreToolUse and PostToolUse go through `deep-hook codex <event>`. The status is read.
  2. `deep setup` runs mid-session (it writes the runner's `login_path`), and the hub is restarted to pick it up: SIGTERM
     to its PID, then a new `deep hub run` on the same home.
  3. The restarted hub's archive pass copies the rollout and records `transcript.archived` with
     `session:<the thread's ID without dashes>`. The test waits for that event, then reads the status.
  4. The rest of the rollout is written, and the rest of the turn's hooks (the patch, the second command, Stop) go
     through. The status is read again.
- **The status** at each step is read three ways: `status.read`'s rows (what `deep status` renders), `deep status`'s own
  text, and `deep hub status`'s output.
- **Preconditions** (BLOCKED, never a pass): the recording re-keys; every hook exits 0; `deep setup`, `deep status` and
  `deep hub status` exit 0; the record holds a `session.start` under the dashed ID and a `transcript.archived` for the
  dashless handle.

## How each criterion is read

- **AC1**: at each of the three steps, `status.read` lists exactly one row whose ID, letters and digits only, is the
  thread's, and that row's ID is the dashed UUID the SessionStart gave. `deep status` says it lists 1 session (the
  home has no other). `deep hub status`, where it names the thread at all (by an `id`, or a `session` handle), names
  it once, by the dashed ID. A failure names every ID the hub shows the thread under, with each row's agent and state.
- **AC2**: the dashless ID is taken from the record (the handle on the archive's `transcript.archived`), not computed.
  The listing the issue's run showed, the hub's own rows plus a second row for the thread under that dashless ID
  (agent `agent`, state `quiet`), must fail AC1's check with a message naming both IDs; and the same check on what
  this hub showed must pass. So a hub that shows two rows fails this suite, naming both.

## Surfaces the issue leaves open, and what these tests chose

1. **"`deep hub status`" lists no sessions at the base**: it prints `hub.health` (gates, notifications, the Claude Code
   and Codex relations), with no session rows. The rows the issue describes are `deep status`'s, from `status.read`,
   which the issue's summary also names. AC1 reads all three, so an implementation that adds rows to `deep hub status`
   is held to the same one row.
2. **"Across a hub restart"**: a hub stopped by SIGTERM and started again on the same home, as #39's helpers do; not
   the login service (`launchctl` is a stand-in in the temp home).
3. **"After `transcript.archived`"**: the archive pass the restarted hub runs at its start. No second pass is forced.
4. **The thread's hooks and rollout** come from the 0.160.0 corpus recording, not from the issue's run, whose record
   isn't in the repo.
5. **The issue's second row, `agent "quiet"`**: read as a row in state `quiet`, as `deep status` folds such rows into
   its "N quiet, by repo" line. AC2's two-row listing is built that way; AC1 doesn't depend on the second row's state.

## Run them

macOS, the repo's Node (`.node-version`, 24.22.0):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:/opt/homebrew/bin:$PATH"
npm ci                                      # once
npm run build --workspaces                  # the hub and CLI run from packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook
npx vitest run tests/acceptance/1024 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1024/tsconfig.json
```

The temp home is under `/tmp/dh39-*` (#39's helpers), removed at the end; every process is stopped by its PID. No
model is called and nothing leaves the machine.

## The live run (the issue's Proof)

`live.test.ts` is skipped unless `DEEPBUILD_1024_LIVE_THREAD` names a thread run by hand on the reference Mac:

1. With DeepBuild set up and your hub running, start `codex --no-daemon` (0.160.0) in a throwaway repo and run one
   turn with a tool call. Note the thread's ID (`/status` in Codex, or the rollout's file name).
2. Restart the hub mid-session (`deep hub stop`, then `deep hub start`, or as setup tells you to pick up `login_path`).
3. Run another turn in the same thread, and wait for the restarted hub's archive pass to record `transcript.archived`.
4. `DEEPBUILD_1024_LIVE_THREAD=<dashed ID> npx vitest run tests/acceptance/1024/live.test.ts`

It reads your own hub (`~/.deepbuild`) through `events.read` and `status.read` and changes nothing: the record must hold
the thread's `session.start` and a `transcript.archived` for its handle, and the status must show one row, under the
dashed ID. This job has never run it.

## What the base does

**The base passes both tests: it doesn't reproduce two rows.** The issue was found on 2026-11-01; on 2026-11-03 commit
`3716c626` ("List only sessions with an event of their own", #992) made `sessionStates` in
`packages/hub/src/status.ts` list only sessions with `last_seen` set. The row `transcript.archived`'s projection makes
under the dashless handle has none, so it is no longer listed. That commit is in the base.

To show the suite fails on the wrong program, it was run once more against a mutant that reverts just that line in the
built hub (`packages/hub/dist/status.js`, `WHERE last_seen IS NOT NULL` to `WHERE 1 = 1`; build output, restored and
compared byte for byte afterwards; no source changed). The replay then shows exactly the issue's symptom, and both
tests fail naming both IDs:

```
after the restart and transcript.archived, status.read: the hub shows thread 30f889a5-5dba-4919-923a-0fd4ab955c36 as 2 rows, not one under its SessionStart's ID: 30f889a5-5dba-4919-923a-0fd4ab955c36 (agent "codex", "working") and 30f889a55dba4919923a0fd4ab955c36 (agent "agent", "quiet")
```

BASE-FAILURE.txt has both runs. An implementation of #1024 may still change how the record holds the two forms; these
tests hold it to what the issue states, whatever the base already does.

## Known limits

- The replay restarts the hub once, between the turn's first command and its patch; a restart at another point, or
  hooks that land while the hub is down (spooled by deep-hook), aren't replayed.
- Whether the copy the test waits for is the restarted hub's pass or a late pass of the first hub's is timing: the test
  waits for a `transcript.archived` of the rollout at its size at the restart, from either.
- `deep status`'s text shows a row's ID cut to 8 characters, the same for both forms; its session count is read instead.
- The live run has never been run by this job.
