# #409 AC3 (the skill's drift test) blind redraft, after #2697: the craft checks' text is read from the guide the skill names

#409's AC3 says "The skill's text for every craft@1 check matches the check's own description, threshold and fix, by a
test that fails when they drift" (`#409.b866029a`). Its test, `tests/acceptance/409/skill.test.ts`, reads each check's
statement from `deep_kinds` and requires it in `skills/deepbuild/SKILL.md`, after the check's name. #2697's Scope moves
that text out of the skill: "The skill keeps one line for craft checks: what they are, that a film's brief names them,
and the guide's name"; "The checks' descriptions, thresholds and fixes are a guide, generated from the same source the
skill's section is generated from today, and read with `deep_kinds`"; and "#409's test that reads the skill for each
check goes to its blind redraft, to read the guide. No criterion's text changes." A correct change then fails the
original at "the skill against the checks' own statements", though the criterion still holds. The redraft keeps the
scenario and every assertion, and changes only where it reads the text.

Written from issue #409 (body: Scope, Fields, criteria, Proof) and issue #2697 (body: Scope and criteria), as this job
was handed them; the frozen `tests/acceptance/409/` (README.md: The checks' own statements, The skill; helpers.ts;
skill.test.ts; BASE-FAILURE.txt); `docs/technical-design.md` (Dogfooding; Repo guards, for `~` in run records);
AGENTS.md; and base `4aa543da7`, read only for its surfaces: `crates/deep-canvas/src/craft.json` (the checks' table),
`scripts/skill.mjs` (how the skill's craft section is generated from it today), `crates/deep-show/src/kinds/replies.rs`
and `kinds.rs` (`deep_kinds` `op: read` with `guide` and `offset`, `truncated` and `next`; the installed guides named by
`crates/deep-show/gallery/gallery.json`; a scenario's `gallery` folder in their place), `tests/acceptance/1972/helpers.ts`
(`guideText`, how a guide is read in pages), and `scripts/lanes-lists.mjs` (`byHand`, `alone`). For form:
`tests/acceptance/26-redraft-2073/REDRAFT.md` and `tests/acceptance/2744-redraft-2833/REDRAFT.md`. I never read an
implementation of #2697, a diff, a branch, a pull request, notes or another checkout, nor `tests/acceptance/2697/`.

## What #2697 changes

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `409/skill.test.ts` › AC3 #409.b866029a every craft@1 check states its description, threshold and fix, the skill holds each, and a drift either way is reported | #409 AC3 (`#409.b866029a`) | Its second assertion requires each check's description, threshold and fix in `skills/deepbuild/SKILL.md` within 2,500 characters of the check's name. Under #2697 the skill keeps one craft line naming the guide, and the three texts are in that guide, read with `deep_kinds`; a correct change fails "the skill against the checks' own statements" for all sixteen checks. Its drift self-checks rewrite the skill's text, which no longer holds a threshold | `409-redraft-2697/skill.test.ts` › AC3 #409.b866029a every craft@1 check states its description, threshold and fix, the guide the skill names holds each, and a drift either way is reported (redraft 2697) |

| Part of the test | In #409's test | In the redraft |
|---|---|---|
| The checks' own statements | `deep_kinds {op: list, registry: check.kind.doc@1}`, every page; one craft@1 entry per check of the sixteen, each with its own description (not the stand-in), a threshold and a fix | Kept, word for word |
| Where the agent's text is read | `skills/deepbuild/SKILL.md` as the checkout holds it | The guide the skill's craft line names, through `deep_kinds {op: read, guide: <name>}`, every page its `next` offset gives (below: The guide's name). Missing guide, or a page refused, fails naming it |
| The comparison | after some mention of the check's name, within 2,500 characters: description, threshold and fix, no backticks or bold, white space collapsed, case ignored | Kept, on the guide's text; a failure line says "the guide" where it said "the skill" |
| Drift either way | the skill with shot_length's threshold one off in its first number, and the statements with shot_length's description changed, each reported against shot_length | Kept, the first on the guide's text in place of the skill's |
| Scenario, build, folders | `deep-show run` of the `full` build, the frozen helpers' sessions and processes, no panels or docs | Kept; the frozen `409/helpers.ts` and `407/helpers.ts` are imported unchanged. This folder has no helper file |

## The guide's name

#2697 doesn't fix it. The convention: every line of `skills/deepbuild/SKILL.md` that says "craft" (any case) is the
craft line; each word in those lines (a run of letters, digits and `@ . _ / -`, trailing punctuation dropped) is tried
as a guide's name with `deep_kinds {op: read, guide: <word>}`, all in one `deep-show run`. Every word answered with text
is a guide the skill sends the agent to; each is read in full and their texts joined in the skill's order. So the guide
may be named in backticks or bare, anywhere on a line that says "craft". When the craft line also names another guide
(say, the canvas working order), the joined text still has to hold every check's three texts, so naming it costs
nothing. On the base the craft lines are the section's heading and opening line; none of their 26 words is a guide
`deep_kinds` serves (the base's guides are canvas-working-order, familiar-names, logic and patches), so the test fails
naming the guide missing.

Not assumed: that the guide's name or title holds "craft" (search isn't used), what file it lives in, its layout, or
that the skill stops holding the old section; #2697's own criteria (token count, generation from one source, the read
before first render) are its own suite's. A skill that keeps a stale full section beside a correct guide passes here.

## Wrong programs it still fails

The original names two wrong programs in its header: the base, and a skill written by hand or from another source. Under
#2697 they and their kin fail as follows:

- The base (and any change with no guide): fails at "the guide the skill's craft line names … the guide is missing",
  naming every word tried and the lines read (BASE-RESULTS.txt).
- A skill whose craft line names no guide, or a name `deep_kinds` doesn't serve: the same assertion.
- A guide written by hand or from another source, which drifts from what the checks state: fails at "the guide (…)
  against the checks' own statements", naming each check and the text it lacks.
- A guide that drops a check: the same, "<check>: the guide doesn't name it". Seen once on the base binary with a
  scratch copy, not kept (BASE-RESULTS.txt): a scratch skill with one craft line naming `craft-checks`, and the
  scenario's `gallery` set to a scratch folder holding that guide as the base generates the section, passes; the same
  guide with shot_length's line dropped fails naming shot_length alone.
- No craft@1 entries, or one without its own description, threshold or fix: the first assertion, unchanged.

## On the base

`BASE-RESULTS.txt` is the one run at `4aa543da7`: the redraft fails, 1 test in 5.4 s, at the guide assertion, after the
checks' statements pass ("the guide is missing: no word of the skill's craft line(s) is a guide deep_kinds serves …").
The frozen original, run once the same way, passes there (5.0 s): the base generates the full section into the skill.
The type check is clean. Not run: any implementation of #2697; none exists here, so the redraft's pass under it is
unverified beyond the scratch guide above.

## Run it

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-show --no-default-features --features full   # optional: the test builds it itself
node node_modules/vitest/vitest.mjs run --root tests/acceptance/409-redraft-2697 --reporter=verbose --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/409-redraft-2697/tsconfig.json
```

`--root` as the frozen suite's BASE-FAILURE.txt runs it; on this checkout the root `vitest.config.ts` didn't load
(`@deepbuild/config-eval` unbuilt). The file builds `deep-show` (`full`) through the frozen `useBuilds`, like every
#409 file, so `scripts/lanes.mjs` needs `'tests/acceptance/409-redraft-2697/'` in its `alone` list beside
`'tests/acceptance/409/'` (lanes-lists.mjs line 628). No network, no model call, temporary folders only, no process
stopped.

## At merge

The frozen `tests/acceptance/409/` stays as written. The owner's call is to swap its `skill.test.ts` for the one here:
`scripts/lanes-lists.mjs` has no `redrafted` list at this base, so the swap is done as the other redrafts do it,
`byHand.push('tests/acceptance/409/skill.test.ts')` with a comment saying #2697 moved the craft text to a guide and
`409-redraft-2697/` runs in its place, plus the `alone` entry above. The other #409 files (craft, camera, example,
takes) read no skill text and are kept as they stand. Both tests start with `AC3 #409.b866029a`, so the trace lane maps
the redraft to the same criterion.
