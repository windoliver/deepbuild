# Acceptance tests for #3534: an issue's time from its first prompt to its merge, counted by cause

A blind job wrote these tests before any work on #3534 existed, in two passes, and saw the work in neither.

The first pass read issue #3534 as it then stood, the words it cites of #2673, #1324 and #1333, AGENTS.md and
CONTRIBUTING.md, and the design sections the issue links: How we know version 0 works (with Dogfooding and Built to
be hard to get wrong), Work runs and landing in turn, and `docs/parallel-proof.md` sections 6, 12b and 13, at base
commit `5a81b58de`. At the base it read `scripts/throttle.mjs` (`log()`, `sample()`, the table's folder),
`adapters/claude-code.facts.json` (`transcripts`), `scripts/known-failures.json`, how `scripts/open-issues.mjs` and
`scripts/main-watch.mjs` call `gh`, `scripts/proof-change.mjs` and `scripts/proof-runs.mjs` (tags, failing at an
assertion), the lint lane's patterns, and the suites of #3065, #1115, #1116 and #2820 for layout. The transcript rows
follow the issue's Fields, with the envelope this repository's own fixtures write (`tests/acceptance/907`,
`tests/acceptance/997`, `packages/conformance/src/gate-play.ts`).

The second pass came after the issue was split. #3553 is now the checkpoint and holds the 7-day targets; #3534 is the
reading task, the command alone, with nine criteria. This pass read both passes' briefs, the new body of #3534 (its
opening paragraph, Scope, Fields, `Runs on:`, Proof and Not in scope lines and its nine criteria) and #3553, for the
words #3534 cites of it and nothing more: #3553's criteria are not tested here. It read again AGENTS.md,
CONTRIBUTING.md and Dogfooding's paragraph on readings that classify a person's messages, and at the base
`scripts/proof-change.mjs` (a criterion's ID) and `scripts/proof-runs.mjs` (a tagged test is proven by failing at its
assertion on the merge base or on a planted wrong program that `twins.json` names for one of its criteria). It
revised the first pass's suite to the new body: the tags, a test for each sentence, and a wrong program for each of
the nine criteria.

`scripts/issue-time.mjs` does not exist at the base. The implementing agent does not edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job.

No record of this machine was read: no transcript, no forge answer, no throttle log. Every record is made up in
`helpers.mjs`.

## The setup (`helpers.mjs`)

Each test file builds the fixture once (under a second) and runs the command once a span; every test of the file
reads those runs. The fixture is removed after the file. Nothing is imported from the code under test: the command is
`node scripts/issue-time.mjs --since <day> [--until <day>] [--json]`, run in the scratch tree, read from its output.

- **A scratch tree.** A copy of this checkout's `scripts/` and `adapters/` in a temporary folder, with a
  `scripts/known-failures.json` of the fixture's own, committed as a git repository whose `origin` is this
  repository's address. A script finds its repository from its own path, so the copy reads the copy. A planted twin
  laid over a checkout's `scripts/` is therefore what runs.
- **A HOME of its own**, under the same temporary folder, with `CLAUDE_CONFIG_DIR` set to `$HOME/.claude` and
  `DEEP_THROTTLE_TABLE` to `$HOME/.deepbuild/throttle`, so each way the base reads those places names the same
  folder. `TZ` is `UTC`. No `GIT_*`, `GH_*` or `GITHUB_*` setting of the caller's is passed on.
- **A stand-in `gh`**, first on `PATH`. It writes every call to a file and answers `gh pr list` from the fixture, as
  `gh` does: by `--state` (open unless given), by a `merged:` qualifier of `--search`, 30 PRs unless `--limit` says
  otherwise, with the fields `--json` names. It runs no `--jq` expression, and any other call exits 1. It holds nine
  PRs:

  | PR | Title | Body | Merged (UTC) | Transcript |
  |---|---|---|---|---|
  | 7200 | Run the night table once | `Resolves #7100` | Mar 10, 09:30 | one session, on the head branch, no PR link |
  | 7201 | Count the lane notes by day | `Closes #7101`, then a later `Fixes #7190` | Mar 11, 10:22 | one session, holds the PR link |
  | 7202 | Name the day a hook went quiet | a bare `#7190`, then `Fixes #7102`, then a later `Closes #7191` | Mar 12, 16:35 | two sessions, both hold the PR link |
  | 7204 | Draw the chart's axes | `Part of #7104`, then a later `Closes #7192` | Mar 17, 10:42 | one session, holds the PR link, goes on past the merge |
  | 7205 | Sort the notes | `Closes #7105` | Mar 5, 12:00 | one session, holds the PR link |
  | 7206 | Keep the table's header | `Closes #7106` | Mar 12, 09:00 | none |
  | 7207 | Tidy the lane notes after the revert | no issue (it mentions `#7101`) | Mar 11, 15:00 | one session, holds the PR link |
  | 7208 | Revert "Count the lanes twice" | no issue (`Reverts #7190`) | Mar 13, 10:00 | none |
  | 7209 | Draw the day chart | `Closes #7109` | still open | none |

  Each of the four words names a row's issue once, and three bodies go on to name another issue with another of the
  four. The issue that takes longest, 7100, has the lowest number and merges first, so the middle issue by number, by
  first prompt and by merge is 7101, and the middle one by minutes is 7102.
- **Transcripts**, at `$HOME/.claude/projects/<cwd with each non-alphanumeric character as ->/<session>.jsonl`, the
  cwd being the tree's root or a folder under it. Two more belong to no PR's sessions: one on PR 7201's head branch
  that holds no PR link (its first prompt is Mar 10, 15:00; the PR has a transcript that does hold its link), and one
  on `main` with a link to PR 7299, which the forge doesn't list. All times are in 2025, on whole minutes but for
  calls of 20 seconds, each after 40 seconds of thinking, two calls of 90 seconds, each after 30 seconds of thinking,
  and the millisecond between issue 7102's two sessions, so every cause is a whole number of minutes and no rounding
  is tested. What each issue's sessions hold, in minutes:

  | Issue | What its sessions hold | minutes | own | job | person | hook | unplaced | prompts |
  |---|---|---|---|---|---|---|---|---|
  | 7101 | calls of 20 s (own); a plan's approval 12, a question's answer 9, a call a person permitted 6 (`source` `user_temporary`); a call of 3 a rule permitted (`source` `config`), calls of 90 s twice and of 5 (job); a turn's end until a prompt 25, until the app's conflict line 30, until a prompt that only talks of merge conflicts 15; the last row until the merge 20; four sidechain rows inside the first of those waits, one of them a `user` row of text whose `origin` is `human` | 142 | 14 | 11 | 117 | 0 | 0 | 3 |
  | 7102 | a call of 13 (job); a background command, and 18 from a turn's end to its notice (job); then 11 from a turn's end to a prompt, the job done (person); a background helper, 9 from a turn's end to a prompt while it runs (job), and 6 from the next turn's end to its notice (job); 6 calls a hook left unanswered, 10 each; a second session a millisecond after the first one's last row, with 5 more such calls, 14 from a turn's end to a prompt, and 10 from its last row to the merge | 215 | 24 | 46 | 35 | 110 | 0 | 4 |
  | 7100 | first prompt Mar 9, 20:00, before the span; calls of 4 and 8 (job); thinking of 45 (unplaced) and of 14 (own); a turn's end until a prompt the next morning 660, and 10 until a prompt that opens `Merge conflicts are not the trouble here.`; 10 calls a hook left unanswered, 4 each, all on Mar 10; the last row until the merge 15 | 810 | 28 | 12 | 685 | 40 | 45 | 2 |
  | 7104 | a call of 4 (job); a turn's end at 10:07 that waits 120 for the next prompt, with the merge 35 into that wait; thinking and a call of 6 after it | 42 | 3 | 4 | 35 | 0 | 0 | 0 |

  A person's minutes are split `merge` 20, `prompt` 40, `conflict` 30, `plan` 12, `question` 9, `permission` 6 for
  7101; `merge` 10, `prompt` 25 for 7102; `merge` 15, `prompt` 670 for 7100; and 35 of `merge` and `prompt` together
  for 7104. Over `--since 2025-03-10 --until 2025-03-14` the issues read are 7100, 7101 and 7102: mean 389, median
  215, one of three over 12 hours; by cause 22, 23, 279, 50 and 15 an issue; a person's 15, 245, 10, 4, 3 and 2; 3
  prompts an issue. 7106 is not read.
- **The throttle's log and load log**, `$HOME/.deepbuild/throttle/log` and `load.log`, in the shapes
  `scripts/throttle.mjs` writes. On Mar 11: 3 top-level build grants, 2 nested ones and 1 build timeout; 4 top-level
  test grants, 1 nested one and 1 test timeout; grants and a timeout of the classes timed and bay-pair, passes,
  turns, releases and a window; and 20 samples, a build grant held in 10 and a test grant in 4, with 48 build
  requests and 10 test requests waiting in them in all, and a timed and a bay-pair grant and request in others. So
  build reads grants 3, timeouts 1, held 0.5, waiting 2.4, wait 12 minutes (48 over 3 and 1), and test 4, 1, 0.2, 0.5
  and 2. Rows and samples of Mar 5 and Mar 17, one sample failed, lie outside the span.
- **Known failures**: five `failures` entries, ending `added` Feb 20, Mar 7, Mar 11, Mar 12 and Mar 17, no `lint` or
  `timing` entry, and three `skips`. Quality over the first span is merged 6, reverts 1, failures 5, failures_added
  2, skips 3; over `--since 2025-03-16 --until 2025-03-19` it is 1, 0, 5, 1 and 3.

## Surfaces this suite assumes

The issue names the command, its two flags and `--json`'s object, field by field. Where it is silent the suite takes
the smallest surface and reads it loosely:

1. **The run.** `node scripts/issue-time.mjs --since <day> --until <day> --json`, in that order, from the tree's root,
   under `node --test`. Its exit status and its standard error are not read.
2. **`--json`'s standard output is the object alone**: it parses as one JSON object. Only the keys the Fields name are
   read. `since` starts with the day given; `until` is not checked.
3. **Numbers.** `issue` and `pr` are numbers, or strings as `#7101`. `first_prompt` and `merged` are ISO times or
   milliseconds; a string that names no zone is read as UTC. Minutes of an issue are whole numbers. A mean or a share
   is right within 0.05, so one decimal is enough: the fixture's means in minutes and in prompts are whole numbers,
   and its shares and the lines' waiting are a third, 0.5, 0.2, 2.4 and 0.5.
4. **Days are UTC days**, the run's `TZ`. No PR merges and no failure is dated on a span's last day, so whether
   `--until` takes its day in is not tested. With no `--until` the span runs on for at least a day.
5. **The forge** is one `gh` call a run: `pr list` with `--state merged` (or `-s merged`) and a `--json` that names at
   least `number`, `title`, `body`, `headRefName` and `mergedAt`. `--limit`, `--search` and `--repo` are the
   command's to use or not; the answer is filtered by the command, not by `--jq`. "Read once" is held as: a run
   calls `gh` once, whatever the call, over two spans with `--json` and one without.
6. **Row shapes the Fields leave open**, each as the base's own fixtures write it where they do: a prompt's text is
   the row's `message.content`, a string; a result's text is its `tool_result` part's `content`, a string, and for a
   call a hook left unanswered the row's `toolUseResult` is that same string; `permissionDecision` sits on the result
   row beside `toolUseResult`, as `{ decision, source }`, the `source` being `user_temporary` for a person and
   `config` for a rule; a background command's result row holds `toolUseResult.backgroundTaskId` and a background
   helper's `toolUseResult.agentId`; a notice's text holds `<task-id>` with that id; a `pr-link` row holds
   `sessionId`, `prNumber`, `prUrl`, `prRepository` and `timestamp`, the timestamp of the row before it; sidechain
   rows sit in the session's own file. A session's rows all name one branch, and its working folder is the tree's
   root or a folder under it.
7. **The app's conflict line** is one prompt whose text is `Merge conflicts`, a newline, then
   `Resolve the merge conflicts before this can merge.` A prompt that holds the words `merge conflicts` in a
   sentence of a person's own, and one line that opens `Merge conflicts` and goes on in a person's words, are not
   it. A prompt that holds the whole line with more text around it is not planted.
8. **Thinking over 15 minutes is unplaced whole**: the 45 minutes between a result row and the next assistant row
   are all `unplaced`, none of them `own`.
9. **Whole calls.** A plan's approval, a question's answer and a call a person permitted are a person's from the
   `tool_use` row to the result row, and a call a hook left unanswered is `hook` the same way. Each planted one runs
   over a minute, so which rule wins for such a call under a minute is not tested.
10. **Two sessions of one PR.** What the time between them counts as the issue doesn't say, and it is not tested: the
    second starts a millisecond after the first one's last row. `first_prompt` is the earlier session's, and
    `prompts` counts the second session's opening prompt: it is a person's prompt before the merge and not the
    issue's first.
11. **A wait cut at the merge.** When the next prompt comes after the merge, the part up to the merge is a person's;
    whether it is `merge` or `prompt` the issue leaves open, so the two are read together for issue 7104.
12. **`days`.** `day` starts with `YYYY-MM-DD`, `hook_calls` is the count, and `sessions` names each session by its
    id, the transcript's file name: a string that is the id or holds it. Each planted day's calls start and end on
    that day, in sessions of issues the span reads.
13. **`quality.failures`** counts the `failures` entries; the fixture has no `lint` or `timing` entry, so a count
    that takes those in reads the same. **`machine`**: no failed sample lies in the span, so whether one counts as a
    sample is not tested.
14. **The table without `--json`** is read as lines: a line names an issue when it holds its number as a word; a line
    after the issues' lines says total, mean, average, median, overall, all issues or an issue; a line holds the
    not-read issue's number and its PR's; and the output says `not read` somewhere. No column, unit or order is read.
15. **"It writes nothing"** is held over the tree outside `.git`, the HOME and `TMPDIR`: after the command's runs,
    with `--json` and without, every file's content is what it was before the first one, with no file more or fewer.
16. **"The first" of the four words** is the first in the body's text, read from its start, whichever of the four it
    is. Each is written as the issue writes it: the word with its capital, one space, `#n`. No other case or spelling
    is planted.
17. **The median** of an odd number of issues is the middle one by minutes. The first span reads three; no span
    reads an even number, so how two middle times are joined is not tested.

## What each test proves

Every test's name starts with the ID of each criterion it serves. Three tests hold words of the Scope or the Fields
that no criterion repeats; each carries the nearest criterion's ID and is marked.

| Criterion | Test | What it holds on the fixture | Wrong programs it fails on |
|---|---|---|---|
| `#3534.8aeb9b47` | `table.test.mjs`: each issue's causes sum to its whole time | both sentences: for 7100, 7101, 7102 and 7104, `own + job + person + hook + unplaced` equals the minutes from the first prompt to the merge, and so does `minutes` | **drops a wait**: names the issue and the missing minutes |
| `#3534.8aeb9b47` | of the causes that sum, own and unplaced | the Scope's words ("each minute has one cause"), under the criterion whose sum they make: `own` and `unplaced` of the three issues, from calls within a minute, thinking of 14 minutes and thinking of 45 | a call of 90 seconds as own; long thinking as own; sidechain rows read |
| `#3534.e845c6a7` | `person.test.mjs`: a person's wait in six kinds | the first sentence: `person` of the three issues, kind by kind, summing to `causes.person` | a kind dropped or merged into another |
| `#3534.e845c6a7` | only the app's conflict line is a conflict | the second sentence: 7101's `conflict` is 30 and its `prompt` 40; 7102's and 7100's `conflict` is 0 | **reads a prompt for its words**: names the issue and the minutes; a prompt that opens `Merge conflicts` |
| `#3534.e845c6a7` | the totals give each of the six kinds | the Fields' `total.person`, under the criterion whose split it averages | |
| `#3534.021e72cb` | prompts | the criterion: `prompts` 3, 4, 2 and, for 7104, 0 | **counts the first prompt**: names the issue and the count; a notice, a sidechain row or a prompt after the merge counted |
| `#3534.021e72cb` | the totals give the prompts an issue | the Fields' `total.prompts`, 3, under the criterion whose count it averages | |
| `#3534.f9de4edc` | `machine.test.mjs`: job minutes | the first sentence: `causes.job` 11, 46 and 12 | a threshold of two minutes; a notice's wait as a person's; a call a hook left unanswered as job |
| `#3534.f9de4edc` | the machine's lines | the second sentence: `machine.build` and `machine.test`, five numbers each | **counts nested grants**: names the line and the count; another class counted; the span ignored; the wait over grants alone |
| `#3534.2c0280c9` | hook minutes | the first sentence: `causes.hook` 0, 110 and 40 | such a call as job |
| `#3534.2c0280c9` | the day named, and a day with 10 not | the second sentence: `days` is the one day Mar 12, `hook_calls` 11, with its two sessions; Mar 10, with 10, is not there | **names a day with 10**: names the day and its calls; a day with no session |
| `#3534.9ca3cb3b` | quality | the criterion: the five counts over two spans | **counts a mention of a revert**: names the count; failures of every date; PRs with no issue left out of merged |
| `#3534.8eed42c8` | `person.test.mjs`: a wait for a person against a wait for a job | `causes.person` and `causes.job` of the three issues | **a person's wait as a job's**: names the minutes |
| `#3534.8eed42c8` | a wait cut at the merge | 7104: `minutes` 42, causes summing to it, `person` 35, `merge + prompt` 35, own 3 and job 4 | **a wait counted whole**: names the minutes past the merge |
| `#3534.087b8d1d` | `not-read.test.mjs`: listed as not read | `not_read` is 7106 alone, with PR 7206 and a `why`; no row for it in `issues` | **not read as zero minutes**: names the issue |
| `#3534.087b8d1d` | in no average | `total.issues` 3, and the mean, median, person and prompts of three issues | the same |
| `#3534.4ae32bc7` | `table.test.mjs`: which issues are in the table | "the table holds each issue whose PR merged in the span, named by the first": exactly the issues above over three spans, each with its PR, `first_prompt` and `merged`; none for a PR merged before or after, an open PR, a PR with no issue, the issue not read, or an issue a body names later | **takes the last of the four words**: names the issue wrongly listed and the body; the four words tried in a fixed order; a closing word before `Part of`; any `#n`; the span ignored; the link's sessions and the branch's taken together |
| `#3534.4ae32bc7` | the totals | "the totals give …": `total.issues`, `mean`, `median`, `over_12h`, and the mean of each of the five causes | an issue more or fewer in the averages; the mean in place of the median; a median from an unsorted list |
| `#3534.4ae32bc7`, `#3534.087b8d1d` | the table without `--json` | criterion 9's table and totals and criterion 8's listing, on the table the Scope says is printed (surface 14) | a table with no row, or one that lists 7106 as read |
| `#3534.4ae32bc7` | the forge is read once | "the forge is read once", surface 5, over three runs whose table holds the span's issues | a second forge call |
| `#3534.4ae32bc7` | the command writes nothing | "the command writes nothing", surface 15, after runs whose table holds the span's issues | a file written |

No test passes on a command that prints nothing, an empty object or zeros, whether or not it calls `gh`: each first
needs the object or the table's lines, and each then needs a row of the fixture or a number above 0.

## The planted tables

One wrong program at least for each of the nine criteria: criteria 1, 7 and 8 name theirs, and this job names one
for each of the other six. Each is the work with one fault, the implementing agent's to plant, as `twins.json` and
the proof lanes ask; this job never sees the work. What each does, and what fails on it:

- **Drops a wait** (`#3534.8aeb9b47`): the time from a session's last row to the merge is in no cause. Every issue's
  causes then fall short of its whole time. "each issue's causes sum to its whole time" fails first on issue #7101,
  naming it and the 20 missing minutes, and the fixture's wait of that length, whether the twin's `minutes` stays
  whole or shrinks with its causes. Any other single wait left out fails the same test the same way.
- **Reads a prompt for its words** (`#3534.e845c6a7`): a prompt is a conflict when its text holds the words
  `merge conflicts`, in either case, anywhere. "only a prompt that is the app's conflict line is a conflict" fails
  on issue #7101, naming its `conflict` of 45 minutes against 30, and the 15 minutes before the prompt that only
  talks of merge conflicts.
- **Counts the first prompt** (`#3534.021e72cb`): `prompts` is every prompt of a person before the merge, the first
  among them. "prompts counts a person's prompts before the merge, beside the first" fails on issue #7101, naming
  its `prompts` of 4 against 3, and that every issue reads one more.
- **Counts nested grants** (`#3534.f9de4edc`): `grants` counts every `granted` row of the class, the nested ones
  with the top-level ones. "the machine's build and test lines give the top-level grants" fails, naming
  `machine.build.grants` of 5 against the 3 top-level grants.
- **Names a day with 10** (`#3534.2c0280c9`): a day is named when it has 10 such calls or more. "a day with over 10
  tool calls a hook left unanswered is named" fails, naming the day `2025-03-10`, its 10 calls and what `days` says
  of it.
- **Counts a mention of a revert** (`#3534.9ca3cb3b`): a revert is a PR whose title holds the word `revert`
  anywhere, in either case. "quality over the span" fails, naming `quality.reverts` of 2 against 1 over the first
  span: one title starts with `Revert`, another only mentions a revert.
- **A person's wait as a job's** (`#3534.8eed42c8`): a turn's end until a person's prompt is `job` whenever the
  session started a background job before it, whether or not that job has given its notice. "a turn's end until a
  person's prompt is a wait for a person" fails on issue #7102, naming the 11 minutes counted as a job's. A table
  that counts every such wait as a job's fails it on #7101.
- **A wait counted whole** (`#3534.8eed42c8`): a wait that starts before the merge is counted to its end. "a wait
  that runs past the merge is cut at the merge" fails on issue #7104, naming the 85 minutes past the merge.
- **Not read as zero minutes** (`#3534.087b8d1d`): an issue with no transcript gets a row of zero minutes and a
  place in the averages. "an issue whose sessions left no transcript is listed as not read" fails, naming issue
  #7106 and its row; "the issue that is not read is in no average" fails on `total.issues`, naming it too.
- **Takes the last of the four words** (`#3534.4ae32bc7`): a PR's issue is the last `Closes #n`, `Fixes #n`,
  `Resolves #n` or `Part of #n` of its body, not the first. "the table holds each issue whose PR merged in the
  span" fails over the first span, naming the rows for 7190 and 7191, which it should not have, and the bodies that
  name them after their first of the four.

Each of the six new ones fails its test at an assertion, on the fixture as it stands. A fault in how an issue is
named or read fails other criteria's tests too, since they read the same rows: that is the fault's reach, not a
second fault.

## The 7-day targets are #3553's

The numbers the project is to reach over 7 real days, with the readings they were drafted from, are the criteria of
#3553 since the split. Nothing here tests them. A pass of this suite says the command counts right on records made
up here, never that a target is met.

## Outside this folder

Nothing. The suite needs no line in a lane list, a ceiling or a rule: it has no fixed wait, no file over 1,500
lines, no home path, no key-shaped string and no dependency but Node's own modules, and it needs no `lane.json`,
since it builds no binary, judges no time and shares nothing with another suite. `twins.json`, which gives each
criterion's ID the names of its twins' folders, and the twins' folders are the implementing agent's to add here.

## Not tested here

- That the command follows the facts file to another place: the fixture's transcripts are where the base's facts
  file says, and that file is not edited.
- A transcript that exists and can't be read (a torn file, another agent's): the not-read issue has none.
- Tool calls that overlap, a prompt sent while a turn runs, a notice that arrives during a turn, and a session that
  changes branch.
- Rounding: every cause of every planted issue is a whole number of minutes.
- The machine's lines and `days` over the second span, and anything the table prints beyond surface 14.
- "No verdict reads it": a rule for the change, not an output of the command.

## Run

```sh
node --test tests/acceptance/3534/*.test.mjs
```

It needs Node 24, no `node_modules`, no build and no network, and takes a few seconds; with git on the `PATH` the
scratch tree is a repository, and without it a plain folder. The files are named because, in the first pass's run,
Node 24 read the folder alone as a module and ran no test. Each run of the command is given 2 minutes.

Drafting checked two things beyond the base run. The lint lane's own patterns for a new suite (fixed waits, home
paths, key-shaped strings, 1,500 lines) and the studied-names check were applied to these files and found nothing;
the lanes themselves were not run. And the suite was run on a throwaway reading of the issue kept outside the
repository, never part of the suite and deleted since: all 21 tests pass on it, as they do when it calls `gh` and
writes numbers, times, a cut wait and a day's sessions the other ways surfaces 3, 5, 11 and 12 allow; each of the
ten planted tables above and each wrong program the table lists, made as one fault in it, fails the test named, at
an assertion; and all 21 fail when it prints nothing, an empty object or zeros. That reading is this job's guess at
the issue, not the work, and proves only that the suite can pass and can fail.

Not run: `cargo`, `npm`, `scripts/affected.mjs`, `scripts/proof.mjs`, `scripts/lanes.mjs` and the preflight.

`BASE-FAILURE.txt` is the suite's output at the base `5a81b58de`, and why each test fails there.
