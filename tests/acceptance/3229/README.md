# Acceptance tests for #3229: a held-out variant can't be read by the session it is held from

Its bytes are sealed in the store, the gate's checkouts are closed to an agent's reads, and a variant a session's own
call reached is spent.

Written first, blind, by a job that never saw an implementation of #3229. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Sources

Only these were read:

- Issue #3229's body: Scope, its eight acceptance criteria, Proof, Depends on, Not in this task; the titles and criteria
  of #1018, #1606 and #2675 it names.
- `node scripts/design-section.mjs --issue 3229`: `docs/technical-design.md`, How runs become one of five verdicts
  (Held-out variants, Carried across sessions, Run counts), Threats (Sessions DeepBuild starts, Agents gaming checks,
  What a command's children do, Secrets), Before each command, Evidence. Also Dogfooding, Tests written first, Repo
  guards. `AGENTS.md`.
- Base commit `a5fc47436` (main), for where to enter, never for an expected value: `packages/hub/src/ask-tasks.ts`
  (`heldOut`, the lock), `stop-judging.ts` (`runApproved`, the overlay), `gate-runner.ts` (`variants`), `runs.ts`,
  `held.ts` (the secret store's stand-in), `plant.ts`, `starts.ts` (the sandbox's unreadable folders and the row),
  `session-state.ts` (threads, resumed sessions), `mcp-operations.ts` (`deep_status`), `packages/evidence/src/index.ts`,
  `packages/reading/src` (`deep read`), `packages/gate/src/checkouts.ts`, `crates/deep-hook/default-rules.json`,
  `adapters/claude-code.facts.json`.
- The suites `1018`, `1606`, `29`, `26`, `667`, `1330`, `2197`, `303`, `3219` and `1097` for conventions and helpers.
  `started.test.ts` imports `../1330/helpers.ts`; everything else this suite keeps its own copy of.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # every file starts `deep hub run` from packages/cli/dist
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease cargo build --locked -p deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/3229/<file>.test.ts --testTimeout=600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/3229/tsconfig.json
```

Run the files one at a time (`lane.json`). At a load near 300 on 18 cores each file took one to three minutes on the
base; a right program runs the planted legs too, about twice that. No network, no model, no real `claude`, no sign-in,
and no runner job: every definition is handed (`DEEP_HUB_TEST_DRAFTS`), so nothing waits on a plan-window reading.
Folders are under `/tmp/dh3229-*` (and #1330's `/Users/Shared/dh1330-*` for `started.test.ts`), removed after each test;
HOME is the test's own; a process is stopped by the PID it was started with. `started.test.ts` needs macOS
(`/usr/bin/sandbox-exec`); elsewhere it reads BLOCKED.

## Criteria to tests

IDs are `criterionId` in `scripts/proof-change.mjs`.

| AC | ID | File | What it proves | Wrong program |
|---|---|---|---|---|
| AC1 | `#3229.ee87773b` | `sealed.test.ts` | after a definition with one variant locks, no file under `~/.deepbuild` (a `.zst` unpacked, a path's own words too) holds the variant's random marker, and no line of `evidence/records.jsonl` holds the fixture's path | the merge base: `BASE-FAILURE.txt` |
| AC2 | `#3229.9319401a` | `sealed.test.ts` | on the honest fix, the visible fixture's run and the variant's both pass and the claim is PASS, as on the merge base; then no file under `~/.deepbuild/checkouts` holds the marker | plant `leaves-unsealed-variant`, named by the file it left |
| AC3 | `#3229.c04b35af` | `hook.test.ts` | hub stopped: `cat` and Read of a file under `~/.deepbuild/checkouts` are each denied, naming a fail-closed read entry; a `cat` of the session's own file is allowed | the shipped entries less every path of the checkouts (the merge base's entries): both allowed, the judge names both |
| AC4 | `#3229.9dd1dffa` | `status.test.ts` | `deep_status` says two variants and holds no digest; `deep read ev:<digest>` of each, a child of the session's own process, is refused naming a variant, and prints no byte of it | plant `answers-variant-bytes`, named by the call |
| AC5 | `#3229.97352c61` | `spent.test.ts` | a recorded `deep read ev:<digest>` call, then a claim that special-cases both: INCONCLUSIVE naming the call, never PASS, no run failed. With no such call the claim can special-case the visible fixture alone: the variant's run fails, never PASS | plant `counts-spent-variant`: the claim is PASS and the judge fails; the merge base |
| AC6 | `#3229.2d41acf1` | `spent.test.ts` | the task's claims stay so after a resume in a new process, a compaction that rotates the ID, and a new attempt by a forked session; a session on another task, with the same check and variant, reads PASS | plant `spent-by-session-id`, named by the rotated ID |
| AC7 | `#3229.ed92ed6d` | `started.test.ts` | a started session's child can't read a file of the store, nor one under the checkouts (EPERM), though the test can, and its row says the wall is held; on facts with no sandbox the row says not held | the merge base: it reads both |
| AC8 | `#3229.82fbda49` | `budgets.test.ts` | on a fit reference Mac only: the hook opens and starts nothing more with the entry; sealing and unsealing add under 5 ms. Anywhere else INCONCLUSIVE, with why | a budget |

AC2's right leg, AC5's twin leg, AC3's wrong-program leg and AC7's second leg state what the merge base already does, so
they pass there; each criterion they belong to fails on the base at another leg, or names only a plant.

## The surface under test

Names marked *(chosen)* are this job's choices where the issue and the design name none; a dispute starts there.

- **The hub, the hook, the sessions.** `deep hub run` with `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS` (a requirement
  `R1` whose `held_out: [{ files: { <path>: <bytes> } }]` hands its variants, as #1018's suite does), `DEEP_HUB_TEST_SECRETS`
  (the OS secret store's stand-in, #1606, a file beside the home, so it is not searched) and `DEEP_HUB_PLANT`; the real
  deep-hook; a Claude Code stand-in, one process per session (`argv[0]` is `claude`), the parent of its deep-hook runs,
  its Bash tool's shells and its `deep mcp`. The stand-in is the issue's "fake agent".
- **Hooks under load.** Past its 50 ms budget deep-hook lets a call go and can lose its event. So a session fires a hook
  again until the record holds the event, at most six times, and then reads BLOCKED: a test judges the hub, never the
  machine's load. A claim whose snapshot went over the gate's own budget, as on a Mac that slept, ran no check and reads
  BLOCKED. The PATH a hub and a session get holds Node and the system's programs only, so no real agent is found.
- **The fixture.** A cart whose total ignores the discount; a drafted check, `node --test test/cart.test.mjs`, that totals
  `test/fixtures/basket-3229.json`; a variant is that file with another cart, named by a random marker.
- **A variant's digest** *(chosen)*: the `sha256` of the journal's line whose `source` names `R1` as a word (Scope: "the
  journal's line names the requirement and the variant's number"); where no line does, each 64-hex string under a
  `held…` or `variant…` field of `definition.locked`'s data. Both, and the SHA-256 of the variant's plain bytes, are what
  `deep_status` may not hold.
- **A read by handle** *(chosen)*: `deep read ev:<digest>`, the CLI's handle for one file of the store, run as a child of
  the session's process with the hub up. Refused: a non-zero exit, no marker in its output, and the word `variant`.
- **"deep_status says two"** *(chosen)*: anywhere in the reply's value, a field whose name says `variant` or `held…out` with
  the number 2, a string with `2` or `two`, or a list of two under it; or a sentence that says variants and 2 or two. Called
  once the task's claim has its verdict, so a reply that says it by claim, by check or by task counts.
- **The reaching call** (AC5, AC6): the session's Bash call `deep read ev:<digest>`, its PreToolUse and PostToolUse fired
  through deep-hook, recorded as `tool.before` with the call's ID. It runs whether or not its read is refused.
- **"Naming the call"** *(chosen)*: the claim's `verdict.made` data, or its line or second line (`changes.read`), holds the
  call's `tool_use_id`, its `tool.before` event's ID, or its command's words `deep read`.
- **"Counts neither way"**: no PASS among the claim's `verdict.made`, the last one INCONCLUSIVE, and no run of the check
  failed, since the code special-cases both. Whether a spent variant still runs is left open.
- **"The same claim with no such call fails its twin"** *(chosen)*: a session that never reached the variant can't know it, so
  its claim special-cases the visible fixture alone, and the twin that fails is the unseen variant (#33). At the base a pass
  and a fail read INCONCLUSIVE; the test asks for the failed run and never PASS.
- **A compaction, a resume, a new attempt** *(chosen)*: a resume is a new process under the same ID (SessionStart `resume`);
  a compaction is SessionStart `compact` with a new ID in that process; a new attempt is a fork (`claude --resume <id>
  --fork-session`, SessionStart `fork`) in a process and under an ID of its own. The design joins all three to one thread
  (Threads, not IDs), and each claim's `attempt` is one more. A second session that merely names the same issue is not
  judged on its definition at the base, so it can't be the attempt here. Each turn's prompt is a question, which opens no
  task.
- **The session "started from the app"** *(chosen)*: #1330's `deep start` under an approval, which reaches the hub's one
  `start.session`, the method the app's start calls too. Its stand-in agent enforces the settings it is launched with by
  Seatbelt. The store and checkout files tried are planted by the test in those folders.
- **The row** *(chosen)*: `sessions.read`'s `sandbox`, its wall of unreadable folders, which is `walls.credentials` at the base
  (the Scope: "holds the store and the checkouts among its sandbox's unreadable folders … its row shows the wall as held or
  not held, as it does for the others"). Every field there named for credentials, the store, evidence, checkouts or
  unreadable folders must say `true`/`held`, or `false`/`not held`.
- **AC8** *(chosen)*: the hub's own time around a variant's run is `definition.locked` less `task.created`, plus the variant's
  `run.started` less the visible run's `run.finished`, plus the verdict less the variant's `run.finished`; the merge base's
  hub is built from the pinned commit under `target/base-3229/`, only on a fit reference Mac. The hook's opens and starts
  are counted by a library inserted into deep-hook (`fixtures/count.c`), the most of ten calls on each side, since a loaded
  deep-hook stops short at its 50 ms budget. Counted under the shipped entries and under the merge base's read entry.

## Proof on a wrong program

The implementer adds each name to `packages/hub/src/plant.ts`. The base's hub refuses each (`names no planted program`),
so those legs read BLOCKED there, never a pass.

| `DEEP_HUB_PLANT` | AC | The wrong behaviour |
|---|---|---|
| `leaves-unsealed-variant` | AC2 | The hub leaves the variant's unsealed file in its run's checkout, on disk under `~/.deepbuild/checkouts`, when the run ends (so the checkout stays too). |
| `answers-variant-bytes` | AC4 | A read by handle of a variant prints its bytes, unsealed. The name is in the hub's environment and in the session's, so a `deep read` the session starts has it too. |
| `counts-spent-variant` | AC5 | The gate counts a spent variant's run as any other: the claim reads PASS. |
| `spent-by-session-id` | AC6 | The mark is keyed by the calling session's ID: still spent for a claim under that ID, not for one under a rotated ID. |

## Open points

1. The Scope's other rules have no criterion and no test here: a call that names a path inside a checkout while a variant
   lay there, a child session's call, no agent unspending a variant, a second variant no call reached settling the check,
   the cheat corpus's new case (#725), and what `deep read` answers outside a session's process tree.
2. `started.test.ts` reads the row of a session whose hooks run inside #1330's stand-in's sandbox, where deep-hook can't
   spool. Once, at a load near 390, every hook was late, so no row came and the test failed at the row, not at the read;
   run it again on a quieter Mac before reading that as a failure.
3. AC1 searches for the marker in plain bytes and in `.zst` files unpacked; an encoding of it, such as base64, is not read.
