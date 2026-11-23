# #3166 — one approval tag for earlier commits of the change

Blind acceptance job, against base `3c500c0c8f9b43172d733decddd04705f73317b6`. It saw the issue, the design and
the base commit only: no implementation, other branch, worktree, pull request, session note or network. Everything
it wrote is in this folder; nothing is committed and no shipped file is changed. A dispute goes to this job's blind
redraft (AGENTS.md, Proof).

## Read

- The saved issue #3166 in full: Scope, the seven criteria, Proof, Depends on.
- `AGENTS.md`; `docs/technical-design.md`: Criteria to tests, both ways; Criteria in a checked shape; Wrong
  programs; The edit guard, from the first commit; Dogfooding.
- Base `scripts/proof.mjs`, `proof-approvals.mjs` (`readApprovals`), `proof-change.mjs` (`readChange`, the tag and
  test-path patterns, `criterionId`), `proof-guard.mjs`, and in `proof-runs.mjs` how the before lane reads
  `twins.json`, lays a twin over the change and judges "failed at its assertion".
- `tests/acceptance/1326/` (fixtures, authenticator, guard tests, README) and `tests/acceptance/569/`'s tolerance
  tests, for conventions. Nothing is imported from either.

## Criteria → tests → wrong programs

IDs recomputed from the saved issue: `#3166.` + the first eight hex digits of the SHA-256 of each checkbox's text,
trimmed, white space collapsed. All tests are in `guard.test.mjs`; each name starts with its criterion's ID.

| Criterion | Tests | Wrong program it fails on |
|---|---|---|
| AC1 `#3166.b0866dde` | two proposal commits pass under one signed tag on the last commit, a `@<sha>` line for each | **The merge base**, the criterion's own "guard that reads approvals only from a tag on the commit itself": exit 1 where 0 is asserted. |
| AC2 `#3166.5abaecb6` | each test's line carrying the other commit's ID lets neither edit through; FAIL lines name both tests | `twins/pools-items`, the criterion's "guard that pools a tag's items across the commits it names". |
| AC3 `#3166.9778b6a7` | three tests: a commit made after the tagged commit; a commit on another branch; an ID abbreviated to twelve digits | `twins/any-commit-id`, the criterion's "guard that accepts any commit ID": it credits whatever commit git resolves the ID to. |
| AC4 `#3166.127971be` | two tests: AC1's tag unsigned; AC1's tag signed by a security key the approvers file doesn't list | `twins/unchecked-signature`. The criterion names none; the smallest honest one reads `@<sha>` lines ahead of the signature check, so both tags approve. |
| AC5 `#3166.3b5fa948` | a proposal commit that also adds `extra.txt`, approved by a tag on a later commit, fails, and a FAIL line holds the quoted words | **The merge base**: it fails the edit as unapproved, without the quoted words. Also `twins/whole-commit` (none named; a `@<sha>` line approves its whole commit, whatever files it carries), which fails the exit-code assertion. |
| AC6 `#3166.3acb8f5a` | a tag on the proposal commit with two plain `Approves: <item>` lines passes, a PASS line naming each test | `twins/plain-lines-ignored`. None named; the smallest honest one reads only lines with `@<sha>`. |
| AC7 `#3166.b04433e1` | a tolerance raised in place, 1e-6 to 1e-4, approved by a tag on a later commit, fails naming the fixture | `twins/approval-lifts-refusal`. None named; it reads `@<sha>` lines as the issue says, and its guard lets an approval lift the refusal of an edit "refused even as an approved proposal". |

On the base: 10 tests, 2 fail at an assertion on the guard's output (AC1, AC5), 8 pass, none crashes.
`BASE-FAILURE.txt` holds that run in full and, for each twin, the run in which its criterion's tests fail.

### The twins

`twins.json` maps each criterion ID to its twin; `twins/<name>/scripts/…` holds whole replacement files the before
lane lays over the finished change. Each is the base's `scripts/proof-approvals.mjs` taught to read `@<sha>` lines,
with one wrong part its header comment states; `approval-lifts-refusal` also replaces `scripts/proof-guard.mjs`,
the base's with one condition dropped. None is chosen by a variable, and each compiles and runs. Because they are
whole files of the base's shape, they assume the finished change keeps the calls `proof.mjs` makes today:
`readApprovals(root, change, issue)` returning a map from commit ID to items with a `refused` list, and
`guard({ root, change, issue }, approvals, say)`. If the work changes those, the twins need a redraft by this job.

Each twin was proven on a scratch copy of the base (its `scripts/`, `package.json`, a link to `node_modules`, this
suite), the twin's files laid over, the suite run there: only its criterion's tests fail, each at an assertion on
the guard's exit code or lines (`whole-commit` also fails AC2's test, as a guard that wide would). A reference
reading of the issue, kept outside the repository, passed all ten the same way, so the suite can be satisfied.

## Choices the issue left open

1. **Surface.** This checkout's `node scripts/proof.mjs guard`, run in a scratch repository whose merge base
   (`origin/main`) holds `.deepbuild/approvers`, two tagged tests in two files, a tagged JSON Lines fixture of
   bounds with the test that reads it, and a marker `scripts/proof-guard.mjs`. Tests read the exit code and the
   `PASS guard:` / `FAIL guard:` lines. No commit names an issue, so none is fetched.
2. **"Passes" and "names".** A pass is exit 0, no FAIL/BLOCKED line, and a PASS line naming each approved test's
   file, as the base prints. A refusal is exit 1, a FAIL line naming the test's file (each tagged test has its own
   file) or the fixture's path, and no PASS line naming it. No other prose is required, except AC5's quoted words,
   which some FAIL line must hold.
3. **Items.** Lines name a file by its path (`Approves: tests/first.test.mjs @<sha>`), one of the two item forms the
   guard reads today. The `<path> › <test>` form with an `@<sha>` is not exercised.
4. **AC2's crossed tag.** The tag holds the first test with the second commit's ID *and* the second test with the
   first commit's. Only then does the tag name both commits, which a pooling guard needs to go wrong, and only then
   does "neither edit through" hold under today's rule that a proposal commit may touch any file its approval names.
   With one line crossed alone, the second commit would still be approved for its own test.
5. **AC3, "on another branch".** Two plants in one test. A commit on a branch the change never holds, named by a tag
   on the edit's own commit. And a side branch from main, merged into the change after the tagged commit: its commit
   is a commit of the change, yet the tagged commit descends from none of it. The second is the one an
   any-commit-ID guard lets through.
6. **AC3, "made after the tagged commit".** The tag sits on an ordinary earlier commit and names the later commit
   that skips the test. The abbreviated ID is the first twelve digits of a real earlier proposal commit's ID, under
   a tag on the last commit.
7. **AC4, "the same tag".** AC1's two lines on AC1's change: once as an annotated tag with no signature, once
   signed with presence by a security-key stand-in the approvers file doesn't list.
8. **AC5.** The tag sits on a later, ordinary commit and names only the test for the proposal commit, which also
   adds `extra.txt`. The quoted words may be on any FAIL guard line.
9. **AC7.** The raise is 1e-6 to 1e-4 in place, as #569's; the tag on a later commit names the fixture for the
   raising commit. Only "fails, naming the fixture" is asserted, not the two values.
10. **Signatures.** The guard takes only security-key signatures with user presence, so `authenticator.mjs` makes
    in-memory `sk-ssh-ed25519@openssh.com` keys and real SSHSIG/FIDO signatures with the presence flag; the real
    `ssh-keygen -Y verify` checks each before the guard sees its tag. No verifier is stubbed.

Not covered, since no criterion names it: a tag mixing plain and `@<sha>` lines, an `@<sha>` on a gate tag, a
SHA-256 repository, an item whose own text ends in ` @<hex>`, and the replay list's tag on HEAD (Scope's last line).

## Run

Needs Node 24, git with `merge-tree --write-tree`, OpenSSH's `ssh-keygen`, and the repo's installed dependencies
(`scripts/proof-change.mjs` imports `typescript`). No build.

```sh
node --test tests/acceptance/3166/guard.test.mjs
```

About 30 s: eleven guard runs. Every child process gets a temporary HOME and an allowlisted environment: no SSH
agent, key, git config or `DEEP_*` variable of the person running it. Scratch repositories live under the system
temp folder as `d3166-*` and are removed after each test. A fixture that can't be built asserts `BLOCKED`.

## Limits

- The security key is a software stand-in at the authenticator boundary; a person's real tag is the Proof's hand run.
- The base run shows these tests refuse the wrong programs above. It doesn't show an unseen implementation passes.
