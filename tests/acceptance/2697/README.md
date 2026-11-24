# Acceptance tests for #2697: the craft checks move from the skill to a guide deep_kinds serves

Written first, blind, from issue #2697 ("Every session loads the whole skill, and half of it is for films": its Scope,
its five acceptance criteria and its Proof line), the design sections it links, and base commit `4aa543da7`
(`origin/main`, "Merge pull request #3201 …"), by a job that never saw an implementation; none existed, and no other
worktree, branch, PR or note was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). #409's test that reads the skill for each check is redrafted
by its own blind job in `tests/acceptance/409-redraft-2697/`, not here.

**Criterion 4 redrafted.** The issue's criterion 4 was amended on 2026-11-23 (its Amendment: no live paid sessions),
so its id moved from `#2697.1f9af6f6` to `#2697.6cec48c3`. Its tests in `sessions.test.ts` were redrafted blind by a
fresh run of this job from the amended issue, the design and base commit `a288ae247` (`origin/main`, "Merge pull
request #3176 …"), where criteria 1-3's change had landed and criterion 4's had not; the old criterion's two tests,
which read recorded run.json files, are gone. The rest of this suite is the first draft's, unchanged.

## What was read

- Issue #2697's body, read with `gh issue view 2697` (no comments). Test names start `AC<n> #2697.<id>`, the first 8
  hex digits of SHA-256 over each checkbox's text, trimmed, white space collapsed (`criterionId` in
  `scripts/proof-change.mjs`), computed from the live body: 588cc8a0, 5bf72d0a, 09d255e9, 6cec48c3 (amended; 1f9af6f6 before), 2d464f5e.
- `docs/technical-design.md`: Five ways in, all onto the same core (the MCP tools row: `deep_kinds` serves the installed
  guides, read in pages), Numbers version 0 has to hold, Agent evaluation (run by hand, never in CI), Repo guards (the
  wait ratchet; home paths written as `~`), Dogfooding. `AGENTS.md` (Proof).
- At the base, for surfaces only: `scripts/skill.mjs` (`generate()`, the craft section printed from
  `crates/deep-canvas/src/craft.json`, one line per check), `skills/deepbuild/SKILL.md`, `crates/deep-canvas/src/craft.rs`
  (the table is read at run time), `crates/deep-show/src/kinds.rs` and `kinds/replies.rs` (`kinds_read_guide`, the
  installed corpus by `include_str!`, a scenario's `gallery` folder in its place), `crates/deep-show/gallery/gallery.json`,
  `crates/deep-show/src/main.rs` (the scenario's `gallery`), `packages/hub/src/reply-fit.ts` (gpt-tokenizer 4.0.0,
  o200k_base), `packages/hub/src/setup.ts` (setup copies `skills/deepbuild` into the agent's skills folder) and
  `session-facts.ts`, `scripts/agent-eval.mjs` and `scripts/agent-eval-run.mjs` (a recorded run's shape, `--skill
  <file>` for planted runs), `scripts/wait-ratchet.mjs`. Suites read for their form: `1972/` (a guide read by deep_kinds
  through `deep-show run`), `409/` (craft checks against the skill), `26/` (the skill's drift test), `2898/` and `2897/`
  (twins, the pinned tokenizer, two starts a minute apart), `407/` (the deep-show build's arguments).

## What the base does, which the tests don't credit

From the base run (`BASE-FAILURE.txt`):

- `skills/deepbuild/SKILL.md` is 3,735 tokens by o200k_base (the issue's 3,599 is an older commit's); its section
  "Craft checks a film brief names" is 1,900 of them and states the sixteen checks, one line each.
- The installed guides are canvas-working-order, familiar-names, logic and patches. None of the words of the skill's
  craft lines names one, so `deep_kinds` serves no craft guide.
- The agent eval's scorer (`scripts/agent-eval.mjs`, at `a288ae247` too) has no rule about films: it reads no `brief`,
  so it scores a film session on its skill, tools, first call, repeated calls and claims alone, and passes the good
  film session and every session AC4 says must fail alike.
- `generate()` gives the same skill at two starts a minute apart, the checked-in bytes: AC5 passes on the base by
  definition, and its wrong program is the twin below.

## Run them

```sh
source ~/.nvm/nvm.sh && nvm use 24          # Node 24
npm ci                                      # once
npm run build --workspaces                  # source.test.ts's second test runs tests/acceptance/26's drift test, which starts the built CLI
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2697 --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/2697/tsconfig.json --noEmit
rm -rf tests/acceptance/2697/node_modules      # Vitest's cache, when --root leaves one
```

- `cargo` on the `PATH`. `guide.test.ts`, `source.test.ts` and `sessions.test.ts` each build `deep-show` once
  (`cargo build --locked --bin deep-show --no-default-features --features full`, with `CARGO_INCREMENTAL=0` and
  `CARGO_PROFILE_DEV_DEBUG=0`, #407's and #409's build, so one build serves them all), honouring `CARGO_TARGET_DIR`,
  and run the executable cargo reports. Every call goes through `deep-show run`, one scenario per call list; no
  long-lived process is started. `ceiling.test.ts` and `bytes.test.ts` build nothing.
- `scripts/lanes.mjs` needs `'tests/acceptance/2697/'` in its `alone` list: the files build cargo, and
  `source.test.ts` may build `deep-show` a second time in a copy and runs #26's suite file. This README is the
  instruction; the implementer makes that edit (a guarded file: its own commit and a signed tag).
- Every temporary folder is `deep-2697-*` under the OS temp folder, removed after its file.
- Tests take their timeouts as the last argument of `it` (one hour; three for the copy's test, which may build
  deep-show in the copy).

## The surfaces under test

- **The skill**: `skills/deepbuild/SKILL.md` as the checkout holds it, the file `deep setup` copies into a session's
  skills (`packages/hub/src/setup.ts`), and `generate().skill` from `scripts/skill.mjs`, imported in a fresh Node
  process (importing it writes nothing; it writes only when run as the main module). The merge base's skill is
  `fixtures/base-SKILL.md`, the file at `4aa543da7`, byte for byte: the merge base's craft checks are read from it
  (each line `- <name>. <description> Threshold — <threshold>. Fix — <fix>`, sixteen, which equal the merge base's
  craft.json), so they stay the merge base's whatever main does later.
- **The pinned tokenizer**: `countTokens` of `gpt-tokenizer/encoding/o200k_base` (4.0.0) over the whole text, as #2897's
  suite counts.
- **deep_kinds on `deep-show run`**, as #1972's suite calls it: a scenario `{"evidence", "calls"}` (with `"gallery":
  <folder>` for the copy's gallery, below), `{"call": "deep_kinds", "op": "read", "guide": <name>}`, then with `"offset":
  <next>` while a page says `truncated: true`; the guide's `text`, every page joined.
- **The agent eval's scorer** (AC4): `node scripts/agent-eval.mjs score <run.json>`, run from the checkout's root; its
  stdout's JSON line `{outcome, reasons: [{code, detail}]}` and its exit code (0 PASS, 1 FAIL). The run.json is a film
  session in the shape `scripts/agent-eval-run.mjs` writes (`v`, `run`, `agent`, `repo`, `exit`, `prompt`, `skill:
  {loaded, text}`, `tools`, `calls: [{tool, arguments, result}]`, `manifest: {first_tool, claims}`, `answer: {claims}`,
  `transcript`), plus a top-level `brief`, #409's brief shape `{goal, craft: [{check: <name>}]}`, holding the craft
  checks its brief names. How each is built is under Readings.

### The guide's name *(read from the skill, never assumed)*

The issue leaves the name open; the skill's one line must give it. The skill's craft lines are its lines that say
"craft" (any case). The candidate names are every `` `code` `` span in them, then every word (letters, digits and `_ .
@ / -`, trailing punctuation dropped), each once, in the skill's order; the guide is the first candidate `deep_kinds
{op: read, guide: <candidate>}` answers text for. A skill whose craft lines name no guide deep_kinds serves fails every
test but AC1's and AC5's, at that assertion. So the implementer can name the guide anything, as long as its name stands
as a word (or a code span) on a skill line that says "craft", and no earlier word there is another guide's name.

## Criteria to tests

| Criterion | Test | What it asserts |
|---|---|---|
| AC1 `#2697.588cc8a0` | `ceiling.test.ts` (1) | `skills/deepbuild/SKILL.md` is at most 1,900 tokens, a failure naming the count; the same check on the merge base's skill fails naming 3735 |
| AC2 `#2697.5bf72d0a` | `guide.test.ts` (2) | The guide the skill names states each of the merge base's sixteen checks with its description, threshold and fix, each the merge base's skill's text (Readings); the same guide with text_led's statement cut out fails, naming text_led and nothing else |
| AC3 `#2697.09d255e9` | `source.test.ts` (2) | In a copy of the checkout, a seventeenth check `reveal_hold` added to craft.json and `node scripts/skill.mjs` run: the copy's skill is the checkout's byte for byte, and the copy's guide states reveal_hold (and the sixteen) with its description, threshold and fix. The checkout's skill is `generate()`'s, byte for byte, and #26's drift test `#26.2d751e6d` passes |
| AC4 `#2697.6cec48c3` | `sessions.test.ts` (6) | The scorer's CLI scores a film session built from real `deep-show run` replies PASS (exit 0, no reason) when it reads the guide the skill names before its first `deep_show` and its verdict rows come from exactly the checks its brief names; FAIL (exit 1) with a reason naming the session's `run` id when the read comes after the first `deep_show`, when there is no read, when its rows miss `ends` (named too), when they report `ends`, which its brief doesn't name (named too), and when its skill is the planted skill with no line naming the guide |
| AC5 `#2697.2d464f5e` | `bytes.test.ts` (1) | `generate()`'s skill from two fresh processes whose clocks read 61 s apart is the same text, and is the checked-in SKILL.md; the same comparison fails a planted pair of texts holding each start's clock time, naming the later time |

### Wrong programs, and where each fails

| Wrong program | Fails |
|---|---|
| The merge base | AC1 (3735 tokens), AC2 both, AC3 both at the guide's name (no craft line names a guide deep_kinds serves). AC5 passes on it |
| The redraft's base `a288ae247`, whose scorer has no film rule (AC4) | AC4's five FAIL tests, at "is scored FAIL": each session is scored PASS. AC4's PASS test passes on it |
| A planted guide that drops one check (AC2) | Built by the test from the real guide (text_led cut from its name to its fix); no twin needed |
| A guide written by hand, or from another source than craft.json | AC3's first test: the check added to craft.json doesn't show |
| A skill that lists each check | AC3's first test: the copy's skill changes when a check is added; AC1 if it lists them in full |
| A craft line that names a deep_kinds parameter (`` `guide` ``, `op:`) | AC3's second test, through #26's drift test |
| A planted skill with no line naming the guide (AC4) | Built by the test from the skill (every line where the guide's name stands as a word removed); the scorer must fail the session given it |
| A scorer that reads rows, or the read, but names no session in its reason | AC4's FAIL tests, at "a reason names the session" |
| `twins/eval-fails-briefs` (AC4) | AC4's PASS test, at "is scored PASS": it fails every film session |
| `twins/skill-names-its-time` (AC5) | AC5 at its first comparison: the two starts' texts part at the craft line's clock time |

`twins.json` maps `#2697.2d464f5e` to `skill-names-its-time`: `twins/skill-names-its-time/scripts/skill.mjs` is the
merge base's `scripts/skill.mjs` with one change, the craft section's first line ending "Generated at <the clock's
HH:MM:SS>." Laid over the change it replaces the change's generator with one whose skill holds the clock time, so the
first comparison fails. Checked by hand at the base: two processes 61 s apart print "Generated at 06:29:55" and
"Generated at 06:30:56".

`twins.json` maps `#2697.6cec48c3` to `eval-fails-briefs`: `twins/eval-fails-briefs/scripts/agent-eval.mjs` is
`scripts/agent-eval.mjs` at `a288ae247` with one rule added, failing every session whose `brief` names a craft check
(`film_brief`, naming the run). Laid over the change it replaces the change's scorer with one that fails the good film
session, so AC4's PASS test fails at "is scored PASS". Checked by hand at `a288ae247`: AC4's PASS test passes there,
and with the twin laid over `scripts/agent-eval.mjs` it fails at that assertion (`BASE-FAILURE.txt`). The other tags
need no twin: each of their tests fails at an assertion on the base.

## Readings of what the criteria leave open

- **"The skill"** (AC1, AC5) is `skills/deepbuild/SKILL.md`, the one every session loads whole. Its tokens are counted
  over the whole file, front matter included.
- **"Each equal to the text the merge base's skill holds"** (AC2): the guide, with markdown's `` ` `` and `**` marks
  dropped and white space collapsed (case kept), holds the check's description, threshold and fix as the merge base's
  skill writes them, each following a mention of the check's name (as a word, not inside a longer name) within the
  three texts' length and 600 characters more. So any layout works (a heading per check, a list, labels such as
  "Threshold:"), as long as each text is whole and follows its check's name. "Its thresholds" is the one threshold text
  each check has.
- **"A planted guide that drops one check fails, naming it"**: the test cuts text_led's statement out of the real guide,
  from the last mention of its name that its three texts follow to the end of the last of them, and runs the same
  check: a failure names text_led, and none names any other check. text_led is chosen because its name also stands in
  ends's description, so a name left elsewhere doesn't pass for the check.
- **"A check added there shows in the guide with no edit to the skill"** (AC3): the copy holds every file of the checkout
  but `.git`, `target`, `node_modules` (linked to the checkout's) and `tests/acceptance/`, cloned where the file system
  can. The added check is `reveal_hold` with defaults `{min: 1.5}` and its own description, threshold and fix (in
  `source.test.ts`). The generator run is `node scripts/skill.mjs`, the one the skill's section comes from today; a
  guide the binary prints from craft.json needs none. "No edit to the skill" is read as: the regenerated skill is the
  checkout's, byte for byte. The copy's guide is read from the copy's gallery folder (a scenario's `gallery`) when the
  copy's `crates/deep-show/gallery/gallery.json` lists the guide by its name and that file holds the added check's
  description; otherwise `deep-show` is built in the copy (its target a clone of the checkout's `target/debug`, without
  `incremental`, so mostly our own crates rebuild) and read as installed.
- **"tests/acceptance/26/ finds no drift"**: its drift test, `#26.2d751e6d` in `tools.test.ts`, run from the checkout's
  root as its README runs it (`node node_modules/vitest/vitest.mjs run tests/acceptance/26/tools.test.ts -t 2d751e6d`),
  exits 0 and reports that test passed. It needs `npm run build --workspaces`; without it, it fails, never passes.
- **"A film session in the recorded run's shape (its `brief` names craft checks) built from real `deep-show run`
  replies"** (AC4): one `deep-show run` scenario on the checkout's deep-show, #409's world (`scenarioOf`: the agent's
  session `sess-alpha`, a panel, one claim of the agent's whose one deliverable is the film and whose brief names the
  checks the verdict runs) and #409's film "Three 3 s shots" (`shotLengthFilm`), its looks stored first. Its calls are
  the session's, in its order: `deep_kinds {op: read, guide: <the guide>}`, the agent's `deep_show` of the film, and
  the claim's `verdict`. Each is recorded as `{tool, arguments, result}`: the call's fields less `call` and `session`
  as its arguments, deep-show's reply as its MCP result (`{isError: false, content: [{type: text, text: <the reply's
  JSON>}]}`, as `agent-eval-run.mjs` records Claude Code's). The verdict reaches the agent as `deep_status`'s reply on
  `{claim}`. Before scoring, the test requires (`BLOCKED` otherwise) that deep_show presented the film, that the read
  answered the guide's text and that the verdict's rows (`requirements[].from.craft`) come from exactly the checks
  the claim's brief named. The run's `brief` is `{goal, craft: [{check}]}`, #409's brief.
- **"Its verdict rows"**: the craft checks the rows in its calls' results come from (`from: {craft: <name>}`, JSON
  text inside a result's string read as its value); the scorer finds them there however it reads them.
- **The good session keeps every rule the scorer had** so only the film rules decide: `skill.loaded` true and
  `skill.text` the checkout's `skills/deepbuild/SKILL.md` (pinned to the installed version), `tools` the `deep_*`
  names that skill text gives (as the scorer reads them), `manifest.first_tool` the session's first call's tool, no
  call made twice, and one claim `film-verdict` whose expected value is the verdict's `result`, cited by the first
  64-hex hash the verdict reply holds, with a prompt that holds no such value. Its brief and its claim's brief both
  name `shot_length` and `ends`.
- **The five sessions that fail** each change one thing from the good one: the read moved after the `deep_show`; the
  read left out; the claim's brief naming `shot_length` alone (so rows miss `ends`, which the run's brief names); the
  run's brief naming `shot_length` alone (so rows report `ends`, which it doesn't name); and the skill text replaced by
  the planted skill (every line of the skill where the guide's name stands as a word removed; its `tools` are the
  names the planted text gives, and it still reads the guide first). Each has its own `run` id
  (`eval-claude-code-kettle-film-<case>`), and "a reason naming the session" is a reason whose `code` and `detail`,
  joined, hold that id. Where the criterion names a check (rows that miss one or report one), the same reason names
  `ends` too. No reason code is fixed: the issue names none.
- **"Two sessions started a minute apart"** (AC5): two fresh Node processes each import `scripts/skill.mjs` and take
  `generate().skill`; the second's `Date` reads 61 s ahead, moved by a `--import` preload. The tests move time and never
  wait for it (Repo guards: the wait ratchet counts every fixed wait, and a new file starts at zero). A generator that
  reads another clock than `Date` isn't caught here; it would still fail #26's drift test whenever its output moves.

## What is unrun, and why

- **No live agent session.** AC4's sessions are built from deep-show's replies; no Claude Code or Codex session runs and
  no model is called. Whether a live agent follows the skill's line stays a hand run under the design's Agent
  evaluation (the issue's Amendment), not a test here.
- **AC4 on the change** wasn't run: no change exists. On the base its PASS test passes and its five FAIL tests fail at
  "is scored FAIL" (`BASE-FAILURE.txt`).
- **#26's drift test** needs the built workspaces; it wasn't run at the base, since the base fails before it.
- **The build in the copy** (AC3) wasn't run at the base, which fails before it; how long it takes on the change
  depends on where the change prints the guide.
- Not tested, because no criterion asks: what each craft check does (#409's suites), the canvas skill
  `skills/deepbuild-canvas/SKILL.md`, the guide's search hits, the skill's line count.

## Files

- `helpers.ts`: the skill, its tokens, the merge base's checks, the deep-show build, deep_kinds on `deep-show run`, the
  guide's name and text, AC2's check and the plant, the generator in a fresh process, the checkout's copy, and AC4's
  film sessions (built on #409's `helpers.ts`), the planted skill and the scorer's CLI.
- `ceiling.test.ts` (AC1), `guide.test.ts` (AC2), `source.test.ts` (AC3), `sessions.test.ts` (AC4), `bytes.test.ts`
  (AC5).
- `fixtures/base-SKILL.md`: the merge base's skill, `skills/deepbuild/SKILL.md` at `4aa543da7`.
- `twins.json`, `twins/skill-names-its-time/scripts/skill.mjs` (AC5's wrong program) and
  `twins/eval-fails-briefs/scripts/agent-eval.mjs` (AC4's).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base, home folders written as `~`.
