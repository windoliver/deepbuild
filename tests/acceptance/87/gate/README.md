# Acceptance tests for #87 (gate): review notes, Closes, post-close review passes and the review replay lane

Issue #87, "Check kinds: review by a second model, and numbers re-run against their source", is split across four
blind jobs. This folder is the **gate** slice: the done gate's Closes or Part-of decision, open items from the PR's
review notes, the review passes that found bugs after a close, the preflight's replay lane on a change to the review
check, and the verdict rule that no PASS rests on a model's judgment alone. The `review` job's folder defines the
review check's findings, rubric, send-backs and rounds (its fixtures in `tests/acceptance/87/review/`), and the
`models` job's defines model identity; this slice depends on neither's files and uses names of its own.

Written first, blind, by a job that never saw an implementation of #87. Sources:

- **The issue**: its text as given to this job (Scope, Fields, the 24 checkbox criteria, Proof, Depends on).
- **The design**, `docs/technical-design.md`: In version 0 (the review check); How runs become one of five verdicts;
  the Check primitive ("It can never: Produce a PASS on a model's judgment alone"); What done means, fixed at the
  start, with Done means switched on ("Review notes on the PR … become open items") and Closes or Part of; Open items
  as records (an item closes on evidence, your answer or a rule); Threats; How we know version 0 works: Conformance
  tests, Wrong programs, Dogfooding, "Verdict changes are shown before merge" (replays on the merge base and the
  change, a list that merges only with the maintainer's yes), and the Readings for Decision 1.
- **`AGENTS.md`**, and the base commit's code, read for its surfaces only: `packages/verdicts` (`engine.ts`'s oracle
  rule from #68), `packages/hub` (`open-items.ts`: review threads as open items, #323; `core.ts`: `closesGate`, which
  refuses a `gh pr create` saying `Closes #n` while a requirement is unproven, #322; `forge.ts`), `scripts/proof.mjs`
  and `scripts/proof-suites.mjs` (the replay lane, #569), and the suites of #68, #322, #323 and #569.
- **The base commit**: `29d29ba5` (main).

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH`, `ssh-keygen` and git 2.34 or newer (SSH-signed tags), and the Rust toolchain:

```sh
npm ci                                   # once
npm run build --workspaces               # the hub and the deep CLI that review-notes.test.ts starts
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/87/gate --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/87/gate/tsconfig.json
```

No network, no model, no paid call, no `gh` login. GitHub's answers are recorded (`DEEP_HUB_TEST_GITHUB`, #323's
format); the second model is a planted reviewer function or a stand-in package in a scratch repository. Every test
works in its own temporary folders and removes them. `review-notes.test.ts` starts a hub, so the folder belongs on
`scripts/lanes.mjs`'s one-at-a-time list (`alone`), beside #322's and #323's; the implementer adds it. It reuses
#322's and #323's helpers (their hub, sessions, recorded GitHub answers and open-item readers), which those suites
keep and nobody edits; their processes are stopped by PID only.

## The surface under test

The issue names the gate's behaviour but no code API for two of these criteria, so the tests define the smallest
one they need, in the new workspace package `@deepbuild/checks-review` (`packages/checks-review/src/index.ts`). The
package is imported lazily, so each test fails on its own at the base. These names are this slice's; the review and
models jobs define the package's other exports.

```ts
// @deepbuild/checks-review — packages/checks-review/src/index.ts (new workspace package), the gate slice's names

/** A finding of a review pass, as the second model's job returns it through the runner. */
export interface PassFinding { file: string; line: number; rule: string; quote: string }
/** One review job of a pass on one diff: the second model behind the runner in production, a planted reviewer in
 *  these tests. `diff` is the unified diff (`git diff <base> <head>`); `commit` is the diff's head commit. */
export type PassReviewer = (job: { pass: string; prompt: string; commit: string; diff: string }) => Promise<PassFinding[]>;
/** A review pass that found bugs after a close in this repo (research against outside references, a code audit):
 *  its prompt, and each closed PR it found bugs in after the close, by that PR's diff (base..head) and the bugs'
 *  sites. */
export interface PostClosePass {
  id: string; name: string; prompt: string;
  found: { pr: number; base: string; head: string; bugs: { file: string; line: number }[] }[];
}
/** A reading for Decision 1's numbers (#43): how many of a pass's post-close bugs it finds again over its sample of
 *  PRs. Never a verdict: it carries no outcome. */
export interface PassReading { measure: 'post-close review pass'; pass: string; found: number; of: number; prs: number[] }
export interface PostCloseReport {
  /** Each pass's findings on the claim's own diff, base..head: they join the review check's findings before Closes. */
  claim: { pass: string; findings: PassFinding[] }[];
  /** Each pass replayed on each PR it found bugs in: how many of that PR's bugs it found again. */
  replays: { pass: string; pr: number; head: string; found: number; of: number }[];
  readings: PassReading[];
}
/** The review check's run before "Closes": every pass on the claim's diff, and every pass on the diff of each PR it
 *  found bugs in after the close. A bug counts as found when a finding of the pass on that PR's diff cites its file
 *  and line. */
export function reviewBeforeCloses(o: { repo: string; base: string; head: string; passes: PostClosePass[]; reviewer: PassReviewer }): Promise<PostCloseReport>;

/** One case of the review replay: its repo path and the findings the review check sends back on it. */
export interface ReplayedCase { case: string; findings: PassFinding[] }
/** The review replay the preflight's replay lane runs on each side, merge base and change: this checkout's review
 *  check over the cases the checkout at `root` holds (this issue's planted-bug diffs, their clean twins and the
 *  recorded review rounds). */
export function replayReview(root: string): Promise<ReplayedCase[]>;
```

And three changes to surfaces the base has:

1. **The verdict engine** (`@deepbuild/verdicts`, `verdict`) keeps #68's rule: a requirement covered only by a check
   whose oracle is a model, and a requirement whose own oracle is a model, are never PASS. Nothing to add.
2. **The hub's Closes gate** (`core.ts`'s `closesGate`, at PreToolUse through deep-hook) also gates
   `gh pr edit <n> --body "…Closes #n…"`, as it gates `gh pr create`. `gh pr edit` stays outside the send class:
   it is the agent's own PR text, as `gh pr create` is. It refuses Closes while an open item of the issue's task that
   came from a review note on the claim's PR is open, and the refusal names each such note, by its thread's node ID
   (`PRRT_…`), its first comment's link (`#discussion_r<id>`) or its words. A note is a review thread, by a person
   (`maya`) or a review agent (the Codex review agent, whose GitHub login is `chatgpt-codex-connector`). Its item
   closes when it is fixed, which here is the reviewer resolving the thread after the agent's change (#323's rule),
   or when you accept it.
3. **Each review note's open item reaches you through an ask** (`ask.created`) whose data names the note, with an
   option whose `id` or `label` matches `/accept|waive|won.?t[ -]?fix|out[ -]of[ -]scope/i`. Your answer through
   `deep inbox answer` with that option closes the item (`open_item.closed`).
4. **The replay lane** (`node scripts/proof.mjs replay`, which the local preflight runs as `scripts/proof.mjs`, #569)
   also runs when the change touches `packages/checks-review/src/` (the review check's prompt, its finding filters,
   the model it asks for by default). On each side, the merge base's temporary checkout and the change, it loads
   `packages/checks-review` through its `package.json` `exports`, as it loads the verdict engine, and calls
   `replayReview` with a checkout holding the cases. Each finding, keyed by case, file, line and rule, that one side
   has and the other hasn't prints one line in #569's form:
   `FAIL replay: <case path>: finding <rule> at <file>:<line>: on the merge base, not on the change` (it disappears),
   or `…: on the change, not on the merge base` (it appears). The tests require the case path, the rule, `file:line`
   and that closing phrase on one line; the words between are the implementer's. The list ends, as the verdict
   replay's does, with `FAIL replay: <k> differences need the maintainer's yes (list sha256:<64 hex>)`, and the
   maintainer's yes is #569's SSH-signed approval tag on HEAD holding `Approves: replay sha256:<that hex>`; with it
   every line prints as `PASS replay: …` and the lane passes. A finding that doesn't move isn't listed.

## Readings where the issue leaves a choice

- **AC3 is already the engine's** (#68). At the base its test passes; it stays as the regression guard. Its wrong
  program is a planted engine that reads no oracle (every check and requirement taken as code's), the engine before
  #68; that engine passes the review alone, and the test fails on it. The test says only "never PASS"; which verdict
  (INCONCLUSIVE at the base) is the implementer's.
- **"Review notes"** are the PR's review threads, as #323 reads them. A review's summary body and a plain PR comment
  have no fixture here. "A review agent" is told apart from a person by nothing but its login; both are notes.
- **"Fixed"** is the evidence #323 already closes a thread's item on: a reviewer (anyone but the session's own
  account) resolves the thread, here after the agent changed the line. "You accept it" is your answer to the note's
  ask. The agent's word, or its own account resolving the thread, fixes nothing (#323's suite holds that).
- **Where the PR says Closes.** The PR is opened as `Part of #7` before review; Closes comes later by editing its
  body, so the gate gates `gh pr edit`. A merge whose PR body says Closes is not driven here.
- **The post-close passes** are the function's input. Where the repo keeps them (its wiki, its record of bugs found
  after a close) and how the done gate calls `reviewBeforeCloses` before Closes are the implementer's; the hub has no
  test-side reviewer, so this criterion is held at the package's entry with the second model planted. A PR's
  "commits" are its diff, base..head. "Decision 1's numbers (#43)": #43 has no code at the base, so the reading is
  the report's `readings`, which #43 will read; the test holds that it carries counts and no outcome or verdict word.
- **The replay's cases.** `replayReview(root)` lists and runs the cases itself, so the lane needs no knowledge of the
  review job's fixture format. The scratch repository keeps its cases where the issue's are,
  `tests/acceptance/87/review/`, and they are the same on both sides, so whether the lane passes each side the
  change's checkout, the merge base's or both is the implementer's. How the real package's replay reaches a model
  with no paid call (recorded answers keyed by the prompt, or a run on the reference Mac) is the implementer's too;
  in the scratch repository the stand-in package is both the check and its model.
- **The lane's name.** The review replay joins the `replay` lane, the design's "Verdict changes are shown before
  merge", whose list and yes it shares.

## Wrong programs

| Criterion | Wrong program | How |
|---|---|---|
| AC3 | an engine that reads no oracle (before #68) | test-side twin over the real engine, `model-pass.test.ts`; the test fails where it gives the review alone PASS |
| AC8 | the base: `gh pr edit … Closes #7` is not gated, and no ask accepts a note | `BASE-FAILURE.txt` |
| AC10 | a check that doesn't run the passes on PR 71's commit | test-side twin: the real function given each pass's PRs without 71, judged against the repo's passes; the failure names PR 71 |
| AC21 | a preflight that replays only the verdict engine's cases (#569) | the base's `scripts/proof.mjs`, which prints "replay: not run" on a change to the review check and passes |

## Criteria to tests

Each test name and failure message starts with its criterion's number and ID, `#87.<first 8 hex of SHA-256 of the
criterion's text>`, trimmed, white space collapsed, `- [ ] ` dropped (the repo's normalization, #569).

| ID | Criterion (short) | Test file | What the test does |
|---|---|---|---|
| AC3 `#87.f9b06470` | a PASS resting only on a model's judgment is refused | `model-pass.test.ts` (2) | one requirement, one check, one clean passed run: code oracle PASS (control); review oracle model, not PASS; requirement oracle model, not PASS; the oracle-blind engine fails it |
| AC8 `#87.85a2cd4f` | review notes on the PR are open items; Closes only after each is fixed or you accept it | `review-notes.test.ts` | issue 7, R1 passes, PR 21 Part of #7 with notes by maya and the Codex review agent: both items; `gh pr edit 21 --body "Closes #7"` refused naming both; maya fixes and resolves hers: refused naming only the agent's; you accept it through its ask: allowed |
| AC10 `#87.52ef7a04` | before Closes, each post-close review pass runs; its replay on those PRs is a reading; a pass not run on one fails, naming the PR | `post-close.test.ts` (2) | research (PRs 64, 71) and an audit (PR 71) run on the claim's diff and each PR's diff; readings 1 of 2 and 2 of 2, no outcome; the skip-71 twin fails naming PR 71 |
| AC21 `#87.7649e9da` | a change to the review check's prompt replays planted bugs, twins and rounds on both sides; every moving finding listed; no merge without the maintainer's yes | `replay-lane.test.ts` | scratch repo, stand-in review check; the prompt change drops the planted bug's finding (src/config.ts:3) and adds one to the round (src/cart.ts:12); its own test passes; the lane fails listing both with both runs and not the twin; the maintainer's yes on the list's digest passes it |

## What this suite could not encode

- **The done gate calling the post-close passes** (AC10's "Before Closes") through the hub: it would need a test
  reviewer inside the hub; the criterion is held at `reviewBeforeCloses`.
- **A review note outside a review thread** (a review's summary, a PR comment), and a note left after merge.
- **The real replay over the review job's fixtures**: the lane is driven with a stand-in package, as #569 drives the
  verdict replay with a stand-in engine.

## Files

- `helpers.ts`: criterion IDs, the lazy import of `@deepbuild/checks-review`, temporary git repositories, and the
  replay lane's scratch repositories, SSH-signed approvals and proof runner.
- `model-pass.test.ts` (AC3), `review-notes.test.ts` (AC8), `post-close.test.ts` (AC10), `replay-lane.test.ts` (AC21).
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
