# Acceptance tests for #1876: the design catch-up, and the lane that checks it

Written first, blind, from issue #1876 ("Design catch-up: the technical design states what main and closed issues
already changed, and the lane checks it": its opening paragraph, Scope, nine acceptance criteria, Proof, Depends on and
its two comments, both by the owner, as saved on November 24), the design and the base commit
`9e77c2ad6c0ff460dcff6905a161adee490536aa` ("Merge pull request #3450 …", `origin/main`), by a job that never saw an
implementation; none existed. No other branch, worktree or pull request was read, nor GitHub: the open issues came
from a file saved for the job. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Node's test runner and built-ins only.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#1876.eb3b3c11` | `ac1-cli-row.test.mjs` (2: every command and the planted usage line; no `claim` and the planted row) |
| AC2 | `#1876.4ae35244` | `ac2-extension-api.test.mjs` (1) |
| AC3 | `#1876.93b6ae42` | `ac3-hub-slots.test.mjs` (1) |
| AC4 | `#1876.281ab39b` | `ac4-codex-flag.test.mjs` (1) |
| AC5 | `#1876.8616fced` | `ac5-proof-kind.test.mjs` (1) |
| AC6 | `#1876.19d18fbd` | `ac6-lifecycles.test.mjs` (1) |
| AC7 | `#1876.a2923be3` | `ac7-blockers.test.mjs` (1) |
| AC8 | `#1876.23de0760` | `ac8-game-route.test.mjs` (2: no only-route line and the planted old sentence; the Decided row and the planted row) |
| AC9 | `#1876.6bec2ce3` | `ac9-events-hook.test.mjs` (2: every column and the planted column; the ack's and the reply's `v` and the planted lines) |

IDs are the repo's rule (`criterionId` in `scripts/proof-change.mjs`): `#1876.` and the first 8 hex digits of the
SHA-256 of each criterion's text after `- [ ] `, trimmed, white space collapsed, over the issue's body as GitHub
returned it. Each test's name starts with `AC<n>` and its ID.

## What was read

- The issue, `AGENTS.md`, `CONTRIBUTING.md`, and in `docs/technical-design.md`: Five ways in, all onto the same core
  (the section the issue links: the hook protocol, the Extension API block and the table whose last row is the CLI's);
  every other place the Scope names, each found by what it is; How we know version 0 works (Criteria to tests, both
  ways; Closed issues stay proven; Criteria in a checked shape; Wrong programs; The edit guard); Dogfooding; Built to be
  hard to get wrong (Tests written first; Wrong programs; Repo guards).
- `docs/technical-design.md` at `f3bcc704f`, an ancestor of the base and the commit the issue's line numbers are of,
  for the lines the issue names by number (40, 42, 101 to 116, 331, 334, 465, 665, 715, 794, 929, 2092, 2266, 2815),
  and the base's history for the commits that wrote three of today's lines.
- The open issues saved for the job (1,160), only to run the base's lane once with them: it passes.
- At the base: `scripts/design-links.mjs`, `scripts/doc-links.mjs`, `scripts/open-issues.mjs`, `scripts/principles.mjs`,
  `scripts/lanes.mjs` (the `design links and names` entry, the lane lists, how Node's suites here run),
  `scripts/proof-change.mjs` (`criterionId`, `tagsIn`, `isTestFile`), `scripts/proof-runs.mjs` (`atAssertion`,
  `twinsOf`), `scripts/wait-ratchet.mjs`, `scripts/repo-rules.mjs`; the files the criteria name
  (`packages/cli/src/main.ts`, `packages/contracts/extension-api.json`, `packages/contracts/hub-slots.json`,
  `adapters/codex.facts.json`, `packages/proof/src/`, `packages/contracts/schemas/`, `packages/record/src/index.ts`);
  and the suites `2339/`, `2338/`, `1329/` and `910/` for the house format. What `helpers.mjs` needs from the scripts
  (lines outside fenced code, headings) and from #2339's helpers (the lane runner, how a line is named, rendered text)
  is copied, never imported.

## How to run them

```sh
node --test 'tests/acceptance/1876/*.test.mjs'                 # all twelve, the nine files side by side
node --test tests/acceptance/1876/ac1-cli-row.test.mjs         # criterion 1, two tests
node --test tests/acceptance/1876/ac2-extension-api.test.mjs   # criterion 2
node --test tests/acceptance/1876/ac3-hub-slots.test.mjs       # criterion 3
node --test tests/acceptance/1876/ac4-codex-flag.test.mjs      # criterion 4
node --test tests/acceptance/1876/ac5-proof-kind.test.mjs      # criterion 5
node --test tests/acceptance/1876/ac6-lifecycles.test.mjs      # criterion 6
node --test tests/acceptance/1876/ac7-blockers.test.mjs        # criterion 7
node --test tests/acceptance/1876/ac8-game-route.test.mjs      # criterion 8, two tests
node --test tests/acceptance/1876/ac9-events-hook.test.mjs     # criterion 9, two tests
```

Plain `node --test` files, run from the repository root, and every file needs the same: Node (the repo's 24) and the
OS temp folder. All twelve tests are offline: no network, no `gh`, no build, no `node_modules`, no git. They're
`*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up; run them by hand or through
`scripts/affected.mjs`. On the shared reference Mac one file took two to eight seconds alone and the nine together
five to thirteen, by the machine's load: most of it is the scratch copy, some 1,100 files, made once per test file and
removed when its process ends. A file's tests share the copy; whatever a test writes in it is put back when the test
ends, and the next test runs its own control. Nothing is written in the checkout.

## The surface (my choice where the issue leaves it open)

The issue gives the lane (`scripts/design-links.mjs`, "the design links lane"), the files each check reads, the planted
values (`claim`, `deep.ghost`, `deep.registerGhost`, `-s read-only`, Kani, `ghost.machine@1.json` and `ghost`, line
40, line 2092's old sentence) and what each failure names. Everything else below is this job's choice, and a
requirement of these tests on the implementation.

### The lane

- **The lane** is the one entry of `checks` in `scripts/lanes.mjs` whose name matches `/\blinks?\b/i` and not
  `/catalogue|drift/i` (today `design links and names`), as #910's, #1329's and #2339's tests pick it. The tests run
  that entry's own `commands` in order with the working folder at the tree under test, stopping at the first that
  fails, and read the exit status and the combined output. They don't go through `runLanes`, whose machine-wide
  throttle can hold a run for minutes. So every check the issue asks for must run inside that entry's commands.
- **The open issues** reach the lane as `scripts/open-issues.mjs` reads them: a JSON file named in
  `DEEP_OPEN_ISSUES`, here an empty list `[]`. The copy's `scripts/planned-names.txt` is emptied, since its entries
  name real open issues the empty list doesn't hold and the lane would fail each as stale. `DEEP_PREFLIGHT` is unset.
  So no new check may need an open issue or a planned name to pass.
- **Each check reads the working tree**: `docs/technical-design.md` and the file it is compared with, at their
  repository paths under the working folder, as text or JSON. A lane that reads a file from git (the copy is not a
  repository), from a built `dist`, from `node_modules` or from the network isn't seen by these tests and fails them.
- **A pass** is exit 0. **A failure of a plant** is a non-zero exit and an output line that starts `FAIL`, as the
  lane prints its findings at the base (`FAIL <counts>`, then a line per finding). A crash or an `INCONCLUSIVE` run is
  not a failure of the plant: it fails the test, saying the lane judged nothing.
- **A finding's line** is any line of the output but one whose text starts `Fix:`: the lane prints a `Fix:` line the
  same whatever it found, so a word there names nothing.

### The scratch copy

One per test file, under the OS temp folder, holding exactly:

- every regular file at the checkout's top level but `.git` and `.env*` (`AGENTS.md` and `package.json` among them);
- `scripts/`, `packages/cli/src/`, `packages/contracts/`, `packages/record/src/` and `packages/proof/src/`, each
  whole, without any `node_modules`, `dist`, `target` or `.git` inside;
- `docs/*.md` and `adapters/*.json` (the files directly in those folders, no subfolder);
- `crates/deep-replica/src/kit.rs` and `crates/deep-gpu/src/meter.rs`, the two crate files the Scope names, when the
  checkout has them;
- `scripts/planned-names.txt` emptied, and the empty open-issue list in a file beside the copy.

Nothing else: no `tests/`, no other package, no other crate file, no `.git`, no `node_modules`. A copy that lacks
`docs/technical-design.md`, `packages/cli/src/main.ts`, `packages/contracts/extension-api.json`,
`packages/contracts/hub-slots.json`, `adapters/codex.facts.json`, `packages/record/src/index.ts`,
`packages/contracts/schemas/`, `scripts/design-links.mjs` or `scripts/lanes.mjs` fails the test, naming the file. A
lane that reads a file outside this list fails every test at its control; say so in a dispute.

### The control

Each test first runs the lane on the unplanted copy and requires exit 0, so a failure after a plant is the plant's.
The control therefore needs the whole tree caught up, not only the test's own criterion: with no open issues, the lane
must pass on the checkout's own design and files, every one of the nine checks included. At the base the lane has none
of the checks, so the control passes there and each test fails on its plant; once the lane has them, the three places
the base's design drifts in (see "On the base") fail every test at its control until the design names them.

### The tree: what each place of the design holds

Each test reads the checkout's own files itself and requires the fact its criterion states, beside the lane. A place
is found by what it is, never by a line number, and a place that can't be found (none, or more than one) fails the
test, naming it. The words a place must keep to be found are in the second column.

| AC | The place, found by | What the test requires of it | Read from main |
|---|---|---|---|
| 1 | The CLI row: the one table row, outside fenced code, that starts `\| CLI \|` | For every command, a code span of the row holds it as a whole word (no letter, digit, `_` or `-` on either side): `deep setup · spec` names `setup` and `spec`, `off\|on` names both, `mcp-exec` doesn't name `mcp`. No code span of the row holds the word `claim` (`deep_claim` isn't it) | `packages/cli/src/main.ts`: between the line `const usage = [` and the next line that starts `];`, the words each line leads with after `'deep `, split at ` \| `, as `commandsOf` reads them (blank and `//` lines skipped) |
| 2 | The Extension API block: the first fenced block under the one heading whose text starts `Extension API` | Each method's dotted name as a whole name: not after a letter, digit, `_` or `.`, and not before a letter, digit or `_`, or a `.` and one (`deep.schedule(` doesn't name `deep.schedule.read`) | `packages/contracts/extension-api.json`: each entry's `method` |
| 3 | The Hub slots table: the table under the one paragraph that starts `**Hub slots.**`, its rows after the header and the separator | For each row of the file, a table row whose first cell holds the method's dotted name and, for a row with a variant, the variant as a whole word in any case (`polled and MCP` holds `polled` and `mcp`) | `packages/contracts/hub-slots.json`: each row's `method` and `variant` |
| 4 | The own-jobs line: the one line that starts `- **DeepBuild's own jobs.**` | Its code spans of the form `-s <one word>` hold exactly one value, and it equals the file's | `adapters/codex.facts.json`: the string after `-s` in `launch.readOnlyJob.args` |
| 5 | The Proof check kind: the one line that starts `- **Proof.**` | It holds `lake comparator` and the word `Kani` | (the issue's two values) |
| 6 | The Lifecycles list: the first list in parentheses, one holding a comma, in the first paragraph under the one heading `Lifecycles`, split at commas and at ` and ` | The same set as the objects, compared lowercase with each run of spaces, `_` and `-` read as one space (`ask_task` is `ask-task`, `open_item` is `open item`) | `packages/contracts/schemas/`: the name before `.machine@` of each `*.machine@*.json` |
| 7 | The two ready rules: the one line that starts `- In R6: playbooks (`, and the one that starts `- **Work runs.**` | Each holds the word `baseline`, the words `closed before the gate`, and `satisfies a blocked-by link` or `satisfy a blocked-by link` | |
| 8 | Every line of the file | None matches `/\bcomplete games? (?:takes? the engine project route\|go(?:es)? through an engine project instead)/i` | |
| 8 | The Decided row: the one row under the one heading `Decided` that starts `\| Bounded games on the canvas \|` | It holds `game shell` in any case, or `shell@1` | |
| 9 | The events table: the one fenced block with a line that starts `CREATE TABLE events (`, the first word of each line from there to the line that starts `)` | Every column the record creates | `packages/record/src/index.ts`: the first word of each line between `CREATE TABLE IF NOT EXISTS events (` and the next line that starts `)`, and the name in each `ALTER TABLE events ADD COLUMN <name>` |
| 9 | The ack and the reply: in the first fenced block under the one heading whose text starts `Hook protocol`, the one JSON line with an `"ack"` key and the one with an `"exit"` key | Each holds a `"v":` key | |

### The plants, and what a finding's line holds

Each plant is written in the scratch copy only, built from the copy's own file so the tree's own format is kept. The
lane must fail it (above), and where the criterion says what the failure names, one finding's line must hold it.

| AC | The plant | A finding's line holds | An accepted line |
|---|---|---|---|
| 1 | In the copy's `main.ts`, one more usage line, first in `const usage`: `'deep ghost   a planted command that the CLI row of the design does not name',` | The word `ghost` (no letter, digit, `_` or `-` on either side) | ``docs/technical-design.md:506 the CLI row doesn't name `deep ghost`, which `deep --help` lists (packages/cli/src/main.ts)`` |
| 1 | The copy's CLI row with `claim` named as it names its other commands: ` · claim` after the first command of its `deep a · b · c` code span (a row written another way gets `` `deep claim`, `` at the start of its second cell) | The word `claim` | ``docs/technical-design.md:506 the CLI row names `claim`, which no command builds`` |
| 2 | In the copy's `extension-api.json`, one more entry at the end: the last entry's own shape with `"method": "deep.ghost"` | `deep.ghost` as a whole dotted name | ``docs/technical-design.md:376 the Extension API block doesn't name `deep.ghost` (packages/contracts/extension-api.json)`` |
| 3 | In the copy's `hub-slots.json`, one more row at the end: the shape of its first row with no variant, with `"method": "deep.registerGhost"`, `"variant": null` and `ghost@1` as its `interface` and `kit` | `deep.registerGhost` as a whole dotted name | ``docs/technical-design.md:898 the Hub slots table has no row for `deep.registerGhost` (packages/contracts/hub-slots.json)`` |
| 4 | The copy's `codex.facts.json` with the string after `-s` in `launch.readOnlyJob.args` replaced by `read-only`, every other byte as it is | The word `-s`, or the word `read-only` | ``docs/technical-design.md:2343 DeepBuild's own jobs gives Codex `-s danger-full-access`; adapters/codex.facts.json starts it with `-s read-only` `` |
| 5 | The copy's Proof bullet with each `Kani` (any case) replaced by `a second checker`, nothing else changed | The bullet's name (Naming, below), or the word `Proof` | `docs/technical-design.md:840 the Proof check kind doesn't name Kani` |
| 6 | `packages/contracts/schemas/ghost.machine@1.json` in the copy: its smallest `*.machine@*.json` with `"id": "ghost.machine@1"` | The word `ghost` (`ghost.machine@1.json` holds it) | ``docs/technical-design.md:978 the Lifecycles list doesn't name `ghost`, which has a table in packages/contracts/schemas`` |
| 7 | The copy's line 40 (the bullet that starts `- In R6: playbooks (`) without each clause that holds `baseline`, `closed before the gate` or `blocked-by link`, a clause ending at a comma, semicolon, colon or full stop. At the base that is the line of November 9 but for one comma where it had a semicolon | The bullet's name (Naming), or the text `In R6: playbooks` | `docs/technical-design.md:57 doesn't say a blocker on the baseline list of issues closed before the gate satisfies a blocked-by link` |
| 8 | The copy's line 2092 (the item that starts `- Complete-game kits beyond the grid core`) with its sentences that start `Complete games take` replaced by the old sentence: `Complete games take the engine project route, through the game project blueprint; versions native to the canvas, and each genre layer of a kit, wait for a brief that needs them.` At the base that is the line of November 9 | The line's name (Naming), or the text `Complete games take the engine project route` | `docs/technical-design.md:2162 says a complete game takes the engine project route as its only route` |
| 8 | The copy's Decided row with every `shell@1`, every word `shell` and every `#851` taken out, nothing else changed | Nothing asked: the lane fails | ``docs/technical-design.md:2940 the Decided row for bounded games doesn't name the game shell`` |
| 9 | In the copy's `packages/record/src/index.ts`, one more column, the first line of `CREATE TABLE IF NOT EXISTS events (`: `  ghost       TEXT,` | The word `ghost` | ``docs/technical-design.md:118 the events table doesn't name the column `ghost` packages/record/src/index.ts creates`` |
| 9 | The copy's ack line without its `"v": 1, `, the rest of the design as it is; then, on the design as it was, the reply line without its `"v": 1, `. Both runs must fail | Nothing asked: the lane fails | ``docs/technical-design.md:359 the hook protocol's ack carries no `v` `` |

### Naming

- **A word** (`ghost`, `claim`, `-s`, `read-only`, `Proof`) is on a line when no letter, digit, `_` or `-` touches it
  on either side. **A dotted name** (`deep.ghost`, `deep.registerGhost`) is on a line when it isn't the start or the
  end of a longer name.
- **A bullet or a line of the design** is named, as #2339's tests read it, by a finding's line that holds the doc's
  file name with the line's number in the planted copy (`technical-design.md:57`, `docs/technical-design.md:3,57`,
  `technical-design.md line 57`, `technical-design.md#L57`), or the first 30 characters of the planted line's text after
  its list marker, raw or rendered. Because a bullet also has a name of its own, three more are accepted, one each:
  the word `Proof` (the bullet's bold lead) for criterion 5; the text `In R6: playbooks` for criterion 7; the text
  `Complete games take the engine project route` (the old sentence's own opening) for criterion 8. The surest is
  `docs/technical-design.md:<line>`, as the lane names every other line.

## Criteria and tests

Every test has both arms in it: it runs the control, reads the fact from the checkout's own files, plants, runs the
lane again, and fails once with every problem it found. So no test passes on a lane that checks nothing, and none
passes on a design that is behind.

| Criterion | Test | The tree | The plant must fail the lane, naming | What fails it |
|---|---|---|---|---|
| 1 `#1876.eb3b3c11` | `ac1-cli-row.test.mjs`, first | the row names every command | `ghost` | a row that lacks a command; a lane that doesn't compare the row with `main.ts`, or fails without the command's name |
| 1 | `ac1-cli-row.test.mjs`, second | the row names no `claim` | `claim` | a row that names `claim`; a lane that passes one |
| 2 `#1876.4ae35244` | `ac2-extension-api.test.mjs` | the block names every method | `deep.ghost` | a block that lacks a method; a lane that doesn't compare the block with `extension-api.json`, or fails without the method's name |
| 3 `#1876.93b6ae42` | `ac3-hub-slots.test.mjs` | the table has a row for every method and variant | `deep.registerGhost` | a table that lacks a row; a lane that doesn't compare the table with `hub-slots.json`, or fails without the slot's name |
| 4 `#1876.281ab39b` | `ac4-codex-flag.test.mjs` | the line's flag equals the file's | the flag | a line whose flag differs; a lane that doesn't compare them, or fails without the flag |
| 5 `#1876.8616fced` | `ac5-proof-kind.test.mjs` | the bullet names both runners | the bullet | a bullet that lacks one; a lane that passes the bullet without Kani, or fails without naming it |
| 6 `#1876.19d18fbd` | `ac6-lifecycles.test.mjs` | the list and the tables are the same set | `ghost` | a list with an object too many or too few; a lane that passes a table the list doesn't name, or fails without the object's name |
| 7 `#1876.a2923be3` | `ac7-blockers.test.mjs` | both bullets say it | the bullet | a bullet that doesn't say it; a lane that passes line 40 without it, or fails without naming it |
| 8 `#1876.23de0760` | `ac8-game-route.test.mjs`, first | no line says it | the line | a line that says it; a lane that passes the old sentence, or fails without naming its line |
| 8 | `ac8-game-route.test.mjs`, second | the Decided row names the game shell | (the lane fails) | a row that doesn't; a lane that passes one |
| 9 `#1876.6bec2ce3` | `ac9-events-hook.test.mjs`, first | the table names every column | `ghost` | a table that lacks a column; a lane that doesn't compare it with the record, or fails without the column's name |
| 9 | `ac9-events-hook.test.mjs`, second | the ack and the reply carry `v` | (the lane fails, twice) | a line without `v`; a lane that passes the ack, or the reply, without it |

## Readings where the issue leaves a choice

- **Where the checks run.** The Scope says the design links lane gains them, so every plant is judged by that lane's
  own commands, and the lane's verdict is their exit status.
- **Each sentence of a criterion is a check.** Criteria 1, 8 and 9 each state a second fact with no plant of its own
  (the row names no `claim`; the Decided row names the game shell; the ack and reply carry `v`). The Scope says the
  lane gains "the checks below", so each is asked of the lane with the least plant that breaks it, the design as the
  issue found it on November 9: the row with `claim`, the Decided row without the shell, the ack or the reply without
  `v`. No name is asked of those findings but `claim`, which the criterion gives.
- **"Named in the row"** is in code, as a whole word. The row lists its commands in one code span, and the lane's
  own reading of a `deep a · b` span takes each part's first word; a whole word in a code span of the row is the least
  that holds either way.
- **The planted command and column** are both `ghost`, the word the issue's other plants use. The criteria name
  neither ("a command the design lacks", "a planted column").
- **"The file on main"** is the file in the tree under test, read from disk.
- **"The two runners the proof plug-in's spec takes"**: the test reads only the bullet, for the two values the
  criterion gives. It doesn't read the plug-in; the copy holds `packages/proof/src/` for a lane that does.
- **"Naming the flag"** is `-s`, or the planted value `read-only`. The design's own value isn't asked for.
- **"Naming the bullet", "naming the line"**: as #2339's tests read a named line of the design, plus the bullet's own
  opening words (Naming, above).
- **"Names exactly"** (criterion 6) is held both ways on the tree. Its plant, the one the criterion names, breaks one
  way only.
- **"Every method and variant … has a row"** is one way: a row of `hub-slots.json` needs a table row. The table's
  rows with no row in the file are not asserted: the base has several, two that say they have no slot of their own
  and the rest for methods the file doesn't hold.
- **Lines 40 and 42 "say"** it when they hold the criterion's own words: `baseline`, `closed before the gate`, and
  `satisfies` or `satisfy a blocked-by link`. The base's two lines both do, in different sentences.
- **"Says a complete game takes the engine project route as its only route"** is read as the words the issue's four
  lines used on November 9: "A complete game goes through an engine project instead" (line 665) and "Complete games
  take the engine project route" (lines 715, 2092 and 2815). A line that offers the canvas first, as the base's lines
  758, 2162 and 2940 do, doesn't match. A lane may read more than this; the tree must hold at least this.
- **"The design"** is `docs/technical-design.md`, the file the Scope says each check reads. The canvas reference is
  not read (see "Not asserted").
- **"The Decided row names the canvas game shell (#851)"**: `(#851)` is read as the issue's reference to what built
  the game shell, as in the Scope's "a canvas goal (#851)", not as text the row must hold. The base's row, written by
  #851's own design commit (`00c1c0841`), says "the game shell, `shell@1`, decided October 31, 2026" and holds no
  `#851`; the second comment leaves the row to #851's pull request, "under an approval the guard accepts"; and a row
  under Decisions changes only by an approved proposal a person signs (design: The edit guard). So the test requires
  the words `game shell` or `shell@1`, and no edit of the row.
- **"The events table names every column … creates"** is the record's `events` table: the columns of its `CREATE
  TABLE` and of each `ALTER TABLE events ADD COLUMN`. The record's other tables (`meta`, `lost_sessions`, `receipts`)
  aren't in the design's block and aren't read.
- **"The ack and reply carry `v`"** is a `"v":` key on each of the two JSON lines of the hook protocol's fenced
  block, the lines the issue names (331 and 334). The acknowledgement the paragraph below the block writes in code is
  not read.
- **No twins.** Every test fails on the merge base at its own assertion, which is the wrong program the design names
  for a check the base doesn't have (The edit guard; Wrong programs), so `twins.json` isn't needed. A twin of
  `scripts/design-links.mjs` would be a copy of a file the work changes and couldn't be written before the work.
- **No live file.** None of the nine checks reads an open issue, so the suite runs the lane with none and never
  reaches GitHub.

## Not asserted, because no criterion says so

- The Scope's lines no criterion reaches: that the Extension API block names each method "with its release"; that the
  Hub slots table "says where those kits live" and matches `hub-slots.json` beyond a row per method and variant (its
  interfaces, fills, planted fills and releases); that the own-jobs line says why Codex runs with its own sandbox off
  and what confines it; that the Lifecycles paragraph "says where the ladder lives"; that the lines on games "say so"
  beyond not saying the old thing.
- The first comment's design lines (the route line under your words, the `sidebar` panel, the gesture serial list and
  the rest): the second comment says a merged pull request wrote the doc lines, and no criterion reads them.
- The Proof's outputs, which the pull request shows: the lane's output on main before the change, naming each line,
  and after it. `BASE-FAILURE.txt` lists what these tests read of the base, not the lane's output.
- The wording of any finding beyond the name its criterion gives, the lane's pass line, its counts and its `Fix:` line.
- What the lane prints when it can't read a file it compares (a missing `hub-slots.json`, say). The invariants say it
  never passes; no criterion plants it.
- The real lane with the real open issues. The suite's runs hand it none.
- `deep --help`'s own output, which needs a build: the criterion names `packages/cli/src/main.ts`, and the test reads
  the usage lines there.
- A plant the criteria don't name: a table row for a slot the file lacks, a listed object with no table, a variant
  with no row, a column the design names and the record lacks, `claim` anywhere but the CLI row.
- `docs/canvas-primitives.md`. Its line 10263 at the base still ends "and a complete game takes the engine project
  route". The issue's Scope and criteria read the technical design only, so no test reads it; it is noted here for
  whoever owns that line.

## What the implementer adds outside this folder

Nothing for the suite itself: no entry in `scripts/lanes.mjs`, no lane file, no fixture, no planted program. What the
tests need of the tree is the surface above: the nine checks inside the design links lane's own commands, reading the
working tree; a `FAIL` line and a finding's line that holds each name; and the design holding each fact of "The
tree". At the base that means three places of the design change (below); no row under Decisions does.

## On the base

All twelve tests fail on `9e77c2ad6` at their own assertion, each for its criterion's reason (`BASE-FAILURE.txt`):

- the lane has none of the nine checks, so it passes every plant (all twelve tests, "the lane passed …");
- and the design is behind main in three places, which three of those tests also report: the CLI row doesn't name
  `host`, `land`, `work`, `person`, `library`, `pack` and `job`; the Extension API block doesn't name
  `deep.schedule.read` and `deep.source.ask`; and the first paragraph of "Scenes, physics and the canvas core" still
  says "A complete game goes through an engine project instead".

Every other fact of "The tree" already holds at the base.

### How I checked the tests can pass and fail

In a scratch tree outside this checkout (what the scratch copy holds, plus this folder), a stand-in lane written for
the purpose, twelve checks added to the base's `scripts/design-links.mjs` that print
`docs/technical-design.md:<n> <problem>` with the name, ran against the design with those three places caught up. All
twelve tests passed there. Then one change at a time, each caught as `BASE-FAILURE.txt` lists: each check left out
fails exactly its own test; a lane that fails without naming anything fails the ten tests that ask for a name; a lane
that crashes on a finding fails all twelve; the base's design under the stand-in lane fails all twelve at the
control. The stand-in was never in this checkout and is not part of the suite. Each judge was also run against
hand-written lane output: it accepts a line that names what its criterion names and refuses one that doesn't.

## Files

- `helpers.mjs`: the markdown reading (copied), each place of the design, each file on main, the scratch copy, the
  lane runner and the control, the judges and the planting.
- `ac1-cli-row.test.mjs` to `ac9-events-hook.test.mjs`: one file per criterion, twelve tests.
- `BASE-FAILURE.txt`: the run on the base, the stand-in runs and the judges on hand-written output.

No fixture holds a secret or personal data.
