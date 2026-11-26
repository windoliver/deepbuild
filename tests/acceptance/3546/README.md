# Acceptance tests for #3546: an issue's first read is counted, and one past 25,000 tokens prints its outline first

Written first, blind, from issue #3546 ("An issue's first read is counted, and one past 25,000 tokens prints its outline
first: …": its report, Scope, six acceptance criteria and Proof, as the brief gave its body; it has no comments), the
design sections it links and the base commit `2edb19ff4369bb7b3370d9f66e32324b8db478e9` ("Merge pull request #3561 …"),
by a job that never saw an implementation; none existed. No other branch, worktree or pull request was read, nor
GitHub, and the real `gh` never ran. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding). Node's test runner and built-ins, and the pinned tokenizer.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#3546.05239cdb` | `ac1-closing-line.test.mjs` (1) |
| AC2 | `#3546.a6d8d944` | `ac2-outline.test.mjs` (2: the outline one token over the limit, and `--all`) |
| AC3 | `#3546.bf38895d` | `ac3-at-the-limit.test.mjs` (1) |
| AC4 | `#3546.9cf18941` | `ac4-issue-89.test.mjs` (1) |
| AC5 | `#3546.b80552ec` | `ac5-lane-line.test.mjs` (1) |
| AC6 | `#3546.c49452fc` | `ac6-same-words.test.mjs` (2: the two files' words on this checkout, and one file edited alone) |

IDs are the repo's rule (`criterionId` in `scripts/proof-change.mjs`): `#3546.` and the first 8 hex digits of the
SHA-256 of each criterion's text after `- [ ] `, trimmed, white space collapsed, over the body the brief gave; the live
issue wasn't read, so they aren't checked against it. Each test's name starts with its ID and its AC number.

## What was read

- The issue and its body; the design section it links, How we know version 0 works, with Built to be hard to get wrong
  inside it (Criteria to tests, both ways; Criteria in a checked shape; Wrong programs; The edit guard; Dogfooding; Tests
  written first; Repo guards); #2338, #910, #2688 and #1324 for the words #3546 cites; #89's body as GitHub held it on
  2026-11-26; and the open issues as the lanes' fetch returned them that day, for the readings below only: no test
  reads them and they are not in the repository.
- At the base: `scripts/design-section.mjs`, `scripts/doc-links.mjs`, `scripts/open-issues.mjs`,
  `scripts/design-links.mjs` (and what it reads through `design-drift.mjs` and `principles.mjs`),
  `scripts/doc-ceilings.mjs`, `scripts/reading-rule.mjs`, `scripts/tool-load.mjs` (how the pinned tokenizer counts),
  `scripts/lanes.mjs` (the `lint` and `design links and names` entries), `scripts/proof-runs.mjs` (`atAssertion`, and how
  a copy links `node_modules`), `scripts/proof-change.mjs`, `scripts/repo-rules.mjs`, `scripts/wait-ratchet.mjs`,
  `AGENTS.md`, `CONTRIBUTING.md`; the suites `2338/`, `910/`, `2340/` and `2339/redraft-1876/` for the house format.
- The two design docs at `5c0ccc038` (an ancestor of the base, the commit the issue read), only to take the issue's own
  numbers for #89 again: see "Readings".

## Run

```sh
node --test 'tests/acceptance/3546/*.test.mjs'
# on a shared machine, through the throttle:
node scripts/throttle.mjs test --wait 30 -- node --test 'tests/acceptance/3546/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up; run them by hand. All eight are
offline: no network, no `gh` sign-in, no build, no git. They need Node (the repo's 24.22 or newer), `/bin/sh` (the `gh`
stand-in) and the checkout's `node_modules`, for the pinned tokenizer (`gpt-tokenizer` 4.0.0, a root dev dependency):
without it `helpers.mjs` stops every test as BLOCKED, never a pass. Three to five seconds for the suite once the work
exists, about one on the base. Each scratch copy is under the OS temp folder and removed after its test. One test (AC6's first) runs the lint
lane's text check with its working folder at the checkout itself, which it reads and never writes; AC5 and AC6 read two
lanes' commands from the checkout's `scripts/lanes.mjs` in a child process. No folder needs a `lane.json`: nothing here
is shared, built or timed.

## The surface (my choice where the issue leaves it open)

Every shape below that the issue or the design doesn't give is a requirement of these tests on the implementation;
"What the implementation must provide" repeats them plainly. A number may always carry thousands commas or none.

### The script: `node scripts/design-section.mjs --issue <n>`

- **`--all` follows the number**: `node scripts/design-section.mjs --issue <n> --all`.
- **The closing line** is the last non-empty line of standard error, on every run that prints an issue's sections, and
  the run exits 0. In it, the first whole number followed by the word `section` or `sections` is the sections printed,
  the first followed by `byte` or `bytes` their bytes, and the first followed by `token` or `tokens` their tokens
  (`3 sections, 140,284 bytes, 25,000 tokens`). Anything may stand before, between and after them, so a limit the line
  also names comes after the total.
- **What the three count** when the text prints: the sections are the `==> <doc>#<anchor> <==` sections on standard
  output; the bytes and the tokens are those of the sections' text, without the `==>` lines ("What a count is taken
  over", below). Standard output is what the merge base prints, byte for byte.
- **The limit is 25,000 tokens**, the issue's drafted number, and "passes" is strictly more: 25,000 prints the text,
  25,001 the outline.
- **Past the limit**, without `--all`, the run exits 0 and standard output holds **one line for each heading** of each
  section the text would print, the sections in the order the issue first links them and each section's headings in the
  doc's order (a heading is a line outside fenced code, as the design links lane reads them). A heading's line holds:
  its anchor right after a `#`, as `#<anchor>` or `<doc>#<anchor>`, the heading's own slug, followed by no letter,
  digit, `_` or `-`; its own tokens as an `<n> tokens` of the line (any one, should the heading's own words hold
  another); and the heading's text (held on the fixture, whose headings are plain words). A line that starts with
  `==>` isn't read, so the header lines may stay and may carry a section's total. Any other line may be there, but
  none that is a line of the sections' text other than a heading's own, and none that holds such a line of 80
  characters or more.
- **The lines' own tokens add up to the total**, and the closing line's first `<n> tokens` is that total. Its sections
  and bytes aren't read past the limit.
- **The command that prints one**: standard output or standard error holds `node scripts/design-section.mjs` followed
  by a word with a `#` in it, such as `<doc>#<anchor>` written so or a real one.
- **`node scripts/design-section.mjs <doc>#<anchor>`** prints, for each anchor an outline line gives, that heading's
  section, exit 0, standard output only the section's bytes: as at the merge base.
- **The open issues** come from `openIssues()`'s `DEEP_OPEN_ISSUES` file, as at the merge base; `gh` fails in every test.
- **Where it runs**: from the root of a scratch copy that holds the root files, `scripts/` and `docs/`, with
  `node_modules` a link to the checkout's, so the pinned tokenizer must load through that link.

### The lane's line

- **The lane** is the one entry of `checks` in `scripts/lanes.mjs` whose name says link or links and isn't the
  catalogue drift lane's (`design links and names` at the base). Its commands run in order in a copy that holds the
  checkout's docs and folders (below), and it **exits 0** over issues whose links all land, four of them past the limit.
- **The line** is the one line of those commands' output, standard output or standard error, that holds the word
  `median`: exactly one. It holds each of these as a whole number that is not part of `#<n>`, of a longer number or of a
  decimal: the issues read, the median, the 90th percentile, the largest, and how many pass the limit. It names the
  largest's issue as `#<n>`, and no other issue of the fixture. Where each number stands, and what words stand around
  it, is free: the fixture's five numbers differ from each other and from the limit, so each is told apart.
- **What it counts**: an issue is read when `--issue` would print at least one section for it; its tokens are what
  that run's closing line would give, any `docs/*.md` section counting as the script counts it (the fixture's doc is
  `docs/first-read.md`). The median of eleven is the sixth smallest. The 90th percentile is the smallest value with at
  least nine tenths of the issues at or under it, the tenth of eleven; the ninth equals it and 0.9 × (11 − 1) is a whole
  number, so the nearest rank, the floor and linear interpolation all agree. "Pass the limit" is strictly more than
  25,000.

### The two files' words, and the text check

- **The sentence**: `AGENTS.md` and `CONTRIBUTING.md` each hold a sentence that names the limit as `25,000` (or
  `25000`), and it is the same sentence, character for character. A sentence is read as `scripts/reading-rule.mjs`
  reads one: it ends at a `.` followed by white space or at the line's end; a list marker and an HTML comment aren't
  part of it. Where a file names the limit in more than one sentence, the first pair that is the same sentence is the
  one the tests take. No other word of it is required.
- **The text check** is the lint lane's `[process.execPath, 'scripts/reading-rule.mjs']`, as #2338's suite requires. A
  pass is exit 0 with a line starting `PASS` and none starting `FAIL`, `INVALID`, `BLOCKED` or `INCONCLUSIVE`. A finding
  is a non-zero exit, a line starting `FAIL`, and both lines named in its output as `AGENTS.md:<line>` and
  `CONTRIBUTING.md:<line>`: the 1-based lines that hold the edited sentence in each file.
- **It must find the sentence after an edit.** The planted edit gives the limit's sentence three more words, ` and no
  more`, before its final `.`, in one file; the sentence keeps its line and still names 25,000. The reading rule's edit
  is #2338's: `before edits` becomes `before any edit`. So the check must not find either sentence by its full wording.

## What a count is taken over

The issue counts tokens twice: a closing total, and each heading's own tokens, which add up to it.

- **The total** is the pinned tokenizer (`gpt-tokenizer` 4.0.0's `o200k_base`, imported as `scripts/tool-load.mjs`
  imports it) over the text of the sections printed, without the `==>` lines; the bytes likewise. The issue's own numbers
  say so: its table gives #89 442,539 bytes and 111,413 tokens, and "the script prints the same bytes plus its `==>`
  lines", 442,782. Taken again at `5c0ccc038` with #89's body, the sections are 442,539 bytes and 111,413 tokens; with
  the four `==>` lines tokenized too they would be 111,483.
- **A heading's own tokens** are the tokenizer over its own text as #2338 defines it: the bytes from its line to the
  next heading's line of any level.
- **Whole, by section or by heading** is left open by the issue, and a tokenizer need not split a text at its headings
  as it splits the pieces. For #89, at `5c0ccc038` and at the base, the text counted whole, a section at a time and a
  heading's own text at a time give one number. The fixture is built so they must: every heading's own text ends in a
  blank line and the next begins with `#`, which the tokenizer never joins. `firstRead` in `helpers.mjs` takes the count
  all three ways and calls a fixture where they differ INVALID.
- **Where they can't agree**: a section linked by an explicit `<a id>` starts at the `<a id>`'s line, bytes that no
  heading's own text holds (52 of the 1,135 issues that print a section at the base read a few tokens more by section
  than by own text). No test past the limit links one. AC1 links one, `#the-other`, where the text prints and the count
  is of the text printed.

## The scratch copies, the merge base's copy and the `gh` stand-in

Each test that runs a script gets a sandbox under the OS temp folder, removed afterwards. Its `repo/` holds the
checkout's own root files (never `.git` or a `.env*`), a copy of `scripts/` (without `node_modules`, `target` or
`.git`), `node_modules` linked to the checkout's so the tokenizer resolves, and the test's docs in `docs/`. For AC4 and
AC5 it is the tree the design links lane reads: `docs/` links every entry of the checkout's `docs/`, every other folder
of the checkout is linked (never `.git` or `target`), and `scripts/planned-names.txt`, whose entries name real open
issues, is emptied. A script runs with that folder as its working folder, with `HOME`, `TMPDIR` and the XDG folders the
sandbox's own, no GitHub token, host or repo variable, no git variable pointing elsewhere, `DEEP_OPEN_ISSUES` naming the
file the test wrote, and a **`gh` stand-in first on `PATH`** that records its arguments and fails as `gh` does with no
sign-in (exit 4). No copy is a git repository and no test runs git.

**The merge base's output** is taken by running the merge base's script: `merge-base/` holds `design-section.mjs`,
`doc-links.mjs` and `open-issues.mjs` copied byte for byte from `scripts/` at `2edb19ff4` (their git blobs are
`538acaf2b`, `f080d9da0` and `13c0f7b36`), and each copy gets them as `repo/merge-base/`, beside `scripts/`, where the
script finds the copy's root as it does from `scripts/`. A merge-base run that doesn't print the sections the oracle
reads stops the test as BLOCKED. The oracle (`sectionOf`, `linked`, `firstRead`) and the planted programs read headings,
anchors and links with that `doc-links.mjs`, never with the checkout's.

## The fixtures

**The doc** (`fixtureDoc` in `helpers.mjs`, about 144 KB, built by the test and not checked in) is the technical design
in a copy where the script runs alone (a one-heading canvas doc beside it), and `docs/first-read.md` beside the
checkout's own docs where the lane runs. Nine headings, each with its own text built to an exact token count from
filler words, one token each, 16 to a line:

| Heading | Anchor | Own tokens | Its section |
|---|---|---|---|
| `# First read fixture` | `first-read-fixture` | 60 | the whole doc |
| `## Other`, after `<a id="the-other"></a>` and a blank line | `other`, `the-other` | 150 | 150 from `#other`, 158 from `#the-other` |
| `## Outer` | `outer` | 120 | 300 |
| `### Inner`, whose text holds a line with `é`, `—`, `ï` and `✓` | `inner` | 80 | 80 |
| `### Inner two`, whose text holds a fenced block with the line `# not a heading` | `inner-two` | 100 | 100 |
| `## Bulk` | `bulk` | 20,000 | 24,300 |
| `### Bulk part` | `bulk-part` | 4,300 | 4,300 |
| `## Tail` | `tail` | 400 | 400 |
| `## Tail and one` | `tail-and-one` | 401 | 401 |

**The script's issues**, in a `DEEP_OPEN_ISSUES` file, each a `**Design:**` line of full links and, for three, a Scope
line with a relative `docs/…` link:

- **#9546** links `#outer`, `#the-other`, then `#inner`, which sits inside the outer and prints nothing more: 2
  sections, 2,465 bytes, 458 tokens.
- **#9547** links `#inner`, `#outer`, `#tail`: 3 sections, the inner's text twice, 4,261 bytes, 780 tokens.
- **#9548** links `#outer`, `#bulk`, `#inner`, `#tail-and-one`, then `#bulk` again: 3 sections, 6 headings, 140,286
  bytes, **25,001 tokens**. Its outline: outer 120, inner 80, inner-two 100, bulk 20,000, bulk-part 4,300, tail-and-one
  401.
- **#9549** is #9548 with `#tail` for `#tail-and-one`: 3 sections, 140,284 bytes, **25,000 tokens**.

**The lane's issues**, thirteen, linking `docs/first-read.md`: #9550 `#inner` 80; #9551 `#other` 150; #9552 `#outer`
then `#inner` 300; #9553 `#tail` 400; #9554 `#bulk-part` 4,300; **#9555 `#bulk` twice** 24,300 (48,600 with each link
counted); #9556 `#outer`, `#bulk`, `#tail` 25,000; #9557 `#outer`, `#bulk`, `#tail-and-one` 25,001; #9558 and #9559,
`#bulk`, `#other`, `#outer`, `#tail` in two orders, 25,150 each; **#9560**, those four and `#tail-and-one`, 25,551;
#9561 with no link into the docs; #9562 linking the doc by no section. The line: **11 issues read, median 24,300, 90th
percentile 25,150, largest 25,551 (#9560), 4 past the limit**. With a section counted for each link: median 25,000, 90th
percentile 25,551, largest 48,600 (#9555), 5 past the limit.

**AC4's issue** is `fixture/issue-89.md`, #89's body as GitHub held it on 2026-11-26, over the checkout's own two design
docs. Issue numbers from 9546 and their texts are made up; no fixture holds a secret or personal data.

## Criteria to tests, and the planted programs

This job wrote the planted programs, in test code, in `planted/`: `twin.mjs` is a twin of what the issue asks of the
script and of the lane's reading, written from the issue and this README alone; each other file there runs it with one
fault, named in that file's own code, never chosen by an environment variable (design: Wrong programs), and
`first-sentence-only.mjs` is a twin of the text check as it stood before #3546. The implementation provides no planted
program. Each test holds the script to the criterion, then runs the criterion's planted program on the same input,
checks that it does what the issue says it does, and checks that the same judgement fails it, naming what the issue
says; the failure is printed as a test diagnostic, for the Proof's "each planted script failing".

| Criterion | Test | The script must | The planted program | It must fail, naming |
|---|---|---|---|---|
| AC1 `#3546.05239cdb` | `ac1-closing-line.test.mjs` | for #9546 and #9547: standard output the merge base's, exit 0, and a closing line whose sections, bytes and tokens are those of the text printed | `counts-inner-twice.mjs`: prints #9546's two sections and counts the inner one again | both totals: "the closing line says 3 sections, 2,885 bytes and 538 tokens; the text printed is 2 sections, 2,465 bytes and 458 tokens" |
| AC2 `#3546.a6d8d944`, first | `ac2-outline.test.mjs` | for #9548: exit 0, six heading lines in order, each with its `#<anchor>`, its heading and its own tokens, adding up to 25,001; the closing line's 25,001 tokens; the command that prints one; none of the text; and each of the six anchors printing its section with the anchor command | `text-past-limit.mjs`: prints #9548's text, as the merge base does | the count: "3 sections and 25,001 tokens by the pinned tokenizer, 1 past the limit of 25,000" |
| AC2, second | `ac2-outline.test.mjs` | for `--issue 9548 --all`: standard output the merge base's, exit 0, and a closing line that counts it, 25,001 tokens | the merge base (no `--all`: exit 2) | "exited 2", "printed 0 bytes, not the 140,409 bytes the merge base prints" |
| AC3 `#3546.bf38895d` | `ac3-at-the-limit.test.mjs` | for #9549: standard output the merge base's, exit 0, and a closing line that counts it, 25,000 tokens | `outline-at-limit.mjs`: prints the outline from the limit on | the count: "#9549's sections total 25,000 tokens, which is the limit of 25,000 and not past it" |
| AC4 `#3546.9cf18941` | `ac4-issue-89.test.mjs` | for #89 on the checkout's docs: exit 0, one heading line for each heading of its four sections in order (184 at the base), own tokens adding up to the total (111,667 at the base), the closing line's total, the command that prints one, none of the text | the merge base, whose copy prints the text (443,887 bytes at the base) | "printed the sections' text …, 4 sections and 111,667 tokens …, 86,667 past the limit" |
| AC5 `#3546.b80552ec` | `ac5-lane-line.test.mjs` | the lane exits 0 and prints one line with 11, 24,300, 25,150, 25,551, `#9560` and 4 | `lane-per-link.mjs`: counts a section once for each link, so #9555 reads 48,600 | the issue: "the line names #9555, whose sections total 24,300 tokens counted once each and 48,600 with a section counted for each link to it; the largest is #9560 with 25,551" |
| AC6 `#3546.c49452fc`, first | `ac6-same-words.test.mjs` | on the checkout: `AGENTS.md` and `CONTRIBUTING.md` each hold a sentence naming 25,000, the same sentence, and the lint lane's text check passes | the merge base (no such sentence) | "AGENTS.md holds no sentence that names the limit, 25,000" |
| AC6, second | `ac6-same-words.test.mjs` | in a copy: pass with nothing edited; fail, naming `AGENTS.md:<line>` and `CONTRIBUTING.md:<line>`, when the limit's sentence is edited in either file alone, and when the reading rule's is | `first-sentence-only.mjs`: holds the reading rule's sentence alone, so it passes `CONTRIBUTING.md`'s limit sentence edited alone | "exited 0 though the two files' words differ" |

### What holds on the base by its nature, and its wrong program

Every test fails on the base at an assertion of its own (below), so none needs a twin kept as wrong lines. Three parts
of them hold on the base, since the base already gives the output they name. For each, one wrong program, the work with
a single fault, that the part fails:

- **AC3, the text byte-equal to the merge base's.** The limit off by one: the outline prints when the total is 25,000
  or more (`>=` for `>`). `ac3-at-the-limit.test.mjs` fails, naming the count: "#9549's sections total 25,000 tokens,
  which is the limit of 25,000 and not past it". It is `planted/outline-at-limit.mjs`, which the test runs.
- **AC2, `--all`'s output byte-equal to the merge base's.** `--all` taken and ignored: past the limit the outline prints
  whatever the flag. `ac2-outline.test.mjs`'s second test fails: "printed … bytes, not the 140,409 bytes the merge base
  prints".
- **AC6, the reading rule's sentence edited in one file alone.** The check holds the limit's sentence and no longer the
  reading rule's. `ac6-same-words.test.mjs`'s second test fails: "scripts/reading-rule.mjs, with AGENTS.md:3's reading
  rule edited alone exited 0 though the two files' words differ".

### On the base

All eight fail at a `node:assert` assertion under the test paths (`none` in `helpers.mjs`, or the test's own first
assertion): AC1 and AC3 on "ends with no line on standard error", AC2's first and AC4 on the text printed past the
limit, AC2's second on `--all` (the base prints its usage and exits 2), AC5 on "0 lines with the word median" after the
lane passes, AC6's first on "AGENTS.md holds no sentence that names the limit" and its second on "hold no one sentence
that names the limit". No helper crashes and no file is missing (`BASE-FAILURE.txt`).

### How I checked the tests can pass and fail

Outside the checkout, in a scratch folder, a throwaway guess at the change: the base's three scripts edited by hand
(a closing line, the outline in another layout than the twin's, `--all`; a reading line in the lane; the text check
holding a second sentence) and one sentence added to both files. All eight tests passed on it, each printing its
planted program's failure (`BASE-FAILURE.txt`, second part). Ten single faults put into the guess each failed the
tests named for them: the outline from the limit on (AC3); a count that drops a section printed twice (AC1, on #9547);
characters counted for bytes (AC1, AC2's second, AC3); `--all` ignored (AC2's second); a section's whole tokens on its
heading's line (AC2's first, AC4); a lane that reads the issues that print nothing, and one that counts from the limit
on (AC5); a text check holding the first sentence alone, and one holding the limit's sentence alone (AC6's second); and
the two files' sentences differing by a word (AC6's first). The guess was deleted, and nothing of it is in the checkout.

## Readings

What no offline test takes, for the pull request, and what this job read at the base on 2026-11-26.

- **AC4, on main.** The test holds #89's outline over the checkout's docs and #89's body of 2026-11-26. Left as a
  reading: `node scripts/design-section.mjs --issue 89` on main with the live issues, printing an outline. The issue's
  442,782 bytes are `5c0ccc038`'s: the base's own script, run there on that body, prints 442,782 bytes, 442,539 without
  its four `==>` lines. At the base, `2edb19ff4`, it prints 443,887 and 443,644, the docs having grown: 111,667 tokens
  under 184 headings.
- **AC5, on main.** The test holds the line over the fixture's thirteen issues. Left as a reading: the lane's line on
  main, with the count on the day. Over the 1,212 issues open on 2026-11-26 at 08:37 EST and the base's docs, the
  script's loop gives: 1,135 issues that print a section; median 9,846 tokens; 90th percentile 27,404 by nearest rank
  (27,393.6 interpolated); largest 111,667 (#89); 147 past 25,000, 36 past 50,000 and 2 past 100,000. The issue's
  1,122, 9,959, 27,487, 111,413 and 145 are Nov 25's issues at `5c0ccc038`.
- **The lane fails on main that day.** With those issues the base's `node scripts/design-links.mjs` exits 1: #3495 to
  #3499 link `docs/technical-design.md#what-a-person-reads-on-a-plain-surface`, which the base's design doesn't have.
  Whether the reading's line still prints when the lane fails on another finding is not in the issue, and no test
  requires either; it decides whether the line on main can be recorded while those links don't land.
- **This issue's own two links** print one section, the second sitting inside the first: 74,986 bytes, 16,610 tokens, 6
  headings at the base. That is under the limit, so `--issue 3546` prints the text; the Proof's "as an outline" needs a
  way to ask for one that the Scope doesn't name, and no test requires one.
- **`AGENTS.md`** at the base is 42 lines, 4,123 bytes and 889 tokens; `CONTRIBUTING.md` 38 lines and 774 tokens.

## What the implementation must provide

1. `node scripts/design-section.mjs --issue <n>`, run from the root with the open issues in `DEEP_OPEN_ISSUES`:
   - When the sections total 25,000 tokens or fewer by the pinned tokenizer: standard output as at the merge base, exit
     0, and a last line on standard error whose first `<n> sections`, `<n> bytes` and `<n> tokens` are the `==>`
     sections printed, their bytes and their tokens, the `==>` lines not counted.
   - When they total more: exit 0; one line on standard output for each heading of each section, in order, holding
     `#<anchor>` (the heading's slug), the heading's text and `<n> tokens` of its own text; no line of the text; the
     own tokens adding up to the total; a last line on standard error whose first `<n> tokens` is the total; and, on
     either stream, `node scripts/design-section.mjs <doc>#<anchor>` or a real one.
   - `--issue <n> --all`: the text, as at the merge base, with the closing line.
2. The tokenizer loaded so that the script runs in a copy whose `node_modules` is a link to the checkout's.
3. The design links lane, by its commands in `scripts/lanes.mjs`: still exit 0 on issues past the limit, and one line
   holding the word `median`, the issues read, the median, the 90th percentile and the largest in tokens, the largest's
   issue as `#<n>`, and the count past 25,000; each issue counted as `--issue` counts it, a section once however often
   the issue links it.
4. `AGENTS.md` and `CONTRIBUTING.md` each holding one sentence that names `25,000`, the same sentence.
5. `scripts/reading-rule.mjs`, still the lint lane's command: PASS on the two files; a `FAIL` line, a non-zero exit and
   `AGENTS.md:<line>` and `CONTRIBUTING.md:<line>` when the limit's sentence or the reading rule's is edited in one
   file alone, found by its place and not by its full wording.

No planted program is needed from the implementation, no `twins.json`, no `scripts/lanes.mjs` entry for this folder,
and no line anywhere outside it.

## Not tested, because no criterion reaches it here

`AGENTS.md` staying under one page (Scope): neither the issue nor the design gives a page a measure, so any bound would
be this job's own; its size at the base is under "Readings". The Proof's outputs in the pull request: the lane's line on
main, and the script's output for this issue's own two links as text and as an outline. The lane's line when the lane
fails on another finding, or is INCONCLUSIVE without the issues. The script without the pinned tokenizer: #2338's suite
runs it in scratch copies that hold no `node_modules`, where a tokenizer imported at the script's top can't load, so its
AC1 to AC3 fail on such a script; what the script does there is that suite's to hold and the issue is silent on it. A
section linked by an explicit `<a id>`, or an issue that links a section after one inside it, past the limit (where an
outline's own tokens can't add up without a choice the issue doesn't make). Which doc an outline line's anchor
belongs to: the lines are read in order, so a line needn't name its doc, and only the fixture's one doc is put to the
anchor command. A heading's text on its line where the doc writes it with markup (AC4 doesn't read the text). A median
over an even count, and a 90th percentile where the common rules differ. The
bytes and sections of the closing line past the limit. `--all` anywhere but after the number, and with the anchor
form. The anchor form's own output past the limit (it stays the section's bytes). An issue with a link that doesn't
land, a closed issue, or no fetched issues, which stay #2338's. What the Scope leaves out of this task: narrowing an
issue's links, splitting or shortening a section, breaking long lines, and summaries a model writes; no test asks for
any of them.

## Files

- `helpers.mjs`: the scratch copies and the `gh` stand-in, one run of a script, of the merge base's copy or of a planted
  program, the fixture doc and its issues, the oracle, and each criterion's judgement.
- `ac1-closing-line.test.mjs`, `ac2-outline.test.mjs`, `ac3-at-the-limit.test.mjs`, `ac4-issue-89.test.mjs`,
  `ac5-lane-line.test.mjs`, `ac6-same-words.test.mjs`: one file per criterion, eight tests.
- `merge-base/design-section.mjs`, `merge-base/doc-links.mjs`, `merge-base/open-issues.mjs`: the base's three scripts,
  byte for byte.
- `fixture/issue-89.md`: #89's body of 2026-11-26.
- `planted/twin.mjs`, and the planted programs `counts-inner-twice.mjs`, `text-past-limit.mjs`,
  `outline-at-limit.mjs`, `lane-per-link.mjs` and `first-sentence-only.mjs`.
- `BASE-FAILURE.txt`: the run on the base, and the self-check on the guess.
