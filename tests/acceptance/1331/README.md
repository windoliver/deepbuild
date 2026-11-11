# Acceptance tests for #1331: landing in turn

Written first, blind, from issue #1331 (Scope, the eight criteria, Proof, Depends on), `AGENTS.md`, the design sections
the issue links (Attempt and plan; How runs become one of five verdicts, in full, Pinned to a commit and Carried across
sessions especially; Sessions that know about each other; the Work runs and Landing in turn bullets; Dogfooding),
`docs/parallel-proof.md` 12a and 12b, and base commit `f38d2b3983496ca502cb4743fda249bbc2e5b162`. The base has no
implementation of #1331. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

| AC | ID | Criterion, in short | File |
| --- | --- | --- | --- |
| AC1 | `#1331.4fa5b9e9` | three changes with a PASS land one at a time, in PASS order, each on a head its verdict covers; a landing of a commit the gate didn't judge fails, naming the commit | `landing.test.ts` |
| AC2 | `#1331.13b15250` | after another change lands, a change touching other files re-runs only checks whose keys changed; a lander that re-runs everything fails, naming a carried check | `carry.test.ts` |
| AC3 | `#1331.6af520ad` | a change that now conflicts goes back to its own attempt within 60 s with the files named, and raises no ask | `conflict.test.ts` |
| AC4 | `#1331.df47d8f0` | an issue stays open until its change lands; a closer acting on the PR's opening fails, naming the issue | `closing.test.ts` |
| AC5 | `#1331.493ec9f5` | budget-only change lands, its issue stays open naming the requirement; open FAIL, INCONCLUSIVE or BLOCKED elsewhere doesn't land | `budget.test.ts` |
| AC6 | `#1331.1f3c4595` | a PR from before the run joins as its issue's attempt, no second attempt starts; a PR idle past 7 days is listed, none is closed | `join.test.ts` |
| AC7 | `#1331.2bc8d32a` | a forge that says merged but drops a file: the read-back names the file within 60 s, landings stop; a lander trusting the forge's state fails, naming the commit | `readback.test.ts` |
| AC8 | `#1331.ae56ff0d` | a landing whose tree equals its verdict's tree starts no check run and raises no ask | `landing.test.ts` |

The Proof (three real changes landed on this repo) is by hand. No live test is written, so nothing here can touch GitHub.

## Redraft: two helper defects

Dispute on the first draft: two helpers in `helpers.ts` made tests fail whatever the implementation did, because of
facts of the base code. Both are fixed; no criterion's reading, expected value, assertion, message, plant or test
file changed.

1. **Every handed definition needed an ask to lock.** `requirement()` set `source_line: 'issue#L1'`. At the base,
   `lock()` in `packages/hub/src/ask-tasks.ts` reads a requirement's author from the reading its `source_line` names;
   `issue` names none (the hub's work file holds `readings: []`), so the author was `unknown`/`outside`, and text from
   an outsider adds a requirement only after one ask whose default leaves it out. No definition locked as handed and
   no check ran. It now says `source_line: 'ask#L1'`, which the base reads as you: the world is the one the issue
   needs, a run you approved, with no ask about who wrote a requirement.
2. **AC5's INCONCLUSIVE case could never read INCONCLUSIVE.** The `flaky` check appended to `<world>/flip`, outside
   the check's checkout. A command check's sandbox writes only its checkout and its own temp folder, and each run gets
   a fresh checkout, so the append was refused, every run failed alike, and the check read FAIL. Now the check writes
   nothing outside its temp folder. It takes its turn from the size of `<world>/flip`, which a run may stat (the
   sandbox allows reading metadata of any path), and leaves a marker in its own temp folder. The world's watcher
   (`World.watch`, a 10 ms poll, stopped in `close()`) adds one byte to `flip` for each marker naming this world's
   `flip`. So runs on one commit go pass, fail, pass, ...; a check needing 2 clean runs gets one of each and reads
   INCONCLUSIVE. It is still a test that fails by `expect(n % 2).toBe(1)` for the turn it is, never for a helper.

## Redraft 2: the planted drop

Second dispute, on `forge.ts`, not `helpers.ts`; the first redraft stands. It made AC7 fail whatever the implementation
did, because of a fact of git at the base. No criterion's reading, expected value, assertion, message, plant or test
file changed.

- **The defect.** `LandForge.merge()` made the planted forge's dropped commit in the bare repo with `git read-tree` into
  a temporary index, `git update-index --force-remove -- <path>`, `git write-tree` and `commit-tree`. `update-index`
  refuses to run in a bare repository with no work tree (exit 128, "this operation must be run in a work tree"), and
  the helper ignored every exit code. The tree it wrote still held the file, so the "dropped" commit had the same tree
  as the real merge, and `readback.test.ts` failed at its own precondition (`the planted forge did not drop
  docs/added-by-first.txt`) before it judged any lander.
- **The change.** The drop runs `update-index` with `GIT_WORK_TREE` set to an empty temporary directory (never written
  to, removed afterwards, as is the temporary index), which `update-index` accepts. Every git step of the drop now
  throws, naming the step, its exit code and its output, if it exits non-zero; the merge call then answers 500 instead
  of a silent no-op.
- **Checked on its own** at the base with a throwaway script: a `LandForge` with a branch adding
  `docs/added-by-first.txt` and a second branch adding `b.txt`, `drop: { nth: 2, path: 'docs/added-by-first.txt' }`, two
  merges. Both answered `merged: true`; the first merge's tree held `a.txt` and the file, the second's held only `a.txt`
  and `b.txt`, and `main` pointed at it.

## Redraft 3: must is an assertion

Third dispute, on `helpers.ts`; the first two redrafts stand. The repo's proof lanes count a tagged test as proving its
criterion only when it fails at an assertion (an `AssertionError`, code `ERR_ASSERTION`, or a vitest `expect` failure).
`must()` threw a plain `Error`, so the AC4, AC6 and AC7 tests, whose base failures come through `must`, read "failed
before its assertion" and could never be counted, whatever the implementation did. No criterion's reading, expected
value, message, plant, test file or other helper changed.

- **The change.** `must(ok, message)` now throws `new AssertionError({ message })` from `node:assert`. The message is
  exactly the same string. `AssertionError` extends `Error`, so `mustFail` (which reads `error.message`) is unaffected.
- **Why it weakens nothing.** `must` throws under the same condition (`!ok`) with the same text; only the error's
  class changes, so a wrong program still fails each test and a right one still passes it.

## Run

```sh
npm run build --workspaces                # the deep CLI the hub runs from
cargo build --locked -p deep-hook         # the hub refuses to start without it
npx vitest run --root tests/acceptance/1331
node node_modules/typescript/bin/tsc -p tests/acceptance/1331/tsconfig.json
```

Run the folder alone: every test starts its own hub, forge and world under `/tmp/dh1331-*` (removed at the end), with
HOME set there. Vitest with `--root` leaves `tests/acceptance/1331/node_modules/.vite/`; delete it before committing.
Use the repo's Node. Files run one after another; at the base the whole folder takes about 10 s, and on a right
implementation each file runs real Vitest checks and two worlds (the plant's), so allow several minutes per file.

## What is real, what is played

Real: the hub (`deep hub run`), its record and gate runs and carrying, deep-hook, git, Vitest, `scripts/main-watch.mjs`.
Played, at boundaries the repo doesn't own: the forge (GitHub), on 127.0.0.1 (`forge.ts`, layered on #1325's
`tests/acceptance/1325/forge.ts`, imported by path, which holds bare repos, git over HTTP, PRs, statuses and merges), and
the agents (`claude` and `codex` first on PATH: they record that they were started in `$HOME/claude.log` and do nothing).
The hub reaches the forge through `DEEP_HUB_TEST_FORGE` and maya's admin token in `GH_TOKEN`, as #1325's world does.
The forge adds what #1331 needs and #46/#1325 lack: issues and comments, a PR's body, author and activity time, merged
and closed state, GitHub's closing keywords on a merge (`Closes #n` closes the issue at the merge), and the planted
file drop (`drop: { nth, path }`: the nth merge answers `merged: true` after the forge removed one file from its commit).
It also records whether two merges were ever in flight at once, and every call.

## The world

`helpers.ts` makes `acme/shop`: `src/x1.ts`, `x2.ts`, `x3.ts`, `c.ts`, and Vitest checks `.deepbuild/checks/<name>.sh`
(one line, `node_modules/.bin/vitest run test/<name>.test.ts`, as #1018 does). `own1..3` each read their `src/x<i>.ts`;
`c` and `cc` both read `src/c.ts` and differ as check definitions; `flaky` fails on every second run (a counter file in
the world); a source holding `BROKEN` fails its check. Each issue's requirements are handed to the hub through
`DEEP_HUB_TEST_DRAFTS` (#29's mechanism) with the form `issue: "acme/shop#<n>"`. The hub's checkout is a clone of origin
with Vitest installed. A PR is opened with `Closes #n` (or `Part of #n`) in its body. Issue numbers start at 100 and
PR numbers at 1, so the two never collide.

## Surfaces assumed (the issue leaves them open; this is the smallest set that makes each criterion observable)

1. **`deep land judge --repo <checkout> --json`**: the hub judges each open PR that links an issue, on its merge with the
   default branch's head, in PR order, through the gate: it runs the issue's checks (carrying where keys are equal),
   posts the `deepbuild/verdict` status (#46) on the commit it judged, records the PASS's order, and lands nothing. It
   makes a PASS exist before the landing, so AC2's "re-runs only what the move changed" has an earlier verdict to carry from.
2. **`deep land --repo <checkout> --json`**: one landing round. For each PASS in the order they came: if the head moved or
   the branch got a new commit since its verdict, judge the merge again (carry what keys allow); land it through the
   forge's merge call, one at a time; close its issue (the forge's keyword close or the hub's own call, either); read the
   default branch back and compare trees. It exits 0 when it ran, and prints one JSON line:
   `{"held":[{"pr","issue","reason"}],"sent_back":[{"pr","issue","files":[...]}],"stopped":null|{"commit","files":[...]}}`.
   `reason` names the outcome word (`FAIL`, `INCONCLUSIVE`, `BLOCKED`). `stopped.files` names the files that differ.
3. **`deep work --repo <checkout> --issues <n,...> --once --json`**: one pass of a run over a fixed set, approved under the
   test stand-in. It prints `{"tasks":[{"issue","attempts":[{"pr"}]}],"stale":[{"pr"}]}`: a PR from before the run joins as
   an attempt of its issue, and PRs idle more than 7 days that join nothing are listed under `stale`.
4. **Observed without the hub's cooperation** (so a wrong implementation can't dodge them): the forge (what merged, in
   what order, whether merges overlapped, issue state and comments, calls that close a PR), main's first-parent line and
   trees in the bare repo, the `deepbuild/verdict` statuses and what commits they sit on, the record's `run.started`
   and `ask.created` events (`events.read` over the hub's socket, as #1018 reads them), and
   `node scripts/main-watch.mjs status` run in the hub's checkout (#1333's gate: `landings paused` and exit 1 for a red main).
5. A requirement only a budget window can settle is drafted `settled_by: "budget-window"` with no check. The issue names
   it by its text; the test accepts the issue's body or comments holding the requirement's text.
6. A "send-back to that issue's attempt" is read from `sent_back` in the round's JSON; the hub's record event for it
   isn't assumed. "Raises no ask" is no new `ask.created` event.
7. "Each on a head its verdict covers": each landed commit's tree equals the tree of a commit with a success verdict
   status posted before that landing began (the landed commit may be the merge commit the forge makes; the design
   compares trees).

## The planted wrong programs

Each is a value of `DEEP_HUB_PLANT` that the implementation adds to `packages/hub/src/plant.ts` (as #1325's and #1333's
twins are), and each test first runs the right program, then the plant, and requires the same judgement to fail on the
plant, naming what the criterion names:

| Plant | Wrong behavior | The failure names |
| --- | --- | --- |
| `lands-unjudged-commit` | merges the branch's current head though the gate judged an older one (AC1 pushes one more commit to #1's branch after its verdict) | the landed commit's sha |
| `lander-reruns-all` | re-runs every check when the head moved | `own2`, the carried check |
| `closes-on-open` | closes the issue when the PR is opened or judged | the issue (`#100`) |
| `second-attempt-beside-pr` | starts a second attempt for an issue that has an earlier PR | the issue (`#100`) |
| `trusts-forge-merged` | takes the forge's merged state for the landed tree, with no read-back | the dropped commit's sha |

## What fails at the base, and why

At `f38d2b39` all 8 tests fail, each at its own assertion (`BASE-FAILURE.txt`): `deep land` and `deep work` are
"Unsupported command", so no change lands (AC1, 2, 3, 5, 7, 8: the exit code or the landing count; AC4: the fine change
didn't land; AC6: the run lists no attempt for the issue). Missing, in all: the landing queue, the merge-head judgement
with carrying across landings, the conflict send-back, issue closing on landing, the budget exception, joining an earlier
PR, the tree read-back and the stop, and the five plants. The world itself (forge, hub, checkout, PRs) sets up on the base.

Needs (built here, not assumed): `cargo` is not on this Mac's PATH; the Rust toolchain at
`~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin` built deep-hook. `node scripts/affected.mjs <this folder's files>`
selected the whole repo's suites (the helpers import #29, #875, #1325), and the run was dominated by failures that
`known-failures.json` doesn't list on this Mac (83 new, none in this folder but its own 8); it isn't a clean signal here.

Not covered, because no criterion asks: the gate-identity credential of the merge (#1325), the run's page, `Part of`
merge handling beyond AC5, and the stale-PR list's wording (AC6 checks only the 7-day boundary the issue names).
