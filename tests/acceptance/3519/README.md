# Acceptance tests for #3519: the canvas skill names the craft guide in one line

Issue #3519: the generated canvas skill still writes every craft check in full, though #2697 moved them to the guide
`deep_kinds` serves. The canvas skill keeps one line for craft checks, the same line the skill has, from one place.

Written first, blind, on November 26, 2026, at the base `f0a816405` (origin/main, "Merge pull request #3354 …"), by a
job that saw only the issue (its Scope, its four acceptance criteria and its Proof line), `docs/technical-design.md`
(Dogfooding; Five ways in, all onto the same core; Films and figures on the canvas; Numbers version 0 has to hold) and
the base commit. Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind redraft by
this job.

## Run

```sh
source ~/.nvm/nvm.sh && nvm use 24          # Node 24
npm ci                                      # once
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3519 \
  --no-file-parallelism --cache=false --fsModuleCache=false --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/3519/tsconfig.json --noEmit
```

`cargo` on the `PATH`. `guide.test.ts` and `line.test.ts` build `deep-show` once each through #2697's `useShow`
(`cargo build --locked --bin deep-show --no-default-features --features full`, the build #407, #409, #508, #2697 and
`scripts/canvas-skill.mjs` use, so one build serves them all). Nothing is written in the checkout but cargo's
`target/`: kinds dumps, deep-show evidence folders and Vitest reports go under the system's temporary folder
(`deep-3519-*`, `deep-2697-*`) and are removed after. `drift.test.ts` runs `tests/acceptance/508/ac1-skill.test.ts`
in its own Vitest with its caches off.

## Surfaces

- `skills/deepbuild/SKILL.md` ("the skill") and `skills/deepbuild-canvas/SKILL.md` ("the canvas skill"), as the
  checkout holds them.
- The generators, imported from the checkout: `scripts/skill.mjs`'s `generate().skill`, and
  `scripts/canvas-skill.mjs`'s `canvasSkill(dump)` given the dump `deep-show kinds --dump` writes now.
- `node scripts/canvas-skill.mjs --check`, its exit code and stderr.
- `crates/deep-canvas/src/craft.json`: each check's `description`, `threshold` and `fix`.
- `deep_kinds {op: read, guide: <name>}` on `deep-show run`, every page joined, with #2697's helpers
  (`tests/acceptance/2697/helpers.ts`: `kindsReplies`, `guideText`, `guideFailures`, `baseChecks`, `candidateNames`).
- The pinned tokenizer: gpt-tokenizer 4.0.0's o200k_base, through #2697's `tokens`.
- `fixtures/base-canvas-SKILL.md`: the merge base's canvas skill, `skills/deepbuild-canvas/SKILL.md` at `f0a816405`,
  byte for byte, so the "on the merge base" half still runs after the change merges.
- git: `git merge-base HEAD origin/main`, and the diff of `tests/acceptance/508` against it.

## Criteria and tests

Each ID is `#3519.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`), computed from the live issue body. Each test's name starts `AC<n> <ID>`.

| ID | Criterion (short) | Tests | On the base |
|---|---|---|---|
| `#3519.a718f309` | no check's words, at most 16,700 tokens; the merge base fails naming its count | words: *the canvas skill holds no craft check's description, threshold or fix and is at most 16700 tokens …* | fails |
| `#3519.a0dcc475` | the line names the guide, deep_kinds serves every check; a planted skill with no such line fails | guide: *the canvas skill's line names the guide …*; *a planted canvas skill with no line naming the guide fails, naming the skill* | both fail |
| `#3519.0b8cfc3f` | the two lines byte-identical, from one place; a planted generator fails naming both | line: *the line in the canvas skill and the line in the skill are byte-identical …*; *a planted generator that words one of the lines differently fails, naming both* | both fail |
| `#3519.f27efbd8` | `--check` finds no drift, #508's first criterion passes unchanged | drift: *node scripts/canvas-skill.mjs --check finds no drift*; *#508's first criterion passes unchanged …* | first passes, second fails |

## Readings where the issue leaves a choice

1. **A skill's craft line.** A line of the skill's body that says "craft" (any case): past the front matter, before
   the canvas skill's `## Kinds` heading (the listing is out of scope; #1105), headings left out. The front matter's
   `description` is not read: it describes the skill, it isn't the line. A heading such as "## Craft checks" may stay;
   the tests don't ask for it gone. AC3 asks each skill to have exactly one such line. On the base the skill has one
   ("A film's brief names the craft checks it wants, … in the guide `craft` with deep_kinds.") and the canvas skill
   none: its only body line that says "craft" is the heading "## Craft checks (craft@1)".
2. **"Names the guide".** As #2697's AC2 reads it: of the names the line gives, its code spans first, then its words,
   the first one `deep_kinds` reads text for. "Returns every craft check, as #2697's second criterion has it" is
   #2697's `guideFailures` against #2697's fixture of the skill before #2697: each of the sixteen checks with its
   description, threshold and fix after its name. The plant removes every line of the canvas skill where the guide's
   name stands as a word; the failure must name `skills/deepbuild-canvas/SKILL.md`.
3. **"A planted generator that words one of them differently".** The tests can't know where the change keeps the
   shared line, so the plant is each real generator's output with its craft line worded differently (" Read it first."
   added): once the canvas generator's, once the skill generator's. Each must fail the check with a failure naming both
   `skills/deepbuild/SKILL.md` and `skills/deepbuild-canvas/SKILL.md`. That two generators holding their own copy of
   the words fail when one drifts is the implementer's twin of either generator (`twins.json`), which this job can't
   write without the change.
4. **"Holds no craft check's description, threshold or fix".** Each of the three texts from
   `crates/deep-canvas/src/craft.json`, white space collapsed and code and bold marks aside, is not a substring of the
   canvas skill so read. Checked on the base with the section "Craft checks (craft@1)" cut out: none of the 48 texts
   stands anywhere else, so the check doesn't catch the line or the kinds listing by chance.
5. **The counts.** The issue's 18,440 is `5a81b58de`'s; at `f0a816405` the canvas skill is 18,452 tokens, its craft
   section 1,881, and the skill without the section 16,571. The ceiling stays the criterion's 16,700. The merge base's
   failure must hold its count as digits (`18452`).
6. **"#508's first criterion passes unchanged".** `tests/acceptance/508/` has no diff against the merge base and no
   untracked file, and its `ac1-skill.test.ts`, run alone in its own Vitest with `--root tests/acceptance/508`, passes
   every test it holds (none failed or skipped). That test reads the run records under `docs/evidence/508/agents/`,
   made on the canvas skill's exact bytes.

## On the base

From `BASE-FAILURE.txt`:

- **words** fails: the canvas skill holds all 48 texts, and is 18,452 tokens.
- **guide** both fail: the canvas skill has no body line that says "craft", so it names no guide; the plant test fails
  at its precondition (no guide to remove).
- **line** both fail: the canvas skill has 0 craft lines, on disk and as generated.
- **drift, `--check`** passes: the canvas skill on disk is what its generator writes. It is a regression check: a
  change that edits the generator and not the skill, or the skill by hand, fails it.
- **drift, #508** fails at the base too: `docs/evidence/508/agents/` holds no run records, so #508's AC1 test fails
  `BLOCKED: no recorded claude-code run …`. Nothing missing passes: this test passes only once #508's live runs are
  recorded on the changed skill's bytes (by hand, `ac1-skill.live.test.ts` with `DEEP_SKILL_LIVE=1`; it spends plan
  usage, so it isn't run here). Until then a PR can say `Part of #3519`, not `Closes`.

## Not covered here

- Scope's design sentence ("and its craft rules") and any suite that pins a check's words in the canvas skill: diff
  review and those suites' own blind redrafts.
- "Nothing about what a craft check does changes": #409's suites.
- The kinds listing's size (#1105).
