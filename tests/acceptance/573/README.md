# Acceptance tests for #573: definitions of done drafted for 20 closed issues

These tests were drafted from issue #573 (its text as of October 19), `docs/technical-design.md` and the base commit `dcfd7b8`. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

This is the second draft. The first read three real reports wrongly; the coordinator's dispute supplied real reports from node 24, vitest 4.1, Playwright 1.62 and bun 1.4.2, now in `fixtures/junit/`. Only the reading of failures changed (below): node's wrapped errors, Vitest's wording for assertions that catch errors, and frames relative to a package root. The record and the evidence surface are unchanged.

This is the third draft. A second dispute supplied a real Vitest pair from one check that shares its file with two others and selects its own test with `-t`. The reporter lists the filtered-out tests as skipped on both sides, and the second draft's fix rule read that check as `skipped` on the fix, so it could never be proven. Only the fix outcome changed (below). The record and the evidence surface are still unchanged.

This is the fourth draft. A third dispute showed that the third draft required every goal-steps draft to write a goal step. The design lets the drafting job write one only where it can't know a journey's controls. So "drafted with goal steps" means the job was offered them, and a draft that uses none is a reading, not a fault. The quota is gone. A goal-steps draft must now show it was offered goal steps. Building goal steps needs at least one goal step written. The surface is unchanged, and there's one new evidence test.

This is the fifth draft. A fourth dispute showed that `git grep -o` prints only the leftmost-longest match at each place. A line the fix adds that the base holds only inside a longer line, which the fix also adds, was read as fix-only. So a run whose input was byte-identical to the base's file was flagged. Such a line now counts as at the base. Nothing else changed.

The issue is a research spike, so there's no product code to test. What these tests hold to the issue's four criteria is the recorded spike: its public record, its private evidence and its decision. They never take the spike's word for anything they can recompute (invariant 1). Shares and drop counts are recomputed from per-check outcomes. Those outcomes are recomputed from each check's base and fix run reports by the design's "Failing on an assertion" rule. A run's inputs are recomputed against the issue, the base commit and the fix.

## The surface (my choice, since none was named)

Neither the issue nor the design names where the spike records anything. 17 of the 20 issues come from the maintainer's private pilot repos. Their text, code, drafted checks and run reports must never enter this public repo. So the spike keeps two things:

- A **public record** in this repo, `docs/spikes/573/record.json`. It holds only numbers, outcomes, hashes and the decision. A pilot issue appears only as the SHA-256 of its ref.
- A **private evidence folder** outside this repo, which the public record pins by the hash of its manifest. The tests find it through the environment variable `DEEP_SPIKE_573_EVIDENCE`.

### The public record, `docs/spikes/573/record.json`

```json
{
  "spike": 573,
  "evidence": { "manifestSha256": "<SHA-256 of the private folder's manifest.json bytes>" },
  "issues": [
    {
      "key": "<SHA-256 hex of the issue's ref, \"owner/repo#n\">",
      "ref": "windoliver/deepbuild#48",
      "base": "<40-hex base commit>",
      "fix": "<40-hex merged fix commit>",
      "ui": false,
      "criteria": ["<8-hex criterion ID>"],
      "runs": [
        { "id": "plain-1", "variant": "plain", "counted": true },
        { "id": "plain-0", "variant": "plain", "counted": false, "discarded": "<why, naming the input only the fix has>" },
        { "id": "goal-1", "variant": "goal-steps", "counted": true }
      ],
      "requirements": [{ "id": "R1", "run": "plain-1", "covers": ["<criterion ID>"] }],
      "checks": [
        { "id": "C1", "run": "plain-1", "journey": false, "goalSteps": 0, "base": "assertion | elsewhere | passed | ran-nothing", "fix": "passed | failed | skipped | ran-nothing" }
      ]
    }
  ],
  "readings": [
    { "id": "coverage:<key>", "covered": 2, "criteria": 3, "share": 0.667 },
    { "id": "checks:<key>", "drafted": 6, "proven": 1, "share": 0.167, "droppedPassesOnBase": 1, "droppedFailsElsewhere": 2 },
    { "id": "journeys:<key>:goal-steps", "drafted": 3, "proven": 2, "share": 0.667 },
    { "id": "journeys:<key>:plain", "drafted": 2, "proven": 1, "share": 0.5 },
    { "id": "coverage:all" }, { "id": "checks:all" }, { "id": "journeys:all:goal-steps" }, { "id": "journeys:all:plain" }
  ],
  "decision": {
    "draftingJob": { "outcome": "changes | stands", "changes": ["<what week 5's drafting job changes>"], "text": "<the decision, naming week 5>", "cites": ["checks:all"] },
    "goalSteps": { "build": true, "text": "<the decision, naming goal steps (#581)>", "cites": ["journeys:all:goal-steps", "journeys:all:plain"] }
  }
}
```

- `ref`, `base` and `fix` appear only for this repo's issues. A pilot issue has its key alone, and those fields live in the private evidence.
- Criterion IDs follow this repo's rule (below), and they also accept a ticked `- [x] ` box.
- `variant` is `plain` (no goal steps) or `goal-steps`. Every issue has exactly one counted `plain` run. A UI issue also has exactly one counted `goal-steps` run. Every run that isn't counted carries `discarded` with why. The criterion-2 readings come from the counted `plain` run, UI issues included.
- A check's `base` outcome:
  - `assertion`: at least one test ran, at least one failed, and every failure was on an assertion the check names.
  - `elsewhere`: some test failed, and at least one failure wasn't on a named assertion.
  - `passed`: tests ran and none failed.
  - `ran-nothing`: no test ran.
- A check's `fix` outcome is `passed` only when a test ran, none failed, and none of the check's own tests was skipped. Checks that share a file select their tests with a name filter (`-t`, `--test-name-pattern`, `-g`). The reporter lists the tests that filter excluded as skipped, on both sides. So a test skipped on the fix is outside the check only when the check's base report lists the same test (classname and name) as skipped too. One the base ran, or one the base report doesn't list, makes the fix `skipped`, never `passed` (invariant 2).
- A check is **proven** when its base outcome is `assertion` and its fix outcome is `passed`. **Dropped for passing on the base** means base `passed`, and **dropped for failing elsewhere** means base `elsewhere`; they're counted apart. `ran-nothing` on the base is dropped too, but it's neither of the issue's two kinds, so it's in neither count. A check that fails on the base on its assertion but doesn't pass on the fix is neither proven nor dropped. Every one of them is in the denominator.
- `share` is `proven / drafted` (0 when nothing was drafted), and coverage's share is `covered / criteria`. The `:all` readings pool the counts across issues, not their shares. A recorded share may be rounded to within 0.0005.
- The decision's `cites` must name readings that the record holds and the tests recompute. The drafting job's decision cites at least one `coverage:` or `checks:` reading. The goal steps decision cites at least one journeys reading with goal steps and one without.

### The private evidence, `$DEEP_SPIKE_573_EVIDENCE`

```
manifest.json                                  {"files": {"<relative path>": "<sha256>"}}, every file but itself and repo.git
issues/<key>/issue.json                        {"ref", "title", "base", "fix", "criteria": ["<criterion text>"]}
issues/<key>/issue.md                          the issue's text, exactly as the job got it
issues/<key>/repo.git/                         a git repository (a bare clone is fine) with the base and the merged fix on its default branch
issues/<key>/runs/<run>/run.json               {"variant", "counted", "discarded"?, "base": "<commit the job's checkout was at>",
                                                "inputs": [{"kind": "issue | prompt | base | <other>", "path": "<repo path, for base>", "file": "<kept copy, relative to the run>", "sha256"}],
                                                "transcript": "<kept transcript, relative to the run>"}
issues/<key>/runs/<run>/definition.json        {"requirements": [{"id", "covers": ["<criterion ID>"]}]}
issues/<key>/runs/<run>/checks/<check>/check.json   {"files": ["<the check's own files>"], "asserts": ["<path>:<line>"], "journey", "goalSteps"}
issues/<key>/runs/<run>/checks/<check>/base.xml     the base run's JUnit XML report
issues/<key>/runs/<run>/checks/<check>/fix.xml      the fix run's JUnit XML report
```

What the evidence tests recompute:

- **The bundle.** `manifest.json` hashes to the record's `manifestSha256`. Every listed file matches its hash, and no file is left unlisted. The folder must be outside this repo.
- **Inputs.** An `issue` input must be `issue.md`'s bytes, and a `base` input must equal `git show <base>:<path>`. A `prompt` input is the throwaway prompt. Any other kind isn't the issue or the base, so the run can't count. In every input except the issue, a hex token of 7 or more characters that prefixes the fix commit or a blob the fix adds counts as fix-only. So does a line of 30 or more characters that the fix adds and that the base tree and the issue's text don't have. A line that occurs anywhere in the base tree, even inside a longer line, isn't fix-only. A transcript that names the fix commit or a fix blob makes the run fix-only too. A run with any of these, a kept file that doesn't match its hash, or a checkout not at the base can't be counted. The public test requires it to be named as discarded.
- **Criteria.** Each criterion text appears in `issue.md`. When the issue has checkboxes, the criteria are exactly those boxes. The public IDs match them.
- **The goal-step offer.** A UI issue's goal-steps run has at least one `prompt` input, such as the prompt that offers goal steps or the acting harness its checkout held, whose hash its plain run's inputs lack. A goal-steps run given only its plain run's prompt wasn't offered anything.
- **Checks.** For each counted run, the record lists exactly the check folders the run kept, and its requirements equal `definition.json`'s. Each check's `base` and `fix` outcomes are recomputed from `base.xml` and `fix.xml`.

Reading "failing on an assertion" from a JUnit report, per failed test:

- The failure's error is the first error header in the failure's text (`Name [CODE]: message`, with `Name` ending in `Error` or `Exception`, or plain `Error`). Failing that, it's a Rust assertion panic or pytest's `path:line: Name` trailer. No error at all means the report can't place the failure, so it's elsewhere.
- Node's test runner wraps every failure in `[Error [ERR_TEST_FAILURE]: ...]` and puts the test's own error on a `cause:` line. When the text holds `ERR_TEST_FAILURE`, the error is the first `cause: Name: message` line. A cause that's only a string, as when a file fails to load, has no header. Then the wrapper stands, and the failure is elsewhere.
- It's the framework's own assertion failure when the error is `AssertionError`, `JestAssertionError`, `AssertionFailedError` or `ERR_ASSERTION`. A matcher failure (`Error: expect(...)`) counts too, and so does a Playwright `Timed out ... waiting for expect(...)`. So a locator timing out inside an `expect` counts, while a `TimeoutError` from a `click` or a test timeout doesn't.
- Its place is the innermost frame in the check's own `files`, read after the error header. A frame names an own file when either path ends the other at a path boundary. Absolute frames end with the repo path. Vitest's frames are relative to its root, so for a check run from `packages/core`, `tests/x.test.ts:3` names `packages/core/tests/x.test.ts`. For JS that's the first such frame, and for pytest the last. The place must be one of `asserts`. If `asserts` is empty, any assertion failure in the check's own files counts, as the design allows.
- An assertion that caught a thrown error or a rejection counts only when some frame lies outside the check's own files, `node_modules` and Node internals, meaning the caught error ran through the code under test. That covers Jest and Playwright's `.not.toThrow`, `.toThrow(...)` with another error, `.rejects` and a `.resolves` whose promise rejected. It also covers Vitest's `to not throw an error but ... was thrown`, `to throw error ... but got ...` and `promise rejected "..." instead of resolving`. One that failed because nothing was thrown or rejected caught nothing, so it's an ordinary assertion: `to throw an error`, `did not throw`, `promise resolved "..." instead of rejecting` and `resolved instead of rejected`.

## How to run

- Public tests need only this repo: `node --test tests/acceptance/573/spike.test.mjs`.
- Evidence tests need the private folder: `DEEP_SPIKE_573_EVIDENCE=<folder> node --test tests/acceptance/573/spike.evidence.test.mjs`. Without the variable, or when the folder has no `manifest.json`, each test fails with `BLOCKED` in its message. None of them skips. Their messages name what failed, such as a check ID or a criterion ID, never a pilot issue's text.
- The validator's own tests, which plant wrong spikes: `node --test tests/acceptance/573/validator.test.mjs`. They build small git repos and bundles in a temporary folder, and take about 30 s. `fixtures/junit/` holds real reports from node 24.22 (`--test-reporter=junit`), vitest 4.1 (`--reporter=junit`), Playwright 1.62 (`--reporter=junit`) and bun 1.4.2 (`--reporter=junit`), run on throwaway sample tests with paths rewritten to `/work/repo`. Each test case in them has its verdict planted. `fixtures/junit/filtered/` holds a real Vitest 4.1 base and fix pair from one check run with `-t`, with test names neutralized. The Jest, pytest and Rust cases, node's load failure and Vitest's other throw wordings are hand-made from the shapes those tools print.
- Nothing here runs a model or spends anything. The preflight's `tests/*.test.mjs` pattern doesn't reach this folder.

## Criteria, tests and wrong spikes

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading `- [ ] ` dropped, computed with the command from #48's README:

```
node -e 'for (const t of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)) console.log(require("crypto").createHash("sha256").update(t.trim().replace(/\s+/g," ").replace(/^- \[ \] /,"")).digest("hex").slice(0,8))'
```

| ID | Criterion | Tests | Wrong spikes it must fail on (planted in `validator.test.mjs`) |
|---|---|---|---|
| `#573.01642c85` | Each of the 20 issues gets a drafted definition from the issue and its base commit only, with the job's inputs recorded; a run whose inputs include the fix's diff is discarded and named | public: 20 distinct issues, at least one from this repo and one from a pilot repo, keys that hash their refs. Each issue has exactly one counted draft without goal steps, and a UI issue one with them too. Every other run isn't counted and is named with why. This repo's issues have base and fix commits here, the base an ancestor of the fix and the fix merged into HEAD. evidence: the bundle is the one the record hashes. Every input of every counted run is the issue's own text, the prompt or a file equal to the base commit's. No input or transcript holds what only the fix has. No pilot repo name, title or criterion text is anywhere in this repo | 19 issues. One issue twice. A discarded run that's counted, or an uncounted run with no reason. An issue with no counted draft. A pilot issue's ref or base commit in public, or a key that isn't its ref's hash. Only pilot issues. Commits where the fix comes before its base, doesn't exist, or isn't merged. A counted run with the fix's diff in its inputs. A counted run whose "base" file is the fix's version. A counted run whose transcript names the fix commit by its short hash. A kept input whose hash doesn't match. A bundle the record doesn't hash, with a changed file or one left out of its manifest. A pilot issue's title committed to the repo. No evidence, which must be BLOCKED |
| `#573.4b1e1e2b` | For each issue, the share of its acceptance criteria a drafted requirement covers, and the drafted checks that fail on the base on a named assertion and pass on the merged fix, are recorded as readings; a drafted check that passes on the base, or fails there only elsewhere, counts as dropped, and the two kinds of drop are counted apart | public: `coverage:<key>`, `checks:<key>` and their `:all` totals are present and equal what's recomputed from the counted plain run's requirements and per-check outcomes. evidence: the criteria are the issue's own checkboxes. The requirements are the drafted definition's. No kept check is missing from the record. Each check's base and fix outcomes are what its reports show under the rule above | A share computed over kept checks only. A discarded run's check counted. One drop count for both kinds. A total not recomputed from the checks. A missing reading. Coverage that counts a criterion no requirement covers, or a requirement covering a criterion the issue lacks. A record with no issues. A check called `assertion` whose base report shows a `TypeError` outside an assertion. A parser that reads node's `ERR_TEST_FAILURE` wrapper instead of its cause (real node 24 report), or a load failure's string cause as an assertion. One that misses Vitest's `to not throw an error but ... was thrown` or `promise rejected ... instead of resolving` (real vitest 4 report), or counts Vitest's `to throw an error` as caught. One that drops a frame relative to a package root, or matches a file of the same name in another folder. One failing at an assertion it doesn't name, or with one test on a named assertion and another elsewhere. A `not.toThrow` around a name the base lacks. A click timeout or test timeout called an assertion. A check called passing on the fix whose fix run skipped a test or ran none. A fix rule that reads any skip as unrun, so a check selected by a name filter is never `passed` (real vitest pair). One that ignores skips on the fix, or ignores one the base report doesn't list. Evidence read without the check's own base report. A drafted check left out of the record. Requirements that differ from the definition. Criteria that leave out a checkbox |
| `#573.1e6abfca` | The spike's decision names what week 5's drafting job changes, or says it stands, citing the readings | public: `decision.draftingJob` has the outcome `changes` with at least one named change, or `stands` with none. Its text names week 5. It cites readings that the record holds and the tests recompute, at least one of them `coverage:` or `checks:` | No decision. `changes` naming no change. `stands` with changes. A cited reading absent from the record. No reading cited. Only journeys readings cited. A text that never says week 5 |
| `#573.0753f49f` | For each of the five UI issues, the share of drafted journeys that fail on the base on a named assertion and pass on the merged fix is recorded with goal steps and without, as readings, and the spike's decision says whether week 5 builds goal steps (#581), citing them; a decision that doesn't name goal steps either way fails this test | public: exactly 5 UI issues. Each has a counted draft without goal steps, none of its checks having one, and a counted draft offered goal steps, which may use none. `journeys:<key>:goal-steps`, `journeys:<key>:plain` and their `:all` totals equal what's recomputed from the journeys' outcomes. `decision.goalSteps` has a true or false `build`. Its text names goal steps and `#581`. It cites a journeys reading with goal steps and one without, each held and recomputed. `build: true` needs the pooled share with goal steps above the one without (design, Goal steps: built only if they raise it), and at least one goal step written in a draft offered them. evidence: each goal-steps draft was given a prompt input its plain draft wasn't. Each goal-steps journey's outcomes are what its reports show, and none is left out | 4 UI issues. A plain draft with a goal step. A goal-steps draft whose prompt inputs are all its plain run's, or a UI issue missing either draft. Goal steps built though no draft offered them wrote one, even with the share up. And it must accept goal-steps drafts that write only locators, or no journey at all. A journeys share not recomputed. A UI issue's reading missing. A decision with no `goalSteps`, whose text lacks goal steps or #581, or with no `build`. One citing only the goal-steps side, or a reading absent from the record. Goal steps built though they lower the share |

## What the base commit has

At the base `dcfd7b8` there's no `docs/spikes/573/record.json` and no private evidence. So on this worktree, which is the base plus these files, every spike test fails: 14 of 14. The 7 public tests fail with `no spike record at docs/spikes/573/record.json`. The 7 evidence tests fail with `BLOCKED: the spike's private evidence isn't available`. The validator's own tests pass at the base (88 of 88), as they must, since they test the tests and not the spike.

The evidence tests prove the pilot issues only on a machine that holds the private folder. Until the maintainer runs them there and keeps the output, criteria 1, 2 and 4 are open for the pilot issues, and the PR says `Part of #573`.

## Assumptions a redraft may revisit

- I picked the record's path, the schema, the outcome names, the reading IDs, the evidence layout, the env variable and JUnit XML as the report format (above). Vitest, Jest (jest-junit), Playwright, `node --test`, bun, pytest and cargo-nextest can all write JUnit XML. The parser is regex-based and reads only what's listed above. It's proven on real node, Vitest, Playwright and bun reports. Jest, pytest and Rust are read from hand-made shapes, and a real report from one of them may need the parser changed.
- A test that the fix report skips and the base report also skips counts as excluded by the check's own command. If the base run skipped a test for another reason, such as `.skip` in the check's own file, and the fix skipped it too, that test is also outside the check. It never ran on either side, so it can't be what proves the fix.
- A goal-steps draft counts as offered goal steps when one of its `prompt` inputs isn't among its plain run's. The tests can't tell which file is the acting harness, since its path is the spike's choice, so a run whose only difference is a reworded prompt also passes.
- Nothing requires the record to say how many goal-steps drafts used goal steps. Each journey's `goalSteps` count is in the public record, so anyone can count it, and a decision to build them is refused when none was written.
- Vitest's report shows only the assertion's frame, never the caught error's stack. So by the design's rule (a caught error the report doesn't place fails elsewhere), a Vitest `not.toThrow` or `resolves` check can never fail on the base on a named assertion. A crash fix drafted that way counts as dropped for failing elsewhere.
- The spike's own numbers are trusted only where nothing can recompute them: which requirement covers which criterion is a person's reading, and the tests take it as recorded. They check only that it matches the drafted definition's `covers`.
- The tests don't re-run any check. They trust that `base.xml` came from a run at the base and `fix.xml` from one at the fix, tied only by the manifest hash. Re-running 20 issues' checks would need the pilot stacks.
- An input file is checked against the base, but the recorded input list could still be incomplete. The transcript check only catches a fix commit or blob ID. It doesn't catch fix code the agent read, since the transcript also holds code the agent wrote, which can match the fix's lines.
- Fix-only lines are added lines of 30 or more characters, trimmed, that appear nowhere at the base and not in the issue's text. Shorter lines are ignored, so a leak of short lines only goes unseen.
- A base run that fails on a named assertion in one test and elsewhere in another is `elsewhere`, following the design's "Proven on the base" (every failed test on a named assertion). Neither the issue nor the design says which drop kind a mixed run is. A base `ran-nothing` is dropped but counted in neither of the two kinds.
- Every drafted check counts toward the readings, a check for behavior that must not change included. The issue doesn't set those apart, so one that passes on the base counts as dropped.
- The criterion-2 readings use each issue's counted plain draft, UI issues included. The goal-steps draft feeds only the journeys readings.
- A share of nothing drafted is 0. The `:all` readings pool counts, they don't average shares.
- `build: false` is accepted whatever the shares, since the design says goal steps are built only if they raise the share, not that they must be built then.
- At least one issue from each source is required, not exactly 3 and 17.
- The tests don't check that the 3 public issues are closed on GitHub, only that their fix is merged into HEAD. For a pilot issue, the fix must be on its `repo.git`'s default branch.
- A pilot issue's key is the unsalted SHA-256 of `owner/repo#n`. Someone who knows the pilot repo's name could test guesses against it.
- The privacy test catches a pilot repo name of 6 or more characters, and a title or criterion of 20 or more, in tracked and untracked files that aren't ignored. It doesn't check git history or other branches. Its messages name what leaked, not the text, though an input's repo path may appear in an inputs failure.
