# Spike #573: definitions of done drafted for 20 closed issues

A headless agent drafted a definition of done for each of 20 closed issues, from the issue and its base commit only. Each drafted check then ran once on the base and once on the merged fix. These are readings for week 5's drafting job, never a gate. The numbers are in [`record.json`](record.json), which the acceptance tests in `tests/acceptance/573/` recompute.

## Decision

**Week 5's drafting job changes.** Its requirements state only 65 of 108 criteria in full (`coverage:all`). Only 7 of 42 drafted checks fail on the base on a named assertion and pass on the merged fix (`checks:all`). The five changes:

1. **No guessed interfaces.** Draft a check only through a surface the issue or the approved spec names. Where the issue leaves the interface open, the requirement goes to the early question. 20 of the 42 checks failed on the base where they should, then failed on the merged fix too. All 20 were read by hand. 17 assert something the issue doesn't state: a message's exact wording, a data shape, an element's accessible name, an endpoint, when a retry runs, how a script finds its repo, or one of two remedies the issue allowed. The other 3 assert something the issue does state and still fail the fix. One matches a label exactly where the issue shows it beside a count. One reads ambiguous wording the other way from the fix. One uses a storage key the issue named, but the base's own code already named it differently, and the fix followed the code. These three are what week 5's disputes (`deep_propose`) are for.
2. **The stand-in and the early question are the main path.** 55 of 108 requirements for new or fixed behavior got no check, because the code a check would enter isn't on the base yet. The definition drafted for #48 has no check at all. The design's stand-in for a base with nothing to start, and its early question, carry these.
3. **The job's own base run happens where the gate's will.** That means a fresh temporary checkout of the base, through the repo's own test entry and build. Eight checks in three issues only ran because of build output the job had left in its checkout.
4. **Guards counted apart.** Readings count must-not-change checks apart from new-behavior checks. All 12 checks "dropped for passing on the base" were such guards, behaving as the design asks.
5. **Requirements keep their criterion whole.** A check is written from its requirement's text, so the requirement quotes the criterion in full and its checks name each condition. In 23 criteria, a requirement quoted or paraphrased the criterion but its text dropped a condition the criterion states, such as "only the final reply is sent".

**Week 5 doesn't build goal steps (#581).** Offered goal steps, the drafting job used them in 1 of the 5 UI issues. In that issue its goal-step journeys proved 0 of 4, against 1 of 5 with locators. The pooled share is higher with goal steps offered: 6 of 13, against 2 of 13 without (`journeys:all:goal-steps`, `journeys:all:plain`). But that whole rise is one issue whose goal-steps draft used no goal step: 6 of 8 against 1 of 7. So it measures the variance between two drafts of the same issue, not goal steps. The acting harness itself worked: on the base it gave up where the control didn't exist, and on the fix it acted. #581 stays parked until a later reading shows goal steps help.

The decision's wording, with its citations, is `decision` in `record.json`. It doesn't edit the technical design. Folding these changes into week 5 and #335 is a design change for the maintainer.

## Readings

"Proven" means the check fails on the base on a named assertion and passes on the merged fix. "Fails fix" means it fails on the base on its assertion but doesn't pass the merged fix. The last three columns are for UI issues only: proven journeys over drafted journeys in the plain draft and in the goal-steps draft, and whether that goal-steps draft wrote a goal step. Pilot issues are named by the first 8 hex digits of their key. Pilot A is a TypeScript messaging service and pilot B is a large TypeScript web app; both are private.

| Issue | Criteria covered | Checks | Proven | Fails fix | Dropped, passes on base | Dropped, fails elsewhere | Journeys, plain | Journeys, goal steps | Goal step written |
|---|---|---|---|---|---|---|---|---|---|
| windoliver/deepbuild#12 | 6/8 | 2 | 0 | 1 | 1 | 0 | | | |
| windoliver/deepbuild#48 | 4/5 | 0 | 0 | 0 | 0 | 0 | | | |
| windoliver/deepbuild#246 | 1/15 | 1 | 0 | 1 | 0 | 0 | | | |
| pilot A b613adf7 | 3/4 | 1 | 1 | 0 | 0 | 0 | | | |
| pilot A f30142c2 | 5/5 | 4 | 1 | 2 | 1 | 0 | | | |
| pilot A b94c8b4d | 3/4 | 3 | 0 | 2 | 1 | 0 | | | |
| pilot A 7327d497 | 0/3 | 1 | 0 | 0 | 1 | 0 | | | |
| pilot A 0c82ecb6 | 2/3 | 1 | 0 | 1 | 0 | 0 | | | |
| pilot A 3c7ffd01 | 3/4 | 2 | 1 | 0 | 1 | 0 | | | |
| pilot A e54435fb | 2/5 | 1 | 0 | 1 | 0 | 0 | | | |
| pilot A 8dc0eb26 | 6/8 | 2 | 0 | 1 | 1 | 0 | | | |
| pilot A 383d98c8 | 4/6 | 2 | 0 | 1 | 1 | 0 | | | |
| pilot A e43ea635 | 3/7 | 3 | 2 | 0 | 1 | 0 | | | |
| pilot A 4a39da7a | 6/6 | 1 | 0 | 0 | 1 | 0 | | | |
| pilot A a4e2754b | 4/6 | 3 | 0 | 2 | 1 | 0 | | | |
| pilot B fd69652b | 2/2 | 1 | 0 | 1 | 0 | 0 | 0/1 | 0/1 | no |
| pilot B c0fb0289 | 2/4 | 1 | 0 | 1 | 0 | 0 | 0/0 | 0/0 | no |
| pilot B d33c1873 | 4/5 | 5 | 1 | 2 | 1 | 1 | 1/5 | 0/4 | yes |
| pilot B 9d99281d | 3/4 | 7 | 1 | 3 | 1 | 2 | 1/7 | 6/8 | no |
| pilot B 02013d33 | 2/4 | 1 | 0 | 1 | 0 | 0 | 0/0 | 0/0 | no |
| **All** | **65/108** | **42** | **7** | **20** | **12** | **3** | **2/13** | **6/13** | **1 of 5** |

## How it ran

- **Issues.** 3 closed issues from this repo, and 17 closed issues from the two pilot repos. Each pilot issue was closed by a merged PR, and each has acceptance criteria (a bug report's "Expected" bullets count as its criteria). The 5 UI issues are all from pilot B. The base is the merge base of the fix PR's head and main; the fix is the PR's merge commit. For #12, which was closed by hand, the fix is PR #235.
- **Inputs.** Each job got the issue's text as it stood when work on the fix started, with ticked boxes unticked, plus a checkout of the base. That checkout was a `git archive` with no history and its dependencies installed. The job ran as headless Claude Code on the maintainer's plan (`claude-sonnet-5-5`, Claude Code 2.1.303), inside a Seatbelt profile. The profile denies every original checkout, the mirrors, the fix checkouts, `gh`'s credentials and other sessions' transcripts. Network tools were disallowed.
- **The audit.** After each run, the audit compared what the job read with lines that only the fix has. Runs are recorded with every input: the issue, the prompt and each base file the job opened.
- **Checks.** Each check ran once on a reset checkout of the base and once on the merged fix, with only its own files. It ran through its own command, with a JUnit reporter added, under the job's own shell `PATH`. Both sides ran the repo's own build first where its test script does. Failures are placed by the design's "Failing on an assertion" rule, read from the report.
- **UI issues.** Each was drafted twice from the same inputs. The plain draft's prompt asked for locators only. The goal-steps draft's prompt offered goal steps and gave it a throwaway acting harness, `deep-draft-goal.ts`. That harness has the model pick one action at a time from the page's accessibility snapshot, and it never asserts.
- **Coverage.** Two raters judged every criterion of the counted plain drafts against one written rubric: the spike's operator, and a second agent that saw only the criteria, the drafted requirements and the rubric. A criterion counts as covered when the requirements drafted for it state all of its conditions, and a requirement that names only part of a criterion, or a catch-all that lists topics, doesn't cover it. The raters agreed on 85 of 108. In all 23 disagreements the second rater found a condition the requirement's text drops, so the record counts a criterion as covered only when both say so. The rubric, both raters' calls and the reason for every uncovered criterion are in the evidence's `spike/` folder. Neither rater is a person, so under invariant 1 the maintainer's confirmation is what makes the coverage reading evidence: on October 19 the maintainer accepted these conservative calls, 65 of 108.

## Deviations and limits

- **Discarded runs.** Pilot B's `fd69652b` has two discarded runs. They were drafted under a first UI prompt that let a screen criterion go without a journey, and wrote none. All five UI issues were then drafted under a prompt that asks for one. No run's inputs held anything from the fix.
- **One draft per variant, so readings are noisy.** Two drafts of the same issue proved 6 of 8 and 1 of 7.
- **Two UI issues drafted no journey in either variant**, even when asked. Their journeys readings are 0 of 0.
- **The goal-step count is per file.** A check's `goalSteps` counts the goal steps in its own files. Several checks share one spec file, so a check may be credited with a goal step that only a sibling check runs.
- **Harness fixes during the spike.** First, the checks ran under a narrower `PATH` than the drafting job's shell (no docker), so they were rerun under the job's own `PATH`. Second, the fix side lacked build output the base had kept, so both sides now build first. Third, two tracked files that a base's own `.gitignore` hides were missing from pilot B's checkouts' commits, so every checkout's tree is now checked against its commit. Every reading above is from the corrected runs.
- **Four disputes changed the acceptance tests.** The validator was redrafted blind: to read real `node --test` and vitest reports, to read tests excluded by a check's own name filter, to accept a goal-steps draft that uses no goal step, and to fix a false "fix-only line".

## Proof

The private evidence holds, for every issue:

- the issue text, the base and fix commits in a small `repo.git`;
- each run's inputs, transcript and drafted definition;
- each check's files, with its base and fix JUnit reports and logs.

It is `~/deepbuild-private/spike-573` on the reference Mac. `record.json` pins it by its manifest's hash. Run the tests with:

```bash
node --test tests/acceptance/573/spike.test.mjs
```

```bash
DEEP_SPIKE_573_EVIDENCE=~/deepbuild-private/spike-573 node --test tests/acceptance/573/spike.evidence.test.mjs
```

The scripts that drafted and ran everything are in the evidence's `spike/` folder; they name the private repos, so they stay there.
