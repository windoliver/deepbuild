# Why #321's AC1 has a new criterion and a new blind draft

This folder's other files are the blind job's draft, byte for byte. Nobody else edits them (AGENTS.md, Proof). This
file records how they came to be.

## The conflict

- **#321 AC1's first draft** (`../321/proceed.test.ts`, criterion `#321.69952336`) approves the held push, then
  expects the agent's next try to run at once.
- **#1101 AC1** holds a yes to a push for 10 s and refuses a try during the hold. Its blind redraft, made under
  Dogfooding, stands (`docs/evidence/321-ac1/1101-blind-redraft-2/RESULT.md`, copied from windoliver/deepbuild#3062's
  2dc871027).
- So no hub passes both. #321's first draft fails on main, and #1101's redraft fails on a hub that keeps the try
  waiting (#3062).

## The redraft of `#321.69952336`, used up

The owner chose to redraft #321 AC1. The choice came through the coordinator session (2026-11-24) as "Redraft #321
AC1".

- **How it was made:** a blind job, given only the issue, the base `debda22` (#321's suite's base) and the criterion.
- **What happened on main** (`docs/evidence/321-ac1/redraft-69952336/`): it fails, partly on its own defect. Its
  world declares no authority deadline, so no ask can be raised.
- **The rule:** by Dogfooding, the first draft stood, and each test is redrafted at most once.

## The criterion change

The old text said only that the push's ask "waits for your answer". It didn't say what follows your yes, and that
gap is where the conflict lies. The owner approved the new wording, typed in the implementing session on
2026-11-24 ("Approve the rewording"). The issue's text was changed that day, with the reason recorded in
<https://github.com/windoliver/deepbuild/issues/321#issuecomment-7126597279>.

The new criterion, `#321.70212996`:

> A planted sorter answers "want me to push to main?" with "proceed": the proceed is recorded with its rule, and in
> the turn it starts the agent's `git push origin main` is held at PreToolUse with an authority ask naming the push,
> which waits for your answer; your yes starts the push's hold (#1101), a try during the hold is refused, and the push
> runs once the hold ends; after the same sorter's "proceed" for "want me to run the tests?", `npm test` runs with no
> ask. A core that lets a "proceed" cover the calls of the turn it starts lets the push through and fails this test,
> naming the call

## How this draft was made (2026-11-24)

- **Its repository** held one commit, `debda22`, fetched alone by SHA into an empty folder. Neither #321 nor #1101 is
  implemented there.
- **Its inputs** were:
  - #321's text with the new criterion;
  - #1101's text, for context, since the criterion names its hold;
  - the design, `docs/technical-design.md` as of main `dc8625b09`;
  - the criterion with its ID.
- **What it wasn't given:** no dispute, no failing output, no earlier draft, nothing about #3062 or the
  implementation.
- **At its base:** both tests fail (`BASE-FAILURE.txt`).

## On main

All runs are on the Spark at main `dc8625b09`.

- **Main unchanged** (`docs/evidence/321-ac1/failing-first.txt`): both tests fail. The draft plants its sorter as
  `DEEP_HUB_TEST_SORTER=<rule>`, and main read that setting only as a JSON file's path.
- **The fix:** the hub reads a value that isn't an absolute path as the rule itself, for every question
  (`packages/hub/src/holds.ts`).
- **Main with that fix, at load 163–175** (`docs/evidence/321-ac1/seam-runs.txt`):
  - The scenario passes in 1 of 3 runs.
  - The other two failed when deep-hook's 50 ms wait for the hub ran out, so it spooled the call and let it through.
    That is timing under load, INCONCLUSIVE, not a verdict.
  - The wrong-program test passed in all 3. But a pass counts only in a run where the scenario also passed. Under
    that load, the correct hub also let the push through on deep-hook's timeout, with the same message. So only run 3
    shows the planted core failing.

Since main's hold already refuses a try during the hold and lets the push run after it, #3062's change isn't needed
for this criterion.

## The redraft of `#321.70212996` (2026-11-28)

The lint lane's wait ratchet (`scripts/wait-ratchet.mjs`) judges a suite's own files from zero in the change that
adds it. The first draft of this criterion held 11 fixed waits: `sleep(…)` and timers in `helpers.ts` and
`scenario.ts`. Nobody edits a blind draft, so the top coordinator ruled (2026-11-28) a blind redraft, with no
ceiling entry.

- **How it was made:** a blind job in a folder holding only the base `debda22a`, fetched alone by SHA. Its inputs
  were #321's text with the criterion, #1101's text for the hold, the design as of `dc8625b09`, and the lint rules a
  new suite meets (`docs/evidence/321-ac1/draft-70212996-1/redraft-lint-rules.md`): no fixed wait, a timer that only
  bounds a wait carries `// deadline: <why>`, no other comment lines, no file over 1500 lines.
- **What it wasn't given:** the first draft, its failures, this file, or any implementation.
- **What it wrote:** `held-push.test.ts` (the scenario), `wrong-core.test.ts` (the wrong program),
  `scenario.ts`, `helpers.ts`, `fixtures/agent.mjs`, `tsconfig.json`, `README.md` and `lane.json`, byte for byte. The
  first draft's `BASE-FAILURE.txt` moved to `docs/evidence/321-ac1/draft-70212996-1/`.
- **Checked before it landed, without edits:** the wait and comment ratchets find nothing in this folder, `tsc -p`
  passes, and `scripts/repo-rules.mjs` passes. Nothing has run yet: builds were on hold.
- **The rule:** by Dogfooding, each test is redrafted at most once, so this draft stands.
