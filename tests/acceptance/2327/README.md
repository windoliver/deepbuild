# Acceptance tests for #2327: a security report has a private route

These tests were drafted blind, before any implementation, from:

- issue #2327 of `windoliver/deepbuild` ("A security report has a private route: SECURITY.md names it, the issue chooser points to it, and a way past a guard is filed in public only once its fix has merged"), its body as updated at 2026-11-22T06:59:47Z;
- `docs/technical-design.md`: Threats, and what stops each one; How it installs; the Dogfooding bullet and Built to be hard to get wrong. None of them names `SECURITY.md` or the private route, so every expected value here is the issue's;
- `AGENTS.md`;
- the base commit `11eb8c6fd232bffa4c7f9a06ec12467e252f70e8`, read for public surfaces only: what `node scripts/repo-rules.mjs` prints, `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/task.md`, and how `scripts/proof-change.mjs` derives a criterion's tag;
- sibling suites, for their conventions: `tests/acceptance/1432`, `1143`, `246` and `879`.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft by this job.

## Run

Use Node 24 and have `git`, `cargo` and `gh` on PATH (on this Mac cargo is under `/opt/homebrew/opt/rustup/bin`). From the checkout's root:

```
node --test 'tests/acceptance/2327/*.test.mjs'
```

The suite takes under a minute; most of it is one `node scripts/repo-rules.mjs` run over this checkout, which calls `cargo metadata --offline` on every crate. It needs no `node_modules` and no build. On the base all 12 tests fail, each at an assertion and for the expected reason, as `BASE-FAILURE.txt` shows.

Each tagged test's name starts with its criterion's tag, computed by `readIssue` in `scripts/proof-change.mjs` from the live issue body. No test has subtests.

## Surfaces

- `node scripts/repo-rules.mjs`, run as a process with its working folder at the tree it checks: this checkout, read-only, or a scratch tree.
- The files `SECURITY.md`, `.github/ISSUE_TEMPLATE/config.yml` and `CONTRIBUTING.md`, read as text.
- `gh api repos/windoliver/deepbuild/private-vulnerability-reporting`, read-only.

## Side effects

- Nothing is written into this checkout, and no setting, issue or label is changed on the forge. The API call is one GET.
- Each planted tree is a scratch git repository under the system temporary folder, realpathed, named `deep-route-2327-*`, and removed in `t.after`. Its git commands run with `-c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null`.
- In a scratch tree `repo-rules` runs `cargo` and `git` as it does anywhere; cargo finds no manifest there and writes nothing.

## Readings where the issue leaves a choice

1. **This repository.** It is `windoliver/deepbuild`, the repository the issue is filed in and its design links point to. The API path names it outright in place of `{owner}/{repo}`, which `gh` fills from the working folder's remote: a lane's copy of the checkout may have no remote, and the answer has to be this repository's either way.
2. **The route.** "The forge's private report form for this repository" is `https://github.com/windoliver/deepbuild/security/advisories/new`. `SECURITY.md` holds that address in full, and the contact link's `url` is exactly it. An address of another repository's form is no route.
3. **Where the check lives.** The issue says "the repo-rules check" and "the same check", so every lint test runs `node scripts/repo-rules.mjs` and nothing else. The tests don't fix the check's name, how many lines it prints, or whether its code is in that file or a sibling it imports. #246's `repo-rules.test.mjs` asserts exactly five lines from that script on a clean scratch tree (one per check then: workflows, agent-hooks, secrets, deps, size). At this base the script already reports seven checks (cards and physics-build came later), so that count is already not the script's; a line from this check adds one more. That suite is not this job's to edit.
4. **"`scripts/repo-rules.mjs` passes."** At the base the script exits 1 on this checkout with 179 failing lines of the secrets and deps checks, which belong to other issues, and on any scratch tree its physics-build and deps checks fail for want of a Cargo workspace. So a pass is judged by lines, never by the exit status alone:
   - a line starts with `PASS ` and has the word "security" in any case, in the check's name or as `SECURITY.md`. A silent run is not a pass (invariant 2);
   - no line that starts with `FAIL `, `INVALID `, `BLOCKED ` or `INCONCLUSIVE ` names `SECURITY.md`, `CONTRIBUTING.md`, or `config.yml` by its path or its name.
5. **A planted failure.** The run exits 1 and a line that starts with `FAIL ` names the file: `SECURITY.md`, or `.github/ISSUE_TEMPLATE/config.yml` (the bare `config.yml` counts). The words around the name are free.
6. **"Naming the missing part."** The missing part is the route. The FAIL line that names `SECURITY.md` also says "route", "private report" or "advisor…" (as in "advisory" or the address), in any case.
7. **The four parts of `SECURITY.md`.** The test reads the file itself for them, by the issue's own words and in any case; headings, order and the sentences around them are free.
   - What to report privately: "guard", "hook", "sandbox", "trusted card", "credential" and "session".
   - The route: the address of reading 2.
   - What the reporter hears back and by when: "acknowledgement" (or "acknowledgment") and "three working days" (or "3 working days").
   - Everything else: "public issue".
   The lint is held to less, as the issue's scope says: it fails "when `SECURITY.md` is missing or names no route". No plant removes one of the other three parts, so whether the lint also checks them is the implementation's choice.
8. **"Under a page."** At most 60 lines and 700 words. `AGENTS.md`, which this repo keeps "under one page", has 42 lines and 658 words at the base.
9. **The rule, and "the same words".** The rule is what the issue's scope gives: a report that fits the private list and isn't public yet is handled in the private advisory; its public issue is filed when its fix has merged, naming the fix; an agent that finds such a fault says so to you and files nothing public; issues already open stay as they are.
   - The test takes each file as its words (list, quote and heading marks, `**`, `__` and backticks dropped, whitespace folded) and finds the longest run of consecutive words the two files share.
   - That run has to say "private advisory", "public issue", "merged", "agent", "nothing public" and "already open". So the whole rule is one unbroken stretch of the same words in both files; a link or a lead-in around it is free.
   - "One line of `CONTRIBUTING.md`": exactly one of its lines says all six.
10. **"A text check that fails when one is edited alone."** The issue doesn't name this check's command. The tests take it to be part of `node scripts/repo-rules.mjs`, the only check the issue names. The plant rewords the rule in one file only, turning every "merged" into "landed", and the run has to exit 1 with a FAIL line that names `CONTRIBUTING.md` or `SECURITY.md`. The tree with both files unchanged has to pass first.
11. **The contact link.** `config.yml` has a top-level `contact_links` list in block style, and one item has `url` equal to the route, with a `name` and an `about`: the forge shows a link only when it has all three. `task.md` is still in the folder. A planted `config.yml` whose only link goes elsewhere fails, and so does a tree with no `config.yml`, since then the chooser shows no link either.
12. **The scratch trees.** Each holds every Markdown file at this checkout's root and every file in `.github/ISSUE_TEMPLATE/`, as the checkout has them, with the plant applied, all committed, so the working tree, the index and the commit agree. `origin/main` points at that commit and `origin`'s URL is this repository's. A copy of every flat file of this checkout's `scripts/` is there too, left out of git's listing through `.git/info/exclude`, so the script finds its siblings and `repo-rules.json`. A check that reads anything else from the tree will not find it there.
13. **Plants come from the checkout's own files.** A plant that takes the route out of `SECURITY.md`, or rewords the rule, edits the file the implementation wrote, so it is the only fault in the tree and a check that reports one problem per file still names it. Those tests first require the unchanged copy to pass, and on the base they fail there.

## Verdicts other than PASS and FAIL

- **BLOCKED, criterion 2.** `setting.test.mjs` fails with a message that starts `BLOCKED:` when `gh` is missing, not signed in or offline, when the API answers anything but JSON, and when the answer isn't `enabled: true`. It is never skipped and never passes without the answer. On 2026-11-21 the API answered `{"enabled":false}`. Turning it on is the owner's step.
- **BLOCKED, the lint.** A `repo-rules` run that doesn't finish fails its test with `BLOCKED:`.
- **INCONCLUSIVE.** A plant that can't be made from the checkout's file (no address to take out, no "merged" to reword), or a contact link written in a YAML style the test's reader doesn't read, fails its test with `INCONCLUSIVE:`. It never passes.

## Criteria and tests

| Acceptance criterion | Tests (file: name after the tag) |
|---|---|
| 1, `#2327.9c7a145b`: `SECURITY.md` exists with the four parts, and `scripts/repo-rules.mjs` passes; a tree without the file fails, naming it; a file that names no route fails, naming the missing part | security-file: *SECURITY.md at the root has the four parts, in under a page*; *node scripts/repo-rules.mjs passes its security check on this checkout*; *a planted tree without SECURITY.md fails, naming the file; with it the tree passes*; *a planted SECURITY.md that names no route fails, naming the missing part; unchanged it passes*; *a planted SECURITY.md whose only route is another repository's form fails, naming the missing part* |
| 2, `#2327.07f9ccee`: the API answers `enabled: true` | setting: *gh api repos/windoliver/deepbuild/private-vulnerability-reporting answers enabled: true* |
| 3, `#2327.030459ba`: the chooser shows the route as a contact link, read from `config.yml` by the same check; a `config.yml` without the link fails, naming the file | chooser: *config.yml lists the private route as a contact link, beside the task template*; *a planted config.yml without the link fails, naming the file; with it the tree passes*; *a planted tree with no config.yml fails, naming the file* |
| 4, `#2327.b5266f32`: both files state the rule in the same words, held by a text check that fails when one is edited alone | rule: *CONTRIBUTING.md and SECURITY.md state the rule in the same words*; *the rule reworded in CONTRIBUTING.md alone fails the text check; unchanged it passes*; *the rule reworded in SECURITY.md alone fails the text check; unchanged it passes* |

## Not covered here

- **"The answer is in the PR"** (criterion 2). A test can't read the PR. The test prints the answer as a diagnostic line; putting it in the PR is checked by hand.
- **"Above the task template"** (criterion 3). The order the chooser draws its entries in is the forge's, and `config.yml` has no field for it, so the tests judge only that the link is listed. Where it is drawn is checked by eye on the chooser page.
- **Criterion 2 on the merge base.** The setting is the repository's, not the tree's, so once the owner turns it on this test passes on any commit, the merge base included.
- "Drafted", said of the acknowledgement, and the Not in this task list (a bounty, a signing key, moving or closing open issues, a list of past advisories) are for diff review.
- Whether a `SECURITY.md` that keeps its route but loses another of its four parts fails the lint (reading 7).
