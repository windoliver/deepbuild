# Acceptance tests for #1018: results shared across sessions

Written blind from issue #1018 (its Scope and its 6 checkbox criteria), `docs/technical-design.md` (How runs become one
of five verdicts: Pinned to a commit, Held-out variants, The stack a check runs against, Run counts; An agent says it's
done; Sessions that know about each other; Dogfooding), `AGENTS.md`, the acceptance tests of #29, #31 and #875 for their
conventions and helpers, and base commit `69803b94` (origin/main). The job that wrote them never saw an implementation
of #1018. The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this
job.

| AC | Tag | Criterion, in short | Test |
| --- | --- | --- | --- |
| AC1 | `#1018.a7bf0857` | five sessions in five worktrees, a fix with a 60 s base run: one base run, four claims read it as carried, verdicts within 70 s; a runner keyed by session fails naming the second base run | `hub.test.ts` |
| AC2 | `#1018.ce3898ef` | claims differing only in `src/cart.ts` share every check that leaves it out, each runs its own `journey:checkout`; a key that leaves out read files fails naming the file | `hub.test.ts` |
| AC3 | `#1018.13494a7e` | a check that needs 3 clean runs reaches PASS in a second session only once 3 distinct runs exist; a counter that counts a shared run per claim fails | `hub.test.ts` |
| AC4 | `#1018.9f44c904` | a key with a PASS from A and a FAIL from B reads INCONCLUSIVE in both claims naming both runs; a store keeping only the latest result fails | `hub.test.ts` |
| AC5 | `#1018.681b96a8` | a held-out variant's verdict carries from A's claim to B's, and neither session's tool output, evidence or verdict line holds the variant; a carry copying evidence whole fails naming the variant | `hub.test.ts` |
| AC6 | `#1018.e558130f` | budget, reference Mac only: with 10,000 keys kept, carrying adds under 5 ms at p95 to a claim's verdict compared with the merge base | `budgets.test.ts` |

Tags are derived as `scripts/proof-change.mjs` derives them: `#1018.` and the first 8 hex of SHA-256 of the criterion's
text after `- [ ] `, trimmed, white space collapsed. Each `describe` carries its tag.

```sh
npm ci                                    # once, if node_modules is missing
npm run build --workspaces                # the deep CLI the hub runs from
cargo build -p deep-hook                  # the hook binary (the suite builds it once if it's missing)
npx vitest run --root tests/acceptance/1018
node node_modules/typescript/bin/tsc -p tests/acceptance/1018/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0). On Linux, run Vitest with a Node the runner's sandbox can read: it
can't see `~/.local/opt`, so a run there comes back `refused` (on the base box, `/var/tmp/deep40/node/bin/node
node_modules/vitest/vitest.mjs run --root tests/acceptance/1018`). With `--root` here Vitest writes its cache to
`tests/acceptance/1018/node_modules/.vite/`. Delete it before committing. The tests run one after another in one file.
On the base box the whole file took about 4 minutes, mostly AC4's two-minute wait for its flip and AC1's 60 s base run.

## The surface under test

"Through a real hub" is the `deep hub run` process with deep-hook and a Claude Code stand-in, as
`tests/acceptance/29/h-d.ts` drives them (`startHub`, `Session`, `settle`, `control`, `cleanup` come from there). The
hub is handed each definition through `DEEP_HUB_TEST_DRAFTS` and the planted program through `DEEP_HUB_PLANT`. Nothing
stands in for DeepBuild: the hub, deep-hook, the record, the command check kind and Vitest are real. No network and no
model.

Each scenario, through `helpers.ts`:

1. `makeTrees` makes a world under `/tmp/dh1018-*` laid out as #29's `makeWorld` lays one out. Its repo is #31's sample
   (`SEEDED`: the cart total ignores the discount) plus the scenario's files and drafted check files, in one commit on
   `main`. It then adds N linked worktrees from that commit (`git worktree add -b session-<i>`), one per session: N
   worktrees of one repo, cut from one default-branch commit. Each worktree gets Vitest cloned into its `node_modules`
   (#875's `installVitest`; ignored by the sample's `.gitignore`).
2. The hub starts. Each session (`open`) starts in its own worktree (its hooks' `cwd`), types the scenario's prompt and
   waits for its task's definition to lock. The handed definition's requirements name the drafted checks.
3. The session reads `src/cart.ts`, writes its files and leaves them uncommitted (`writes`), then stops (`stop`). The
   stop makes the claim: a snapshot on the shared base commit.
4. `settled` waits until every claim is made and no run in the record is going. It then waits until no `run.*` or
   `verdict.made` event has come for 3 s once every claim has a verdict, or for 30 s while one has none. It reads back
   every `run.started`/`run.finished` (run, check, claim, commit, outcome), every `verdict.made` about each claim, each
   claim's line and second line from `changes.read`, and everything deep-hook told Claude Code for each session's hooks.

Every drafted check is one command line, `node_modules/.bin/vitest run <test file>`, which the command check kind runs
as it is (#875's form). Its reads are recorded by the runner's read tracer.

| Test | Sessions | Checks (requirement fields) | What the sessions write |
| --- | --- | --- | --- |
| AC1 | 5, all stopping at once | `cart-discount.sh` running `test/cart.test.ts` (`on_base: fails`, `asserts: [test/cart.test.ts:7]`) | the same `test/cart.test.ts` (on the merge base the total is 100: it waits 60 s, then fails its expect at line 7), and each its own `src/cart.ts` fix (a comment naming the session), so only the base runs share a key |
| AC2 | 2, one after the other | `price.sh` (reads `src/price.ts`), `format.sh` (reads `src/format.ts`), `journey:checkout` (reads `src/cart.ts`), all committed with their tests | `src/cart.ts` only, fixed two different ways |
| AC3 | 3, one after the other | `steady.sh` (`runs: 3`) | the same fixed `src/cart.ts` |
| AC4 | 2: A at once, B after the flip | `flaky.sh` (`runs: 2`), whose test passes until the time `test/flip.json` names | the same fixed `src/cart.ts` and the same `test/flip.json`, with the flip 120 s after A's claim |
| AC5 | 2, one after the other | `cart-fixture.sh`: `test/cart.test.ts` totals `test/fixtures/cart.json` and prints its name (`held_out`: one variant of that fixture) | the same `src/cart.ts`, which special-cases the visible fixture |

## What each test proves

- **AC1** (`oneBaseRun`): across the five claims, exactly one run of the check on the merge base. The message names the
  second base run when there is more than one. The four claims that didn't run it each read it as carried, naming it
  (`readsCarried`, below). Each claim's latest verdict is PASS (the base run proves the fix) and lands within 70 s of
  the last `claim.made`. The planted test: the runner keyed by session runs 5 base runs, and `oneBaseRun` fails naming
  the second one.
- **AC2** (`sharesButJourney`): for `price.sh` and `format.sh`, the only run across both claims is the first claim's, and
  the second claim reads it as carried. Each claim has a `journey:checkout` run of its own, and the message names
  `src/cart.ts`. The planted test first checks that price and format were shared, then that the judgement fails naming
  `src/cart.ts`.
- **AC3** (`countedOnce`): each claim after the first reaches PASS. At its first PASS `verdict.made`, at least 3 distinct
  runs of the check had already finished clean on these claims (by `log_pos`). The planted test first checks that a
  later claim read PASS before 3 distinct runs existed, then that the judgement fails.
- **AC4** (`mixedReadsInconclusive`): the key holds a clean run of A's claim and a failed run. Both claims' latest
  verdicts are INCONCLUSIVE, and each names both runs by handle. The planted test first checks that a claim read PASS or
  FAIL, then that the judgement fails naming INCONCLUSIVE.
- **AC5**, in two parts:
  - The carry (`variantCarries`): A's claim has a failed run of the check (the visible fixture passes, so that run is
    the variant's). B's claim runs nothing of that check and reads the variant's run as carried. B's verdict is A's,
    and it is not PASS.
  - Hidden (`variantHidden`): the variant is named by a random marker in its fixture, which the test prints and puts in
    its expect message. For each claim, these must not hold the marker: everything deep-hook told Claude Code for that
    session (tool output); the claim's line and second line (verdict line); its `verdict.made` data; and the bytes of
    every evidence file whose SHA-256 that data names, read from the hub's evidence store (`<root>/evidence/aa/…`).
  - The planted test: the carry holds, and the hidden judgement fails naming the marker.
- **AC6**: see `budgets.test.ts` and Open points 7.

`readsCarried(claim, run)`: the claim's verdict text names that run by its handle (`run:<id>`) and says `carried`. Its
verdict text is every `verdict.made` about it, as JSON, plus its line and second line from `changes.read`.

## Proof on a wrong program

No `twins.json` here: a twin is an overlay on the implementation, which this job never saw. The implementer adds each
planted program below to `Plant` in `packages/hub/src/plant.ts`, so the hub starts with it, and names twins under each
tag in `twins.json`. On the base the hub refuses each name (`DEEP_HUB_PLANT=… names no planted program`), so the
planted tests are BLOCKED there, never a pass. The base hub is itself the wrong program AC1 names (it keys runs by
session) and fails AC1 at its expect.

| `DEEP_HUB_PLANT` | AC | The intended wrong behavior |
| --- | --- | --- |
| `keys-runs-by-session` | AC1 | Runs are keyed by session as well as by the design's key. Nothing carries across sessions, and no run waits on another session's run, so each of the five claims runs its own base run. |
| `key-leaves-out-reads` | AC2 | The key leaves out the contents of the files a check's runs read. It is the check digest, the declared inputs, environment and tools (plus merge base and own files for a base run), so `journey:checkout` carries to the second claim although `src/cart.ts` differs. |
| `counts-shared-run-per-claim` | AC3 | A run on a key counts once for each claim that reads it, not once, toward the clean runs a claim's check needs. A shared run read by three claims counts 3, so a claim passes on fewer than 3 distinct runs (on one run, in the issue's words). |
| `keeps-latest-result-per-key` | AC4 | The shared store keeps only the newest result per key. A claim reading the key sees one run, so it reads PASS or FAIL instead of the flaky key's INCONCLUSIVE. |
| `carry-copies-evidence` | AC5 | Carrying a result to another claim copies the source run's evidence whole into the reading claim's verdict, a held-out variant run's output included. |

## Open points: readings this suite chose

1. **How "carried, naming the run" shows.** The issue says a carried result "is marked carried and names the run, its
   claim and its session". The design says a verdict lists the runs it counted by handle, and that a carried result
   shows as carried. The tests read the reading claim's `verdict.made` data (any field) plus its line from
   `changes.read`. That text must hold the word `carried` and the source run's handle (`run:<id>`). Naming the source
   claim and session is in the issue's Scope, not its criteria, so it isn't asserted.
2. **What "one base run runs" counts.** A run is a base run when its `run.started` names the check and the merge base as
   its `commit`. The criterion is read as one such run across the five claims, owned (`claim`) by one of them. The four
   others read it as carried. Each claim's own `src/cart.ts` differs, so their head runs don't share a key; that keeps
   the count to base runs. The verdicts' "land" is the latest `verdict.made` about each claim, whose `ts` must be within
   70,000 ms of the last `claim.made`'s `ts`. Each must be PASS, since the base run proves the fix.
3. **`runs` on a requirement.** The handed definition has no field for a check's clean runs at base. The tests add
   `runs: 3` (AC3) and `runs: 2` (AC4) to the requirement in `DEEP_HUB_TEST_DRAFTS`, beside its `check`, with the
   design's meaning ("A check that declares neither `runs` nor `accept` needs one clean run"). The hub must carry it to
   the verdict engine's `ClaimCheck.runs`, as it already carries `expected_ms` and `deadline_ms`.
4. **Who starts the runs a key still needs (AC3, AC4).** The criteria need a claim's own run on a key that already holds
   a result. In AC4, session B makes a FAIL on a key where session A's PASS already stands. With one run per key, that
   happens only when A's result left the key short of the clean runs its check needs. So the tests read the design this
   way: a claim on a key that is short of clean runs adds runs to it. A key's clean runs come from every claim on it, and
   a claim's verdict is made again as runs on its key land.
   - AC3's three claims come one after another. Each comes once the record shows no run going, so each can add a run.
     The second claim must reach PASS only once the third run exists.
   - AC4 sets A's flip 120 s ahead. If A's runs don't all pass before the flip, the test is BLOCKED, not judged.
   - A program that starts all of a claim's needed runs at once for the first claim also meets AC3's judgement.
   - In AC4, such a program leaves the key all PASS before B claims, so there is no FAIL and the test fails at its first
     expect. AC4's own words ("one PASS from session A and one FAIL from session B") rule that reading out.
   - The FAIL run's owning claim isn't asserted, only that A's claim has a PASS run on the key and the key has a FAIL.
5. **Held-out variants (AC5).** No held-out variants exist at the base. The handed definition gives a requirement
   `held_out: [{ files: { <path>: <bytes> } }]`: a variant is the check run with those files written over the claim's
   checkout. Per the design, the variant is kept beside the locked definition and never sent to the agent, and its run
   counts as a run of its check.
   - The variant run is told apart from the visible run by its outcome alone. The session's fix special-cases the
     visible fixture, so the visible run passes and the variant's fails (the design: such a change "fails its unseen
     twin").
   - "Evidence a claim may show" is read as the evidence files its `verdict.made` names by SHA-256. A variant run's own
     output stays in the store as that run's evidence, which no claim's verdict names.
   - Tool output is everything deep-hook printed for the session's hooks, the stop's reply among them.
6. **`journey:checkout`.** The check's ID is its path, `.deepbuild/checks/journey:checkout`. It is a command check like
   the others, depth `unit`, and needs no stack. The criterion is about which files its runs read, not about a stack.
   The issue's "stack served another tree" rule has no criterion of its own and isn't tested here.
7. **The budget (AC6).** Off a reference Mac it skips as INCONCLUSIVE (`environmentProblem` from #29's helpers), and
   it never passes by skipping. On one:
   - The 10,000 kept keys are copies of a real run's `run.started` and `run.finished` events, each under another check
     ID, appended to the hub's record while the hub is stopped.
   - Each of 5 samples, after a warm-up, has one claim whose change the check reads, so its check runs as on the merge
     base. A second session's identical claim then carries that run.
   - What carrying adds is the carried claim's claim-to-verdict time less the first claim's claim-to-verdict time
     apart from its runs' own time. The merge base has no cross-session carry to time, so the claim that runs its check
     stands for the merge base's way.
   - It is judged by the design's timing rule against 5 ms. All five within the limit is PASS, which is at least as
     strict as a p95 over five.
8. **Load.** AC1's 70 s holds only if the five snapshots, checkouts and head runs fit in about 10 s beside the 60 s base
   run. On a heavily loaded machine that can fail with the feature in place. Rerun AC1 alone on a quieter machine before
   calling that a regression. The base run in `BASE-FAILURE.txt` failed at the count, before the timing.
9. **Temp folders.** Worlds are under `/tmp/dh1018-*` and are removed after each test. Importing #31's helpers makes a
   temp home under `/tmp/dh31-home-*`, which their `afterAll` removes.

See `BASE-FAILURE.txt` for each test's failure on the base.
