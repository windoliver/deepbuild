# Acceptance tests for #87, part `review`: the review check

Written first, from issue #87 ("Check kinds: review by a second model, and numbers re-run against their source"), its
scope, fields, acceptance criteria and Proof line, and the design sections it links and those around them, all in
`docs/technical-design.md`: In version 0; How runs become one of five verdicts (Where, not just what; Whose checks
count; One cause, one send-back; Open items as records; Numeric contracts); Reading by reference (the quote rule);
the Check primitive; What done means, fixed at the start; Plan usage, per account and per task; Threats (Hostile
text in what DeepBuild reads); and How we know version 0 works (Conformance tests, Wrong programs, Dogfooding). The
house pattern is `tests/acceptance/68/` and `tests/acceptance/685/`. The base is commit `29d29ba5` (origin/main),
where these surfaces were read: `packages/conformance` (the `check.kind@1` slot types and its one runner, `runKit`),
`packages/verdicts` and `packages/checks-work` (#68's kinds, as a pattern). The job never saw an implementation. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Four blind jobs split #87's criteria; this one holds the review check's: a planted bug as one send-back, the kind's
`check.kind@1` kit, dropped findings and the reviewer's prose, the 20-round Codex replay, the planted reviewer and the
model-only requirement, quotes and rules checked, re-review rounds, one item per rule, pre-existing lines, and how
each sent-back finding ended. The model's identity (which model answered, same model or family, proxied routes, the
plan-window reserve) is the `models` job's; numbers are the `numbers` job's; the done gate, PR notes, past review
passes and the prompt-change replay are the `gate` job's.

## Environment and running

Node 24.22.0 (the repo's `.node-version`) and git. Nothing else: no network, no model, no paid call. The second model
is never called: where its job would answer, a test passes a reviewer function (below).

```sh
export PATH=$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH
npx vitest run --root tests/acceptance/87/review --testTimeout=600000
npx tsc -p tests/acceptance/87/review/tsconfig.json
```

Each test builds real git histories in temporary folders (`history()` in `helpers.ts`), removed when its file ends.
The test's own git calls ignore the machine's git config; the check's run in the test's environment as it is.

## The surface under test

The issue names a review check, its send-back, its rubric, rounds and outcomes, but no code API, so these tests
define the smallest one they need: one new workspace package, `@deepbuild/checks-review`
(`packages/checks-review/src/index.ts`), holding the review kind as a `check.kind@1` fill with its own kit, and the
record of how each sent-back item ended. It is imported lazily, so each test fails on its own at the base. The core
is reached through public entries: `runKit` and the slot types in `@deepbuild/conformance`, `verdict` and its claim
shapes in `@deepbuild/verdicts`. Another job (`models`) may add the model-identity surface to the same package; these
names keep to findings, rubric, send-backs, rounds and outcomes.

```ts
// @deepbuild/checks-review — packages/checks-review/src/index.ts (new workspace package)
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec, SlotKit } from '@deepbuild/conformance';

/** check@1's spec for kind `review`. The change under review is `git diff <base> <head>` in the checkout on a claim's
 *  first round (`since` null); on a re-review it is `git diff <since.commit> <head>` alone, and `since.items` are the
 *  items sent back on this claim still open. `rubric` is the wiki's rubric page: a Markdown file whose list items
 *  `- <rule>: <text>` are its rules, in order. */
export interface ReviewSpec extends CheckSpec {
  kind: 'review'; runner: 'second-model'; oracle: 'model';
  base: string; head: string; rubric: string;
  since: { commit: string; items: SendBackItem[] } | null;
}
/** What the second model is given: the diff alone, as `git diff` prints it by default (`a/` and `b/` prefixes, three
 *  lines of context), and the rubric's rules as `<rule>: <text>`, in order. Never the session's transcript, the
 *  agent's claim or PR text. */
export interface ReviewRequest { diff: string; rubric: string[] }
/** The second model's structured answer, as its job's output parses: findings, each meant to carry `file`, `line`
 *  (on the new side of the diff), `rule` and `quote`, beside whatever prose it adds (titles, bodies, an overall
 *  explanation), which is never trusted. */
export type ReviewerAnswer = { findings: unknown[]; [field: string]: unknown };
/** Where the second model's job answers: live, the runner's job (#159); in these tests, a planted or recorded function. */
export type Reviewer = (request: ReviewRequest) => ReviewerAnswer | Promise<ReviewerAnswer>;

/** A cited place: the file, its line on the reviewed side, and the quoted text. */
export interface Site { file: string; line: number; quote: string }
/** A finding that counts: a rubric rule at a site. */
export interface ReviewFinding extends Site { rule: string }
/** One item of a send-back: one rule and every site of it, each once, so the agent fixes the class. */
export interface SendBackItem { rule: string; sites: Site[] }
/** What goes back to the working agent: structured items, none of the reviewer's prose. */
export interface ReviewSendBack { items: SendBackItem[] }
/** A finding dropped and counted in the run's output: its four fields as the reviewer gave them (any may be missing
 *  or of another type), and why. */
export interface DroppedFinding { finding: { file?: unknown; line?: unknown; rule?: unknown; quote?: unknown }; reason: string }

/** A review run. A finding counts only when it has a file, line, rule and quote, its quote is at that file and line
 *  of the diff read (the quote rule of Reading by reference: a substring after NFC and collapsing white space), and
 *  its rule is one of the rubric's; any other is dropped and counted. A counted finding on a context line, one the
 *  diff didn't add or alter, is a follow-up, never sent back. A counted finding whose rule and quote match an item
 *  in `since.items` isn't sent again; that item stays open. The rest go back as one send-back, one item per rule
 *  listing every site: outcome `failed`, its failures naming each item's sites by file and line. With nothing to send
 *  back the outcome is `passed` and `sendBack` null; the core never makes PASS of it alone (the oracle is a model). */
export interface ReviewResult extends CheckResult {
  sendBack: ReviewSendBack | null;
  /** Items sent back on this claim earlier and still open after this round, not sent again. */
  open: SendBackItem[];
  /** Counted findings on lines the change didn't add or alter: pre-existing. */
  followUps: ReviewFinding[];
  dropped: DroppedFinding[];
  /** The review's part of the claim's verdict line; each follow-up shows on it as pre-existing, at `file:line`. */
  verdictLine: string;
}
/** The review kind as the check.kind@1 fill: `run` asks the fill's own reviewer, `review` the one it's given. */
export interface ReviewFill extends CheckRunnerFill {
  kind: 'review';
  run(spec: ReviewSpec, ctx: CheckContext): Promise<ReviewResult>;
  review(spec: ReviewSpec, ctx: CheckContext, reviewer: Reviewer): Promise<ReviewResult>;
}
export function reviewFill(reviewer: Reviewer): ReviewFill;
/** The kind's own check.kind@1 kit, run by the conformance package's runKit. Its cases are histories with their
 *  reviewer's recorded answers, which its judge gives a fill through `review`, so a fill's own reviewer is never
 *  asked; it has a seeded part; its planted runners include `past-deadline` (reports passed after its deadline) and
 *  `dropped-output` (drops a crashed run's output), each failing the kit with its own message. */
export function reviewKit(): SlotKit<ReviewFill>;

/** A send-back on a claim: the commit its round reviewed and the items it sent. */
export interface SentBack { commit: string; items: SendBackItem[] }
/** How a sent-back item ended: fixed, by the first later commit on the claim that changes a line one of its sites
 *  cites (that file, that line); or left, decided by the commit the claim settled on, those lines unchanged. */
export interface ItemOutcome { rule: string; sites: Site[]; ended: 'fixed' | 'left'; commit: string }
/** Each item of `sent` with how it ended, read from git in `checkout` up to `settled`. */
export function itemOutcomes(checkout: string, sent: SentBack[], settled: string): Promise<ItemOutcome[]>;
```

## What the tests hold the pieces to

- **Real histories, a stand-in only for the model.** Every test runs the review on a real git history it builds.
  The second model, a boundary we don't own, is a function: `ruleReviewer()` reads whatever diff it's given by
  rule, as a careful model would, flagging each added or context line that breaks one of three rubric rules
  (`unchecked-parse`, `swallowed-error`, `off-by-one`) with prose around each finding; `flagsEveryDiff()` is the
  planted reviewer; `recorded(answer)` plays an answer back. Each records the requests it was given.
- **AC planted bug** (`planted-bug.test.ts`, also the Proof's planted-bug review run): the orders change adds an
  unchecked `JSON.parse` at `src/orders.ts:8`. The run is `failed` with one send-back holding one item,
  `unchecked-parse` at that site; the core's verdict on a claim whose one requirement the review alone covers is FAIL
  with one send-back.
- **AC check.kind@1** (`kit.test.ts`): `runKit` on the review kind reads PASS on every case, fixed and seeded, with a
  fill whose own reviewer throws; the planted `past-deadline` and `dropped-output` runners are the kind's, and each
  makes the kit FAIL with a case carrying its own message; the two messages differ.
- **AC free text** (`free-text.test.ts`): on the planted-bug change, one complete finding wrapped in prose (a title,
  a body carrying an instruction, an overall explanation) and four findings each missing one of file, line, rule and
  quote. The four are dropped (`dropped.length` 4); the complete one is the one item; the send-back, failures, open
  items, follow-ups and verdict line hold none of the prose.
- **AC replay** (`replay.test.ts`): the twenty rounds of `fixtures/codex-rounds.ts`, ten claims' round 1 (base..A)
  and round 2 (B since A, round 1's items open), each played back from its recorded Codex answer. Every round gives
  the items it sent when recorded, ends `passed` or `failed` on its own with the second model asked once, and a second
  replay gives the same.
- **AC planted reviewer** (`clean-twin.test.ts`): the review sends the planted bug back and nothing on its clean twin
  (`parseOrder(body)` in place of `JSON.parse(body)`); the planted reviewer, one finding on every diff, sends the twin
  back, so the clean-twin assertion is the one it fails. On the clean twin the claim's requirement resting on the
  model alone is INCONCLUSIVE with exactly one ask, naming the requirement.
- **AC quotes and rules** (`dropped.test.ts`): on the clean twin, a finding quoting `parseOrder(body)` (in the diff at
  line 8) cited at line 9, and one quoting line 8 exactly under `naming`, a rule the rubric doesn't hold. Each is in
  `dropped`, two in all; nothing is sent back; the run isn't `failed`.
- **AC re-review** (`rereview.test.ts`): `src/cart.ts`, 45 lines; A breaks lines 10 (`off-by-one`) and 40
  (`swallowed-error`), B changes only line 10. Round 1 sends both. Round 2 (B since A) gives the reviewer a diff
  holding B's change and not line 40; nothing it sends cites line 40, which stays in `open`; and no item it sends
  cites a line other than 10, though line 12, an unchecked `JSON.parse` there since the base, is a context line the
  reviewer flags.
- **AC one rule** (`one-rule.test.ts`): three unchecked `JSON.parse` sites, two in `src/api.ts` and one in a new
  `src/hooks.ts`, come back as one `unchecked-parse` item listing all three.
- **AC pre-existing** (`preexisting.test.ts`): a change adding line 6 to `src/config.ts`, whose line 4, an unchecked
  `JSON.parse` there since the base, is a context line the reviewer flags. Nothing is sent back; a follow-up names
  `src/config.ts:4`; the verdict line says `pre-existing` and `src/config.ts:4`.
- **AC outcomes** (`outcomes.test.ts`): over the recorded claims, `itemOutcomes` gives one outcome per sent-back item,
  each ended and decided as recorded: eleven items, eight fixed and three left (the fixture's `outcomes`), among them
  `secret-in-code` at `src/client.ts:3` left at B, where B changed only `src/config.ts` at line 3, and
  `unchecked-parse` at `src/session.ts:4` fixed by B though the claim settled on C, which changed that file elsewhere.

## Readings where the issue leaves a choice

- **The recorded rounds are fixtures this job wrote.** No recorded corpus of review rounds exists at the base
  (`tests/` and `benchmarks/` hold none), so `fixtures/codex-rounds.ts` holds twenty rounds as Codex answers them:
  its own fields (`title`, `body`, `priority`, `confidence_score`, `overall_correctness`, `overall_explanation`,
  `overall_confidence_score`) beside the review check's finding schema (`file`, `line`, `rule`, `quote`), which the
  check asks for since findings "come back only as a structured answer" (Reading by reference). Each round's `sent`
  is what it sent by this issue's rules, worked out by hand. The live corpus, once recorded, can replace it.
- **The reviewer is injected.** "The second model runs through the runner" (#159); which model answered and whether
  it counts is the `models` job's. Here the review takes a `Reviewer` function, so no model is called; the request
  carries only the diff and the rubric, which is how "never the session's transcript or the agent's claim or PR
  text" holds by shape.
- **What reaches the working agent** is read as the send-back, the run's failures, the open items, the follow-ups
  and the verdict line. `dropped` is the run's own count and isn't held to that.
- **"Shows on the verdict line"** is the review's part of it, `ReviewResult.verdictLine`; how the gate joins it into
  the claim's one line is the gate's.
- **The rubric** is a Markdown page of the wiki, its rules the list items `- <rule>: <text>`; a finding's `rule` must
  equal one `<rule>`. The tests' page is `fixtures/rubric.md`. Order in the send-back follows the rubric, but the
  tests compare items by rule and sites by file and line, order aside.
- **Re-review rounds.** `since.items` are the claim's open items, carried by the caller from earlier rounds (the
  gate's record, live). A counted finding of the re-reviewed diff on a line its commit didn't touch is never sent;
  whether it is a follow-up (a context line) or dropped (not in the diff) follows the rules above. The test holds only
  that no item cites a line B didn't touch and that line 40 stays open.
- **Fixed means any site.** An item of several sites is fixed by the first later commit that changes a line any of
  its sites cites; the recorded rounds avoid an item whose sites are fixed by different commits.
- **"With no click"** reads as: each replayed round ends `passed` or `failed` on its recorded answer alone, never
  waiting on a person (`missing` or `stopped`), with the second model asked once.
- **The model-only requirement.** The requirement rests on a model (`oracle: 'model'`) and only the review covers it.
  The base's engine already makes it INCONCLUSIVE but raises no ask; the issue asks for one. Which kind of ask is the
  implementer's; the test holds one ask, naming the requirement.

## Wrong programs

Every test fails at the base (BASE-FAILURE.txt): `@deepbuild/checks-review` isn't there. Beyond that, each fails in
its own assertions on these, which the implementer plants as mutants of the package (or the core) to show it:

- a check that sends each finding as its own send-back, or each site as its own item (planted bug, one rule);
- the kit's own `past-deadline` and `dropped-output` runners (check.kind@1);
- a check that keeps a finding missing any of the four fields, or copies the reviewer's title, body or overall
  explanation into the send-back, failures or verdict line (free text);
- a check whose result depends on anything but the diff and the answer, or that waits on a person (replay);
- the planted reviewer `flagsEveryDiff()`, a test-side twin, which sends the clean twin back; and the base's verdict
  engine, which leaves the model-only requirement INCONCLUSIVE with no ask (clean twin);
- a check that keeps every finding with a file, line, rule and quote: it sends the clean twin back, and the test
  names the finding (quotes and rules);
- a re-review that reads the whole diff each round and sends line 40 again (the test names `swallowed-error` at
  `src/cart.ts:40`), or sends the pre-existing line 12 (re-review);
- a check that sends three items, or one item naming only the first site (one rule);
- a check that sends a context-line finding back (the test names `src/config.ts:4`) (pre-existing);
- an outcome record that counts an item fixed when the later commit changed only another file (the test names
  `secret-in-code at src/client.ts:3 in claim client-token`), or that dates every outcome by the settling commit
  (`unchecked-parse at src/session.ts:4`) (outcomes).

## Files

- `helpers.ts`: the lazy import, git histories, the rubric page, the reviewers, the orders change and its clean
  twin, item comparison, and the core's verdict on one review run.
- `fixtures/rubric.md`: the wiki's review rubric. `fixtures/codex-rounds.ts`: the twenty recorded rounds.
- `planted-bug.test.ts`, `kit.test.ts`, `free-text.test.ts`, `replay.test.ts`, `clean-twin.test.ts`,
  `dropped.test.ts`, `rereview.test.ts`, `one-rule.test.ts`, `preexisting.test.ts`, `outcomes.test.ts`: one per
  criterion, as above.
- `BASE-FAILURE.txt`: the base run and the type check.
